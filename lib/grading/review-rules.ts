/**
 * Review rules — pure so the UI and the server agree.
 * The review screen is a quick check: the teacher can approve any graded paper.
 * The one hard stop is a wellbeing flag, which must be acknowledged privately first.
 */
export function canApprove(flags: string[], wellbeingAcknowledged: boolean) {
  if (flags.includes("wellbeing_review") && !wellbeingAcknowledged)
    return { ok: false as const, reason: "wellbeing" as const };
  return { ok: true as const };
}

export function effectiveTotal(
  items: { ai_score: number | null; teacher_score: number | null; ai_max: number | null }[],
) {
  return {
    score: items.reduce((s, i) => s + Number(i.teacher_score ?? i.ai_score ?? 0), 0),
    max: items.reduce((s, i) => s + Number(i.ai_max ?? 0), 0),
  };
}
