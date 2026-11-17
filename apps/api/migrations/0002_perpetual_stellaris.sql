CREATE TABLE "arc_cursors" (
	"chain_id" integer NOT NULL,
	"contract" text NOT NULL,
	"next_block" bigint NOT NULL,
	CONSTRAINT "arc_cursors_chain_id_contract_pk" PRIMARY KEY("chain_id","contract")
);
--> statement-breakpoint
CREATE TABLE "arc_events" (
	"chain_id" integer NOT NULL,
	"contract" text NOT NULL,
	"transaction_hash" text NOT NULL,
	"log_index" integer NOT NULL,
	"block_number" bigint NOT NULL,
	"block_hash" text NOT NULL,
	"name" text NOT NULL,
	"market_id" numeric(78, 0),
	"wallet" text,
	"args" jsonb NOT NULL,
	CONSTRAINT "arc_events_chain_id_contract_transaction_hash_log_index_pk" PRIMARY KEY("chain_id","contract","transaction_hash","log_index")
);
--> statement-breakpoint
CREATE TABLE "arc_markets" (
	"chain_id" integer NOT NULL,
	"contract" text NOT NULL,
	"market_id" numeric(78, 0) NOT NULL,
	"campus_id" numeric(78, 0) NOT NULL,
	"creator" text NOT NULL,
	"reviewer" text NOT NULL,
	"question" text NOT NULL,
	"source" text NOT NULL,
	"yes_rule" text NOT NULL,
	"no_rule" text NOT NULL,
	"closes_at" numeric(78, 0) NOT NULL,
	"evidence_deadline" numeric(78, 0) NOT NULL,
	"status" integer NOT NULL,
	"allocation" numeric(78, 0) NOT NULL,
	"sets" numeric(78, 0) NOT NULL,
	"yes_reserve" numeric(78, 0) NOT NULL,
	"no_reserve" numeric(78, 0) NOT NULL,
	"fees" numeric(78, 0) NOT NULL,
	"remaining_claims" numeric(78, 0) NOT NULL,
	"evidence" text NOT NULL,
	"indexed_through" bigint NOT NULL,
	CONSTRAINT "arc_markets_chain_id_contract_market_id_pk" PRIMARY KEY("chain_id","contract","market_id")
);
--> statement-breakpoint
CREATE TABLE "arc_positions" (
	"chain_id" integer NOT NULL,
	"contract" text NOT NULL,
	"market_id" numeric(78, 0) NOT NULL,
	"wallet" text NOT NULL,
	"yes" numeric(78, 0) NOT NULL,
	"no" numeric(78, 0) NOT NULL,
	"debit" numeric(78, 0) NOT NULL,
	"prediction" integer NOT NULL,
	"claimed" boolean NOT NULL,
	"indexed_through" bigint NOT NULL,
	CONSTRAINT "arc_positions_chain_id_contract_market_id_wallet_pk" PRIMARY KEY("chain_id","contract","market_id","wallet")
);
--> statement-breakpoint
CREATE TABLE "campus_email_domains" (
	"domain" text PRIMARY KEY NOT NULL,
	"unitid" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "campus_email_domains" ADD CONSTRAINT "campus_email_domains_unitid_campuses_unitid_fk" FOREIGN KEY ("unitid") REFERENCES "public"."campuses"("unitid") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "arc_events_market_history_idx" ON "arc_events" USING btree ("chain_id","contract","market_id","block_number","log_index");--> statement-breakpoint
CREATE INDEX "arc_events_wallet_history_idx" ON "arc_events" USING btree ("chain_id","contract","wallet","block_number","log_index");--> statement-breakpoint
CREATE INDEX "arc_markets_campus_idx" ON "arc_markets" USING btree ("chain_id","contract","campus_id","market_id");--> statement-breakpoint
CREATE INDEX "arc_positions_wallet_idx" ON "arc_positions" USING btree ("chain_id","contract","wallet");--> statement-breakpoint
CREATE INDEX "campus_email_domains_unitid_idx" ON "campus_email_domains" USING btree ("unitid");