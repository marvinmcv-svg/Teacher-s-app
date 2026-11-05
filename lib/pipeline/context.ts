import { z } from "zod";
import type { AssignmentContext } from "@/lib/ai/prompts/context";
import type { GradableItem } from "@/lib/ai/validate";
import {
  FeedbackSettingsSchema,
  QuestionInputSchema,
  RubricCriterionSchema,
  criterionMax,
  questionKey,
  type RubricCriterion,
} from "@/lib/grading/assignment";
import { ScaleSchema } from "@/lib/grading/scales";
import type { AssignmentRow, QuestionRow } from "@/lib/db/types";

export type LoadedAssignment = {
  row: AssignmentRow;
  context: AssignmentContext;
  items: GradableItem[];
  /** "q3" → question id */
  questionIdByKey: Map<string, string>;
  questionMaxByKey: Map<string, number>;
  criteria: RubricCriterion[];
};

export function buildAssignmentContext(row: AssignmentRow, questions: QuestionRow[]): LoadedAssignment {
  const scale = ScaleSchema.parse(row.scale);
  const feedback = FeedbackSettingsSchema.parse(row.feedback_settings ?? {});
  const criteria = z.array(RubricCriterionSchema).parse(row.criteria ?? []);
  const sorted = [...questions].sort((a, b) => a.position - b.position);
  const qs = sorted.map((q) => ({
    key: questionKey(q.position),
    ...QuestionInputSchema.parse({
      label: q.label,
      prompt_text: q.prompt_text ?? "",
      type: q.type,
      max_points: Number(q.max_points),
      correct_answers: (q.correct_answers as string[]) ?? [],
      equivalents: (q.equivalents as string[]) ?? [],
      form_matters: q.form_matters,
      partial_credit_rules: q.partial_credit_rules ?? "",
      notes: q.notes ?? "",
    }),
  }));
  const items: GradableItem[] = [
    ...qs.map((q) => ({ key: q.key, kind: "question" as const, max: q.max_points })),
    ...criteria.map((c) => ({
      key: c.key,
      kind: "criterion" as const,
      max: criterionMax(c),
      levelLabels: c.levels.map((l) => l.label),
    })),
  ];
  return {
    row,
    context: {
      title: row.title,
      subject: row.subject,
      gradeLevel: row.grade_level,
      scale,
      questions: qs,
      criteria,
      feedback,
    },
    items,
    questionIdByKey: new Map(sorted.map((q) => [questionKey(q.position), q.id])),
    questionMaxByKey: new Map(qs.map((q) => [q.key, q.max_points])),
    criteria,
  };
}

/** Points per rubric level step (smallest gap between adjacent levels), for agreement tolerance. */
export function levelStep(c: RubricCriterion): number {
  const pts = [...new Set(c.levels.map((l) => l.points))].sort((a, b) => a - b);
  let step = Infinity;
  for (let i = 1; i < pts.length; i++) step = Math.min(step, pts[i] - pts[i - 1]);
  return Number.isFinite(step) ? step : 0;
}
