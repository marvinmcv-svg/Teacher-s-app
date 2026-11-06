/**
 * Teacher style profile (§3.7) — the parts computed in code. The model only
 * describes *wording*; strictness is measured, never guessed.
 */
export type ScoreEdit = { scope: string; before: number; after: number; max: number };
export type TextEdit = { before: string; after: string };

export type Strictness = { scope: string; delta_pct: number; n: number };

/** Mean (teacher − AI) as % of item max, per scope (question type or rubric criterion). Positive = more lenient than the AI. */
export function strictnessByScope(edits: ScoreEdit[], minN = 3): Strictness[] {
  const by = new Map<string, number[]>();
  for (const e of edits) {
    if (!(e.max > 0)) continue;
    by.set(e.scope, [...(by.get(e.scope) ?? []), ((e.after - e.before) / e.max) * 100]);
  }
  return [...by.entries()]
    .filter(([, v]) => v.length >= minN)
    .map(([scope, v]) => ({
      scope,
      delta_pct: Math.round((v.reduce((s, x) => s + x, 0) / v.length) * 10) / 10,
      n: v.length,
    }))
    .sort((a, b) => Math.abs(b.delta_pct) - Math.abs(a.delta_pct));
}

export function medianWords(texts: string[]): number | null {
  const counts = texts
    .map((t) => t.trim().split(/\s+/).filter(Boolean).length)
    .filter((n) => n > 0)
    .sort((a, b) => a - b);
  if (!counts.length) return null;
  const mid = Math.floor(counts.length / 2);
  return counts.length % 2 ? counts[mid] : Math.round((counts[mid - 1] + counts[mid]) / 2);
}

export type StoredProfile = {
  summary: string;
  preferred_phrases: string[];
  avoid_phrases: string[];
  typical_length: string;
  tone: string;
  praise_style: string;
  correction_style: string;
  strictness: Strictness[];
  comment_words_median: number | null;
  edits_considered: number;
};

/** Text for the grading/regenerate prompts. Deterministic so it caches with the system prompt. */
export function renderStyleProfile(p: StoredProfile | null | undefined): string | null {
  if (!p) return null;
  const lines = [
    p.summary,
    `Tone: ${p.tone}`,
    `Praise: ${p.praise_style}`,
    `Corrections: ${p.correction_style}`,
    `Typical comment length: ${p.typical_length}${p.comment_words_median ? ` (~${p.comment_words_median} words)` : ""}`,
  ];
  if (p.preferred_phrases.length) lines.push(`Phrases they like: ${p.preferred_phrases.slice(0, 8).join(" | ")}`);
  if (p.avoid_phrases.length) lines.push(`Never write: ${p.avoid_phrases.slice(0, 8).join(" | ")}`);
  const strict = p.strictness.filter((s) => Math.abs(s.delta_pct) >= 5).slice(0, 6);
  if (strict.length)
    lines.push(
      `Measured from their score changes: ${strict
        .map(
          (s) =>
            `${s.scope}: ${s.delta_pct > 0 ? "more lenient" : "stricter"} than the AI by ${Math.abs(s.delta_pct)}% of max (n=${s.n})`,
        )
        .join("; ")}. Their standards override yours.`,
    );
  return lines.join("\n");
}
