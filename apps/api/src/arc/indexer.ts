import { and, asc, eq, gte, lte, sql, type SQL } from "drizzle-orm";
import { decodeEventLog, zeroAddress, zeroHash } from "viem";
import type { Database } from "../db";
import { arcCursors, arcEvents, arcMarkets, arcPositions, streamBatches } from "../schema";
import { chainId, createArcClient, deploymentBlock, market, marketAbi } from "./contract";

async function readLogs(rpc: ReturnType<typeof createArcClient>, fromBlock: bigint, toBlock: bigint) {
  const logs = await rpc.getLogs({ address: market, fromBlock, toBlock });
  return logs.map((log) => ({ ...log, ...decodeEventLog({ abi: marketAbi, data: log.data, topics: log.topics }) }));
}

type Event = Awaited<ReturnType<typeof readLogs>>[number];
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type NewMarket = typeof arcMarkets.$inferInsert;
const chain = { chainId, contract: market };
const cursorKey = and(eq(arcCursors.chainId, chainId), eq(arcCursors.contract, market));

async function readLogsWithBackoff(rpc: ReturnType<typeof createArcClient>, fromBlock: bigint, toBlock: bigint) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await readLogs(rpc, fromBlock, toBlock);
    } catch (error) {
      const rpcError = error as { code?: number; details?: string };
      if (rpcError.code !== -32005 || !rpcError.details?.includes("rate limit") || attempt >= 6) throw error;
      await Bun.sleep(1_000 * (attempt + 1));
    }
  }
}

function eventWallet(event: Event) {
  switch (event.eventName) {
    case "MarketCreated": return event.args.creator;
    case "ReviewerAssigned": return event.args.reviewer;
    case "Purchased": return event.args.buyer;
    case "Predicted": return event.args.student;
    case "CampusRegistered":
    case "ReviewerRosterUpdated":
    case "Claimed": return event.args.wallet;
    default: return null;
  }
}

async function projectEvent(tx: Transaction, event: Event, created: Map<string, NewMarket>) {
  const { args, blockNumber } = event;
  if (!("id" in args)) return;
  const marketId = args.id.toString();
  const marketKey = and(eq(arcMarkets.chainId, chainId), eq(arcMarkets.contract, market), eq(arcMarkets.marketId, marketId));
  const updateMarket = async (values: { [Key in keyof NewMarket]?: NewMarket[Key] | SQL }) => {
    const [row] = await tx.update(arcMarkets).set({ ...values, indexedThrough: blockNumber })
      .where(marketKey).returning({ id: arcMarkets.marketId });
    if (!row) throw new Error(`Missing creation event for market ${marketId}`);
  };
  const positionKey = (wallet: string) => ({
    ...chain, marketId, wallet: wallet.toLowerCase(), indexedThrough: blockNumber,
  });
  const positionTarget = [arcPositions.chainId, arcPositions.contract, arcPositions.marketId, arcPositions.wallet];
  switch (event.eventName) {
    case "MarketCreated": {
      const row = created.get(marketId);
      if (!row) throw new Error(`Missing immutable terms for market ${marketId}`);
      await tx.insert(arcMarkets).values(row);
      return;
    }
    case "ReviewerAssigned":
      await updateMarket({ reviewer: event.args.reviewer.toLowerCase() });
      return;
    case "MarketFunded": {
      const allocation = event.args.allocation.toString();
      await updateMarket({ status: 1, allocation, sets: allocation, yesReserve: allocation, noReserve: allocation });
      return;
    }
    case "Purchased": {
      const { buyer, yes, principal, fee, shares } = event.args;
      const debit = principal + fee;
      const yesShares = (yes ? shares : 0n).toString();
      const noShares = (yes ? 0n : shares).toString();
      await updateMarket({
        sets: sql`${arcMarkets.sets} + ${principal.toString()}`,
        yesReserve: sql`${arcMarkets.yesReserve} + ${(principal - BigInt(yesShares)).toString()}`,
        noReserve: sql`${arcMarkets.noReserve} + ${(principal - BigInt(noShares)).toString()}`,
        fees: sql`${arcMarkets.fees} + ${fee.toString()}`,
      });
      await tx.insert(arcPositions).values({
        ...positionKey(buyer), yes: yesShares, no: noShares, debit: debit.toString(), prediction: 0, claimed: false,
      }).onConflictDoUpdate({
        target: positionTarget,
        set: {
          yes: sql`${arcPositions.yes} + excluded.yes`,
          no: sql`${arcPositions.no} + excluded.no`,
          debit: sql`${arcPositions.debit} + excluded.debit`,
          indexedThrough: blockNumber,
        },
      });
      return;
    }
    case "Predicted": {
      const prediction = event.args.yes ? 1 : 2;
      await tx.insert(arcPositions).values({
        ...positionKey(event.args.student), yes: "0", no: "0", debit: "0", prediction, claimed: false,
      }).onConflictDoUpdate({ target: positionTarget, set: { prediction, indexedThrough: blockNumber } });
      return;
    }
    case "Finalized": {
      const { status, evidence, capitalReturned } = event.args;
      await updateMarket({
        status, evidence,
        remainingClaims: status === 4
          ? sql`${arcMarkets.sets} - ${arcMarkets.allocation} + ${arcMarkets.fees}`
          : sql`${arcMarkets.sets} - ${capitalReturned.toString()}`,
      });
      return;
    }
    case "Claimed": {
      await updateMarket({ remainingClaims: sql`${arcMarkets.remainingClaims} - ${event.args.amount.toString()}` });
      const { wallet } = positionKey(event.args.wallet);
      const [position] = await tx.update(arcPositions).set({ claimed: true, indexedThrough: blockNumber })
        .where(and(eq(arcPositions.chainId, chainId), eq(arcPositions.contract, market),
          eq(arcPositions.marketId, marketId), eq(arcPositions.wallet, wallet)))
        .returning({ wallet: arcPositions.wallet });
      if (!position) throw new Error(`Missing claimed position for market ${marketId}`);
    }
  }
}

async function loadMarketTerms(rpc: ReturnType<typeof createArcClient>, events: Event[]) {
  const result = new Map<string, NewMarket>();
  for (const event of events) {
    if (event.eventName !== "MarketCreated") continue;
    const { id, campus, creator } = event.args;
    // Terms never change after creation. A current read avoids needing an archive node.
    const details = await rpc.readContract({ address: market, abi: marketAbi, functionName: "getMarket", args: [id] });
    if (details.campus !== campus || details.creator.toLowerCase() !== creator.toLowerCase()) {
      throw new Error(`Market ${id} differs from its creation event`);
    }
    const { question, source, yesRule, noRule, close, deadline } = details.terms;
    result.set(id.toString(), {
      ...chain, marketId: id.toString(), campusId: campus.toString(), creator: creator.toLowerCase(),
      reviewer: zeroAddress, question, source, yesRule, noRule,
      closesAt: close.toString(), evidenceDeadline: deadline.toString(), status: 0,
      allocation: "0", sets: "0", yesReserve: "0", noReserve: "0", fees: "0", remainingClaims: "0",
      evidence: zeroHash, indexedThrough: event.blockNumber,
    });
  }
  return result;
}

export async function indexThroughHead(db: Database, rpc: ReturnType<typeof createArcClient>, shouldStop = () => false, streamsOnly = false) {
  if (await rpc.getChainId() !== chainId) throw new Error("Expected Arc testnet RPC");
  await db.insert(arcCursors).values({ ...chain, nextBlock: deploymentBlock }).onConflictDoNothing();
  const { number: head } = await rpc.getBlock({ blockTag: "finalized", includeTransactions: false });
  if (head < deploymentBlock) throw new Error("Arc RPC head precedes the deployed contract");
  let inserted = 0;
  for (;;) {
    const [cursor] = await db.select().from(arcCursors).where(cursorKey);
    if (!cursor) throw new Error("Arc cursor is missing");
    const from = cursor.nextBlock;
    if (from > head || shouldStop()) return { nextBlock: from, inserted };

    // Arc finalizes blocks before exposing them on the EL RPC. Keep requests within the public provider's range limit.
    const [batch] = streamsOnly ? await db.select().from(streamBatches)
      .where(and(lte(streamBatches.startBlock, from), gte(streamBatches.endBlock, from)))
      .orderBy(asc(streamBatches.endBlock)).limit(1) : [];
    if (streamsOnly && !batch) return { nextBlock: from, inserted };
    const end = batch ? batch.endBlock : from + 999n > head ? head : from + 999n;
    if (end > head) return { nextBlock: from, inserted };
    const streamed = batch?.logs.map(log => ({
      ...log, blockNumber: BigInt(String(log.blockNumber)), logIndex: Number(BigInt(String(log.logIndex))),
      transactionIndex: Number(BigInt(String(log.transactionIndex ?? "0"))),
      ...decodeEventLog({ abi: marketAbi, data: log.data as `0x${string}`, topics: log.topics as [`0x${string}`, ...`0x${string}`[]] }),
    })) as Event[] | undefined;
    const events = (streamed ?? await readLogsWithBackoff(rpc, from, end)).filter(event => event.blockNumber >= from).sort((a, b) =>
      a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1);
    const created = await loadMarketTerms(rpc, events);
    inserted += await db.transaction(async (tx) => {
      // Compare and advance locks the cursor row. A competing worker discards this fetched batch.
      const [advanced] = await tx.update(arcCursors).set({ nextBlock: end + 1n })
        .where(and(cursorKey, eq(arcCursors.nextBlock, from))).returning({ nextBlock: arcCursors.nextBlock });
      if (!advanced) return 0;
      let count = 0;
      for (const event of events) {
        if (event.removed) throw new Error("Arc RPC returned a removed event");
        const args = Object.fromEntries(Object.entries(event.args).map(([key, value]) =>
          [key, typeof value === "bigint" ? value.toString() : value]));
        const [saved] = await tx.insert(arcEvents).values({
          ...chain, transactionHash: event.transactionHash.toLowerCase(), logIndex: event.logIndex, blockNumber: event.blockNumber,
          blockHash: event.blockHash.toLowerCase(), name: event.eventName, args, marketId: "id" in args ? String(args.id) : null,
          wallet: eventWallet(event)?.toLowerCase(),
        }).onConflictDoNothing().returning({ logIndex: arcEvents.logIndex });
        if (!saved) continue;
        await projectEvent(tx, event, created);
        count++;
      }
      return count;
    });
  }
}
