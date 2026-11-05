import { z } from "zod";
import { FeedbackSettingsSchema, QuestionInputSchema, RubricCriterionSchema } from "@/lib/grading/assignment";
import { ScaleSchema } from "@/lib/grading/scales";

const Box = z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() });

/**
 * Golden-set manifest (§8.7). Papers must be collected with WRITTEN consent
 * from the school and parents/guardians and de-identified before they are
 * added (names blurred in the images, no real names anywhere in the manifest).
 */
export const GoldenPaperSchema = z.object({
  id: z.string().regex(/^[a-z0-9_-]+$/),
  consent_ref: z.string().min(3), // reference to the signed consent record (kept outside the repo)
  locale: z.enum(["es", "en"]),
  tags: z.array(z.string()).default([]), // e.g. ["math_steps", "messy_photo", "diagram"]
  assignment: z.string(), // key into `assignments`
  pages: z.array(z.string()).min(1), // image paths relative to evals/golden/
  truth: z.object({
    // teacher ground truth per item key ("q1" or criterion key)
    scores: z.record(z.string(), z.number()),
    second_teacher_scores: z.record(z.string(), z.number()).optional(),
    transcriptions: z.record(z.string(), z.object({ text: z.string(), student_error: z.boolean() })).default({}),
    annotations: z.array(z.object({ page: z.number().int(), box: Box, kind: z.string().optional() })).default([]),
  }),
});

export const GoldenManifestSchema = z.object({
  version: z.literal(1),
  assignments: z.record(
    z.string(),
    z.object({
      title: z.string(),
      subject: z.string().nullable(),
      grade_level: z.string().nullable(),
      scale: ScaleSchema,
      questions: z.array(QuestionInputSchema).default([]),
      criteria: z.array(RubricCriterionSchema).default([]),
      feedback: FeedbackSettingsSchema.prefault({}),
    }),
  ),
  papers: z.array(GoldenPaperSchema),
});
export type GoldenManifest = z.infer<typeof GoldenManifestSchema>;
