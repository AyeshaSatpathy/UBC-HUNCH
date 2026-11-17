# UBC Hunch

Campus Markets is deployed on Arc testnet at `0x73Dd30B231f405C1DCf0812c64dDCc5F02143D20`. See the [contracts README](packages/contracts/README.md) for deployment details.

Bun workspaces containing an Expo React Native app and a Hono/tRPC API. PostgreSQL stores data through the `postgres` driver and Drizzle ORM. The mobile app imports only the API router type. The notes example is shared public demo data. Authentication and user ownership require product requirements before deployment.

## Setup

Use Bun 1.4.4, Node.js 22.13+ and Docker Desktop. A workspace-local Bun executable is available at `.tools/bun-windows-x64/bun.exe` on this machine. Add that directory and your supported Node installation to PATH.

```sh
bun install --frozen-lockfile
bun run db:up
```

Copy `apps/api/.env.example` to `apps/api/.env`, then run `bun run db:migrate` and `bun run db:seed:campuses`. Bun loads this environment when running scripts in the API directory.

Run `bun run dev:api` and `bun run dev:mobile` in separate terminals. Use an Expo development build compatible with SDK 58. iOS native builds require macOS or EAS Build.

For a physical phone, copy `apps/mobile/.env.example` to `.env` in that same directory and set the computer's LAN IP. Android emulators default to `10.0.2.2:3000`. iOS simulators default to `localhost:3000`. Restart Expo after changing environment values.

## Campus directory

The importer loads the official [IPEDS 2024 Institutional Characteristics Header archive](https://nces.ed.gov/ipeds/datacenter/data/HD2024.zip). It includes postsecondary institutions in the 50 states, DC, and US territories recorded in the file. Imports update rows by UNITID and can be re-run. To seed offline, pass the absolute paths to the IPEDS ZIP and university-domains JSON to `bun run db:seed:campuses` in that order.

The importer matches the [pinned Hipo university-domain directory](https://github.com/Hipo/university-domains-list/tree/a8fb652f5032801de7125a814aedf213b262a1a4) to IPEDS using normalized names, aliases, and official website hosts. It imports only unambiguous, explicitly listed `.edu` domains, with an exact domain per row. A campus without a domain match still appears in directory search. Hipo's dataset is distributed under its [MIT license](https://github.com/Hipo/university-domains-list/blob/a8fb652f5032801de7125a814aedf213b262a1a4/LICENSE.txt).

The public tRPC procedure `campuses.search` accepts `{ query, limit? }` and returns `{ unitid, name, city, state }` for each result. It supports institution names, aliases, locations, and exact UNITIDs. The mobile app uses it on onboarding and in the feed. Expo web needs its origin in the API's `CORS_ORIGINS` when using a port other than the configured default.

## Arc testnet indexer

Apply the database migrations, then run `bun run arc:index` for a one-time backfill through the finalized head or `bun run arc:index --follow` to keep indexing. The worker resumes its Postgres cursor on restart. For the deployed contract, it starts at block `72337332`. Configure `ARC_TESTNET_RPC_URL` to override the default Arc testnet endpoint.

The worker stores contract events, market state, and positions. An event's key includes the chain, contract, transaction hash, and log index. Event inserts, projection updates, and cursor advancement commit together. Synthetic campus IDs from the seed run are preserved on the indexed rows.

Use `bun run arc:treasury` after setting `ARC_TREASURY_ADDRESS` in `apps/api/.env` to check how many starting credits the current treasury balance covers. `STARTING_BALANCE_CENTS` defaults to `1000` ($10.00).

## School email sign-up and typed market API

Set `BREVO_API_KEY`, `BREVO_FROM_EMAIL`, and `AUTH_CODE_SECRET` in the API's ignored environment or secret store. Use 32 random bytes encoded as hex for `AUTH_CODE_SECRET`. Run the database migrations and campus seed before enabling sign-up.

`auth.requestCode` accepts a mapped `.edu` address. `auth.verifyCode` takes the returned challenge ID and a six-digit code, then returns a bearer session. Codes are HMAC-hashed, expire after ten minutes, and allow five verification attempts. A new request invalidates prior codes. The server enforces a one-minute resend cooldown, up to five requests per address and 20 per direct client IP per hour, and a rolling 280-message app budget per day. Behind a reverse proxy the IP limit applies to the direct proxy connection.

Run `bun run --cwd apps/api arc:provision-accounts --follow` on a worker with Circle credentials, the treasury address, and `ARC_REGISTRAR_PRIVATE_KEY` for the funded admin of the deployed testnet contract. Keep the registrar signer on the worker. The account remains pending until the worker confirms campus registration and the treasury credit. The worker persists the signed registration before broadcast and recovers Circle operations by their request identity.

The Expo app uses the typed API for campus search, school sign-in, markets, live quotes, purchases, predictions, publishing, portfolios, claims, and reputation. Only indexed markets associated with a directory campus are public. Portfolio and write operations derive ownership from the bearer session. All returned money amounts are integer cents serialized as strings. Quotes round charges up to the nearest cent. Available balances and payout previews round down. Chain calculations and transfers retain the full six-decimal amount.

Run `bun run --cwd apps/api arc:student-operations --follow` to keep advancing student purchases, predictions, and drafts after the app closes. Run `bun run arc:index --follow` to keep the market and portfolio projections current. The app can also advance a user's pending action while it is open. Purchases use the shares from the confirmed quote as the minimum and verify the approval and trade receipts before reporting success. Configure the Circle Gas Station policy for student wallet contract calls. [Funding a draft](packages/contracts/README.md#fund-a-student-market)

## Database workflow

Edit `apps/api/src/schema.ts`, run `bun run db:generate`, review and commit the SQL migration, then run `bun run db:migrate`. Apply migrations once before deploying API instances. Local PostgreSQL uses port 55432. PostgreSQL data persists in the Docker volume. Use a separate database URL for production.

## Verification

Run `bun run typecheck` and `bun run test` after configuring the database, applying migrations, and seeding campuses. The integration tests exercise note persistence and campus search through the HTTP API. `/health` checks the API process and `/ready` checks database connectivity. The API listens on port 3000 by default.
