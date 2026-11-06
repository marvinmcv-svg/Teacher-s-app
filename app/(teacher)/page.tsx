import { ChevronRight, Plus, Users } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { createSupabaseServerClient, getCurrentUser } from "@/lib/supabase/server";

export default async function HomePage() {
  const t = await getTranslations("home");
  const supabase = await createSupabaseServerClient();
  const user = await getCurrentUser();
  const [{ data: teacher }, { data: classes }, { data: students }] = await Promise.all([
    supabase.from("teachers").select("display_name").eq("id", user!.id).maybeSingle(),
    supabase
      .from("classes")
      .select("id, name, grade_level, subject")
      .eq("archived", false)
      .order("created_at", { ascending: true }),
    supabase.from("students").select("class_id").eq("active", true),
  ]);
  const counts = new Map<string, number>();
  for (const s of students ?? []) counts.set(s.class_id, (counts.get(s.class_id) ?? 0) + 1);
  const firstName = teacher?.display_name?.split(" ")[0];

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-4xl">
            {firstName ? t("greeting", { name: firstName }) : t("greetingAnonymous")}
          </h1>
          <p className="mt-1 text-ink-muted">{t("nextUp")}</p>
        </div>
        <Button asChild size="lg">
          <Link href="/classes/new">
            <Plus aria-hidden /> {t("newClass")}
          </Link>
        </Button>
      </div>

      <section aria-labelledby="classes-heading" className="flex flex-col gap-3">
        <h2 id="classes-heading" className="text-sm font-medium uppercase tracking-wide text-ink-muted">
          {t("classesTitle")}
        </h2>
        {!classes || classes.length === 0 ? (
          <Card className="flex flex-col items-start gap-3 p-6">
            <Users aria-hidden className="size-8 text-ink-muted" />
            <p className="font-serif text-2xl">{t("noClasses")}</p>
            <p className="max-w-prose text-ink-muted">{t("noClassesHint")}</p>
            <Button asChild>
              <Link href="/classes/new">
                <Plus aria-hidden /> {t("newClass")}
              </Link>
            </Button>
          </Card>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {classes.map((c) => (
              <li key={c.id}>
                <Link href={`/classes/${c.id}`} className="block rounded-[var(--radius-card)]">
                  <Card className="flex items-center justify-between gap-3 p-4 transition-colors hover:border-ink-muted">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{c.name}</p>
                      <p className="truncate text-sm text-ink-muted">
                        {[c.grade_level, c.subject].filter(Boolean).join(" · ") || " "}
                      </p>
                      <p className="tabular mt-1 text-sm text-ink-muted">
                        {t("studentCount", { count: counts.get(c.id) ?? 0 })}
                      </p>
                    </div>
                    <ChevronRight aria-hidden className="size-5 shrink-0 text-ink-muted" />
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
