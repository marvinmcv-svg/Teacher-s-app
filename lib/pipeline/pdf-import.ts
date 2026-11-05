import "server-only";
import { decodePageQr } from "@/lib/qr/decode-image";
import { splitByQr, type PageQr } from "@/lib/qr/payload";
import { normalisePage } from "@/lib/image/process";
import { PdfError, rasterisePdf } from "@/lib/pdf/rasterise";
import { BUCKETS, type AdminClient } from "@/lib/supabase/admin";

const MAX_PAGES_PER_SUBMISSION = 20;

/**
 * Split a scanner PDF into submissions (§3.2): rasterise → read QR on every
 * page → group by cover sheet / sticker, else by the teacher's pages-per-student
 * → one submission per group with its pages uploaded. Idempotent: submissions
 * are keyed by `pdf:<import>:<group>` so a retry re-uses them.
 * Returns the ids of submissions ready to grade.
 */
export async function splitPdfImport(db: AdminClient, importId: string): Promise<string[]> {
  const { data: imp } = await db.from("pdf_imports").select("*").eq("id", importId).maybeSingle();
  if (!imp) throw new Error("import not found");
  await db.from("pdf_imports").update({ status: "splitting", error_code: null }).eq("id", imp.id);
  const { data: asg } = await db
    .from("assignments")
    .select("id, class_id, status")
    .eq("id", imp.assignment_id)
    .single();
  if (!asg) throw new Error("assignment not found");
  const { data: roster } = await db
    .from("students")
    .select("id, qr_code_token")
    .eq("class_id", asg.class_id)
    .eq("active", true);
  const byToken = new Map((roster ?? []).map((s) => [s.qr_code_token, s.id]));

  const { data: file, error: dlErr } = await db.storage.from(BUCKETS.original).download(imp.storage_path);
  if (dlErr || !file) return fail(db, imp.id, "missing_file");

  // 1. Rasterise + read codes, keeping normalised JPEGs in memory (bounded by MAX_PDF_PAGES).
  const pages: { jpeg: Buffer; sha256: string; width: number; height: number }[] = [];
  const qrs: PageQr[] = [];
  try {
    for await (const p of rasterisePdf(new Uint8Array(await file.arrayBuffer()))) {
      const norm = await normalisePage(p.jpeg);
      pages.push({ jpeg: norm.buffer, sha256: norm.sha256, width: norm.width, height: norm.height });
      const qr = await decodePageQr(norm.buffer);
      // Only codes for this class count; a stray code from another class is ignored.
      qrs.push(qr && byToken.has(qr.token) ? { kind: qr.kind, token: qr.token } : null);
    }
  } catch (err) {
    if (err instanceof PdfError) return fail(db, imp.id, err.code);
    throw err;
  }
  if (!pages.length) return fail(db, imp.id, "empty");

  // 2. Group, then cap each group at the per-submission page limit.
  const groups = splitByQr(qrs, imp.pages_per_student).flatMap((g) => {
    const out = [];
    for (let i = 0; i < g.pages.length; i += MAX_PAGES_PER_SUBMISSION)
      out.push({ token: i === 0 ? g.token : null, pages: g.pages.slice(i, i + MAX_PAGES_PER_SUBMISSION) });
    return out;
  });

  const { data: existing } = await db
    .from("submissions")
    .select("id, student_id, client_ref")
    .eq("assignment_id", asg.id);
  const usedStudents = new Set(
    (existing ?? []).filter((s) => !s.client_ref?.startsWith(`pdf:${imp.id}:`)).map((s) => s.student_id),
  );

  const ready: string[] = [];
  let matched = 0;
  for (const [gi, g] of groups.entries()) {
    const clientRef = `pdf:${imp.id}:${gi}`;
    let studentId = g.token ? (byToken.get(g.token) ?? null) : null;
    if (studentId && usedStudents.has(studentId)) studentId = null; // already has work: leave for the teacher
    if (studentId) usedStudents.add(studentId);
    let sub = (existing ?? []).find((s) => s.client_ref === clientRef);
    if (!sub) {
      const ins = await db
        .from("submissions")
        .insert({
          assignment_id: asg.id,
          student_id: studentId,
          client_ref: clientRef,
          status: "uploading",
          match_method: studentId ? "qr" : null,
        })
        .select("id, student_id, client_ref")
        .single();
      if (ins.error) throw new Error(`submission insert: ${ins.error.code}`);
      sub = ins.data;
    }
    if (sub.student_id) matched++;
    const rows = [];
    for (const [pi, pageIdx] of g.pages.entries()) {
      const pg = pages[pageIdx];
      const path = `${imp.teacher_id}/${asg.id}/${sub.id}/original-p${pi + 1}.jpg`;
      const { error } = await db.storage
        .from(BUCKETS.original)
        .upload(path, pg.jpeg, { contentType: "image/jpeg", upsert: true });
      if (error) throw new Error(`page upload: ${error.message}`);
      rows.push({
        submission_id: sub.id,
        position: pi + 1,
        storage_path: path,
        width: pg.width,
        height: pg.height,
        sha256: pg.sha256,
      });
    }
    await db.from("pages").delete().eq("submission_id", sub.id);
    const { error: pErr } = await db.from("pages").insert(rows);
    if (pErr) throw new Error(`pages insert: ${pErr.message}`);
    await db
      .from("submissions")
      .update({ status: "queued", processing_stage: "queued", error_code: null })
      .eq("id", sub.id);
    ready.push(sub.id);
  }

  if (asg.status === "draft" || asg.status === "collecting")
    await db.from("assignments").update({ status: "grading" }).eq("id", asg.id);
  await db
    .from("pdf_imports")
    .update({
      status: "done",
      page_count: pages.length,
      submissions_created: ready.length,
      matched_by_qr: matched,
    })
    .eq("id", imp.id);
  // The PDF itself isn't needed once split (pages are stored individually).
  await db.storage.from(BUCKETS.original).remove([imp.storage_path]);
  return ready;
}

async function fail(db: AdminClient, id: string, code: string): Promise<string[]> {
  await db.from("pdf_imports").update({ status: "failed", error_code: code }).eq("id", id);
  return [];
}
