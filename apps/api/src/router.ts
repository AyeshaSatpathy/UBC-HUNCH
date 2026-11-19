import { initTRPC, TRPCError } from "@trpc/server";
import { and, asc, desc, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "./db";
import { accounts, campuses, savedMarkets, sessions } from "./schema";
import { beginVerification, confirmCampusChange, finishVerification, getSession, passwordLogin, schoolEmail } from "./auth/accounts";
import { claimGoogleSignIn, startGoogleSignIn } from './auth/google';
import { depositHistory, depositStatus, submitDeposit, testDepositsEnabled } from './arc/deposits';
import { getMarket, listMarkets, listSavedMarkets, portfolio, previewClaim, quoteMarket } from "./arc/market-api";
import { claimStatus, submitClaim } from "./arc/claims";
import { advanceStudentOperation, pendingStudentOperations, startStudentOperation } from "./arc/student-operations";
import { activity, leaderboard } from "./activity";
import { marketGemini, searchGemini } from "./gemini";

const t = initTRPC.context<{ db: Database; authorization?: string; requester: string }>().create();
const signedIn = t.procedure.use(async ({ ctx, next }) => {
  const session = await getSession(ctx.db, ctx.authorization);
  if (!session) throw new TRPCError({ code: "UNAUTHORIZED" });
  return next({ ctx: { session } });
});
const marketId = z.string().refine((id) => /^[1-9]\d{0,77}$/.test(id) && BigInt(id) < 2n ** 256n);
const campusId = z.number().int().positive().max(2_147_483_647);
const marketInput = z.object({ marketId });
const side = z.enum(["YES", "NO"]);
const cents = z.number().int().positive().max(1_000_000_000);
const requestKey = z.string().regex(/^[\w-]{12,80}$/);
const text = z.string().trim().min(1).max(500);
const pin = z.object({ eventTicker: z.string().min(1).max(150), contractId: z.string().min(1).max(150),
  ticker: z.string().min(1).max(150), fingerprint: z.string().regex(/^[a-f0-9]{64}$/) });
export const appRouter = t.router({
  gemini: t.router({
    search: t.procedure.input(z.object({ query: z.string().trim().min(2).max(120) }))
      .query(({ input }) => searchGemini(input.query)),
    market: t.procedure.input(marketInput).query(async ({ ctx, input }) => {
      await getMarket(ctx.db, input.marketId);
      try { return await marketGemini(ctx.db, input.marketId); }
      catch { throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Gemini odds are temporarily unavailable." }); }
    }),
  }),
  activity: t.procedure.input(z.object({ campusId: campusId.optional() }))
    .query(({ ctx, input }) => activity(ctx.db, input.campusId)),
  leaderboard: t.procedure.input(z.object({ campusId: campusId.optional() }))
    .query(({ ctx, input }) => leaderboard(ctx.db, input.campusId)),
  auth: t.router({
    googleStart: t.procedure.input(z.object({ intent: z.enum(['login', 'signup']) }))
      .mutation(({ ctx, input }) => startGoogleSignIn(ctx.db, input.intent, ctx.requester)),
    googleStatus: t.procedure.input(z.object({ id: z.uuid(), proof: z.string().regex(/^[\w-]{43}$/) }))
      .mutation(({ ctx, input }) => claimGoogleSignIn(ctx.db, input.id, input.proof)),
    settings: signedIn.query(({ ctx }) => ({
      email: ctx.session.account.email,
      hasPassword: !!ctx.session.account.passwordHash,
      pendingCampusId: ctx.session.account.pendingCampusId,
      notificationsEnabled: ctx.session.account.notificationsEnabled,
    })),
    setNotifications: signedIn.input(z.object({ enabled: z.boolean() })).mutation(async ({ ctx, input }) => {
      await ctx.db.update(accounts).set({ notificationsEnabled: input.enabled }).where(eq(accounts.id, ctx.session.account.id));
      return input;
    }),
    requestCampusChange: signedIn.input(z.object({ email: schoolEmail })).mutation(({ ctx, input }) => {
      const account = ctx.session.account;
      if (!account.fundedAt || !account.wallet || account.pendingCampusId || account.isReviewer) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'This campus change is unavailable for your account.' });
      }
      return beginVerification(ctx.db, input.email, ctx.requester, undefined, undefined, `campus:${account.id}`);
    }),
    verifyCampusChange: signedIn.input(z.object({ challengeId: z.uuid(), code: z.string().regex(/^\d{6}$/) }))
      .mutation(({ ctx, input }) => confirmCampusChange(ctx.db, ctx.session.account.id, input.challengeId, input.code)),
    signOutOtherSessions: signedIn.mutation(async ({ ctx }) => {
      const revoked = await ctx.db.delete(sessions).where(and(
        eq(sessions.accountId, ctx.session.account.id),
        ne(sessions.tokenHash, ctx.session.tokenHash),
      )).returning({ accountId: sessions.accountId });
      return { revoked: revoked.length };
    }),
    showGuide: signedIn.mutation(async ({ ctx }) => {
      await ctx.db.update(accounts).set({ hasSeenGuide: false }).where(eq(accounts.id, ctx.session.account.id));
      return { shown: true };
    }),
    dismissGuide: signedIn.mutation(async ({ ctx }) => {
      await ctx.db.update(accounts).set({ hasSeenGuide: true }).where(eq(accounts.id, ctx.session.account.id));
      return { dismissed: true };
    }),
    updateName: signedIn.input(z.object({ displayName: z.string().trim().min(1).max(40) }))
      .mutation(async ({ ctx, input }) => {
        await ctx.db.update(accounts).set(input).where(eq(accounts.id, ctx.session.account.id));
        return { displayName: input.displayName };
      }),
    requestCode: t.procedure.input(z.object({ email: schoolEmail, campusId: campusId.optional(), intent: z.enum(['signup', 'reset']).default('signup') }))
      .mutation(({ ctx, input }) => beginVerification(ctx.db, input.email, ctx.requester, undefined, input.campusId, input.intent)),
    login: t.procedure.input(z.object({ email: schoolEmail, password: z.string().min(1).max(128) }))
      .mutation(({ ctx, input }) => passwordLogin(ctx.db, input.email, input.password, ctx.requester)),
    verifyCode: t.procedure.input(z.object({ challengeId: z.uuid(), code: z.string().regex(/^\d{6}$/),
      profile: z.object({ password: z.string().min(12).max(128), displayName: z.string().trim().min(1).max(40).optional() }).optional(),
    }))
      .mutation(({ ctx, input }) => finishVerification(ctx.db, input.challengeId, input.code, input.profile)),
    me: signedIn.query(({ ctx }) => ({
      campusId: ctx.session.account.unitid,
      displayName: ctx.session.account.displayName,
      hasSeenGuide: ctx.session.account.hasSeenGuide,
      state: ctx.session.account.fundedAt ? "ready" as const : "pending" as const,
    })),
    signOut: signedIn.mutation(async ({ ctx }) => {
      await ctx.db.delete(sessions).where(eq(sessions.tokenHash, ctx.session.tokenHash));
      return { signedOut: true as const };
    }),
  }),
  deposits: t.router({
    addCard: signedIn.input(z.object({ card: z.enum(['1111', '0002']) })).mutation(async ({ ctx, input }) => {
      if (!testDepositsEnabled()) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Adding a card is unavailable.' });
      await ctx.db.update(accounts).set({ addedCard: input.card }).where(eq(accounts.id, ctx.session.account.id));
      return input;
    }),
    history: signedIn.query(({ ctx }) => depositHistory(ctx.db, ctx.session.account)),
    status: signedIn.input(z.object({ id: z.uuid() })).query(({ ctx, input }) => depositStatus(ctx.db, ctx.session.account.id, input.id)),
    confirm: signedIn.input(z.object({ requestKey, cents: z.union([z.literal(500), z.literal(1000), z.literal(2500)]), card: z.enum(['4242', '1111', '0002']) }))
      .mutation(({ ctx, input }) => submitDeposit(ctx.db, ctx.session.account, input)),
  }),
  markets: t.router({
    saved: signedIn.query(({ ctx }) => listSavedMarkets(ctx.db, ctx.session.account.id)),
    save: signedIn.input(marketInput.extend({ saved: z.boolean() })).mutation(async ({ ctx, input }) => {
      await getMarket(ctx.db, input.marketId);
      if (input.saved) await ctx.db.insert(savedMarkets).values({ accountId: ctx.session.account.id, marketId: input.marketId }).onConflictDoNothing();
      else await ctx.db.delete(savedMarkets).where(and(eq(savedMarkets.accountId, ctx.session.account.id), eq(savedMarkets.marketId, input.marketId)));
      return { saved: input.saved };
    }),
    list: t.procedure.input(z.object({
      campusId: campusId.optional(), before: marketId.optional(), limit: z.number().int().min(1).max(50).default(20),
    })).query(({ ctx, input }) => listMarkets(ctx.db, input)),
    detail: t.procedure.input(marketInput).query(async ({ ctx, input }) => {
      const session = await getSession(ctx.db, ctx.authorization);
      return getMarket(ctx.db, input.marketId, session?.account.wallet);
    }),
    quote: t.procedure.input(marketInput.extend({
      side, amountCents: cents,
    })).query(async ({ ctx, input }) => {
      await getMarket(ctx.db, input.marketId);
      return quoteMarket(input.marketId, input.side, input.amountCents);
    }),
    buy: signedIn.input(marketInput.extend({ requestKey, side, cents, shares: marketId }))
      .mutation(({ ctx, input: { requestKey, ...input } }) =>
        startStudentOperation(ctx.db, ctx.session.account, requestKey, { kind: "buy", ...input })),
    predict: signedIn.input(marketInput.extend({ requestKey, side }))
      .mutation(({ ctx, input: { requestKey, ...input } }) =>
        startStudentOperation(ctx.db, ctx.session.account, requestKey, { kind: "predict", ...input })),
    create: signedIn.input(z.object({
      requestKey, question: text, source: text, yesRule: z.string().trim().min(1).max(16000), noRule: text,
      close: z.number().int().positive(), deadline: z.number().int().positive(),
      gemini: pin.optional(),
    })).mutation(({ ctx, input: { requestKey, ...input } }) =>
      startStudentOperation(ctx.db, ctx.session.account, requestKey, { kind: "create", ...input })),
  }),
  actions: t.router({
    pending: signedIn.query(({ ctx }) => pendingStudentOperations(ctx.db, ctx.session.account)),
    advance: signedIn.input(z.object({ id: z.uuid() })).mutation(async ({ ctx, input }) => {
      try { return await advanceStudentOperation(ctx.db, ctx.session.account, input.id); }
      catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "This action is still being checked. Try again shortly." });
      }
    }),
  }),
  portfolio: t.router({
    get: signedIn.query(({ ctx }) => portfolio(ctx.db, ctx.session.account)),
  }),
  claims: t.router({
    preview: signedIn.input(marketInput).query(async ({ ctx, input }) => {
      await getMarket(ctx.db, input.marketId);
      return previewClaim(input.marketId, ctx.session.account);
    }),
    submit: signedIn.input(marketInput).mutation(async ({ ctx, input }) => {
      await getMarket(ctx.db, input.marketId);
      return submitClaim(ctx.db, ctx.session.account, input.marketId);
    }),
    status: signedIn.input(z.object({ requestId: z.uuid() }))
      .query(({ ctx, input }) => claimStatus(ctx.db, ctx.session.account, input.requestId)),
  }),
  campuses: t.router({
    search: t.procedure
      .input(z.object({
        query: z.string().trim().min(2).max(120),
        limit: z.number().int().min(1).max(25).default(12),
      }))
      .query(({ ctx, input }) => {
        const { query, limit } = input;
        const directory = ctx.db.select({
          unitid: campuses.unitid,
          name: campuses.name,
          city: campuses.city,
          state: campuses.state,
        }).from(campuses);

        if (/^\d+$/.test(query)) {
          const unitid = Number(query);
          return unitid <= 2_147_483_647 ? directory.where(eq(campuses.unitid, unitid)) : [];
        }

        const terms = query.normalize("NFC").match(/[\p{L}\p{N}]+/gu);
        if (!terms) return [];
        const search = sql`to_tsquery('simple', ${terms.map((term) => term + ":*").join(" & ")})`;
        return directory
          .where(sql`${campuses.searchDocument} @@ ${search}`)
          .orderBy(
            desc(sql`lower(${campuses.name}) = lower(${query})`),
            desc(sql`ts_rank(${campuses.searchDocument}, ${search})`),
            asc(campuses.name),
            asc(campuses.unitid),
          )
          .limit(limit);
      }),
  }),

});
export type AppRouter = typeof appRouter;
