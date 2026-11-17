CREATE TABLE "student_operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"request_key" text NOT NULL,
	"input" jsonb NOT NULL,
	"stage" text NOT NULL,
	"circle_id" text,
	"result_market_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "student_operations" ADD CONSTRAINT "student_operations_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "student_operations_account_idx" ON "student_operations" USING btree ("account_id","created_at");