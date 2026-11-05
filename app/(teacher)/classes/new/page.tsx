import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { Card, CardContent } from "@/components/ui/card";
import { NewClassForm } from "./new-class-form";

export async function generateMetadata() {
  const t = await getTranslations("classes");
  return { title: t("newTitle") };
}

export default async function NewClassPage() {
  const t = await getTranslations();
  const locale = await getLocale();
  return (
    <div className="mx-auto flex max-w-lg flex-col gap-6">
      <Link
        href="/"
        className="inline-flex min-h-11 items-center gap-1 self-start text-sm text-ink-muted hover:text-ink"
      >
        <ArrowLeft aria-hidden className="size-4" /> {t("common.back")}
      </Link>
      <h1 className="font-serif text-4xl">{t("classes.newTitle")}</h1>
      <Card>
        <CardContent>
          <NewClassForm defaultLocale={locale} />
        </CardContent>
      </Card>
    </div>
  );
}
