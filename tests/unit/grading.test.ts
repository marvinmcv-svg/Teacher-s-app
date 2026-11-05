import { describe, expect, it } from "vitest";
import { agreementFactor, itemConfidence, submissionBand, toBand, type ItemSignals } from "@/lib/grading/confidence";
import { passThresholdPct, SCALE_PRESETS, ScaleSchema, toScale } from "@/lib/grading/scales";

describe("scales", () => {
  it("all presets validate", () => {
    for (const s of Object.values(SCALE_PRESETS)) expect(ScaleSchema.safeParse(s).success).toBe(true);
  });
  it("Bolivia 1–100, pass 51", () => {
    const s = SCALE_PRESETS.bo_100;
    expect(toScale(s, 10, 10)).toMatchObject({ display: "100", passing: true });
    expect(toScale(s, 5, 10)).toMatchObject({ value: 51, passing: true }); // 1 + 99*0.5 = 50.5 → 51
    expect(toScale(s, 4, 10).passing).toBe(false);
    expect(toScale(s, 0, 10).value).toBe(1);
  });
  it("Chile 1–7 with one decimal, pass 4.0", () => {
    expect(toScale(SCALE_PRESETS.cl_7, 6, 10)).toMatchObject({ display: "4.6", passing: true });
    expect(toScale(SCALE_PRESETS.cl_7, 4, 10)).toMatchObject({ display: "3.4", passing: false });
  });
  it("Peru AD/A/B/C levels", () => {
    expect(toScale(SCALE_PRESETS.pe_ad, 95, 100)).toMatchObject({ display: "AD", passing: true });
    expect(toScale(SCALE_PRESETS.pe_ad, 72, 100)).toMatchObject({ display: "A", passing: true });
    expect(toScale(SCALE_PRESETS.pe_ad, 60, 100)).toMatchObject({ display: "B", passing: false });
    expect(toScale(SCALE_PRESETS.pe_ad, 0, 100).display).toBe("C");
  });
  it("rejects malformed scales", () => {
    expect(
      ScaleSchema.safeParse({ type: "numeric", preset: "x", min: 10, max: 1, pass_mark: 5, decimals: 0 }).success,
    ).toBe(false);
    expect(
      ScaleSchema.safeParse({
        type: "levels",
        preset: "x",
        levels: [
          { label: "A", min_pct: 50 },
          { label: "B", min_pct: 60 },
        ],
        pass_level: "A",
      }).success,
    ).toBe(false);
  });
  it("pass threshold as a percentage", () => {
    expect(passThresholdPct(SCALE_PRESETS.bo_100)).toBeCloseTo(50.505, 2);
    expect(passThresholdPct(SCALE_PRESETS.pe_ad)).toBe(70);
  });
});

const base: ItemSignals = {
  ocrConfidences: [0.98, 0.97],
  pageLegibility: 0.95,
  mappingConfidence: 1,
  graderScore: 2,
  verifierScore: 2,
  max: 2,
  selfConfidence: 0.95,
  hasDiagram: false,
  passThresholdPct: 50,
};

describe("confidence (§8.4)", () => {
  it("agreement factor", () => {
    expect(agreementFactor({ graderScore: 4, verifierScore: 4, max: 10 })).toBe(1);
    expect(agreementFactor({ graderScore: 4, verifierScore: 5, max: 10 })).toBe(0.6); // 10% of 10
    expect(agreementFactor({ graderScore: 4, verifierScore: 6, max: 10 })).toBe(0.2);
    expect(agreementFactor({ graderScore: 3, verifierScore: 5, max: 12, levelStep: 2 })).toBe(0.6); // one rubric level
    expect(agreementFactor({ graderScore: 4, verifierScore: null, max: 10 })).toBe(0.9);
  });
  it("clean, agreed, full-marks item is high", () => {
    expect(toBand(itemConfidence(base))).toBe("high");
  });
  it("evidence is the min of OCR, legibility, mapping", () => {
    expect(itemConfidence({ ...base, ocrConfidences: [0.98, 0.5] })).toBeCloseTo(0.5 * 1 * 0.95, 3);
  });
  it("self confidence can only lower, floor 0.5", () => {
    expect(itemConfidence({ ...base, selfConfidence: 0.1 })).toBeCloseTo(0.95 * 0.5, 3);
  });
  it("diagrams are capped at 0.6", () => {
    expect(itemConfidence({ ...base, hasDiagram: true })).toBe(0.6);
  });
  it("zero / failing scores are never auto-green", () => {
    expect(toBand(itemConfidence({ ...base, graderScore: 0, verifierScore: 0 }))).toBe("medium");
    expect(itemConfidence({ ...base, graderScore: 0.5, verifierScore: 0.5 })).toBeLessThanOrEqual(0.84);
  });
  it("submission band rules", () => {
    expect(submissionBand(["high", "high"], [])).toBe("high");
    expect(submissionBand(["high", "low"], [])).toBe("low");
    expect(submissionBand(["high"], ["off_task"])).toBe("medium");
    expect(submissionBand(["high"], ["wellbeing_review"])).toBe("low");
    expect(submissionBand([], [])).toBe("low");
  });
});
