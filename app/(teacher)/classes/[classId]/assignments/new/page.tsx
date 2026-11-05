import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { RUBRIC_TEMPLATES } from "@/lib/grading/templates";
import { AssignmentWizard } from "./wizard";

export async function generateMetadata() {
  const t = await getTranslations("assignments");
  return { title: t("newTitle") };
}

export default async function NewAssignmentPage({ params }: PageProps<"/classes/[classId]/assignments/new">) {
  const { classId } = await params;
  if (!z.uuid().safeParse(classId).success) notFound();
  const supabase = await createSupabaseServerClient();
  const { data: cls } = await supabase
    .from("classes")
    .select("id, name, subject, grade_level, locale")
    .eq("id", classId)
    .maybeSingle();
  if (!cls) notFound();
  const t = await getTranslations();
  const locale = (await getLocale()) as "es" | "en";
  const templates = RUBRIC_TEMPLATES.map((tpl) => ({
    id: tpl.id,
    title: tpl.title[locale],
    criteria: tpl.criteria[cls.locale],
  }));
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <Link
        href={`/classes/${cls.id}`}
        className="inline-flex min-h-11 items-center gap-1 self-start text-sm text-ink-muted hover:text-ink"
      >
        <ArrowLeft aria-hidden className="size-4" /> {cls.name}
      </Link>
      <h1 className="font-serif text-4xl">{t("assignments.newTitle")}</h1>
      <AssignmentWizard
        classId={cls.id}
        defaults={{ subject: cls.subject ?? "", gradeLevel: cls.grade_level ?? "", feedbackLocale: cls.locale }}
        templates={templates}
      />
    </div>
  );
}
