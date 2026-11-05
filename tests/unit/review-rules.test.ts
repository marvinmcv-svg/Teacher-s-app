import { describe, expect, it } from "vitest";
import {
  blockingItems,
  canApprove,
  effectiveTotal,
  greenSampleRequired,
  isDeduction,
} from "@/lib/grading/review-rules";

const item = (
  band: "high" | "medium" | "low",
  ai: number,
  max: number,
  extra: Partial<{ teacher_score: number | null; acknowledged_at: string | null }> = {},
) => ({
  confidence_band: band,
  ai_score: ai,
  ai_max: max,
  teacher_score: null,
  acknowledged_at: null,
  ...extra,
});

describe("review gating (§3.4)", () => {
  it("red and orange items block approval until touched", () => {
    const items = [item("high", 2, 2), item("medium", 1, 2), item("low", 0, 3)];
    expect(blockingItems(items)).toHaveLength(2);
    expect(canApprove(items, [], false)).toEqual({ ok: false, reason: "unreviewed" });
    items[1].acknowledged_at = "now";
    items[2].teacher_score = 1;
    expect(canApprove(items, [], false)).toEqual({ ok: true });
  });
  it("wellbeing flag needs explicit acknowledgement", () => {
    expect(canApprove([item("high", 1, 1)], ["wellbeing_review"], false)).toEqual({ ok: false, reason: "wellbeing" });
    expect(canApprove([item("high", 1, 1)], ["wellbeing_review"], true).ok).toBe(true);
  });
  it("deductions are detected on the effective score", () => {
    expect(isDeduction(item("high", 1, 2))).toBe(true);
    expect(isDeduction(item("high", 1, 2, { teacher_score: 2 }))).toBe(false);
  });
  it("green sample: 10%, minimum 2, never more than available", () => {
    expect(greenSampleRequired(0, 10)).toBe(0);
    expect(greenSampleRequired(1, 10)).toBe(1);
    expect(greenSampleRequired(15, 10)).toBe(2);
    expect(greenSampleRequired(35, 10)).toBe(4);
  });
  it("effective total uses teacher overrides", () => {
    expect(effectiveTotal([item("high", 2, 2), item("low", 0, 3, { teacher_score: 2 })])).toEqual({ score: 4, max: 5 });
  });
});
