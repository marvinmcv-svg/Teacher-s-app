import { annotatedPdf, pdfHeaders } from "@/lib/release/exports";
import { loadReleasedWork } from "@/lib/release/load";
import { teacherCanSeeSubmission } from "@/lib/release/teacher-access";

export async function GET(_req: Request, ctx: RouteContext<"/api/submissions/[submissionId]/annotated.pdf">) {
  const { submissionId } = await ctx.params;
  if (!(await teacherCanSeeSubmission(submissionId))) return new Response("Not found", { status: 404 });
  const work = await loadReleasedWork(submissionId, { allowApproved: true });
  if (!work) return new Response("Approve the submission first", { status: 409 });
  const pdf = await annotatedPdf(work);
  return new Response(Buffer.from(pdf), {
    headers: pdfHeaders(`${work.studentName ?? "trabajo"} - ${work.assignment.title}.pdf`),
  });
}
