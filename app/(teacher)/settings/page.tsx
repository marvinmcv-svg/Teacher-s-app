import { ChevronRight, EyeOff, MessageSquareText, PenLine } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { agreementSummary } from "@/lib/grading/agreement";
import { createSupabaseServerClient, getCurrentUser } from "@/lib/supabase/server";
import { BlindCheckRate } from "./blind-check-rate";

export async function generateMetadata() {
  const t = await getTranslations("settings");
  return { title: t("title") };
}

export default async function SettingsPage() {
  const t = await getTranslations("settings");
  const supabase = await createSupabaseServerClient();
  const user = await getCurrentUser();
  const [{ data: teacher }, { data: checks }] = await Promise.all([
    supabase.from("teachers").select("blind_check_pct").eq("id", user!.id).maybeSingle(),
    supabase.from("blind_checks").select("n_items, exact_rate, within_rate").eq("teacher_id", user!.id),
  ]);
  const summary = agreementSummary(
    (checks ?? []).map((c) => ({ ...c, exact_rate: Number(c.exact_rate), within_rate: Number(c.within_rate) })),
  );
  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-serif text-4xl">{t("title")}</h1>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <EyeOff aria-hidden className="size-5" /> {t("blindTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="max-w-prose text-sm text-ink-muted">{t("blindHint")}</p>
          <BlindCheckRate initial={teacher?.blind_check_pct ?? 0} />
          {summary && (
            <p className="text-sm">
              {t("agreement", {
                within: Math.round(summary.within * 100),
                checks: summary.checks,
                items: summary.items,
              })}
            </p>
          )}
        </CardContent>
      </Card>
      <ul className="grid gap-3 sm:grid-cols-2">
        {[
          { href: "/settings/comments", Icon: MessageSquareText, title: t("commentsTitle"), hint: t("commentsHint") },
          { href: "/settings/style", Icon: PenLine, title: t("styleTitle"), hint: t("styleHint") },
        ].map(({ href, Icon, title, hint }) => (
          <li key={href}>
            <Link href={href} className="block rounded-[var(--radius-card)]">
              <Card className="flex items-center justify-between gap-3 p-4 hover:border-ink-muted">
                <span className="flex items-start gap-2">
                  <Icon aria-hidden className="mt-0.5 size-5 shrink-0 text-ink-muted" />
                  <span>
                    <span className="block font-medium">{title}</span>
                    <span className="block text-sm text-ink-muted">{hint}</span>
                  </span>
                </span>
                <ChevronRight aria-hidden className="size-5 shrink-0 text-ink-muted" />
              </Card>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
