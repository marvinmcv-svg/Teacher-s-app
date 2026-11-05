import { normaliseName } from "@/lib/roster/parse";

/** Damerau-free Levenshtein distance. */
export function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

const similarity = (a: string, b: string) =>
  a.length || b.length ? 1 - levenshtein(a, b) / Math.max(a.length, b.length) : 0;

/**
 * Score how well a written name matches a roster name (accent/case-insensitive,
 * order-insensitive, tolerant of a missing surname or small misspellings).
 * Matching is done in code — the roster is never sent to a model (§8.3).
 */
export function nameScore(written: string, roster: string): number {
  const w = normaliseName(written)
    .split(" ")
    .filter((t) => t.length > 1);
  const r = normaliseName(roster)
    .split(" ")
    .filter((t) => t.length > 1);
  if (!w.length || !r.length) return 0;
  // each written token → best roster token
  const per = w.map((wt) =>
    Math.max(...r.map((rt) => (rt.startsWith(wt) && wt.length >= 3 ? 0.95 : similarity(wt, rt)))),
  );
  const avg = per.reduce((s, v) => s + v, 0) / per.length;
  const coverage = Math.min(1, w.length / Math.min(2, r.length)); // "Ana" alone covers half of "Ana Pérez"
  return avg * (0.7 + 0.3 * coverage);
}

export type NameMatch<T> = { student: T; score: number };

export function matchRoster<T extends { display_name: string }>(written: string, roster: T[]) {
  const ranked = roster
    .map((s) => ({ student: s, score: nameScore(written, s.display_name) }))
    .sort((a, b) => b.score - a.score);
  const [best, second] = ranked;
  const confident = !!best && best.score >= 0.8 && (!second || best.score - second.score >= 0.1);
  return { best: best ?? null, confident, ranked: ranked.slice(0, 5) };
}

const NAME_LABEL = /^(nombres?( y apellidos?)?|apellidos?|name|student|estudiante|alumn[oa])\s*[:.\-]?\s*/i;

/** Lines that look like the name field: a "Nombre:" label, or text matching a roster name. */
export function findNameLines<L extends { text: string; bbox: { y: number } }>(
  lines: L[],
  rosterNames: string[],
  headerBand = 0.25,
) {
  const hits: { line: L; reason: "label" | "roster"; written: string }[] = [];
  for (const line of lines) {
    if (line.bbox.y > headerBand) continue;
    const t = line.text.trim();
    if (NAME_LABEL.test(normaliseName(t)) || NAME_LABEL.test(t)) {
      hits.push({ line, reason: "label", written: t.replace(NAME_LABEL, "").trim() });
      continue;
    }
    if (rosterNames.some((n) => nameScore(t, n) >= 0.85)) hits.push({ line, reason: "roster", written: t });
  }
  return hits;
}
