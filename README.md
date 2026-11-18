# Hunch

Campus prediction markets with a dollars-only Expo app, Hono/tRPC API, Postgres, Circle-managed accounts, QuickNode Streams, and Gemini Prediction Markets data.

The deployed Arc testnet contract is `0x73Dd30B231f405C1DCf0812c64dDCc5F02143D20`, chain ID `5042002`, deployed at block `72337332`. [Contract setup and manual funding](packages/contracts/README.md)

## Setup

Use Bun 1.4.4, Node 22.13 or later, Docker Desktop, and an Expo SDK 58-compatible client. From the repository root on this PC, add the installed runtimes to your current PowerShell session.

```powershell
$env:Path = 'C:\Program Files\nodejs;C:\UBC-HUNCH\.tools\bun-windows-x64;' + $env:Path
bun install --frozen-lockfile
bun run db:up
```

For a fresh checkout, copy `apps/api/.env.example` to `apps/api/.env` and populate it locally. Preserve an existing environment file. Then run the migrations and import the campus directory.

```powershell
bun run db:migrate
bun run db:seed:campuses
```

Postgres runs on `localhost:55432`. Its Docker volume holds the event cursor, session records, operation identities, and funding ledger. Preserve that volume across restarts, including the four-market automatic funding limit.

### Environment variables

All server settings belong in `apps/api/.env` or a server secret store. Git ignores private `.env` files. Only `EXPO_PUBLIC_API_URL` belongs in the mobile environment.

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres connection |
| `PORT` | API port, defaults to 3000 |
| `CORS_ORIGINS` | Comma-separated allowed Expo web origins |
| `BREVO_API_KEY` | Brevo transactional email access |
| `BREVO_FROM_EMAIL` | Verified Brevo sender |
| `AUTH_CODE_SECRET` | 32 random bytes as 64 hex characters, used to hash codes |
| `CIRCLE_API_KEY` | Circle testnet API key |
| `CIRCLE_ENTITY_SECRET` | Registered Circle entity secret |
| `ARC_TESTNET_RPC_URL` | Arc testnet RPC, defaults to `https://rpc.testnet.arc.io` |
| `ARC_TREASURY_ADDRESS` | Dedicated Circle treasury public address |
| `ARC_REGISTRAR_PRIVATE_KEY` | Deployed contract admin signer for account registration |
| `ARC_LP_PRIVATE_KEY` | Existing LP signer for automatic market funding |
| `STARTING_BALANCE_CENTS` | Starting credit, defaults to `1000` ($10.00) |
| `QUICKNODE_API_KEY` | QuickNode management API access for Stream setup |
| `QUICKNODE_STREAM_SECURITY_TOKEN` | Stream delivery HMAC secret, at least 32 characters |
| `QUICKNODE_WEBHOOK_URL` | Public HTTPS URL ending in `/webhooks/quicknode` |
| `EXPO_PUBLIC_API_URL` | Mobile-only URL pointing to the reachable API |

Gemini market-data endpoints used here are public and require no Gemini trading credentials.

## Run the app and services

Run each long-lived command in its own terminal from the repo root.

```powershell
# API
bun run dev:api

# Primary event consumer, after configuring QuickNode below
bun run arc:index --streams --follow

# New-account wallet creation, campus registration, and $10 credits
bun run --cwd apps/api arc:provision-accounts --follow

# Purchases, predictions, publishing, and reviewer resolutions
bun run --cwd apps/api arc:student-operations --follow

# At most four successful automatic $20 allocations for this deployment
bun run --cwd apps/api arc:auto-fund --follow

# Observe Gemini prices for linked markets even when their screens are closed
bun run --cwd apps/api gemini:sync --follow

# Expo
bun run dev:mobile --go --lan
```

The funding worker checks the deployed LP address and allocation cap. It considers directory-campus drafts with assigned reviewers, simulates the funding call, persists the signed transaction before broadcast, and logs each confirmed or reverted receipt. A database lock serializes reservations across workers. It signs funding calls only. Stop this worker and reconcile any pending transaction before using the LP through the [manual fallback script](packages/contracts/script/fund-market.ps1).

For a read-only historical backfill or repair run, use `bun run arc:index`. This reads finalized Arc events from the stored cursor through the current head using RPC. The primary continuous consumer uses `--streams`. Neither mode submits purchases.

### iPhone

1. Put the PC and iPhone on the same Wi-Fi. Run `ipconfig` and find the Wi-Fi IPv4 address.
2. In `apps/mobile/.env`, set `EXPO_PUBLIC_API_URL=http://YOUR_PC_WIFI_IP:3000`. Restart Expo whenever this value changes.
3. Start the API and check `http://YOUR_PC_WIFI_IP:3000/ready` in iPhone Safari. It should return `{"status":"ready"}`. Allow the API and Node through Windows Firewall on your private network if needed.
4. Use an SDK 58-compatible Expo Go installed through your Expo/TestFlight setup, or an SDK 58 development build. Sign in to Expo CLI with `bunx expo login` from `apps/mobile` and use the same Expo account on the iPhone.
5. Run `bun run dev:mobile --go --lan` on the PC and scan the QR with the iPhone camera. Grant local network access to Expo Go.
6. For an installed Hunch development build, run `bun run dev:mobile --dev-client --lan` instead. Rebuild the development client when adding native packages.

The project's SDK version must match the installed client. Expo's current iOS instructions describe TestFlight distribution for newer SDKs and require Apple Developer Program access for that setup. Follow the version-specific installation instructions if an App Store client reports a mismatch. Native iPhone testing remains a manual gate. [Expo iPhone setup](https://docs.expo.dev/get-started/set-up-your-environment/?device=physical&mode=expo-go&platform=ios), [Version compatibility](https://docs.expo.dev/troubleshooting/expo-go-version-mismatch/)

## Login and campus directory

The entry screen asks for school email and a six-digit code. The same flow signs up a new student or signs in an existing account. Existing accounts retain their campus and wallet, and their confirmed credit prevents repeat provisioning. The native app stores the bearer session in Expo SecureStore. The web preview uses tab-scoped session storage. Log out is on Profile. Expired authenticated queries clear the local session and return to email entry.

Codes are HMAC-hashed, expire after ten minutes, allow five attempts, and are consumed once. A resend invalidates prior codes. Limits are one request per minute, five per email per hour, 20 per direct client IP per hour, and 280 app messages per rolling day. A reverse proxy shares the direct-IP bucket unless deployment adds a trusted proxy configuration.

The import uses [IPEDS HD2024](https://nces.ed.gov/ipeds/datacenter/data/HD2024.zip) and the [pinned MIT-licensed Hipo university-domain dataset](https://github.com/Hipo/university-domains-list/tree/a8fb652f5032801de7125a814aedf213b262a1a4). UNITID is the campus ID. The verified import produced 6,040 institutions, 2,025 matched campuses, 2,072 unambiguous .edu domains, and 4,015 campuses without an automatic domain match. Search remains available for every directory campus. Offline imports accept absolute paths to the IPEDS ZIP and Hipo JSON as arguments to `bun run db:seed:campuses`.

Money is represented as six-decimal integers in contract operations and integer-cent strings in the UI API. Displayed charges round up to cents. Balances and payout previews round down. The full six-decimal amount is retained for execution. At $4.00 principal, the fee is $0.04 and the debit is $4.04.

## QuickNode Streams

### Required configuration

| Setting | Value and rationale |
| --- | --- |
| Network | Arc Testnet, API slug `arc-testnet`, chain `5042002` |
| Dataset | `logs`, sufficient for the CampusMarkets events |
| Contract | `0x73dd30b231f405c1dcf0812c64ddcc5f02143d20` |
| Start block | `72337332`, includes the full deployed contract history |
| End block | Unset, so delivery continues |
| Batch | 100 blocks, elastic batching enabled |
| Region | `usa_east` |
| Filter | [quicknode-filter.js](apps/api/quicknode-filter.js), flattens Logs and keeps only the contract address |
| Destination | Webhook, HTTPS, compression `none`, HMAC security token |
| Delivery retries | 10 retries, five-second intervals, ten-second request timeout |
| Receiver | `POST /webhooks/quicknode` on the Hono API |

The filter preserves batch start/end and returns an object even when its filtered logs are empty. Those empty ranges let the consumer advance its contiguous cursor. Direct Postgres delivery would bypass the receiver's validation and shared projection logic, so this implementation uses the webhook destination.

The receiver verifies HMAC-SHA256 over `nonce + timestamp + decodedBody` using the Stream security token. It validates the contract, network, block ranges, topics, and hashes before storing a durable inbox batch. Retries deduplicate by body digest. The consumer waits for a batch covering its next block, orders logs by block and log index, and commits event insertion, state projection, and cursor advancement together. Event identity includes chain, contract, transaction hash, and log index. Duplicate events leave projections unchanged. Out-of-order deliveries remain in the inbox until preceding ranges arrive.

The app polls Stream-backed activity every five seconds and campus leaderboard statistics every ten seconds. Campus rankings use purchase counts, with market and participant totals. These views become live only when deliveries reach the receiver and the Stream consumer is running.

### Localhost and the public destination

QuickNode cannot deliver to a localhost or private Wi-Fi address. On the PC, run the API and then run this tunnel command yourself, or explicitly authorize opening a tunnel.

```powershell
ngrok http 3000
```

Use the assigned HTTPS forwarding origin. For example, when ngrok prints `https://YOUR_ASSIGNED_HOST.ngrok-free.app`, the exact destination is `https://YOUR_ASSIGNED_HOST.ngrok-free.app/webhooks/quicknode`. Replace the host with the one assigned to your tunnel. You can obtain the exact active destination in PowerShell.

```powershell
$tunnel = (Invoke-RestMethod http://127.0.0.1:4040/api/tunnels).tunnels |
  Where-Object { $_.public_url -like 'https://*' } | Select-Object -First 1
$tunnel.public_url.TrimEnd('/') + '/webhooks/quicknode'
```

Populate `QUICKNODE_WEBHOOK_URL` with that result and add `QUICKNODE_API_KEY` and `QUICKNODE_STREAM_SECURITY_TOKEN` locally. Run `bun run --cwd apps/api stream:configure`. It creates a paused Stream with a stable external ID, so a retry reuses the same Stream. Inspect it in the QuickNode dashboard, run **Check Connection**, test the filter, and activate it. The configured security token must match the receiver's environment. Restart the API after changing its environment. Run the primary consumer with `bun run arc:index --streams --follow`.

As of this build, QuickNode credentials and a public destination were absent. No hosted Stream was created or activated. Automatic approval review rejected starting ngrok because publishing the local API required explicit approval. This repository contains the configuration and receiver, and the public destination remains a deployment step.

Arc Testnet and Logs support, the filter schema, delivery metadata, signature calculation, and Stream creation settings were checked in the current official documentation. [Supported networks](https://www.quicknode.com/docs/streams/supported-chains), [Logs format](https://www.quicknode.com/docs/streams/data-sources/ethereum-evm), [Delivery signatures](https://www.quicknode.com/guides/quicknode-products/streams/validating-incoming-streams-webhook-messages), [Stream creation](https://www.quicknode.com/docs/streams/rest-api/create-stream)

## Gemini Prediction Markets

Create includes an optional Gemini event search. Selecting a contract fills and locks the question, named source URL, and YES/NO rules. Its event ticker, contract ID, contract ticker, and terms fingerprint are pinned on submission and saved when creation confirms. The API fetches the selected contract again before accepting the draft and requires exact matching text. Trading must close by the Gemini expiry, and the evidence deadline must follow that expiry.

Market detail compares campus YES odds with Gemini's last-trade price, falling back to its YES buy quote when there is no last trade. The history chart uses Gemini `priceHistory` when provided and persisted minute observations from the public event endpoint. `gemini:sync --follow` collects observations while screens are closed. It cannot reconstruct price history that Gemini does not return. Sparse histories show an explicit building-history state.

The reviewer console displays the pinned contract's settlement state. A linked resolution requires a fresh response with matching ticker, ID, fingerprint, settled event and contract statuses, a resolution timestamp, and an explicit `yes` or `no`. Pending, invalid, changed, unreachable, and opposite-outcome responses block submission. The worker checks again before sending a new resolution request. These checks are enforced in the application backend. The existing reviewer-only contract still allows a reviewer to submit directly outside the application.

Public Gemini endpoints used are `GET /v1/prediction-markets/events?status=active&search=...` and `GET /v1/prediction-markets/events/{eventTicker}`. Search excludes the digital-asset category from student choices. [Gemini market data documentation](https://developer.gemini.com/prediction-markets-spec/markets)

### Real settled response verified

The adapter fetched this public contract directly by event ticker on November 18, 2026 and returned `YES`. This was a read-only API check.

```json
{
  "eventTicker": "XRP05M2611181915",
  "id": "477697-1209466",
  "ticker": "UP",
  "status": "settled",
  "resolutionSide": "yes",
  "resolvedAt": "2026-11-18T19:15:05.947Z",
  "adapterOutcome": "YES"
}
```

## Reviewer Console and market funding

Open `http://localhost:3000/reviewer` independently of the student app. Approved reviewers sign in by email code. Only marked reviewer accounts can open the console, and it shows only markets assigned to their wallet. It displays the question, named source, evidence deadline, and Gemini settlement check when linked.

A separate verified, provisioned account is required for the reviewer. The creator cannot review their own market, and the reviewer cannot buy or predict in an assigned market. Find the public address with `bun run --cwd apps/api arc:reviewer $reviewerEmail show`, approve it on the contract, then enable console access. Use `disable` to revoke console access.

```powershell
$marketContract = '0x73Dd30B231f405C1DCf0812c64dDCc5F02143D20'
$arcRpc = 'https://rpc.testnet.arc.io'
$cast = '.\.tools\foundry\cast.exe'
# Set $reviewerEmail and $reviewerAddress to the separate reviewer's details.
& $cast send $marketContract 'setReviewer(address,bool)' $reviewerAddress true --account arc-deployer --rpc-url $arcRpc
bun run --cwd apps/api arc:reviewer $reviewerEmail enable
# Set $marketId to the number shown after publishing the student's draft.
& $cast send $marketContract 'assignReviewer(uint256,address)' $marketId $reviewerAddress --account arc-deployer --rpc-url $arcRpc
```

Automatic funding then opens eligible drafts. The last verified vault balance was 86.706667 test USDC, enough for four $20 allocations. Use the local LP keystore fallback if automatic funding is stopped.

```powershell
& .\packages\contracts\script\fund-market.ps1 -MarketId $marketId
```

## Verification status

Run `bun run typecheck`, `bun run test`, and `bun run --cwd apps/mobile lint`. API tests require the migrated and seeded local database. `/health` checks the process, `/ready` checks Postgres, and `GET /webhooks/quicknode` reports whether Stream verification is configured.

- Verified locally in this build, eight API tests, 75 assertions, both workspace typechecks, Expo lint, and the production web export.
- Browser walkthrough used isolated responses for email login, session restore, logout, purchase response recovery, claim collection, publishing, and Gemini linking with locked terms. It submitted no live purchase.
- Gemini's real settled response was fetched and accepted by the adapter. Pure settlement tests reject changed IDs, tickers, rules, pending and invalid statuses, and absent explicit outcomes.
- Stream receiver tests verify HMAC rejection and duplicate delivery handling. Hosted QuickNode delivery, network/filter deployment, and live Stream-backed activity remain unverified until configuration is completed.
- Prior live verification established school email delivery, wallet creation, UT Austin UNITID registration, the $10 credit, and restart recovery. Prior seed settlement and claim receipts are recorded in [the contract report](packages/contracts/STAGE_1_REPORT.md).
- Automatic funding with the LP signer, reviewer-console resolution of a newly Gemini-linked market, sustained Gemini history collection, and this build on a physical iPhone remain manual verification steps.

## Manual checklist

1. Enter your school email, receive a code, and sign in. Returning users land on Feed with their existing balance. Reopen the app and confirm the session persists. Log out, then confirm email entry returns.
2. Search campus feeds. With the Stream active, verify a known market event appears once in Live activity and in campus totals after the consumer catches up.
3. In Create, search a Gemini event, select a contract, and inspect the pinned question and rules. Set a future trading close at or before its expiry and an evidence deadline after expiry. Publish and note its market number.
4. Have the admin assign a separate approved reviewer. With auto-funding active, verify the draft becomes Open and that one funding receipt is logged. Check that restarting the worker preserves its four-market limit.
5. Buy YES for $4.00. Confirm the review sheet shows $0.04 fee and $4.04 total. Tap Confirm once, wait for confirmation, and check the Portfolio balance and position.
6. After trading closes and Gemini explicitly settles, open the separate Reviewer Console. It should show only the reviewer's assignments and permit only Gemini's matching outcome. Add a public reference and submit.
7. In Portfolio, collect the payout or refund once. Confirm the new balance and that the collect button no longer offers a duplicate claim. Check prediction accuracy after a free prediction settles.
8. Temporarily disconnect the API and Gemini connectivity. Confirm errors, retry buttons, and blocked resolution controls. Restore connectivity and verify recovery.
