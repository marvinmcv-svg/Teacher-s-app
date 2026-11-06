import "server-only";
import { redirect } from "next/navigation";
import { effectiveTotal } from "@/lib/grading/review-rules";
import type { Json } from "@/lib/db/types";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type Supa = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export async function requireTeacher() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");
  return { supabase, user: data.user };
}

/** Every teacher change is stored as a before/after diff (§3.7) — signal for this teacher only. */
export async function recordEdit(
  supabase: Supa,
  teacherId: string,
  submissionId: string,
  table: string,
  id: string,
  before: unknown,
  after: unknown,
) {
  await supabase.from("teacher_edits").insert({
    teacher_id: teacherId,
    submission_id: submissionId,
    target_table: table,
    target_id: id,
    before: (before ?? null) as Json,
    after: (after ?? null) as Json,
  });
}

export async function refreshTotals(supabase: Supa, submissionId: string) {
  const { data: items } = await supabase
    .from("criterion_scores")
    .select("ai_score, teacher_score, ai_max")
    .eq("submission_id", submissionId);
  const t = effectiveTotal(items ?? []);
  await supabase.from("submissions").update({ total_score: t.score, total_max: t.max }).eq("id", submissionId);
}
