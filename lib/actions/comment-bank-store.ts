import "server-only";
import type { Supa } from "./helpers";

export type BankEntry = {
  text: string;
  locale: "es" | "en";
  subject: string | null;
  tags?: string[];
  source: "teacher" | "ai_approved";
};

const key = (s: string) => s.trim().toLowerCase();

/**
 * Grow the teacher's comment bank (§3.7): comments they write, and AI comments
 * they approve unchanged after opening them. Deduped per teacher+locale by
 * normalised text; a repeat bumps `uses`. Teacher-written wins over AI-approved.
 */
export async function addToBank(supabase: Supa, teacherId: string, entries: BankEntry[]) {
  for (const e of entries) {
    const text = e.text.trim();
    if (text.length < 3 || text.length > 300) continue;
    const { data: existing } = await supabase
      .from("comment_bank")
      .select("id, uses, source, tags")
      .eq("teacher_id", teacherId)
      .eq("locale", e.locale)
      .eq("text_key", key(text))
      .maybeSingle();
    if (existing) {
      await supabase
        .from("comment_bank")
        .update({
          uses: existing.uses + 1,
          last_used_at: new Date().toISOString(),
          source: existing.source === "teacher" || e.source === "teacher" ? "teacher" : "ai_approved",
          tags: [...new Set([...existing.tags, ...(e.tags ?? [])])],
        })
        .eq("id", existing.id);
    } else {
      await supabase.from("comment_bank").insert({
        teacher_id: teacherId,
        locale: e.locale,
        subject: e.subject,
        text,
        tags: e.tags ?? [],
        source: e.source,
        uses: 1,
        last_used_at: new Date().toISOString(),
      });
    }
  }
}

/** Locale + subject of the assignment a submission belongs to (RLS applies). */
export async function bankContext(supabase: Supa, submissionId: string) {
  const { data } = await supabase
    .from("submissions")
    .select("assignments(feedback_locale, subject)")
    .eq("id", submissionId)
    .maybeSingle();
  const a = data?.assignments as unknown as { feedback_locale: "es" | "en"; subject: string | null } | null;
  return { locale: a?.feedback_locale ?? ("es" as const), subject: a?.subject ?? null };
}
