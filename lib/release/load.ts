import "server-only";
import { FeedbackSettingsSchema } from "@/lib/grading/assignment";
import { ScaleSchema, toScale } from "@/lib/grading/scales";
import { BUCKETS, getAdminClient } from "@/lib/supabase/admin";
import { TOKEN_RE } from "./tokens";

export type BBox = { x: number; y: number; w: number; h: number };
export type ReleasedWork = Awaited<ReturnType<typeof loadReleasedWork>>;

/**
 * The ONLY read path for the public student view (§7): validate the token with
 * the service role and return just that submission's released data.
 */
export async function loadReleaseByToken(token: string) {
  if (!TOKEN_RE.test(token)) return null;
  const db = getAdminClient();
  const { data: rel } = await db
    .from("releases")
    .select("id, submission_id, expires_at, revoked_at, viewed_at")
    .eq("token", token)
    .maybeSingle();
  if (!rel || rel.revoked_at) return null;
  if (rel.expires_at && new Date(rel.expires_at) < new Date()) return null;
  const work = await loadReleasedWork(rel.submission_id);
  if (!work) return null;
  if (!rel.viewed_at) await db.from("releases").update({ viewed_at: new Date().toISOString() }).eq("id", rel.id);
  return work;
}

/** Shared by the student view and teacher exports. Returns null unless the submission is released/approved. */
export async function loadReleasedWork(submissionId: string, opts: { allowApproved?: boolean } = {}) {
  const db = getAdminClient();
  const { data: sub } = await db
    .from("submissions")
    .select("id, status, student_id, assignment_id, total_score, total_max")
    .eq("id", submissionId)
    .maybeSingle();
  if (!sub) return null;
  if (!(sub.status === "released" || (opts.allowApproved && sub.status === "approved"))) return null;
  const [{ data: a }, { data: student }, { data: pages }, { data: pins }, { data: fb }] = await Promise.all([
    db
      .from("assignments")
      .select("id, title, subject, scale, feedback_settings, class_id")
      .eq("id", sub.assignment_id)
      .single(),
    sub.student_id
      ? db.from("students").select("display_name").eq("id", sub.student_id).maybeSingle()
      : Promise.resolve({ data: null }),
    db.from("pages").select("id, position, storage_path, width, height").eq("submission_id", sub.id).order("position"),
    db
      .from("annotations")
      .select("id, page_id, kind, region, approximate, text, position")
      .eq("submission_id", sub.id)
      .eq("hidden", false)
      .order("position"),
    db
      .from("feedback")
      .select("locale, glows, grows, next_step, practice_item")
      .eq("submission_id", sub.id)
      .maybeSingle(),
  ]);
  if (!a) return null;
  const settings = FeedbackSettingsSchema.parse(a.feedback_settings ?? {});
  const scale = ScaleSchema.parse(a.scale);
  const result = sub.total_max ? toScale(scale, Number(sub.total_score), Number(sub.total_max)) : null;
  return {
    submissionId: sub.id,
    assignment: { id: a.id, title: a.title, subject: a.subject },
    studentName: student?.display_name ?? null,
    locale: (fb?.locale ?? "es") as "es" | "en",
    showScore: settings.show_score,
    grade: result,
    pages: (pages ?? []).map((p) => ({
      id: p.id,
      position: p.position,
      path: p.storage_path,
      width: p.width ?? 1,
      height: p.height ?? 1,
    })),
    pins: (pins ?? []).map((p, i) => ({ ...p, number: p.position ?? i + 1, region: p.region as BBox | null })),
    feedback: {
      glows: ((fb?.glows as string[]) ?? []).filter(Boolean),
      grows: ((fb?.grows as { point: string; how: string }[]) ?? []).filter((g) => g.point),
      nextStep: fb?.next_step ?? "",
      practiceItem: fb?.practice_item ?? null,
    },
  };
}

export async function signedPageUrl(path: string, ttlSeconds = 600) {
  const { data } = await getAdminClient().storage.from(BUCKETS.original).createSignedUrl(path, ttlSeconds);
  return data?.signedUrl ?? null;
}

export async function downloadPage(path: string) {
  const { data, error } = await getAdminClient().storage.from(BUCKETS.original).download(path);
  if (error || !data) throw new Error("page download failed");
  return Buffer.from(await data.arrayBuffer());
}
