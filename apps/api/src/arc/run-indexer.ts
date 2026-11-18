import { connectDatabase } from "../db";
import { createArcClient } from "./contract";
import { indexThroughHead } from "./indexer";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const { db, client } = connectDatabase(url);
const rpc = createArcClient();
const follow = process.argv.includes("--follow");
let stopping = false;
process.once("SIGINT", () => { stopping = true; });
process.once("SIGTERM", () => { stopping = true; });

try {
  do {
    const result = await indexThroughHead(db, rpc, () => stopping, process.argv.includes("--streams"));
    if (result.inserted || !follow) {
      console.log(`Indexed ${result.inserted} new events through Arc block ${result.nextBlock - 1n}.`);
    }
    if (follow && !stopping) await Bun.sleep(3_000);
  } while (follow && !stopping);
} finally {
  await client.end();
}
