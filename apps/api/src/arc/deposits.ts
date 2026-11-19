import { TRPCError } from '@trpc/server';
import { and, asc, desc, eq, gte, sql } from 'drizzle-orm';
import { encodeFunctionData, isAddress, parseEventLogs, type Address, type Hash } from 'viem';
import type { Database } from '../db';
import { accounts, arcEvents, arcMarkets, deposits } from '../schema';
import { chainId, collateralAbi, createArcClient, market, usdc } from './contract';
import { centsToUnits } from './market-api';

type Deposit = typeof deposits.$inferSelect;
const receipt = ({ id, cents, card, status, createdAt }: Deposit) => ({ id, cents, card, status, createdAt });
const arc = createArcClient();
export const testDepositsEnabled = () => process.env.ENABLE_TEST_DEPOSITS === 'true';

async function availableTestFunds() {
  const treasury = process.env.ARC_TREASURY_ADDRESS?.trim();
  if (!treasury || !isAddress(treasury)) return 0n;
  try { return await arc.readContract({ address: usdc, abi: collateralAbi, functionName: 'balanceOf', args: [treasury] }); }
  catch { throw new TRPCError({ code: 'SERVICE_UNAVAILABLE', message: 'Could not check deposit availability. Try again.' }); }
}

export async function submitDeposit(db: Database, account: typeof accounts.$inferSelect,
  input: { cents: number; card: Deposit['card']; requestKey: string }, available = availableTestFunds) {
  return db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${'deposit:' + account.id}, 0))`);
    const owned = eq(deposits.accountId, account.id);
    const [prior] = await tx.select().from(deposits).where(and(owned, eq(deposits.requestKey, input.requestKey))).limit(1);
    if (prior) {
      if (prior.cents !== input.cents || prior.card !== input.card) throw new TRPCError({ code: 'CONFLICT', message: 'Open a new checkout to change the amount or card.' });
      return receipt(prior);
    }
    if (!testDepositsEnabled() || !account.wallet || !account.fundedAt) {
      throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Deposits are unavailable for your account right now.' });
    }
    const [pending] = await tx.select({ id: deposits.id }).from(deposits).where(and(owned, eq(deposits.status, 'pending'))).limit(1);
    if (pending) throw new TRPCError({ code: 'CONFLICT', message: 'A deposit is already processing. Check Portfolio for its status.' });
    if (input.card !== '4242' && input.card !== account.addedCard && input.card !== '0002') {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Add this card before using it.' });
    }
    if (input.card !== '0002') {
      const [recent] = await tx.select({ cents: sql<number>`coalesce(sum(${deposits.cents}), 0)::int` }).from(deposits).where(and(
        owned, eq(deposits.status, 'confirmed'), gte(deposits.createdAt, new Date(Date.now() - 86_400_000)),
      ));
      if (recent.cents + input.cents > 2500) throw new TRPCError({ code: 'BAD_REQUEST', message: 'You can add up to $25 every 24 hours.' });
      if (await available() < centsToUnits(input.cents)) throw new TRPCError({ code: 'BAD_REQUEST', message: 'This amount is unavailable. Choose a smaller deposit or try again later.' });
    }
    const [created] = await tx.insert(deposits).values({ ...input, accountId: account.id, status: input.card === '0002' ? 'declined' : 'pending' }).returning();
    return receipt(created);
  });
}

export async function depositHistory(db: Database, account: typeof accounts.$inferSelect) {
  const [records, orders] = await Promise.all([
    db.select().from(deposits).where(eq(deposits.accountId, account.id)).orderBy(desc(deposits.createdAt)).limit(20),
    account.wallet ? db.select({ id: sql<string>`${arcEvents.transactionHash} || '-' || ${arcEvents.logIndex}::text`,
      question: arcMarkets.question, side: sql<boolean>`(${arcEvents.args}->>'yes')::boolean`,
      paidCents: sql<string>`ceil(((${arcEvents.args}->>'principal')::numeric + (${arcEvents.args}->>'fee')::numeric) / 10000)::text`,
    }).from(arcEvents).innerJoin(arcMarkets, and(eq(arcMarkets.chainId, arcEvents.chainId), eq(arcMarkets.contract, arcEvents.contract), eq(arcMarkets.marketId, arcEvents.marketId)))
      .where(and(eq(arcEvents.chainId, chainId), eq(arcEvents.contract, market), eq(arcEvents.name, 'Purchased'), eq(arcEvents.wallet, account.wallet)))
      .orderBy(desc(arcEvents.blockNumber), desc(arcEvents.logIndex)).limit(20) : [],
  ]);
  return { enabled: testDepositsEnabled(), addedCard: account.addedCard, deposits: records.map(receipt), purchases: orders };
}

export async function depositStatus(db: Database, accountId: string, id: string) {
  const [record] = await db.select().from(deposits).where(and(eq(deposits.accountId, accountId), eq(deposits.id, id))).limit(1);
  if (!record) throw new TRPCError({ code: 'NOT_FOUND', message: 'Deposit not found.' });
  return receipt(record);
}

export async function advanceDeposit(db: Database, treasury: Address, treasuryWalletId: string) {
  const { circle, findCircleTransaction, requestId } = await import('../seed/circle');
  return db.transaction(async tx => {
    const [lock] = await tx.execute<{ locked: boolean }>(sql`select pg_try_advisory_xact_lock(hashtextextended('hunch-account-provisioning', 0)) as locked`);
    if (!lock?.locked) return;
    const [row] = await tx.select({ deposit: deposits, wallet: accounts.wallet }).from(deposits)
      .innerJoin(accounts, eq(accounts.id, deposits.accountId)).where(eq(deposits.status, 'pending'))
      .orderBy(asc(deposits.createdAt), asc(deposits.id)).limit(1);
    if (!row?.wallet) return;
    const { deposit, wallet } = row;
    const amount = centsToUnits(deposit.cents);
    const save = (values: Partial<Deposit>) => tx.update(deposits).set(values).where(eq(deposits.id, deposit.id));
    if (!deposit.circleId) {
      const refId = 'deposit:' + deposit.id;
      const existing = await findCircleTransaction(treasuryWalletId, refId, deposit.createdAt);
      if (existing) { await save({ circleId: existing.id }); return; }
      const available = await arc.readContract({ address: usdc, abi: collateralAbi, functionName: 'balanceOf', args: [treasury] });
      if (available < amount) return;
      const transfer = await circle.createContractExecutionTransaction({ walletId: treasuryWalletId, contractAddress: usdc,
        callData: encodeFunctionData({ abi: collateralAbi, functionName: 'transfer', args: [wallet as Address, amount] }),
        fee: { type: 'level', config: { feeLevel: 'MEDIUM' } }, idempotencyKey: requestId(refId), refId });
      if (!transfer.data?.id) throw new Error('Deposit transfer ID is missing.');
      await save({ circleId: transfer.data.id });
      return;
    }
    const transfer = (await circle.getTransaction({ id: deposit.circleId })).data?.transaction;
    if (!transfer) return;
    if (['FAILED', 'DENIED', 'CANCELLED'].includes(transfer.state)) { await save({ status: 'failed' }); return; }
    if (transfer.state !== 'COMPLETE' || !transfer.txHash) return;
    const proof = await arc.getTransactionReceipt({ hash: transfer.txHash as Hash });
    if (proof.status === 'reverted') { await save({ status: 'failed' }); return; }
    const confirmed = parseEventLogs({ abi: collateralAbi, eventName: 'Transfer',
      logs: proof.logs.filter(log => log.address.toLowerCase() === usdc),
    }).some(({ args }) => args.from.toLowerCase() === treasury && args.to.toLowerCase() === wallet && args.value === amount);
    if (!confirmed) throw new Error('Deposit receipt requires review.');
    await save({ status: 'confirmed' });
  });
}
