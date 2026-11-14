# Stage 1 contract report

## USDC accounting

Arc exposes the same USDC balance through its 18-decimal native interface and its 6-decimal ERC-20 interface. For the reported LP balance, `80,000,000` ERC-20 units represent `80` USDC, equivalent to `80 × 10^18` native units before gas or transfers. [Arc gas and fees](https://docs.arc.io/arc/references/gas-and-fees) · [Arc contract addresses](https://docs.arc.io/arc/references/contract-addresses)

Market, vault, trading fee, and claim accounting use six-decimal integers and the ERC-20 interface at `0x3600000000000000000000000000000000000000`. The constructor reads the configured precision and checks that it is `6` and agrees with the token's `decimals()`. Contract accounting uses no `msg.value` or native balance reads.

Arc charges transaction gas in native USDC from the same wallet balance. Each wallet needs gas for the transactions it signs. A trade requires the quoted principal and trading fee plus network gas. No separate gas asset is needed.

## Verification and deployment

The local Foundry suite uses a labeled synthetic ERC-20 fixture. It checks constructor rejection for a configured precision other than six and for a token precision mismatch. It covers purchase pricing and slippage, fee escrow and release, settlement and void claims, campus eligibility, deadlines, and reviewer conflicts. Funding tests check the allocation cap, LP authorization, duplicate allocations, and the available vault balance. Revert tests check specific custom error selectors.

The deployment script simulated successfully on an Arc testnet fork. The deployed contract has 9,219 bytes of runtime code. RPC calls verified the admin, LP, collateral address, and six-decimal precision. All 16 Foundry tests passed, including 256 fuzz runs. [Deployment transaction](https://explorer.testnet.arc.io/tx/0x0c836160964f5705b3d53d38e6cfde4eeb3c15083253d7eb8b429685db7ab388)

The LP deposited 90 test USDC, leaving part of its balance for gas. The receipt succeeded and both available vault funds and the contract ERC-20 balance were verified at 90 test USDC. The full live trade was deferred to the first verification step in Stage 2. [LP approval](https://explorer.testnet.arc.io/tx/0x0970a65e13488c04eafe658a25699895be5513ee188259e1d614a920e398d686) · [Vault deposit](https://explorer.testnet.arc.io/tx/0x42e082de6a81f8cd449ea2e24e57a8a629401aaf2bec37041433c8f09b8d3294)
