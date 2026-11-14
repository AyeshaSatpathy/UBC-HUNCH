# Campus Markets contracts

Run `forge test -vv` from this workspace. The local tests use a synthetic six-decimal ERC-20 fixture. Arc testnet deployments use the native USDC ERC-20 interface at `0x3600000000000000000000000000000000000000`. The testnet chain ID is `5042002` and the official RPC is `https://rpc.testnet.arc.io`. Gas uses the native 18-decimal representation. [Network settings](https://docs.arc.io/arc/references/connect-to-arc) · [Contract addresses](https://docs.arc.io/arc/references/contract-addresses)

Use a funded testnet signer in an encrypted Foundry keystore. Set the RPC URL and distinct public admin and LP wallet addresses from `.env.example`. Set `ARC_USDC_DECIMALS` to `6` and confirm it matches the token's `decimals()` on Arc testnet. With Arc Foundry, run the following in a Unix shell from this workspace.

```sh
arc-cast chain-id --rpc-url "$ARC_TESTNET_RPC_URL"
arc-cast call 0x3600000000000000000000000000000000000000 'decimals()(uint8)' --rpc-url "$ARC_TESTNET_RPC_URL"
arc-forge create src/CampusMarkets.sol:CampusMarkets \
  --rpc-url "$ARC_TESTNET_RPC_URL" --account arc-deployer --broadcast \
  --constructor-args 0x3600000000000000000000000000000000000000 \
  "$CAMPUS_ADMIN_ADDRESS" "$LIQUIDITY_PROVIDER_ADDRESS" "$ARC_USDC_DECIMALS"
```

The LP approves a `100000000` asset-unit allowance and calls `deposit(100000000)` for the demo. The admin registers students and assigns a reviewer to each draft. The LP can allocate up to `20000000` units per market. Opening freezes the reviewer. Trading ends at `close`, the reviewer can resolve during `[close, deadline)`, and anyone can void starting at `deadline`. Source text and public evidence references must contain only public information. Restricted evidence uses a salted digest as the reference.

Shares are measured in millionths and round down. The 1% fee also rounds down to the nearest asset unit. Settlement credits residual collateral and fees to available vault funds after reserving winning claims. Void restores only the initial allocation to the vault and reserves each buyer's full debit. Claims remain available after a campus registration changes.
