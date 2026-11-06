import { describe, expect, it } from "vitest";
import { EMPTY_KEY, buildClusters, normaliseAnswer } from "@/lib/grading/clusters";

describe("normaliseAnswer", () => {
  it("merges writing differences, not values", () => {
    expect(normaliseAnswer("\\frac{3}{4}", "numeric")).toBe("3/4");
    expect(normaliseAnswer(" 3 / 4 .", "numeric")).toBe("3/4");
    expect(normaliseAnswer("$\\dfrac{3}{4}$", "numeric")).toBe("3/4");
    expect(normaliseAnswer("0,75", "numeric")).toBe("0.75");
    expect(normaliseAnswer("0.75", "numeric")).not.toBe(normaliseAnswer("3/4", "numeric"));
    expect(normaliseAnswer("x = 7", "short_answer")).toBe("x=7");
    expect(normaliseAnswer("Respuesta: 12", "numeric")).toBe("12");
    expect(normaliseAnswer("Fotosíntesis", "short_answer")).toBe(normaliseAnswer("fotosintesis", "short_answer"));
  });
  it("reads multiple-choice letters", () => {
    for (const s of ["b", "B)", "(b)", "b. 24", "B "]) expect(normaliseAnswer(s, "multiple_choice")).toBe("b");
  });
  it("treats blanks and illegible as empty", () => {
    expect(normaliseAnswer("", "numeric")).toBe(EMPTY_KEY);
    expect(normaliseAnswer("[illegible]", "numeric")).toBe(EMPTY_KEY);
  });
});

describe("buildClusters", () => {
  it("groups, sorts by size and keeps the most common spelling", () => {
    const a = (id: string, text: string | null, status = "answered") => ({
      answerId: id,
      submissionId: `s${id}`,
      text,
      status,
    });
    const out = buildClusters(
      [a("1", "3/4"), a("2", "\\frac{3}{4}"), a("3", "3/4"), a("4", "0.75"), a("5", null, "no_answer")],
      "numeric",
    );
    expect(out.map((c) => [c.key, c.display, c.members.length])).toEqual([
      ["3/4", "3/4", 3],
      ["0.75", "0.75", 1],
      [EMPTY_KEY, "", 1],
    ]);
  });
});
