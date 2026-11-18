import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Database } from "./db";
import { accounts, arcEvents, arcMarkets, campuses } from "./schema";
import { chainId, market } from "./arc/contract";

export async function activity(db: Database, campusId?: number) {
  return db.select({
    id: sql<string>`${arcEvents.transactionHash} || '-' || ${arcEvents.logIndex}::text`,
    kind: arcEvents.name, marketId: arcMarkets.marketId, question: arcMarkets.question,
    campus: campuses.name, block: sql<string>`${arcEvents.blockNumber}::text`,
  }).from(arcEvents).innerJoin(arcMarkets, and(eq(arcEvents.chainId, arcMarkets.chainId),
    eq(arcEvents.contract, arcMarkets.contract), eq(arcEvents.marketId, arcMarkets.marketId)))
    .innerJoin(campuses, eq(arcMarkets.campusId, sql`${campuses.unitid}::numeric`))
    .where(and(eq(arcEvents.chainId, chainId), eq(arcEvents.contract, market),
      inArray(arcEvents.name, ["MarketCreated", "Purchased", "Finalized", "MarketFunded"]),
      campusId ? eq(campuses.unitid, campusId) : undefined))
    .orderBy(desc(arcEvents.blockNumber), desc(arcEvents.logIndex)).limit(30);
}

export async function leaderboard(db: Database, campusId?: number) {
  return db.select({
    campusId: campuses.unitid, campus: campuses.name,
    participants: sql<number>`count(distinct ${arcEvents.wallet})::int`,
    purchases: sql<number>`count(*) filter (where ${arcEvents.name} = 'Purchased')::int`,
    markets: sql<number>`count(distinct ${arcMarkets.marketId})::int`,
  }).from(arcEvents).innerJoin(arcMarkets, and(eq(arcEvents.chainId, arcMarkets.chainId),
    eq(arcEvents.contract, arcMarkets.contract), eq(arcEvents.marketId, arcMarkets.marketId)))
    .innerJoin(campuses, eq(arcMarkets.campusId, sql`${campuses.unitid}::numeric`))
    .where(and(eq(arcEvents.chainId, chainId), eq(arcEvents.contract, market),
      campusId ? eq(campuses.unitid, campusId) : undefined))
    .groupBy(campuses.unitid, campuses.name)
    .orderBy(desc(sql`count(*) filter (where ${arcEvents.name} = 'Purchased')`), campuses.name).limit(20);
}
