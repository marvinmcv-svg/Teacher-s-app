import "server-only";
import { getTranslations } from "next-intl/server";
import { downloadPage, type ReleasedWork } from "./load";
import { renderAnnotatedPage, renderAnnotatedPdf, type RenderPin } from "./render";

function pinsOf(work: NonNullable<ReleasedWork>): RenderPin[] {
  return work.pins.map((p) => ({
    kind: p.kind,
    region: p.region,
    approximate: p.approximate,
    text: p.text,
    number: p.number,
    page_id: p.page_id,
  }));
}

export async function annotatedPages(work: NonNullable<ReleasedWork>) {
  const pins = pinsOf(work);
  return Promise.all(
    work.pages.map(async (p) =>
      renderAnnotatedPage(
        await downloadPage(p.path),
        pins.filter((x) => x.page_id === p.id),
      ),
    ),
  );
}

/** Red-pen PDF in the student's feedback language (§3.5b). */
export async function annotatedPdf(work: NonNullable<ReleasedWork>) {
  const t = await getTranslations({ locale: work.locale, namespace: "student" });
  const pages = await annotatedPages(work);
  return renderAnnotatedPdf({
    pages,
    pins: pinsOf(work),
    feedback: work.feedback,
    strings: {
      title: work.assignment.title,
      student: work.studentName,
      grade: work.showScore && work.grade ? `${t("grade")}: ${work.grade.display}` : null,
      glows: t("glows"),
      grows: t("grows"),
      nextStep: t("nextStep"),
      practice: t("practice"),
      comments: t("comments"),
      disclosure: t("disclosure"),
    },
  });
}

export const pdfHeaders = (filename: string) => ({
  "Content-Type": "application/pdf",
  "Content-Disposition": `inline; filename="${filename.replace(/[^\w.-]+/g, "_")}"`,
  "Cache-Control": "private, no-store",
});
