import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { connectDatabase } from "./db";
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const { db, client } = connectDatabase(url);
try {
  await migrate(db, {
    migrationsFolder: fileURLToPath(new URL("../migrations", import.meta.url)),
  });
} finally {
  await client.end();
}
