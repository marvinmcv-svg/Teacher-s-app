import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ScanScreen } from "./scan-screen";

export async function generateMetadata() {
  const t = await getTranslations("scan");
  return { title: t("title") };
}

export default async function ScanPage({ params }: PageProps<"/assignments/[assignmentId]/scan">) {
  const { assignmentId } = await params;
  if (!z.uuid().safeParse(assignmentId).success) notFound();
  const supabase = await createSupabaseServerClient();
  const { data: a } = await supabase
    .from("assignments")
    .select("id, title, class_id")
    .eq("id", assignmentId)
    .maybeSingle();
  if (!a) notFound();
  const [{ data: roster }, { data: subs }] = await Promise.all([
    supabase
      .from("students")
      .select("id, display_name")
      .eq("class_id", a.class_id)
      .eq("active", true)
      .order("display_name"),
    supabase.from("submissions").select("student_id").eq("assignment_id", a.id).not("student_id", "is", null),
  ]);
  return (
    <ScanScreen
      assignment={{ id: a.id, title: a.title }}
      roster={roster ?? []}
      scannedIds={(subs ?? []).map((s) => s.student_id!)}
    />
  );
}
