import { and, asc, eq, gt, ne, notExists, sql } from "drizzle-orm";
import { BaseError, ContractFunctionRevertedError, createWalletClient, encodeFunctionData, keccak256, parseEventLogs,
  TransactionReceiptNotFoundError, zeroAddress, type Hash, type TransactionSerialized } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { connectDatabase } from "../db";
import { arcMarkets, autoFunding, campuses } from "../schema";
import { arcTestnet, arcTransport, chainId, createArcClient, market, marketAbi } from "./contract";

const allocation = 20_000_000n;
const marketLimit = 4;
const deployment = and(eq(autoFunding.chainId, chainId), eq(autoFunding.contract, market));

async function main() {
  const url = process.env.DATABASE_URL;
  const key = process.env.ARC_LP_PRIVATE_KEY?.trim();
  if (!url || !key || !/^0x[\da-f]{64}$/i.test(key)) throw new Error("Set DATABASE_URL and ARC_LP_PRIVATE_KEY");
  const account = privateKeyToAccount(key as Hash);
  const arc = createArcClient();
  if (await arc.getChainId() !== chainId) throw new Error("Expected Arc testnet");
  const [lp, cap] = await Promise.all([
    arc.readContract({ address: market, abi: marketAbi, functionName: "liquidityProvider" }),
    arc.readContract({ address: market, abi: marketAbi, functionName: "ALLOCATION_CAP" }),
  ]);
  if (lp.toLowerCase() !== account.address.toLowerCase()) throw new Error("Configured signer does not match the contract LP");
  if (allocation > cap) throw new Error("Configured allocation exceeds the contract cap");

  const wallet = createWalletClient({ account, chain: arcTestnet, transport: arcTransport() });
  const { db, client } = connectDatabase(url);
  const follow = process.argv.includes("--follow");
  let stopping = false;
  process.once("SIGINT", () => { stopping = true; });
  process.once("SIGTERM", () => { stopping = true; });

  async function advance() {
    return db.transaction(async (tx) => {
      const [lock] = await tx.execute<{ acquired: boolean }>(
        sql`select pg_try_advisory_xact_lock(hashtextextended(${"auto-funding:" + chainId + ":" + market}, 0)) as acquired`,
      );
      if (!lock?.acquired) return;
      const attempts = await tx.select().from(autoFunding).where(deployment);
      if (attempts.some(item => item.state === "mismatch")) throw new Error("An unmatched funding receipt requires operator review");
      const pending = attempts.find(item => item.state === "prepared");
      if (pending) {
        const hash = pending.transactionHash as Hash;
        const receipt = await arc.getTransactionReceipt({ hash }).catch((error) => {
          if (!(error instanceof TransactionReceiptNotFoundError)) throw error;
          return null;
        });
        if (!receipt) {
          await arc.sendRawTransaction({ serializedTransaction: pending.signedTransaction as TransactionSerialized })
            .catch((error) => {
              if (!(error instanceof Error) || !/already known|known transaction/i.test(error.message)) throw error;
            });
          return;
        }
        const eventMatched = parseEventLogs({
          abi: marketAbi, eventName: "MarketFunded",
          logs: receipt.logs.filter(log => log.address.toLowerCase() === market),
        }).some(({ args }) => args.id.toString() === pending.marketId && args.allocation.toString() === pending.allocation);
        const state = receipt.status === "reverted" ? "reverted" : eventMatched ? "funded" : "mismatch";
        const details = { block: receipt.blockNumber.toString(), blockHash: receipt.blockHash, status: receipt.status, eventMatched };
        await tx.update(autoFunding).set({ state, receipt: details }).where(eq(autoFunding.transactionHash, hash));
        return { marketId: pending.marketId, hash, allocation: pending.allocation, state, ...details };
      }
      if (attempts.filter(item => item.state === "funded").length >= marketLimit) return;
      const available = await arc.readContract({ address: market, abi: marketAbi, functionName: "available" });
      if (available < allocation) return;
      const candidates = await tx.select({ id: arcMarkets.marketId }).from(arcMarkets)
        .innerJoin(campuses, eq(arcMarkets.campusId, sql`${campuses.unitid}::numeric`))
        .where(and(eq(arcMarkets.chainId, chainId), eq(arcMarkets.contract, market), eq(arcMarkets.status, 0),
          ne(arcMarkets.reviewer, zeroAddress), gt(arcMarkets.closesAt, String(Math.floor(Date.now() / 1000))),
          notExists(tx.select({ id: autoFunding.marketId }).from(autoFunding)
            .where(and(deployment, eq(autoFunding.marketId, arcMarkets.marketId))))))
        .orderBy(asc(arcMarkets.marketId));
      for (const { id } of candidates) {
        const args = [BigInt(id), allocation] as const;
        try {
          // The deployed contract checks draft status, the reviewer roster, the deadline and the available vault.
          await arc.simulateContract({ address: market, abi: marketAbi, functionName: "fund", args, account });
        } catch (error) {
          if (error instanceof BaseError && error.walk(cause => cause instanceof ContractFunctionRevertedError) instanceof ContractFunctionRevertedError) continue;
          throw error;
        }
        const data = encodeFunctionData({ abi: marketAbi, functionName: "fund", args });
        const signedTransaction = await wallet.signTransaction(await wallet.prepareTransactionRequest({ to: market, data }));
        await tx.insert(autoFunding).values({
          chainId, contract: market, marketId: id, allocation: allocation.toString(),
          signedTransaction, transactionHash: keccak256(signedTransaction), state: "prepared",
        });
        // Commit the single reservation before broadcasting in the next pass.
        return;
      }
    });
  }

  try {
    do {
      const receipt = await advance();
      if (receipt) console.log(JSON.stringify({ event: "auto_funding_receipt", ...receipt }));
      if (follow && !stopping) await Bun.sleep(3_000);
    } while (follow && !stopping);
  } finally { await client.end(); }
}

await main().catch((error: unknown) => {
  // Provider errors can contain transport configuration or the signed payload.
  console.error(error instanceof BaseError ? "Arc funding request failed. Rerun to resume the saved transaction." :
    error instanceof Error && /^(Set |Expected |Configured |An unmatched )/.test(error.message) ? error.message : "Auto-funding stopped. Check the database and RPC.");
  process.exitCode = 1;
});
