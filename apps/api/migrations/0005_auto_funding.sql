CREATE TABLE "auto_funding" (
	"chain_id" integer NOT NULL,
	"contract" text NOT NULL,
	"market_id" numeric(78, 0) NOT NULL,
	"allocation" numeric(78, 0) NOT NULL,
	"transaction_hash" text NOT NULL,
	"signed_transaction" text NOT NULL,
	"state" text NOT NULL,
	"receipt" jsonb,
	CONSTRAINT "auto_funding_chain_id_contract_market_id_pk" PRIMARY KEY("chain_id","contract","market_id"),
	CONSTRAINT "auto_funding_transaction_hash_unique" UNIQUE("transaction_hash")
);
