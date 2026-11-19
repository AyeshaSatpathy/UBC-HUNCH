import { sql } from "drizzle-orm";
import { bigint, boolean, customType, index, integer, jsonb, numeric, pgTable, primaryKey, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" });

export const campuses = pgTable("campuses", {
  unitid: integer("unitid").primaryKey(),
  name: text("name").notNull(),
  aliases: text("aliases").notNull(),
  city: text("city").notNull(),
  state: text("state").notNull(),
  searchDocument: tsvector("search_document").generatedAlwaysAs(
    sql`to_tsvector('simple', name || ' ' || aliases || ' ' || city || ' ' || state)`,
  ),
}, (table) => [index("campuses_search_idx").using("gin", table.searchDocument)]);

export const campusEmailDomains = pgTable("campus_email_domains", {
  domain: text("domain").primaryKey(),
  unitid: integer("unitid").notNull().references(() => campuses.unitid),
}, (table) => [index("campus_email_domains_unitid_idx").on(table.unitid)]);

const date = (name: string) => timestamp(name, { withTimezone: true });

export const accounts = pgTable("accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  unitid: integer("unitid").notNull().references(() => campuses.unitid),
  verifiedAt: date("verified_at").notNull(),
  displayName: text("display_name"),
  passwordHash: text("password_hash"),
  hasSeenGuide: boolean("has_seen_guide").notNull().default(false),
  isReviewer: boolean("is_reviewer").notNull().default(false),
  wallet: text("wallet").unique(),
  circleWalletId: text("circle_wallet_id").unique(),
  registeredAt: date("registered_at"),
  registrationTx: text("registration_tx"),
  fundedAt: date("funded_at"),
  fundingId: text("funding_id"),
  fundingAttempt: integer("funding_attempt").notNull().default(1),
  creditCents: integer("credit_cents").notNull(),
});

export const loginAttempts = pgTable("login_attempts", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull(),
  requester: text("requester").notNull(),
  issuedAt: date("issued_at").notNull().defaultNow(),
}, (table) => [
  index("login_attempts_email_issued_idx").on(table.email, table.issuedAt),
  index("login_attempts_requester_issued_idx").on(table.requester, table.issuedAt),
]);

export const emailChallenges = pgTable("email_challenges", {
  id: uuid("id").primaryKey(),
  email: text("email").notNull(),
  requester: text("requester").notNull(),
  unitid: integer("unitid").notNull().references(() => campuses.unitid),
  codeHash: text("code_hash").notNull(),
  intent: text("intent").notNull().default("legacy"),
  attempts: integer("attempts").notNull().default(0),
  issuedAt: date("issued_at").notNull(),
  expiresAt: date("expires_at").notNull(),
  consumedAt: date("consumed_at"),
}, (table) => [
  index("email_challenges_email_issued_idx").on(table.email, table.issuedAt),
  index("email_challenges_requester_issued_idx").on(table.requester, table.issuedAt),
  index("email_challenges_issued_idx").on(table.issuedAt),
]);

export const sessions = pgTable("sessions", {
  tokenHash: text("token_hash").primaryKey(),
  accountId: uuid("account_id").notNull().references(() => accounts.id),
  expiresAt: date("expires_at").notNull(),
});

export const savedMarkets = pgTable("saved_markets", {
  accountId: uuid("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  marketId: numeric("market_id", { precision: 78, scale: 0 }).notNull(),
  createdAt: date("created_at").notNull().defaultNow(),
}, table => [primaryKey({ columns: [table.accountId, table.marketId] })]);

export const claimRequests = pgTable("claim_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  accountId: uuid("account_id").notNull().references(() => accounts.id),
  marketId: numeric("market_id", { precision: 78, scale: 0 }).notNull(),
  attempt: integer("attempt").notNull(),
  circleId: text("circle_id").unique(),
}, (table) => [index("claim_requests_account_market_idx").on(table.accountId, table.marketId)]);

export type StudentOperationInput =
  | { kind: "buy"; marketId: string; side: "YES" | "NO"; cents: number; shares: string }
  | { kind: "predict"; marketId: string; side: "YES" | "NO" }
  | { kind: "resolve"; marketId: string; side: "YES" | "NO"; reference: string }
  | { kind: "create"; question: string; source: string; yesRule: string; noRule: string; close: number; deadline: number;
      gemini?: { eventTicker: string; contractId: string; ticker: string; fingerprint: string } };

export const studentOperations = pgTable("student_operations", {
  id: uuid("id").primaryKey().defaultRandom(),
  accountId: uuid("account_id").notNull().references(() => accounts.id),
  requestKey: text("request_key").notNull(),
  input: jsonb("input").$type<StudentOperationInput>().notNull(),
  stage: text("stage").$type<"approval" | "submit" | "confirmed" | "failed">().notNull(),
  circleId: text("circle_id"),
  resultMarketId: text("result_market_id"),
  createdAt: date("created_at").notNull().defaultNow(),
}, (table) => [index("student_operations_account_idx").on(table.accountId, table.createdAt)]);

const block = (name: string) => bigint(name, { mode: "bigint" });
const units = (name: string) => numeric(name, { precision: 78, scale: 0 });

export const geminiLinks = pgTable("gemini_links", {
  marketId: units("market_id").primaryKey(),
  eventTicker: text("event_ticker").notNull(),
  contractId: text("contract_id").notNull(),
  ticker: text("ticker").notNull(),
  fingerprint: text("fingerprint").notNull(),
});

export const geminiOdds = pgTable("gemini_odds", {
  contractId: text("contract_id").notNull(),
  at: date("at").notNull(),
  yes: integer("yes").notNull(),
}, (table) => [primaryKey({ columns: [table.contractId, table.at] })]);

export const streamBatches = pgTable("stream_batches", {
  digest: text("digest").primaryKey(),
  startBlock: block("start_block").notNull(),
  endBlock: block("end_block").notNull(),
  logs: jsonb("logs").$type<Record<string, unknown>[]>().notNull(),
  receivedAt: date("received_at").notNull().defaultNow(),
});

export const autoFunding = pgTable("auto_funding", {
  chainId: integer("chain_id").notNull(),
  contract: text("contract").notNull(),
  marketId: units("market_id").notNull(),
  allocation: units("allocation").notNull(),
  transactionHash: text("transaction_hash").notNull().unique(),
  signedTransaction: text("signed_transaction").notNull(),
  state: text("state").$type<"prepared" | "funded" | "reverted" | "mismatch">().notNull(),
  receipt: jsonb("receipt").$type<{ block: string; blockHash: string; status: "success" | "reverted"; eventMatched: boolean }>(),
}, (table) => [primaryKey({ columns: [table.chainId, table.contract, table.marketId] })]);

export const arcCursors = pgTable("arc_cursors", {
  chainId: integer("chain_id").notNull(),
  contract: text("contract").notNull(),
  nextBlock: block("next_block").notNull(),
}, (table) => [primaryKey({ columns: [table.chainId, table.contract] })]);

export const arcEvents = pgTable("arc_events", {
  chainId: integer("chain_id").notNull(),
  contract: text("contract").notNull(),
  transactionHash: text("transaction_hash").notNull(),
  logIndex: integer("log_index").notNull(),
  blockNumber: block("block_number").notNull(),
  blockHash: text("block_hash").notNull(),
  name: text("name").notNull(),
  marketId: units("market_id"),
  wallet: text("wallet"),
  args: jsonb("args").$type<Record<string, string | boolean | number>>().notNull(),
}, (table) => [
  primaryKey({ columns: [table.chainId, table.contract, table.transactionHash, table.logIndex] }),
  index("arc_events_market_history_idx").on(table.chainId, table.contract, table.marketId, table.blockNumber, table.logIndex),
  index("arc_events_wallet_history_idx").on(table.chainId, table.contract, table.wallet, table.blockNumber, table.logIndex),
]);

export const arcMarkets = pgTable("arc_markets", {
  chainId: integer("chain_id").notNull(),
  contract: text("contract").notNull(),
  marketId: units("market_id").notNull(),
  campusId: units("campus_id").notNull(),
  creator: text("creator").notNull(),
  reviewer: text("reviewer").notNull(),
  question: text("question").notNull(),
  source: text("source").notNull(),
  yesRule: text("yes_rule").notNull(),
  noRule: text("no_rule").notNull(),
  closesAt: units("closes_at").notNull(),
  evidenceDeadline: units("evidence_deadline").notNull(),
  status: integer("status").notNull(),
  allocation: units("allocation").notNull(),
  sets: units("sets").notNull(),
  yesReserve: units("yes_reserve").notNull(),
  noReserve: units("no_reserve").notNull(),
  fees: units("fees").notNull(),
  remainingClaims: units("remaining_claims").notNull(),
  evidence: text("evidence").notNull(),
  indexedThrough: block("indexed_through").notNull(),
}, (table) => [
  primaryKey({ columns: [table.chainId, table.contract, table.marketId] }),
  index("arc_markets_campus_idx").on(table.chainId, table.contract, table.campusId, table.marketId),
]);

export const arcPositions = pgTable("arc_positions", {
  chainId: integer("chain_id").notNull(),
  contract: text("contract").notNull(),
  marketId: units("market_id").notNull(),
  wallet: text("wallet").notNull(),
  yes: units("yes").notNull(),
  no: units("no").notNull(),
  debit: units("debit").notNull(),
  prediction: integer("prediction").notNull(),
  claimed: boolean("claimed").notNull(),
  indexedThrough: block("indexed_through").notNull(),
}, (table) => [
  primaryKey({ columns: [table.chainId, table.contract, table.marketId, table.wallet] }),
  index("arc_positions_wallet_idx").on(table.chainId, table.contract, table.wallet),
]);
export const notes = pgTable("notes", {
  id: uuid("id").primaryKey().defaultRandom(),
  text: varchar("text", { length: 500 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
    .defaultNow()
    .notNull(),
});
