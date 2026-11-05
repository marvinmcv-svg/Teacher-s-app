"use client";
import { Languages } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useId, useTransition } from "react";
import { setLocale } from "@/lib/actions/locale";
import { cn } from "@/lib/utils";

const LABELS = { es: "Español", en: "English" } as const;

export function LanguageSwitcher({ className }: { className?: string }) {
  const t = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const id = useId();
  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      <label htmlFor={id} className="sr-only">
        {t("language")}
      </label>
      <Languages aria-hidden className="size-4 text-ink-muted" />
      <select
        id={id}
        data-testid="language-switcher"
        value={locale}
        disabled={pending}
        onChange={(e) => {
          const next = e.target.value;
          startTransition(async () => {
            await setLocale(next);
            router.refresh();
          });
        }}
        className="min-h-11 rounded-lg bg-transparent px-1 text-sm text-ink"
      >
        {Object.entries(LABELS).map(([value, label]) => (
          <option key={value} value={value} lang={value}>
            {label}
          </option>
        ))}
      </select>
    </div>
  );
}
