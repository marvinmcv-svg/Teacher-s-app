import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { RubricCriterionSchema, questionKey } from "@/lib/grading/assignment";
import { ScaleSchema } from "@/lib/grading/scales";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { loadReviewQueue } from "../queue";
import { ReviewScreen, type ReviewData } from "./review-screen";

const SIGNED_URL_TTL = 600; // ≤ 10 minutes (§9)

export default async function ReviewSubmissionPage({
  params,
}: PageProps<"/assignments/[assignmentId]/review/[submissionId]">) {
  const { assignmentId, submissionId } = await params;
  if (!z.uuid().safeParse(assignmentId).success || !z.uuid().safeParse(submissionId).success) notFound();
  const supabase = await createSupabaseServerClient();
  const { data: sub } = await supabase
    .from("submissions")
    .select("*")
    .eq("id", submissionId)
    .eq("assignment_id", assignmentId)
    .maybeSingle();
  if (!sub) notFound();
  const t = await getTranslations();

  const [
    { data: a },
    { data: pages },
    { data: lines },
    { data: pins },
    { data: scores },
    { data: questions },
    { data: answers },
    { data: fb },
  ] = await Promise.all([
    supabase
      .from("assignments")
      .select("id, title, class_id, scale, criteria, feedback_locale")
      .eq("id", assignmentId)
      .single(),
    supabase
      .from("pages")
      .select("id, position, storage_path, width, height")
      .eq("submission_id", sub.id)
      .order("position"),
    supabase.from("ocr_lines").select("line_key, text, bbox, page_id, confidence").eq("submission_id", sub.id),
    supabase
      .from("annotations")
      .select("id, page_id, kind, region, approximate, text, author, hidden, position, anchor_line_keys")
      .eq("submission_id", sub.id)
      .order("position"),
    supabase.from("criterion_scores").select("*").eq("submission_id", sub.id),
    supabase
      .from("questions")
      .select("id, label, position, type, max_points")
      .eq("assignment_id", assignmentId)
      .order("position"),
    supabase
      .from("answers")
      .select("question_id, text, struck_text, status, has_diagram, diagram_description, line_keys")
      .eq("submission_id", sub.id),
    supabase.from("feedback").select("*").eq("submission_id", sub.id).maybeSingle(),
  ]);
  if (!a) notFound();
  const { data: roster } = await supabase
    .from("students")
    .select("id, display_name")
    .eq("class_id", a.class_id)
    .eq("active", true)
    .order("display_name");

  const signed = await Promise.all(
    (pages ?? []).map(async (p) => {
      const { data } = await supabase.storage.from("pages-original").createSignedUrl(p.storage_path, SIGNED_URL_TTL);
      return { ...p, url: data?.signedUrl ?? null };
    }),
  );

  const criteria = z.array(RubricCriterionSchema).safeParse(a.criteria).data ?? [];
  const qByKey = new Map((questions ?? []).map((q) => [questionKey(q.position), q]));
  const answerByQ = new Map((answers ?? []).map((x) => [x.question_id, x]));
  const order = (k: string) =>
    qByKey.has(k) ? qByKey.get(k)!.position : 1000 + criteria.findIndex((c) => c.key === k);
  const items = (scores ?? [])
    .map((s) => {
      const q = s.item_key ? qByKey.get(s.item_key) : undefined;
      const crit = criteria.find((c) => c.key === s.criterion_key);
      const ans = q ? answerByQ.get(q.id) : undefined;
      return {
        id: s.id,
        key: s.item_key ?? "",
        label: q ? `${t("assignments.questionLabel")} ${q.label}` : (crit?.title ?? s.criterion_key ?? ""),
        aiScore: Number(s.ai_score),
        max: Number(s.ai_max),
        teacherScore: s.teacher_score === null ? null : Number(s.teacher_score),
        levels: crit?.levels.map((l) => ({ label: l.label, points: l.points })) ?? null,
        aiLevel: s.ai_level_label,
        teacherLevel: s.teacher_level_label,
        band: s.confidence_band,
        verifierScore: s.verifier_score === null ? null : Number(s.verifier_score),
        disagreement: s.disagreement,
        rationale: s.rationale ?? "",
        evidenceKeys: s.evidence_line_keys,
        acknowledged: !!s.acknowledged_at,
        answer: ans
          ? { text: ans.text, struck: ans.struck_text, diagram: ans.has_diagram ? ans.diagram_description : null }
          : null,
      };
    })
    .sort((x, y) => order(x.key) - order(y.key));

  const queue = await loadReviewQueue(assignmentId);
  const idx = queue.findIndex((s) => s.id === sub.id);
  const data: ReviewData = {
    assignment: { id: a.id, title: a.title, scale: ScaleSchema.parse(a.scale) },
    submission: {
      id: sub.id,
      status: sub.status,
      flags: sub.flags,
      studentId: sub.student_id,
      suggestedStudentId: sub.suggested_student_id,
      errorCode: sub.error_code,
      opened: !!sub.opened_at,
    },
    roster: roster ?? [],
    pages: signed.map((p) => ({
      id: p.id,
      position: p.position,
      url: p.url,
      width: p.width ?? 1,
      height: p.height ?? 1,
    })),
    lines: (lines ?? []).map((l) => ({
      key: l.line_key,
      text: l.text,
      pageId: l.page_id,
      bbox: l.bbox as ReviewData["lines"][number]["bbox"],
      confidence: l.confidence,
    })),
    pins: (pins ?? []).map((p) => ({ ...p, region: p.region as ReviewData["pins"][number]["region"] })),
    items,
    feedback: fb
      ? {
          glows: (fb.glows as string[]) ?? [],
          grows: (fb.grows as { point: string; how: string }[]) ?? [],
          nextStep: fb.next_step ?? "",
          practiceItem: fb.practice_item,
          summary: fb.summary_for_teacher ?? "",
        }
      : null,
    nav: {
      prev: idx > 0 ? queue[idx - 1].id : null,
      next: idx >= 0 && idx < queue.length - 1 ? queue[idx + 1].id : null,
      position: idx + 1,
      total: queue.length,
    },
  };

  return (
    <div className="flex flex-col gap-4">
      <Link
        href={`/assignments/${a.id}/review`}
        className="inline-flex min-h-11 items-center gap-1 self-start text-sm text-ink-muted hover:text-ink"
      >
        <ArrowLeft aria-hidden className="size-4" /> {t("review.queueTitle")} · {a.title}
      </Link>
      <ReviewScreen key={sub.id} data={data} />
    </div>
  );
}
