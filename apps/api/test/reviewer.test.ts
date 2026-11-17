import { expect, test } from "bun:test";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { createApp } from "../src/app";
import { chainId, market } from "../src/arc/contract";
import { connectDatabase } from "../src/db";
import { accounts, arcMarkets, sessions } from "../src/schema";

test("reviewer console gates access, restricts assignments, and requires a reference", async () => {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Set DATABASE_URL to a migrated and seeded test database");
  const { db, client } = connectDatabase(url);
  const app = createApp(db, []);
  const ids = [randomUUID(), randomUUID()];
  const addresses = ids.map(id => "0x" + id.replaceAll("-", "") + "00000000");
  const tokens = ids.map(() => randomBytes(32).toString("base64url"));
  const marketIds = ids.map(id => BigInt("0x" + id.replaceAll("-", "")).toString());
  const now = Math.floor(Date.now() / 1000);
  const origin = "http://localhost";
  const cookie = (index: number) => "hunch_reviewer=" + tokens[index];
  const open = (index: number) => app.request(origin + "/reviewer", { headers: { cookie: cookie(index) } });
  const submit = (index: number, marketId: string, reference: string, from = origin) => app.request(origin + "/reviewer/resolve", {
    method: "POST", headers: { cookie: cookie(index), origin: from },
    body: new URLSearchParams({ marketId, side: "YES", requestKey: randomUUID(), reference }),
  });
  try {
    await db.insert(accounts).values(ids.map((id, i) => ({
      id, email: id + "@utexas.edu", unitid: 228778, verifiedAt: new Date(), fundedAt: new Date(),
      isReviewer: i === 0, wallet: addresses[i], creditCents: 1000,
    })));
    await db.insert(sessions).values(ids.map((id, i) => ({
      accountId: id, tokenHash: createHash("sha256").update(tokens[i]).digest("hex"), expiresAt: new Date(Date.now() + 60_000),
    })));
    await db.insert(arcMarkets).values(ids.map((_, i) => ({
      chainId, contract: market, marketId: marketIds[i], campusId: "228778", creator: "0x0", reviewer: addresses[i],
      question: i === 0 ? "Assigned question" : "Other question",
      source: "Official <source>", yesRule: "Yes", noRule: "No", closesAt: String(now - 60),
      evidenceDeadline: String(now + 60), status: 1, allocation: "20000000", sets: "20000000",
      yesReserve: "20000000", noReserve: "20000000", fees: "0", remainingClaims: "0",
      evidence: "0x0", indexedThrough: 1n,
    })));
    expect((await app.request(origin + "/reviewer")).headers.get("location")).toBe("/reviewer/sign-in");
    expect((await open(1)).status).toBe(403);
    const allowed = await open(0);
    expect(allowed.status).toBe(200);
    const body = await allowed.text();
    for (const text of ["Reviewer Console", "Assigned question", "Official &lt;source&gt;", "Evidence deadline", "Submit resolution"]) {
      expect(body).toContain(text);
    }
    expect(body).not.toContain("Other question");
    expect((await submit(1, marketIds[1], "Source item 1")).status).toBe(403);
    expect((await submit(0, marketIds[1], "Source item 1")).status).toBe(403);
    expect((await submit(0, marketIds[0], " ")).status).toBe(400);
    expect((await submit(0, marketIds[0], "Source item 1", "https://different.example")).status).toBe(403);
  } finally {
    await db.delete(arcMarkets).where(inArray(arcMarkets.marketId, marketIds));
    await db.delete(sessions).where(inArray(sessions.accountId, ids));
    await db.delete(accounts).where(inArray(accounts.id, ids));
    await client.end();
  }
});
