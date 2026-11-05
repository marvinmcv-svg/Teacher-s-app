import { Download } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Wordmark } from "@/components/brand";
import { loadReleaseByToken, signedPageUrl } from "@/lib/release/load";
import { StudentPage } from "./student-page";

export const metadata: Metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" };

/**
 * Public student view (§4.1 #7). No login: the token is validated server-side
 * with the service role and only this submission's released data is returned.
 */
export default async function StudentView({ params }: PageProps<"/s/[token]">) {
  const { token } = await params;
  const work = await loadReleaseByToken(token);
  if (!work) {
    const t = await getTranslations("student");
    return (
      <main className="relative z-10 mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-4">
        <Wordmark />
        <h1 className="font-serif text-3xl">{t("notFoundTitle")}</h1>
        <p className="text-ink-muted">{t("notFound")}</p>
      </main>
    );
  }
  const t = await getTranslations({ locale: work.locale, namespace: "student" });
  // storage paths never leave the server; only short-lived signed URLs do
  const pages = await Promise.all(
    work.pages.map(async (p) => ({
      id: p.id,
      position: p.position,
      width: p.width,
      height: p.height,
      url: await signedPageUrl(p.path),
    })),
  );
  return (
    <main
      lang={work.locale}
      className="relative z-10 mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6 print:max-w-none print:p-0"
    >
      <div className="flex items-center justify-between print:hidden">
        <Wordmark />
        <a
          href={`/s/${token}/annotated.pdf`}
          className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-rule bg-card px-4 text-sm font-medium"
        >
          <Download aria-hidden className="size-4" /> {t("download")}
        </a>
      </div>
      <StudentPage
        work={{ ...work, pages }}
        labels={{
          title: t("title"),
          grade: t("grade"),
          glows: t("glows"),
          grows: t("grows"),
          how: t("how"),
          nextStep: t("nextStep"),
          practice: t("practice"),
          comments: t("comments"),
          disclosure: t("disclosure"),
          page: work.pages.map((p) => t("page", { n: p.position })),
          kinds: {
            correct: t("kinds.correct"),
            error: t("kinds.error"),
            partial: t("kinds.partial"),
            unclear: t("kinds.unclear"),
            praise: t("kinds.praise"),
            note: t("kinds.note"),
          },
        }}
      />
    </main>
  );
}
