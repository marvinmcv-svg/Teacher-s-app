"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { callStructured } from "@/lib/ai/client";
import { AiOutputError, AiRefusalError, MissingConfigError } from "@/lib/ai/errors";
import { REGENERATE_PROMPT_VERSION, regenerateSystem, regenerateUserText } from "@/lib/ai/prompts/misc";
import { RegenerateSchema } from "@/lib/ai/schemas";
import { canApprove, greenSampleRequired } from "@/lib/grading/review-rules";
import { renderStyleProfile, type StoredProfile } from "@/lib/style/profile";
import { addToBank, bankContext } from "./comment-bank-store";
import { recordEdit, refreshTotals, requireTeacher, type Supa } from "./helpers";

const WELLBEING_ACK = "wellbeing_acknowledged";

async function editableSubmission(supabase: Supa, submissionId: string) {
  const { data } = await supabase
    .from("submissions")
    .select("id, assignment_id, status, flags")
    .eq("id", submissionId)
    .maybeSingle();
  if (!data || data.status === "released") return null; // released work is read-only (reopen first)
  return data;
}

const uuid = z.uuid();

export async function markOpened(submissionId: string) {
  if (!uuid.safeParse(submissionId).success) return;
  const { supabase } = await requireTeacher();
  await supabase
    .from("submissions")
    .update({ opened_at: new Date().toISOString() })
    .eq("id", submissionId)
    .is("opened_at", null);
}

export async function setItemScore(scoreId: string, teacherScore: number | null, levelLabel: string | null = null) {
  if (!uuid.safeParse(scoreId).success) return { ok: false };
  const { supabase, user } = await requireTeacher();
  const { data: item } = await supabase.from("criterion_scores").select("*").eq("id", scoreId).maybeSingle();
  if (!item || !(await editableSubmission(supabase, item.submission_id))) return { ok: false };
  if (teacherScore !== null && (!(teacherScore >= 0) || teacherScore > Number(item.ai_max))) return { ok: false };
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("criterion_scores")
    .update({ teacher_score: teacherScore, teacher_level_label: levelLabel, acknowledged_at: now })
    .eq("id", scoreId);
  if (error) return { ok: false };
  await recordEdit(
    supabase,
    user.id,
    item.submission_id,
    "criterion_scores",
    scoreId,
    { score: item.teacher_score ?? item.ai_score },
    { score: teacherScore ?? item.ai_score },
  );
  await refreshTotals(supabase, item.submission_id);
  return { ok: true };
}

export async function acknowledgeItem(scoreId: string) {
  if (!uuid.safeParse(scoreId).success) return { ok: false };
  const { supabase } = await requireTeacher();
  const { data: item } = await supabase
    .from("criterion_scores")
    .select("submission_id")
    .eq("id", scoreId)
    .maybeSingle();
  if (!item || !(await editableSubmission(supabase, item.submission_id))) return { ok: false };
  await supabase.from("criterion_scores").update({ acknowledged_at: new Date().toISOString() }).eq("id", scoreId);
  return { ok: true };
}

export async function acknowledgeWellbeing(submissionId: string) {
  const { supabase, user } = await requireTeacher();
  const sub = await editableSubmission(supabase, submissionId);
  if (!sub) return { ok: false };
  if (!sub.flags.includes(WELLBEING_ACK))
    await supabase
      .from("submissions")
      .update({ flags: [...sub.flags, WELLBEING_ACK] })
      .eq("id", submissionId);
  await supabase
    .from("audit_log")
    .insert({ actor_id: user.id, action: "wellbeing.acknowledged", entity: "submission", entity_id: submissionId });
  return { ok: true };
}

const FeedbackSchema = z.object({
  glows: z.array(z.string().trim().max(500)).max(6),
  grows: z.array(z.object({ point: z.string().trim().max(500), how: z.string().trim().max(500) })).max(4),
  next_step: z.string().trim().max(500),
  practice_item: z.string().trim().max(800).nullable(),
});

export async function updateFeedback(submissionId: string, input: z.input<typeof FeedbackSchema>) {
  const p = FeedbackSchema.safeParse(input);
  if (!p.success || !uuid.safeParse(submissionId).success) return { ok: false };
  const { supabase, user } = await requireTeacher();
  if (!(await editableSubmission(supabase, submissionId))) return { ok: false };
  const { data: before } = await supabase.from("feedback").select("*").eq("submission_id", submissionId).maybeSingle();
  if (!before) return { ok: false };
  const after = {
    glows: p.data.glows.filter(Boolean),
    grows: p.data.grows.filter((g) => g.point),
    next_step: p.data.next_step,
    practice_item: p.data.practice_item || null,
  };
  await supabase
    .from("feedback")
    .update({ ...after, teacher_edited: true })
    .eq("id", before.id);
  await recordEdit(
    supabase,
    user.id,
    submissionId,
    "feedback",
    before.id,
    { glows: before.glows, grows: before.grows, next_step: before.next_step, practice_item: before.practice_item },
    after,
  );
  return { ok: true };
}

const BBoxSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  w: z.number().min(0).max(1),
  h: z.number().min(0).max(1),
});
const KINDS = ["correct", "error", "partial", "unclear", "praise", "note"] as const;

export async function updateAnnotation(
  id: string,
  patch: { text?: string; hidden?: boolean; kind?: (typeof KINDS)[number] },
) {
  const p = z
    .object({
      text: z.string().trim().min(1).max(300).optional(),
      hidden: z.boolean().optional(),
      kind: z.enum(KINDS).optional(),
    })
    .safeParse(patch);
  if (!p.success || !uuid.safeParse(id).success) return { ok: false };
  const { supabase, user } = await requireTeacher();
  const { data: a } = await supabase.from("annotations").select("*").eq("id", id).maybeSingle();
  if (!a || !(await editableSubmission(supabase, a.submission_id))) return { ok: false };
  await supabase.from("annotations").update(p.data).eq("id", id);
  if (p.data.text && p.data.text !== a.text) {
    const ctx = await bankContext(supabase, a.submission_id);
    await addToBank(supabase, user.id, [
      { text: p.data.text, ...ctx, tags: [p.data.kind ?? a.kind], source: "teacher" },
    ]);
  }
  await recordEdit(
    supabase,
    user.id,
    a.submission_id,
    "annotations",
    id,
    { text: a.text, hidden: a.hidden, kind: a.kind },
    p.data,
  );
  return { ok: true };
}

export async function addAnnotation(
  submissionId: string,
  pageId: string,
  region: z.infer<typeof BBoxSchema>,
  text: string,
  kind: (typeof KINDS)[number] = "note",
) {
  const p = z
    .object({ s: uuid, pg: uuid, r: BBoxSchema, t: z.string().trim().min(1).max(300), k: z.enum(KINDS) })
    .safeParse({ s: submissionId, pg: pageId, r: region, t: text, k: kind });
  if (!p.success) return { ok: false as const };
  const { supabase, user } = await requireTeacher();
  if (!(await editableSubmission(supabase, submissionId))) return { ok: false as const };
  const { data: last } = await supabase
    .from("annotations")
    .select("position")
    .eq("submission_id", submissionId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { data, error } = await supabase
    .from("annotations")
    .insert({
      submission_id: submissionId,
      page_id: pageId,
      kind,
      region: p.data.r,
      text: p.data.t,
      author: "teacher",
      approximate: false,
      position: (last?.position ?? 0) + 1,
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false as const };
  await recordEdit(supabase, user.id, submissionId, "annotations", data.id, null, { text: p.data.t, kind });
  await addToBank(supabase, user.id, [
    { text: p.data.t, ...(await bankContext(supabase, submissionId)), tags: [kind], source: "teacher" },
  ]);
  return { ok: true as const, id: data.id };
}

export type RegenerateResult =
  { ok: true; text: string } | { ok: false; error: "not_configured" | "refused" | "failed" };

/** "Regenerate this comment" with a teacher hint (§3.4). The new text is a suggestion until saved. */
export async function regenerateComment(annotationId: string, instruction: string): Promise<RegenerateResult> {
  if (!uuid.safeParse(annotationId).success) return { ok: false, error: "failed" };
  const { supabase, user } = await requireTeacher();
  const { data: a } = await supabase
    .from("annotations")
    .select("text, anchor_line_keys, submission_id")
    .eq("id", annotationId)
    .maybeSingle();
  if (!a) return { ok: false, error: "failed" };
  const { data: sub } = await supabase
    .from("submissions")
    .select("assignment_id, student_id")
    .eq("id", a.submission_id)
    .maybeSingle();
  const { data: asg } = sub
    ? await supabase.from("assignments").select("feedback_locale").eq("id", sub.assignment_id).maybeSingle()
    : { data: null };
  const { data: lines } = a.anchor_line_keys.length
    ? await supabase
        .from("ocr_lines")
        .select("text")
        .eq("submission_id", a.submission_id)
        .eq("redacted", false)
        .in("line_key", a.anchor_line_keys)
    : { data: [] as { text: string }[] };
  const { data: profile } = await supabase
    .from("style_profiles")
    .select("profile")
    .eq("teacher_id", user.id)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  try {
    const out = await callStructured({
      role: "regenerate",
      promptVersion: REGENERATE_PROMPT_VERSION,
      system: regenerateSystem((asg?.feedback_locale ?? "es") as "es" | "en"),
      images: [],
      text: regenerateUserText(
        a.text,
        (lines ?? []).map((l) => l.text).join("\n"),
        instruction.slice(0, 300) || "Make it clearer.",
        renderStyleProfile(profile?.profile as StoredProfile | undefined),
      ),
      schema: RegenerateSchema,
    });
    return { ok: true, text: out.comment.trim() };
  } catch (err) {
    if (err instanceof MissingConfigError) return { ok: false, error: "not_configured" };
    if (err instanceof AiRefusalError) return { ok: false, error: "refused" };
    if (err instanceof AiOutputError) return { ok: false, error: "failed" };
    throw err;
  }
}

export type ApproveResult = { ok: true } | { ok: false; error: "unreviewed" | "wellbeing" | "not_ready" | "failed" };

const ApproveMetaSchema = z.object({
  reviewSeconds: z
    .number()
    .int()
    .min(0)
    .max(24 * 3600)
    .optional(),
  /** AI pins the teacher opened — approved unchanged, they grow the comment bank (§3.7). */
  openedPins: z.array(z.uuid()).max(200).optional(),
});

export async function approveSubmission(
  submissionId: string,
  meta: z.input<typeof ApproveMetaSchema> = {},
): Promise<ApproveResult> {
  const m = ApproveMetaSchema.safeParse(meta);
  if (!uuid.safeParse(submissionId).success || !m.success) return { ok: false, error: "failed" };
  const { supabase, user } = await requireTeacher();
  const { data: sub } = await supabase
    .from("submissions")
    .select("id, assignment_id, status, flags")
    .eq("id", submissionId)
    .maybeSingle();
  if (!sub || sub.status !== "ready") return { ok: false, error: "not_ready" };
  const { data: items } = await supabase
    .from("criterion_scores")
    .select("confidence_band, ai_score, ai_max, teacher_score, acknowledged_at")
    .eq("submission_id", submissionId);
  const verdict = canApprove(
    (items ?? []).map((i) => ({
      ...i,
      ai_score: i.ai_score === null ? null : Number(i.ai_score),
      ai_max: i.ai_max === null ? null : Number(i.ai_max),
      teacher_score: i.teacher_score === null ? null : Number(i.teacher_score),
    })),
    sub.flags,
    sub.flags.includes(WELLBEING_ACK),
  );
  if (!verdict.ok) return { ok: false, error: verdict.reason };
  const { error } = await supabase
    .from("submissions")
    .update({
      status: "approved",
      approved_by: user.id,
      approved_at: new Date().toISOString(),
      ...(m.data.reviewSeconds !== undefined ? { review_seconds: m.data.reviewSeconds } : {}),
    })
    .eq("id", submissionId)
    .eq("status", "ready");
  if (error) return { ok: false, error: "failed" };
  await supabase
    .from("audit_log")
    .insert({ actor_id: user.id, action: "submission.approved", entity: "submission", entity_id: submissionId });
  if (m.data.openedPins?.length) {
    // AI comments the teacher opened and approved as they were (§3.7). Edited ones were banked on edit.
    const { data: opened } = await supabase
      .from("annotations")
      .select("id, text, kind")
      .eq("submission_id", submissionId)
      .eq("author", "ai")
      .eq("hidden", false)
      .in("id", m.data.openedPins);
    const { data: edits } = await supabase
      .from("teacher_edits")
      .select("target_id")
      .eq("submission_id", submissionId)
      .eq("target_table", "annotations");
    const edited = new Set((edits ?? []).map((e) => e.target_id));
    const ctx = await bankContext(supabase, submissionId);
    await addToBank(
      supabase,
      user.id,
      (opened ?? [])
        .filter((a) => !edited.has(a.id))
        .map((a) => ({ text: a.text, ...ctx, tags: [a.kind], source: "ai_approved" as const })),
    );
  }
  await maybeMarkReviewing(supabase, sub.assignment_id);
  revalidatePath(`/assignments/${sub.assignment_id}`);
  return { ok: true };
}

export async function reopenSubmission(submissionId: string) {
  const { supabase, user } = await requireTeacher();
  const { data: sub } = await supabase
    .from("submissions")
    .select("id, assignment_id, status")
    .eq("id", submissionId)
    .maybeSingle();
  if (!sub || sub.status !== "approved") return { ok: false };
  await supabase
    .from("submissions")
    .update({ status: "ready", approved_by: null, approved_at: null })
    .eq("id", submissionId);
  await supabase
    .from("audit_log")
    .insert({ actor_id: user.id, action: "submission.reopened", entity: "submission", entity_id: submissionId });
  revalidatePath(`/assignments/${sub.assignment_id}`);
  return { ok: true };
}

export type ApproveGreenResult =
  { ok: true; approved: number } | { ok: false; error: "sample_needed"; opened: number; required: number };

/** "Approve all green" — never the default, and only after opening a random sample (§3.4). */
export async function approveAllGreen(assignmentId: string): Promise<ApproveGreenResult> {
  const { supabase, user } = await requireTeacher();
  const { data: a } = await supabase
    .from("assignments")
    .select("id, review_sample_pct")
    .eq("id", assignmentId)
    .maybeSingle();
  if (!a) return { ok: false, error: "sample_needed", opened: 0, required: 0 };
  const { data: green } = await supabase
    .from("submissions")
    .select("id, opened_at, flags")
    .eq("assignment_id", assignmentId)
    .eq("status", "ready")
    .eq("confidence", "high");
  const list = (green ?? []).filter((s) => s.flags.length === 0);
  const opened = list.filter((s) => s.opened_at).length;
  const required = greenSampleRequired(list.length, a.review_sample_pct);
  if (opened < required) return { ok: false, error: "sample_needed", opened, required };
  let approved = 0;
  for (const s of list) {
    const res = await approveSubmission(s.id); // same server-side gating per submission
    if (res.ok) approved++;
  }
  await supabase.from("audit_log").insert({
    actor_id: user.id,
    action: "assignment.approve_all_green",
    entity: "assignment",
    entity_id: assignmentId,
    meta: { approved },
  });
  return { ok: true, approved };
}

async function maybeMarkReviewing(supabase: Supa, assignmentId: string) {
  await supabase
    .from("assignments")
    .update({ status: "reviewing" })
    .eq("id", assignmentId)
    .in("status", ["collecting", "grading"]);
}
