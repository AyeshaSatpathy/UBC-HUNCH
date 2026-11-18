import { initTRPC, TRPCError } from "@trpc/server";
import { asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "./db";
import { campuses, notes, sessions } from "./schema";
import { beginVerification, finishVerification, getSession, schoolEmail } from "./auth/accounts";
import { getMarket, listMarkets, portfolio, previewClaim, quoteMarket } from "./arc/market-api";
import { claimStatus, submitClaim } from "./arc/claims";
import { advanceStudentOperation, pendingStudentOperations, startStudentOperation } from "./arc/student-operations";
import { activity, leaderboard } from "./activity";

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
export const appRouter = t.router({
  activity: t.procedure.input(z.object({ campusId: campusId.optional() }))
    .query(({ ctx, input }) => activity(ctx.db, input.campusId)),
  leaderboard: t.procedure.input(z.object({ campusId: campusId.optional() }))
    .query(({ ctx, input }) => leaderboard(ctx.db, input.campusId)),
  auth: t.router({
    requestCode: t.procedure.input(z.object({ email: schoolEmail, campusId: campusId.optional() }))
      .mutation(({ ctx, input }) => beginVerification(ctx.db, input.email, ctx.requester, undefined, input.campusId)),
    verifyCode: t.procedure.input(z.object({ challengeId: z.uuid(), code: z.string().regex(/^\d{6}$/) }))
      .mutation(({ ctx, input }) => finishVerification(ctx.db, input.challengeId, input.code)),
    me: signedIn.query(({ ctx }) => ({
      campusId: ctx.session.account.unitid,
      state: ctx.session.account.fundedAt ? "ready" as const : "pending" as const,
    })),
    signOut: signedIn.mutation(async ({ ctx }) => {
      await ctx.db.delete(sessions).where(eq(sessions.tokenHash, ctx.session.tokenHash));
      return { signedOut: true as const };
    }),
  }),
  markets: t.router({
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
      requestKey, question: text, source: text, yesRule: text, noRule: text,
      close: z.number().int().positive(), deadline: z.number().int().positive(),
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
  notes: t.router({
    list: t.procedure.query(({ ctx }) =>
      ctx.db
        .select()
        .from(notes)
        .orderBy(desc(notes.createdAt), desc(notes.id))
        .limit(50),
    ),
    create: t.procedure
      .input(z.object({ text: z.string().trim().min(1).max(500) }))
      .mutation(async ({ ctx, input }) => {
        const [note] = await ctx.db.insert(notes).values(input).returning();
        return note;
      }),
  }),
});
export type AppRouter = typeof appRouter;
