"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { callStructured } from "@/lib/ai/client";
import { AiOutputError, AiRefusalError, MissingConfigError } from "@/lib/ai/errors";
import { KEY_EXTRACT_PROMPT_VERSION, keyExtractSystem } from "@/lib/ai/prompts/misc";
import { KeyExtractionSchema } from "@/lib/ai/schemas";
import { FeedbackSettingsSchema, QuestionInputSchema, RubricCriterionSchema } from "@/lib/grading/assignment";
import { ScaleSchema } from "@/lib/grading/scales";
import { normalisePage, toModelImage } from "@/lib/image/process";
import { isLocale } from "@/lib/i18n/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

async function requireTeacher() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");
  return { supabase, user: data.user };
}

const QuestionDraftSchema = QuestionInputSchema.extend({
  source: z.enum(["typed", "extracted", "ai_proposed"]),
  teacher_confirmed: z.boolean(),
});

const CreateAssignmentSchema = z
  .object({
    class_id: z.uuid(),
    title: z.string().trim().min(1).max(160),
    subject: z.string().trim().max(60).nullable(),
    grade_level: z.string().trim().max(60).nullable(),
    feedback_locale: z.string().refine(isLocale),
    scale: ScaleSchema,
    questions: z.array(QuestionDraftSchema).max(100),
    criteria: z.array(RubricCriterionSchema).max(12),
    feedback: FeedbackSettingsSchema,
  })
  .superRefine((a, ctx) => {
    if (a.questions.length === 0 && a.criteria.length === 0)
      ctx.addIssue({ code: "custom", message: "needs_key", path: ["questions"] });
    // §3.1: extracted / AI-proposed rows can't be saved until the teacher confirms each one.
    a.questions.forEach((q, i) => {
      if (q.source !== "typed" && !q.teacher_confirmed)
        ctx.addIssue({ code: "custom", message: "unconfirmed", path: ["questions", i] });
    });
    const labels = a.questions.map((q) => q.label.toLowerCase());
    if (new Set(labels).size !== labels.length)
      ctx.addIssue({ code: "custom", message: "duplicate_labels", path: ["questions"] });
    const keys = a.criteria.map((c) => c.key);
    if (new Set(keys).size !== keys.length)
      ctx.addIssue({ code: "custom", message: "duplicate_criteria", path: ["criteria"] });
  });
export type CreateAssignmentInput = z.input<typeof CreateAssignmentSchema>;
export type CreateAssignmentResult = {
  ok: false;
  error: "needs_key" | "unconfirmed" | "invalid" | "save_failed";
  details?: string[];
};

export async function createAssignment(input: CreateAssignmentInput): Promise<CreateAssignmentResult> {
  const parsed = CreateAssignmentSchema.safeParse(input);
  if (!parsed.success) {
    const msgs = parsed.error.issues.map((i) => i.message);
    const error = msgs.includes("needs_key") ? "needs_key" : msgs.includes("unconfirmed") ? "unconfirmed" : "invalid";
    return { ok: false, error, details: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) };
  }
  const a = parsed.data;
  const { supabase } = await requireTeacher();
  const { data: row, error } = await supabase
    .from("assignments")
    .insert({
      class_id: a.class_id,
      title: a.title,
      subject: a.subject,
      grade_level: a.grade_level,
      feedback_locale: a.feedback_locale as "es" | "en",
      scale: a.scale,
      criteria: a.criteria,
      feedback_settings: a.feedback,
      status: "collecting",
    })
    .select("id")
    .single();
  if (error || !row) {
    console.error("assignments.create_failed", { code: error?.code });
    return { ok: false, error: "save_failed" };
  }
  if (a.questions.length) {
    const { error: qErr } = await supabase.from("questions").insert(
      a.questions.map((q, i) => ({
        assignment_id: row.id,
        position: i + 1,
        label: q.label,
        prompt_text: q.prompt_text || null,
        type: q.type,
        max_points: q.max_points,
        correct_answers: q.correct_answers,
        equivalents: q.equivalents,
        form_matters: q.form_matters,
        partial_credit_rules: q.partial_credit_rules || null,
        notes: q.notes || null,
        source: q.source,
        teacher_confirmed: q.source === "typed" ? true : q.teacher_confirmed,
      })),
    );
    if (qErr) {
      await supabase.from("assignments").delete().eq("id", row.id);
      console.error("questions.create_failed", { code: qErr.code });
      return { ok: false, error: "save_failed" };
    }
  }
  revalidatePath(`/classes/${a.class_id}`);
  redirect(`/assignments/${row.id}`);
}

export type ExtractedRow = z.infer<typeof QuestionDraftSchema> & { extraction_confidence: number };
export type ExtractKeyResult =
  | { ok: true; rows: ExtractedRow[] }
  | { ok: false; error: "not_configured" | "no_images" | "too_large" | "refused" | "failed"; message?: string };

const MAX_KEY_IMAGES = 4;
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

/** Snap the answer key / blank worksheet (§3.1). Images are processed in memory and not stored. */
export async function extractAnswerKey(formData: FormData): Promise<ExtractKeyResult> {
  await requireTeacher();
  const mode = formData.get("mode") === "blank" ? "blank" : "key";
  const files = formData.getAll("images").filter((f): f is File => f instanceof File && f.size > 0);
  if (!files.length) return { ok: false, error: "no_images" };
  if (files.length > MAX_KEY_IMAGES || files.some((f) => f.size > MAX_IMAGE_BYTES))
    return { ok: false, error: "too_large" };
  try {
    const images = [];
    for (const [i, f] of files.entries()) {
      const norm = await normalisePage(Buffer.from(await f.arrayBuffer()));
      const m = await toModelImage(norm.buffer);
      images.push({ mediaType: m.mediaType, base64: m.base64, label: `Page ${i + 1}:` });
    }
    const out = await callStructured({
      role: "key_extract",
      promptVersion: KEY_EXTRACT_PROMPT_VERSION,
      system: keyExtractSystem(mode),
      images,
      text: "Extract the questions.",
      schema: KeyExtractionSchema,
    });
    const rows: ExtractedRow[] = out.questions.map((q) => ({
      label: q.label.slice(0, 20) || "?",
      prompt_text: q.prompt_text,
      type: q.type,
      max_points: Math.max(0, q.max_points),
      correct_answers: q.correct_answers.filter(Boolean),
      equivalents: q.equivalents.filter(Boolean),
      form_matters: q.form_matters,
      partial_credit_rules: "",
      notes: q.notes,
      source: mode === "key" ? "extracted" : "ai_proposed",
      teacher_confirmed: false,
      extraction_confidence: q.extraction_confidence,
    }));
    return { ok: true, rows };
  } catch (err) {
    if (err instanceof MissingConfigError) return { ok: false, error: "not_configured", message: err.message };
    if (err instanceof AiRefusalError) return { ok: false, error: "refused" };
    if (err instanceof AiOutputError) return { ok: false, error: "failed" };
    console.error("key_extract.failed", { name: (err as Error).name });
    return { ok: false, error: "failed" };
  }
}
