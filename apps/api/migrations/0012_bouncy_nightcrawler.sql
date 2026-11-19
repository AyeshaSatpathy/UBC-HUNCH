CREATE TABLE "google_sign_ins" (
	"id" uuid PRIMARY KEY NOT NULL,
	"proof_hash" text NOT NULL,
	"verifier" text NOT NULL,
	"intent" text NOT NULL,
	"requester" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"result" text,
	"account_id" uuid,
	"consumed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "google_subject" text;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "added_card" text;--> statement-breakpoint
ALTER TABLE "google_sign_ins" ADD CONSTRAINT "google_sign_ins_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "google_sign_ins_requester_expiry_idx" ON "google_sign_ins" USING btree ("requester","expires_at");--> statement-breakpoint
CREATE INDEX "google_sign_ins_expiry_idx" ON "google_sign_ins" USING btree ("expires_at");--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_google_subject_unique" UNIQUE("google_subject");