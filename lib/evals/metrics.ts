/**
 * Eval metrics (§8.7). Pure functions — unit-tested, used by evals/run.eval.ts.
 */
import { levenshtein } from "@/lib/grading/names";

export const normText = (s: string) =>
  s
    .normalize("NFC")
    .replace(/\\left|\\right/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

/** Character error rate over a set of (predicted, truth) pairs. */
export function cer(pairs: { pred: string; truth: string }[]): number {
  let dist = 0;
  let len = 0;
  for (const p of pairs) {
    const t = normText(p.truth);
    dist += levenshtein(normText(p.pred), t);
    len += t.length;
  }
  return len ? dist / len : 0;
}

/**
 * Over-correction (§1.2): the student wrote something wrong, and the
 * transcription shows the CORRECT answer instead. Only counts answers the
 * ground truth marks as erroneous.
 */
export function overCorrectionRate(
  items: { pred: string; truth: string; studentError: boolean; correctAnswers: string[] }[],
) {
  const errs = items.filter((i) => i.studentError);
  if (!errs.length) return { rate: 0, n: 0, cases: 0 };
  const cases = errs.filter((i) => {
    const p = normText(i.pred);
    return p !== normText(i.truth) && i.correctAnswers.some((c) => normText(c) === p);
  }).length;
  return { rate: cases / errs.length, n: errs.length, cases };
}

export type ScoredItem = {
  ai: number;
  teacher: number;
  max: number;
  levelStep?: number | null;
  band?: "high" | "medium" | "low" | null;
};

export const tolerance = (i: ScoredItem) => Math.max(i.levelStep ?? 0, 0.1 * i.max);
export const withinTolerance = (i: ScoredItem) => Math.abs(i.ai - i.teacher) <= tolerance(i) + 1e-9;

export function agreement(items: ScoredItem[]) {
  const n = items.length || 1;
  return {
    exact: items.filter((i) => Math.abs(i.ai - i.teacher) < 1e-9).length / n,
    withinTolerance: items.filter(withinTolerance).length / n,
    // reported separately (§1.2: teachers miss harsh errors more)
    harsh: items.filter((i) => i.ai < i.teacher - 1e-9).length / n,
    lenient: items.filter((i) => i.ai > i.teacher + 1e-9).length / n,
    harshBeyondTolerance: items.filter((i) => i.teacher - i.ai > tolerance(i) + 1e-9).length / n,
    n: items.length,
  };
}

/**
 * Quadratic weighted kappa on scores binned to tenths of the item max (0..10),
 * so items with different maxima can be pooled.
 */
export function quadraticWeightedKappa(items: ScoredItem[], bins = 10): number {
  if (items.length < 2) return NaN;
  const bin = (v: number, max: number) => Math.max(0, Math.min(bins, Math.round((max ? v / max : 0) * bins)));
  const k = bins + 1;
  const O = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  const a = new Array<number>(k).fill(0);
  const b = new Array<number>(k).fill(0);
  for (const i of items) {
    const x = bin(i.ai, i.max);
    const y = bin(i.teacher, i.max);
    O[x][y]++;
    a[x]++;
    b[y]++;
  }
  const N = items.length;
  let num = 0;
  let den = 0;
  for (let x = 0; x < k; x++)
    for (let y = 0; y < k; y++) {
      const w = ((x - y) * (x - y)) / ((k - 1) * (k - 1));
      num += w * O[x][y];
      den += (w * a[x] * b[y]) / N;
    }
  return den === 0 ? 1 : 1 - num / den;
}

/** Are "high" items actually right ≥ 95%? Share of items per band. */
export function calibration(items: ScoredItem[]) {
  const out: Record<string, { share: number; accuracy: number; n: number }> = {};
  for (const band of ["high", "medium", "low"] as const) {
    const xs = items.filter((i) => i.band === band);
    out[band] = {
      n: xs.length,
      share: items.length ? xs.length / items.length : 0,
      accuracy: xs.length ? xs.filter(withinTolerance).length / xs.length : NaN,
    };
  }
  return out;
}

export type Box = { x: number; y: number; w: number; h: number };
export function iou(a: Box, b: Box): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}

/** For each reference annotation, the best IoU of any AI pin on the same page. */
export function anchorAccuracy(refs: { page: number; box: Box }[], preds: { page: number; box: Box }[]) {
  if (!refs.length) return { meanIoU: NaN, hitRate: NaN, n: 0 };
  const best = refs.map((r) => Math.max(0, ...preds.filter((p) => p.page === r.page).map((p) => iou(r.box, p.box))));
  return {
    meanIoU: best.reduce((s, v) => s + v, 0) / best.length,
    hitRate: best.filter((v) => v >= 0.5).length / best.length,
    n: refs.length,
  };
}

/** Run-to-run consistency: mean per-item standard deviation (as % of max) across repeated runs. */
export function consistency(runs: number[][], maxes: number[]) {
  if (runs.length < 2) return { meanStdPct: NaN, itemsWithAnyChange: NaN };
  const nItems = maxes.length;
  let sum = 0;
  let changed = 0;
  for (let i = 0; i < nItems; i++) {
    const v = runs.map((r) => r[i]);
    const m = v.reduce((s, x) => s + x, 0) / v.length;
    const sd = Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / v.length);
    sum += maxes[i] ? (sd / maxes[i]) * 100 : 0;
    if (new Set(v).size > 1) changed++;
  }
  return { meanStdPct: sum / nItems, itemsWithAnyChange: changed / nItems };
}

/** Merge gate (§8.7): block if within-tolerance agreement drops by more than `points` percentage points. */
export function regressionGate(current: number, baseline: number | null, points = 2) {
  if (baseline === null || Number.isNaN(baseline)) return { pass: true, delta: null as number | null };
  const delta = (current - baseline) * 100;
  return { pass: delta >= -points, delta };
}
