import { initTRPC } from "@trpc/server";
import { desc } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "./db";
import { notes } from "./schema";
const t = initTRPC.context<{ db: Database }>().create();
export const appRouter = t.router({
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
