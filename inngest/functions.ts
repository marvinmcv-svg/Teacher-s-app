import { NonRetriableError } from "inngest";
import { callStructured } from "@/lib/ai/client";
import { perTeacherConcurrency } from "@/lib/ai/config";
import { getOcrProvider } from "@/lib/ocr/google-vision";
import { gradeSubmission, markFailure } from "@/lib/pipeline/grade-submission";
import { splitPdfImport } from "@/lib/pipeline/pdf-import";
import { getAdminClient } from "@/lib/supabase/admin";
import { inngest } from "./client";

export type GradeRequested = { submissionId: string; teacherId: string };

/** Wiring check (Phase 0). */
export const ping = inngest.createFunction(
  { id: "system-ping", triggers: [{ event: "tinta/system.ping" }] },
  async ({ event, step }) => {
    const receivedAt = await step.run("record", () => new Date().toISOString());
    return { ok: true, receivedAt, eventId: event.id ?? null };
  },
);

/**
 * submission.grade (§8.1): one run per submission, every AI/OCR call in its
 * own step so retries never redo finished work. Concurrency is limited per
 * teacher to control cost; Inngest retries with backoff (the Anthropic SDK
 * already honours retry-after on 429/529).
 */
export const gradeSubmissionFn = inngest.createFunction(
  {
    id: "submission-grade",
    triggers: [{ event: "tinta/submission.grade.requested" }],
    concurrency: [{ key: "event.data.teacherId", limit: perTeacherConcurrency }],
    retries: 3,
    onFailure: async ({ event, error }) => {
      const data = (event.data as { event?: { data?: GradeRequested } }).event?.data;
      if (!data?.submissionId) return;
      const db = getAdminClient();
      await db
        .from("submissions")
        .update({
          status: "needs_attention",
          processing_stage: "failed",
          error_code: "pipeline_error",
          confidence: "low",
        })
        .eq("id", data.submissionId);
      console.error("pipeline.failed", { submissionId: data.submissionId, error: error.name });
    },
  },
  async ({ event, step }) => {
    const { submissionId } = event.data as GradeRequested;
    const deps = { db: getAdminClient(), ocr: getOcrProvider(), ai: callStructured };
    try {
      return await gradeSubmission(deps, submissionId, (name, fn) => step.run(name, fn) as never);
    } catch (err) {
      // Configuration problems won't fix themselves on retry — surface them to the teacher now.
      if (await markFailure(deps.db, submissionId, err)) throw new NonRetriableError("not retryable");
      throw err;
    }
  },
);

/** Scanner PDF → rasterise → split by QR / page count → one grading run per student (§3.2). */
export const pdfImportFn = inngest.createFunction(
  {
    id: "pdf-import-split",
    triggers: [{ event: "tinta/pdf.import.requested" }],
    concurrency: [{ key: "event.data.teacherId", limit: 1 }],
    retries: 2,
    onFailure: async ({ event, error }) => {
      const data = (event.data as { event?: { data?: { importId?: string } } }).event?.data;
      if (!data?.importId) return;
      await getAdminClient()
        .from("pdf_imports")
        .update({ status: "failed", error_code: "pipeline_error" })
        .eq("id", data.importId);
      console.error("pdf_import.failed", { importId: data.importId, error: error.name });
    },
  },
  async ({ event, step }) => {
    const { importId, teacherId } = event.data as { importId: string; teacherId: string };
    const ids = await step.run("rasterise-and-split", () => splitPdfImport(getAdminClient(), importId));
    if (ids.length)
      await step.sendEvent(
        "queue-grading",
        ids.map((submissionId) => ({
          name: "tinta/submission.grade.requested",
          data: { submissionId, teacherId } satisfies GradeRequested,
        })),
      );
    return { submissions: ids.length };
  },
);

export const functions = [ping, gradeSubmissionFn, pdfImportFn];
