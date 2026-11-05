import { describe, expect, it } from "vitest";
import {
  agreement,
  anchorAccuracy,
  calibration,
  cer,
  consistency,
  iou,
  overCorrectionRate,
  quadraticWeightedKappa,
  regressionGate,
} from "@/lib/evals/metrics";

describe("eval metrics (§8.7)", () => {
  it("CER", () => {
    expect(cer([{ pred: "x = 7", truth: "x = 7" }])).toBe(0);
    expect(cer([{ pred: "x = 1", truth: "x = 7" }])).toBeCloseTo(1 / 5);
  });
  it("over-correction counts only student errors transcribed as the right answer", () => {
    const r = overCorrectionRate([
      { pred: "3/4", truth: "4/3", studentError: true, correctAnswers: ["3/4"] }, // over-corrected!
      { pred: "4/3", truth: "4/3", studentError: true, correctAnswers: ["3/4"] }, // faithful
      { pred: "3/4", truth: "3/4", studentError: false, correctAnswers: ["3/4"] }, // not an error
    ]);
    expect(r).toEqual({ rate: 0.5, n: 2, cases: 1 });
  });
  it("agreement, harsh vs lenient reported separately", () => {
    const a = agreement([
      { ai: 2, teacher: 2, max: 2 },
      { ai: 9, teacher: 10, max: 10 }, // harsh but within 10%
      { ai: 0, teacher: 3, max: 3 }, // harsh beyond tolerance
      { ai: 3, teacher: 2, max: 4, levelStep: 1 }, // lenient within one level
    ]);
    expect(a).toMatchObject({
      exact: 0.25,
      withinTolerance: 0.75,
      harsh: 0.5,
      lenient: 0.25,
      harshBeyondTolerance: 0.25,
      n: 4,
    });
  });
  it("QWK is 1 for perfect agreement and drops with disagreement", () => {
    const perfect = [0, 1, 2, 3, 4].map((v) => ({ ai: v, teacher: v, max: 4 }));
    expect(quadraticWeightedKappa(perfect)).toBeCloseTo(1);
    const off = [0, 1, 2, 3, 4].map((v) => ({ ai: 4 - v, teacher: v, max: 4 }));
    expect(quadraticWeightedKappa(off)).toBeLessThan(0);
  });
  it("calibration per band", () => {
    const c = calibration([
      { ai: 1, teacher: 1, max: 1, band: "high" },
      { ai: 0, teacher: 1, max: 1, band: "high" },
      { ai: 0, teacher: 0, max: 1, band: "low" },
    ]);
    expect(c.high).toEqual({ n: 2, share: 2 / 3, accuracy: 0.5 });
    expect(c.medium.n).toBe(0);
  });
  it("IoU and anchor accuracy", () => {
    expect(iou({ x: 0, y: 0, w: 1, h: 1 }, { x: 0, y: 0, w: 1, h: 1 })).toBe(1);
    expect(iou({ x: 0, y: 0, w: 0.5, h: 1 }, { x: 0.5, y: 0, w: 0.5, h: 1 })).toBe(0);
    const a = anchorAccuracy(
      [{ page: 1, box: { x: 0.1, y: 0.1, w: 0.4, h: 0.05 } }],
      [
        { page: 1, box: { x: 0.1, y: 0.1, w: 0.4, h: 0.05 } },
        { page: 2, box: { x: 0, y: 0, w: 1, h: 1 } },
      ],
    );
    expect(a.meanIoU).toBeCloseTo(1);
    expect(a).toMatchObject({ hitRate: 1, n: 1 });
  });
  it("consistency across runs", () => {
    expect(
      consistency(
        [
          [2, 3],
          [2, 3],
          [2, 3],
        ],
        [2, 3],
      ),
    ).toEqual({ meanStdPct: 0, itemsWithAnyChange: 0 });
    expect(
      consistency(
        [
          [2, 3],
          [2, 1],
        ],
        [2, 3],
      ).itemsWithAnyChange,
    ).toBe(0.5);
  });
  it("regression gate blocks drops > 2 points", () => {
    expect(regressionGate(0.9, 0.91).pass).toBe(true);
    expect(regressionGate(0.88, 0.91).pass).toBe(false);
    expect(regressionGate(0.5, null).pass).toBe(true);
  });
});
