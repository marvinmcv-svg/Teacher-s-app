import { Check, CircleHelp, Pencil, Star, Waves, X } from "lucide-react";

export type PinKind = "correct" | "error" | "partial" | "unclear" | "praise" | "note";

/** Never colour alone: every kind has an icon + label (§5). */
export const PIN_STYLE: Record<PinKind, { Icon: typeof Check; fill: string; tint: string }> = {
  correct: { Icon: Check, fill: "bg-pen-green", tint: "bg-pen-green/15 border-pen-green" },
  error: { Icon: X, fill: "bg-pen-red", tint: "bg-pen-red/15 border-pen-red" },
  partial: { Icon: Waves, fill: "bg-pen-amber", tint: "bg-pen-amber/15 border-pen-amber" },
  unclear: { Icon: CircleHelp, fill: "bg-pen-blue", tint: "bg-pen-blue/15 border-pen-blue" },
  praise: { Icon: Star, fill: "bg-star", tint: "bg-star/15 border-star" },
  note: { Icon: Pencil, fill: "bg-pen-blue", tint: "bg-pen-blue/15 border-pen-blue" },
};

/**
 * Pin placement (§5: pins never cover the student's writing). Prefer the right
 * margin next to the answer (worksheets usually leave it empty); fall back to the
 * left margin when the answer runs to the right edge. Returns the pin centre (0–1).
 */
export function pinAnchor(r: { x: number; y: number; w: number; h: number }, gap = 0.045) {
  const right = r.x + r.w + gap;
  const x = right <= 0.97 ? right : Math.max(0.03, r.x - gap);
  return { x, y: r.y + r.h / 2 };
}
