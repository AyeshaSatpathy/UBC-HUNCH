import { expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { depositHistory, depositStatus, submitDeposit } from '../src/arc/deposits';
import { connectDatabase } from '../src/db';
import { accounts, deposits } from '../src/schema';

test('deposits keep an owned receipt across retries, reject insufficient funds and cap confirmed credits', async () => {
  const { db, client } = connectDatabase(process.env.DATABASE_URL!);
  const previous = process.env.ENABLE_TEST_DEPOSITS;
  process.env.ENABLE_TEST_DEPOSITS = 'true';
  let accountId: string | undefined;
  try {
    const [account] = await db.insert(accounts).values({ email: randomUUID() + '@utexas.edu', unitid: 228778,
      verifiedAt: new Date(), creditCents: 1000, wallet: '0x' + randomUUID().replaceAll('-', '') + '00000000', fundedAt: new Date() }).returning();
    accountId = account.id;
    const input = { requestKey: randomUUID(), cents: 1000, card: '4242' as const };
    const funds = async () => 30_000_000n;
    await expect(submitDeposit(db, account, input, async () => 0n)).rejects.toThrow('Choose a smaller deposit');
    expect((await depositHistory(db, account)).deposits).toHaveLength(0);
    const declined = await submitDeposit(db, account, { ...input, card: '0002' }, async () => { throw new Error('No transfer lookup expected'); });
    expect(declined.status).toBe('declined');
    const next = { ...input, requestKey: randomUUID() };
    const [created, replayed] = await Promise.all([submitDeposit(db, account, next, funds), submitDeposit(db, account, next, funds)]);
    expect(created.status).toBe('pending');
    expect(replayed.id).toBe(created.id);
    await expect(submitDeposit(db, account, { ...next, cents: 500 }, funds)).rejects.toThrow('new checkout');
    await expect(submitDeposit(db, account, { ...next, requestKey: randomUUID() }, funds)).rejects.toThrow('already processing');
    await expect(depositStatus(db, randomUUID(), created.id)).rejects.toThrow('Deposit not found');
    expect(await depositStatus(db, account.id, created.id)).toEqual(created);
    await db.update(deposits).set({ status: 'confirmed' }).where(eq(deposits.id, created.id));
    await expect(submitDeposit(db, account, { ...next, cents: 2500, requestKey: randomUUID() }, funds)).rejects.toThrow('up to $25');
    expect((await depositHistory(db, account)).deposits).toHaveLength(2);
  } finally {
    if (accountId) {
      await db.delete(deposits).where(eq(deposits.accountId, accountId));
      await db.delete(accounts).where(eq(accounts.id, accountId));
    }
    if (previous === undefined) delete process.env.ENABLE_TEST_DEPOSITS;
    else process.env.ENABLE_TEST_DEPOSITS = previous;
    await client.end();
  }
});
