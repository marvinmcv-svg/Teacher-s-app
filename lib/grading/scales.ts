import { z } from "zod";

/**
 * Grading scales (§3.1, §1.3 #8). Every numeric scale stores min, max,
 * pass_mark and decimals. Level scales (e.g. "AD/A/B/C", "Logrado / En
 * proceso / Inicio") store ordered levels, best first, each with the minimum
 * percentage that earns it.
 *
 * Internally every item is scored in points; the assignment total is mapped
 * onto the scale from the percentage of points earned.
 */
export const LevelSchema = z.object({
  label: z.string().trim().min(1).max(40),
  min_pct: z.number().min(0).max(100),
});

export const ScaleSchema = z
  .discriminatedUnion("type", [
    z.object({
      type: z.literal("numeric"),
      preset: z.string().max(40),
      min: z.number(),
      max: z.number(),
      pass_mark: z.number(),
      decimals: z.number().int().min(0).max(2),
    }),
    z.object({
      type: z.literal("levels"),
      preset: z.string().max(40),
      levels: z.array(LevelSchema).min(2).max(8),
      /** lowest level label that counts as passing */
      pass_level: z.string(),
    }),
  ])
  .superRefine((s, ctx) => {
    if (s.type === "numeric") {
      if (!(s.max > s.min)) ctx.addIssue({ code: "custom", message: "max must be greater than min", path: ["max"] });
      if (s.pass_mark < s.min || s.pass_mark > s.max)
        ctx.addIssue({ code: "custom", message: "pass mark must be within the scale", path: ["pass_mark"] });
    } else {
      const pcts = s.levels.map((l) => l.min_pct);
      for (let i = 1; i < pcts.length; i++) {
        if (!(pcts[i] < pcts[i - 1]))
          ctx.addIssue({ code: "custom", message: "levels must be ordered best first", path: ["levels", i] });
      }
      if (pcts[pcts.length - 1] !== 0)
        ctx.addIssue({ code: "custom", message: "lowest level must start at 0%", path: ["levels"] });
      if (!s.levels.some((l) => l.label === s.pass_level))
        ctx.addIssue({ code: "custom", message: "pass level must be one of the levels", path: ["pass_level"] });
    }
  });

export type Scale = z.infer<typeof ScaleSchema>;

export const SCALE_PRESETS = {
  bo_100: { type: "numeric", preset: "bo_100", min: 1, max: 100, pass_mark: 51, decimals: 0 },
  cl_7: { type: "numeric", preset: "cl_7", min: 1, max: 7, pass_mark: 4, decimals: 1 },
  pe_20: { type: "numeric", preset: "pe_20", min: 0, max: 20, pass_mark: 11, decimals: 0 },
  ten: { type: "numeric", preset: "ten", min: 1, max: 10, pass_mark: 6, decimals: 1 },
  percent: { type: "numeric", preset: "percent", min: 0, max: 100, pass_mark: 60, decimals: 0 },
  pe_ad: {
    type: "levels",
    preset: "pe_ad",
    levels: [
      { label: "AD", min_pct: 90 },
      { label: "A", min_pct: 70 },
      { label: "B", min_pct: 50 },
      { label: "C", min_pct: 0 },
    ],
    pass_level: "A",
  },
  logro: {
    type: "levels",
    preset: "logro",
    levels: [
      { label: "Logrado", min_pct: 75 },
      { label: "En proceso", min_pct: 50 },
      { label: "Inicio", min_pct: 0 },
    ],
    pass_level: "Logrado",
  },
  letter: {
    type: "levels",
    preset: "letter",
    levels: [
      { label: "A", min_pct: 90 },
      { label: "B", min_pct: 80 },
      { label: "C", min_pct: 70 },
      { label: "D", min_pct: 60 },
      { label: "F", min_pct: 0 },
    ],
    pass_level: "D",
  },
} as const satisfies Record<string, Scale>;

export type ScalePresetKey = keyof typeof SCALE_PRESETS;

function round(value: number, decimals: number) {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

export type ScaledResult = {
  display: string;
  value: number | null;
  label: string | null;
  passing: boolean;
  pct: number;
};

/** Map earned/possible points onto the assignment's scale. */
export function toScale(scale: Scale, earned: number, possible: number): ScaledResult {
  const pct = possible > 0 ? Math.min(100, Math.max(0, (earned / possible) * 100)) : 0;
  if (scale.type === "numeric") {
    const value = round(scale.min + ((scale.max - scale.min) * pct) / 100, scale.decimals);
    return {
      display: value.toFixed(scale.decimals),
      value,
      label: null,
      passing: value >= scale.pass_mark,
      pct,
    };
  }
  const level = scale.levels.find((l) => pct >= l.min_pct) ?? scale.levels[scale.levels.length - 1];
  const passIdx = scale.levels.findIndex((l) => l.label === scale.pass_level);
  const idx = scale.levels.indexOf(level);
  return { display: level.label, value: null, label: level.label, passing: idx <= passIdx, pct };
}

/** Percentage threshold below which an item/assignment is "failing" on this scale. */
export function passThresholdPct(scale: Scale): number {
  if (scale.type === "numeric") return ((scale.pass_mark - scale.min) / (scale.max - scale.min)) * 100;
  return scale.levels.find((l) => l.label === scale.pass_level)?.min_pct ?? 50;
}

export function describeScale(scale: Scale): string {
  if (scale.type === "numeric")
    return `numeric ${scale.min}–${scale.max}, pass mark ${scale.pass_mark}, ${scale.decimals} decimal(s)`;
  return `levels (best first): ${scale.levels.map((l) => `${l.label} ≥ ${l.min_pct}%`).join(", ")}; passing from ${scale.pass_level}`;
}
