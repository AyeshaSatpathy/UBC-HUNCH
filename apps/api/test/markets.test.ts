import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import { eq } from "drizzle-orm";
import { createApp } from "../src/app";
import { chainId, market } from "../src/arc/contract";
import { connectDatabase } from "../src/db";
import type { AppRouter } from "../src/router";
import { arcMarkets } from "../src/schema";

test("market API paginates directory markets and hides synthetic campus fixtures", async () => {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Set DATABASE_URL to a migrated and seeded test database");
  const { db, client } = connectDatabase(url);
  const server = Bun.serve({ port: 0, fetch: createApp(db, []).fetch });
  const api = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: `${server.url}trpc` })] });
  const firstId = BigInt("0x" + randomUUID().replaceAll("-", ""));
  const ids = [firstId.toString(), (firstId + 1n).toString(), (firstId + 2n).toString()];
  const row = {
    chainId, contract: market, campusId: "228778", creator: "0x1", reviewer: "0x2",
    question: "Will the library extend its hours?", source: "Library hours", yesRule: "Extended", noRule: "Unchanged",
    closesAt: "1", evidenceDeadline: "2", status: 1, allocation: "20000000", sets: "24000000",
    yesReserve: "16666667", noReserve: "24000000", fees: "40000", remainingClaims: "0",
    evidence: "0x0", indexedThrough: 1n,
  };
  try {
    await db.insert(arcMarkets).values(ids.map((id, i) => ({ ...row, marketId: id, campusId: i === 2 ? "1" : row.campusId })));
    const page = await api.markets.list.query({ campusId: 228778, limit: 1, before: ids[2] });
    expect(page.items[0]).toMatchObject({
      id: ids[1], campus: { unitid: 228778 }, status: "awaiting", yesPercent: 59,
    });
    expect(page.nextCursor).toBe(ids[1]);
    expect((await api.markets.list.query({ campusId: 228778, before: ids[1] })).items[0]?.id).toBe(ids[0]);
    expect((await api.markets.detail.query({ marketId: ids[0] })).question).toBe(row.question);
    await expect(api.markets.detail.query({ marketId: ids[2] })).rejects.toThrow("Market unavailable");
    await expect(api.markets.quote.query({ marketId: ids[2], amountCents: 400, side: "YES" })).rejects.toThrow("Market unavailable");
    await expect(api.claims.preview.query({ marketId: ids[0] })).rejects.toThrow("UNAUTHORIZED");
  } finally {
    await Promise.all(ids.map((id) => db.delete(arcMarkets).where(eq(arcMarkets.marketId, id))));
    await server.stop(true);
    await client.end();
  }
});
