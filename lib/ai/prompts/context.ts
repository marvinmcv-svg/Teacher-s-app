import type { FeedbackSettings, QuestionInput, RubricCriterion } from "@/lib/grading/assignment";
import { criterionMax } from "@/lib/grading/assignment";
import { describeScale, type Scale } from "@/lib/grading/scales";

export type AssignmentContext = {
  title: string;
  subject: string | null;
  gradeLevel: string | null;
  scale: Scale;
  questions: (QuestionInput & { key: string })[];
  criteria: RubricCriterion[];
  feedback: FeedbackSettings;
};

export type OcrLineForPrompt = { line_key: string; text: string; confidence: number | null };

/** Assignment block — identical bytes for every submission of an assignment, so it caches (§8.6). */
export function renderAssignmentContext(a: AssignmentContext): string {
  const parts: string[] = [];
  parts.push(
    `# Assignment\nTitle: ${a.title}\nSubject: ${a.subject ?? "unspecified"}\nGrade level: ${a.gradeLevel ?? "unspecified"}`,
  );
  parts.push(`Scale: ${describeScale(a.scale)}. Score every item in points; the app maps the total onto the scale.`);
  if (a.questions.length) {
    parts.push("# Questions (answer key)");
    for (const q of a.questions) {
      const lines = [
        `## ${q.key} — "${q.label}" (${q.type}, max ${q.max_points} points)`,
        q.prompt_text && `Prompt: ${q.prompt_text}`,
        q.correct_answers.length
          ? `Correct answer(s): ${q.correct_answers.join(" | ")}`
          : "Correct answer: (none given — judge by the notes/rubric)",
        q.equivalents.length && `Acceptable equivalents: ${q.equivalents.join(" | ")}`,
        `Answer form matters: ${q.form_matters ? "yes" : "no"}`,
        q.partial_credit_rules && `Partial credit: ${q.partial_credit_rules}`,
        q.notes && `What counts: ${q.notes}`,
      ].filter(Boolean);
      parts.push(lines.join("\n"));
    }
  }
  if (a.criteria.length) {
    parts.push("# Rubric criteria (score the whole work against each)");
    for (const c of a.criteria) {
      parts.push(
        [
          `## ${c.key} — ${c.title} (max ${criterionMax(c)} points)`,
          c.description,
          ...c.levels.map((l) => `- level_label "${l.label}" = ${l.points} points: ${l.descriptor}`),
        ]
          .filter(Boolean)
          .join("\n"),
      );
    }
  }
  return parts.join("\n\n");
}

export function renderOcrLines(lines: OcrLineForPrompt[]): string {
  if (!lines.length) return "(OCR found no text lines)";
  return lines
    .map((l) => `${l.line_key}\t${l.confidence === null ? "" : l.confidence.toFixed(2)}\t${l.text}`)
    .join("\n");
}
