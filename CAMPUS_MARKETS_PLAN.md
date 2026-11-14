# Campus Markets build plan

The original requirements are in [the build spec](CAMPUS_MARKETS_SPEC.md). This plan records implementation decisions and the checks that close each stage.

## Stage 1. Contracts and Arc deployment

- Use Foundry for the campus registry, market lifecycle, vault, binary AMM, settlement, claims, and predictions. Verify the Arc network and collateral asset configuration before deployment.
- Use the demo admin as the campus registrar. The admin registers seeded student wallet-to-campus mappings on-chain after demo verification. Derive a creator's campus from the registry and check the caller against the market's campus on each buy and prediction. Public reads are open. Claims use recorded entitlements and remain available if eligibility changes.
- The demo admin manually assigns a reviewer from the seeded roster before trading opens. Reject the creator and any wallet with a trade or prediction in that market. Freeze the reviewer when the market opens. Reject any trade or prediction from the assigned reviewer, including direct contract calls. Apply these rules per market.
- The separate LP wallet manually approves each allocation from the shared vault. Use the spec defaults of 100 test USDC deposited, 20 allocated, and a 1% trading fee.
- Settlement is reviewer-only. The contract checks the assigned wallet, the settlement window, and single submission. For Gemini, the app and backend check the pinned contract and its explicit final outcome before the review screen enables submission. For restricted evidence, the review screen requires screenshot approval and submits a salted commitment. The contract trusts the assigned reviewer to verify the underlying evidence.
- Before moving on, test unauthorized registry writes, unregistered and wrong-campus wallet calls, creator/reviewer conflicts, reviewer trade and prediction attempts, unauthorized and repeat settlement, deadline boundaries, funding and slippage checks, rounding, and collateral conservation. Exercise winning claims and void refunds in different claim orders. Deploy to Arc testnet after those checks pass.

## Stage 2. Mobile and indexing

- Reuse the Bun monorepo, Expo, TanStack Query, Hono/tRPC, and PostgreSQL with Drizzle and the `postgres` driver. Arc is authoritative for eligibility, terms, positions, outcomes, claims, and predictions. PostgreSQL holds the public index and private app records.
- Seed two campuses with demo accounts and external testnet wallets. Connect onboarding, browse, create, fund, buy, predict, portfolio, claims, and reputation. Demonstrate a purchase debiting 4.04 test USDC for 4.00 principal before network fees, and a prediction made without a trade. Exclude voids from reputation.

## Stage 3. Evidence

- Verify an actual settled Gemini contract. Test that pending, invalid, mismatched, and unavailable responses leave app submission disabled. Verify the official public-source review flow and the restricted screenshot flow using labeled synthetic data. Test reviewer-only access and rejected screenshot replacement before the deadline.
- If an active linked Gemini contract cannot settle before filming, demonstrate live lookup and settled-result retrieval separately and label each in the demo.

## Stage 4. Voice and demo

- Create and configure an ElevenLabs Agent in Stage 4. Use server-side credentials to issue short-lived mobile session access. Give the agent read-only tools for public markets, rules, and quotes.
- Use an Expo development build for ElevenLabs. Verify spoken answers from live public data, a prefilled trade preview, a refreshed quote, and explicit wallet approval in the app. Prepare a demo walkthrough that includes a real voice interaction for the user to film.
- Deliver the Arc addresses, source and tests, environment variable names, demo walkthrough, and acceptance report with fixtures and any unverified integrations identified. The user supplies the demo video for submission.

## Demo logistics

- The user handles filming and the submission schedule. Confirm the filming device when verifying the Expo development build in Stage 4.
