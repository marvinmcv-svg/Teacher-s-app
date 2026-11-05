"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { enqueueGrading } from "@/lib/pipeline/enqueue";
import { createSupabaseServerClient } from "@/lib/supabase/server";

async function requireTeacher() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");
  return { supabase, user: data.user };
}

const StartSchema = z.object({
  assignmentId: z.uuid(),
  clientRef: z.string().min(8).max(64),
  studentId: z.uuid().nullable(),
  pageCount: z.number().int().min(1).max(20),
  /** Replace this student's earlier (unreleased) work — used for retakes. */
  replaceExisting: z.boolean().default(false),
});

export type StartSubmissionResult =
  | { ok: true; submissionId: string; pagePaths: string[] }
  | { ok: false; error: "invalid" | "not_found" | "duplicate_student" | "failed" };

/**
 * Create (or find, on resume) the submission for one queued student capture,
 * and return the storage paths the browser should upload pages to. Idempotent
 * by (assignment, clientRef).
 */
export async function startSubmission(input: z.input<typeof StartSchema>): Promise<StartSubmissionResult> {
  const p = StartSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "invalid" };
  const { supabase, user } = await requireTeacher();
  const { assignmentId, clientRef, studentId, pageCount, replaceExisting } = p.data;

  const { data: assignment } = await supabase
    .from("assignments")
    .select("id, status")
    .eq("id", assignmentId)
    .maybeSingle();
  if (!assignment) return { ok: false, error: "not_found" };

  let { data: sub } = await supabase
    .from("submissions")
    .select("id")
    .eq("assignment_id", assignmentId)
    .eq("client_ref", clientRef)
    .maybeSingle();
  if (!sub && studentId && replaceExisting) {
    const { data: prev } = await supabase
      .from("submissions")
      .select("id, status")
      .eq("assignment_id", assignmentId)
      .eq("student_id", studentId)
      .maybeSingle();
    if (prev && prev.status !== "released") await supabase.from("submissions").delete().eq("id", prev.id);
  }
  if (!sub) {
    const ins = await supabase
      .from("submissions")
      .insert({
        assignment_id: assignmentId,
        student_id: studentId,
        client_ref: clientRef,
        status: "uploading",
        match_method: studentId ? "manual" : null,
      })
      .select("id")
      .single();
    if (ins.error) {
      // unique (assignment_id, student_id): this student already has work for this assignment
      if (ins.error.code === "23505" && studentId) return { ok: false, error: "duplicate_student" };
      console.error("submissions.create_failed", { code: ins.error.code });
      return { ok: false, error: "failed" };
    }
    sub = ins.data;
    if (assignment.status === "draft" || assignment.status === "collecting")
      await supabase.from("assignments").update({ status: "grading" }).eq("id", assignmentId);
  }
  const pagePaths = Array.from(
    { length: pageCount },
    (_, i) => `${user.id}/${assignmentId}/${sub!.id}/original-p${i + 1}.jpg`,
  );
  return { ok: true, submissionId: sub.id, pagePaths };
}

const FinishSchema = z.object({
  submissionId: z.uuid(),
  pages: z
    .array(
      z.object({
        position: z.number().int().min(1).max(20),
        path: z.string().max(300),
        quality: z
          .object({ sharpness: z.number(), brightness: z.number(), glare: z.number(), issues: z.array(z.string()) })
          .nullable(),
        override: z.boolean(),
      }),
    )
    .min(1)
    .max(20),
});

/** Register uploaded pages and queue grading. Idempotent: re-running replaces page rows. */
export async function finishSubmission(input: z.input<typeof FinishSchema>): Promise<{ ok: boolean }> {
  const p = FinishSchema.safeParse(input);
  if (!p.success) return { ok: false };
  const { supabase, user } = await requireTeacher();
  const { submissionId, pages } = p.data;
  const { data: sub } = await supabase
    .from("submissions")
    .select("id, assignment_id")
    .eq("id", submissionId)
    .maybeSingle();
  if (!sub) return { ok: false };
  // Paths must live under this teacher's prefix for this submission (storage RLS enforces it too).
  const prefix = `${user.id}/${sub.assignment_id}/${sub.id}/`;
  if (pages.some((pg) => !pg.path.startsWith(prefix))) return { ok: false };

  await supabase.from("pages").delete().eq("submission_id", sub.id);
  const { error } = await supabase.from("pages").insert(
    pages.map((pg) => ({
      submission_id: sub.id,
      position: pg.position,
      storage_path: pg.path,
      quality: pg.quality,
      quality_override: pg.override,
    })),
  );
  if (error) {
    console.error("pages.insert_failed", { code: error.code });
    return { ok: false };
  }
  await supabase
    .from("submissions")
    .update({ status: "queued", processing_stage: "queued", error_code: null })
    .eq("id", sub.id);
  const queued = await queueOrFlag(supabase, sub.id, user.id);
  revalidatePath(`/assignments/${sub.assignment_id}`);
  return { ok: queued };
}

/** Pages are safely stored even if the job queue is down; the teacher can retry grading later. */
async function queueOrFlag(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  submissionId: string,
  teacherId: string,
) {
  try {
    await enqueueGrading(submissionId, teacherId);
    return true;
  } catch (err) {
    console.error("grading.enqueue_failed", { name: (err as Error).name });
    await supabase
      .from("submissions")
      .update({ status: "needs_attention", processing_stage: "failed", error_code: "queue_unavailable" })
      .eq("id", submissionId);
    return true; // upload itself succeeded — don't make the client re-upload
  }
}

/** Teacher confirms (or changes) which student a submission belongs to. */
export async function setSubmissionStudent(submissionId: string, studentId: string | null) {
  const ids = z.object({ s: z.uuid(), st: z.uuid().nullable() }).safeParse({ s: submissionId, st: studentId });
  if (!ids.success) return { ok: false as const, error: "invalid" as const };
  const { supabase } = await requireTeacher();
  const { data, error } = await supabase
    .from("submissions")
    .update({ student_id: studentId, match_method: studentId ? "manual" : null, suggested_student_id: null })
    .eq("id", submissionId)
    .select("assignment_id")
    .maybeSingle();
  if (error)
    return { ok: false as const, error: error.code === "23505" ? ("duplicate_student" as const) : ("failed" as const) };
  if (data) revalidatePath(`/assignments/${data.assignment_id}`);
  return { ok: true as const };
}

/** Re-run grading (e.g. after a retake or once the API is configured). */
export async function regradeSubmission(submissionId: string) {
  if (!z.uuid().safeParse(submissionId).success) return { ok: false };
  const { supabase, user } = await requireTeacher();
  const { data: sub } = await supabase
    .from("submissions")
    .select("id, assignment_id, status")
    .eq("id", submissionId)
    .maybeSingle();
  if (!sub || sub.status === "released") return { ok: false };
  await supabase
    .from("submissions")
    .update({ status: "queued", processing_stage: "queued", error_code: null })
    .eq("id", sub.id);
  await queueOrFlag(supabase, sub.id, user.id);
  revalidatePath(`/assignments/${sub.assignment_id}`);
  return { ok: true };
}
