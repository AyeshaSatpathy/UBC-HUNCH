CREATE TABLE "gemini_links" (
	"market_id" numeric(78, 0) PRIMARY KEY NOT NULL,
	"event_ticker" text NOT NULL,
	"contract_id" text NOT NULL,
	"ticker" text NOT NULL,
	"fingerprint" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gemini_odds" (
	"contract_id" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"yes" integer NOT NULL,
	CONSTRAINT "gemini_odds_contract_id_at_pk" PRIMARY KEY("contract_id","at")
);
