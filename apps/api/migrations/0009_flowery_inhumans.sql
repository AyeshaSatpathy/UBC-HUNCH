CREATE TABLE "login_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"requester" text NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "display_name" text;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "password_hash" text;--> statement-breakpoint
CREATE INDEX "login_attempts_email_issued_idx" ON "login_attempts" USING btree ("email","issued_at");--> statement-breakpoint
CREATE INDEX "login_attempts_requester_issued_idx" ON "login_attempts" USING btree ("requester","issued_at");