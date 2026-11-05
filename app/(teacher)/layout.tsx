import { LogOut } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Wordmark } from "@/components/brand";
import { LanguageSwitcher } from "@/components/language-switcher";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { signOut } from "@/lib/actions/auth";
import { isSupabaseConfigured } from "@/lib/env";
import { getCurrentUser } from "@/lib/supabase/server";

export default async function TeacherLayout({ children }: LayoutProps<"/">) {
  if (!isSupabaseConfigured()) redirect("/setup");
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const t = await getTranslations("common");

  return (
    <div className="relative z-10 flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-2 focus:rounded-lg focus:bg-card focus:px-3 focus:py-2"
      >
        {t("skipToContent")}
      </a>
      <header className="sticky top-0 z-20 border-b border-rule bg-paper/90 backdrop-blur">
        <nav aria-label={t("mainNav")} className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
          <Link href="/" className="rounded-lg">
            <Wordmark />
          </Link>
          <div className="flex items-center gap-1">
            <LanguageSwitcher />
            <ThemeToggle />
            <form action={signOut}>
              <Button type="submit" variant="ghost" size="icon" aria-label={t("signOut")} title={t("signOut")}>
                <LogOut aria-hidden />
              </Button>
            </form>
          </div>
        </nav>
      </header>
      <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">
        {children}
      </main>
    </div>
  );
}
