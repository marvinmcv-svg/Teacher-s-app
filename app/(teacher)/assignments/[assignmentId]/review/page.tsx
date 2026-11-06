import { ArrowLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { ConfidenceChip, StatusChip } from "@/components/chips";
import { Card } from "@/components/ui/card";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { BulkActions } from "./bulk-actions";
import { loadReviewQueue } from "./queue";

export default async function ReviewQueuePage({ params }: PageProps<"/assignments/[assignmentId]/review">) {
  const { assignmentId } = await params;
  if (!z.uuid().safeParse(assignmentId).success) notFound();
  const t = await getTranslations();
  const supabase = await createSupabaseServerClient();
  const { data: a } = await supabase.from("assignments").select("id, title").eq("id", assignmentId).maybeSingle();
  if (!a) notFound();
  const queue = await loadReviewQueue(a.id);
  const ready = queue.filter((s) => s.status === "ready");
  const counts = {
    low: ready.filter((s) => s.confidence === "low").length,
    medium: ready.filter((s) => s.confidence === "medium").length,
    high: ready.filter((s) => s.confidence === "high").length,
    approved: queue.filter((s) => s.status === "approved").length,
    attention: queue.filter((s) => s.status === "needs_attention").length,
  };

  return (
    <div className="flex flex-col gap-6">
      <Link
        href={`/assignments/${a.id}`}
        className="inline-flex min-h-11 items-center gap-1 self-start text-sm text-ink-muted hover:text-ink"
      >
        <ArrowLeft aria-hidden className="size-4" /> {a.title}
      </Link>
      <h1 className="font-serif text-4xl">{t("review.queueTitle")}</h1>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {(
          [
            ["low", t("review.mustReview"), "text-pen-red"],
            ["medium", t("review.check"), "text-pen-amber"],
            ["high", t("review.ready"), "text-pen-green"],
            ["approved", t("review.approved"), "text-ink"],
          ] as const
        ).map(([k, label, cls]) => (
          <Card key={k} className="p-4">
            <dt className="text-sm text-ink-muted">{label}</dt>
            <dd className={`tabular font-serif text-3xl ${cls}`}>{counts[k]}</dd>
          </Card>
        ))}
      </dl>

      <BulkActions assignmentId={a.id} ready={ready.length} approved={counts.approved} />

      {queue.length === 0 ? (
        <Card className="p-6 text-ink-muted">{t("review.empty")}</Card>
      ) : (
        <Card>
          <ol className="divide-y divide-rule" data-testid="review-queue">
            {queue.map((s) => (
              <li key={s.id}>
                <Link
                  href={`/assignments/${a.id}/review/${s.id}`}
                  className="flex min-h-14 items-center gap-3 px-4 py-2 hover:bg-paper"
                >
                  <span className="min-w-0 flex-1 truncate">{s.studentName ?? t("review.unmatched")}</span>
                  {s.flags
                    .filter((f) => f !== "wellbeing_acknowledged")
                    .map((f) => (
                      <StatusChip
                        key={f}
                        label={t.has(`review.flags.${f}`) ? t(`review.flags.${f}`) : f}
                        tone={f === "wellbeing_review" ? "warn" : "neutral"}
                        className="hidden sm:inline-flex"
                      />
                    ))}
                  {s.status === "ready" && s.confidence ? (
                    <ConfidenceChip band={s.confidence} label={t(`confidence.${s.confidence}`)} />
                  ) : (
                    <StatusChip
                      label={t(`stages.${s.status === "needs_attention" ? "failed" : s.status}`)}
                      tone={s.status === "needs_attention" ? "warn" : "good"}
                    />
                  )}
                  <ChevronRight aria-hidden className="size-4 text-ink-muted" />
                </Link>
              </li>
            ))}
          </ol>
        </Card>
      )}
    </div>
  );
}
