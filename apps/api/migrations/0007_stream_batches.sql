CREATE TABLE "stream_batches" (
	"digest" text PRIMARY KEY NOT NULL,
	"start_block" bigint NOT NULL,
	"end_block" bigint NOT NULL,
	"logs" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
