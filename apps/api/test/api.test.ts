import { test, expect } from "bun:test";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import { connectDatabase } from "../src/db";
import { createApp } from "../src/app";
import type { AppRouter } from "../src/router";
test("public API rejects unauthenticated actions and removed scaffold writes", async () => {
  const { db, client } = connectDatabase(process.env.DATABASE_URL!);
  const app = createApp(db, []);
  try {
    const removed = await app.request('/trpc/notes.create', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'unwanted write' }) });
    expect(removed.status).toBe(404);
    const privateAction = await app.request('/trpc/markets.buy', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ marketId: '1', side: 'YES', cents: 400, shares: '1', requestKey: 'audit-request-123' }) });
    expect(privateAction.status).toBe(401);
    expect((await app.request('/ready')).status).toBe(200);
    const oversized = await app.request('/trpc/auth.requestCode', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: 'x'.repeat(1_000_001),
    });
    expect(oversized.status).toBe(413);
  } finally { await client.end(); }
});

test("finds seeded IPEDS campuses by alias, location, and exact UNITID", async () => {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Set DATABASE_URL to a migrated database and run db:seed:campuses");
  const { db, client } = connectDatabase(url);
  const server = Bun.serve({ port: 0, fetch: createApp(db, []).fetch });
  const api = createTRPCClient<AppRouter>({
    links: [httpBatchLink({ url: `${server.url}trpc` })],
  });
  const austin = {
    unitid: 228778, name: "The University of Texas at Austin", city: "Austin", state: "TX",
  };
  try {
    expect(await api.campuses.search.query({ query: "228778" })).toEqual([austin]);
    expect(await api.campuses.search.query({ query: "ut aust" })).toContainEqual(austin);
    const local = await api.campuses.search.query({ query: "Austin TX", limit: 2 });
    expect(local).toHaveLength(2);
    expect(local.every((campus) => campus.city === "Austin" && campus.state === "TX")).toBe(true);
    expect(await api.campuses.search.query({ query: "!!!" })).toEqual([]);
    await expect(api.campuses.search.query({ query: "Austin", limit: 26 })).rejects.toThrow();
  } finally {
    await server.stop(true);
    await client.end();
  }
});
