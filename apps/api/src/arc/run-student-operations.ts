import { asc, eq, inArray } from "drizzle-orm";
import { connectDatabase } from "../db";
import { accounts, studentOperations } from "../schema";
import { advanceStudentOperation } from "./student-operations";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const { db, client } = connectDatabase(url);
const follow = process.argv.includes("--follow");
let stopping = false;
process.once("SIGINT", () => { stopping = true; });
process.once("SIGTERM", () => { stopping = true; });
try {
  do {
    const pending = await db.select({ id: studentOperations.id, account: accounts }).from(studentOperations)
      .innerJoin(accounts, eq(accounts.id, studentOperations.accountId))
      .where(inArray(studentOperations.stage, ["approval", "submit"]))
      .orderBy(asc(studentOperations.createdAt));
    for (const { id, account } of pending) {
      if (stopping) break;
      try { await advanceStudentOperation(db, account, id, true); }
      catch { console.warn("Student action will be checked again", id); }
    }
    if (follow && !stopping) await Bun.sleep(3_000);
  } while (follow && !stopping);
} finally {
  await client.end();
}
