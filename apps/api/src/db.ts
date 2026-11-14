import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
export function connectDatabase(url: string) {
  const client = postgres(url, { max: 10, connect_timeout: 10 });
  return { client, db: drizzle(client) };
}
export type Database = ReturnType<typeof connectDatabase>["db"];
