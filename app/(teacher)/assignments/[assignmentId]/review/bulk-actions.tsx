"use client";
import { Download, Stamp } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { approveAll } from "@/lib/actions/review";

/** Approve everything at once (bulk) and download the marked papers as one zip. */
export function BulkActions({
  assignmentId,
  ready,
  approved,
}: {
  assignmentId: string;
  ready: number;
  approved: number;
}) {
  const t = useTranslations("download");
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <Card className="flex flex-wrap items-center gap-3 p-4">
      <Button
        variant="outline"
        size="lg"
        disabled={pending || ready === 0}
        data-testid="approve-all"
        onClick={() =>
          start(async () => {
            const res = await approveAll(assignmentId);
            setMsg(t("approvedAll", { approved: res.approved, skipped: res.skipped }));
            router.refresh();
          })
        }
      >
        <Stamp aria-hidden /> {t("approveAll", { count: ready })}
      </Button>
      {approved > 0 ? (
        <Button asChild size="lg">
          <a href={`/api/assignments/${assignmentId}/marked.zip`} download data-testid="download-zip">
            <Download aria-hidden /> {t("zip", { count: approved })}
          </a>
        </Button>
      ) : (
        <span className="text-sm text-ink-muted">{t("zipHint")}</span>
      )}
      <p role="status" className="w-full text-sm text-ink-muted empty:hidden">
        {msg}
      </p>
    </Card>
  );
}
