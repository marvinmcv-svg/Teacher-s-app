"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { bankContext } from "./comment-bank-store";
import { requireTeacher } from "./helpers";

export type BankComment = { id: string; text: string; tags: string[]; uses: number; subject: string | null };

/** Quick-insert search for the review screen (§3.4): this teacher's bank, in the paper's feedback language. */
export async function searchCommentBank(submissionId: string, q: string): Promise<BankComment[]> {
  if (!z.uuid().safeParse(submissionId).success) return [];
  const { supabase, user } = await requireTeacher();
  const { locale, subject } = await bankContext(supabase, submissionId);
  let query = supabase
    .from("comment_bank")
    .select("id, text, tags, uses, subject")
    .eq("teacher_id", user.id)
    .eq("locale", locale)
    .order("uses", { ascending: false })
    .order("last_used_at", { ascending: false, nullsFirst: false })
    .limit(30);
  const term = q.trim().slice(0, 60);
  if (term) query = query.ilike("text", `%${term.replace(/[%_\\]/g, (c) => `\\${c}`)}%`);
  const { data } = await query;
  // Same-subject comments first, then the rest.
  return (data ?? []).sort((a, b) => Number(b.subject === subject) - Number(a.subject === subject)).slice(0, 8);
}

export async function markCommentUsed(id: string) {
  if (!z.uuid().safeParse(id).success) return;
  const { supabase } = await requireTeacher();
  const { data } = await supabase.from("comment_bank").select("uses").eq("id", id).maybeSingle();
  if (data)
    await supabase
      .from("comment_bank")
      .update({ uses: data.uses + 1, last_used_at: new Date().toISOString() })
      .eq("id", id);
}

const EntrySchema = z.object({
  text: z.string().trim().min(3).max(300),
  locale: z.enum(["es", "en"]),
  subject: z.string().trim().max(80).nullable(),
  tags: z.array(z.string().trim().min(1).max(40)).max(10),
});

export async function saveBankComment(id: string | null, input: z.input<typeof EntrySchema>) {
  const p = EntrySchema.safeParse(input);
  if (!p.success || (id && !z.uuid().safeParse(id).success)) return { ok: false as const, error: "invalid" as const };
  const { supabase, user } = await requireTeacher();
  const row = { ...p.data, tags: [...new Set(p.data.tags.map((t) => t.toLowerCase()))] };
  const { error } = id
    ? await supabase.from("comment_bank").update(row).eq("id", id)
    : await supabase.from("comment_bank").insert({ ...row, teacher_id: user.id, source: "teacher" });
  revalidatePath("/settings/comments");
  if (error)
    return { ok: false as const, error: error.code === "23505" ? ("duplicate" as const) : ("failed" as const) };
  return { ok: true as const };
}

export async function deleteBankComment(id: string) {
  if (!z.uuid().safeParse(id).success) return { ok: false };
  const { supabase } = await requireTeacher();
  const { error } = await supabase.from("comment_bank").delete().eq("id", id);
  revalidatePath("/settings/comments");
  return { ok: !error };
}
