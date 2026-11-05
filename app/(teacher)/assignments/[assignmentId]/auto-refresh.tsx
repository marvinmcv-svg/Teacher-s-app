"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Polls while submissions are processing so progress chips stay honest (§4.2). */
export function AutoRefresh({ active, intervalMs = 4000 }: { active: boolean; intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(id);
  }, [active, intervalMs, router]);
  return null;
}
