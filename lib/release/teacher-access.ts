import "server-only";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** Teacher-side export guard: the user-scoped (RLS) client must be able to see the row. */
export async function teacherCanSeeSubmission(submissionId: string) {
  if (!z.uuid().safeParse(submissionId).success) return false;
  const supabase = await createSupabaseServerClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return false;
  const { data } = await supabase.from("submissions").select("id").eq("id", submissionId).maybeSingle();
  return !!data;
}
