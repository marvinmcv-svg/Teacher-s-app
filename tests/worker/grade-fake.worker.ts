/**
 * E2E stand-in for the Inngest worker: runs the REAL pipeline on one
 * submission with test-only fake OCR/LLM providers. Invoked by
 * tests/e2e/helpers.ts via `vitest run --project worker` (SUBMISSION_ID env).
 */
import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { gradeSubmission } from "@/lib/pipeline/grade-submission";
import { getAdminClient } from "@/lib/supabase/admin";
import { fakeAi, fakeOcr } from "../fixtures/fake-providers";

it("grades the submission with fake providers", async () => {
  const id = process.env.SUBMISSION_ID;
  expect(id).toBeTruthy();
  const res = await gradeSubmission({ db: getAdminClient(), ocr: fakeOcr, ai: fakeAi([]) }, id!, (_n, fn) => fn());
  expect(res).toMatchObject({ items: 2 });
});
