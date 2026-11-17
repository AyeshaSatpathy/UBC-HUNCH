import { asc, eq, isNull, sql } from "drizzle-orm";
import {
  createWalletClient, encodeFunctionData, isAddress, keccak256, parseEventLogs,
  TransactionReceiptNotFoundError, type Address, type Hash, type TransactionSerialized,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { connectDatabase, type Database } from "../db";
import { accounts } from "../schema";
import { blockchain, circle, findCircleTransaction, reportFailure, requestId } from "../seed/circle";
import { arcTestnet, arcTransport, chainId, collateralAbi, createArcClient, market, marketAbi, usdc } from "./contract";
import { centsToUnits } from "./market-api";

const arc = createArcClient();

async function main() {
  const url = process.env.DATABASE_URL;
  const configuredTreasury = process.env.ARC_TREASURY_ADDRESS?.trim();
  const key = process.env.ARC_REGISTRAR_PRIVATE_KEY?.trim();
  if (!url || !configuredTreasury || !isAddress(configuredTreasury) || !key || !/^0x[\da-f]{64}$/i.test(key)) {
    throw new Error("Set DATABASE_URL, ARC_TREASURY_ADDRESS, and ARC_REGISTRAR_PRIVATE_KEY");
  }
  const treasury = configuredTreasury.toLowerCase() as Address;
  const registrar = privateKeyToAccount(key as Hash);
  if (await arc.getChainId() !== chainId) throw new Error("Expected Arc testnet");
  const admin = await arc.readContract({ address: market, abi: marketAbi, functionName: "admin" });
  if (admin.toLowerCase() !== registrar.address.toLowerCase()) throw new Error("Registrar signer must match the contract admin");
  const treasuryWallet = (await circle.listWallets({ blockchain, address: treasury })).data?.wallets
    .find((wallet) => wallet.address.toLowerCase() === treasury.toLowerCase() && wallet.accountType === "SCA");
  if (!treasuryWallet) throw new Error("The Circle treasury smart account was not found");
  const wallet = createWalletClient({ account: registrar, chain: arcTestnet, transport: arcTransport() });
  const { client, db } = connectDatabase(url);
  const follow = process.argv.includes("--follow");
  let stopping = false;
  process.once("SIGINT", () => { stopping = true; });
  process.once("SIGTERM", () => { stopping = true; });

  async function advanceOne() {
    type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
    return db.transaction(async (tx: Tx) => {
      const [lock] = await tx.execute<{ locked: boolean }>(sql`select pg_try_advisory_xact_lock(hashtextextended('hunch-account-provisioning', 0)) as locked`);
      if (!lock?.locked) return;
      const [account] = await tx.select().from(accounts).where(isNull(accounts.fundedAt))
        .orderBy(asc(accounts.verifiedAt), asc(accounts.id)).limit(1);
      if (!account) return;
      const save = (values: Partial<typeof accounts.$inferInsert>) =>
        tx.update(accounts).set(values).where(eq(accounts.id, account.id));

      if (!account.wallet) {
        const refId = "user:" + account.id;
        const existing = (await circle.listWallets({
          walletSetId: treasuryWallet!.walletSetId, blockchain, refId,
        })).data?.wallets ?? [];
        if (existing.length > 1) throw new Error("Multiple wallets match the account reference");
        const created = existing[0] ?? (await circle.createWallets({
          walletSetId: treasuryWallet!.walletSetId, blockchains: [blockchain], accountType: "SCA", count: 1,
          metadata: [{ refId }], idempotencyKey: requestId(refId),
        })).data?.wallets[0];
        if (!created || created.accountType !== "SCA" || created.blockchain !== blockchain) throw new Error("Wallet creation is incomplete");
        await save({ wallet: created.address.toLowerCase(), circleWalletId: created.id });
        return;
      }
      const address = account.wallet as Address;
      if (!account.registeredAt) {
        const unitid = await arc.readContract({ address: market, abi: marketAbi, functionName: "campusOf", args: [address] });
        if (unitid === BigInt(account.unitid)) {
          await save({ registeredAt: new Date(), registrationTx: null });
          return;
        }
        if (unitid !== 0n) throw new Error("Wallet has a different campus registration");
        if (!account.registrationTx) {
          const prepared = await wallet.prepareTransactionRequest({
            to: market, data: encodeFunctionData({ abi: marketAbi, functionName: "register", args: [address, BigInt(account.unitid)] }),
          });
          await save({ registrationTx: await wallet.signTransaction(prepared) });
          return; // Persist the signed transaction before broadcasting it.
        }
        const raw = account.registrationTx as TransactionSerialized;
        const receipt = await arc.getTransactionReceipt({ hash: keccak256(raw) }).catch((error) => {
          if (!(error instanceof TransactionReceiptNotFoundError)) throw error;
          return null;
        });
        if (!receipt) {
          await arc.sendRawTransaction({ serializedTransaction: raw }).catch((error) => {
            if (!(error instanceof Error) || !/already known|known transaction/i.test(error.message)) throw error;
          });
        } else if (receipt.status === "reverted") {
          await save({ registrationTx: null });
        }
        return;
      }

      const amount = centsToUnits(account.creditCents);
      if (!account.fundingId) {
        const refId = `credit:${account.id}:${account.fundingAttempt}`;
        const prior = await findCircleTransaction(treasuryWallet!.id, refId, account.verifiedAt);
        if (prior) {
          await save({ fundingId: prior.id });
          return;
        }
        const balance = await arc.readContract({ address: usdc, abi: collateralAbi, functionName: "balanceOf", args: [treasury] });
        if (balance < amount) return;
        const response = await circle.createContractExecutionTransaction({
          walletId: treasuryWallet!.id, contractAddress: usdc,
          callData: encodeFunctionData({ abi: collateralAbi, functionName: "transfer", args: [address, amount] }),
          fee: { type: "level", config: { feeLevel: "MEDIUM" } }, idempotencyKey: requestId(refId), refId,
        });
        const fundingId = response.data?.id;
        if (!fundingId) throw new Error("Missing treasury transfer ID");
        await save({ fundingId });
        return;
      }
      const funding = (await circle.getTransaction({ id: account.fundingId })).data?.transaction;
      if (!funding) throw new Error("Missing treasury transfer status");
      if (["FAILED", "DENIED", "CANCELLED"].includes(funding.state)) {
        await save({ fundingId: null, fundingAttempt: account.fundingAttempt + 1 });
        return;
      }
      if (funding.state !== "COMPLETE" || !funding.txHash) return;
      const receipt = await arc.getTransactionReceipt({ hash: funding.txHash as Hash });
      const events = parseEventLogs({
        abi: collateralAbi, eventName: "Transfer", logs: receipt.logs.filter((log) => log.address.toLowerCase() === usdc),
      });
      if (receipt.status !== "success" || !events.some(({ args }) =>
        args.from.toLowerCase() === treasury && args.to.toLowerCase() === address && args.value === amount)) {
        throw new Error("Treasury receipt did not prove the starting credit");
      }
      await save({ fundedAt: new Date() });
    });
  }

  try {
    do {
      await advanceOne();
      if (follow && !stopping) await Bun.sleep(3_000);
    } while (follow && !stopping);
  } finally { await client.end(); }
}

await main().catch((error: unknown) => {
  // Provider errors may include credentials or signed transaction data.
  if (error instanceof Error && "metaMessages" in error) {
    console.error("Arc account provisioning request failed");
    process.exitCode = 1;
  } else reportFailure(error);
});
