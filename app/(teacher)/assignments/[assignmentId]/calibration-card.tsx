"use client";
import { GraduationCap, RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { regradeUntouched } from "@/lib/actions/calibration";

/** Calibration status (§3.1, §8.5): how many teacher-graded examples steer this batch. */
export function CalibrationCard({ assignmentId, count }: { assignmentId: string; count: number }) {
  const t = useTranslations("hub");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
      <div className="flex items-start gap-2">
        <GraduationCap aria-hidden className="mt-0.5 size-5 shrink-0 text-ink-muted" />
        <div>
          <p className="font-medium">{t("calibrationTitle", { count })}</p>
          <p className="text-sm text-ink-muted">{count ? t("calibrationOn") : t("calibrationHint")}</p>
        </div>
      </div>
      {count > 0 && (
        <div className="flex flex-col items-end gap-1">
          <Button
            variant="outline"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await regradeUntouched(assignmentId);
                setMsg(t("regradedUntouched", { count: res.count }));
              })
            }
          >
            <RotateCcw aria-hidden /> {t("regradeUntouched")}
          </Button>
          <p role="status" className="text-xs text-ink-muted">
            {msg}
          </p>
        </div>
      )}
    </Card>
  );
}
