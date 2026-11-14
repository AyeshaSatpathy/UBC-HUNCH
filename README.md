# UBC Hunch

Campus Markets is deployed on Arc testnet at `0x73Dd30B231f405C1DCf0812c64dDCc5F02143D20`. See the [contracts README](packages/contracts/README.md) for deployment details.

Bun workspaces containing an Expo React Native app and a Hono/tRPC API. PostgreSQL stores data through the `postgres` driver and Drizzle ORM. The mobile app imports only the API router type. The notes example is shared public demo data. Authentication and user ownership require product requirements before deployment.

## Setup

Use Bun 1.4.4, Node.js 22.13+ and Docker Desktop. A workspace-local Bun executable is available at `.tools/bun-windows-x64/bun.exe` on this machine. Add that directory and your supported Node installation to PATH.

```sh
bun install --frozen-lockfile
bun run db:up
```

Copy `apps/api/.env.example` to `apps/api/.env`, then run `bun run db:migrate`. Bun loads this environment when running scripts in the API directory.

Run `bun run dev:api` and `bun run dev:mobile` in separate terminals. Use an Expo development build compatible with SDK 58. iOS native builds require macOS or EAS Build.

For a physical phone, copy `apps/mobile/.env.example` to `.env` in that same directory and set the computer's LAN IP. Android emulators default to `10.0.2.2:3000`. iOS simulators default to `localhost:3000`. Restart Expo after changing environment values.

## Database workflow

Edit `apps/api/src/schema.ts`, run `bun run db:generate`, review and commit the SQL migration, then run `bun run db:migrate`. Apply migrations once before deploying API instances. Local PostgreSQL uses port 55432. PostgreSQL data persists in the Docker volume. Use a separate database URL for production.

## Verification

Run `bun run typecheck`. Run `bun test` from `apps/api` with its DATABASE_URL configured after applying migrations. The integration test creates and removes its own note and verifies HTTP requests and validation. `/health` checks the API process and `/ready` checks database connectivity.

The app displays the most recent 50 notes. TanStack Query invalidates that list after a successful write. Requests use Zod validation on the server. The API listens on port 3000 by default. Database credentials stay in the API environment.
