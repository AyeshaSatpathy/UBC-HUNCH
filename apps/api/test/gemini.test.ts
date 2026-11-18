import { expect, test } from "bun:test";
import { describe, settledOutcome, type GeminiContract, type GeminiEvent } from "../src/gemini";

test("Gemini settlement requires matching immutable terms and an explicit settled outcome", () => {
  const contract: GeminiContract = { id: "contract", ticker: "YES", label: "Team wins", description: "Team wins the named final.",
    expiryDate: "2026-11-18T12:00:00Z", termsAndConditionsUrl: "https://assets.gemini.com/rules.pdf",
    status: "settled", resolutionSide: "yes", resolvedAt: "2026-11-18T12:01:00Z", prices: {} };
  const event: GeminiEvent = { id: "event", ticker: "FINAL", title: "Named final", status: "settled", contracts: [contract] };
  const pin = describe(event, contract);
  expect(settledOutcome(pin, event, contract)).toBe("YES");
  expect(settledOutcome(pin, event, { ...contract, resolutionSide: "no" })).toBe("NO");
  for (const changed of [
    { status: "active" }, { status: "invalid" }, { resolutionSide: null }, { resolutionSide: "invalid" },
    { id: "another" }, { ticker: "changed" }, { description: "Changed rules" }, { resolvedAt: null },
  ]) expect(() => settledOutcome(pin, event, { ...contract, ...changed })).toThrow();
  expect(() => settledOutcome(pin, { ...event, status: "active" }, contract)).toThrow();
});
