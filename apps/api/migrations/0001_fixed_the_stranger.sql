CREATE TABLE "campuses" (
	"unitid" integer PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"aliases" text NOT NULL,
	"city" text NOT NULL,
	"state" text NOT NULL,
	"search_document" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', name || ' ' || aliases || ' ' || city || ' ' || state)) STORED
);
--> statement-breakpoint
CREATE INDEX "campuses_search_idx" ON "campuses" USING gin ("search_document");