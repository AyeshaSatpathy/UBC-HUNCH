CREATE TABLE "saved_markets" (
	"account_id" uuid NOT NULL,
	"market_id" numeric(78, 0) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "saved_markets_account_id_market_id_pk" PRIMARY KEY("account_id","market_id")
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "has_seen_guide" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "email_challenges" ADD COLUMN "intent" text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE "saved_markets" ADD CONSTRAINT "saved_markets_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;