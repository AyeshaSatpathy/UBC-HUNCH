CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"unitid" integer NOT NULL,
	"verified_at" timestamp with time zone NOT NULL,
	"wallet" text,
	"circle_wallet_id" text,
	"registered_at" timestamp with time zone,
	"registration_tx" text,
	"funded_at" timestamp with time zone,
	"funding_id" text,
	"funding_attempt" integer DEFAULT 1 NOT NULL,
	"credit_cents" integer NOT NULL,
	CONSTRAINT "accounts_email_unique" UNIQUE("email"),
	CONSTRAINT "accounts_wallet_unique" UNIQUE("wallet"),
	CONSTRAINT "accounts_circle_wallet_id_unique" UNIQUE("circle_wallet_id")
);
--> statement-breakpoint
CREATE TABLE "claim_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"market_id" numeric(78, 0) NOT NULL,
	"attempt" integer NOT NULL,
	"circle_id" text,
	CONSTRAINT "claim_requests_circle_id_unique" UNIQUE("circle_id")
);
--> statement-breakpoint
CREATE TABLE "email_challenges" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"requester" text NOT NULL,
	"unitid" integer NOT NULL,
	"code_hash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_unitid_campuses_unitid_fk" FOREIGN KEY ("unitid") REFERENCES "public"."campuses"("unitid") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_requests" ADD CONSTRAINT "claim_requests_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_challenges" ADD CONSTRAINT "email_challenges_unitid_campuses_unitid_fk" FOREIGN KEY ("unitid") REFERENCES "public"."campuses"("unitid") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "claim_requests_account_market_idx" ON "claim_requests" USING btree ("account_id","market_id");--> statement-breakpoint
CREATE INDEX "email_challenges_email_issued_idx" ON "email_challenges" USING btree ("email","issued_at");--> statement-breakpoint
CREATE INDEX "email_challenges_requester_issued_idx" ON "email_challenges" USING btree ("requester","issued_at");--> statement-breakpoint
CREATE INDEX "email_challenges_issued_idx" ON "email_challenges" USING btree ("issued_at");