# Campus Markets contracts

Stage 1 is deployed on Arc testnet at [`0x73Dd30B231f405C1DCf0812c64dDCc5F02143D20`](https://explorer.testnet.arc.io/address/0x73Dd30B231f405C1DCf0812c64dDCc5F02143D20). [Deployment transaction](https://explorer.testnet.arc.io/tx/0x0c836160964f5705b3d53d38e6cfde4eeb3c15083253d7eb8b429685db7ab388)

Run `forge test -vv` from this workspace. The local tests use a synthetic six-decimal ERC-20 fixture. Arc testnet deployments use the native USDC ERC-20 interface at `0x3600000000000000000000000000000000000000`. The testnet chain ID is `5042002` and the official RPC is `https://rpc.testnet.arc.io`. Gas uses the native 18-decimal representation. [Network settings](https://docs.arc.io/arc/references/connect-to-arc) · [Contract addresses](https://docs.arc.io/arc/references/contract-addresses)

Use a funded testnet signer in an encrypted Foundry keystore. Set the RPC URL and distinct public admin and LP wallet addresses from `.env.example`. Set `ARC_USDC_DECIMALS` to `6` and confirm it matches the token's `decimals()` on Arc testnet. With Arc Foundry, run the following in a Unix shell from this workspace.

```sh
arc-cast chain-id --rpc-url "$ARC_TESTNET_RPC_URL"
arc-cast call 0x3600000000000000000000000000000000000000 'decimals()(uint8)' --rpc-url "$ARC_TESTNET_RPC_URL"
arc-forge script script/DeployCampusMarkets.s.sol:DeployCampusMarkets \
  --rpc-url "$ARC_TESTNET_RPC_URL" --sender "$CAMPUS_ADMIN_ADDRESS" \
  --account arc-deployer --broadcast
```

For a dry run, omit both `--account arc-deployer` and `--broadcast`. The deployment script requires Arc testnet, the six-decimal configuration, and the deployer address as admin. Enter the keystore password only in your local Foundry prompt.

Set the current Stage 1 deployment configuration in PowerShell before running Foundry.

```powershell
$env:ARC_TESTNET_RPC_URL = 'https://rpc.testnet.arc.io'
$env:CAMPUS_ADMIN_ADDRESS = '0x74f3BCDa242a4d729493eDf1A6d82f2a84614b10'
$env:LIQUIDITY_PROVIDER_ADDRESS = '0x051b5A2b5eC5814D4785eAEB96448F8f10bC241B'
$env:ARC_USDC_DECIMALS = '6'
```

The LP approves a `100000000` asset-unit allowance and calls `deposit(100000000)` for the demo. The admin registers students and assigns a reviewer to each draft. The LP can allocate up to `20000000` units per market. Opening freezes the reviewer. Trading ends at `close`, the reviewer can resolve during `[close, deadline)`, and anyone can void starting at `deadline`. Source text and public evidence references must contain only public information. Restricted evidence uses a salted digest as the reference.

### Fund a student market

The app publishes the student's market as a draft. The admin approves a reviewer on the roster and assigns that reviewer to the draft. The LP then moves an allocation from the existing vault into the market. Successful funding opens trading immediately. No new deposit or approval is needed while the vault covers the allocation.

The draft screen shows its market number. For the local LP keystore, run this from the repo root after reviewer assignment and before trading closes. Enter the keystore password in the local Foundry prompt. The script checks eligibility with a read-only call before sending. Add `-PreflightOnly` to stop after the read-only check.

```powershell
& .\packages\contracts\script\fund-market.ps1 -MarketId <market-id>
```

The default allocation is $20. The auto-funding worker uses the existing LP signer from `ARC_LP_PRIVATE_KEY` in `apps/api/.env`. Run `bun run --cwd apps/api arc:auto-fund --follow` with the indexer running. It checks each draft against the deployed contract, saves one signed funding transaction before broadcast, and logs the confirmed receipt. The durable ledger limits successful automatic allocations to four for this deployment. Keep that database when restarting the worker. The worker only signs funding calls. The deployed LP signer also has withdrawal authority, so store its key only in the local worker environment. Stop the worker and reconcile any pending funding transaction before using that same signer through the manual script.

Shares are measured in millionths and round down. The 1% fee also rounds down to the nearest asset unit. Settlement credits residual collateral and fees to available vault funds after reserving winning claims. Void restores only the initial allocation to the vault and reserves each buyer's full debit. Claims remain available after a campus registration changes.
