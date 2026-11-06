"use client";
import { RefreshCw, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { refreshStyleProfile, resetStyleProfile } from "@/lib/actions/style";

export function StyleActions({ hasProfile }: { hasProfile: boolean }) {
  const t = useTranslations("style");
  const [msg, setMsg] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          disabled={pending}
          onClick={() => start(async () => setMsg((await refreshStyleProfile()).ok ? t("queued") : t("failed")))}
        >
          <RefreshCw aria-hidden /> {t("refresh")}
        </Button>
        {hasProfile &&
          (confirm ? (
            <Button
              variant="outline"
              className="border-pen-red text-pen-red"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  setMsg((await resetStyleProfile()).ok ? t("resetDone") : t("failed"));
                  setConfirm(false);
                })
              }
            >
              <Trash2 aria-hidden /> {t("resetConfirm")}
            </Button>
          ) : (
            <Button variant="ghost" onClick={() => setConfirm(true)}>
              <Trash2 aria-hidden /> {t("reset")}
            </Button>
          ))}
      </div>
      <p role="status" className="text-sm text-ink-muted">
        {msg}
      </p>
    </div>
  );
}
