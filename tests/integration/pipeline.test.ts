/**
 * Pipeline integration test (§8.1) against a local Supabase stack: real
 * storage, DB, normalisation, redaction and persistence. The OCR and LLM
 * providers are TEST FAKES injected at the provider boundary — production
 * code never uses them (master prompt §0.2).
 *
 * Needs: `supabase start`, NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SECRET_KEY.
 */
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

import { fakeAi, fakeOcr, makePage, type Seen } from "../fixtures/fake-providers";
import { gradeSubmission, type PipelineDeps } from "@/lib/pipeline/grade-submission";
import { BUCKETS, getAdminClient } from "@/lib/supabase/admin";

const db = getAdminClient();
let teacherId = "";
let assignmentId = "";
let classId = "";
const created: { users: string[] } = { users: [] };

async function newSubmission(studentId: string | null) {
  const { data: sub } = await db
    .from("submissions")
    .insert({ assignment_id: assignmentId, student_id: studentId, status: "queued", processing_stage: "queued" })
    .select()
    .single();
  const path = `${teacherId}/${assignmentId}/${sub!.id}/p1.jpg`;
  const img = await makePage(["Nombre: Ana Pérez", "1) 3/4", "2) x = 7"]);
  await db.storage.from(BUCKETS.original).upload(path, img, { contentType: "image/jpeg", upsert: true });
  await db.from("pages").insert({ submission_id: sub!.id, position: 1, storage_path: path });
  return sub!.id;
}

const direct = <T>(_: string, fn: () => Promise<T>) => fn();

beforeAll(async () => {
  const { data: u, error } = await db.auth.admin.createUser({
    email: `pipe-${Date.now()}@tinta.test`,
    email_confirm: true,
  });
  if (error) throw error;
  teacherId = u.user.id;
  created.users.push(teacherId);
  const { data: cls } = await db
    .from("classes")
    .insert({ teacher_id: teacherId, name: "6A", locale: "es" })
    .select()
    .single();
  classId = cls!.id;
  await db.from("students").insert([
    { class_id: cls!.id, display_name: "Ana Pérez" },
    { class_id: cls!.id, display_name: "Luis Mamani" },
  ]);
  const { data: a } = await db
    .from("assignments")
    .insert({
      class_id: cls!.id,
      title: "Fracciones y ecuaciones",
      subject: "Matemáticas",
      grade_level: "6",
      scale: { type: "numeric", preset: "bo_100", min: 1, max: 100, pass_mark: 51, decimals: 0 },
      feedback_settings: {},
      status: "grading",
    })
    .select()
    .single();
  assignmentId = a!.id;
  await db.from("questions").insert([
    {
      assignment_id: assignmentId,
      position: 1,
      label: "1",
      type: "numeric",
      max_points: 2,
      correct_answers: ["3/4"],
      teacher_confirmed: true,
    },
    {
      assignment_id: assignmentId,
      position: 2,
      label: "2",
      type: "math_steps",
      max_points: 3,
      correct_answers: ["x = 3"],
      teacher_confirmed: true,
    },
  ]);
});

afterAll(async () => {
  if (process.env.KEEP_TEST_DATA) return;
  for (const id of created.users) await db.auth.admin.deleteUser(id); // cascades teacher → classes → …
});

describe("grading pipeline (local Supabase, fake providers)", () => {
  it("runs steps 1–9: normalise, OCR, redact, transcribe, grade, verify, confidence, persist", async () => {
    const seen: Seen[] = [];
    const subId = await newSubmission(null);
    const deps: PipelineDeps = { db, ocr: fakeOcr, ai: fakeAi(seen) };
    const result = await gradeSubmission(deps, subId, direct);
    expect(result).toMatchObject({ items: 2, pins: 2 });

    // Privacy: the name line was redacted and never reached a grading model
    const { data: lines } = await db
      .from("ocr_lines")
      .select("line_key, redacted")
      .eq("submission_id", subId)
      .order("line_key");
    expect(lines).toEqual([
      { line_key: "p1-l1", redacted: true },
      { line_key: "p1-l2", redacted: false },
      { line_key: "p1-l3", redacted: false },
    ]);
    for (const s of seen.filter((x) => x.role !== "name_read")) {
      expect(s.text).not.toContain("Ana");
      expect(s.text).not.toContain("p1-l1");
      expect(s.images).toBe(1);
    }
    // Name matched from the OCR'd name field, in code — no model call needed
    expect(seen.map((s) => s.role)).toEqual(["transcribe", "grade", "verify"]);
    const { data: sub } = await db.from("submissions").select("*").eq("id", subId).single();
    const { data: ana } = await db
      .from("students")
      .select("id")
      .eq("class_id", classId)
      .eq("display_name", "Ana Pérez")
      .single();
    expect(sub).toMatchObject({
      status: "ready",
      processing_stage: "ready",
      suggested_student_id: ana!.id,
      match_method: "name_ocr",
      total_score: 2,
      total_max: 5,
    });
    expect(sub!.student_id).toBeNull(); // suggestion only — the teacher confirms

    // Redacted copy exists and differs from the original in the header only
    const { data: page } = await db.from("pages").select("*").eq("submission_id", subId).single();
    expect(page!.redacted_storage_path).toBeTruthy();
    expect(page!.width).toBe(1600);
    const orig = Buffer.from(
      await (await db.storage.from(BUCKETS.original).download(page!.storage_path)).data!.arrayBuffer(),
    );
    const red = Buffer.from(
      await (await db.storage.from(BUCKETS.redacted).download(page!.redacted_storage_path!)).data!.arrayBuffer(),
    );
    const stats = async (b: Buffer, top: number) =>
      (await sharp(await sharp(b).extract({ left: 100, top, width: 900, height: 80 }).greyscale().toBuffer()).stats())
        .channels[0].stdev;
    expect(await stats(red, 60)).toBeLessThan(2); // header redacted to a flat fill
    expect(await stats(orig, 60)).toBeGreaterThan(20); // …where the original had the name
    expect(Math.abs((await stats(red, 1500)) - (await stats(orig, 1500)))).toBeLessThan(1); // body intact

    // Scores, confidence, deductions
    const { data: scores } = await db.from("criterion_scores").select("*").eq("submission_id", subId).order("item_key");
    expect(scores!.map((s) => [s.item_key, s.ai_score, s.verifier_score, s.disagreement, s.confidence_band])).toEqual([
      ["q1", 2, 2, false, "high"],
      ["q2", 0, 1, true, "low"], // 0 points + disagreement → low; harsh errors never auto-green
    ]);
    expect(sub!.confidence).toBe("low");

    // Pins anchored to OCR boxes, numbered in reading order
    const { data: pins } = await db
      .from("annotations")
      .select("kind, position, approximate, region, item_key")
      .eq("submission_id", subId)
      .order("position");
    expect(pins!.map((p) => [p.position, p.kind, p.approximate])).toEqual([
      [1, "correct", false],
      [2, "error", false],
    ]);
    expect((pins![0].region as { y: number }).y).toBeCloseTo(0.11);

    const { data: fb } = await db.from("feedback").select("*").eq("submission_id", subId).single();
    expect(fb!.locale).toBe("es");
    const { data: runs } = await db.from("grading_runs").select("kind").eq("submission_id", subId);
    expect(runs).toEqual([]); // fake AI does not record; real client records every call (unit-tested separately)
  });

  it("a model refusal puts the submission in needs_attention — never a fabricated grade", async () => {
    const subId = await newSubmission(null);
    const res = await gradeSubmission({ db, ocr: fakeOcr, ai: fakeAi([], { refuseGrade: true }) }, subId, direct);
    expect(res).toEqual({ failed: true });
    const { data: sub } = await db
      .from("submissions")
      .select("status, error_code, processing_stage")
      .eq("id", subId)
      .single();
    expect(sub).toEqual({ status: "needs_attention", error_code: "ai_refused", processing_stage: "failed" });
    const { count } = await db
      .from("criterion_scores")
      .select("*", { count: "exact", head: true })
      .eq("submission_id", subId);
    expect(count).toBe(0);
  });

  it("a blurry photo is sent back for a retake before any AI call", async () => {
    const { data: sub } = await db
      .from("submissions")
      .insert({ assignment_id: assignmentId, status: "queued" })
      .select()
      .single();
    const path = `${teacherId}/${assignmentId}/${sub!.id}/p1.jpg`;
    const blurry = await sharp(await makePage(["1) 3/4"]))
      .blur(25)
      .jpeg()
      .toBuffer();
    await db.storage.from(BUCKETS.original).upload(path, blurry, { contentType: "image/jpeg", upsert: true });
    await db.from("pages").insert({ submission_id: sub!.id, position: 1, storage_path: path });
    const seen: Seen[] = [];
    expect(await gradeSubmission({ db, ocr: fakeOcr, ai: fakeAi(seen) }, sub!.id, direct)).toEqual({ failed: true });
    const { data: after } = await db.from("submissions").select("status, error_code").eq("id", sub!.id).single();
    expect(after).toEqual({ status: "needs_attention", error_code: "retake" });
    expect(seen).toEqual([]);
  });
});
