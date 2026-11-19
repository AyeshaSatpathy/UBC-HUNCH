import { TRPCError } from "@trpc/server";
import { isDeepStrictEqual } from "node:util";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { BaseError, ContractFunctionRevertedError, encodeFunctionData, keccak256, parseEventLogs, toHex, type Address, type Hash } from "viem";
import type { Database } from "../db";
import { accounts, geminiLinks, studentOperations, type StudentOperationInput } from "../schema";
import { describe, getGeminiContract, requireGeminiOutcome } from "../gemini";
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

const referenceHash = (reference: string) => keccak256(toHex(reference));

async function requireResolution(account: Account, address: Address, input: Extract<StudentOperationInput, { kind: "resolve" }>) {
  if (!account.isReviewer) throw new TRPCError({ code: "FORBIDDEN", message: "Reviewer access is required." });
  const approved = await arc.readContract({ address: market, abi: marketAbi, functionName: "reviewerRoster", args: [address] });
  if (!approved) throw new TRPCError({ code: "FORBIDDEN", message: "Reviewer approval is required." });
  try {
    await arc.simulateContract({ address: market, abi: marketAbi, account: address, functionName: "resolve",
      args: [BigInt(input.marketId), input.side === "YES", referenceHash(input.reference)] });
  } catch (error) {
    if (!(error instanceof BaseError) || !(error.walk(cause => cause instanceof ContractFunctionRevertedError) instanceof ContractFunctionRevertedError)) throw error;
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "This market cannot be resolved by your account at this time." });
  }
}

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
    const [current] = await tx.select({ unitid: accounts.unitid, pendingCampusId: accounts.pendingCampusId }).from(accounts).where(eq(accounts.id, account.id));
    if (!current || current.pendingCampusId || current.unitid !== account.unitid) {
      throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Campus change is in progress. Try again shortly.' });
    }
    const owned = eq(studentOperations.accountId, account.id);
    const [prior] = await tx.select().from(studentOperations).where(and(owned, eq(studentOperations.requestKey, requestKey)));
    if (prior) {
      if (!isDeepStrictEqual(prior.input, input)) {
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
      if (input.gemini) {
        const { event, contract } = await getGeminiContract(input.gemini.eventTicker, input.gemini.contractId, true);
        const canonical = describe(event, contract);
        if (contract.status !== "active" || event.status !== "active" || !canonical.yesRule ||
          canonical.fingerprint !== input.gemini.fingerprint || canonical.ticker !== input.gemini.ticker ||
          input.question !== canonical.question || input.source !== canonical.source ||
          input.yesRule !== canonical.yesRule || input.noRule !== canonical.noRule ||
          input.close > canonical.expiry || input.deadline <= canonical.expiry) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Use the pinned Gemini terms and a deadline after the linked event expires." });
        }
      }
    } else if (input.kind === "resolve") {
      await requireGeminiOutcome(db, input.marketId, input.side);
      await requireResolution(account, address, input);
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
  if (input.kind === "resolve") return { target: market, data: encodeFunctionData({
    abi: marketAbi, functionName: "resolve", args: [BigInt(input.marketId), input.side === "YES", referenceHash(input.reference)],
  }) };
  return { target: market, data: encodeFunctionData({
    abi: marketAbi, functionName: "create", args: [{
      question: input.question, source: input.source, yesRule: input.yesRule, noRule: input.noRule,
      close: BigInt(input.close), deadline: BigInt(input.deadline),
    }],
  }) };
}

export async function advanceStudentOperation(db: Database, account: Account, id: string, fromWorker = false) {
  return db.transaction(async (tx) => {
    const [op] = await tx.select().from(studentOperations)
      .where(and(eq(studentOperations.id, id), eq(studentOperations.accountId, account.id))).for("update");
    if (!op || (op.input.kind === "resolve" && !fromWorker)) throw new TRPCError({ code: "NOT_FOUND", message: "Action unavailable." });
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
      if (op.input.kind === "resolve") {
        const [reviewer] = await tx.select({ isReviewer: accounts.isReviewer }).from(accounts)
          .where(eq(accounts.id, account.id)).for("share");
        try {
          await requireGeminiOutcome(db, op.input.marketId, op.input.side);
          await requireResolution({ ...account, isReviewer: reviewer?.isReviewer ?? false }, address, op.input);
        }
        catch (error) {
          if (error instanceof TRPCError) return save({ stage: "failed" });
          throw error;
        }
      }
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
    if (input.kind === "resolve") {
      const valid = parseEventLogs({ abi: marketAbi, eventName: "Finalized", logs }).some(({ args }) =>
        args.id.toString() === input.marketId && args.status === (input.side === "YES" ? 2 : 3) &&
        args.evidence === referenceHash(input.reference));
      return save({ stage: valid ? "confirmed" : "failed" });
    }
    if (input.kind === "create") {
      const event = parseEventLogs({ abi: marketAbi, eventName: "MarketCreated", logs })
        .find(({ args }) => args.creator.toLowerCase() === address && args.campus === BigInt(account.unitid));
      if (event && input.gemini) {
        await tx.insert(geminiLinks).values({ marketId: event.args.id.toString(), ...input.gemini }).onConflictDoNothing();
      }
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
    and(eq(studentOperations.accountId, account.id), inArray(studentOperations.stage, active),
      sql`${studentOperations.input}->>'kind' <> 'resolve'`),
  ).orderBy(asc(studentOperations.createdAt));
  return rows.map(publicOperation);
}
