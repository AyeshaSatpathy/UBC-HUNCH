# Stage 1 contract report

## USDC accounting

Arc exposes the same USDC balance through its 18-decimal native interface and its 6-decimal ERC-20 interface. For the reported LP balance, `80,000,000` ERC-20 units represent `80` USDC, equivalent to `80 × 10^18` native units before gas or transfers. [Arc gas and fees](https://docs.arc.io/arc/references/gas-and-fees) · [Arc contract addresses](https://docs.arc.io/arc/references/contract-addresses)

Market, vault, trading fee, and claim accounting use six-decimal integers and the ERC-20 interface at `0x3600000000000000000000000000000000000000`. The constructor reads the configured precision and checks that it is `6` and agrees with the token's `decimals()`. Contract accounting uses no `msg.value` or native balance reads.

Arc charges transaction gas in native USDC from the same wallet balance. The deployer/admin uses USDC for deployment and admin calls. The LP needs `100,000,000` ERC-20 units to deposit into the vault plus enough USDC to pay gas for token approval, deposit, and allocations. Its reported 80 USDC is short by at least 20 USDC plus gas. Each student or reviewer also needs gas for the transactions they sign. A trade requires the quoted principal and trading fee plus network gas. No separate gas asset is needed.

## Verification and deployment

The local Foundry suite uses a labeled synthetic ERC-20 fixture. It checks constructor rejection for a configured precision other than six and for a token precision mismatch. It also covers purchase pricing and slippage, vault accounting, settlement and void claims, campus eligibility, deadlines, and reviewer conflicts. Arc deployment and transfers through live Arc USDC are pending. The deployer address must be verified as distinct from the LP before broadcast.
