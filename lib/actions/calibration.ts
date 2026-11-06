"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { blindAgreement } from "@/lib/grading/agreement";
import { RubricCriterionSchema } from "@/lib/grading/assignment";
import { CLUSTERABLE_TYPES, normaliseAnswer } from "@/lib/grading/clusters";
import { enqueueGrading } from "@/lib/pipeline/enqueue";
import { levelStep } from "@/lib/pipeline/context";
import type { Json } from "@/lib/db/types";
import { recordEdit, refreshTotals, requireTeacher } from "./helpers";

export const MAX_EXEMPLARS = 3; // §8.5: token budget

// ---------------------------------------------------------------------------
// Clustering: grade a group of identical answers once (§3.4)
// ---------------------------------------------------------------------------
const ClusterGradeSchema = z.object({
  assignmentId: z.uuid(),
  questionId: z.uuid(),
  key: z.string().min(1).max(500),
  score: z.number().min(0),
  comment: z.string().trim().max(300).optional(),
});

export type ClusterGradeResult = { ok: true; applied: number; skipped: number } | { ok: false };

export async function applyClusterGrade(input: z.input<typeof ClusterGradeSchema>): Promise<ClusterGradeResult> {
  const p = ClusterGradeSchema.safeParse(input);
  if (!p.success) return { ok: false };
  const { assignmentId, questionId, key, score, comment } = p.data;
  const { supabase, user } = await requireTeacher();
  const { data: q } = await supabase
    .from("questions")
    .select("id, type, max_points, assignment_id")
    .eq("id", questionId)
    .eq("assignment_id", assignmentId)
    .maybeSingle();
  if (!q || !(CLUSTERABLE_TYPES as readonly string[]).includes(q.type) || score > Number(q.max_points))
    return { ok: false };

  // Members are recomputed on the server from the stored answers — never taken from the client.
  const { data: answers } = await supabase
    .from("answers")
    .select("id, submission_id, text, teacher_corrected_text, status, submissions!inner(assignment_id, status)")
    .eq("question_id", q.id)
    .eq("submissions.assignment_id", assignmentId);
  const members = (answers ?? []).filter(
    (a) => (a.status === "no_answer" ? "∅" : normaliseAnswer(a.teacher_corrected_text ?? a.text, q.type)) === key,
  );
  if (!members.length) return { ok: false };

  const now = new Date().toISOString();
  let applied = 0;
  let skipped = 0;
  for (const m of members) {
    const status = (m.submissions as unknown as { status: string }).status;
    if (status !== "ready") {
      skipped++; // approved/released work is changed only by reopening it
      continue;
    }
    const { data: item } = await supabase
      .from("criterion_scores")
      .select("id, ai_score, teacher_score, teacher_rationale")
      .eq("submission_id", m.submission_id)
      .eq("question_id", q.id)
      .maybeSingle();
    if (!item) {
      skipped++;
      continue;
    }
    const { error } = await supabase
      .from("criterion_scores")
      .update({ teacher_score: score, acknowledged_at: now, teacher_rationale: comment || item.teacher_rationale })
      .eq("id", item.id);
    if (error) {
      skipped++;
      continue;
    }
    await recordEdit(
      supabase,
      user.id,
      m.submission_id,
      "criterion_scores",
      item.id,
      { score: item.teacher_score ?? item.ai_score },
      { score, via: "cluster", comment: comment || null },
    );
    await refreshTotals(supabase, m.submission_id);
    applied++;
  }

  const { data: cluster } = await supabase
    .from("answer_clusters")
    .upsert(
      {
        assignment_id: assignmentId,
        question_id: q.id,
        normalised_answer: key,
        teacher_score: score,
        teacher_comment: comment || null,
      },
      { onConflict: "assignment_id,question_id,normalised_answer" },
    )
    .select("id")
    .single();
  if (cluster) {
    await supabase.from("answer_cluster_members").delete().eq("cluster_id", cluster.id);
    await supabase
      .from("answer_cluster_members")
      .insert(members.map((m) => ({ cluster_id: cluster.id, answer_id: m.id })));
  }
  revalidatePath(`/assignments/${assignmentId}/clusters`);
  return { ok: true, applied, skipped };
}

// ---------------------------------------------------------------------------
// Calibration exemplars (§3.1, §8.5): approved, teacher-graded papers become
// few-shot examples for the rest of the batch (max 3).
// ---------------------------------------------------------------------------
export type ExemplarResult = { ok: true; count: number } | { ok: false; error: "not_approved" | "limit" | "failed" };

export async function setExemplar(submissionId: string, on: boolean): Promise<ExemplarResult> {
  if (!z.uuid().safeParse(submissionId).success) return { ok: false, error: "failed" };
  const { supabase } = await requireTeacher();
  const { data: sub } = await supabase
    .from("submissions")
    .select("id, assignment_id, status")
    .eq("id", submissionId)
    .maybeSingle();
  if (!sub) return { ok: false, error: "failed" };
  const countNow = async () =>
    (
      await supabase
        .from("exemplars")
        .select("id", { count: "exact", head: true })
        .eq("assignment_id", sub.assignment_id)
    ).count ?? 0;
  if (!on) {
    await supabase.from("exemplars").delete().eq("submission_id", sub.id);
    revalidatePath(`/assignments/${sub.assignment_id}`);
    return { ok: true, count: await countNow() };
  }
  if (sub.status !== "approved" && sub.status !== "released") return { ok: false, error: "not_approved" };
  if ((await countNow()) >= MAX_EXEMPLARS) return { ok: false, error: "limit" };
  const [{ data: items }, { data: fb }] = await Promise.all([
    supabase
      .from("criterion_scores")
      .select(
        "item_key, ai_score, ai_max, teacher_score, ai_level_label, teacher_level_label, rationale, teacher_rationale",
      )
      .eq("submission_id", sub.id),
    supabase.from("feedback").select("glows, grows, next_step").eq("submission_id", sub.id).maybeSingle(),
  ]);
  const teacherScores = (items ?? []).map((i) => ({
    item_key: i.item_key,
    score: Number(i.teacher_score ?? i.ai_score),
    max: Number(i.ai_max),
    level_label: i.teacher_level_label ?? i.ai_level_label,
    rationale: i.teacher_rationale ?? i.rationale,
  }));
  const { error } = await supabase.from("exemplars").upsert(
    {
      assignment_id: sub.assignment_id,
      submission_id: sub.id,
      teacher_scores: teacherScores as NonNullable<Json>,
      teacher_feedback: (fb ?? null) as Json,
    },
    { onConflict: "submission_id" },
  );
  if (error) return { ok: false, error: "failed" };
  revalidatePath(`/assignments/${sub.assignment_id}`);
  return { ok: true, count: await countNow() };
}

/** Regrade work the teacher hasn't touched yet, so it benefits from new exemplars. */
export async function regradeUntouched(assignmentId: string) {
  if (!z.uuid().safeParse(assignmentId).success) return { ok: false, count: 0 };
  const { supabase, user } = await requireTeacher();
  const { data: subs } = await supabase
    .from("submissions")
    .select("id, criterion_scores(teacher_score, acknowledged_at)")
    .eq("assignment_id", assignmentId)
    .eq("status", "ready")
    .is("opened_at", null);
  const untouched = (subs ?? []).filter((s) =>
    (s.criterion_scores as { teacher_score: number | null; acknowledged_at: string | null }[]).every(
      (c) => c.teacher_score === null && !c.acknowledged_at,
    ),
  );
  let count = 0;
  for (const s of untouched) {
    await supabase
      .from("submissions")
      .update({ status: "queued", processing_stage: "queued", error_code: null })
      .eq("id", s.id);
    try {
      await enqueueGrading(s.id, user.id);
      count++;
    } catch {
      await supabase
        .from("submissions")
        .update({ status: "needs_attention", processing_stage: "failed", error_code: "queue_unavailable" })
        .eq("id", s.id);
    }
  }
  revalidatePath(`/assignments/${assignmentId}`);
  return { ok: true, count };
}

// ---------------------------------------------------------------------------
// Blind check (§3.4): grade first, then see the AI. Feeds "AI agreement".
// ---------------------------------------------------------------------------
const BlindSchema = z.object({
  submissionId: z.uuid(),
  scores: z.record(z.uuid(), z.object({ score: z.number().min(0), level: z.string().max(200).nullable() })),
});

export async function submitBlindCheck(input: z.input<typeof BlindSchema>) {
  const p = BlindSchema.safeParse(input);
  if (!p.success) return { ok: false as const };
  const { supabase, user } = await requireTeacher();
  const { submissionId, scores } = p.data;
  const { data: sub } = await supabase
    .from("submissions")
    .select("id, assignment_id, status, blind_check")
    .eq("id", submissionId)
    .maybeSingle();
  if (!sub || sub.status !== "ready" || !sub.blind_check) return { ok: false as const };
  const [{ data: items }, { data: asg }] = await Promise.all([
    supabase.from("criterion_scores").select("*").eq("submission_id", sub.id),
    supabase.from("assignments").select("criteria").eq("id", sub.assignment_id).single(),
  ]);
  const list = items ?? [];
  if (!list.length || list.some((i) => !scores[i.id] || scores[i.id].score > Number(i.ai_max)))
    return { ok: false as const };
  const criteria = z.array(RubricCriterionSchema).safeParse(asg?.criteria).data ?? [];
  const result = blindAgreement(
    list.map((i) => {
      const crit = criteria.find((c) => c.key === i.criterion_key);
      return {
        key: i.item_key ?? "",
        teacher: scores[i.id].score,
        ai: Number(i.ai_score),
        max: Number(i.ai_max),
        levelStep: crit ? levelStep(crit) : null,
      };
    }),
  );
  const { error } = await supabase.from("blind_checks").insert({
    submission_id: sub.id,
    assignment_id: sub.assignment_id,
    teacher_id: user.id,
    items: result.items as NonNullable<Json>,
    n_items: result.n,
    exact_rate: result.exactRate,
    within_rate: result.withinRate,
  });
  if (error && error.code !== "23505") return { ok: false as const }; // 23505: already submitted (double tap)

  // The teacher's own grades stand: where they differ from the AI they become the score.
  const now = new Date().toISOString();
  for (const i of list) {
    const mine = scores[i.id];
    const differs = Math.abs(mine.score - Number(i.ai_score)) > 1e-9;
    await supabase
      .from("criterion_scores")
      .update({
        acknowledged_at: now,
        ...(differs ? { teacher_score: mine.score, teacher_level_label: mine.level } : {}),
      })
      .eq("id", i.id);
    if (differs)
      await recordEdit(
        supabase,
        user.id,
        sub.id,
        "criterion_scores",
        i.id,
        { score: i.ai_score },
        { score: mine.score, via: "blind_check" },
      );
  }
  await refreshTotals(supabase, sub.id);
  return { ok: true as const, exactRate: result.exactRate, withinRate: result.withinRate };
}

export async function setBlindCheckRate(pct: number) {
  if (![0, 5, 10, 20].includes(pct)) return { ok: false };
  const { supabase, user } = await requireTeacher();
  const { error } = await supabase.from("teachers").update({ blind_check_pct: pct }).eq("id", user.id);
  revalidatePath("/settings");
  return { ok: !error };
}
