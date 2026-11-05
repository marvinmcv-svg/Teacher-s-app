/**
 * Eval harness runner (§8.7) — `pnpm eval`.
 *
 * Runs the REAL pipeline (Claude + Google Vision, via local Supabase) over the
 * consented golden set and reports transcription CER, over-correction,
 * agreement (exact / within tolerance / QWK), harsh vs lenient errors,
 * confidence calibration, anchor IoU, feedback quality (LLM judge),
 * run-to-run consistency, cost and latency. Writes evals/reports/<stamp>.{json,md}
 * and fails if within-tolerance agreement drops > 2 points vs baseline.json.
 *
 * Options (env): EVAL_RUNS=3 (consistency), EVAL_LIMIT=n, EVAL_JUDGE=0 to skip the judge.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

import { callStructured } from "@/lib/ai/client";
import { MissingConfigError } from "@/lib/ai/errors";
import { FeedbackJudgeSchema } from "@/lib/ai/schemas";
import { criterionMax, questionKey } from "@/lib/grading/assignment";
import { GoldenManifestSchema, type GoldenManifest } from "@/lib/evals/manifest";
import {
  agreement,
  anchorAccuracy,
  calibration,
  cer,
  consistency,
  overCorrectionRate,
  quadraticWeightedKappa,
  regressionGate,
  type ScoredItem,
} from "@/lib/evals/metrics";
import { getOcrProvider } from "@/lib/ocr/google-vision";
import { levelStep } from "@/lib/pipeline/context";
import { gradeSubmission } from "@/lib/pipeline/grade-submission";
import { BUCKETS, getAdminClient } from "@/lib/supabase/admin";

const ROOT = path.resolve(import.meta.dirname);
const MANIFEST = path.join(ROOT, "golden/manifest.json");
const RUNS = Number(process.env.EVAL_RUNS ?? 1);
const LIMIT = Number(process.env.EVAL_LIMIT ?? Infinity);
const JUDGE = process.env.EVAL_JUDGE !== "0";

function preflight(): GoldenManifest {
  const missing = ["ANTHROPIC_API_KEY", "SUPABASE_SECRET_KEY", "NEXT_PUBLIC_SUPABASE_URL"].filter(
    (k) => !process.env[k],
  );
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS && !process.env.GOOGLE_CLOUD_PROJECT)
    missing.push("GOOGLE_APPLICATION_CREDENTIALS");
  if (missing.length) throw new MissingConfigError("The eval harness", missing);
  if (!existsSync(MANIFEST))
    throw new Error(
      "evals/golden/manifest.json not found. Add consented, de-identified papers (see evals/README.md and manifest.example.json). Evals never run on synthetic data.",
    );
  return GoldenManifestSchema.parse(JSON.parse(readFileSync(MANIFEST, "utf8")));
}

describe("eval harness", () => {
  it("runs the golden set and passes the regression gate", { timeout: 6 * 3600_000 }, async () => {
    const manifest = preflight();
    const db = getAdminClient();
    const deps = { db, ocr: getOcrProvider(), ai: callStructured };
    const { data: u, error } = await db.auth.admin.createUser({
      email: `eval-${Date.now()}@tinta.test`,
      email_confirm: true,
    });
    if (error) throw error;
    const teacherId = u.user.id;
    const items: (ScoredItem & { paper: string; key: string; tags: string[] })[] = [];
    const tx: { pred: string; truth: string; studentError: boolean; correctAnswers: string[] }[] = [];
    const anchors: {
      refs: { page: number; box: { x: number; y: number; w: number; h: number } }[];
      preds: { page: number; box: { x: number; y: number; w: number; h: number } }[];
    } = { refs: [], preds: [] };
    const consistencyRuns: { runs: number[][]; maxes: number[] }[] = [];
    const judged: { specific: number; actionable: number; correct: number; tone: number; length_ok: boolean }[] = [];
    const failures: { paper: string; code: string }[] = [];
    const secondTeacher: ScoredItem[] = [];

    try {
      const { data: cls } = await db.from("classes").insert({ teacher_id: teacherId, name: "eval" }).select().single();
      const assignmentIds = new Map<string, string>();
      for (const [key, a] of Object.entries(manifest.assignments)) {
        const { data: row } = await db
          .from("assignments")
          .insert({
            class_id: cls!.id,
            title: a.title,
            subject: a.subject,
            grade_level: a.grade_level,
            scale: a.scale,
            criteria: a.criteria,
            feedback_settings: a.feedback,
            status: "grading",
          })
          .select()
          .single();
        assignmentIds.set(key, row!.id);
        if (a.questions.length)
          await db
            .from("questions")
            .insert(
              a.questions.map((q, i) => ({
                ...q,
                assignment_id: row!.id,
                position: i + 1,
                source: "typed" as const,
                teacher_confirmed: true,
              })),
            );
      }

      for (const paper of manifest.papers.slice(0, LIMIT)) {
        const a = manifest.assignments[paper.assignment];
        const assignmentId = assignmentIds.get(paper.assignment)!;
        const { data: sub } = await db
          .from("submissions")
          .insert({ assignment_id: assignmentId, status: "queued" })
          .select()
          .single();
        for (const [i, rel] of paper.pages.entries()) {
          const p = `${teacherId}/${assignmentId}/${sub!.id}/original-p${i + 1}.jpg`;
          await db.storage
            .from(BUCKETS.original)
            .upload(p, readFileSync(path.join(ROOT, "golden", rel)), { contentType: "image/jpeg", upsert: true });
          await db.from("pages").insert({ submission_id: sub!.id, position: i + 1, storage_path: p });
        }
        const perRun: number[][] = [];
        const keys = [...a.questions.map((_, i) => questionKey(i + 1)), ...a.criteria.map((c) => c.key)];
        const maxes = [...a.questions.map((q) => q.max_points), ...a.criteria.map(criterionMax)];
        for (let run = 0; run < RUNS; run++) {
          const res = await gradeSubmission(deps, sub!.id, (_n, fn) => fn());
          if ("failed" in res) {
            const { data: s } = await db.from("submissions").select("error_code").eq("id", sub!.id).single();
            failures.push({ paper: paper.id, code: s?.error_code ?? "unknown" });
            break;
          }
          const { data: scores } = await db
            .from("criterion_scores")
            .select("item_key, ai_score, confidence_band")
            .eq("submission_id", sub!.id);
          const byKey = new Map((scores ?? []).map((s) => [s.item_key, s]));
          perRun.push(keys.map((k) => Number(byKey.get(k)?.ai_score ?? 0)));
          if (run > 0) continue; // metrics from the first run; later runs only measure consistency
          keys.forEach((k, i) => {
            const crit = a.criteria.find((c) => c.key === k);
            const truth = paper.truth.scores[k];
            if (truth === undefined) return;
            items.push({
              paper: paper.id,
              key: k,
              tags: paper.tags,
              ai: Number(byKey.get(k)?.ai_score ?? 0),
              teacher: truth,
              max: maxes[i],
              levelStep: crit ? levelStep(crit) : null,
              band: byKey.get(k)?.confidence_band ?? null,
            });
            const t2 = paper.truth.second_teacher_scores?.[k];
            if (t2 !== undefined) secondTeacher.push({ ai: t2, teacher: truth, max: maxes[i] });
          });
          const { data: answers } = await db
            .from("answers")
            .select("text, questions(position)")
            .eq("submission_id", sub!.id);
          for (const ans of answers ?? []) {
            const k = questionKey((ans.questions as unknown as { position: number }).position);
            const truth = paper.truth.transcriptions[k];
            const q = a.questions[(ans.questions as unknown as { position: number }).position - 1];
            if (truth)
              tx.push({
                pred: ans.text ?? "",
                truth: truth.text,
                studentError: truth.student_error,
                correctAnswers: q?.correct_answers ?? [],
              });
          }
          const { data: pins } = await db
            .from("annotations")
            .select("region, pages(position)")
            .eq("submission_id", sub!.id)
            .eq("author", "ai");
          anchors.refs.push(...paper.truth.annotations.map((r) => ({ page: r.page, box: r.box })));
          anchors.preds.push(
            ...(pins ?? []).map((p) => ({
              page: (p.pages as unknown as { position: number }).position,
              box: p.region as { x: number; y: number; w: number; h: number },
            })),
          );
          if (JUDGE) {
            const { data: fb } = await db
              .from("feedback")
              .select("glows, grows, next_step")
              .eq("submission_id", sub!.id)
              .single();
            const j = await callStructured({
              role: "judge",
              promptVersion: "judge.v1",
              system:
                "You evaluate teacher feedback written for a school student. Score 1-5: specific (points at the student's actual work), actionable (concrete how), correct (consistent with the given scores/answers), tone (kind, no shaming, no generic praise). length_ok: short and readable for the grade. Respond only with the JSON object.",
              images: [],
              text: `Ground-truth scores: ${JSON.stringify(paper.truth.scores)}\nTranscriptions: ${JSON.stringify(paper.truth.transcriptions)}\nFeedback: ${JSON.stringify(fb)}`,
              schema: FeedbackJudgeSchema,
            });
            judged.push(j);
          }
        }
        if (perRun.length) consistencyRuns.push({ runs: perRun, maxes });
      }
    } finally {
      await db.auth.admin.deleteUser(teacherId);
    }

    const { data: runsCost } = await db
      .from("grading_runs")
      .select("cost_usd, latency_ms")
      .gte("created_at", new Date(Date.now() - 6 * 3600_000).toISOString());
    const agr = agreement(items);
    const report = {
      at: new Date().toISOString(),
      papers: Math.min(manifest.papers.length, LIMIT),
      items: items.length,
      failures,
      transcription: { cer: cer(tx), overCorrection: overCorrectionRate(tx) },
      agreement: agr,
      qwk: quadraticWeightedKappa(items),
      byTag: Object.fromEntries(
        [...new Set(items.flatMap((i) => i.tags))].map((tag) => [
          tag,
          agreement(items.filter((i) => i.tags.includes(tag))),
        ]),
      ),
      calibration: calibration(items),
      anchors: anchorAccuracy(anchors.refs, anchors.preds),
      consistency: RUNS > 1 ? consistencyRuns.map((c) => consistency(c.runs, c.maxes)) : "set EVAL_RUNS=3",
      humanBaseline: secondTeacher.length ? agreement(secondTeacher) : "no second-teacher scores in manifest",
      feedbackJudge: judged.length
        ? Object.fromEntries(
            (["specific", "actionable", "correct", "tone"] as const).map((k) => [
              k,
              judged.reduce((s, j) => s + j[k], 0) / judged.length,
            ]),
          )
        : "skipped",
      splitVsJoint: "not implemented yet — only the split pipeline runs (DECISIONS D-027)",
      cost: {
        totalUsd: (runsCost ?? []).reduce((s, r) => s + Number(r.cost_usd ?? 0), 0),
        meanLatencyMs:
          (runsCost ?? []).reduce((s, r) => s + Number(r.latency_ms ?? 0), 0) / Math.max(1, runsCost?.length ?? 0),
      },
    };
    const reportsDir = path.join(ROOT, "reports");
    mkdirSync(reportsDir, { recursive: true });
    const stamp = report.at.replace(/[:.]/g, "-");
    writeFileSync(path.join(reportsDir, `${stamp}.json`), JSON.stringify(report, null, 2));
    writeFileSync(
      path.join(reportsDir, `${stamp}.md`),
      `# Eval report ${report.at}\n\nPapers: ${report.papers} · items: ${report.items} · failures: ${failures.length}\n\n| metric | value |\n|---|---|\n| within-tolerance agreement | ${(agr.withinTolerance * 100).toFixed(1)}% |\n| exact agreement | ${(agr.exact * 100).toFixed(1)}% |\n| QWK | ${report.qwk.toFixed(3)} |\n| harsh (AI below teacher) | ${(agr.harsh * 100).toFixed(1)}% |\n| lenient | ${(agr.lenient * 100).toFixed(1)}% |\n| transcription CER | ${(report.transcription.cer * 100).toFixed(1)}% |\n| over-correction | ${(report.transcription.overCorrection.rate * 100).toFixed(1)}% (${report.transcription.overCorrection.cases}/${report.transcription.overCorrection.n}) |\n| "high" accuracy | ${(report.calibration.high.accuracy * 100).toFixed(1)}% (${report.calibration.high.n} items, ${(report.calibration.high.share * 100).toFixed(0)}% share) |\n| anchor IoU (mean / ≥0.5) | ${report.anchors.meanIoU.toFixed(2)} / ${(report.anchors.hitRate * 100).toFixed(0)}% |\n| cost | $${report.cost.totalUsd.toFixed(2)} |\n`,
    );
    const baselinePath = path.join(reportsDir, "baseline.json");
    const baseline = existsSync(baselinePath)
      ? (JSON.parse(readFileSync(baselinePath, "utf8")).agreement?.withinTolerance ?? null)
      : null;
    const gate = regressionGate(agr.withinTolerance, baseline);
    console.log(
      `eval: within-tolerance ${(agr.withinTolerance * 100).toFixed(1)}% (baseline ${baseline === null ? "none" : (baseline * 100).toFixed(1) + "%"})`,
    );
    expect(gate.pass, `within-tolerance agreement dropped ${gate.delta?.toFixed(1)} points vs baseline`).toBe(true);
  });
});
