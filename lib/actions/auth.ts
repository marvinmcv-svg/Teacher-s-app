"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSiteUrl } from "@/lib/site-url";
import { safeNextPath } from "@/lib/safe-redirect";

export type MagicLinkState = { status: "idle" | "sent" | "invalid" | "error" };

export async function sendMagicLink(_prev: MagicLinkState, formData: FormData): Promise<MagicLinkState> {
  const email = z.email().safeParse(String(formData.get("email") ?? "").trim());
  if (!email.success) return { status: "invalid" };
  const next = safeNextPath(String(formData.get("next") ?? ""));
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithOtp({
    email: email.data,
    options: { emailRedirectTo: `${await getSiteUrl()}/auth/callback?next=${encodeURIComponent(next)}` },
  });
  if (error) {
    console.error("auth.magic_link_failed", { code: error.code, status: error.status });
    return { status: "error" };
  }
  return { status: "sent" };
}

export async function signInWithGoogle(formData: FormData) {
  const next = safeNextPath(String(formData.get("next") ?? ""));
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${await getSiteUrl()}/auth/callback?next=${encodeURIComponent(next)}` },
  });
  if (error || !data.url) {
    console.error("auth.google_failed", { code: error?.code });
    redirect("/login?error=oauth");
  }
  redirect(data.url);
}

export async function signOut() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}
