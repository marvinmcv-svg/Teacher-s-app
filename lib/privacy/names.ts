/**
 * Remove roster names from free text before it is sent to a model (§9: graders
 * never see identities). Teachers sometimes write "¡Muy bien, Ana!" in feedback;
 * when that text is reused as an exemplar or for the style profile, the name goes.
 * Matches each name and each name part (≥ 3 letters), accent- and case-insensitive.
 */
const fold = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "");

export function scrubNames(text: string, names: string[], placeholder = "[student]"): string {
  if (!text) return text;
  const parts = new Set<string>();
  for (const n of names) {
    const full = fold(n).trim();
    if (full.length >= 3) parts.add(full);
    for (const p of full.split(/[\s,.-]+/)) if (p.length >= 3) parts.add(p);
  }
  if (!parts.size) return text;
  const sorted = [...parts].sort((a, b) => b.length - a.length).map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const re = new RegExp(`(?<![\\p{L}])(?:${sorted.join("|")})(?![\\p{L}])`, "giu");
  // Match on the folded text, replace in the original (folding can change length, so map indexes back).
  const folded = fold(text);
  let out = "";
  let last = 0;
  const map = foldIndexMap(text);
  for (const m of folded.matchAll(re)) {
    const start = map[m.index!];
    const end = map[m.index! + m[0].length] ?? text.length;
    out += text.slice(last, start) + placeholder;
    last = end;
  }
  return out + text.slice(last);
}

/** For each index in the folded string, the index in the original string. */
function foldIndexMap(text: string): number[] {
  const map: number[] = [];
  let i = 0;
  for (const ch of text) {
    const f = fold(ch);
    for (let k = 0; k < f.length; k++) map.push(i);
    i += ch.length;
  }
  map.push(text.length);
  return map;
}
