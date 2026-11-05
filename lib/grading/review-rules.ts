/**
 * Review gating rules (§3.4) — pure so the UI and the server enforce the same thing.
 * - Every low/medium item, and every deduction, must be acknowledged before approval.
 * - wellbeing_review must be acknowledged explicitly.
 * - "Approve all green" only after the teacher opened a random sample of green items.
 */
export type ReviewItem = {
  confidence_band: "high" | "medium" | "low" | null;
  ai_score: number | null;
  ai_max: number | null;
  teacher_score: number | null;
  acknowledged_at: string | null;
};

export function needsAcknowledgement(i: ReviewItem): boolean {
  if (i.teacher_score !== null) return false; // the teacher set the score themselves
  if (i.confidence_band !== "high") return true;
  return false;
}

export function isDeduction(i: ReviewItem): boolean {
  const score = i.teacher_score ?? i.ai_score;
  return score !== null && i.ai_max !== null && score < i.ai_max;
}

export function blockingItems<T extends ReviewItem>(items: T[]): T[] {
  return items.filter((i) => needsAcknowledgement(i) && !i.acknowledged_at);
}

export function canApprove(items: ReviewItem[], flags: string[], wellbeingAcknowledged: boolean) {
  if (flags.includes("wellbeing_review") && !wellbeingAcknowledged)
    return { ok: false as const, reason: "wellbeing" as const };
  if (blockingItems(items).length) return { ok: false as const, reason: "unreviewed" as const };
  return { ok: true as const };
}

/** How many green submissions must be opened before "Approve all green" unlocks. */
export function greenSampleRequired(greenCount: number, pct: number): number {
  if (greenCount === 0) return 0;
  return Math.min(greenCount, Math.max(2, Math.ceil((greenCount * pct) / 100)));
}

export function effectiveTotal(
  items: { ai_score: number | null; teacher_score: number | null; ai_max: number | null }[],
) {
  return {
    score: items.reduce((s, i) => s + Number(i.teacher_score ?? i.ai_score ?? 0), 0),
    max: items.reduce((s, i) => s + Number(i.ai_max ?? 0), 0),
  };
}
