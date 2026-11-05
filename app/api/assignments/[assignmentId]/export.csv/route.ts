import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { questionKey } from "@/lib/grading/assignment";
import { ScaleSchema, toScale } from "@/lib/grading/scales";
import { toCsv } from "@/lib/release/csv";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** Gradebook export (§3.5d). RLS-scoped: a teacher only exports their own classes. */
export async function GET(_req: Request, ctx: RouteContext<"/api/assignments/[assignmentId]/export.csv">) {
  const { assignmentId } = await ctx.params;
  if (!z.uuid().safeParse(assignmentId).success) return new Response("Not found", { status: 404 });
  const supabase = await createSupabaseServerClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return new Response("Unauthorized", { status: 401 });
  const { data: a } = await supabase
    .from("assignments")
    .select("id, title, scale, class_id")
    .eq("id", assignmentId)
    .maybeSingle();
  if (!a) return new Response("Not found", { status: 404 });
  const t = await getTranslations();
  const [{ data: roster }, { data: subs }, { data: questions }] = await Promise.all([
    supabase
      .from("students")
      .select("id, display_name, external_id")
      .eq("class_id", a.class_id)
      .eq("active", true)
      .order("display_name"),
    supabase.from("submissions").select("id, student_id, status, total_score, total_max").eq("assignment_id", a.id),
    supabase.from("questions").select("position, label").eq("assignment_id", a.id).order("position"),
  ]);
  const subIds = (subs ?? []).map((s) => s.id);
  const { data: scores } = subIds.length
    ? await supabase
        .from("criterion_scores")
        .select("submission_id, item_key, ai_score, teacher_score")
        .in("submission_id", subIds)
    : { data: [] };
  const itemKeys = [
    ...new Set([
      ...(questions ?? []).map((q) => questionKey(q.position)),
      ...(scores ?? []).map((s) => s.item_key ?? ""),
    ]),
  ].filter(Boolean);
  const labelOf = new Map(
    (questions ?? []).map((q) => [questionKey(q.position), `${t("assignments.questionLabel")} ${q.label}`]),
  );
  const scale = ScaleSchema.parse(a.scale);
  const bySub = new Map(
    subIds.map((id) => [
      id,
      new Map(
        (scores ?? []).filter((s) => s.submission_id === id).map((s) => [s.item_key, s.teacher_score ?? s.ai_score]),
      ),
    ]),
  );
  const byStudent = new Map((subs ?? []).filter((s) => s.student_id).map((s) => [s.student_id!, s]));

  const header = [
    t("review.student"),
    "ID",
    ...itemKeys.map((k) => labelOf.get(k) ?? k),
    t("review.total"),
    "Max",
    t("hub.scale"),
    "OK",
    "Status",
  ];
  const rows = (roster ?? []).map((st) => {
    const s = byStudent.get(st.id);
    // only teacher-approved work is exported as a grade
    const final = s && (s.status === "approved" || s.status === "released");
    const g = final && s.total_max ? toScale(scale, Number(s.total_score), Number(s.total_max)) : null;
    const items = final ? bySub.get(s.id)! : new Map();
    return [
      st.display_name,
      st.external_id,
      ...itemKeys.map((k) => (items.get(k) ?? "") as string | number),
      final ? Number(s.total_score) : "",
      final ? Number(s.total_max) : "",
      g?.display ?? "",
      g ? (g.passing ? "1" : "0") : "",
      s ? t(`stages.${s.status === "ready" ? "ready" : s.status === "needs_attention" ? "failed" : s.status}`) : "",
    ];
  });
  const csv = toCsv([header, ...rows]);
  const name = `${a.title}.csv`.replace(/[^\w.-]+/g, "_");
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
