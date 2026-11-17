# Stage 1 contract report

## USDC accounting

Arc exposes the same USDC balance through its 18-decimal native interface and its 6-decimal ERC-20 interface. For the reported LP balance, `80,000,000` ERC-20 units represent `80` USDC, equivalent to `80 × 10^18` native units before gas or transfers. [Arc gas and fees](https://docs.arc.io/arc/references/gas-and-fees) · [Arc contract addresses](https://docs.arc.io/arc/references/contract-addresses)

Market, vault, trading fee, and claim accounting use six-decimal integers and the ERC-20 interface at `0x3600000000000000000000000000000000000000`. The constructor reads the configured precision and checks that it is `6` and agrees with the token's `decimals()`. Contract accounting uses no `msg.value` or native balance reads.

Arc charges transaction gas in native USDC from the same wallet balance. Each wallet needs gas for the transactions it signs. A trade requires the quoted principal and trading fee plus network gas. No separate gas asset is needed.

## Verification and deployment

The local Foundry suite uses a labeled synthetic ERC-20 fixture. It checks constructor rejection for a configured precision other than six and for a token precision mismatch. It covers purchase pricing and slippage, fee escrow and release, settlement and void claims, campus eligibility, deadlines, and reviewer conflicts. Funding tests check the allocation cap, LP authorization, duplicate allocations, and the available vault balance. Revert tests check specific custom error selectors.

The deployment script simulated successfully on an Arc testnet fork. The deployed contract has 9,219 bytes of runtime code. RPC calls verified the admin, LP, collateral address, and six-decimal precision. All 16 Foundry tests passed, including 256 fuzz runs. [Deployment transaction](https://explorer.testnet.arc.io/tx/0x0c836160964f5705b3d53d38e6cfde4eeb3c15083253d7eb8b429685db7ab388)

The LP deposited 90 test USDC, leaving part of its balance for gas. The receipt succeeded and both available vault funds and the contract ERC-20 balance were verified at 90 test USDC. The full live trade was deferred to the first verification step in Stage 2. [LP approval](https://explorer.testnet.arc.io/tx/0x0970a65e13488c04eafe658a25699895be5513ee188259e1d614a920e398d686) · [Vault deposit](https://explorer.testnet.arc.io/tx/0x42e082de6a81f8cd449ea2e24e57a8a629401aaf2bec37041433c8f09b8d3294)

## Stage 2 live seed verification

On November 16, 2026, the Circle smart account buyer `0xf4e418f3098ff20b3f1053c77c5c63c3898176ac` bought 7.333333 YES shares in synthetic market 2. The buyer paid 4.000000 test USDC in principal and 0.040000 in trading fees. The assigned Circle reviewer `0x08d566e23abfe5a56a4b8454ec056a639e4da42b` resolved the fixture as YES after trading closed. Circle sponsored both the resolution and the claim. [Funding](https://explorer.testnet.arc.io/tx/0x8f48751602ce752c942098cceed27479fe7a48fe68a58e1c3134d12b30278db3) · [Buy](https://explorer.testnet.arc.io/tx/0x3127f651fadce6ac998869f8b7ce2f741c109a672b2fb937971fd76a4752a249) · [Resolution](https://explorer.testnet.arc.io/tx/0x28ef3de29f77155fa81d5bca2d14fce040db2bbb5b2a9c139fdb388a3440d308) · [Claim](https://explorer.testnet.arc.io/tx/0x2b01d2b4989de610e3c012b96fc8d00c5159d57ea42ff0c957feb1eea510d5db)

The claim paid 7.333333 test USDC, raising the buyer's balance from 15.960000 to 23.293333. Remaining claims fell to zero. A second claim simulated from the buyer reverted with `AlreadyClaimed()` (`0x646cf558`). The resolution returned 16.666667 in unused collateral and 0.040000 in fees to the 70.000000 available vault balance. The resulting 86.706667 available matched the contract's ERC-20 balance after the payout.
