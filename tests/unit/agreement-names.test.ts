import { describe, expect, it } from "vitest";
import { agreementSummary, blindAgreement, pickForBlindCheck } from "@/lib/grading/agreement";
import { scrubNames } from "@/lib/privacy/names";

describe("blindAgreement", () => {
  it("counts exact and within-tolerance agreement and flags harsh AI", () => {
    const r = blindAgreement([
      { key: "q1", teacher: 2, ai: 2, max: 2 },
      { key: "q2", teacher: 10, ai: 9, max: 10 }, // within 10%
      { key: "q3", teacher: 3, ai: 0, max: 3 }, // harsh
      { key: "c1", teacher: 4, ai: 2, max: 4, levelStep: 2 }, // one rubric level
    ]);
    expect(r.items.map((i) => [i.exact, i.within, i.harsh])).toEqual([
      [true, true, false],
      [false, true, true],
      [false, false, true],
      [false, true, true],
    ]);
    expect(r.exactRate).toBe(0.25);
    expect(r.withinRate).toBe(0.75);
  });
  it("summarises weighted by items", () => {
    expect(
      agreementSummary([
        { n_items: 3, exact_rate: 1, within_rate: 1 },
        { n_items: 1, exact_rate: 0, within_rate: 0 },
      ]),
    ).toEqual({ checks: 2, items: 4, exact: 0.75, within: 0.75 });
    expect(agreementSummary([])).toBeNull();
  });
  it("never picks wellbeing papers and respects the rate", () => {
    expect(pickForBlindCheck(10, 0.05, [])).toBe(true);
    expect(pickForBlindCheck(10, 0.5, [])).toBe(false);
    expect(pickForBlindCheck(0, 0, [])).toBe(false);
    expect(pickForBlindCheck(50, 0, ["wellbeing_review"])).toBe(false);
  });
});

describe("scrubNames", () => {
  const roster = ["Ana Pérez", "Luis Mamani", "Bo"];
  it("removes full names and name parts, accent-insensitively", () => {
    expect(scrubNames("¡Muy bien, Ana! Luis también.", roster)).toBe("¡Muy bien, [student]! [student] también.");
    expect(scrubNames("ana perez lo hizo", roster)).toBe("[student] lo hizo");
    expect(scrubNames("Perez", roster)).toBe("[student]");
  });
  it("leaves words that merely contain a name and very short names alone", () => {
    expect(scrubNames("Anaconda y bonito", roster)).toBe("Anaconda y bonito");
  });
});
