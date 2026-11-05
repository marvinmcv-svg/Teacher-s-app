import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const BAND_ORDER = { low: 0, medium: 1, high: 2 } as const;

/** Review order (§3.4): wellbeing first, then red → orange → green; stable by creation time. */
export async function loadReviewQueue(assignmentId: string) {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("submissions")
    .select(
      "id, student_id, status, confidence, flags, opened_at, error_code, created_at, students!submissions_student_id_fkey(display_name)",
    )
    .eq("assignment_id", assignmentId)
    .in("status", ["ready", "approved", "needs_attention", "released"])
    .order("created_at");
  const list = (data ?? []).map((s) => ({
    ...s,
    studentName: (s.students as unknown as { display_name: string } | null)?.display_name ?? null,
  }));
  const rank = (s: (typeof list)[number]) =>
    s.status === "needs_attention"
      ? -1
      : s.flags.includes("wellbeing_review") && !s.flags.includes("wellbeing_acknowledged")
        ? -2
        : s.status !== "ready"
          ? 10
          : BAND_ORDER[s.confidence ?? "low"];
  return list.sort((a, b) => rank(a) - rank(b));
}
