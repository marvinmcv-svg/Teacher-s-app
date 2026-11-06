/**
 * Grade → approve → zip of red-pen marked images, on a local Supabase stack.
 * OCR/LLM are the TEST-ONLY fakes (master prompt §0.2); storage, DB, rendering are real.
 */
import { unzipSync } from "fflate";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

import { fakeAi, fakeOcr, makePage } from "../fixtures/fake-providers";
import { buildMarkedZip } from "@/lib/marking/zip";
import { gradeSubmission } from "@/lib/pipeline/grade-submission";
import { BUCKETS, getAdminClient } from "@/lib/supabase/admin";

const db = getAdminClient();
let teacherId = "";
let assignmentId = "";
const students: Record<string, string> = {};
const direct = <T>(_: string, fn: () => Promise<T>) => fn();

async function gradedPaper(studentId: string | null) {
  const { data: sub } = await db
    .from("submissions")
    .insert({ assignment_id: assignmentId, student_id: studentId, status: "queued" })
    .select()
    .single();
  const path = `${teacherId}/${assignmentId}/${sub!.id}/p1.jpg`;
  await db.storage.from(BUCKETS.original).upload(path, await makePage(["Nombre: Ana Pérez", "1) 3/4", "2) x = 7"]), {
    contentType: "image/jpeg",
    upsert: true,
  });
  await db.from("pages").insert({ submission_id: sub!.id, position: 1, storage_path: path });
  await gradeSubmission({ db, ocr: fakeOcr, ai: fakeAi([]) }, sub!.id, direct);
  await db.from("submissions").update({ status: "approved" }).eq("id", sub!.id);
  return sub!.id;
}

beforeAll(async () => {
  const { data: u, error } = await db.auth.admin.createUser({
    email: `zip-${Date.now()}@tinta.test`,
    email_confirm: true,
  });
  if (error) throw error;
  teacherId = u.user.id;
  const { data: cls } = await db.from("classes").insert({ teacher_id: teacherId, name: "6A" }).select().single();
  const { data: st } = await db
    .from("students")
    .insert(["Zoe Álvarez", "Luis Mamani Quispe"].map((display_name) => ({ class_id: cls!.id, display_name })))
    .select("id, display_name");
  for (const s of st!) students[s.display_name] = s.id;
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

describe("marked papers zip", () => {
  it("one red-pen JPEG per paper, named last-name first, in alphabetical order", async () => {
    const ids = [
      await gradedPaper(students["Luis Mamani Quispe"]),
      await gradedPaper(students["Zoe Álvarez"]),
      await gradedPaper(null),
    ];
    const { zip, names } = await buildMarkedZip(ids, "Sin nombre");
    expect(names).toEqual(["Álvarez, Zoe.jpg", "Mamani Quispe, Luis.jpg", "Sin nombre 1.jpg"]);
    const files = unzipSync(zip);
    expect(Object.keys(files).sort()).toEqual([...names].sort());

    // Red ink was added: the marked image has clearly more red than the original page.
    const redShare = async (buf: Buffer) => {
      const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
      let red = 0;
      for (let i = 0; i < data.length; i += info.channels)
        if (data[i] > 150 && data[i + 1] < 90 && data[i + 2] < 100) red++;
      return red / (info.width * info.height);
    };
    const marked = Buffer.from(files["Álvarez, Zoe.jpg"]);
    expect(await redShare(marked)).toBeGreaterThan(0.002);
    expect(await redShare(await makePage(["1) 3/4"]))).toBe(0);
    expect((await sharp(marked).metadata()).format).toBe("jpeg");
  });

  it("unapproved or failed papers aren't loaded", async () => {
    const { data: sub } = await db
      .from("submissions")
      .insert({ assignment_id: assignmentId, status: "needs_attention" })
      .select()
      .single();
    const { names } = await buildMarkedZip([sub!.id], "Sin nombre");
    expect(names).toEqual([]);
  });
});
