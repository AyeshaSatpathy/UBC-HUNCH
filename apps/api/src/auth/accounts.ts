/// <reference types="node" />
/// <reference types="bun" />
import { createHash, createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { and, count, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { startingBalanceCents } from "../config";
import type { Database } from "../db";
import { accounts, campusEmailDomains, emailChallenges, loginAttempts, sessions, studentOperations } from "../schema";
import { sendCode } from "./mail";

const lifetime = 10 * 60_000;
const maxAttempts = 5;
export const schoolEmail = z.string().trim().max(254).pipe(z.email()).transform((email) => email.toLowerCase())
  .refine((email) => email.endsWith(".edu"), "Enter a .edu email address");

const digest = (token: string) => createHash("sha256").update(token).digest("hex");
function codeDigest(id: string, code: string) {
  const secret = process.env.AUTH_CODE_SECRET?.trim();
  if (!secret || !/^[a-f0-9]{64}$/i.test(secret)) {
    throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Email verification is unavailable" });
  }
  return createHmac("sha256", Buffer.from(secret, "hex")).update(id).update(":").update(code).digest("hex");
}

export async function beginVerification(db: Database, email: string, requester: string, mail = sendCode, campusId?: number, intent: 'signup' | 'reset' | 'legacy' | `campus:${string}` = 'legacy') {
  const id = randomUUID();
  const code = String(randomInt(1_000_000)).padStart(6, "0");
  const codeHash = codeDigest(id, code);
  const domain = email.slice(email.lastIndexOf("@") + 1);
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${"email:" + email}, 0))`);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${"requester:" + requester}, 0))`);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('hunch-brevo-budget', 0))`);
    const now = new Date();
    const since = new Date(now.getTime() - 60 * 60_000);
    const [perEmail] = await tx.select({ count: count(), latest: sql<Date | null>`max(${emailChallenges.issuedAt})` })
      .from(emailChallenges).where(and(eq(emailChallenges.email, email), gt(emailChallenges.issuedAt, since)));
    const [perRequester] = await tx.select({ count: count() }).from(emailChallenges)
      .where(and(eq(emailChallenges.requester, requester), gt(emailChallenges.issuedAt, since)));
    const [daily] = await tx.select({ count: count() }).from(emailChallenges)
      .where(gt(emailChallenges.issuedAt, new Date(now.getTime() - 24 * 60 * 60_000)));
    if (perEmail.count >= 5 || perRequester.count >= 20 || daily.count >= 280 ||
        (perEmail.latest && now.getTime() - new Date(perEmail.latest).getTime() < 60_000)) {
      throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Please wait before requesting another code" });
    }
    const [existing] = await tx.select({ unitid: accounts.unitid }).from(accounts).where(eq(accounts.email, email));
    if (existing && intent.startsWith('campus:')) {
      throw new TRPCError({ code: 'CONFLICT', message: 'Use a school email that is not already linked to Hunch.' });
    }
    const [mapped] = await tx.select().from(campusEmailDomains).where(eq(campusEmailDomains.domain, domain));
    const campus = existing ?? mapped;
    if (!campus) throw new TRPCError({ code: "BAD_REQUEST", message: "This school email domain is not supported" });
    if (intent.startsWith('campus:')) {
      const [account] = await tx.select({ unitid: accounts.unitid }).from(accounts).where(eq(accounts.id, intent.slice(7)));
      if (account?.unitid === campus.unitid) throw new TRPCError({ code: 'BAD_REQUEST', message: 'That email belongs to your current campus.' });
    }
    if (campusId !== undefined && campus.unitid !== campusId) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "This email does not match the selected campus." });
    }
    await tx.update(emailChallenges).set({ consumedAt: now }).where(
      and(eq(emailChallenges.email, email), isNull(emailChallenges.consumedAt)),
    );
    await tx.insert(emailChallenges).values({ id, email, requester, unitid: campus.unitid, codeHash, intent,
      issuedAt: now, expiresAt: new Date(now.getTime() + lifetime) });
  });
  try {
    await mail(email, code);
  } catch {
    await db.update(emailChallenges).set({ consumedAt: new Date() }).where(eq(emailChallenges.id, id));
    throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "The code could not be sent. Please retry later" });
  }
  return { challengeId: id, expiresInSeconds: lifetime / 1_000 };
}

export async function finishVerification(db: Database, id: string, code: string, profile?: { password: string; displayName?: string }) {
  const hash = codeDigest(id, code);
  const token = randomBytes(32).toString("base64url");
  const result = await db.transaction(async (tx) => {
    const [challenge] = await tx.select().from(emailChallenges).where(eq(emailChallenges.id, id)).for("update");
    const now = new Date();
    if (!challenge || challenge.intent.startsWith('campus:') || challenge.consumedAt || challenge.expiresAt <= now || challenge.attempts >= maxAttempts) return;
    if (!timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(challenge.codeHash, "hex"))) {
      await tx.update(emailChallenges).set({ attempts: challenge.attempts + 1 }).where(eq(emailChallenges.id, id));
      return;
    }
    const [existing] = await tx.select().from(accounts).where(eq(accounts.email, challenge.email));
    if (!profile && !existing?.isReviewer) throw new TRPCError({ code: "BAD_REQUEST", message: "Complete sign up and choose a password to continue." });
    if (profile && challenge.intent === 'reset' && !existing?.passwordHash) throw new TRPCError({ code: "BAD_REQUEST", message: "Complete Sign up first to create your password." });
    if (profile && challenge.intent === 'signup' && existing?.passwordHash) throw new TRPCError({ code: "BAD_REQUEST", message: "You already have an account. Use Log in or Reset password." });
    const [mapped] = await tx.select().from(campusEmailDomains)
      .where(eq(campusEmailDomains.domain, challenge.email.split("@").at(-1)!));
    const campus = existing ?? mapped;
    if (campus?.unitid !== challenge.unitid) return;
    await tx.update(emailChallenges).set({ consumedAt: now }).where(eq(emailChallenges.id, id));
    await tx.insert(accounts).values({
      email: challenge.email, unitid: challenge.unitid, verifiedAt: now, creditCents: startingBalanceCents(),
    }).onConflictDoNothing({ target: accounts.email });
    const [account] = await tx.select().from(accounts).where(eq(accounts.email, challenge.email));
    if (account.unitid !== challenge.unitid) return;
    if (profile) {
      const passwordHash = await Bun.password.hash(profile.password, { algorithm: "argon2id", memoryCost: 65536, timeCost: 2 });
      await tx.update(accounts).set({ passwordHash, ...(profile.displayName ? { displayName: profile.displayName } : {}) }).where(eq(accounts.id, account.id));
      await tx.delete(sessions).where(eq(sessions.accountId, account.id));
    }
    const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60_000);
    await tx.insert(sessions).values({ accountId: account.id, tokenHash: digest(token), expiresAt });
    return { token, expiresAt: expiresAt.toISOString(), campusId: account.unitid };
  });
  if (!result) throw new TRPCError({ code: "BAD_REQUEST", message: "The code is invalid or expired" });
  return result;
}

export async function confirmCampusChange(db: Database, accountId: string, id: string, code: string) {
  const confirmed = await db.transaction(async tx => {
    const [challenge] = await tx.select().from(emailChallenges).where(eq(emailChallenges.id, id)).for('update');
    const now = new Date();
    if (!challenge || challenge.intent !== `campus:${accountId}` || challenge.consumedAt || challenge.expiresAt <= now || challenge.attempts >= maxAttempts) return false;
    if (!timingSafeEqual(Buffer.from(codeDigest(id, code), 'hex'), Buffer.from(challenge.codeHash, 'hex'))) {
      await tx.update(emailChallenges).set({ attempts: challenge.attempts + 1 }).where(eq(emailChallenges.id, id));
      return false;
    }
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${'student-operation:' + accountId}, 0))`);
    const [account] = await tx.select().from(accounts).where(eq(accounts.id, accountId)).for('update');
    if (!account?.fundedAt || !account.wallet || account.pendingCampusId || account.unitid === challenge.unitid || account.isReviewer) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'This campus change is unavailable for your account.' });
    }
    const [active] = await tx.select({ id: studentOperations.id }).from(studentOperations)
      .where(and(eq(studentOperations.accountId, accountId), inArray(studentOperations.stage, ['approval', 'submit']))).limit(1);
    if (active) throw new TRPCError({ code: 'CONFLICT', message: 'Wait for your pending market action to finish.' });
    const [mapped] = await tx.select().from(campusEmailDomains).where(eq(campusEmailDomains.domain, challenge.email.split('@').at(-1)!));
    if (mapped?.unitid !== challenge.unitid) return false;
    await tx.update(emailChallenges).set({ consumedAt: now }).where(eq(emailChallenges.id, id));
    await tx.update(accounts).set({ email: challenge.email, pendingCampusId: challenge.unitid, registrationTx: null }).where(eq(accounts.id, accountId));
    return true;
  }).catch(error => {
    if (error?.cause?.code === '23505') throw new TRPCError({ code: 'CONFLICT', message: 'Use a school email that is not already linked to Hunch.' });
    throw error;
  });
  if (!confirmed) throw new TRPCError({ code: 'BAD_REQUEST', message: 'The code is invalid or expired' });
  return { pending: true };
}

export async function getSession(db: Database, authorization?: string) {
  const token = authorization?.match(/^Bearer ([A-Za-z0-9_-]{43})$/i)?.[1];
  if (!token) return null;
  const tokenHash = digest(token);
  const [result] = await db.select({ account: accounts, tokenHash: sessions.tokenHash }).from(sessions)
    .innerJoin(accounts, eq(accounts.id, sessions.accountId))
    .where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, new Date())));
  return result ?? null;
}

let dummyHash: Promise<string> | undefined;
export async function passwordLogin(db: Database, email: string, password: string, requester: string) {
  dummyHash ??= Bun.password.hash(randomBytes(32).toString("hex"), { algorithm: "argon2id", memoryCost: 65536, timeCost: 2 });
  const token = randomBytes(32).toString("base64url");
  const result = await db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${"password-email:" + email}, 0))`);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${"password-ip:" + requester}, 0))`);
    const since = new Date(Date.now() - 15 * 60_000);
    const [emailCount] = await tx.select({ value: count() }).from(loginAttempts).where(and(eq(loginAttempts.email, email), gt(loginAttempts.issuedAt, since)));
    const [ipCount] = await tx.select({ value: count() }).from(loginAttempts).where(and(eq(loginAttempts.requester, requester), gt(loginAttempts.issuedAt, since)));
    if (emailCount.value >= 15 || ipCount.value >= 50) throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Too many sign-in attempts. Try again in 15 minutes." });
    await tx.insert(loginAttempts).values({ email, requester });
    const [account] = await tx.select().from(accounts).where(eq(accounts.email, email)).for("share");
    const valid = await Bun.password.verify(password, account?.passwordHash ?? await dummyHash!);
    if (!valid || !account?.passwordHash) return null;
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60_000);
    await tx.insert(sessions).values({ accountId: account.id, tokenHash: digest(token), expiresAt });
    return { token, expiresAt: expiresAt.toISOString(), campusId: account.unitid };
  });
  if (!result) throw new TRPCError({ code: "BAD_REQUEST", message: "Email or password is incorrect. You can also sign in with an email code." });
  return result;
}
