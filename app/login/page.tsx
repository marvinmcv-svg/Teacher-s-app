import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { Wordmark } from "@/components/brand";
import { LanguageSwitcher } from "@/components/language-switcher";
import { ServiceWorkerRegister } from "@/components/sw-register";
import { ThemeToggle } from "@/components/theme-toggle";
import { Card, CardContent } from "@/components/ui/card";
import { isSupabaseConfigured } from "@/lib/env";
import { safeNextPath } from "@/lib/safe-redirect";
import { LoginForm } from "./login-form";

export async function generateMetadata() {
  const t = await getTranslations("login");
  return { title: t("title") };
}

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  if (!isSupabaseConfigured()) redirect("/setup");
  const t = await getTranslations("login");
  const sp = await searchParams;
  const next = safeNextPath(typeof sp.next === "string" ? sp.next : null);
  const error = typeof sp.error === "string" ? sp.error : null;

  return (
    <main className="relative z-10 mx-auto flex min-h-dvh w-full max-w-md flex-col px-4 py-6">
      {/* signed out → drop any cached teacher pages on this device */}
      <ServiceWorkerRegister clearPrivate />
      <div className="flex items-center justify-between">
        <Wordmark />
        <div className="flex items-center">
          <LanguageSwitcher />
          <ThemeToggle />
        </div>
      </div>
      <div className="flex flex-1 flex-col justify-center gap-6 py-10">
        <div className="flex flex-col gap-3">
          <h1 className="font-serif text-4xl leading-tight">{t("title")}</h1>
          <p className="text-ink-muted">{t("subtitle")}</p>
        </div>
        <Card>
          <CardContent>
            <LoginForm next={next} errorKey={error === "callback" ? "callbackError" : error ? "error" : null} />
          </CardContent>
        </Card>
        <p className="text-sm text-ink-muted">{t("privacyNote")}</p>
      </div>
    </main>
  );
}
