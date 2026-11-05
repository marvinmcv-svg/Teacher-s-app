import { ArrowLeft, ChevronRight, Plus } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { StatusChip } from "@/components/chips";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { RosterImport } from "./roster-import";
import { StudentList } from "./student-list";

export default async function ClassPage({ params }: PageProps<"/classes/[classId]">) {
  const { classId } = await params;
  if (!z.uuid().safeParse(classId).success) notFound();
  const t = await getTranslations();
  const supabase = await createSupabaseServerClient();
  const [{ data: cls }, { data: students }, { data: assignments }] = await Promise.all([
    supabase.from("classes").select("id, name, grade_level, subject").eq("id", classId).maybeSingle(),
    supabase
      .from("students")
      .select("id, display_name, external_id, active")
      .eq("class_id", classId)
      .order("display_name", { ascending: true }),
    supabase
      .from("assignments")
      .select("id, title, status, created_at")
      .eq("class_id", classId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false }),
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
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-4xl">{cls.name}</h1>
          <p className="text-ink-muted">{[cls.grade_level, cls.subject].filter(Boolean).join(" · ")}</p>
        </div>
        <Button asChild size="lg">
          <Link href={`/classes/${cls.id}/assignments/new`}>
            <Plus aria-hidden /> {t("hub.newAssignment")}
          </Link>
        </Button>
      </div>
      <section aria-labelledby="assignments-heading" className="flex flex-col gap-3">
        <h2 id="assignments-heading" className="text-sm font-medium uppercase tracking-wide text-ink-muted">
          {t("hub.assignments")}
        </h2>
        {!assignments?.length ? (
          <Card className="p-5 text-ink-muted">{t("hub.noAssignments")}</Card>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {assignments.map((a) => (
              <li key={a.id}>
                <Link href={`/assignments/${a.id}`} className="block rounded-[var(--radius-card)]">
                  <Card className="flex items-center justify-between gap-3 p-4 transition-colors hover:border-ink-muted">
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{a.title}</span>
                      <StatusChip label={t(`assignments.status.${a.status}`)} className="mt-1" />
                    </span>
                    <ChevronRight aria-hidden className="size-5 shrink-0 text-ink-muted" />
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
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
