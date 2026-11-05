"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { newReleaseToken } from "@/lib/release/tokens";
import { createSupabaseServerClient } from "@/lib/supabase/server";

async function requireTeacher() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");
  return { supabase, user: data.user };
}

const Schema = z.object({
  submissionIds: z.array(z.uuid()).min(1).max(200),
  expiresInDays: z.number().int().min(1).max(365).nullable(),
});

/**
 * Release approved work (§3.5): one revocable ≥128-bit token per submission.
 * Only approved submissions can be released (also enforced by a DB trigger).
 */
export async function releaseSubmissions(input: z.input<typeof Schema>) {
  const p = Schema.safeParse(input);
  if (!p.success) return { ok: false as const, released: 0 };
  const { supabase, user } = await requireTeacher();
  const { data: subs } = await supabase
    .from("submissions")
    .select("id, assignment_id, status")
    .in("id", p.data.submissionIds);
  const approved = (subs ?? []).filter((s) => s.status === "approved");
  const expires_at = p.data.expiresInDays
    ? new Date(Date.now() + p.data.expiresInDays * 86400_000).toISOString()
    : null;
  let released = 0;
  for (const s of approved) {
    const { error } = await supabase
      .from("releases")
      .insert({ submission_id: s.id, token: newReleaseToken(), channel: "link", expires_at });
    if (error) continue;
    await supabase.from("submissions").update({ status: "released" }).eq("id", s.id).eq("status", "approved");
    await supabase
      .from("audit_log")
      .insert({
        actor_id: user.id,
        action: "submission.released",
        entity: "submission",
        entity_id: s.id,
        meta: { expires_at },
      });
    released++;
  }
  const assignmentId = approved[0]?.assignment_id;
  if (assignmentId) {
    const { count } = await supabase
      .from("submissions")
      .select("id", { count: "exact", head: true })
      .eq("assignment_id", assignmentId)
      .neq("status", "released");
    if (count === 0) await supabase.from("assignments").update({ status: "released" }).eq("id", assignmentId);
    revalidatePath(`/assignments/${assignmentId}/release`);
    revalidatePath(`/assignments/${assignmentId}`);
  }
  return { ok: true as const, released };
}

/** Revoke a student's link immediately; the work goes back to "approved" so it can be edited and re-released. */
export async function revokeRelease(releaseId: string) {
  if (!z.uuid().safeParse(releaseId).success) return { ok: false };
  const { supabase, user } = await requireTeacher();
  const { data: rel } = await supabase.from("releases").select("id, submission_id").eq("id", releaseId).maybeSingle();
  if (!rel) return { ok: false };
  await supabase.from("releases").update({ revoked_at: new Date().toISOString() }).eq("id", rel.id);
  const { data: sub } = await supabase
    .from("submissions")
    .update({ status: "approved" })
    .eq("id", rel.submission_id)
    .select("assignment_id")
    .maybeSingle();
  await supabase
    .from("audit_log")
    .insert({ actor_id: user.id, action: "release.revoked", entity: "release", entity_id: rel.id });
  if (sub) revalidatePath(`/assignments/${sub.assignment_id}/release`);
  return { ok: true };
}
