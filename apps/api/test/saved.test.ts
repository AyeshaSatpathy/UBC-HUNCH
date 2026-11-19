import { expect, test } from 'bun:test';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { connectDatabase } from '../src/db';
import { appRouter } from '../src/router';
import { accounts, arcMarkets, savedMarkets, sessions } from '../src/schema';
import { chainId, market } from '../src/arc/contract';

test('bookmarks survive retries, remain private to their owner and remove cleanly', async () => {
  const { db, client } = connectDatabase(process.env.DATABASE_URL!);
  const id = BigInt('0x' + randomUUID().replaceAll('-', '')).toString();
  const created: string[] = [];
  try {
    const users = [];
    for (let i = 0; i < 2; i++) {
      const [account] = await db.insert(accounts).values({ email: randomUUID() + '@utexas.edu', unitid: 228778, verifiedAt: new Date(), creditCents: 1000 }).returning();
      created.push(account.id);
      const token = randomBytes(32).toString('base64url');
      await db.insert(sessions).values({ accountId: account.id, tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt: new Date(Date.now() + 60000) });
      users.push(appRouter.createCaller({ db, authorization: 'Bearer ' + token, requester: randomUUID() }));
    }
    await db.insert(arcMarkets).values({ chainId, contract: market, marketId: id, campusId: '228778', creator: '0x1', reviewer: '0x2',
      question: 'Will the library open?', source: 'Library hours', yesRule: 'Opens', noRule: 'Closed', closesAt: '1', evidenceDeadline: '2', status: 1,
      allocation: '20000000', sets: '20000000', yesReserve: '20000000', noReserve: '20000000', fees: '0', remainingClaims: '0', evidence: '0x0', indexedThrough: 1n });
    await Promise.all([users[0].markets.save({ marketId: id, saved: true }), users[0].markets.save({ marketId: id, saved: true })]);
    expect((await users[0].markets.saved()).map(item => item.id)).toEqual([id]);
    expect(await users[1].markets.saved()).toEqual([]);
    await users[1].markets.save({ marketId: id, saved: false });
    expect(await db.select().from(savedMarkets).where(eq(savedMarkets.marketId, id))).toHaveLength(1);
    await users[0].auth.dismissGuide();
    expect((await users[0].auth.me()).hasSeenGuide).toBe(true);
    expect((await users[1].auth.me()).hasSeenGuide).toBe(false);
    await users[0].auth.showGuide();
    expect((await users[0].auth.me()).hasSeenGuide).toBe(false);
    await users[0].markets.save({ marketId: id, saved: false });
    expect(await users[0].markets.saved()).toEqual([]);
    const guest = appRouter.createCaller({ db, requester: 'guest' });
    await expect(guest.markets.save({ marketId: id, saved: true })).rejects.toThrow('UNAUTHORIZED');
  } finally {
    if (created.length) {
      await db.delete(savedMarkets).where(inArray(savedMarkets.accountId, created));
      await db.delete(sessions).where(inArray(sessions.accountId, created));
      await db.delete(accounts).where(inArray(accounts.id, created));
    }
    await db.delete(arcMarkets).where(eq(arcMarkets.marketId, id));
    await client.end();
  }
});
