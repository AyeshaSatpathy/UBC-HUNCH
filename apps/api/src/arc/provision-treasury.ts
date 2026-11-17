import { isAddress } from "viem";
import { blockchain, circle, reportFailure, requestId } from "../seed/circle";

async function main() {
  const seedAddress = process.argv[2];
  if (!seedAddress || !isAddress(seedAddress)) {
    throw new Error("Pass the public address of an existing Circle Arc testnet seed wallet");
  }

  const seedWallets = (await circle.listWallets({ address: seedAddress, blockchain })).data?.wallets ?? [];
  const matches = seedWallets.filter((wallet) =>
    wallet.blockchain === blockchain && wallet.address.toLowerCase() === seedAddress.toLowerCase());
  const walletSetId = matches.length === 1 ? matches[0]?.walletSetId : undefined;
  if (!walletSetId) throw new Error("Could not identify the existing Circle wallet set");

  const refId = "hunch-arc-testnet-treasury";
  const existing = (await circle.listWallets({ walletSetId, blockchain, refId })).data?.wallets ?? [];
  if (existing.length > 1) throw new Error("Multiple Circle treasury wallets found in the wallet set");
  const wallet = existing[0] ?? (await circle.createWallets({
    idempotencyKey: requestId(`treasury:${walletSetId}`),
    walletSetId,
    blockchains: [blockchain],
    accountType: "SCA",
    count: 1,
    metadata: [{ name: "Hunch Arc testnet treasury", refId }],
  })).data?.wallets[0];

  if (!wallet || wallet.walletSetId !== walletSetId || wallet.blockchain !== blockchain ||
      wallet.accountType !== "SCA" || wallet.address.toLowerCase() === seedAddress.toLowerCase()) {
    throw new Error("Circle did not return a dedicated Arc testnet smart account");
  }
  console.log(wallet.address);
}

await main().catch(reportFailure);
