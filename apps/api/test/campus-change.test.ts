import { expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { eq, inArray, ne } from 'drizzle-orm';
import { beginVerification, confirmCampusChange, finishVerification } from '../src/auth/accounts';
import { connectDatabase } from '../src/db';
import { accounts, campusEmailDomains, emailChallenges } from '../src/schema';

test('campus verification belongs to one account and queues registration without changing its funds', async () => {
  const { db, client } = connectDatabase(process.env.DATABASE_URL!);
  const email = randomUUID() + '@utexas.edu';
  let newEmail = '';
  try {
    const [domain] = await db.select().from(campusEmailDomains).where(ne(campusEmailDomains.unitid, 228778)).limit(1);
    newEmail = randomUUID() + '@' + domain.domain;
    const [account] = await db.insert(accounts).values({ email, unitid: 228778, verifiedAt: new Date(), fundedAt: new Date(),
      creditCents: 1000, wallet: '0x' + randomUUID().replaceAll('-', '') + '00000000' }).returning();
    let code = '';
    const challenge = await beginVerification(db, newEmail, randomUUID(), async (_to, value) => { code = value; return 'test'; }, undefined, `campus:${account.id}`);
    await expect(finishVerification(db, challenge.challengeId, code, { password: 'separate-password' })).rejects.toThrow('invalid or expired');
    await expect(confirmCampusChange(db, randomUUID(), challenge.challengeId, code)).rejects.toThrow('invalid or expired');
    await expect(confirmCampusChange(db, account.id, challenge.challengeId, code === '000000' ? '111111' : '000000')).rejects.toThrow('invalid or expired');
    expect(await confirmCampusChange(db, account.id, challenge.challengeId, code)).toEqual({ pending: true });
    const [updated] = await db.select().from(accounts).where(eq(accounts.id, account.id));
    expect(updated).toMatchObject({ email: newEmail, unitid: 228778, pendingCampusId: domain.unitid, wallet: account.wallet, fundedAt: account.fundedAt });
    await expect(confirmCampusChange(db, account.id, challenge.challengeId, code)).rejects.toThrow('invalid or expired');
  } finally {
    await db.delete(emailChallenges).where(eq(emailChallenges.email, newEmail));
    await db.delete(accounts).where(inArray(accounts.email, [email, newEmail]));
    await client.end();
  }
});
