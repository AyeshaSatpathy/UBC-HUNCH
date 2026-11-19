import { expect, spyOn, test } from 'bun:test';
import { generateKeyPairSync, randomBytes, randomUUID, sign } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { claimGoogleSignIn, finishGoogleCallback, startGoogleSignIn } from '../src/auth/google';
import { getSession } from '../src/auth/accounts';
import { connectDatabase } from '../src/db';
import { accounts, googleSignIns, sessions } from '../src/schema';

test('Google sign-in requires a verified campus and an app proof, and issues a session once', async () => {
  const { db, client } = connectDatabase(process.env.DATABASE_URL!);
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const email = randomUUID() + '@utexas.edu';
  const requester = randomUUID();
  const env = { GOOGLE_CLIENT_ID: 'hunch-test-client', GOOGLE_CLIENT_SECRET: 'local-test', GOOGLE_REDIRECT_URI: 'http://localhost:3000/auth/google/callback' };
  const prior = Object.fromEntries(Object.keys(env).map(name => [name, process.env[name]]));
  Object.assign(process.env, env);
  let claims: Record<string, unknown> = {};
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const fakeFetch = Object.assign(async (input: Parameters<typeof fetch>[0]) => {
    if (String(input).endsWith('/certs')) return Response.json({ keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'local' }] });
    const unsigned = encode({ alg: 'RS256', kid: 'local' }) + '.' + encode(claims);
    return Response.json({ id_token: unsigned + '.' + sign('RSA-SHA256', Buffer.from(unsigned), privateKey).toString('base64url') });
  }, { preconnect: fetch.preconnect });
  const fetcher = spyOn(globalThis, 'fetch').mockImplementation(fakeFetch);
  try {
    const subject = randomUUID();
    const finish = async (intent: 'login' | 'signup', overrides: Record<string, unknown> = {}) => {
      const flow = await startGoogleSignIn(db, intent, requester);
      expect(new URL(flow.url).searchParams.get('code_challenge_method')).toBe('S256');
      claims = { sub: subject, aud: env.GOOGLE_CLIENT_ID, iss: 'https://accounts.google.com', exp: Date.now() / 1000 + 120,
        nonce: flow.id, email, email_verified: true, hd: 'utexas.edu', given_name: 'Aisha', ...overrides };
      await finishGoogleCallback(db, flow.id, 'local-code');
      return flow;
    };
    const unverified = await finish('signup', { hd: undefined });
    expect(await claimGoogleSignIn(db, unverified.id, unverified.proof)).toEqual({ status: 'school-email' });
    const wrongAudience = await finish('signup', { aud: 'different-client' });
    expect(await claimGoogleSignIn(db, wrongAudience.id, wrongAudience.proof)).toEqual({ status: 'school-email' });
    const missing = await finish('login');
    expect(await claimGoogleSignIn(db, missing.id, missing.proof)).toEqual({ status: 'account-missing' });
    const signup = await finish('signup');
    expect(await claimGoogleSignIn(db, signup.id, randomBytes(32).toString('base64url'))).toEqual({ status: 'expired' });
    const accepted = await claimGoogleSignIn(db, signup.id, signup.proof);
    if (accepted.status !== 'approved') throw new Error('Expected an approved session');
    expect(await claimGoogleSignIn(db, signup.id, signup.proof)).toEqual({ status: 'expired' });
    const session = await getSession(db, 'Bearer ' + accepted.token);
    expect(session?.account).toMatchObject({ email, googleSubject: subject, unitid: 228778, displayName: 'Aisha' });
    const login = await finish('login');
    expect((await claimGoogleSignIn(db, login.id, login.proof)).status).toBe('approved');
    expect(await db.select().from(accounts).where(eq(accounts.email, email))).toHaveLength(1);
  } finally {
    fetcher.mockRestore();
    await db.delete(googleSignIns).where(eq(googleSignIns.requester, requester));
    const rows = await db.select({ id: accounts.id }).from(accounts).where(eq(accounts.email, email));
    if (rows.length) await db.delete(sessions).where(inArray(sessions.accountId, rows.map(row => row.id)));
    await db.delete(accounts).where(eq(accounts.email, email));
    await client.end();
    for (const [name, value] of Object.entries(prior)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
