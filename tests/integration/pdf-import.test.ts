/**
 * Scanner PDF split + QR matching (§3.2) against a local Supabase stack:
 * real storage, DB, rasterising (pdf.js), QR reading and redaction. OCR/LLM
 * are the TEST-ONLY fakes (master prompt §0.2).
 */
import { PDFDocument } from "pdf-lib";
import QRCode from "qrcode";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

import { fakeAi, fakeOcr, makePage, type Seen } from "../fixtures/fake-providers";
import { gradeSubmission } from "@/lib/pipeline/grade-submission";
import { splitPdfImport } from "@/lib/pipeline/pdf-import";
import { encodeQr } from "@/lib/qr/payload";
import { BUCKETS, getAdminClient } from "@/lib/supabase/admin";

const db = getAdminClient();
let teacherId = "";
let assignmentId = "";
const tokens: Record<string, string> = {};
const studentIds: Record<string, string> = {};
const direct = <T>(_: string, fn: () => Promise<T>) => fn();

async function qrPng(kind: "cover" | "sticker", token: string) {
  return QRCode.toBuffer(encodeQr(kind, token), { margin: 2, width: 400, errorCorrectionLevel: "Q" });
}

beforeAll(async () => {
  const { data: u, error } = await db.auth.admin.createUser({
    email: `pdf-${Date.now()}@tinta.test`,
    email_confirm: true,
  });
  if (error) throw error;
  teacherId = u.user.id;
  const { data: cls } = await db.from("classes").insert({ teacher_id: teacherId, name: "6B" }).select().single();
  const { data: st } = await db
    .from("students")
    .insert(["Ana Pérez", "Luis Mamani", "Eva Quispe"].map((display_name) => ({ class_id: cls!.id, display_name })))
    .select("id, display_name, qr_code_token");
  for (const s of st!) {
    tokens[s.display_name] = s.qr_code_token;
    studentIds[s.display_name] = s.id;
  }
  const { data: a } = await db
    .from("assignments")
    .insert({
      class_id: cls!.id,
      title: "Fracciones",
      scale: { type: "numeric", preset: "bo_100", min: 1, max: 100, pass_mark: 51, decimals: 0 },
      status: "collecting",
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

describe("scanner PDF import", () => {
  it("splits by cover sheet and sticker, drops covers, matches by QR, removes the PDF", async () => {
    const pdf = await PDFDocument.create();
    const W = 595;
    const H = 842;
    const work = await makePage(["1) 3/4", "2) x = 7"]);
    // p1: Ana's cover · p2–p3: Ana's work · p4: Luis's work with a sticker
    const cover = pdf.addPage([W, H]);
    cover.drawImage(await pdf.embedPng(await qrPng("cover", tokens["Ana Pérez"])), {
      x: W - 200,
      y: H - 200,
      width: 160,
      height: 160,
    });
    for (let i = 0; i < 2; i++) {
      const p = pdf.addPage([W, H]);
      p.drawImage(await pdf.embedJpg(work), { x: 0, y: 0, width: W, height: H });
    }
    const luis = pdf.addPage([W, H]);
    luis.drawImage(await pdf.embedJpg(work), { x: 0, y: 0, width: W, height: H });
    luis.drawImage(await pdf.embedPng(await qrPng("sticker", tokens["Luis Mamani"])), {
      x: W - 140,
      y: H - 120,
      width: 90,
      height: 90,
    });
    const path = `${teacherId}/${assignmentId}/imports/test.pdf`;
    await db.storage
      .from(BUCKETS.original)
      .upload(path, Buffer.from(await pdf.save()), { contentType: "application/pdf", upsert: true });
    const { data: imp } = await db
      .from("pdf_imports")
      .insert({ assignment_id: assignmentId, teacher_id: teacherId, storage_path: path, pages_per_student: 1 })
      .select()
      .single();

    const ids = await splitPdfImport(db, imp!.id);
    expect(ids).toHaveLength(2);
    const { data: subs } = await db
      .from("submissions")
      .select("id, student_id, match_method, status, pages(position, width)")
      .in("id", ids);
    const byStudent = new Map(subs!.map((s) => [s.student_id, s]));
    expect(byStudent.get(studentIds["Ana Pérez"])).toMatchObject({ match_method: "qr", status: "queued" });
    expect(byStudent.get(studentIds["Ana Pérez"])!.pages).toHaveLength(2); // cover dropped
    expect(byStudent.get(studentIds["Luis Mamani"])!.pages).toHaveLength(1);

    const { data: after } = await db.from("pdf_imports").select("*").eq("id", imp!.id).single();
    expect(after).toMatchObject({ status: "done", page_count: 4, submissions_created: 2, matched_by_qr: 2 });
    const { data: gone } = await db.storage.from(BUCKETS.original).download(path);
    expect(gone).toBeNull();
    const { data: asg } = await db.from("assignments").select("status").eq("id", assignmentId).single();
    expect(asg!.status).toBe("grading");

    // Re-running is idempotent (Inngest retries): same submissions, no duplicates.
    await db.storage
      .from(BUCKETS.original)
      .upload(path, Buffer.from(await pdf.save()), { contentType: "application/pdf", upsert: true });
    expect((await splitPdfImport(db, imp!.id)).sort()).toEqual([...ids].sort());
  });

  it("an unreadable PDF fails with a teacher-facing code", async () => {
    const path = `${teacherId}/${assignmentId}/imports/bad.pdf`;
    await db.storage
      .from(BUCKETS.original)
      .upload(path, Buffer.from("not a pdf"), { contentType: "application/pdf", upsert: true });
    const { data: imp } = await db
      .from("pdf_imports")
      .insert({ assignment_id: assignmentId, teacher_id: teacherId, storage_path: path })
      .select()
      .single();
    expect(await splitPdfImport(db, imp!.id)).toEqual([]);
    const { data: after } = await db.from("pdf_imports").select("status, error_code").eq("id", imp!.id).single();
    expect(after).toEqual({ status: "failed", error_code: "unreadable" });
  });
});

describe("pipeline QR matching", () => {
  it("assigns the student from a name sticker and redacts the sticker before any model call", async () => {
    const { data: sub } = await db
      .from("submissions")
      .insert({ assignment_id: assignmentId, status: "queued" })
      .select()
      .single();
    const qr = await sharp(await qrPng("sticker", tokens["Eva Quispe"]))
      .resize(220)
      .toBuffer();
    const img = await sharp(await makePage(["", "1) 3/4", "2) x = 7"]))
      .composite([{ input: qr, left: 1300, top: 1900 }])
      .jpeg()
      .toBuffer();
    const path = `${teacherId}/${assignmentId}/${sub!.id}/p1.jpg`;
    await db.storage.from(BUCKETS.original).upload(path, img, { contentType: "image/jpeg", upsert: true });
    await db.from("pages").insert({ submission_id: sub!.id, position: 1, storage_path: path });

    const seen: Seen[] = [];
    await gradeSubmission({ db, ocr: fakeOcr, ai: fakeAi(seen) }, sub!.id, direct);
    const { data: after } = await db
      .from("submissions")
      .select("student_id, match_method, suggested_student_id, status")
      .eq("id", sub!.id)
      .single();
    expect(after).toMatchObject({ student_id: studentIds["Eva Quispe"], match_method: "qr", status: "ready" });
    expect(seen.map((s) => s.role)).not.toContain("name_read");

    // The sticker area is a flat fill in the copy models see
    const { data: page } = await db
      .from("pages")
      .select("redacted_storage_path, width, height")
      .eq("submission_id", sub!.id)
      .single();
    const red = Buffer.from(
      await (await db.storage.from(BUCKETS.redacted).download(page!.redacted_storage_path!)).data!.arrayBuffer(),
    );
    const k = page!.width! / 1600;
    // stats() reads its *input*, so extract into a buffer first
    const crop = await sharp(red)
      .extract({
        left: Math.round(1320 * k),
        top: Math.round(1920 * k),
        width: Math.round(180 * k),
        height: Math.round(180 * k),
      })
      .greyscale()
      .toBuffer();
    const area = await sharp(crop).stats();
    expect(area.channels[0].stdev).toBeLessThan(2);
  });
});
