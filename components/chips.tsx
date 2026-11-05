import { AlertTriangle, CheckCircle2, CircleDot, Eye } from "lucide-react";
import { cn } from "@/lib/utils";

type Band = "high" | "medium" | "low";
const BAND_STYLE: Record<Band, { cls: string; Icon: typeof CheckCircle2 }> = {
  high: { cls: "border-pen-green/40 text-pen-green", Icon: CheckCircle2 },
  medium: { cls: "border-pen-amber/50 text-pen-amber", Icon: Eye },
  low: { cls: "border-pen-red/50 text-pen-red", Icon: AlertTriangle },
};

/** Traffic-light confidence (§3.4). Never colour alone: icon + text. */
export function ConfidenceChip({ band, label, className }: { band: Band; label: string; className?: string }) {
  const { cls, Icon } = BAND_STYLE[band];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border bg-card px-2 py-0.5 text-xs font-medium",
        cls,
        className,
      )}
    >
      <Icon aria-hidden className="size-3.5" />
      {label}
    </span>
  );
}

export function StatusChip({
  label,
  tone = "neutral",
  className,
}: {
  label: string;
  tone?: "neutral" | "busy" | "good" | "warn";
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs",
        tone === "busy" && "border-pen-blue/40 text-pen-blue",
        tone === "good" && "border-pen-green/40 text-pen-green",
        tone === "warn" && "border-pen-red/40 text-pen-red",
        tone === "neutral" && "border-rule text-ink-muted",
        className,
      )}
    >
      {tone === "busy" && <CircleDot aria-hidden className="size-3 animate-pulse motion-reduce:animate-none" />}
      {label}
    </span>
  );
}
