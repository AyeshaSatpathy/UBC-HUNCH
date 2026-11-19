import { expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { beginVerification, finishVerification, getSession, passwordLogin } from '../src/auth/accounts';
import { connectDatabase } from '../src/db';
import { accounts, emailChallenges, loginAttempts, sessions } from '../src/schema';

test('verified password signup, returning login, reset and throttling preserve the original account', async () => {
  const { db, client } = connectDatabase(process.env.DATABASE_URL!);
  const email = randomUUID() + '@utexas.edu';
  const requester = randomUUID();
  const password = 'hunch-test-password-123';
  let code = '';
  let accountId: string | undefined;
  try {
    const first = await beginVerification(db, email, requester, async (_email, value) => { code = value; return 'test'; });
    await expect(passwordLogin(db, email, password, requester)).rejects.toThrow('Email or password');
    const signup = await finishVerification(db, first.challengeId, code, { password, displayName: 'Alex' });
    const signed = await getSession(db, 'Bearer ' + signup.token);
    accountId = signed!.account.id;
    expect(signed!.account.displayName).toBe('Alex');
    expect(signed!.account.passwordHash).toStartWith('$argon2id$');
    expect(signed!.account.passwordHash).not.toBe(password);
    await expect(passwordLogin(db, email, 'wrong password', requester)).rejects.toThrow('Email or password');
    const login = await passwordLogin(db, email, password, requester);
    expect((await getSession(db, 'Bearer ' + login.token))!.account.id).toBe(accountId);
    await db.update(accounts).set({ fundedAt: new Date(), creditCents: 1000 }).where(eq(accounts.id, accountId!));
    await db.update(emailChallenges).set({ issuedAt: new Date(Date.now() - 61_000) }).where(eq(emailChallenges.id, first.challengeId));
    const reset = await beginVerification(db, email, requester, async (_email, value) => { code = value; return 'test'; });
    await finishVerification(db, reset.challengeId, code, { password: 'new-hunch-password-456' });
    expect(await getSession(db, 'Bearer ' + login.token)).toBeNull();
    await expect(passwordLogin(db, email, password, requester)).rejects.toThrow('Email or password');
    const updated = await passwordLogin(db, email, 'new-hunch-password-456', requester);
    const current = (await getSession(db, 'Bearer ' + updated.token))!.account;
    expect(current.id).toBe(accountId);
    expect(current.fundedAt).not.toBeNull();
    expect(current.creditCents).toBe(1000);
    expect(current.displayName).toBe('Alex');
    expect(await db.select().from(accounts).where(eq(accounts.email, email))).toHaveLength(1);
    await db.insert(loginAttempts).values(Array.from({ length: 15 }, () => ({ email, requester })));
    await expect(passwordLogin(db, email, 'new-hunch-password-456', requester)).rejects.toThrow('Too many sign-in attempts');
  } finally {
    if (accountId) await db.delete(sessions).where(eq(sessions.accountId, accountId));
    await db.delete(accounts).where(eq(accounts.email, email));
    await db.delete(emailChallenges).where(eq(emailChallenges.email, email));
    await db.delete(loginAttempts).where(eq(loginAttempts.email, email));
    await client.end();
  }
});
