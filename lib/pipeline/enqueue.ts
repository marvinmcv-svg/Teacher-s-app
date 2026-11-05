import "server-only";
import { inngest } from "@/inngest/client";

/** Queue grading for a submission (status → queued). Called once all its pages are uploaded. */
export async function enqueueGrading(submissionId: string, teacherId: string) {
  await inngest.send({ name: "tinta/submission.grade.requested", data: { submissionId, teacherId } });
}
