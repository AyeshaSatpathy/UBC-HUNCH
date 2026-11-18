import { connectDatabase } from "./db";
import { marketGemini } from "./gemini";
import { geminiLinks } from "./schema";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const { db, client } = connectDatabase(process.env.DATABASE_URL);
const follow = process.argv.includes("--follow");
let stopped = false;
process.once("SIGINT", () => { stopped = true; });
process.once("SIGTERM", () => { stopped = true; });
try {
  do {
    const links = await db.select({ id: geminiLinks.marketId }).from(geminiLinks);
    for (const { id } of links) {
      if (stopped) break;
      try { await marketGemini(db, id); }
      catch { console.warn("Gemini observation unavailable", id); }
    }
    if (follow && !stopped) await Bun.sleep(30_000);
  } while (follow && !stopped);
} finally { await client.end(); }
