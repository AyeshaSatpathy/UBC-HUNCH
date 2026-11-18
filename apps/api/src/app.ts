import { Hono } from "hono";
import { cors } from "hono/cors";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { sql } from "drizzle-orm";
import { appRouter } from "./router";
import type { Database } from "./db";
import { reviewerRoutes } from "./reviewer";
import { streamRoutes } from "./streams";
export function createApp(db: Database, origins: string[], requestIp?: (request: Request) => string | undefined) {
  const app = new Hono();
  app.route("/reviewer", reviewerRoutes(db, requestIp));
  app.route("/webhooks/quicknode", streamRoutes(db));
  app.use("/trpc/*", cors({ origin: origins }));
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
