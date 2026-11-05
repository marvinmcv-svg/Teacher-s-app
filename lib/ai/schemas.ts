import { z } from "zod";

/**
 * Model output schemas (§8.3). Used twice:
 *  1. converted to JSON Schema for `output_config.format` (schema-constrained decoding), and
 *  2. to parse the response.
 * Business rules the schema can't express live in `validate.ts`.
 *
 * Rules for these schemas (structured-output compatibility):
 *  - optional values are `nullable()` and always present (strict schemas require every key)
 *  - no numeric bounds / refinements here (not enforced by constrained decoding) — validate after
 *  - changing structure invalidates the compiled-grammar cache: bump SCHEMA_VERSION
 */
export const SCHEMA_VERSION = "2026-11-05.1";

// Questions are referred to by short keys ("q1", "q2") and rubric criteria by
// their snake_case key; the pipeline maps them back to database ids.
const itemRef = {
  question_key: z.string().nullable().describe('Question key like "q3", or null for a rubric criterion'),
  criterion_key: z.string().nullable().describe("Rubric criterion key, or null for a question"),
};

export const TranscriptionFlag = z.enum([
  "possible_missing_page",
  "wrong_assignment",
  "mostly_illegible",
  "wellbeing_review",
]);

export const TranscriptionSchema = z.object({
  pages: z.array(
    z.object({
      page_position: z.number().int(),
      legibility: z.number().describe("0-1, how legible this page is"),
      notes: z.string().nullable(),
    }),
  ),
  answers: z.array(
    z.object({
      question_key: z.string(),
      mapping_confidence: z.number().describe("0-1"),
      status: z.enum(["answered", "no_answer", "unclear"]),
      text: z.string().describe("Faithful transcription; LaTeX for math; [illegible] for unreadable spans"),
      line_keys: z.array(z.string()),
      struck_text: z.string().nullable(),
      has_diagram: z.boolean(),
      diagram_description: z.string().nullable(),
      illegible_spans: z.number().int(),
      ocr_corrections: z.array(z.object({ line_key: z.string(), ocr: z.string(), corrected: z.string() })),
    }),
  ),
  flags: z.array(TranscriptionFlag),
});
export type Transcription = z.infer<typeof TranscriptionSchema>;

export const ERROR_TYPES = [
  "computational",
  "conceptual",
  "procedural",
  "notation",
  "incomplete",
  "misread_question",
  "none",
] as const;

export const GradeFlag = z.enum(["wellbeing_review", "possible_copying", "off_task", "needs_teacher_judgement"]);
export const ANNOTATION_KINDS = ["correct", "error", "partial", "unclear", "praise", "note"] as const;

export const GradeSchema = z.object({
  items: z.array(
    z.object({
      ...itemRef,
      score: z.number(),
      max: z.number(),
      level_label: z.string().nullable(),
      evidence_line_keys: z.array(z.string()),
      rationale: z.string().describe("1-2 sentences for the teacher"),
      confidence: z.number().describe("0-1 self-assessed"),
      error_type: z.enum(ERROR_TYPES).nullable(),
      misconception_tag: z.string().nullable().describe("short reusable snake_case tag, e.g. adds_denominators"),
    }),
  ),
  annotations: z.array(
    z.object({
      page_position: z.number().int(),
      kind: z.enum(ANNOTATION_KINDS),
      line_keys: z.array(z.string()),
      approx_bbox: z
        .object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() })
        .nullable()
        .describe("0-1 relative to the page image; only when line_keys is empty"),
      text: z.string().describe("margin comment, max ~15 words"),
    }),
  ),
  feedback: z.object({
    glows: z.array(z.string()),
    grows: z.array(z.object({ point: z.string(), how: z.string() })),
    next_step: z.string(),
    practice_item: z.string().nullable(),
    summary_for_teacher: z.string(),
  }),
  flags: z.array(GradeFlag),
});
export type Grade = z.infer<typeof GradeSchema>;

export const VerificationSchema = z.object({
  items: z.array(
    z.object({
      ...itemRef,
      score: z.number(),
      confidence: z.number(),
      transcription_doubt: z.string().nullable(),
    }),
  ),
});
export type Verification = z.infer<typeof VerificationSchema>;

export const KeyExtractionSchema = z.object({
  questions: z.array(
    z.object({
      label: z.string(),
      prompt_text: z.string(),
      type: z.enum([
        "numeric",
        "short_answer",
        "multiple_choice",
        "math_steps",
        "extended_writing",
        "diagram",
        "other",
      ]),
      max_points: z.number(),
      correct_answers: z.array(z.string()),
      equivalents: z.array(z.string()),
      form_matters: z.boolean(),
      notes: z.string(),
      extraction_confidence: z.number(),
    }),
  ),
});
export type KeyExtraction = z.infer<typeof KeyExtractionSchema>;

export const NameReadSchema = z.object({ name_text: z.string().nullable(), confidence: z.number() });
export type NameRead = z.infer<typeof NameReadSchema>;

export const RegenerateSchema = z.object({ comment: z.string() });
