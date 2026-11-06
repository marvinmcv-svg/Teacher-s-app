import "server-only";
import { zipSync } from "fflate";
import { planFileNames } from "./filenames";
import { downloadOriginal, loadMarkedPaper } from "./load";
import { renderMarkedPage } from "./render";

/** Marked JPEGs for the given papers, one zip, files named "Last, First[ - n].jpg". */
export async function buildMarkedZip(submissionIds: string[], unnamedLabel: string) {
  const papers = (await Promise.all(submissionIds.map((id) => loadMarkedPaper(id)))).filter((p) => !!p);
  const plan = planFileNames(
    papers.map((p) => ({ submissionId: p.submissionId, studentName: p.studentName, pages: p.pages.length })),
    unnamedLabel,
  );
  const byId = new Map(papers.map((p) => [p.submissionId, p]));
  const files: Record<string, Uint8Array> = {};
  for (const f of plan) {
    const paper = byId.get(f.submissionId)!;
    const page = paper.pages.find((p) => p.position === f.page)!;
    const out = await renderMarkedPage(await downloadOriginal(page.path), paper.marksByPage.get(page.id) ?? [], {
      score: f.page === 1 ? paper.score : null,
      seed: f.page,
    });
    files[f.name] = new Uint8Array(out.jpeg);
  }
  // JPEGs don't compress further: store them (level 0) so zipping is instant.
  return { zip: zipSync(files, { level: 0 }), names: plan.map((f) => f.name) };
}
