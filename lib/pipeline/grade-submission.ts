import "server-only";
import type { CallRecord, ImageInput, StructuredCall } from "@/lib/ai/client";
import { AiOutputError, AiRefusalError, MissingConfigError } from "@/lib/ai/errors";
import { renderAssignmentContext, type OcrLineForPrompt } from "@/lib/ai/prompts/context";
import { renderExemplars, type ExemplarForPrompt } from "@/lib/ai/prompts/exemplars";
import { GRADE_PROMPT_VERSION, gradeSystem, gradeUserText } from "@/lib/ai/prompts/grade";
import { NAME_READ_PROMPT_VERSION, NAME_READ_SYSTEM } from "@/lib/ai/prompts/misc";
import { TRANSCRIBE_PROMPT_VERSION, TRANSCRIBE_SYSTEM, transcribeUserText } from "@/lib/ai/prompts/transcribe";
import { VERIFY_PROMPT_VERSION, VERIFY_SYSTEM, verifyUserText } from "@/lib/ai/prompts/verify";
import {
  GradeSchema,
  NameReadSchema,
  TranscriptionSchema,
  VerificationSchema,
  type Grade,
  type Transcription,
  type Verification,
} from "@/lib/ai/schemas";
import { formatIssues, itemKeyOf, validateGrade, validateTranscription, validateVerification } from "@/lib/ai/validate";
import { bandThresholds } from "@/lib/ai/config";
import { pickForBlindCheck } from "@/lib/grading/agreement";
import { itemConfidence, submissionBand, toBand, type Band } from "@/lib/grading/confidence";
import { findNameLines, matchRoster } from "@/lib/grading/names";
import { decodePageQr } from "@/lib/qr/decode-image";
import { stickerRedactionBox } from "@/lib/qr/payload";
import { passThresholdPct } from "@/lib/grading/scales";
import { cropRegion, measureQuality, normalisePage, redactRegions, toModelImage } from "@/lib/image/process";
import { assess } from "@/lib/image/quality";
import { lineKey } from "@/lib/ocr/vision-lines";
import { unionBox, type BBox, type OcrProvider } from "@/lib/ocr/types";
import { BUCKETS, type AdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/db/types";
import { renderStyleProfile } from "@/lib/style/profile";
import { buildAssignmentContext, levelStep } from "./context";
import { loadStyleProfile } from "./style-profile";

/**
 * submission.grade (§8.1). Each exported step is idempotent and safe to retry
 * (Inngest memoises finished steps). FROM THE REDACT STEP ON, ONLY REDACTED
 * IMAGES AND NON-REDACTED OCR LINES ARE SENT TO ANY LLM.
 */
export type AiCaller = <T>(call: StructuredCall<T>) => Promise<T>;
export type PipelineDeps = { db: AdminClient; ocr: OcrProvider; ai: AiCaller };
export type StepRunner = <T>(name: string, fn: () => Promise<T>) => Promise<T>;

const HEADER_BAND: BBox = { x: 0, y: 0, w: 1, h: 0.12 };
const FALLBACK_REDACT: BBox = { x: 0, y: 0, w: 1, h: 0.08 };

export class PipelineStop extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "PipelineStop";
  }
}

async function must<T>(
  p: PromiseLike<{ data: T; error: { message: string; code?: string } | null }>,
  what: string,
): Promise<NonNullable<T>> {
  const { data, error } = await p;
  if (error) throw new Error(`${what}: ${error.code ?? ""} ${error.message}`);
  if (data === null) throw new Error(`${what}: not found`);
  return data as NonNullable<T>;
}

/** Cast a plain value to the generated Json type (non-null) for jsonb columns. */
const asJson = (v: unknown) => v as NonNullable<Json>;

async function download(db: AdminClient, bucket: string, path: string): Promise<Buffer> {
  const { data, error } = await db.storage.from(bucket).download(path);
  if (error || !data) throw new Error(`storage download failed (${bucket})`);
  return Buffer.from(await data.arrayBuffer());
}

async function upload(db: AdminClient, bucket: string, path: string, body: Buffer) {
  const { error } = await db.storage.from(bucket).upload(path, body, { contentType: "image/jpeg", upsert: true });
  if (error) throw new Error(`storage upload failed (${bucket}): ${error.message}`);
}

async function setStage(db: AdminClient, submissionId: string, stage: string, extra: Record<string, unknown> = {}) {
  await db
    .from("submissions")
    .update({ processing_stage: stage, ...extra })
    .eq("id", submissionId);
}

function recorder(db: AdminClient, submissionId: string, assignmentId: string) {
  const kindByRole = {
    name_read: "name_read",
    transcribe: "transcribe",
    grade: "grade",
    verify: "verify",
    key_extract: "key_extract",
    regenerate: "regenerate",
  } as const;
  return async (r: CallRecord) => {
    if (!(r.role in kindByRole)) return; // eval-only roles (judge) aren't pipeline runs
    // Never store student content in error fields; raw_output is the model's JSON (needed for audit/evals).
    await db.from("grading_runs").insert({
      submission_id: submissionId,
      assignment_id: assignmentId,
      kind: kindByRole[r.role as keyof typeof kindByRole],
      model: r.model,
      prompt_version: r.promptVersion,
      effort: r.effort,
      input_tokens: r.inputTokens,
      output_tokens: r.outputTokens,
      cache_read_tokens: r.cacheReadTokens,
      cost_usd: r.costUsd,
      latency_ms: r.latencyMs,
      raw_output: r.rawOutput === undefined ? null : asJson(r.rawOutput),
      status: r.status,
      error: r.error ?? null,
    });
  };
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------
export async function loadSubmission(db: AdminClient, submissionId: string) {
  const submission = await must(
    db.from("submissions").select("*").eq("id", submissionId).maybeSingle(),
    "load submission",
  );
  const assignment = await must(
    db.from("assignments").select("*").eq("id", submission.assignment_id).maybeSingle(),
    "load assignment",
  );
  const cls = await must(
    db.from("classes").select("id, teacher_id, locale").eq("id", assignment.class_id).maybeSingle(),
    "load class",
  );
  const questions = await must(
    db.from("questions").select("*").eq("assignment_id", assignment.id).order("position"),
    "load questions",
  );
  const pages = await must(
    db.from("pages").select("*").eq("submission_id", submissionId).order("position"),
    "load pages",
  );
  const roster = await must(
    db
      .from("students")
      .select("id, display_name, feedback_locale, qr_code_token")
      .eq("class_id", cls.id)
      .eq("active", true),
    "load roster",
  );
  const teacher = await must(
    db.from("teachers").select("id, blind_check_pct").eq("id", cls.teacher_id).maybeSingle(),
    "load teacher",
  );
  const loaded = buildAssignmentContext(assignment, questions);
  return {
    submission,
    assignment,
    cls,
    teacher,
    questions,
    pages,
    roster,
    loaded,
    exemplars: await loadExemplars(db, assignment.id, submissionId, loaded.questionIdByKey),
    styleProfile: await loadStyleProfile(db, cls.teacher_id),
  };
}

/** Up to 3 teacher-graded exemplars for this assignment (never the submission being graded). */
async function loadExemplars(
  db: AdminClient,
  assignmentId: string,
  submissionId: string,
  questionIdByKey: Map<string, string>,
): Promise<ExemplarForPrompt[]> {
  const { data: rows } = await db
    .from("exemplars")
    .select("submission_id, teacher_scores, teacher_feedback, created_at")
    .eq("assignment_id", assignmentId)
    .neq("submission_id", submissionId)
    .order("created_at")
    .limit(3);
  if (!rows?.length) return [];
  const keyById = new Map([...questionIdByKey.entries()].map(([k, id]) => [id, k]));
  const { data: answers } = await db
    .from("answers")
    .select("submission_id, question_id, text, teacher_corrected_text, status")
    .in(
      "submission_id",
      rows.map((r) => r.submission_id),
    );
  return rows.map((r) => ({
    answers: (answers ?? [])
      .filter((a) => a.submission_id === r.submission_id && keyById.has(a.question_id))
      .map((a) => ({ key: keyById.get(a.question_id)!, text: a.teacher_corrected_text ?? a.text, status: a.status }))
      .sort((x, y) => Number(x.key.slice(1)) - Number(y.key.slice(1))),
    scores: (r.teacher_scores as ExemplarForPrompt["scores"]) ?? [],
    feedback: (r.teacher_feedback as ExemplarForPrompt["feedback"]) ?? null,
  }));
}
type Loaded = Awaited<ReturnType<typeof loadSubmission>>;

const redactedPath = (teacherId: string, assignmentId: string, submissionId: string, position: number) =>
  `${teacherId}/${assignmentId}/${submissionId}/p${position}.jpg`;

// ---------------------------------------------------------------------------
// Steps 1–2: normalise + quality
// ---------------------------------------------------------------------------
export async function stepNormalise(deps: PipelineDeps, L: Loaded) {
  const { db } = deps;
  if (!L.pages.length) throw new PipelineStop("no_pages");
  await setStage(db, L.submission.id, "reading", { status: "processing", error_code: null });
  const problems: { position: number; issues: string[] }[] = [];
  for (const page of L.pages) {
    const raw = await download(db, BUCKETS.original, page.storage_path);
    const norm = await normalisePage(raw);
    if (norm.sha256 !== page.sha256) await upload(db, BUCKETS.original, page.storage_path, norm.buffer); // strips EXIF/GPS
    const q = await measureQuality(norm.buffer);
    const issues = assess(q, Math.max(q.sourceWidth, q.sourceHeight));
    await db
      .from("pages")
      .update({ width: norm.width, height: norm.height, sha256: norm.sha256, quality: asJson({ ...q, issues }) })
      .eq("id", page.id);
    if (issues.length && !page.quality_override) problems.push({ position: page.position, issues });
  }
  if (problems.length) throw new PipelineStop("retake");
  return { pages: L.pages.length };
}

// ---------------------------------------------------------------------------
// Step 3: OCR on the ORIGINAL (normalised) page
// ---------------------------------------------------------------------------
export async function stepOcr(deps: PipelineDeps, L: Loaded) {
  const { db, ocr } = deps;
  const hints = L.cls.locale === "en" ? ["en", "es"] : ["es", "en"];
  await db.from("ocr_lines").delete().eq("submission_id", L.submission.id);
  let total = 0;
  for (const page of L.pages) {
    const img = await download(db, BUCKETS.original, page.storage_path);
    const result = await ocr.recognise(img, { languageHints: hints });
    if (result.lines.length) {
      const { error } = await db.from("ocr_lines").insert(
        result.lines.map((l) => ({
          page_id: page.id,
          submission_id: L.submission.id,
          line_key: lineKey(page.position, l.n),
          text: l.text,
          bbox: asJson(l.bbox),
          confidence: l.confidence,
          words: asJson(l.words),
        })),
      );
      if (error) throw new Error(`ocr_lines insert: ${error.message}`);
    }
    total += result.lines.length;
  }
  return { lines: total };
}

// ---------------------------------------------------------------------------
// Step 4: locate name → (optional) read cropped header → redact
// ---------------------------------------------------------------------------
export async function stepNameAndRedact(deps: PipelineDeps, L: Loaded) {
  const { db, ai } = deps;
  const lines = await must(
    db.from("ocr_lines").select("id, page_id, line_key, text, bbox").eq("submission_id", L.submission.id),
    "load ocr lines",
  );
  const allLines = lines.map((l) => ({ ...l, bbox: l.bbox as unknown as BBox }));
  const first = L.pages[0];
  const firstLines = allLines.filter((l) => l.page_id === first.id);
  const rosterNames = L.roster.map((s) => s.display_name);
  const hits = findNameLines(firstLines, rosterNames);

  // Regions to fill, per page. Page 1: each name line, extended to the right edge for "Nombre: ____" fields.
  const regionsByPage = new Map<string, BBox[]>(L.pages.map((p) => [p.id, [] as BBox[]]));
  const firstRegions = hits.map((h) =>
    h.reason === "label" ? { x: h.line.bbox.x, y: h.line.bbox.y, w: 1 - h.line.bbox.x, h: h.line.bbox.h } : h.line.bbox,
  );
  if (!firstRegions.length) firstRegions.push(FALLBACK_REDACT); // privacy-first default when no name field was found
  regionsByPage.get(first.id)!.push(...firstRegions);

  // QR (matching priority 1, §3.2). A sticker can be on any page; its printed name is redacted with it.
  const byToken = new Map(L.roster.map((s) => [s.qr_code_token, s]));
  let qrStudentId: string | null = null;
  for (const page of L.pages) {
    const original = await download(db, BUCKETS.original, page.storage_path);
    const qr = await decodePageQr(original);
    if (!qr) continue;
    if (qr.kind === "sticker" && qr.box) regionsByPage.get(page.id)!.push(stickerRedactionBox(qr.box));
    if (qr.kind === "cover") regionsByPage.get(page.id)!.push({ x: 0, y: 0, w: 1, h: 0.35 });
    qrStudentId ??= byToken.get(qr.token)?.id ?? null;
  }

  // Student matching (only when not already chosen manually).
  let suggestion: { id: string; confidence: number } | null = null;
  let assigned = false;
  if (!L.submission.student_id && qrStudentId) {
    // A QR is a deterministic token match, not a guess: assign it unless that student already has work here.
    const { data: taken } = await db
      .from("submissions")
      .select("id")
      .eq("assignment_id", L.assignment.id)
      .eq("student_id", qrStudentId)
      .neq("id", L.submission.id)
      .maybeSingle();
    if (!taken) {
      const { error } = await db
        .from("submissions")
        .update({ student_id: qrStudentId, match_method: "qr", suggested_student_id: null })
        .eq("id", L.submission.id);
      assigned = !error;
      if (assigned) L.submission.student_id = qrStudentId;
    }
    if (!assigned) suggestion = { id: qrStudentId, confidence: 1 };
  }
  if (!L.submission.student_id && !suggestion && L.roster.length) {
    const written = hits.map((h) => h.written).find((w) => w.length > 1);
    let match = written ? matchRoster(written, L.roster) : null;
    if (!match?.confident) {
      // Send ONLY the cropped header to the fast model (§8.1 step 4). The roster is never sent.
      const original = await download(db, BUCKETS.original, first.storage_path);
      const header = await cropRegion(original, HEADER_BAND);
      const read = await ai({
        role: "name_read",
        promptVersion: NAME_READ_PROMPT_VERSION,
        system: NAME_READ_SYSTEM,
        images: [{ mediaType: "image/jpeg", base64: header.toString("base64") }],
        text: "Read the student's name.",
        schema: NameReadSchema,
        onRecord: recorder(db, L.submission.id, L.assignment.id),
      }).catch((err) => {
        if (err instanceof AiRefusalError || err instanceof AiOutputError) return null; // matching is optional
        throw err;
      });
      if (read?.name_text) match = matchRoster(read.name_text, L.roster);
    }
    if (match?.best) suggestion = { id: match.best.student.id, confidence: Math.round(match.best.score * 100) / 100 };
  }

  // Mark redacted OCR lines (never sent to a model) and write the redacted copies.
  const redactedLineIds = allLines
    .filter((l) => (regionsByPage.get(l.page_id) ?? []).some((r) => intersects(r, l.bbox)))
    .map((l) => l.id);
  if (redactedLineIds.length) await db.from("ocr_lines").update({ redacted: true }).in("id", redactedLineIds);

  for (const page of L.pages) {
    const original = await download(db, BUCKETS.original, page.storage_path);
    const regions = regionsByPage.get(page.id) ?? [];
    const redacted = regions.length ? await redactRegions(original, regions) : original;
    const path = redactedPath(L.cls.teacher_id, L.assignment.id, L.submission.id, page.position);
    await upload(db, BUCKETS.redacted, path, redacted);
    await db.from("pages").update({ redacted_storage_path: path }).eq("id", page.id);
  }

  if (!assigned)
    await db
      .from("submissions")
      .update({
        suggested_student_id: suggestion?.id ?? null,
        name_match_confidence: suggestion?.confidence ?? null,
        match_method: L.submission.match_method ?? (suggestion ? "name_ocr" : null),
      })
      .eq("id", L.submission.id);
  const regionCount = [...regionsByPage.values()].reduce((n, r) => n + r.length, 0);
  return { regions: regionCount, redactedLines: redactedLineIds.length, suggested: !!suggestion, qr: assigned };
}

function intersects(a: BBox, b: BBox) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

// ---------------------------------------------------------------------------
// Shared: model inputs from REDACTED pages + non-redacted OCR lines
// ---------------------------------------------------------------------------
async function modelInputs(db: AdminClient, L: Loaded) {
  const pages = await must(
    db
      .from("pages")
      .select("id, position, redacted_storage_path")
      .eq("submission_id", L.submission.id)
      .order("position"),
    "pages",
  );
  const images: ImageInput[] = [];
  for (const p of pages) {
    if (!p.redacted_storage_path)
      throw new Error("redacted page missing — refusing to send an unredacted page to the model");
    const buf = await download(db, BUCKETS.redacted, p.redacted_storage_path);
    const m = await toModelImage(buf);
    images.push({ mediaType: m.mediaType, base64: m.base64, label: `Page ${p.position}:` });
  }
  const lines = await must(
    db
      .from("ocr_lines")
      .select("line_key, text, confidence, page_id, bbox")
      .eq("submission_id", L.submission.id)
      .eq("redacted", false),
    "lines",
  );
  const order = new Map(pages.map((p) => [p.id, p.position]));
  lines.sort((a, b) => order.get(a.page_id)! - order.get(b.page_id)! || lineNo(a.line_key) - lineNo(b.line_key));
  const promptLines: OcrLineForPrompt[] = lines.map((l) => ({
    line_key: l.line_key,
    text: l.text,
    confidence: l.confidence,
  }));
  return { images, promptLines, lineKeys: new Set(lines.map((l) => l.line_key)), pageCount: pages.length, lines };
}
const lineNo = (k: string) => Number(k.split("-l")[1]);

// ---------------------------------------------------------------------------
// Step 5: transcribe
// ---------------------------------------------------------------------------
export async function stepTranscribe(deps: PipelineDeps, L: Loaded): Promise<Transcription> {
  const { db, ai } = deps;
  const inp = await modelInputs(db, L);
  const questionItems = L.loaded.items.filter((i) => i.kind === "question");
  const t = await ai({
    role: "transcribe",
    promptVersion: TRANSCRIBE_PROMPT_VERSION,
    system: TRANSCRIBE_SYSTEM,
    context: renderAssignmentContext(L.loaded.context),
    images: inp.images,
    text: transcribeUserText(inp.pageCount, inp.promptLines),
    schema: TranscriptionSchema,
    validate: (d) => {
      const issues = validateTranscription(d, questionItems, inp.lineKeys, inp.pageCount);
      return issues.length ? formatIssues(issues) : null;
    },
    onRecord: recorder(db, L.submission.id, L.assignment.id),
  });

  await db.from("answers").delete().eq("submission_id", L.submission.id);
  const rows = t.answers
    .filter((a) => L.loaded.questionIdByKey.has(a.question_key))
    .map((a) => ({
      submission_id: L.submission.id,
      question_id: L.loaded.questionIdByKey.get(a.question_key)!,
      status: a.status,
      text: a.text,
      struck_text: a.struck_text,
      line_keys: a.line_keys,
      mapping_confidence: a.mapping_confidence,
      has_diagram: a.has_diagram,
      diagram_description: a.diagram_description,
      illegible_spans: a.illegible_spans,
      ocr_corrections: asJson(a.ocr_corrections),
    }));
  if (rows.length) {
    const { error } = await db.from("answers").insert(rows);
    if (error) throw new Error(`answers insert: ${error.message}`);
  }
  return t;
}

// ---------------------------------------------------------------------------
// Steps 6–7: grade, verify (verifier never sees the first grade)
// ---------------------------------------------------------------------------
function feedbackLocale(L: Loaded): "es" | "en" {
  const sid = L.submission.student_id;
  const student = sid ? L.roster.find((s) => s.id === sid) : null;
  return (student?.feedback_locale ?? L.assignment.feedback_locale ?? "es") as "es" | "en";
}

export async function stepGrade(deps: PipelineDeps, L: Loaded, t: Transcription): Promise<Grade> {
  const { db, ai } = deps;
  await setStage(db, L.submission.id, "grading");
  const inp = await modelInputs(db, L);
  return ai({
    role: "grade",
    promptVersion: GRADE_PROMPT_VERSION,
    system: gradeSystem({
      subject: L.assignment.subject,
      gradeLevel: L.assignment.grade_level,
      feedbackLocale: feedbackLocale(L),
      feedback: L.loaded.context.feedback,
      styleProfile: renderStyleProfile(L.styleProfile),
      exemplars: renderExemplars(
        L.exemplars,
        L.roster.map((s) => s.display_name),
      ),
    }),
    context: renderAssignmentContext(L.loaded.context),
    images: inp.images,
    text: gradeUserText(inp.pageCount, inp.promptLines, t),
    schema: GradeSchema,
    validate: (d) => {
      const issues = validateGrade(d, L.loaded.items, inp.lineKeys, inp.pageCount);
      return issues.length ? formatIssues(issues) : null;
    },
    onRecord: recorder(db, L.submission.id, L.assignment.id),
  });
}

export async function stepVerify(deps: PipelineDeps, L: Loaded, t: Transcription): Promise<Verification> {
  const { db, ai } = deps;
  await setStage(db, L.submission.id, "checking");
  const inp = await modelInputs(db, L);
  return ai({
    role: "verify",
    promptVersion: VERIFY_PROMPT_VERSION,
    system: VERIFY_SYSTEM,
    context: renderAssignmentContext(L.loaded.context),
    images: inp.images,
    text: verifyUserText(inp.pageCount, inp.promptLines, t),
    schema: VerificationSchema,
    validate: (d) => {
      const issues = validateVerification(d, L.loaded.items);
      return issues.length ? formatIssues(issues) : null;
    },
    onRecord: recorder(db, L.submission.id, L.assignment.id),
  });
}

// ---------------------------------------------------------------------------
// Steps 8–9: confidence + persist
// ---------------------------------------------------------------------------
export async function stepPersist(deps: PipelineDeps, L: Loaded, t: Transcription, g: Grade, v: Verification | null) {
  const { db } = deps;
  const inp = await modelInputs(db, L); // lines + legibility lookups (cheap; images not re-sent)
  const lineByKey = new Map(inp.lines.map((l) => [l.line_key, l]));
  const pageIdByPos = new Map(L.pages.map((p) => [p.position, p.id]));
  const legibility = new Map(t.pages.map((p) => [p.page_position, p.legibility]));
  const answerByKey = new Map(t.answers.map((a) => [a.question_key, a]));
  const verifierByKey = new Map((v?.items ?? []).map((i) => [itemKeyOf(i), i]));
  const passPct = passThresholdPct(L.loaded.context.scale);

  const scored = g.items.map((it) => {
    const key = itemKeyOf(it);
    const ans = it.question_key ? answerByKey.get(it.question_key) : undefined;
    const evidence = it.evidence_line_keys.map((k) => lineByKey.get(k)).filter(Boolean);
    const pagesUsed = [...new Set(it.evidence_line_keys.map((k) => Number(k.slice(1, k.indexOf("-")))))];
    const leg = pagesUsed.length
      ? Math.min(...pagesUsed.map((p) => legibility.get(p) ?? 1))
      : Math.min(...[...legibility.values(), 1]);
    const crit = L.loaded.criteria.find((c) => c.key === it.criterion_key);
    const ver = verifierByKey.get(key);
    const c = itemConfidence({
      ocrConfidences: evidence.map((l) => l!.confidence).filter((x): x is number => typeof x === "number"),
      pageLegibility: leg,
      mappingConfidence: ans ? ans.mapping_confidence : 1,
      graderScore: it.score,
      verifierScore: ver ? ver.score : null,
      max: it.max,
      levelStep: crit ? levelStep(crit) : null,
      selfConfidence: it.confidence,
      hasDiagram: !!ans?.has_diagram,
      passThresholdPct: passPct,
    });
    const band = toBand(c, bandThresholds);
    return { it, key, c, band, ver };
  });

  const flags = [...new Set([...t.flags, ...g.flags])];
  const band: Band = submissionBand(
    scored.map((s) => s.band),
    flags,
  );

  // criterion_scores (upsert by item_key)
  await db.from("criterion_scores").delete().eq("submission_id", L.submission.id);
  const { error: csErr } = await db.from("criterion_scores").insert(
    scored.map(({ it, key, c, band, ver }) => ({
      submission_id: L.submission.id,
      item_key: key,
      question_id: it.question_key ? (L.loaded.questionIdByKey.get(it.question_key) ?? null) : null,
      criterion_key: it.criterion_key,
      ai_score: it.score,
      ai_max: it.max,
      ai_level_label: it.level_label,
      evidence_line_keys: it.evidence_line_keys,
      rationale: it.rationale,
      self_confidence: it.confidence,
      confidence: c,
      confidence_band: band,
      verifier_score: ver?.score ?? null,
      disagreement: ver ? Math.abs(ver.score - it.score) > 1e-9 : false,
      error_type: it.error_type,
      misconception_tag: it.misconception_tag,
    })),
  );
  if (csErr) throw new Error(`criterion_scores insert: ${csErr.message}`);

  // annotations: replace AI pins, keep teacher pins
  await db.from("annotations").delete().eq("submission_id", L.submission.id).eq("author", "ai");
  const pins = g.annotations
    .map((a) => {
      const boxes = a.line_keys
        .map((k) => lineByKey.get(k)?.bbox as unknown as BBox | undefined)
        .filter((b): b is BBox => !!b);
      const region = boxes.length ? unionBox(boxes) : a.approx_bbox;
      return { a, region, approximate: !boxes.length };
    })
    .filter((p) => p.region && pageIdByPos.has(p.a.page_position))
    .sort((x, y) => x.a.page_position - y.a.page_position || x.region!.y - y.region!.y || x.region!.x - y.region!.x);
  if (pins.length) {
    const { error } = await db.from("annotations").insert(
      pins.map((p, i) => ({
        submission_id: L.submission.id,
        page_id: pageIdByPos.get(p.a.page_position)!,
        kind: p.a.kind,
        region: asJson(p.region),
        anchor_line_keys: p.a.line_keys,
        approximate: p.approximate,
        text: p.a.text,
        author: "ai" as const,
        position: i + 1,
      })),
    );
    if (error) throw new Error(`annotations insert: ${error.message}`);
  }

  // feedback (one row per submission)
  await db.from("feedback").upsert(
    {
      submission_id: L.submission.id,
      locale: feedbackLocale(L),
      glows: asJson(g.feedback.glows),
      grows: asJson(g.feedback.grows),
      next_step: g.feedback.next_step,
      practice_item: g.feedback.practice_item,
      summary_for_teacher: g.feedback.summary_for_teacher,
      ai_version: asJson({
        grade: GRADE_PROMPT_VERSION,
        transcribe: TRANSCRIBE_PROMPT_VERSION,
        verify: v ? VERIFY_PROMPT_VERSION : null,
      }),
      teacher_edited: false,
    },
    { onConflict: "submission_id" },
  );

  const totalScore = g.items.reduce((s, i) => s + i.score, 0);
  const totalMax = g.items.reduce((s, i) => s + i.max, 0);
  await setStage(db, L.submission.id, "ready", {
    status: "ready",
    confidence: band,
    flags,
    blind_check: pickForBlindCheck(L.teacher.blind_check_pct, Math.random(), flags),
    total_score: totalScore,
    total_max: totalMax,
    graded_at: new Date().toISOString(),
    error_code: null,
  });
  return { band, items: scored.length, pins: pins.length, flags };
}

/** Map a failure to a teacher-facing state. Returns true if handled (don't retry). */
export async function markFailure(db: AdminClient, submissionId: string, err: unknown): Promise<boolean> {
  const code =
    err instanceof PipelineStop
      ? err.code
      : err instanceof MissingConfigError
        ? "not_configured"
        : err instanceof AiRefusalError
          ? "ai_refused"
          : err instanceof AiOutputError
            ? "ai_invalid_output"
            : null;
  if (!code) return false;
  await setStage(db, submissionId, "failed", { status: "needs_attention", error_code: code, confidence: "low" });
  return true;
}

/** Full pipeline. `run` wraps each step (Inngest step.run in production; direct call in tests). */
export async function gradeSubmission(deps: PipelineDeps, submissionId: string, run: StepRunner) {
  const L = await loadSubmission(deps.db, submissionId);
  try {
    if (!L.loaded.items.length) throw new PipelineStop("no_answer_key");
    await run("normalise", () => stepNormalise(deps, L));
    await run("ocr", () => stepOcr(deps, L));
    await run("name-and-redact", () => stepNameAndRedact(deps, L));
    const t = await run("transcribe", () => stepTranscribe(deps, L));
    const g = await run("grade", () => stepGrade(deps, L, t));
    const v = await run("verify", () => stepVerify(deps, L, t)); // Phase 1: verifier on all items
    return await run("persist", () => stepPersist(deps, L, t, g, v));
  } catch (err) {
    if (await markFailure(deps.db, submissionId, err)) return { failed: true as const };
    throw err;
  }
}
