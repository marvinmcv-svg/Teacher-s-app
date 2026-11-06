import { safeFileName, lastFirst } from "@/lib/marking/filenames";
import { downloadOriginal, loadMarkedPaper, teacherCanSee } from "@/lib/marking/load";
import { renderMarkedPage } from "@/lib/marking/render";

/** One marked page as a JPEG (`?page=2`, default 1). Teacher-only. */
export async function GET(req: Request, ctx: RouteContext<"/api/submissions/[submissionId]/marked.jpg">) {
  const { submissionId } = await ctx.params;
  if (!(await teacherCanSee("submissions", submissionId))) return new Response("Not found", { status: 404 });
  const paper = await loadMarkedPaper(submissionId);
  if (!paper) return new Response("Not graded yet", { status: 409 });
  const n = Math.max(1, Number(new URL(req.url).searchParams.get("page")) || 1);
  const page = paper.pages.find((p) => p.position === n);
  if (!page) return new Response("Not found", { status: 404 });
  const out = await renderMarkedPage(await downloadOriginal(page.path), paper.marksByPage.get(page.id) ?? [], {
    score: n === 1 ? paper.score : null,
    seed: n,
  });
  const base = safeFileName(paper.studentName ? lastFirst(paper.studentName) : "papel");
  const name = paper.pages.length > 1 ? `${base} - ${n}.jpg` : `${base}.jpg`;
  return new Response(new Uint8Array(out.jpeg), {
    headers: {
      "Content-Type": "image/jpeg",
      "Content-Disposition": `attachment; filename="papel.jpg"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "private, no-store",
    },
  });
}
