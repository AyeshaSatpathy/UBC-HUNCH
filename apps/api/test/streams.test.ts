import { expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { createApp } from "../src/app";
import { connectDatabase } from "../src/db";
import { streamBatches } from "../src/schema";

test("Stream deliveries authenticate, validate, and deduplicate", async () => {
  const { db, client } = connectDatabase(process.env.DATABASE_URL!);
  const prior = process.env.QUICKNODE_STREAM_SECURITY_TOKEN;
  process.env.QUICKNODE_STREAM_SECURITY_TOKEN = "local-stream-test";
  const app = createApp(db, []);
  const body = JSON.stringify({ network: "arc-testnet", start: 123, end: 124, logs: [] });
  const send = (signature: string, payload = body) => app.request("/webhooks/quicknode", { method: "POST", body: payload,
    headers: { "x-qn-nonce": "nonce", "x-qn-timestamp": "123",
      "x-qn-signature": signature, "content-type": "application/json" } });
  const signature = createHmac("sha256", "local-stream-test").update("nonce123" + body).digest("hex");
  try {
    expect((await send("0".repeat(64))).status).toBe(401);
    for (const invalid of [
      JSON.stringify({ network: "wrong-network", start: 123, end: 124, logs: [] }),
      JSON.stringify({ network: "arc-testnet", start: 124, end: 123, logs: [] }),
      "{invalid-json",
    ]) {
      const signed = createHmac("sha256", "local-stream-test").update("nonce123" + invalid).digest("hex");
      expect((await send(signed, invalid)).status).toBe(400);
    }
    expect((await send(signature)).status).toBe(200);
    expect((await send(signature)).status).toBe(200);
    const rows = await db.select().from(streamBatches).where(eq(streamBatches.startBlock, 123n));
    expect(rows).toHaveLength(1);
  } finally {
    await db.delete(streamBatches).where(eq(streamBatches.startBlock, 123n));
    await client.end();
    if (prior === undefined) delete process.env.QUICKNODE_STREAM_SECURITY_TOKEN;
    else process.env.QUICKNODE_STREAM_SECURITY_TOKEN = prior;
  }
});
