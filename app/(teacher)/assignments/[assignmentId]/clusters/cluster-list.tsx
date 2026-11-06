"use client";
import { Check, Users } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { applyClusterGrade } from "@/lib/actions/calibration";
import { EMPTY_KEY } from "@/lib/grading/clusters";
import { ScoreStepper } from "../review/[submissionId]/page-viewer";

export type ClusterView = {
  key: string;
  display: string;
  graded: { score: number; comment: string | null } | null;
  members: {
    submissionId: string;
    name: string | null;
    editable: boolean;
    score: number | null;
    aiScore: number | null;
  }[];
};

export function ClusterList({
  assignmentId,
  questionId,
  max,
  clusters,
}: {
  assignmentId: string;
  questionId: string;
  max: number;
  clusters: ClusterView[];
}) {
  return (
    <ul className="flex flex-col gap-3" data-testid="clusters">
      {clusters.map((c) => (
        <li key={c.key}>
          <ClusterCard assignmentId={assignmentId} questionId={questionId} max={max} cluster={c} />
        </li>
      ))}
    </ul>
  );
}

function ClusterCard({
  assignmentId,
  questionId,
  max,
  cluster,
}: {
  assignmentId: string;
  questionId: string;
  max: number;
  cluster: ClusterView;
}) {
  const t = useTranslations("clusters");
  const router = useRouter();
  const scores = cluster.members.map((m) => m.score).filter((s): s is number => s !== null);
  const common = mode(scores);
  const [score, setScore] = useState(cluster.graded?.score ?? common ?? 0);
  const [comment, setComment] = useState(cluster.graded?.comment ?? "");
  const [result, setResult] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const editable = cluster.members.filter((m) => m.editable).length;
  const distribution = [...count(scores).entries()].sort((a, b) => b[0] - a[0]);
  const inconsistent = distribution.length > 1;

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-mono text-lg">
          {cluster.key === EMPTY_KEY ? <span className="text-ink-muted">{t("blank")}</span> : cluster.display}
        </p>
        <span className="inline-flex items-center gap-1 text-sm text-ink-muted">
          <Users aria-hidden className="size-4" /> {t("wrote", { count: cluster.members.length })}
        </span>
      </div>
      {distribution.length > 0 && (
        <p className={inconsistent ? "text-sm text-pen-amber" : "text-sm text-ink-muted"}>
          {t("currentScores")}: {distribution.map(([s, n]) => `${s}/${max} × ${n}`).join(" · ")}
          {inconsistent && ` — ${t("inconsistent")}`}
        </p>
      )}
      <details className="text-sm">
        <summary className="min-h-9 cursor-pointer text-ink-muted">{t("whoWrote")}</summary>
        <ul className="mt-1 flex flex-wrap gap-2">
          {cluster.members.map((m) => (
            <li key={m.submissionId}>
              <Link
                href={`/assignments/${assignmentId}/review/${m.submissionId}`}
                className="inline-flex min-h-9 items-center rounded-full border border-rule px-3 hover:border-ink-muted"
              >
                {m.name ?? t("unmatched")}
                {!m.editable && <span className="ml-1 text-ink-muted">· {t("locked")}</span>}
              </Link>
            </li>
          ))}
        </ul>
      </details>
      <div className="flex flex-wrap items-end gap-3">
        <ScoreStepper value={score} max={max} onChange={setScore} label={t("groupScore")} disabled={!editable} />
        <Input
          aria-label={t("comment")}
          placeholder={t("comment")}
          value={comment}
          maxLength={300}
          onChange={(e) => setComment(e.target.value)}
          className="min-w-48 flex-1"
          disabled={!editable}
        />
        <Button
          disabled={!editable || pending}
          onClick={() =>
            start(async () => {
              const res = await applyClusterGrade({ assignmentId, questionId, key: cluster.key, score, comment });
              setResult(res.ok ? t("applied", { applied: res.applied, skipped: res.skipped }) : t("applyFailed"));
              if (res.ok) router.refresh();
            })
          }
        >
          <Check aria-hidden /> {t("apply", { count: editable })}
        </Button>
      </div>
      {cluster.graded && (
        <p className="text-xs text-pen-green">{t("gradedAs", { score: cluster.graded.score, max })}</p>
      )}
      <p role="status" className="text-sm">
        {result}
      </p>
    </Card>
  );
}

function count(xs: number[]) {
  const m = new Map<number, number>();
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
  return m;
}
function mode(xs: number[]) {
  return [...count(xs).entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}
