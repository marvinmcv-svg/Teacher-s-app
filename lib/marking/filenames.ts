/**
 * File names for the marked papers: "Last, First.jpg", so a plain alphabetical
 * sort in any file manager puts the stack in last-name order.
 *
 * Names in the roster are usually written "First Last". Rules:
 * - already "Last, First" → kept as written
 * - 2 words → "Last, First"
 * - 3 words → "Last1 Last2, First" (Spanish: one given name, two surnames)
 * - 4+ words → last two words are the surnames
 */
export function lastFirst(displayName: string): string {
  const name = displayName.trim().replace(/\s+/g, " ");
  if (!name) return name;
  if (name.includes(",")) return name;
  const parts = name.split(" ");
  if (parts.length === 1) return name;
  const surnames = parts.length === 2 ? 1 : 2;
  return `${parts.slice(-surnames).join(" ")}, ${parts.slice(0, -surnames).join(" ")}`;
}

/** Remove characters Windows/macOS don't allow in file names. */
export function safeFileName(s: string): string {
  return (
    s
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120) || "papel"
  );
}

const sortKey = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

export type PaperFile = { submissionId: string; studentName: string | null; pages: number };

/**
 * One entry per page, in last-name order. Unmatched papers go last as "Sin nombre 1…".
 * Multi-page work: "Pérez, Ana - 1.jpg", "Pérez, Ana - 2.jpg".
 */
export function planFileNames(papers: PaperFile[], unnamedLabel: string) {
  const named = papers
    .filter((p) => p.studentName)
    .map((p) => ({ ...p, base: safeFileName(lastFirst(p.studentName!)) }))
    .sort((a, b) => sortKey(a.base).localeCompare(sortKey(b.base)));
  const unnamed = papers.filter((p) => !p.studentName).map((p, i) => ({ ...p, base: `${unnamedLabel} ${i + 1}` }));
  const used = new Set<string>();
  const out: { submissionId: string; page: number; name: string }[] = [];
  for (const p of [...named, ...unnamed]) {
    let base = p.base;
    for (let n = 2; used.has(base.toLowerCase()); n++) base = `${p.base} (${n})`;
    used.add(base.toLowerCase());
    for (let page = 1; page <= p.pages; page++)
      out.push({ submissionId: p.submissionId, page, name: p.pages > 1 ? `${base} - ${page}.jpg` : `${base}.jpg` });
  }
  return out;
}
