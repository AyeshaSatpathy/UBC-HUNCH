import { TRPCError } from "@trpc/server";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { encodeFunctionData, parseEventLogs, type Address, type Hash } from "viem";
import type { Database } from "../db";
import { accounts, studentOperations, type StudentOperationInput } from "../schema";
import { collateralAbi, createArcClient, market, marketAbi, usdc } from "./contract";
import { centsToUnits, getMarket, quoteMarket } from "./market-api";

const arc = createArcClient();
type Account = typeof accounts.$inferSelect;
type Operation = typeof studentOperations.$inferSelect;
const active = ["approval", "submit"] as const;
const publicOperation = (op: Operation) => ({
  id: op.id, kind: op.input.kind, status: op.stage === "approval" || op.stage === "submit" ? "pending" as const : op.stage,
  marketId: op.resultMarketId ?? ("marketId" in op.input ? op.input.marketId : null),
});

function requireReady(account: Account) {
  if (!account.wallet || !account.circleWalletId || !account.fundedAt) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Your account is still being set up." });
  }
  return { address: account.wallet as Address, circleId: account.circleWalletId };
}

export async function startStudentOperation(db: Database, account: Account, requestKey: string, input: StudentOperationInput) {
  const { address } = requireReady(account);
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${"student-operation:" + account.id}, 0))`);
    const owned = eq(studentOperations.accountId, account.id);
    const [prior] = await tx.select().from(studentOperations).where(and(owned, eq(studentOperations.requestKey, requestKey)));
    if (prior) {
      if (JSON.stringify(prior.input, Object.keys(prior.input).sort()) !== JSON.stringify(input, Object.keys(input).sort())) {
        throw new TRPCError({ code: "CONFLICT", message: "That request was already used." });
      }
      return publicOperation(prior);
    }
    const [pending] = await tx.select().from(studentOperations).where(and(owned, inArray(studentOperations.stage, active))).limit(1);
    if (pending) throw new TRPCError({ code: "CONFLICT", message: "You already have an action processing. Check Portfolio to resume." });
    if (input.kind === "create") {
      if (input.close <= Date.now() / 1_000 || input.deadline <= input.close) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Choose a future trading close and a later evidence deadline." });
      }
    } else {
      const item = await getMarket(db, input.marketId, address);
      if (item.status !== "open" || item.campus.unitid !== account.unitid || !item.canParticipate) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "You can’t take this action in this market." });
      }
      if (input.kind === "buy") {
        const quote = await quoteMarket(input.marketId, input.side, input.cents);
        if (BigInt(quote.sharesMillionths) < BigInt(input.shares)) {
          throw new TRPCError({ code: "CONFLICT", message: "The price changed. Review the new quote before confirming." });
        }
        const balance = await arc.readContract({ address: usdc, abi: collateralAbi, functionName: "balanceOf", args: [address] });
        if (balance < debit(input.cents)) throw new TRPCError({ code: "BAD_REQUEST", message: "Insufficient balance." });
      } else {
        const position = await arc.readContract({ address: market, abi: marketAbi, functionName: "positions", args: [BigInt(input.marketId), address] });
        if (position[3]) throw new TRPCError({ code: "CONFLICT", message: "You already made a prediction." });
      }
    }
    const [op] = await tx.insert(studentOperations).values({
      accountId: account.id, input, requestKey, stage: input.kind === "buy" ? "approval" : "submit",
    }).returning();
    return publicOperation(op);
  });
}

// The deployed contract charges 100 bps and rounds to the smallest unit.
function debit(cents: number) {
  const principal = centsToUnits(cents);
  return principal + principal / 100n;
}

function execution(op: Operation) {
  const input = op.input;
  if (op.stage === "approval" && input.kind === "buy") {
    return { target: usdc, data: encodeFunctionData({ abi: collateralAbi, functionName: "approve", args: [market, debit(input.cents)] }) };
  }
  if (input.kind === "buy") return { target: market, data: encodeFunctionData({
    abi: marketAbi, functionName: "buy", args: [BigInt(input.marketId), input.side === "YES", centsToUnits(input.cents), BigInt(input.shares)],
  }) };
  if (input.kind === "predict") return { target: market, data: encodeFunctionData({
    abi: marketAbi, functionName: "predict", args: [BigInt(input.marketId), input.side === "YES"],
  }) };
  return { target: market, data: encodeFunctionData({
    abi: marketAbi, functionName: "create", args: [{
      question: input.question, source: input.source, yesRule: input.yesRule, noRule: input.noRule,
      close: BigInt(input.close), deadline: BigInt(input.deadline),
    }],
  }) };
}

export async function advanceStudentOperation(db: Database, account: Account, id: string) {
  return db.transaction(async (tx) => {
    const [op] = await tx.select().from(studentOperations)
      .where(and(eq(studentOperations.id, id), eq(studentOperations.accountId, account.id))).for("update");
    if (!op) throw new TRPCError({ code: "NOT_FOUND", message: "Action unavailable." });
    if (op.stage === "confirmed" || op.stage === "failed") return publicOperation(op);
    const { address, circleId } = requireReady(account);
    const save = async (values: Partial<Operation>) => {
      const [updated] = await tx.update(studentOperations).set(values).where(eq(studentOperations.id, id)).returning();
      return publicOperation(updated);
    };
    const { circle, findCircleTransaction, requestId } = await import("../seed/circle");
    if (!op.circleId) {
      const ref = `student:${op.id}:${op.stage}`;
      const existing = await findCircleTransaction(circleId, ref, op.createdAt);
      if (existing) return save({ circleId: existing.id });
      const { target, data } = execution(op);
      const response = await circle.createContractExecutionTransaction({
        walletId: circleId, contractAddress: target, callData: data, refId: ref, idempotencyKey: requestId(ref),
        fee: { type: "level", config: { feeLevel: "MEDIUM" } },
      });
      if (!response.data?.id) throw new Error("Missing Circle submission ID");
      return save({ circleId: response.data.id });
    }
    const remote = (await circle.getTransaction({ id: op.circleId })).data?.transaction;
    if (!remote) throw new Error("Missing action status");
    if (["FAILED", "DENIED", "CANCELLED"].includes(remote.state)) return save({ stage: "failed" });
    if (remote.state !== "COMPLETE" || !remote.txHash) return publicOperation(op);
    const receipt = await arc.getTransactionReceipt({ hash: remote.txHash as Hash });
    if (receipt.status !== "success") return save({ stage: "failed" });
    if (op.stage === "approval" && op.input.kind === "buy") {
      const approved = parseEventLogs({
        abi: collateralAbi, eventName: "Approval", logs: receipt.logs.filter((log) => log.address.toLowerCase() === usdc),
      }).some(({ args }) => args.owner.toLowerCase() === address && args.spender.toLowerCase() === market && args.value === debit(op.input.kind === "buy" ? op.input.cents : 0));
      return save(approved ? { stage: "submit", circleId: null } : { stage: "failed" });
    }
    const logs = receipt.logs.filter((log) => log.address.toLowerCase() === market);
    const input = op.input;
    if (input.kind === "create") {
      const event = parseEventLogs({ abi: marketAbi, eventName: "MarketCreated", logs })
        .find(({ args }) => args.creator.toLowerCase() === address && args.campus === BigInt(account.unitid));
      return save(event ? { stage: "confirmed", resultMarketId: event.args.id.toString() } : { stage: "failed" });
    }
    const valid = input.kind === "buy"
      ? parseEventLogs({ abi: marketAbi, eventName: "Purchased", logs }).some(({ args }) =>
        args.id.toString() === input.marketId && args.buyer.toLowerCase() === address &&
        args.yes === (input.side === "YES") && args.principal === centsToUnits(input.cents) && args.shares >= BigInt(input.shares))
      : parseEventLogs({ abi: marketAbi, eventName: "Predicted", logs }).some(({ args }) =>
        args.id.toString() === input.marketId && args.student.toLowerCase() === address && args.yes === (input.side === "YES"));
    return save({ stage: valid ? "confirmed" : "failed" });
  });
}

export async function pendingStudentOperations(db: Database, account: Account) {
  const rows = await db.select().from(studentOperations).where(
    and(eq(studentOperations.accountId, account.id), inArray(studentOperations.stage, active)),
  ).orderBy(asc(studentOperations.createdAt));
  return rows.map(publicOperation);
}
