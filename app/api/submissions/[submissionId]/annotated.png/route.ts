import sharp from "sharp";
import { annotatedPages } from "@/lib/release/exports";
import { loadReleasedWork } from "@/lib/release/load";
import { teacherCanSeeSubmission } from "@/lib/release/teacher-access";

/** All pages stacked into one image — easy to send on WhatsApp (§3.5b). */
export async function GET(_req: Request, ctx: RouteContext<"/api/submissions/[submissionId]/annotated.png">) {
  const { submissionId } = await ctx.params;
  if (!(await teacherCanSeeSubmission(submissionId))) return new Response("Not found", { status: 404 });
  const work = await loadReleasedWork(submissionId, { allowApproved: true });
  if (!work) return new Response("Approve the submission first", { status: 409 });
  const pages = await annotatedPages(work);
  const width = Math.max(...pages.map((p) => p.width));
  const height = pages.reduce((s, p) => s + p.height, 0);
  let top = 0;
  const png = await sharp({ create: { width, height, channels: 3, background: "#ffffff" } })
    .composite(pages.map((p) => ({ input: p.jpeg, left: 0, top: (top += p.height) - p.height })))
    .png({ compressionLevel: 9 })
    .toBuffer();
  return new Response(new Uint8Array(png), {
    headers: {
      "Content-Type": "image/png",
      "Content-Disposition": `inline; filename="annotated.png"`,
      "Cache-Control": "private, no-store",
    },
  });
}
