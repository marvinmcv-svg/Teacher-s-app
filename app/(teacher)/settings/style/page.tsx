import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { StoredProfile } from "@/lib/style/profile";
import { createSupabaseServerClient, getCurrentUser } from "@/lib/supabase/server";
import { StyleActions } from "./style-actions";

export async function generateMetadata() {
  const t = await getTranslations("style");
  return { title: t("title") };
}

export default async function StylePage() {
  const t = await getTranslations();
  const format = await getFormatter();
  const supabase = await createSupabaseServerClient();
  const user = await getCurrentUser();
  const [{ data: row }, { count: edits }] = await Promise.all([
    supabase
      .from("style_profiles")
      .select("profile, version, created_at")
      .eq("teacher_id", user!.id)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from("teacher_edits").select("id", { count: "exact", head: true }).eq("teacher_id", user!.id),
  ]);
  const p = row?.profile as StoredProfile | undefined;
  const scopeLabel = (scope: string) => {
    const [kind, key] = scope.split(":");
    return kind === "type" && t.has(`assignments.types.${key}`) ? t(`assignments.types.${key}`) : key;
  };
  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/settings"
        className="inline-flex min-h-11 items-center gap-1 self-start text-sm text-ink-muted hover:text-ink"
      >
        <ArrowLeft aria-hidden className="size-4" /> {t("settings.title")}
      </Link>
      <div>
        <h1 className="font-serif text-4xl">{t("style.title")}</h1>
        <p className="mt-1 max-w-prose text-ink-muted">{t("style.intro")}</p>
      </div>
      {!p ? (
        <Card className="p-6 text-ink-muted">{t("style.none", { edits: edits ?? 0 })}</Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>{t("style.version", { version: row!.version })}</CardTitle>
            <p className="text-sm text-ink-muted">
              {t("style.built", {
                date: format.dateTime(new Date(row!.created_at), { dateStyle: "medium" }),
                edits: p.edits_considered,
              })}
            </p>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            {p.summary && <p className="text-base">{p.summary}</p>}
            <dl className="grid gap-2 sm:grid-cols-[auto_1fr]">
              {p.tone && (
                <>
                  <dt className="text-ink-muted">{t("style.tone")}</dt>
                  <dd>{p.tone}</dd>
                </>
              )}
              {p.praise_style && (
                <>
                  <dt className="text-ink-muted">{t("style.praise")}</dt>
                  <dd>{p.praise_style}</dd>
                </>
              )}
              {p.correction_style && (
                <>
                  <dt className="text-ink-muted">{t("style.corrections")}</dt>
                  <dd>{p.correction_style}</dd>
                </>
              )}
              {p.comment_words_median && (
                <>
                  <dt className="text-ink-muted">{t("style.length")}</dt>
                  <dd>{t("style.words", { n: p.comment_words_median })}</dd>
                </>
              )}
              {p.preferred_phrases.length > 0 && (
                <>
                  <dt className="text-ink-muted">{t("style.likes")}</dt>
                  <dd className="font-hand text-lg">{p.preferred_phrases.join(" · ")}</dd>
                </>
              )}
              {p.avoid_phrases.length > 0 && (
                <>
                  <dt className="text-ink-muted">{t("style.avoids")}</dt>
                  <dd className="font-hand text-lg line-through decoration-pen-red/60">
                    {p.avoid_phrases.join(" · ")}
                  </dd>
                </>
              )}
            </dl>
            {p.strictness.length > 0 && (
              <div>
                <p className="font-medium">{t("style.strictness")}</p>
                <ul className="mt-1 flex flex-col gap-1">
                  {p.strictness.map((s) => (
                    <li key={s.scope}>
                      {scopeLabel(s.scope)}:{" "}
                      {s.delta_pct > 0
                        ? t("style.lenient", { pct: s.delta_pct, n: s.n })
                        : t("style.stricter", { pct: Math.abs(s.delta_pct), n: s.n })}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}
      <StyleActions hasProfile={!!p} />
    </div>
  );
}
