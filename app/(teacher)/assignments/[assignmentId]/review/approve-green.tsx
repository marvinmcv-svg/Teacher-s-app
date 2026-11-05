"use client";
import { Shuffle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { approveAllGreen } from "@/lib/actions/review";

/** Bulk approval exists but is never the default and unlocks only after a random sample is opened (§3.4). */
export function ApproveGreen({
  assignmentId,
  count,
  opened,
  required,
  hasUnopened,
}: {
  assignmentId: string;
  count: number;
  opened: number;
  required: number;
  hasUnopened: boolean;
}) {
  const t = useTranslations("review");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const locked = opened < required;
  return (
    <Card className="flex flex-col gap-3 p-4">
      {locked && <p className="text-sm text-ink-muted">{t("approveAllGreenLocked", { required, opened })}</p>}
      <div className="flex flex-wrap gap-2">
        {locked && hasUnopened && (
          <Button asChild variant="outline">
            <Link href={`/assignments/${assignmentId}/review/random`} prefetch={false}>
              <Shuffle aria-hidden /> {t("openRandomGreen")}
            </Link>
          </Button>
        )}
        <Button
          variant="outline"
          disabled={locked || pending}
          onClick={() =>
            start(async () => {
              const res = await approveAllGreen(assignmentId);
              if (res.ok) setMsg(t("approveAllGreenDone", { count: res.approved }));
              router.refresh();
            })
          }
        >
          {t("approveAllGreen", { count })}
        </Button>
      </div>
      {msg && (
        <p role="status" className="text-sm text-pen-green">
          {msg}
        </p>
      )}
    </Card>
  );
}
