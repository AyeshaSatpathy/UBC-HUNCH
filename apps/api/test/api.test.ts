import { test, expect } from "bun:test";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import { eq } from "drizzle-orm";
import { connectDatabase } from "../src/db";
import { createApp } from "../src/app";
import { notes } from "../src/schema";
import type { AppRouter } from "../src/router";
test("persists and reads a note through Hono and tRPC", async () => {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Set DATABASE_URL to a migrated test database");
  const { db, client } = connectDatabase(url);
  const server = Bun.serve({ port: 0, fetch: createApp(db, []).fetch });
  const api = createTRPCClient<AppRouter>({
    links: [httpBatchLink({ url: `${server.url}trpc` })],
  });
  let id: string | undefined;
  try {
    const note = await api.notes.create.mutate({ text: "Integration check" });
    id = note.id;
    expect((await api.notes.list.query()).some((n) => n.id === id)).toBe(true);
    expect((await fetch(`${server.url}ready`)).status).toBe(200);
    await expect(api.notes.create.mutate({ text: " " })).rejects.toThrow();
  } finally {
    if (id) await db.delete(notes).where(eq(notes.id, id));
    await server.stop(true);
    await client.end();
  }
});
