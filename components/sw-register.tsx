"use client";
import { useEffect } from "react";

/** Registers the service worker (installable PWA, offline fallback). `clearPrivate` drops cached teacher pages. */
export function ServiceWorkerRegister({ clearPrivate = false }: { clearPrivate?: boolean }) {
  useEffect(() => {
    if (!("serviceWorker" in navigator) || process.env.NODE_ENV !== "production") return;
    navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .then((reg) => {
        if (clearPrivate) (reg.active ?? navigator.serviceWorker.controller)?.postMessage("clear-private");
      })
      .catch(() => {});
  }, [clearPrivate]);
  return null;
}
