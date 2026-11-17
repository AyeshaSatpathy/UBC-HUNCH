import { z } from "zod";

export async function sendCode(email: string, code: string, test = false) {
  const key = process.env.BREVO_API_KEY?.trim();
  const sender = z.email().safeParse(process.env.BREVO_FROM_EMAIL?.trim());
  if (!key || !sender.success) throw new Error("Brevo sender configuration is missing");
  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": key, "content-type": "application/json" },
    body: JSON.stringify({
      sender: { name: "Hunch", email: sender.data },
      to: [{ email }],
      subject: test ? "Hunch verification code test" : "Your Hunch verification code",
      textContent: test
        ? `Your test verification code is ${code}. This delivery test does not change your account.`
        : `Your verification code is ${code}. It expires in 10 minutes. If you did not request this code, you can ignore this email.`,
      tags: [test ? "hunch-verification-test" : "hunch-verification"],
    }),
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { code?: string } | null;
    throw new Error(`Brevo send failed (${response.status}, ${body?.code ?? "unknown"})`);
  }
  return z.object({ messageId: z.string() }).parse(await response.json()).messageId;
}
