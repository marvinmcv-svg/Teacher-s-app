import { z } from "zod";

export const QUESTION_TYPES = [
  "numeric",
  "short_answer",
  "multiple_choice",
  "math_steps",
  "extended_writing",
  "diagram",
  "other",
] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

/** A question as the teacher defines it (the answer key). */
export const QuestionInputSchema = z.object({
  label: z.string().trim().min(1).max(20),
  prompt_text: z.string().trim().max(2000).default(""),
  type: z.enum(QUESTION_TYPES),
  max_points: z.number().min(0).max(1000),
  correct_answers: z.array(z.string().trim().min(1).max(500)).max(10).default([]),
  equivalents: z.array(z.string().trim().min(1).max(500)).max(20).default([]),
  form_matters: z.boolean().default(false),
  partial_credit_rules: z.string().trim().max(1000).default(""),
  notes: z.string().trim().max(1000).default(""),
});
export type QuestionInput = z.infer<typeof QuestionInputSchema>;

/** Rubric criterion with level descriptors (extended writing etc.). */
export const RubricLevelSchema = z.object({
  label: z.string().trim().min(1).max(40),
  points: z.number().min(0),
  descriptor: z.string().trim().max(600),
});
export const RubricCriterionSchema = z.object({
  key: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9_]{0,39}$/),
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(600).default(""),
  levels: z.array(RubricLevelSchema).min(2).max(6),
});
export type RubricCriterion = z.infer<typeof RubricCriterionSchema>;

export function criterionMax(c: RubricCriterion): number {
  return Math.max(...c.levels.map((l) => l.points));
}

export const FEEDBACK_STYLES = ["glow_grow", "two_stars_wish", "next_steps", "socratic", "brief"] as const;
export const FeedbackSettingsSchema = z.object({
  style: z.enum(FEEDBACK_STYLES).default("glow_grow"),
  tone: z.enum(["warm", "neutral", "direct"]).default("warm"),
  length: z.enum(["short", "medium", "long"]).default("short"),
  show_correct_answers: z.boolean().default(false),
  show_score: z.boolean().default(true),
  practice_item: z.boolean().default(false),
});
export type FeedbackSettings = z.infer<typeof FeedbackSettingsSchema>;

/** Prompt-facing key for a question, e.g. "q3". Stable per assignment (position). */
export const questionKey = (position: number) => `q${position}`;
