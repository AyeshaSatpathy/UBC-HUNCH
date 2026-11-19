import { createHash, createPublicKey, randomBytes, randomUUID, verify, type JsonWebKey } from 'node:crypto';
import { TRPCError } from '@trpc/server';
import { and, count, eq, gt, lt, sql } from 'drizzle-orm';
import { z } from 'zod';
import { startingBalanceCents } from '../config';
import type { Database } from '../db';
import { accounts, campusEmailDomains, googleSignIns, sessions } from '../schema';
import { schoolEmail } from './accounts';

const sha256 = (value: string) => createHash('sha256').update(value);
const ttl = 10 * 60_000;
const googleClaims = z.object({
  sub: z.string().min(1).max(255), aud: z.string(), iss: z.enum(['https://accounts.google.com', 'accounts.google.com']),
  exp: z.number(), nonce: z.string(), email: schoolEmail, email_verified: z.literal(true), hd: z.string().min(1),
  given_name: z.string().optional(),
});

function config() {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  const redirectUri = process.env.GOOGLE_REDIRECT_URI?.trim();
  if (!clientId || !clientSecret || !redirectUri) return null;
  const url = URL.parse(redirectUri);
  if (!url || url.pathname !== '/auth/google/callback' || url.search || url.hash || url.username || url.password) return null;
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) return null;
  return { clientId, clientSecret, redirectUri };
}

export async function startGoogleSignIn(db: Database, intent: 'login' | 'signup', requester: string) {
  const settings = config();
  if (!settings) throw new TRPCError({ code: 'SERVICE_UNAVAILABLE', message: 'Google sign-in is not configured. Use school email to continue.' });
  const id = randomUUID();
  const proof = randomBytes(32).toString('base64url');
  const verifier = randomBytes(32).toString('base64url');
  const now = new Date();
  await db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${'google-ip:' + requester}, 0))`);
    const [recent] = await tx.select({ total: count() }).from(googleSignIns).where(and(eq(googleSignIns.requester, requester), gt(googleSignIns.expiresAt, now)));
    if (recent.total >= 15) throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: 'Too many Google sign-in attempts. Try again shortly.' });
    await tx.delete(googleSignIns).where(lt(googleSignIns.expiresAt, new Date(now.getTime() - ttl)));
    await tx.insert(googleSignIns).values({ id, proofHash: sha256(proof).digest('hex'), verifier, intent, requester, expiresAt: new Date(now.getTime() + ttl) });
  });
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({ client_id: settings.clientId, redirect_uri: settings.redirectUri, response_type: 'code',
    scope: 'openid email profile', state: id, nonce: id, code_challenge: sha256(verifier).digest('base64url'),
    code_challenge_method: 'S256', prompt: 'select_account' }).toString();
  return { id, proof, url: url.href };
}

async function verifiedClaims(idToken: string, clientId: string, nonce: string) {
  const parts = idToken.split('.');
  if (parts.length !== 3) return null;
  const [header, body, signature] = parts;
  const { kid } = z.object({ kid: z.string(), alg: z.literal('RS256') }).parse(JSON.parse(Buffer.from(header, 'base64url').toString()));
  const response = await fetch('https://www.googleapis.com/oauth2/v3/certs', { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error('Google signing keys unavailable');
  const { keys } = await response.json() as { keys: (JsonWebKey & { kid?: string })[] };
  const key = keys.find(candidate => candidate.kid === kid && candidate.kty === 'RSA');
  if (!key || !verify('RSA-SHA256', Buffer.from(`${header}.${body}`), createPublicKey({ key, format: 'jwk' }), Buffer.from(signature, 'base64url'))) return null;
  const parsed = googleClaims.safeParse(JSON.parse(Buffer.from(body, 'base64url').toString()));
  if (!parsed.success || parsed.data.aud !== clientId || parsed.data.nonce !== nonce || parsed.data.exp <= Date.now() / 1000) return null;
  if (parsed.data.email.split('@').at(-1) !== parsed.data.hd.toLowerCase()) return null;
  return parsed.data;
}

export async function finishGoogleCallback(db: Database, state: string, code?: string, cancelled = false) {
  const settings = config();
  if (!settings || !z.uuid().safeParse(state).success) return;
  await db.transaction(async tx => {
    const [attempt] = await tx.select().from(googleSignIns).where(eq(googleSignIns.id, state)).for('update');
    if (!attempt || attempt.result || attempt.expiresAt <= new Date()) return;
    const finish = (result: NonNullable<(typeof googleSignIns.$inferSelect)['result']>, accountId?: string) => tx.update(googleSignIns)
      .set({ result, accountId, verifier: '' }).where(eq(googleSignIns.id, state));
    if (!code || cancelled) { await finish(cancelled ? 'cancelled' : 'failed'); return; }
    let identity: Awaited<ReturnType<typeof verifiedClaims>>;
    try {
      const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', signal: AbortSignal.timeout(10_000),
        body: new URLSearchParams({ client_id: settings.clientId, client_secret: settings.clientSecret, redirect_uri: settings.redirectUri,
          code, code_verifier: attempt.verifier, grant_type: 'authorization_code' }) });
      if (!response.ok) throw new Error('Google token exchange failed');
      const { id_token } = z.object({ id_token: z.string() }).parse(await response.json());
      identity = await verifiedClaims(id_token, settings.clientId, state);
    } catch { await finish('failed'); return; }
    if (!identity) { await finish('school-email'); return; }
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${'email:' + identity.email}, 0))`);
    const [campus] = await tx.select().from(campusEmailDomains).where(eq(campusEmailDomains.domain, identity.hd.toLowerCase()));
    if (!campus) { await finish('school-email'); return; }
    const [linked] = await tx.select({ email: accounts.email }).from(accounts).where(eq(accounts.googleSubject, identity.sub));
    if (linked && linked.email !== identity.email) { await finish('school-email'); return; }
    const [account] = await tx.select().from(accounts).where(eq(accounts.email, identity.email)).for('update');
    if (!account && attempt.intent === 'login') { await finish('account-missing'); return; }
    if (account) {
      const expectedCampus = account.pendingCampusId ?? account.unitid;
      if (expectedCampus !== campus.unitid || (account.googleSubject && account.googleSubject !== identity.sub)) { await finish('school-email'); return; }
      await tx.update(accounts).set({ googleSubject: identity.sub }).where(eq(accounts.id, account.id));
      await finish('approved', account.id);
      return;
    }
    const [created] = await tx.insert(accounts).values({ email: identity.email, googleSubject: identity.sub, unitid: campus.unitid,
      verifiedAt: new Date(), displayName: identity.given_name?.trim().slice(0, 40) || null, creditCents: startingBalanceCents() })
      .onConflictDoNothing().returning({ id: accounts.id });
    if (!created) { await finish('failed'); return; }
    await finish('approved', created.id);
  });
}

export async function claimGoogleSignIn(db: Database, id: string, proof: string) {
  return db.transaction(async tx => {
    const now = new Date();
    const [attempt] = await tx.select().from(googleSignIns).where(and(eq(googleSignIns.id, id), eq(googleSignIns.proofHash, sha256(proof).digest('hex')))).for('update');
    if (!attempt || attempt.consumedAt || attempt.expiresAt <= now) return { status: 'expired' as const };
    if (!attempt.result) return { status: 'pending' as const };
    if (attempt.result !== 'approved' || !attempt.accountId) return { status: attempt.result === 'approved' ? 'failed' as const : attempt.result };
    const token = randomBytes(32).toString('base64url');
    await tx.insert(sessions).values({ accountId: attempt.accountId, tokenHash: sha256(token).digest('hex'), expiresAt: new Date(now.getTime() + 30 * 86_400_000) });
    await tx.update(googleSignIns).set({ consumedAt: now }).where(eq(googleSignIns.id, id));
    return { status: 'approved' as const, token };
  });
}
