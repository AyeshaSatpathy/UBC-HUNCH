import { TRPCError } from "@trpc/server";
import { and, desc, eq, sql } from "drizzle-orm";
import { encodeFunctionData, parseEventLogs, type Hash } from "viem";
import type { Database } from "../db";
import { accounts, claimRequests } from "../schema";
import { createArcClient, market, marketAbi } from "./contract";
import { previewClaim, settledCents } from "./market-api";

type Account = typeof accounts.$inferSelect;
type Claim = typeof claimRequests.$inferSelect;
const arc = createArcClient();

async function reconcile(claim: Claim, account: Account) {
  const pending = { requestId: claim.id, status: "pending" as const, amountCents: null };
  if (!claim.circleId) return pending;
  const { circle } = await import("../seed/circle");
  const tx = (await circle.getTransaction({ id: claim.circleId })).data?.transaction;
  if (!tx) throw new Error("Missing claim transaction status");
  const failed = { ...pending, status: "failed" as const };
  if (["FAILED", "DENIED", "CANCELLED"].includes(tx.state)) return failed;
  if (tx.state !== "COMPLETE" || !tx.txHash) return pending;
  const receipt = await arc.getTransactionReceipt({ hash: tx.txHash as Hash });
  const event = parseEventLogs({
    abi: marketAbi, eventName: "Claimed", logs: receipt.logs.filter((log) => log.address.toLowerCase() === market),
  }).find(({ args }) => args.id.toString() === claim.marketId && args.wallet.toLowerCase() === account.wallet);
  if (receipt.status !== "success" || !event) return failed;
  return { requestId: claim.id, status: "confirmed" as const, amountCents: settledCents(event.args.amount) };
}

export async function claimStatus(db: Database, account: Account, id: string) {
  const [claim] = await db.select().from(claimRequests)
    .where(and(eq(claimRequests.accountId, account.id), eq(claimRequests.id, id)));
  if (!claim) throw new TRPCError({ code: "NOT_FOUND", message: "Claim request not found" });
  try { return await reconcile(claim, account); }
  catch { throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Claim status is temporarily unavailable" }); }
}

export async function submitClaim(db: Database, account: Account, marketId: string) {
  if (!account.circleWalletId || !account.wallet || !account.fundedAt) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Your account is still being set up" });
  }
  try {
    // Take a per-claim lock across submission. The request ID is durable before any Circle call.
    const claim = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${"claim:" + account.id + ":" + marketId}, 0))`);
      const [existing] = await tx.select().from(claimRequests).where(
        and(eq(claimRequests.accountId, account.id), eq(claimRequests.marketId, marketId)),
      ).orderBy(desc(claimRequests.attempt)).limit(1);
      if (existing && (await reconcile(existing, account)).status !== "failed") return existing;
      if ((await previewClaim(marketId, account)).status !== "available") {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "This payout is unavailable" });
      }
      const [created] = await tx.insert(claimRequests).values({
        accountId: account.id, marketId, attempt: (existing?.attempt ?? 0) + 1,
      }).returning();
      return created;
    });
    if (claim.circleId) return await reconcile(claim, account);
    const { circle, findCircleTransaction, requestId } = await import("../seed/circle");
    const refId = "claim:" + claim.id;
    const prior = await findCircleTransaction(account.circleWalletId, refId, account.verifiedAt);
    const response = prior ? null : await circle.createContractExecutionTransaction({
      walletId: account.circleWalletId, contractAddress: market,
      callData: encodeFunctionData({ abi: marketAbi, functionName: "claim", args: [BigInt(marketId)] }),
      fee: { type: "level", config: { feeLevel: "MEDIUM" } }, idempotencyKey: requestId(refId), refId,
    });
    const circleId = prior?.id ?? response?.data?.id;
    if (!circleId) throw new Error("Missing claim submission ID");
    await db.update(claimRequests).set({ circleId }).where(eq(claimRequests.id, claim.id));
    return { requestId: claim.id, status: "pending" as const, amountCents: null };
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Claim submission is temporarily unavailable" });
  }
}
