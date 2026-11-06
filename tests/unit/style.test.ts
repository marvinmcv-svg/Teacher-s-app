import { describe, expect, it } from "vitest";
import { medianWords, renderStyleProfile, strictnessByScope, type StoredProfile } from "@/lib/style/profile";

describe("style profile (computed parts)", () => {
  it("measures strictness per scope as % of max, ignoring thin scopes", () => {
    const out = strictnessByScope([
      { scope: "type:numeric", before: 0, after: 1, max: 2 },
      { scope: "type:numeric", before: 2, after: 2, max: 2 },
      { scope: "type:numeric", before: 1, after: 2, max: 2 },
      { scope: "rubric:organizacion", before: 4, after: 3, max: 4 },
    ]);
    expect(out).toEqual([{ scope: "type:numeric", delta_pct: 33.3, n: 3 }]);
  });
  it("median comment length in words", () => {
    expect(medianWords(["Muy bien", "Revisa el signo aquí", "¡Bien!"])).toBe(2);
    expect(medianWords([])).toBeNull();
  });
  it("renders a prompt block with measured strictness", () => {
    const p: StoredProfile = {
      summary: "Breve y cálida.",
      preferred_phrases: ["¡Vas bien!"],
      avoid_phrases: ["Excelente trabajo"],
      typical_length: "short",
      tone: "cálido",
      praise_style: "específico",
      correction_style: "pregunta guía",
      strictness: [
        { scope: "type:numeric", delta_pct: 20, n: 5 },
        { scope: "type:other", delta_pct: 2, n: 9 },
      ],
      comment_words_median: 7,
      edits_considered: 30,
    };
    const text = renderStyleProfile(p)!;
    expect(text).toContain("Never write: Excelente trabajo");
    expect(text).toContain("type:numeric: more lenient than the AI by 20% of max (n=5)");
    expect(text).not.toContain("type:other"); // below the 5% noise floor
    expect(renderStyleProfile(null)).toBeNull();
  });
});
