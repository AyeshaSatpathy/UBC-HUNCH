import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "./db";
import { geminiLinks, geminiOdds } from "./schema";

const price = z.string().regex(/^(?:0(?:\.\d+)?|1(?:\.0+)?)$/);
const contractSchema = z.object({
  id: z.string().min(1), ticker: z.string().min(1), label: z.string(), status: z.string(),
  description: z.unknown(), expiryDate: z.iso.datetime(), termsAndConditionsUrl: z.url(),
  resolutionSide: z.string().nullish(), resolvedAt: z.iso.datetime().nullish(),
  prices: z.object({ buy: z.object({ yes: price.optional() }).optional(), lastTradePrice: price.nullish() }),
  priceHistory: z.array(z.object({ timestamp: z.iso.datetime(), price })).nullish(),
});
const eventSchema = z.object({
  id: z.string(), ticker: z.string(), title: z.string(), status: z.string(), category: z.string().optional(),
  contracts: z.array(contractSchema),
});
export type GeminiContract = z.infer<typeof contractSchema>;
export type GeminiEvent = z.infer<typeof eventSchema>;
export type Pin = { eventTicker: string; contractId: string; ticker: string; fingerprint: string };
const origin = "https://api.gemini.com/v1/prediction-markets/events";
const cache = new Map<string, { expires: number; value: unknown }>();
async function read(path: string, ttl = 10_000): Promise<unknown> {
  const prior = cache.get(path);
  if (ttl && prior && prior.expires > Date.now()) return prior.value;
  try {
    const response = await fetch(origin + path, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error("Gemini HTTP " + response.status);
    const value = await response.json();
    if (cache.size > 100) cache.clear();
    if (ttl) cache.set(path, { value, expires: Date.now() + ttl });
    return value;
  } catch { throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Gemini market data is unavailable." }); }
}

function text(value: unknown): string {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  const node = value as { value?: unknown; content?: unknown[] };
  return [typeof node.value === "string" ? node.value : "", ...(node.content ?? []).map(text)].filter(Boolean).join("\n");
}

export function describe(event: GeminiEvent, contract: GeminiContract) {
  const rules = text(contract.description).trim();
  const data = {
    eventTicker: event.ticker, contractId: contract.id, ticker: contract.ticker,
    question: event.title + " — " + contract.label,
    source: contract.termsAndConditionsUrl,
    yesRule: rules, noRule: "The selected Gemini contract settles NO under the same published rules.",
    expiry: Math.floor(Date.parse(contract.expiryDate) / 1000),
  };
  const fingerprint = createHash("sha256").update(JSON.stringify(data)).digest("hex");
  return { ...data, fingerprint, status: contract.status };
}

export async function getGeminiContract(eventTicker: string, contractId: string, fresh = false) {
  const event = eventSchema.parse(await read("/" + encodeURIComponent(eventTicker), fresh ? 0 : 10_000));
  if (event.ticker !== eventTicker) throw new Error("Gemini event ticker mismatch");
  const matches = event.contracts.filter(contract => contract.id === contractId);
  if (matches.length !== 1) throw new Error("Gemini contract ID mismatch");
  return { event, contract: matches[0] };
}

export async function searchGemini(query: string) {
  const result = z.object({ data: z.array(z.unknown()) }).parse(await read("?status=active&limit=30&search=" + encodeURIComponent(query), 30_000));
  return result.data.flatMap(item => {
    const parsed = eventSchema.safeParse(item);
    if (!parsed.success || /crypto/i.test(parsed.data.category ?? "")) return [];
    const event = parsed.data;
    return event.contracts.filter(contract => contract.status === "active" && text(contract.description).trim()).map(contract => describe(event, contract));
  }).slice(0, 30);
}

export function settledOutcome(pin: Pin, event: GeminiEvent, contract: GeminiContract) {
  if (event.ticker !== pin.eventTicker || contract.id !== pin.contractId || contract.ticker !== pin.ticker ||
      describe(event, contract).fingerprint !== pin.fingerprint) throw new Error("Pinned Gemini terms do not match");
  if (event.status !== "settled" || contract.status !== "settled" || !contract.resolvedAt ||
      (contract.resolutionSide !== "yes" && contract.resolutionSide !== "no")) {
    throw new Error("Gemini has no explicit settled YES or NO");
  }
  return contract.resolutionSide === "yes" ? "YES" as const : "NO" as const;
}

export async function requireGeminiOutcome(db: Database, marketId: string, side: string) {
  const [pin] = await db.select().from(geminiLinks).where(eq(geminiLinks.marketId, marketId));
  if (!pin) return;
  try {
    const { event, contract } = await getGeminiContract(pin.eventTicker, pin.contractId, true);
    if (settledOutcome(pin, event, contract) !== side) throw new Error("Outcome mismatch");
  } catch { throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Gemini settlement is pending, unavailable, or mismatched. Submission is blocked." }); }
}

export async function marketGemini(db: Database, marketId: string) {
  const [pin] = await db.select().from(geminiLinks).where(eq(geminiLinks.marketId, marketId));
  if (!pin) return null;
  const { event, contract } = await getGeminiContract(pin.eventTicker, pin.contractId);
  if (describe(event, contract).fingerprint !== pin.fingerprint || contract.ticker !== pin.ticker) throw new Error("Pinned Gemini terms changed");
  const value = contract.prices.lastTradePrice ?? contract.prices.buy?.yes;
  const yesPercent = value === undefined || value === null ? null : Math.round(Number(value) * 100);
  const points = (contract.priceHistory ?? []).map(item => ({ contractId: pin.contractId, at: new Date(item.timestamp), yes: Math.round(Number(item.price) * 100) }));
  if (yesPercent !== null) points.push({ contractId: pin.contractId, at: new Date(Math.floor(Date.now() / 60_000) * 60_000), yes: yesPercent });
  for (const point of points) await db.insert(geminiOdds).values(point).onConflictDoNothing();
  const history = await db.select({ at: geminiOdds.at, yes: geminiOdds.yes }).from(geminiOdds)
    .where(eq(geminiOdds.contractId, pin.contractId)).orderBy(geminiOdds.at).limit(500);
  let outcome: "YES" | "NO" | null = null;
  try { outcome = settledOutcome(pin, event, contract); } catch { /* Pending/invalid outcomes stay unavailable. */ }
  return { ticker: pin.eventTicker + "/" + pin.ticker, contractId: pin.contractId, yesPercent, outcome,
    status: contract.status, history: history.map(item => ({ at: item.at.toISOString(), yes: item.yes })) };
}
