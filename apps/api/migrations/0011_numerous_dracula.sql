CREATE TABLE "deposits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"request_key" text NOT NULL,
	"card" text NOT NULL,
	"cents" integer NOT NULL,
	"status" text NOT NULL,
	"circle_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deposits_circle_id_unique" UNIQUE("circle_id")
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "pending_campus_id" integer;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "notifications_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deposits_account_created_idx" ON "deposits" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE INDEX "deposits_status_created_idx" ON "deposits" USING btree ("status","created_at");--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_pending_campus_id_campuses_unitid_fk" FOREIGN KEY ("pending_campus_id") REFERENCES "public"."campuses"("unitid") ON DELETE no action ON UPDATE no action;