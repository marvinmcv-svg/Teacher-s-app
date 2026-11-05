import { annotatedPdf, pdfHeaders } from "@/lib/release/exports";
import { loadReleaseByToken } from "@/lib/release/load";

export async function GET(_req: Request, ctx: RouteContext<"/s/[token]/annotated.pdf">) {
  const { token } = await ctx.params;
  const work = await loadReleaseByToken(token);
  if (!work) return new Response("Not found", { status: 404 });
  const pdf = await annotatedPdf(work);
  return new Response(Buffer.from(pdf), { headers: pdfHeaders(`${work.assignment.title}.pdf`) });
}
