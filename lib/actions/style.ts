"use server";
import { revalidatePath } from "next/cache";
import { inngest } from "@/inngest/client";
import { requireTeacher } from "./helpers";

/** Ask for a fresh style profile now instead of waiting for the nightly run. */
export async function refreshStyleProfile() {
  const { user } = await requireTeacher();
  try {
    await inngest.send({ name: "tinta/style.distill.requested", data: { teacherId: user.id, force: true } });
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

/** Forget the learned style (all versions). Edits stay, so it can be rebuilt later. */
export async function resetStyleProfile() {
  const { supabase, user } = await requireTeacher();
  const { error } = await supabase.from("style_profiles").delete().eq("teacher_id", user.id);
  await supabase
    .from("audit_log")
    .insert({ actor_id: user.id, action: "style_profile.reset", entity: "teacher", entity_id: user.id });
  revalidatePath("/settings/style");
  return { ok: !error };
}
