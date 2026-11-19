import { TRPCError } from "@trpc/server";
import { and, desc, eq, lt, sql } from "drizzle-orm";
import { BaseError, ContractFunctionRevertedError, type Address } from "viem";
import type { Database } from "../db";
import { accounts, arcMarkets, arcPositions, campuses, savedMarkets } from "../schema";
import { chainId, collateralAbi, createArcClient, market, marketAbi, usdc } from "./contract";

const deployment = and(eq(arcMarkets.chainId, chainId), eq(arcMarkets.contract, market));
const arc = createArcClient();
const statuses = ["draft", "open", "yes", "no", "void"] as const;
export const centsToUnits = (cents: number) => BigInt(cents) * 10_000n;
export const settledCents = (amount: bigint) => (amount / 10_000n).toString();

function marketFields(row: typeof arcMarkets.$inferSelect, campus: { unitid: number; name: string }) {
  const closes = BigInt(row.closesAt);
  const reserves = BigInt(row.yesReserve) + BigInt(row.noReserve);
  return {
    id: row.marketId, campus,
    question: row.question, source: row.source, yesRule: row.yesRule, noRule: row.noRule,
    closesAtUnix: row.closesAt, evidenceDeadlineUnix: row.evidenceDeadline,
    status: row.status === 1 && closes <= BigInt(Math.floor(Date.now() / 1000)) ? "awaiting" as const : statuses[row.status],
    yesPercent: reserves ? Number((BigInt(row.noReserve) * 100n + reserves / 2n) / reserves) : 50,
  };
}

function indexedMarkets(db: Database) {
  return db.select({ market: arcMarkets, campus: { unitid: campuses.unitid, name: campuses.name } })
    .from(arcMarkets).innerJoin(campuses, eq(arcMarkets.campusId, sql`${campuses.unitid}::numeric`));
}

export async function listMarkets(db: Database, query: { campusId?: number; before?: string; limit: number }) {
  const rows = await indexedMarkets(db).where(and(
    deployment, query.campusId === undefined ? undefined : eq(campuses.unitid, query.campusId),
    query.before === undefined ? undefined : lt(arcMarkets.marketId, query.before),
  )).orderBy(desc(arcMarkets.marketId)).limit(query.limit + 1);
  const items = rows.slice(0, query.limit).map(({ market, campus }) => marketFields(market, campus));
  return { items, nextCursor: rows.length > query.limit ? items.at(-1)!.id : null };
}

export async function getMarket(db: Database, id: string, viewer?: string | null) {
  const [row] = await indexedMarkets(db).where(and(deployment, eq(arcMarkets.marketId, id))).limit(1);
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Market unavailable" });
  return { ...marketFields(row.market, row.campus), canParticipate: !!viewer && viewer.toLowerCase() !== row.market.reviewer };
}

export async function listSavedMarkets(db: Database, accountId: string) {
  const rows = await indexedMarkets(db).innerJoin(savedMarkets, eq(savedMarkets.marketId, arcMarkets.marketId))
    .where(and(deployment, eq(savedMarkets.accountId, accountId))).orderBy(desc(savedMarkets.createdAt));
  return rows.map(({ market, campus }) => marketFields(market, campus));
}

export async function quoteMarket(id: string, side: "YES" | "NO", cents: number) {
  try {
    const [shares, fee, debit] = await arc.readContract({
      address: market, abi: marketAbi, functionName: "quote", args: [BigInt(id), side === "YES", centsToUnits(cents)],
    });
    return {
      principalCents: cents.toString(), feeCents: ((fee + 9_999n) / 10_000n).toString(),
      totalCents: ((debit + 9_999n) / 10_000n).toString(), sharesMillionths: shares.toString(),
    };
  } catch (error) {
    if (revertName(error)) throw new TRPCError({ code: "BAD_REQUEST", message: "This quote is unavailable" });
    throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Pricing is temporarily unavailable" });
  }
}

const walletState = (account: typeof accounts.$inferSelect) => account.wallet && account.fundedAt ? "ready" as const : "pending" as const;

export async function portfolio(db: Database, account: typeof accounts.$inferSelect) {
  const state = walletState(account);
  if (state === "pending") return { state, balanceCents: null, positions: [] };
  try {
    const [balance, rows] = await Promise.all([
      arc.readContract({ address: usdc, abi: collateralAbi, functionName: "balanceOf", args: [account.wallet as Address] }),
      db.select({ position: arcPositions, market: arcMarkets, campus: { unitid: campuses.unitid, name: campuses.name } })
        .from(arcPositions).innerJoin(arcMarkets, and(
          eq(arcMarkets.marketId, arcPositions.marketId), eq(arcMarkets.chainId, arcPositions.chainId),
          eq(arcMarkets.contract, arcPositions.contract),
        )).innerJoin(campuses, eq(arcMarkets.campusId, sql`${campuses.unitid}::numeric`))
        .where(and(deployment, eq(arcPositions.wallet, account.wallet!))).orderBy(desc(arcPositions.indexedThrough)),
    ]);
    return {
      state, balanceCents: settledCents(balance),
      positions: rows.map(({ market, position, campus }) => ({
        market: marketFields(market, campus), yesSharesMillionths: position.yes,
        noSharesMillionths: position.no, paidCents: ((BigInt(position.debit) + 9_999n) / 10_000n).toString(),
        prediction: position.prediction === 1 ? "YES" as const : position.prediction === 2 ? "NO" as const : null,
        claimed: position.claimed,
      })),
    };
  } catch {
    throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Portfolio is temporarily unavailable" });
  }
}

function revertName(error: unknown) {
  return error instanceof BaseError
    ? (error.walk((cause) => cause instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError).data?.errorName
    : undefined;
}

export async function previewClaim(id: string, account: typeof accounts.$inferSelect) {
  if (!account.wallet || walletState(account) === "pending") {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Your account is still being set up" });
  }
  try {
    const { result } = await arc.simulateContract({
      address: market, abi: marketAbi, account: account.wallet as Address, functionName: "claim", args: [BigInt(id)],
    });
    return { status: "available" as const, amountCents: settledCents(result) };
  } catch (error) {
    const reason = revertName(error);
    if (reason === "AlreadyClaimed") return { status: "claimed" as const, amountCents: null };
    if (reason === "NothingToClaim" || reason === "MarketNotFinalized") {
      return { status: "unavailable" as const, amountCents: null };
    }
    throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Claim status is temporarily unavailable" });
  }
}
