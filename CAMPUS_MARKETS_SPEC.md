# Campus Markets: Agent Build Spec

You are building a campus prediction-market app on Arc testnet. Read this whole document before writing code. Follow the build order in Section 6 and finish with the acceptance checks in Section 7.

## 0. Operating rules

- **Inspect the repo first** and reuse its existing stack. Only for a brand-new project, use Solidity with Foundry, React Native with Expo, and a small TypeScript backend.
- Configure the testnet RPC, asset address and precision, and all vendor credentials **from verified documentation**. Do not guess addresses, decimals, or endpoints.
- Provide an `.env.example` with variable names only. Never commit secrets. Keep service keys server-side.
- All money uses **test USDC** in integer asset units.
- **Report any unverified integration** in your final summary. **Label every fixture and synthetic dataset clearly** in code and in the UI.
- Verify behavior on-chain (campus, status, deadline, configured asset, minimum shares), not only in the app.

## 1. Architecture

| Layer | Responsibility |
|---|---|
| Arc testnet contracts | Campus eligibility, immutable market terms, vault and AMM, trades and claims, reviewer authorization, outcomes, prediction records |
| Backend | Public market indexing, Gemini fetches, private uploads and reviewer access, ElevenLabs sessions and read-only tools |
| Mobile frontend | Campus onboarding, feed, creation, quotes and wallet confirmations, portfolio, evidence review, voice, reputation |

## 2. Feature 1: Campus markets

### 2.1 Student flow

1. **Join.** Sign in, pick a home campus, and link a wallet through labeled demo verification. Seed two campuses and separate student, reviewer, and liquidity-provider accounts.
2. **Browse.** Show campus, question, YES/NO prices, source, deadlines, and status. Anyone can browse other campuses. Contract checks restrict market creation and new trades to eligible wallets from the market's campus.
3. **Create.** Collect:
   - an objective binary question
   - the exact evidence source
   - YES rules and NO rules
   - trading close
   - evidence deadline

   Freeze these terms on creation. The student contributes no initial liquidity.
4. **Trade.** Once the shared vault funds the market, students can buy either side. Show principal, fee, total debit, estimated shares, and minimum acceptable shares. Require a wallet confirmation. Show the resulting position and claim status in the portfolio.
5. **Settle.**
   - Trading closes at the published deadline.
   - The assigned reviewer submits the verified outcome and an evidence reference.
   - Winning shares pay 1 test USDC each. Losing shares pay zero.
   - If no verified result arrives by the evidence deadline, anyone may void the market, and refunds are reserved for all buyers.
   - Claims are one-time and independent of claim order.

### 2.2 Evidence and resolution

Lock the source and an independent reviewer **before** opening trading. The reviewer must:

- have access to the chosen source
- not be the market creator
- not trade or score a prediction in that market

Keep the three source paths explicit:

| Source | Required behavior |
|---|---|
| **Gemini contract** | Before opening, fetch the public event and pin the event ticker and exact contract identifier. Require matching proposition, threshold, time window, and settlement rules. After close, fetch the same contract. Accept only a `settled` status with an explicit final YES or NO. Show the response in the reviewer screen for confirmation and authorized submission on Arc. Pending, invalid, mismatched, or unavailable data stays unresolved until a valid result arrives or the deadline permits a void. |
| **Other public source** | The reviewer checks the exact official source named at market creation and submits the result with a reference. |
| **Restricted source** | Require a privately uploaded screenshot. A reviewer with existing authorized access independently opens the original source, checks that the screenshot matches the right result and context, and approves it before submitting. Store a **salted evidence commitment** on Arc. Keep the image and private data out of public views, contract events, and voice tools. Reject mismatches and allow a replacement until the evidence deadline. Use **synthetic data** for this demo path. |

**Gemini integration details**

- Gemini is a data source inside Campus. Use its public event detail endpoint: `GET /v1/prediction-markets/events/{ticker}`.
- Match the pinned contract in the response. Use the final `resolutionSide` when status is `settled`.
- The Arc contract authenticates the reviewer and prevents duplicate or late submissions. The reviewer is responsible for checking the source.

### 2.3 Liquidity, fees, and accounting

**Vault and allocation**
- A separate team wallet deposits test USDC into a shared vault.
- Set a per-market allocation cap.
- Demo defaults: **100-unit vault deposit, 20-unit allocation**.

**AMM**
- Use a fully collateralized binary AMM.
- Seed equal YES and NO reserves by locking LP collateral into complete sets.
- On a buy: split the principal into complete sets, add both sides to inventory, and deliver shares from the selected side using constant-product pricing.
- Round share output **down**.
- Use the **same quote logic** in preview and execution.

**Fees**
- Demo default trading fee: **1%**. Example: a 4.00 principal purchase debits **4.04**.
- Escrow the 0.04 fee for the vault until valid settlement.
- Show Arc network fees separately in the UI.

**Settlement accounting**
- Reserve all winning claims **before** releasing residual capital and trading fees to the vault.
- On void: refund each trader's original principal plus fees, and return the initial allocation to the vault.
- Committed and claimable funds are unavailable for LP withdrawal.
- Display vault fees and net result separately.
- LP net result = remaining capital + fees returned − initial allocation.

**Contract requirements**
- Verify on-chain: campus, status, deadline, configured asset, and minimum shares.
- Use integer asset units, nontransferable position balances, and single-use claims.
- Test collateral conservation under uneven trading and rounding.

## 3. Feature 2: ElevenLabs voice chat

A student taps the microphone, speaks a question, and hears a spoken answer. Support discovery, rule explanations, and live trade quotes.

| Student asks | App behavior |
|---|---|
| "What markets are open at my campus?" | Read open markets and offer to open the selected market. |
| "What decides this question?" | Read the market's published source, condition, and deadline. |
| "What would I get for 4 test USDC on YES?" | Read a current contract quote and open a preview with the side and principal filled in. |

Requirements:
- Use ElevenLabs Agents and supported mobile tooling.
- Give the agent **read-only** tools for markets, rules, and quotes only.
- Refresh the quote at confirmation.
- Wallet holders approve transactions in the app. A voice request alone must never submit a trade.
- Keep service keys server-side.
- Handle microphone denial, failed sessions, and unavailable quotes with manual controls.
- Capture a **real** voice interaction in the submission video.

## 4. Feature 3: On-chain reputation

- Allow **one locked YES or NO prediction per eligible wallet per open market**.
- Students can predict without buying shares.
- Record the prediction on Arc and score it against the finalized outcome.
- Display correct predictions, total scored predictions, and accuracy. Example: `8 of 12 correct (67%)`.
- Exclude open, unresolved, and voided markets.
- Show a zero-results state.
- Display names may live off-chain. Keep enrollment details private.

## 5. Privacy and security checklist

- Private evidence images and data never appear in public views, contract events, or voice tools.
- Private evidence is available only to the assigned reviewer.
- Service and vendor keys stay server-side.
- Voice tools are read-only.
- Contracts, not the client, enforce campus eligibility, deadlines, reviewer identity, and one-time submissions and claims.

## 6. Build order

1. **Contracts.** Build and test create → fund → buy → resolve → claim, plus void refunds. Deploy to Arc testnet.
2. **Mobile wiring.** Connect the mobile flows, campus gating, and reputation to the deployed contracts.
3. **Evidence.** Implement source selection and evidence review.
   - Verify the Gemini integration against an **actual settled** API contract.
   - Use an active linked contract for the full lifecycle when timing permits.
   - If it cannot settle before filming, demonstrate its live lookup, and show verified outcome retrieval separately using an already-settled contract. Clearly distinguish the two in the demo.
4. **Voice and demo.** Integrate ElevenLabs, run the acceptance checks, and record the demo.
5. **Report.** List any unverified integrations and label all fixtures.

## 7. Acceptance checks

Each item must pass (automated test where possible, otherwise demonstrated in the demo).

**Campus gating**
- [ ] An eligible student creates a market without funding it.
- [ ] A different-campus wallet can view the market, but direct trade and prediction attempts fail.

**Trading**
- [ ] Buying before funding fails.
- [ ] Buying after close fails.
- [ ] Buying below the minimum-share limit fails.
- [ ] A 4.00 purchase with the default fee debits 4.04 and updates the on-chain position.

**Gemini resolution**
- [ ] Links require an exact contract match.
- [ ] A valid final result can settle the matching market.
- [ ] Pending, invalid, mismatched, and failed API responses cannot settle it.

**Restricted source**
- [ ] A restricted-source market requires approved screenshot evidence.
- [ ] Missing or rejected evidence cannot settle it through the app.
- [ ] Unauthorized and repeat resolution transactions fail.
- [ ] Private evidence is unavailable to unassigned users and voice tools.

**Claims and accounting**
- [ ] Winners claim once.
- [ ] After a void, each buyer can reclaim principal and fee once.
- [ ] Student claims remain covered regardless of settlement and claim order.

**Voice**
- [ ] ElevenLabs answers aloud from live data and opens a preview.
- [ ] A voice request alone cannot submit a trade.

**Reputation**
- [ ] An eligible student can record one prediction without buying shares.
- [ ] The profile counts each valid final result once and excludes voided markets.

## 8. Final deliverables

- Deployed Arc testnet contracts, with addresses
- Mobile app, backend, and contracts with tests
- `.env.example` (no secrets)
- Demo video including a real voice interaction
- Summary of acceptance-check results, unverified integrations, and labeled fixtures