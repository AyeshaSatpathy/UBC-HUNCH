import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import type { Database } from "./db";
import { streamBatches } from "./schema";
import { market } from "./arc/contract";

const hex = z.string().regex(/^0x[0-9a-f]+$/i);
const hash = z.string().regex(/^0x[0-9a-f]{64}$/i);
const integer = z.union([z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), hex]).transform(value => BigInt(value));
const log = z.object({
  address: z.string().refine(value => value.toLowerCase() === market),
  blockNumber: integer.transform(String), blockHash: hash, transactionHash: hash,
  logIndex: integer.transform(value => value.toString()), data: z.string().regex(/^0x([0-9a-f]{2})*$/i),
  topics: z.array(hash).min(1).max(4), removed: z.literal(false).optional().default(false),
});
const payload = z.object({
  network: z.literal("arc-testnet"), start: integer, end: integer, logs: z.array(log).max(10000),
});
export function streamRoutes(db: Database) {
  const app = new Hono();
  app.use("*", bodyLimit({ maxSize: 2_000_000 }));
  app.post("/", async c => {
    const secret = process.env.QUICKNODE_STREAM_SECURITY_TOKEN;
    if (!secret) return c.json({ error: "Stream verification is not configured" }, 503);
    const nonce = c.req.header("x-qn-nonce"), timestamp = c.req.header("x-qn-timestamp"), signature = c.req.header("x-qn-signature");
    if (!nonce || !timestamp || !signature || !/^[a-f0-9]{64}$/i.test(signature)) return c.json({ error: "Invalid signature" }, 401);
    let body: string;
    try {
      const raw = Buffer.from(await c.req.arrayBuffer());
      body = c.req.header("content-encoding") === "gzip" ? gunzipSync(raw, { maxOutputLength: 2_000_000 }).toString("utf8") : raw.toString("utf8");
    } catch { return c.json({ error: "Invalid body" }, 400); }
    const expected = createHmac("sha256", secret).update(nonce + timestamp + body).digest();
    if (!timingSafeEqual(expected, Buffer.from(signature, "hex"))) return c.json({ error: "Invalid signature" }, 401);
    let json: unknown;
    try { json = JSON.parse(body); } catch { return c.json({ error: "Invalid JSON" }, 400); }
    const parsed = payload.safeParse(json);
    if (!parsed.success) return c.json({ error: "Unexpected stream payload" }, 400);
    const { start, end, logs } = parsed.data;
    if (end < start || logs.some(item => BigInt(item.blockNumber) < start || BigInt(item.blockNumber) > end)) {
      return c.json({ error: "Invalid block range" }, 400);
    }
    await db.insert(streamBatches).values({
      digest: createHash("sha256").update(body).digest("hex"), startBlock: start, endBlock: end, logs,
    }).onConflictDoNothing();
    return c.json({ accepted: true });
  });
  return app;
}
