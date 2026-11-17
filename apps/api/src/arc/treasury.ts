import { isAddress } from "viem";
import { startingBalanceCents } from "../config";
import { chainId, collateralAbi, createArcClient, usdc } from "./contract";

const treasury = process.env.ARC_TREASURY_ADDRESS?.trim();
if (!treasury || !isAddress(treasury)) {
  throw new Error("Set ARC_TREASURY_ADDRESS to the treasury's public Arc testnet address");
}
const rpc = createArcClient();
if (await rpc.getChainId() !== chainId) throw new Error("Expected Arc testnet RPC");
const balance = await rpc.readContract({ address: usdc, abi: collateralAbi, functionName: "balanceOf", args: [treasury] });
const credit = BigInt(startingBalanceCents()) * 10_000n;
console.log(`Treasury ${treasury} holds ${balance} test USDC base units. Capacity: ${balance / credit} starting credits before any gas or pending transfers.`);
