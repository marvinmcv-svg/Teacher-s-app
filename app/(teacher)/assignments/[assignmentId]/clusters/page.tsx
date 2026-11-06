import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { Card } from "@/components/ui/card";
import { CLUSTERABLE_TYPES, buildClusters } from "@/lib/grading/clusters";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ClusterList, type ClusterView } from "./cluster-list";

export async function generateMetadata() {
  const t = await getTranslations("clusters");
  return { title: t("title") };
}

/** Grade-once view (§3.4): identical answers across the class, grouped per question. */
export default async function ClustersPage({
  params,
  searchParams,
}: PageProps<"/assignments/[assignmentId]/clusters">) {
  const { assignmentId } = await params;
  const { q } = (await searchParams) as { q?: string };
  if (!z.uuid().safeParse(assignmentId).success) notFound();
  const t = await getTranslations();
  const supabase = await createSupabaseServerClient();
  const { data: a } = await supabase
    .from("assignments")
    .select("id, title, class_id")
    .eq("id", assignmentId)
    .maybeSingle();
  if (!a) notFound();
  const { data: questions } = await supabase
    .from("questions")
    .select("id, label, position, type, max_points, prompt_text")
    .eq("assignment_id", a.id)
    .in("type", [...CLUSTERABLE_TYPES])
    .order("position");
  const list = questions ?? [];
  const question = list.find((x) => x.id === q) ?? list[0];

  let clusters: ClusterView[] = [];
  if (question) {
    const [{ data: answers }, { data: scores }, { data: roster }, { data: graded }] = await Promise.all([
      supabase
        .from("answers")
        .select(
          "id, submission_id, text, teacher_corrected_text, status, submissions!inner(assignment_id, status, student_id)",
        )
        .eq("question_id", question.id)
        .eq("submissions.assignment_id", a.id),
      supabase.from("criterion_scores").select("submission_id, ai_score, teacher_score").eq("question_id", question.id),
      supabase.from("students").select("id, display_name").eq("class_id", a.class_id),
      supabase
        .from("answer_clusters")
        .select("normalised_answer, teacher_score, teacher_comment")
        .eq("question_id", question.id),
    ]);
    const nameOf = new Map((roster ?? []).map((s) => [s.id, s.display_name]));
    const scoreOf = new Map(
      (scores ?? []).map((s) => [
        s.submission_id,
        { ai: Number(s.ai_score), teacher: s.teacher_score === null ? null : Number(s.teacher_score) },
      ]),
    );
    const gradedByKey = new Map((graded ?? []).map((g) => [g.normalised_answer, g]));
    const rows = (answers ?? []).map((x) => {
      const sub = x.submissions as unknown as { status: string; student_id: string | null };
      return {
        answerId: x.id,
        submissionId: x.submission_id,
        text: x.teacher_corrected_text ?? x.text,
        status: x.status,
        submissionStatus: sub.status,
        name: sub.student_id ? (nameOf.get(sub.student_id) ?? null) : null,
        score: scoreOf.get(x.submission_id) ?? null,
      };
    });
    clusters = buildClusters(rows, question.type).map((c) => ({
      key: c.key,
      display: c.display,
      graded: gradedByKey.has(c.key)
        ? {
            score: Number(gradedByKey.get(c.key)!.teacher_score),
            comment: gradedByKey.get(c.key)!.teacher_comment,
          }
        : null,
      members: c.members.map((m) => ({
        submissionId: m.submissionId,
        name: m.name,
        editable: m.submissionStatus === "ready",
        score: m.score ? (m.score.teacher ?? m.score.ai) : null,
        aiScore: m.score?.ai ?? null,
      })),
    }));
  }

  return (
    <div className="flex flex-col gap-6">
      <Link
        href={`/assignments/${a.id}`}
        className="inline-flex min-h-11 items-center gap-1 self-start text-sm text-ink-muted hover:text-ink"
      >
        <ArrowLeft aria-hidden className="size-4" /> {a.title}
      </Link>
      <div>
        <h1 className="font-serif text-4xl">{t("clusters.title")}</h1>
        <p className="mt-1 max-w-prose text-ink-muted">{t("clusters.intro")}</p>
      </div>
      {!question ? (
        <Card className="p-6 text-ink-muted">{t("clusters.noQuestions")}</Card>
      ) : (
        <>
          <nav aria-label={t("clusters.questions")} className="flex flex-wrap gap-2">
            {list.map((x) => (
              <Link
                key={x.id}
                href={`/assignments/${a.id}/clusters?q=${x.id}`}
                aria-current={x.id === question.id ? "page" : undefined}
                className={
                  x.id === question.id
                    ? "inline-flex min-h-11 items-center rounded-full border border-ink bg-ink px-4 text-paper"
                    : "inline-flex min-h-11 items-center rounded-full border border-rule bg-card px-4"
                }
              >
                {t("assignments.questionLabel")} {x.label}
              </Link>
            ))}
          </nav>
          {question.prompt_text && <p className="text-sm text-ink-muted">{question.prompt_text}</p>}
          {clusters.length === 0 ? (
            <Card className="p-6 text-ink-muted">{t("clusters.empty")}</Card>
          ) : (
            <ClusterList
              key={question.id}
              assignmentId={a.id}
              questionId={question.id}
              max={Number(question.max_points)}
              clusters={clusters}
            />
          )}
        </>
      )}
    </div>
  );
}
