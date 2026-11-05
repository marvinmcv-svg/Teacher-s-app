"use client";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export default function TeacherError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations("errors");
  return (
    <Card role="alert" className="flex flex-col items-start gap-3 p-6">
      <p>{t("generic")}</p>
      <Button onClick={reset}>{t("tryAgain")}</Button>
    </Card>
  );
}
