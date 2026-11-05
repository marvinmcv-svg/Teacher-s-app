import { execFileSync } from "node:child_process";
import { expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const MAILPIT = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";

export async function latestMagicLink(email: string): Promise<string> {
  for (let i = 0; i < 30; i++) {
    const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}&limit=1`);
    const data = (await res.json()) as { messages?: { ID: string }[] };
    const id = data.messages?.[0]?.ID;
    if (id) {
      const msg = (await (await fetch(`${MAILPIT}/api/v1/message/${id}`)).json()) as { HTML?: string; Text?: string };
      const match = `${msg.HTML ?? ""} ${msg.Text ?? ""}`.match(/https?:\/\/[^\s"'<>]+\/auth\/v1\/verify[^\s"'<>]+/);
      if (match) return match[0].replace(/&amp;/g, "&");
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`No magic link email for ${email}`);
}

export async function signIn(page: Page, email: string) {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel(/correo electrónico|email/i).fill(email);
  await page.getByRole("button", { name: /enlace mágico|magic link/i }).click();
  await expect(page.getByRole("status")).toBeVisible();
  await page.goto(await latestMagicLink(email));
  await expect(page).toHaveURL(/127\.0\.0\.1:3000\/$/);
}

/**
 * Stand-in for the Inngest worker in E2E: runs the REAL pipeline on the
 * submission with test-only fake OCR/LLM providers (no API keys in CI).
 * Runs under Vitest (aliases + server-only handled there).
 */
export function gradeWithFakeProviders(submissionId: string) {
  execFileSync("pnpm", ["exec", "vitest", "run", "--project", "worker"], {
    env: { ...process.env, SUBMISSION_ID: submissionId },
    stdio: "pipe",
  });
}

export async function latestSubmissionId(assignmentId: string): Promise<string> {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
    auth: { persistSession: false },
  });
  const { data } = await db
    .from("submissions")
    .select("id")
    .eq("assignment_id", assignmentId)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  return data!.id as string;
}
