"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { isLocale } from "@/lib/i18n/config";
import { MAX_ROSTER_SIZE, parseRoster } from "@/lib/roster/parse";
import { createSupabaseServerClient } from "@/lib/supabase/server";

async function requireTeacher() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");
  return { supabase, user: data.user };
}

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v.length ? v : null));

const createClassSchema = z.object({
  name: z.string().trim().min(1).max(120),
  grade_level: optionalText(60),
  subject: optionalText(60),
  locale: z.string().refine(isLocale),
});

export type CreateClassState = { error: "nameRequired" | "createError" | null };

export async function createClass(_prev: CreateClassState, formData: FormData): Promise<CreateClassState> {
  const parsed = createClassSchema.safeParse({
    name: formData.get("name") ?? "",
    grade_level: formData.get("grade_level") ?? "",
    subject: formData.get("subject") ?? "",
    locale: formData.get("locale") ?? "es",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues.some((i) => i.path[0] === "name") ? "nameRequired" : "createError" };
  }
  const { supabase, user } = await requireTeacher();
  const { data, error } = await supabase
    .from("classes")
    .insert({ ...parsed.data, locale: parsed.data.locale as "es" | "en", teacher_id: user.id })
    .select("id")
    .single();
  if (error || !data) {
    console.error("classes.create_failed", { code: error?.code });
    return { error: "createError" };
  }
  revalidatePath("/");
  redirect(`/classes/${data.id}`);
}

export type AddStudentsState =
  | { status: "idle" }
  | { status: "added"; added: number; skipped: number }
  | { status: "nothing"; skipped: number }
  | { status: "tooMany"; max: number }
  | { status: "error" };

const uuid = z.uuid();

export async function addStudents(_prev: AddStudentsState, formData: FormData): Promise<AddStudentsState> {
  const classId = uuid.safeParse(formData.get("class_id"));
  if (!classId.success) return { status: "error" };

  let raw = String(formData.get("roster_text") ?? "");
  const file = formData.get("roster_file");
  if (file instanceof File && file.size > 0) {
    if (file.size > 512 * 1024) return { status: "tooMany", max: MAX_ROSTER_SIZE };
    raw = await file.text();
  }

  const { supabase } = await requireTeacher();
  // RLS limits this to classes the teacher can access; empty result = no access.
  const { data: existing, error: readErr } = await supabase
    .from("students")
    .select("display_name, class_id")
    .eq("class_id", classId.data)
    .eq("active", true);
  if (readErr) return { status: "error" };

  const { students, skipped } = parseRoster(
    raw,
    (existing ?? []).map((s) => s.display_name),
  );
  if (students.length === 0) return { status: "nothing", skipped: skipped.length };
  if (students.length > MAX_ROSTER_SIZE) return { status: "tooMany", max: MAX_ROSTER_SIZE };

  const { error } = await supabase
    .from("students")
    .insert(students.map((s) => ({ class_id: classId.data, display_name: s.displayName, external_id: s.externalId })));
  if (error) {
    console.error("students.insert_failed", { code: error.code });
    return { status: "error" };
  }
  revalidatePath(`/classes/${classId.data}`);
  revalidatePath("/");
  return { status: "added", added: students.length, skipped: skipped.length };
}

/** Soft-remove (active = false) so it can be undone (§4 "undo for every destructive action"). */
export async function setStudentActive(studentId: string, classId: string, active: boolean) {
  const sid = uuid.safeParse(studentId);
  const cid = uuid.safeParse(classId);
  if (!sid.success || !cid.success) return { ok: false };
  const { supabase } = await requireTeacher();
  const { error } = await supabase.from("students").update({ active }).eq("id", sid.data).eq("class_id", cid.data);
  if (error) return { ok: false };
  revalidatePath(`/classes/${cid.data}`);
  revalidatePath("/");
  return { ok: true };
}
