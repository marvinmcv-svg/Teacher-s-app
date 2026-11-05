"use client";
import { Monitor, Moon, Sun } from "lucide-react";
import { useTranslations } from "next-intl";
import { useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";

type Theme = "system" | "light" | "dark";
const ORDER: Theme[] = ["system", "light", "dark"];

const listeners = new Set<() => void>();
function subscribe(cb: () => void) {
  listeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}

function readTheme(): Theme {
  try {
    const t = localStorage.getItem("tinta-theme");
    return t === "light" || t === "dark" ? t : "system";
  } catch {
    return "system";
  }
}

export function ThemeToggle() {
  const t = useTranslations("common");
  const theme = useSyncExternalStore(subscribe, readTheme, () => "system" as Theme);

  function cycle() {
    const next = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length];
    try {
      if (next === "system") localStorage.removeItem("tinta-theme");
      else localStorage.setItem("tinta-theme", next);
    } catch {
      /* storage unavailable: theme still applies for this page view */
    }
    if (next === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = next;
    for (const l of listeners) l();
  }

  const label = { system: t("themeSystem"), light: t("themeLight"), dark: t("themeDark") }[theme];
  const Icon = { system: Monitor, light: Sun, dark: Moon }[theme];
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={cycle}
      aria-label={`${t("theme")}: ${label}`}
      title={`${t("theme")}: ${label}`}
    >
      <Icon aria-hidden />
    </Button>
  );
}
