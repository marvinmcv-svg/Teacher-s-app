"use client";
import { RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { regradeSubmission } from "@/lib/actions/capture";

export function RegradeButton({ submissionId }: { submissionId: string }) {
  const t = useTranslations("hub");
  const [pending, start] = useTransition();
  return (
    <Button
      variant="outline"
      disabled={pending}
      onClick={() => start(async () => void (await regradeSubmission(submissionId)))}
    >
      <RotateCcw aria-hidden /> {t("regrade")}
    </Button>
  );
}
