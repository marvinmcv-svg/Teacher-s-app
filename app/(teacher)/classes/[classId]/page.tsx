import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { RosterImport } from "./roster-import";
import { StudentList } from "./student-list";

export default async function ClassPage({ params }: PageProps<"/classes/[classId]">) {
  const { classId } = await params;
  if (!z.uuid().safeParse(classId).success) notFound();
  const t = await getTranslations();
  const supabase = await createSupabaseServerClient();
  const [{ data: cls }, { data: students }] = await Promise.all([
    supabase.from("classes").select("id, name, grade_level, subject").eq("id", classId).maybeSingle(),
    supabase
      .from("students")
      .select("id, display_name, external_id, active")
      .eq("class_id", classId)
      .order("display_name", { ascending: true }),
  ]);
  if (!cls) notFound();
  const active = (students ?? []).filter((s) => s.active);
  const inactive = (students ?? []).filter((s) => !s.active);

  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/"
        className="inline-flex min-h-11 items-center gap-1 self-start text-sm text-ink-muted hover:text-ink"
      >
        <ArrowLeft aria-hidden className="size-4" /> {t("common.back")}
      </Link>
      <div>
        <h1 className="font-serif text-4xl">{cls.name}</h1>
        <p className="text-ink-muted">{[cls.grade_level, cls.subject].filter(Boolean).join(" · ")}</p>
      </div>
      <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
        <Card>
          <CardHeader className="flex-row items-baseline justify-between">
            <CardTitle>{t("roster.title")}</CardTitle>
            <span className="tabular text-sm text-ink-muted" data-testid="student-count">
              {t("roster.count", { count: active.length })}
            </span>
          </CardHeader>
          <CardContent>
            <StudentList classId={cls.id} active={active} inactive={inactive} />
          </CardContent>
        </Card>
        <Card className="self-start">
          <CardHeader>
            <CardTitle>{t("roster.addTitle")}</CardTitle>
          </CardHeader>
          <CardContent>
            <RosterImport classId={cls.id} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
