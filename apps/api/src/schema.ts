import { pgTable, uuid, varchar, timestamp } from "drizzle-orm/pg-core";
export const notes = pgTable("notes", {
  id: uuid("id").primaryKey().defaultRandom(),
  text: varchar("text", { length: 500 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
    .defaultNow()
    .notNull(),
});
