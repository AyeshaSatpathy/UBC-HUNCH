import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { csrf } from "hono/csrf";
import { html } from "hono/html";
import { z } from "zod";
import { chainId, market } from "./arc/contract";
import { startStudentOperation } from "./arc/student-operations";
import { marketGemini } from "./gemini";
import { beginVerification, finishVerification, getSession, schoolEmail } from "./auth/accounts";
import type { Database } from "./db";
import { accounts, arcMarkets, emailChallenges, sessions, studentOperations } from "./schema";

const cookie = "hunch_reviewer";
const cookieScope = { path: "/reviewer", httpOnly: true, sameSite: "Strict" as const };
const resolution = z.object({
  marketId: z.string().refine(id => /^[1-9]\d{0,77}$/.test(id) && BigInt(id) < 2n ** 256n),
  requestKey: z.uuid(),
  side: z.enum(["YES", "NO"]),
  reference: z.string().trim().min(1).max(500),
});

function page(content: ReturnType<typeof html>) {
  return html`<!doctype html><html lang="en"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1"><title>Hunch Reviewer Console</title>
    <style>
      body{background:#141414;color:#fff4e2;font:16px/1.55 system-ui;margin:0}
      main{max-width:46rem;margin:auto;padding:clamp(1rem,4vw,2.5rem)}
      h1,h2,p{margin:0 0 .85rem}h1{font-size:2rem}h2{font-size:1.25rem}
      article{border:1px solid #504c45;border-radius:1rem;padding:1.15rem;margin:1rem 0;overflow-wrap:anywhere}
      form{display:grid;gap:.65rem;margin:1rem 0}label{font-weight:600}
      input,button,select{box-sizing:border-box;min-height:44px;border-radius:.55rem;font:inherit;padding:.55rem .8rem}
      input,select{background:#242424;border:1px solid #81796e;color:inherit;width:100%}
      button{background:#dcff3e;color:#141414;font-weight:700;border:0;cursor:pointer}
      a{display:inline-flex;min-height:44px;align-items:center;color:#dcff3e}
      [role="alert"]{color:#ffb4a9}
    </style></head><body><main><h1>Reviewer Console</h1>${content}</main></body></html>`;
}

const signIn = (message = "") => page(html`
  <p>Sign in with your approved school email.</p>
  ${message && html`<p role="alert">${message}</p>`}
  <form method="post" action="/reviewer/sign-in">
    <label for="email">School email</label><input id="email" name="email" type="email" autocomplete="email" required>
    <button>Send code</button>
  </form>`);

const codeEntry = (challengeId: string, message = "") => page(html`
  <p>If your account is eligible, you’ll receive a six-digit code.</p>
  ${message && html`<p role="alert">${message}</p>`}
  <form method="post" action="/reviewer/verify">
    <input type="hidden" name="challengeId" value="${challengeId}">
    <label for="code">Verification code</label><input id="code" name="code" inputmode="numeric" autocomplete="one-time-code"
      maxlength="6" pattern="[0-9]{6}" required>
    <button>Verify code</button>
  </form><a href="/reviewer/sign-in">Start again</a>`);

function dateLabel(timestamp: string) {
  const date = new Date(Number(timestamp) * 1_000);
  return Number.isFinite(date.getTime()) ? date.toISOString().replace("T", " ").replace(".000Z", " UTC") : "Unavailable";
}

export function reviewerRoutes(db: Database, requestIp?: (request: Request) => string | undefined) {
  const routes = new Hono();
  const sessionOf = (token?: string) => token ? getSession(db, "Bearer " + token) : null;
  routes.use("*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    c.header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
    c.header("Referrer-Policy", "no-referrer");
    await next();
  });
  routes.use("*", csrf());
  routes.get("/sign-in", c => c.html(signIn()));
  routes.post("/sign-in", async (c) => {
    const email = schoolEmail.safeParse((await c.req.parseBody()).email);
    if (!email.success) return c.html(signIn("Enter your school email."), 400);
    const [reviewer] = await db.select({ id: accounts.id }).from(accounts)
      .where(and(eq(accounts.email, email.data), eq(accounts.isReviewer, true)));
    try {
      const challenge = reviewer
        ? await beginVerification(db, email.data, requestIp?.(c.req.raw) ?? "unknown")
        : { challengeId: randomUUID() };
      return c.html(codeEntry(challenge.challengeId));
    } catch (error) {
      const message = error instanceof TRPCError && error.code === "TOO_MANY_REQUESTS"
        ? "Please wait before requesting another code." : "Could not send a code. Try again shortly.";
      return c.html(signIn(message), 400);
    }
  });
  routes.post("/verify", async (c) => {
    const input = z.object({ challengeId: z.uuid(), code: z.string().regex(/^\d{6}$/) }).safeParse(await c.req.parseBody());
    if (!input.success) return c.html(signIn("Start again to request a verification code."), 400);
    const [eligible] = await db.select({ id: accounts.id }).from(emailChallenges)
      .innerJoin(accounts, eq(accounts.email, emailChallenges.email))
      .where(and(eq(emailChallenges.id, input.data.challengeId), eq(accounts.isReviewer, true)));
    if (!eligible) return c.html(codeEntry(input.data.challengeId, "The code is invalid or expired."), 400);
    try {
      const { token } = await finishVerification(db, input.data.challengeId, input.data.code);
      const session = await sessionOf(token);
      if (!session?.account.isReviewer) {
        if (session) await db.delete(sessions).where(eq(sessions.tokenHash, session.tokenHash));
        return c.html(signIn("Reviewer access is required."), 403);
      }
      setCookie(c, cookie, token, { ...cookieScope, maxAge: 8 * 60 * 60,
        secure: new URL(c.req.url).protocol === "https:" || process.env.NODE_ENV === "production" });
      return c.redirect("/reviewer", 303);
    } catch {
      return c.html(codeEntry(input.data.challengeId, "The code is invalid or expired."), 400);
    }
  });
  routes.post("/sign-out", async (c) => {
    const session = await sessionOf(getCookie(c, cookie));
    if (session) await db.delete(sessions).where(eq(sessions.tokenHash, session.tokenHash));
    deleteCookie(c, cookie, cookieScope);
    return c.redirect("/reviewer/sign-in", 303);
  });
  routes.get("/", async (c) => {
    const session = await sessionOf(getCookie(c, cookie));
    if (!session) return c.redirect("/reviewer/sign-in");
    if (!session.account.isReviewer) return c.html(signIn("Reviewer access is required."), 403);
    const address = session.account.wallet;
    const [assigned, operations] = await Promise.all([
      address ? db.select().from(arcMarkets).where(and(eq(arcMarkets.chainId, chainId),
        eq(arcMarkets.contract, market), eq(arcMarkets.reviewer, address.toLowerCase())))
        .orderBy(desc(arcMarkets.marketId)) : [],
      db.select().from(studentOperations).where(and(eq(studentOperations.accountId, session.account.id),
        sql`${studentOperations.input}->>'kind' = 'resolve'`)).orderBy(desc(studentOperations.createdAt)),
    ]);
    const now = BigInt(Math.floor(Date.now() / 1_000));
    const status = (row: typeof arcMarkets.$inferSelect) => ["Awaiting funding", "Trading open", "YES settled", "NO settled", "Voided"][row.status];
    const geminiStatus = new Map<string, { outcome: "YES" | "NO" | null; status: string; ticker: string; contractId: string } | null>(await Promise.all(assigned.map(async row => {
      try { return [row.marketId, await marketGemini(db, row.marketId)] as const; }
      catch { return [row.marketId, { outcome: null, status: "Unavailable", ticker: "Pinned Gemini contract", contractId: "" }] as const; }
    })));
    return c.html(page(html`
      <p>Assigned markets</p><a href="/reviewer">Refresh statuses</a>
      ${!assigned.length && html`<p>No markets assigned.</p>`}
      ${assigned.map(row => {
        const last = operations.find(op => op.input.kind === "resolve" && op.input.marketId === row.marketId);
        const gemini = geminiStatus.get(row.marketId);
        const canSubmit = row.status === 1 && now >= BigInt(row.closesAt) && now < BigInt(row.evidenceDeadline) &&
          !!session.account.fundedAt && last?.stage !== "submit" && last?.stage !== "confirmed" && (!gemini || !!gemini.outcome);
        return html`<article>
          <h2>${row.question}</h2><p><strong>Source</strong> ${row.source}</p>
          <p><strong>Evidence deadline</strong> ${dateLabel(row.evidenceDeadline)}</p>
          ${gemini && html`<p><strong>Gemini</strong> ${gemini.ticker} · ${gemini.contractId} · ${gemini.outcome ? "Settled " + gemini.outcome : gemini.status + " — submission blocked"}</p>`}
          <p>${row.status === 1 && now >= BigInt(row.closesAt) ? (now >= BigInt(row.evidenceDeadline) ? "Deadline passed" : "Ready for review") : status(row)}</p>
          ${last?.input.kind === "resolve" && html`<p>${last.stage === "confirmed" ? "Resolution confirmed" :
            last.stage === "failed" ? "Resolution failed" : "Resolution queued"} · ${last.input.side} · ${last.input.reference}</p>`}
          ${canSubmit && html`<form method="post" action="/reviewer/resolve">
            <input type="hidden" name="marketId" value="${row.marketId}"><input type="hidden" name="requestKey" value="${randomUUID()}">
            <label for="side-${row.marketId}">Outcome</label>
            <select id="side-${row.marketId}" name="side" required>
              ${gemini?.outcome ? html`<option>${gemini.outcome}</option>` : html`<option value="">Choose YES or NO</option><option>YES</option><option>NO</option>`}
            </select>
            <label for="reference-${row.marketId}">Public evidence reference</label>
            <input id="reference-${row.marketId}" name="reference" maxlength="500" required>
            <button>Submit resolution</button>
          </form>`}
        </article>`;
      })}
      <form method="post" action="/reviewer/sign-out"><button>Sign out</button></form>`));
  });
  routes.post("/resolve", async (c) => {
    const session = await sessionOf(getCookie(c, cookie));
    if (!session?.account.isReviewer || !session.account.wallet) return c.html(signIn("Reviewer access is required."), 403);
    const input = resolution.safeParse(await c.req.parseBody());
    const message = (text: string) => page(html`<p role="alert">${text}</p><a href="/reviewer">Back to assigned markets</a>`);
    if (!input.success) return c.html(message("Choose YES or NO and enter a public evidence reference."), 400);
    const { requestKey, marketId, side, reference } = input.data;
    const [assigned] = await db.select({ id: arcMarkets.marketId }).from(arcMarkets).where(and(eq(arcMarkets.chainId, chainId),
      eq(arcMarkets.contract, market), eq(arcMarkets.marketId, marketId), eq(arcMarkets.reviewer, session.account.wallet.toLowerCase())));
    if (!assigned) return c.html(message("This market is not assigned to your account."), 403);
    try {
      await startStudentOperation(db, session.account, requestKey, { kind: "resolve", marketId, side, reference });
      return c.redirect("/reviewer", 303);
    } catch (error) {
      return c.html(message(error instanceof TRPCError ? error.message : "Could not queue the resolution. Try again shortly."), 400);
    }
  });
  return routes;
}
