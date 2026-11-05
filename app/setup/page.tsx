import { AlertTriangle, CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Wordmark } from "@/components/brand";
import { LanguageSwitcher } from "@/components/language-switcher";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { isSupabaseConfigured } from "@/lib/env";

export default async function SetupPage() {
  const t = await getTranslations("setup");
  const ok = isSupabaseConfigured();
  return (
    <main className="relative z-10 mx-auto flex min-h-dvh max-w-lg flex-col gap-6 px-4 py-10">
      <div className="flex items-center justify-between">
        <Wordmark />
        <LanguageSwitcher />
      </div>
      <Card>
        <CardContent className="flex flex-col gap-4">
          {ok ? (
            <>
              <p className="flex items-center gap-2 text-pen-green">
                <CheckCircle2 aria-hidden className="size-5" /> {t("ok")}
              </p>
              <Button asChild>
                <Link href="/login">{t("goToLogin")}</Link>
              </Button>
            </>
          ) : (
            <>
              <h1 className="flex items-center gap-2 font-serif text-3xl">
                <AlertTriangle aria-hidden className="size-6 text-pen-amber" /> {t("title")}
              </h1>
              <p>{t("body")}</p>
              <p className="text-ink-muted">{t("steps")}</p>
            </>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
