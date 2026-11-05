import { ArrowLeft, QrCode } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getSiteUrl } from "@/lib/site-url";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ReleaseControls, ReleasedRow } from "./release-controls";

export default async function ReleasePage({ params }: PageProps<"/assignments/[assignmentId]/release">) {
  const { assignmentId } = await params;
  if (!z.uuid().safeParse(assignmentId).success) notFound();
  const t = await getTranslations();
  const supabase = await createSupabaseServerClient();
  const { data: a } = await supabase.from("assignments").select("id, title").eq("id", assignmentId).maybeSingle();
  if (!a) notFound();
  const { data: subs } = await supabase
    .from("submissions")
    .select(
      "id, status, students!submissions_student_id_fkey(display_name), releases(id, token, revoked_at, viewed_at, expires_at, created_at)",
    )
    .eq("assignment_id", a.id)
    .order("created_at");
  const base = await getSiteUrl();
  const list = (subs ?? []).map((s) => ({
    id: s.id,
    status: s.status,
    name: (s.students as unknown as { display_name: string } | null)?.display_name ?? t("review.unmatched"),
    release:
      (
        s.releases as unknown as { id: string; token: string; revoked_at: string | null; viewed_at: string | null }[]
      ).find((r) => !r.revoked_at) ?? null,
  }));
  const approved = list.filter((s) => s.status === "approved");
  const released = list.filter((s) => s.status === "released" && s.release);
  const pending = list.filter((s) => !["approved", "released"].includes(s.status)).length;

  return (
    <div className="flex flex-col gap-6">
      <Link
        href={`/assignments/${a.id}`}
        className="inline-flex min-h-11 items-center gap-1 self-start text-sm text-ink-muted hover:text-ink"
      >
        <ArrowLeft aria-hidden className="size-4" /> {a.title}
      </Link>
      <div>
        <h1 className="font-serif text-4xl">{t("release.title")}</h1>
        <p className="mt-1 text-ink-muted">{t("release.intro")}</p>
      </div>

      <Card className="flex flex-col gap-3 p-4">
        <p>{t("release.approvedReady", { count: approved.length })}</p>
        {pending > 0 && <p className="text-sm text-ink-muted">{t("release.pendingCount", { count: pending })}</p>}
        <ReleaseControls
          submissionIds={approved.map((s) => s.id)}
          names={approved.map((s) => ({ id: s.id, name: s.name }))}
        />
      </Card>

      <section aria-labelledby="released-heading" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="released-heading" className="text-sm font-medium uppercase tracking-wide text-ink-muted">
            {t("release.released")} · {released.length}
          </h2>
          {released.length > 0 && (
            <Button asChild variant="outline">
              <a href={`/api/assignments/${a.id}/qr-sheet.pdf`} target="_blank" rel="noopener">
                <QrCode aria-hidden /> {t("release.qrSheet")}
              </a>
            </Button>
          )}
        </div>
        {released.length === 0 ? (
          <Card className="p-5 text-ink-muted">{t("release.noneReleased")}</Card>
        ) : (
          <Card>
            <ul className="divide-y divide-rule" data-testid="released-list">
              {released.map((s) => (
                <ReleasedRow
                  key={s.id}
                  submissionId={s.id}
                  name={s.name}
                  url={`${base}/s/${s.release!.token}`}
                  releaseId={s.release!.id}
                  viewed={!!s.release!.viewed_at}
                  title={a.title}
                />
              ))}
            </ul>
          </Card>
        )}
      </section>
    </div>
  );
}
