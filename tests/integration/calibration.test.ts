/**
 * Calibration exemplars reach the grade prompt (§8.5), scrubbed of student names,
 * and never include the paper being graded. Local Supabase; TEST-ONLY fake providers.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

import { fakeAi, fakeOcr, makePage, type Seen } from "../fixtures/fake-providers";
import { gradeSubmission } from "@/lib/pipeline/grade-submission";
import { BUCKETS, getAdminClient } from "@/lib/supabase/admin";

const db = getAdminClient();
let teacherId = "";
let assignmentId = "";
const direct = <T>(_: string, fn: () => Promise<T>) => fn();

async function newSubmission() {
  const { data: sub } = await db
    .from("submissions")
    .insert({ assignment_id: assignmentId, status: "queued" })
    .select()
    .single();
  const path = `${teacherId}/${assignmentId}/${sub!.id}/p1.jpg`;
  await db.storage.from(BUCKETS.original).upload(path, await makePage(["Nombre: Ana Pérez", "1) 3/4", "2) x = 7"]), {
    contentType: "image/jpeg",
    upsert: true,
  });
  await db.from("pages").insert({ submission_id: sub!.id, position: 1, storage_path: path });
  return sub!.id;
}

beforeAll(async () => {
  const { data: u, error } = await db.auth.admin.createUser({
    email: `cal-${Date.now()}@tinta.test`,
    email_confirm: true,
  });
  if (error) throw error;
  teacherId = u.user.id;
  const { data: cls } = await db.from("classes").insert({ teacher_id: teacherId, name: "6C" }).select().single();
  await db.from("students").insert([{ class_id: cls!.id, display_name: "Ana Pérez" }]);
  const { data: a } = await db
    .from("assignments")
    .insert({
      class_id: cls!.id,
      title: "Fracciones",
      scale: { type: "numeric", preset: "bo_100", min: 1, max: 100, pass_mark: 51, decimals: 0 },
      status: "grading",
    })
    .select()
    .single();
  assignmentId = a!.id;
  await db.from("questions").insert([
    { assignment_id: assignmentId, position: 1, label: "1", type: "numeric", max_points: 2, correct_answers: ["3/4"] },
    {
      assignment_id: assignmentId,
      position: 2,
      label: "2",
      type: "math_steps",
      max_points: 3,
      correct_answers: ["x = 3"],
    },
  ]);
});

afterAll(async () => {
  if (!process.env.KEEP_TEST_DATA) await db.auth.admin.deleteUser(teacherId);
});

describe("calibration exemplars", () => {
  it("the teacher's graded example is in the grade prompt, without the student's name", async () => {
    const first = await newSubmission();
    await gradeSubmission({ db, ocr: fakeOcr, ai: fakeAi([]) }, first, direct);
    await db.from("submissions").update({ status: "approved" }).eq("id", first);
    await db.from("exemplars").insert({
      assignment_id: assignmentId,
      submission_id: first,
      teacher_scores: [
        { item_key: "q1", score: 2, max: 2, level_label: null, rationale: "Bien, Ana." },
        { item_key: "q2", score: 1, max: 3, level_label: null, rationale: "Método correcto, signo mal." },
      ],
      teacher_feedback: { glows: ["Ana simplificó bien."], grows: [], next_step: "Revisa signos." },
    });

    // The exemplar is never used when regrading that same paper
    const seenSelf: Seen[] = [];
    await gradeSubmission({ db, ocr: fakeOcr, ai: fakeAi(seenSelf) }, first, direct);
    expect(seenSelf.find((s) => s.role === "grade")!.system).not.toContain("Exemplar 1");

    const seen: Seen[] = [];
    await gradeSubmission({ db, ocr: fakeOcr, ai: fakeAi(seen) }, await newSubmission(), direct);
    const system = seen.find((s) => s.role === "grade")!.system;
    expect(system).toContain("Exemplar 1");
    expect(system).toContain("q2: 1/3 — Método correcto, signo mal.");
    expect(system).toContain("[student] simplificó bien.");
    expect(system).not.toMatch(/Ana|Pérez/);
  });
});
