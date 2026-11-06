import { describe, expect, it } from "vitest";
import { canApprove, effectiveTotal } from "@/lib/grading/review-rules";

describe("review rules", () => {
  it("only a wellbeing flag blocks approval until acknowledged", () => {
    expect(canApprove([], false)).toEqual({ ok: true });
    expect(canApprove(["possible_copying"], false)).toEqual({ ok: true });
    expect(canApprove(["wellbeing_review"], false)).toEqual({ ok: false, reason: "wellbeing" });
    expect(canApprove(["wellbeing_review"], true)).toEqual({ ok: true });
  });
  it("totals use the teacher's score when set", () => {
    expect(
      effectiveTotal([
        { ai_score: 2, teacher_score: null, ai_max: 2 },
        { ai_score: 0, teacher_score: 1, ai_max: 3 },
      ]),
    ).toEqual({ score: 3, max: 5 });
  });
});
