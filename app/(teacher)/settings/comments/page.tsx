import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { createSupabaseServerClient, getCurrentUser } from "@/lib/supabase/server";
import { CommentBankEditor } from "./editor";

export async function generateMetadata() {
  const t = await getTranslations("bank");
  return { title: t("title") };
}

export default async function CommentBankPage() {
  const t = await getTranslations();
  const supabase = await createSupabaseServerClient();
  const user = await getCurrentUser();
  const { data } = await supabase
    .from("comment_bank")
    .select("id, text, locale, subject, tags, uses, source")
    .eq("teacher_id", user!.id)
    .order("uses", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(500);
  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/settings"
        className="inline-flex min-h-11 items-center gap-1 self-start text-sm text-ink-muted hover:text-ink"
      >
        <ArrowLeft aria-hidden className="size-4" /> {t("settings.title")}
      </Link>
      <div>
        <h1 className="font-serif text-4xl">{t("bank.title")}</h1>
        <p className="mt-1 max-w-prose text-ink-muted">{t("bank.intro")}</p>
      </div>
      <CommentBankEditor initial={(data ?? []) as Parameters<typeof CommentBankEditor>[0]["initial"]} />
    </div>
  );
}
