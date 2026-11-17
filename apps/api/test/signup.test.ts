import { expect, test } from "bun:test";
import { randomBytes, randomUUID } from "node:crypto";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import { eq } from "drizzle-orm";
import { createApp } from "../src/app";
import { beginVerification } from "../src/auth/accounts";
import { connectDatabase } from "../src/db";
import type { AppRouter } from "../src/router";
import { accounts, emailChallenges, sessions, studentOperations } from "../src/schema";

test("school code verification is single-use, rate limited, and reuses the same account", async () => {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Set DATABASE_URL to a migrated and seeded test database");
  const originalSecret = process.env.AUTH_CODE_SECRET;
  process.env.AUTH_CODE_SECRET = randomBytes(32).toString("hex");
  const { db, client } = connectDatabase(url);
  const server = Bun.serve({ port: 0, fetch: createApp(db, []).fetch });
  const email = `${randomUUID()}@utexas.edu`;
  const requester = randomUUID();
  let code = "";
  let token = "";
  const api = createTRPCClient<AppRouter>({
    links: [httpBatchLink({
      url: `${server.url}trpc`,
      headers: () => token ? { authorization: `Bearer ${token}` } : {},
    })],
  });
  const mail = async (to: string, value: string) => {
    expect(to).toBe(email);
    code = value;
    return "local-test";
  };
  const issue = () => beginVerification(db, email, requester, mail);
  const ignoreCooldown = (id: string) => db.update(emailChallenges)
    .set({ issuedAt: new Date(Date.now() - 61_000) }).where(eq(emailChallenges.id, id));
  try {
    await expect(api.portfolio.get.query()).rejects.toThrow("UNAUTHORIZED");
    await expect(beginVerification(db, "test@invalid-domain.edu", requester, mail)).rejects.toThrow("not supported");
    const first = await issue();
    expect(code).toMatch(/^\d{6}$/);
    expect(first.expiresInSeconds).toBe(600);
    const [saved] = await db.select().from(emailChallenges).where(eq(emailChallenges.id, first.challengeId));
    expect(saved.codeHash).toMatch(/^[a-f0-9]{64}$/);
    expect(saved.codeHash).not.toBe(code);
    await expect(issue()).rejects.toThrow("Please wait");
    const firstToken = await api.auth.verifyCode.mutate({ challengeId: first.challengeId, code });
    token = firstToken.token;
    expect(await api.auth.me.query()).toEqual({ campusId: 228778, state: "pending" });
    expect(await api.portfolio.get.query()).toEqual({ state: "pending", balanceCents: null, positions: [] });
    await expect(api.auth.verifyCode.mutate({ challengeId: first.challengeId, code })).rejects.toThrow("invalid or expired");

    await ignoreCooldown(first.challengeId);
    const second = await issue();
    const outcomes = await Promise.allSettled([
      api.auth.verifyCode.mutate({ challengeId: second.challengeId, code }),
      api.auth.verifyCode.mutate({ challengeId: second.challengeId, code }),
    ]);
    expect(outcomes.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(await db.select().from(accounts).where(eq(accounts.email, email))).toHaveLength(1);

    await ignoreCooldown(second.challengeId);
    const third = await issue();
    const wrongCode = code === "000000" ? "111111" : "000000";
    for (let tries = 0; tries < 5; tries++) {
      await expect(api.auth.verifyCode.mutate({ challengeId: third.challengeId, code: wrongCode })).rejects.toThrow("invalid or expired");
    }
    await expect(api.auth.verifyCode.mutate({ challengeId: third.challengeId, code })).rejects.toThrow("invalid or expired");

    await ignoreCooldown(third.challengeId);
    const fourth = await issue();
    await db.update(emailChallenges).set({ expiresAt: new Date(0) }).where(eq(emailChallenges.id, fourth.challengeId));
    await expect(api.auth.verifyCode.mutate({ challengeId: fourth.challengeId, code })).rejects.toThrow("invalid or expired");
    const now = Math.floor(Date.now() / 1000);
    const draft = { requestKey: randomUUID(), question: "Will the library reopen?", source: "Library announcement",
      yesRule: "Library reopens", noRule: "Library remains closed", close: now + 60, deadline: now + 120 };
    await expect(api.markets.create.mutate(draft)).rejects.toThrow("still being set up");
    await db.update(accounts).set({
      wallet: "0x" + requester.replaceAll("-", "") + "00000000",
      circleWalletId: requester, fundedAt: new Date(),
    }).where(eq(accounts.email, email));
    const [one, retry] = await Promise.all([api.markets.create.mutate(draft), api.markets.create.mutate(draft)]);
    expect(retry).toEqual(one);
    expect(await api.actions.pending.query()).toEqual([one]);
    await expect(api.markets.create.mutate({ ...draft, requestKey: randomUUID() })).rejects.toThrow("already have an action");
    await expect(api.markets.create.mutate({ ...draft, question: "Different question?" })).rejects.toThrow("already used");
    await api.auth.signOut.mutate();
    await expect(api.auth.me.query()).rejects.toThrow("UNAUTHORIZED");
  } finally {
    const [account] = await db.select().from(accounts).where(eq(accounts.email, email));
    if (account) {
      await db.delete(studentOperations).where(eq(studentOperations.accountId, account.id));
      await db.delete(sessions).where(eq(sessions.accountId, account.id));
    }
    await db.delete(accounts).where(eq(accounts.email, email));
    await db.delete(emailChallenges).where(eq(emailChallenges.email, email));
    await server.stop(true);
    await client.end();
    if (originalSecret === undefined) delete process.env.AUTH_CODE_SECRET;
    else process.env.AUTH_CODE_SECRET = originalSecret;
  }
});
