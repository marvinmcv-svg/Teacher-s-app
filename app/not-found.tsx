import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Wordmark } from "@/components/brand";

export default async function NotFound() {
  const t = await getTranslations();
  return (
    <main className="relative z-10 mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-4">
      <Wordmark />
      <h1 className="font-serif text-4xl">{t("errors.notFoundTitle")}</h1>
      <p className="text-ink-muted">{t("errors.notFoundBody")}</p>
      <Link href="/" className="text-pen-blue underline underline-offset-4">
        {t("nav.home")}
      </Link>
    </main>
  );
}
