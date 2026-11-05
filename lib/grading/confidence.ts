/**
 * Confidence scoring (§8.4).
 *
 *   evidence_conf = min(ocr confidence of evidence lines, page legibility, mapping confidence)
 *   agreement     = 1.0 equal · 0.6 within tolerance · 0.2 otherwise · 0.9 verifier skipped
 *   self_adjust   = clamp(self_confidence, 0.5, 1.0)   (can only lower c)
 *   c = evidence_conf × agreement × self_adjust
 *
 * Caps: diagrams ≤ 0.6; zero or failing scores ≤ 0.84 (never auto-green).
 * Submission band = lowest item band; any flag caps at medium;
 * wellbeing_review forces low.
 */
export type Band = "high" | "medium" | "low";

export type BandThresholds = { high: number; medium: number };
export const DEFAULT_THRESHOLDS: BandThresholds = { high: 0.85, medium: 0.6 };

export type ItemSignals = {
  ocrConfidences: number[]; // confidences of the evidence lines (may be empty)
  pageLegibility: number; // min legibility of pages the evidence is on
  mappingConfidence: number; // 1 for rubric criteria (whole-work)
  graderScore: number;
  verifierScore: number | null; // null = verifier skipped
  max: number;
  /** points per rubric level step, if the item is a rubric criterion */
  levelStep?: number | null;
  selfConfidence: number;
  hasDiagram: boolean;
  /** percentage below which the item counts as failing (scale pass threshold) */
  passThresholdPct: number;
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function agreementTolerance(max: number, levelStep?: number | null): number {
  return Math.max(levelStep ?? 0, 0.1 * max);
}

export function agreementFactor(s: Pick<ItemSignals, "graderScore" | "verifierScore" | "max" | "levelStep">): number {
  if (s.verifierScore === null) return 0.9;
  const diff = Math.abs(s.graderScore - s.verifierScore);
  if (diff < 1e-9) return 1.0;
  if (diff <= agreementTolerance(s.max, s.levelStep) + 1e-9) return 0.6;
  return 0.2;
}

export function itemConfidence(s: ItemSignals): number {
  const ocr = s.ocrConfidences.length ? Math.min(...s.ocrConfidences) : 1;
  const evidence = Math.min(clamp(ocr, 0, 1), clamp(s.pageLegibility, 0, 1), clamp(s.mappingConfidence, 0, 1));
  let c = evidence * agreementFactor(s) * clamp(s.selfConfidence, 0.5, 1.0);
  if (s.hasDiagram) c = Math.min(c, 0.6);
  const pct = s.max > 0 ? (s.graderScore / s.max) * 100 : 100;
  if (s.graderScore <= 0 || pct < s.passThresholdPct) c = Math.min(c, 0.84);
  return Math.round(c * 1000) / 1000;
}

export function toBand(c: number, t: BandThresholds = DEFAULT_THRESHOLDS): Band {
  if (c >= t.high) return "high";
  if (c >= t.medium) return "medium";
  return "low";
}

const ORDER: Band[] = ["low", "medium", "high"];
const minBand = (a: Band, b: Band) => (ORDER.indexOf(a) <= ORDER.indexOf(b) ? a : b);

export function submissionBand(itemBands: Band[], flags: string[]): Band {
  if (flags.includes("wellbeing_review")) return "low";
  let band: Band = itemBands.length ? itemBands.reduce(minBand) : "low";
  if (flags.length > 0) band = minBand(band, "medium");
  return band;
}
