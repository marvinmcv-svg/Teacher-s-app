import "server-only";
import type { CallRecord } from "@/lib/ai/client";
import { styleProfileConfig } from "@/lib/ai/config";
import { STYLE_DISTILL_PROMPT_VERSION, STYLE_DISTILL_SYSTEM, styleDistillUserText } from "@/lib/ai/prompts/style";
import { StyleDistillSchema } from "@/lib/ai/schemas";
import type { Json } from "@/lib/db/types";
import { scrubNames } from "@/lib/privacy/names";
import { medianWords, strictnessByScope, type ScoreEdit, type StoredProfile, type TextEdit } from "@/lib/style/profile";
import type { AdminClient } from "@/lib/supabase/admin";
import type { AiCaller } from "./grade-submission";

type Feedbackish = { glows?: string[]; grows?: { point: string; how: string }[]; next_step?: string | null };
const feedbackText = (f: Feedbackish | null) =>
  f
    ? [...(f.glows ?? []), ...(f.grows ?? []).map((g) => `${g.point} ${g.how}`), f.next_step ?? ""]
        .filter(Boolean)
        .join(" / ")
    : "";

/** Latest profile for prompts, or null. */
export async function loadStyleProfile(db: AdminClient, teacherId: string): Promise<StoredProfile | null> {
  const { data } = await db
    .from("style_profiles")
    .select("profile")
    .eq("teacher_id", teacherId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.profile as StoredProfile | undefined) ?? null;
}

/**
 * Distil this teacher's style profile from their own edits (§3.7). Teacher-only
 * signal: no cross-teacher sharing, no fine-tuning. Names are scrubbed before
 * the model call. Strictness is computed in code from score edits.
 */
export async function distillStyleProfile(db: AdminClient, ai: AiCaller, teacherId: string, force = false) {
  const { data: last } = await db
    .from("style_profiles")
    .select("version, created_at, profile")
    .eq("teacher_id", teacherId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  let newer = db.from("teacher_edits").select("id", { count: "exact", head: true }).eq("teacher_id", teacherId);
  if (last) newer = newer.gt("created_at", last.created_at);
  const { count: newEdits } = await newer;
  if (!force && (newEdits ?? 0) < styleProfileConfig.min_new_edits) return { skipped: true as const };

  const { data: edits } = await db
    .from("teacher_edits")
    .select("target_table, target_id, before, after, created_at")
    .eq("teacher_id", teacherId)
    .order("created_at", { ascending: false })
    .limit(styleProfileConfig.max_edits_considered);
  const list = edits ?? [];
  if (!list.length) return { skipped: true as const };

  // Score edits → strictness per scope
  const scoreIds = list.filter((e) => e.target_table === "criterion_scores").map((e) => e.target_id);
  const { data: items } = scoreIds.length
    ? await db.from("criterion_scores").select("id, ai_max, criterion_key, question_id").in("id", scoreIds)
    : { data: [] };
  const qIds = [...new Set((items ?? []).map((i) => i.question_id).filter((x): x is string => !!x))];
  const { data: qs } = qIds.length
    ? await db.from("questions").select("id, type").in("id", qIds)
    : { data: [] as { id: string; type: string }[] };
  const typeOf = new Map((qs ?? []).map((q) => [q.id, q.type]));
  const itemById = new Map((items ?? []).map((i) => [i.id, i]));
  const scoreEdits: ScoreEdit[] = list
    .filter((e) => e.target_table === "criterion_scores")
    .flatMap((e) => {
      const it = itemById.get(e.target_id);
      const b = (e.before as { score?: number } | null)?.score;
      const a = (e.after as { score?: number } | null)?.score;
      if (!it || typeof b !== "number" || typeof a !== "number") return [];
      const scope = it.criterion_key
        ? `rubric:${it.criterion_key}`
        : `type:${typeOf.get(it.question_id ?? "") ?? "other"}`;
      return [{ scope, before: b, after: a, max: Number(it.ai_max) }];
    });

  // Text edits (comments + feedback), names scrubbed
  const { data: classes } = await db.from("classes").select("id").eq("teacher_id", teacherId);
  const { data: students } = classes?.length
    ? await db
        .from("students")
        .select("display_name")
        .in(
          "class_id",
          classes.map((c) => c.id),
        )
    : { data: [] as { display_name: string }[] };
  const names = (students ?? []).map((s) => s.display_name);
  const clean = (s: string) => scrubNames(s, names).slice(0, 400);
  const textEdits: TextEdit[] = list.flatMap((e) => {
    if (e.target_table === "annotations") {
      const b = (e.before as { text?: string } | null)?.text ?? "";
      const a = (e.after as { text?: string } | null)?.text;
      if (typeof a !== "string" || a === b) return [];
      return [{ before: clean(b), after: clean(a) }];
    }
    if (e.target_table === "feedback") {
      const b = feedbackText(e.before as Feedbackish | null);
      const a = feedbackText(e.after as Feedbackish | null);
      return a !== b ? [{ before: clean(b), after: clean(a) }] : [];
    }
    return [];
  });

  const previous = (last?.profile as StoredProfile | undefined) ?? null;
  let wording = previous
    ? {
        summary: previous.summary,
        preferred_phrases: previous.preferred_phrases,
        avoid_phrases: previous.avoid_phrases,
        typical_length: previous.typical_length,
        tone: previous.tone,
        praise_style: previous.praise_style,
        correction_style: previous.correction_style,
      }
    : null;
  if (textEdits.length >= 3) {
    wording = await ai({
      role: "style_distill",
      promptVersion: STYLE_DISTILL_PROMPT_VERSION,
      system: STYLE_DISTILL_SYSTEM,
      images: [],
      text: styleDistillUserText(textEdits.slice(0, 80), previous?.summary ?? null),
      schema: StyleDistillSchema,
      onRecord: (r: CallRecord) => recordTeacherRun(db, teacherId, r),
    });
  }
  const strictness = strictnessByScope(scoreEdits);
  if (!wording && !strictness.length) return { skipped: true as const };

  const profile: StoredProfile = {
    summary: wording?.summary ?? "",
    preferred_phrases: (wording?.preferred_phrases ?? []).map(clean).slice(0, 12),
    avoid_phrases: (wording?.avoid_phrases ?? []).map(clean).slice(0, 12),
    typical_length: wording?.typical_length ?? "short",
    tone: wording?.tone ?? "",
    praise_style: wording?.praise_style ?? "",
    correction_style: wording?.correction_style ?? "",
    strictness,
    comment_words_median: medianWords(textEdits.map((e) => e.after)),
    edits_considered: list.length,
  };
  const { error } = await db.from("style_profiles").insert({
    teacher_id: teacherId,
    profile: profile as unknown as NonNullable<Json>,
    version: (last?.version ?? 0) + 1,
    built_from_edit_count: list.length,
  });
  if (error) throw new Error(`style_profiles insert: ${error.message}`);
  return { skipped: false as const, version: (last?.version ?? 0) + 1 };
}

async function recordTeacherRun(db: AdminClient, teacherId: string, r: CallRecord) {
  await db.from("grading_runs").insert({
    teacher_id: teacherId,
    kind: "style_distill",
    model: r.model,
    prompt_version: r.promptVersion,
    effort: r.effort,
    input_tokens: r.inputTokens,
    output_tokens: r.outputTokens,
    cache_read_tokens: r.cacheReadTokens,
    cost_usd: r.costUsd,
    latency_ms: r.latencyMs,
    raw_output: (r.rawOutput ?? null) as Json,
    status: r.status,
    error: r.error ?? null,
  });
}

/** Teachers with enough new edits since their last profile. */
export async function teachersDueForProfile(db: AdminClient): Promise<string[]> {
  const since = new Date(Date.now() - 2 * 86400_000).toISOString();
  const { data } = await db.from("teacher_edits").select("teacher_id").gte("created_at", since).limit(5000);
  return [...new Set((data ?? []).map((d) => d.teacher_id))];
}
