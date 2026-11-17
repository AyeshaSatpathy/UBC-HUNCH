import { z } from "zod";
import { connectDatabase } from "./db";
import { createApp } from "./app";
const env = z
  .object({
    DATABASE_URL: z.string().url(),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    CORS_ORIGINS: z.string().default("http://localhost:8081"),
  })
  .parse(process.env);
const { db, client } = connectDatabase(env.DATABASE_URL);
const app = createApp(
  db,
  env.CORS_ORIGINS.split(",").map((s) => s.trim()),
  (request) => server.requestIP(request)?.address,
);
const server = Bun.serve({
  hostname: "0.0.0.0",
  port: env.PORT,
  fetch(request): Response | Promise<Response> { return app.fetch(request); },
});
console.log(`API listening on ${server.url}`);
async function shutdown() {
  await server.stop();
  await client.end();
}
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
