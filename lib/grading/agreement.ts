import { agreementTolerance } from "./confidence";

/**
 * Blind-check agreement (§3.4): the teacher grades before seeing the AI.
 * "Within tolerance" uses the eval definition (§8.7): ≤ 1 rubric level or ≤ 10% of the item max.
 */
export type BlindItem = { key: string; teacher: number; ai: number; max: number; levelStep?: number | null };

export function blindAgreement(items: BlindItem[]) {
  const scored = items.map((i) => {
    const diff = Math.abs(i.teacher - i.ai);
    return {
      item_key: i.key,
      teacher: i.teacher,
      ai: i.ai,
      max: i.max,
      exact: diff < 1e-9,
      within: diff <= agreementTolerance(i.max, i.levelStep) + 1e-9,
      /** >0: the AI was harsher than the teacher */
      harsh: i.ai < i.teacher - 1e-9,
    };
  });
  const n = scored.length;
  return {
    items: scored,
    n,
    exactRate: n ? scored.filter((s) => s.exact).length / n : 1,
    withinRate: n ? scored.filter((s) => s.within).length / n : 1,
  };
}

/** Item-weighted summary across many blind checks, for the dashboard metric. */
export function agreementSummary(rows: { n_items: number; exact_rate: number; within_rate: number }[]) {
  const n = rows.reduce((s, r) => s + r.n_items, 0);
  if (!n) return null;
  return {
    checks: rows.length,
    items: n,
    exact: rows.reduce((s, r) => s + r.exact_rate * r.n_items, 0) / n,
    within: rows.reduce((s, r) => s + r.within_rate * r.n_items, 0) / n,
  };
}

/** Deterministic, unbiased pick for blind checks: the pipeline passes a random number in [0,1). */
export function pickForBlindCheck(pct: number, roll: number, flags: string[]): boolean {
  if (pct <= 0 || flags.includes("wellbeing_review")) return false;
  return roll < pct / 100;
}
