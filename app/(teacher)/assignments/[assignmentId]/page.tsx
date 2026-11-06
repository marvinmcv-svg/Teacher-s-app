import { ArrowLeft, BarChart3, Camera, ClipboardCheck, Download, Gauge, Layers, Send } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { z } from "zod";
import { ConfidenceChip, StatusChip } from "@/components/chips";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ScaleSchema, describeScale, toScale } from "@/lib/grading/scales";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AutoRefresh } from "./auto-refresh";
import { CalibrationCard } from "./calibration-card";
import { SubmissionStudent } from "./submission-student";
import { RegradeButton } from "./regrade-button";

export default async function AssignmentPage({ params }: PageProps<"/assignments/[assignmentId]">) {
  const { assignmentId } = await params;
  if (!z.uuid().safeParse(assignmentId).success) notFound();
  const t = await getTranslations();
  const format = await getFormatter();
  const supabase = await createSupabaseServerClient();
  const { data: a } = await supabase
    .from("assignments")
    .select("id, title, status, scale, class_id, classes(id, name)")
    .eq("id", assignmentId)
    .maybeSingle();
  if (!a) notFound();
  const [{ data: subs }, { data: roster }, { data: imports }, { count: exemplarCount }] = await Promise.all([
    supabase
      .from("submissions")
      .select(
        "id, student_id, suggested_student_id, status, processing_stage, confidence, error_code, total_score, total_max, created_at",
      )
      .eq("assignment_id", a.id)
      .order("created_at"),
    supabase
      .from("students")
      .select("id, display_name")
      .eq("class_id", a.class_id)
      .eq("active", true)
      .order("display_name"),
    supabase
      .from("pdf_imports")
      .select("id, status, page_count, submissions_created, matched_by_qr, error_code, created_at")
      .eq("assignment_id", assignmentId)
      .order("created_at", { ascending: false })
      .limit(5),
    supabase.from("exemplars").select("id", { count: "exact", head: true }).eq("assignment_id", assignmentId),
  ]);
  const scale = ScaleSchema.safeParse(a.scale);
  const nameOf = new Map((roster ?? []).map((s) => [s.id, s.display_name]));
  const list = subs ?? [];
  const toReview = list.filter((s) => s.status === "ready").length;
  const splitting = (imports ?? []).some((i) => i.status === "uploaded" || i.status === "splitting");
  const processing =
    list.filter((s) => ["uploading", "queued", "processing"].includes(s.status)).length + (splitting ? 1 : 0);
  const attention = list.filter((s) => s.status === "needs_attention").length;
  const covered = new Set(list.map((s) => s.student_id).filter(Boolean));
  const missing = (roster ?? []).filter((s) => !covered.has(s.id)).length;
  const cls = a.classes as unknown as { id: string; name: string } | null;

  return (
    <div className="flex flex-col gap-6">
      <AutoRefresh active={processing > 0} />
      <Link
        href={`/classes/${a.class_id}`}
        className="inline-flex min-h-11 items-center gap-1 self-start text-sm text-ink-muted hover:text-ink"
      >
        <ArrowLeft aria-hidden className="size-4" /> {cls?.name}
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-serif text-4xl">{a.title}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink-muted">
            <StatusChip label={t(`assignments.status.${a.status}`)} />
            {scale.success && (
              <span>
                {t("hub.scale")}: {describeScale(scale.data)}
              </span>
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild size="lg">
            <Link href={`/assignments/${a.id}/scan`}>
              <Camera aria-hidden /> {t("hub.scan")}
            </Link>
          </Button>
          <Button asChild variant="outline" size="lg">
            <Link href={`/assignments/${a.id}/review`}>
              <ClipboardCheck aria-hidden />{" "}
              {toReview + attention ? t("hub.reviewCount", { count: toReview + attention }) : t("hub.review")}
            </Link>
          </Button>
          <Button asChild variant="outline" size="lg">
            <Link href={`/assignments/${a.id}/release`}>
              <Send aria-hidden /> {t("hub.release")}
            </Link>
          </Button>
          <Button asChild variant="ghost" size="lg">
            <a href={`/api/assignments/${a.id}/export.csv`} download>
              <Download aria-hidden /> {t("hub.exportCsv")}
            </a>
          </Button>
        </div>
      </div>

      <nav aria-label={t("hub.tools")} className="flex flex-wrap gap-2">
        <Button asChild variant="ghost">
          <Link href={`/assignments/${a.id}/clusters`}>
            <Layers aria-hidden /> {t("hub.gradeByAnswer")}
          </Link>
        </Button>
        <Button asChild variant="ghost">
          <Link href={`/assignments/${a.id}/insights`}>
            <BarChart3 aria-hidden /> {t("hub.insights")}
          </Link>
        </Button>
        <Button asChild variant="ghost">
          <Link href={`/assignments/${a.id}/costs`}>
            <Gauge aria-hidden /> {t("hub.costs")}
          </Link>
        </Button>
      </nav>

      <p className="text-sm text-ink-muted">{t("hub.aiDisclosure")}</p>

      {list.length > 0 && <CalibrationCard assignmentId={a.id} count={exemplarCount ?? 0} />}

      {!!imports?.length && (
        <section aria-labelledby="imports-heading" className="flex flex-col gap-2">
          <h2 id="imports-heading" className="text-sm font-medium uppercase tracking-wide text-ink-muted">
            {t("hub.imports")}
          </h2>
          <Card>
            <ul className="divide-y divide-rule">
              {imports.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                  <span className="tabular text-ink-muted">
                    {format.dateTime(new Date(i.created_at), { dateStyle: "short", timeStyle: "short" })}
                  </span>
                  <span className={i.status === "failed" ? "text-pen-red" : undefined}>
                    {i.status === "done"
                      ? t("hub.importStatus.done", {
                          submissions: i.submissions_created ?? 0,
                          qr: i.matched_by_qr ?? 0,
                          pages: i.page_count ?? 0,
                        })
                      : i.status === "failed"
                        ? t.has(`hub.importErrors.${i.error_code}`)
                          ? t(`hub.importErrors.${i.error_code}`)
                          : t("hub.importStatus.failed")
                        : t(`hub.importStatus.${i.status}`)}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      )}

      <section aria-labelledby="subs-heading" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="subs-heading" className="text-sm font-medium uppercase tracking-wide text-ink-muted">
            {t("hub.submissions")} · {list.length}
          </h2>
          {missing > 0 && list.length > 0 && (
            <span className="text-sm text-ink-muted">{t("hub.missing", { count: missing })}</span>
          )}
        </div>
        {list.length === 0 ? (
          <Card className="p-6 text-ink-muted">{t("hub.noSubmissions")}</Card>
        ) : (
          <Card>
            <ul className="divide-y divide-rule" data-testid="submission-list">
              {list.map((s) => {
                const stage =
                  s.status === "approved" || s.status === "released" ? s.status : (s.processing_stage ?? s.status);
                const busy = ["uploading", "queued", "reading", "grading", "checking"].includes(stage);
                const scaled =
                  scale.success && s.total_max ? toScale(scale.data, Number(s.total_score), Number(s.total_max)) : null;
                return (
                  <li key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <SubmissionStudent
                        submissionId={s.id}
                        studentId={s.student_id}
                        suggested={
                          s.suggested_student_id
                            ? { id: s.suggested_student_id, name: nameOf.get(s.suggested_student_id) ?? "" }
                            : null
                        }
                        roster={roster ?? []}
                      />
                      {s.status === "needs_attention" && s.error_code && (
                        <p className="mt-1 text-sm text-pen-red">
                          {t.has(`pipelineErrors.${s.error_code}`)
                            ? t(`pipelineErrors.${s.error_code}`)
                            : t("pipelineErrors.pipeline_error")}
                        </p>
                      )}
                    </div>
                    {scaled && <span className="tabular text-sm">{scaled.display}</span>}
                    {s.confidence && s.status === "ready" ? (
                      <ConfidenceChip band={s.confidence} label={t(`confidence.${s.confidence}`)} />
                    ) : (
                      <StatusChip
                        label={t(`stages.${stage}`)}
                        tone={
                          busy
                            ? "busy"
                            : stage === "failed"
                              ? "warn"
                              : stage === "approved" || stage === "released"
                                ? "good"
                                : "neutral"
                        }
                      />
                    )}
                    {s.status === "needs_attention" && <RegradeButton submissionId={s.id} />}
                    {(s.status === "ready" || s.status === "approved" || s.status === "released") && (
                      <Button asChild variant="ghost">
                        <Link href={`/assignments/${a.id}/review/${s.id}`}>{t("hub.review")}</Link>
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          </Card>
        )}
      </section>
    </div>
  );
}
