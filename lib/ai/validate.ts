import type { Grade, Transcription, Verification } from "./schemas";

/** What the validator needs to know about the assignment's gradable items. */
export type GradableItem = {
  /** "q3" or a rubric criterion key */
  key: string;
  kind: "question" | "criterion";
  max: number;
  levelLabels?: string[];
};

export type ValidationIssue = { path: string; message: string };

const itemKeyOf = (i: { question_key: string | null; criterion_key: string | null }) =>
  i.question_key ?? i.criterion_key ?? "";

function clamp01Issue(path: string, v: number, issues: ValidationIssue[]) {
  if (!(v >= 0 && v <= 1)) issues.push({ path, message: `must be between 0 and 1 (got ${v})` });
}

/** Business-rule checks for submit_transcription (§8.3). */
export function validateTranscription(
  t: Transcription,
  items: GradableItem[],
  lineKeys: Set<string>,
  pageCount: number,
) {
  const issues: ValidationIssue[] = [];
  const questionKeys = new Set(items.filter((i) => i.kind === "question").map((i) => i.key));
  const seen = new Set<string>();
  t.answers.forEach((a, idx) => {
    const p = `answers[${idx}]`;
    if (questionKeys.size > 0 && !questionKeys.has(a.question_key))
      issues.push({ path: `${p}.question_key`, message: `unknown question "${a.question_key}"` });
    if (seen.has(a.question_key))
      issues.push({ path: `${p}.question_key`, message: `duplicate answer for "${a.question_key}"` });
    seen.add(a.question_key);
    clamp01Issue(`${p}.mapping_confidence`, a.mapping_confidence, issues);
    if (a.illegible_spans < 0) issues.push({ path: `${p}.illegible_spans`, message: "must be ≥ 0" });
    for (const k of a.line_keys)
      if (!lineKeys.has(k)) issues.push({ path: `${p}.line_keys`, message: `unknown line_key "${k}"` });
    for (const c of a.ocr_corrections)
      if (!lineKeys.has(c.line_key))
        issues.push({ path: `${p}.ocr_corrections`, message: `unknown line_key "${c.line_key}"` });
  });
  t.pages.forEach((pg, idx) => {
    if (pg.page_position < 1 || pg.page_position > pageCount)
      issues.push({ path: `pages[${idx}].page_position`, message: `no page ${pg.page_position}` });
    clamp01Issue(`pages[${idx}].legibility`, pg.legibility, issues);
  });
  return issues;
}

function validateItemRefs(
  list: { question_key: string | null; criterion_key: string | null }[],
  items: GradableItem[],
  prefix: string,
  issues: ValidationIssue[],
) {
  const byKey = new Map(items.map((i) => [i.key, i]));
  const seen = new Set<string>();
  list.forEach((it, idx) => {
    const p = `${prefix}[${idx}]`;
    const hasQ = it.question_key !== null && it.question_key !== "";
    const hasC = it.criterion_key !== null && it.criterion_key !== "";
    if (hasQ === hasC) {
      issues.push({ path: p, message: "exactly one of question_key / criterion_key is required" });
      return;
    }
    const key = itemKeyOf(it);
    const def = byKey.get(key);
    if (!def || def.kind !== (hasQ ? "question" : "criterion"))
      issues.push({ path: p, message: `unknown item "${key}"` });
    if (seen.has(key)) issues.push({ path: p, message: `duplicate item "${key}"` });
    seen.add(key);
  });
  for (const i of items) if (!seen.has(i.key)) issues.push({ path: prefix, message: `missing item "${i.key}"` });
}

/** Business-rule checks for submit_grade (§8.3): 0 ≤ score ≤ max, max matches, line keys exist, labels valid. */
export function validateGrade(g: Grade, items: GradableItem[], lineKeys: Set<string>, pageCount: number) {
  const issues: ValidationIssue[] = [];
  validateItemRefs(g.items, items, "items", issues);
  const byKey = new Map(items.map((i) => [i.key, i]));
  g.items.forEach((it, idx) => {
    const p = `items[${idx}]`;
    const def = byKey.get(itemKeyOf(it));
    if (!def) return;
    if (it.max !== def.max) issues.push({ path: `${p}.max`, message: `max must be ${def.max} (got ${it.max})` });
    if (!(it.score >= 0 && it.score <= def.max))
      issues.push({ path: `${p}.score`, message: `score must be within 0..${def.max} (got ${it.score})` });
    if (it.level_label !== null && def.levelLabels && !def.levelLabels.includes(it.level_label))
      issues.push({ path: `${p}.level_label`, message: `"${it.level_label}" is not a level of this criterion` });
    if (def.levelLabels && def.levelLabels.length > 0 && it.level_label === null)
      issues.push({ path: `${p}.level_label`, message: "rubric criteria need a level_label" });
    clamp01Issue(`${p}.confidence`, it.confidence, issues);
    for (const k of it.evidence_line_keys)
      if (!lineKeys.has(k)) issues.push({ path: `${p}.evidence_line_keys`, message: `unknown line_key "${k}"` });
  });
  g.annotations.forEach((a, idx) => {
    const p = `annotations[${idx}]`;
    if (a.page_position < 1 || a.page_position > pageCount)
      issues.push({ path: `${p}.page_position`, message: `no page ${a.page_position}` });
    for (const k of a.line_keys) {
      if (!lineKeys.has(k)) issues.push({ path: `${p}.line_keys`, message: `unknown line_key "${k}"` });
      else if (!k.startsWith(`p${a.page_position}-`))
        issues.push({ path: `${p}.line_keys`, message: `"${k}" is not on page ${a.page_position}` });
    }
    if (a.line_keys.length === 0) {
      if (!a.approx_bbox) issues.push({ path: p, message: "needs line_keys or approx_bbox" });
      else {
        const { x, y, w, h } = a.approx_bbox;
        if (![x, y, w, h].every((v) => v >= 0 && v <= 1) || x + w > 1.0001 || y + h > 1.0001 || w <= 0 || h <= 0)
          issues.push({ path: `${p}.approx_bbox`, message: "must be a normalised 0-1 box inside the page" });
      }
    }
  });
  return issues;
}

export function validateVerification(v: Verification, items: GradableItem[]) {
  const issues: ValidationIssue[] = [];
  validateItemRefs(v.items, items, "items", issues);
  const byKey = new Map(items.map((i) => [i.key, i]));
  v.items.forEach((it, idx) => {
    const def = byKey.get(itemKeyOf(it));
    if (def && !(it.score >= 0 && it.score <= def.max))
      issues.push({ path: `items[${idx}].score`, message: `score must be within 0..${def.max}` });
    clamp01Issue(`items[${idx}].confidence`, it.confidence, issues);
  });
  return issues;
}

export function formatIssues(issues: ValidationIssue[]): string {
  return issues.map((i) => `- ${i.path}: ${i.message}`).join("\n");
}

export { itemKeyOf };
