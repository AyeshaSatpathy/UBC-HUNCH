import { Hono } from "hono";
import { cors } from "hono/cors";
import { bodyLimit } from "hono/body-limit";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { sql } from "drizzle-orm";
import { appRouter } from "./router";
import type { Database } from "./db";
import { reviewerRoutes } from "./reviewer";
import { streamRoutes } from "./streams";
import { finishGoogleCallback } from './auth/google';
export function createApp(db: Database, origins: string[], requestIp?: (request: Request) => string | undefined) {
  const app = new Hono();
  app.route("/reviewer", reviewerRoutes(db, requestIp));
  app.route("/webhooks/quicknode", streamRoutes(db));
  app.get('/auth/google/callback', async c => {
    c.header('Cache-Control', 'no-store');
    c.header('Referrer-Policy', 'no-referrer');
    try {
      await finishGoogleCallback(db, c.req.query('state') ?? '', c.req.query('code'), c.req.query('error') === 'access_denied');
      return c.html('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Return to Hunch</title><body style="background:#0d0d0e;color:#fff4e2;font:18px system-ui;padding:32px"><h1>Return to Hunch</h1><p>Close this tab and return to Hunch to finish.</p></body></html>');
    } catch { return c.text('Google sign-in could not finish. Return to Hunch and try again.', 503); }
  });
  app.use("/trpc/*", cors({ origin: origins }));
  app.use("/trpc/*", bodyLimit({ maxSize: 1_000_000 }));
  app.get("/health", (c) => c.json({ status: "ok" }));
  app.get("/ready", async (c) => {
    try {
      await db.execute(sql`select 1`);
      return c.json({ status: "ready" });
    } catch {
      return c.json({ status: "unavailable" }, 503);
    }
  });
  app.all("/trpc/*", (c) =>
    fetchRequestHandler({
      endpoint: "/trpc",
      req: c.req.raw,
      router: appRouter,
      createContext: () => ({
        db,
        authorization: c.req.header("authorization"),
        requester: requestIp?.(c.req.raw) ?? "unknown",
      }),
    }),
  );
  return app;
}
