import { eq } from "drizzle-orm";
import type { Address } from "viem";
import { schoolEmail } from "../auth/accounts";
import { connectDatabase } from "../db";
import { accounts } from "../schema";
import { chainId, createArcClient, market, marketAbi } from "./contract";

const [email, action = "show"] = process.argv.slice(2);
const parsed = schoolEmail.safeParse(email);
const url = process.env.DATABASE_URL;
if (!url || !parsed.success || !["show", "enable", "disable"].includes(action)) {
  throw new Error("Usage: arc:reviewer <verified school email> [show|enable|disable]");
}
const { db, client } = connectDatabase(url);
try {
  const [account] = await db.select().from(accounts).where(eq(accounts.email, parsed.data));
  if (!account) throw new Error("No verified account for that email.");
  if (action === "enable") {
    if (!account.wallet || !account.circleWalletId || !account.fundedAt) throw new Error("Finish provisioning the reviewer first.");
    const arc = createArcClient();
    if (await arc.getChainId() !== chainId) throw new Error("Expected Arc testnet.");
    const approved = await arc.readContract({ address: market, abi: marketAbi, functionName: "reviewerRoster", args: [account.wallet as Address] });
    if (!approved) throw new Error("The admin must approve this account's wallet on the contract first.");
  }
  if (action !== "show") await db.update(accounts).set({ isReviewer: action === "enable" }).where(eq(accounts.id, account.id));
  console.log(JSON.stringify({ address: account.wallet, reviewer: action === "show" ? account.isReviewer : action === "enable" }));
} finally { await client.end(); }
