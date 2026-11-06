import "server-only";
import { z } from "zod";
import { FeedbackSettingsSchema } from "@/lib/grading/assignment";
import { ScaleSchema, toScale } from "@/lib/grading/scales";
import { BUCKETS, getAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { BBox, Mark, MarkKind } from "./render";

/** The signed-in teacher must be able to see the row through RLS before anything is read with the service role. */
export async function teacherCanSee(table: "submissions" | "assignments", id: string) {
  if (!z.uuid().safeParse(id).success) return false;
  const supabase = await createSupabaseServerClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return false;
  const { data } = await supabase.from(table).select("id").eq("id", id).maybeSingle();
  return !!data;
}

const fmt = (n: number) => String(Math.round(n * 10) / 10);

/** "8/10", plus the class scale when it says something different: "8/10 (80)", "8/10 (Logrado)". */
export function scoreLabel(scaleJson: unknown, score: number, max: number): string | null {
  if (!(max > 0)) return null;
  const raw = `${fmt(score)}/${fmt(max)}`;
  const scale = ScaleSchema.safeParse(scaleJson);
  if (!scale.success) return raw;
  const s = toScale(scale.data, score, max);
  return s.display === fmt(score) ? raw : `${raw} (${s.display})`;
}

export type MarkedPaper = {
  submissionId: string;
  studentName: string | null;
  pages: { id: string; position: number; path: string }[];
  marksByPage: Map<string, Mark[]>;
  score: string | null;
};

export async function loadMarkedPaper(submissionId: string): Promise<MarkedPaper | null> {
  const db = getAdminClient();
  const { data: sub } = await db
    .from("submissions")
    .select("id, student_id, assignment_id, total_score, total_max, status")
    .eq("id", submissionId)
    .maybeSingle();
  if (!sub || !["ready", "approved"].includes(sub.status)) return null;
  const [{ data: a }, { data: student }, { data: pages }, { data: pins }] = await Promise.all([
    db.from("assignments").select("scale, feedback_settings").eq("id", sub.assignment_id).single(),
    sub.student_id
      ? db.from("students").select("display_name").eq("id", sub.student_id).maybeSingle()
      : Promise.resolve({ data: null }),
    db.from("pages").select("id, position, storage_path").eq("submission_id", sub.id).order("position"),
    db
      .from("annotations")
      .select("page_id, kind, region, text, position")
      .eq("submission_id", sub.id)
      .eq("hidden", false)
      .order("position"),
  ]);
  const showScore = FeedbackSettingsSchema.parse(a?.feedback_settings ?? {}).show_score;
  const marksByPage = new Map<string, Mark[]>();
  for (const p of pins ?? []) {
    const list = marksByPage.get(p.page_id) ?? [];
    list.push({ kind: p.kind as MarkKind, region: p.region as BBox | null, text: p.text });
    marksByPage.set(p.page_id, list);
  }
  return {
    submissionId: sub.id,
    studentName: student?.display_name ?? null,
    pages: (pages ?? []).map((p) => ({ id: p.id, position: p.position, path: p.storage_path })),
    marksByPage,
    score: showScore && sub.total_max ? scoreLabel(a?.scale, Number(sub.total_score), Number(sub.total_max)) : null,
  };
}

export async function downloadOriginal(path: string) {
  const { data, error } = await getAdminClient().storage.from(BUCKETS.original).download(path);
  if (error || !data) throw new Error("page download failed");
  return Buffer.from(await data.arrayBuffer());
}
