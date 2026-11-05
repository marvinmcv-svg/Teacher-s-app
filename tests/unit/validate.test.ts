import { describe, expect, it } from "vitest";
import type { Grade } from "@/lib/ai/schemas";
import { validateGrade, validateTranscription, validateVerification, type GradableItem } from "@/lib/ai/validate";

const items: GradableItem[] = [
  { key: "q1", kind: "question", max: 2 },
  { key: "q2", kind: "question", max: 3 },
];
const lines = new Set(["p1-l1", "p1-l2", "p2-l1"]);

const good: Grade = {
  items: [
    {
      question_key: "q1",
      criterion_key: null,
      score: 2,
      max: 2,
      level_label: null,
      evidence_line_keys: ["p1-l1"],
      rationale: "ok",
      confidence: 0.9,
      error_type: "none",
      misconception_tag: null,
    },
    {
      question_key: "q2",
      criterion_key: null,
      score: 1,
      max: 3,
      level_label: null,
      evidence_line_keys: ["p2-l1"],
      rationale: "sign error",
      confidence: 0.8,
      error_type: "computational",
      misconception_tag: "sign_error",
    },
  ],
  annotations: [
    { page_position: 1, kind: "correct", line_keys: ["p1-l1"], approx_bbox: null, text: "¡Bien!" },
    {
      page_position: 2,
      kind: "unclear",
      line_keys: [],
      approx_bbox: { x: 0.1, y: 0.2, w: 0.3, h: 0.1 },
      text: "Diagrama",
    },
  ],
  feedback: {
    glows: ["a"],
    grows: [{ point: "b", how: "c" }],
    next_step: "d",
    practice_item: null,
    summary_for_teacher: "e",
  },
  flags: [],
};

describe("validateGrade", () => {
  it("accepts a valid grade", () => {
    expect(validateGrade(good, items, lines, 2)).toEqual([]);
  });
  it("catches out-of-range scores, wrong max, unknown lines, missing items", () => {
    const bad: Grade = structuredClone(good);
    bad.items[0].score = 3;
    bad.items[1].max = 5;
    bad.items[1].evidence_line_keys = ["p9-l9"];
    const issues = validateGrade(bad, items, lines, 2).map((i) => i.message);
    expect(issues.some((m) => m.includes("score must be within 0..2"))).toBe(true);
    expect(issues.some((m) => m.includes("max must be 3"))).toBe(true);
    expect(issues.some((m) => m.includes('unknown line_key "p9-l9"'))).toBe(true);

    const missing: Grade = { ...structuredClone(good), items: [good.items[0]] };
    expect(validateGrade(missing, items, lines, 2).map((i) => i.message)).toContain('missing item "q2"');
  });
  it("requires exactly one of question_key / criterion_key", () => {
    const bad: Grade = structuredClone(good);
    bad.items[0].criterion_key = "x";
    expect(validateGrade(bad, items, lines, 2)[0].message).toMatch(/exactly one/);
  });
  it("annotations must anchor on their own page or have a valid bbox", () => {
    const bad: Grade = structuredClone(good);
    bad.annotations[0].line_keys = ["p2-l1"];
    bad.annotations[1].approx_bbox = { x: 0.9, y: 0.2, w: 0.3, h: 0.1 };
    const msgs = validateGrade(bad, items, lines, 2).map((i) => i.message);
    expect(msgs).toContain('"p2-l1" is not on page 1');
    expect(msgs).toContain("must be a normalised 0-1 box inside the page");
  });
  it("checks rubric level labels", () => {
    const rubricItems: GradableItem[] = [
      { key: "ideas", kind: "criterion", max: 4, levelLabels: ["4", "3", "2", "1"] },
    ];
    const g: Grade = {
      ...good,
      annotations: [],
      items: [
        { ...good.items[0], question_key: null, criterion_key: "ideas", max: 4, score: 3, level_label: "Excelente" },
      ],
    };
    expect(validateGrade(g, rubricItems, lines, 1).map((i) => i.message)).toContain(
      '"Excelente" is not a level of this criterion',
    );
  });
});

describe("validateTranscription / validateVerification", () => {
  it("flags unknown questions and line keys", () => {
    const issues = validateTranscription(
      {
        pages: [{ page_position: 1, legibility: 0.9, notes: null }],
        answers: [
          {
            question_key: "q9",
            mapping_confidence: 0.9,
            status: "answered",
            text: "x",
            line_keys: ["p1-l7"],
            struck_text: null,
            has_diagram: false,
            diagram_description: null,
            illegible_spans: 0,
            ocr_corrections: [],
          },
        ],
        flags: [],
      },
      items,
      lines,
      1,
    ).map((i) => i.message);
    expect(issues).toEqual(['unknown question "q9"', 'unknown line_key "p1-l7"']);
  });
  it("verifier items use the same keys", () => {
    expect(
      validateVerification(
        { items: [{ question_key: "q1", criterion_key: null, score: 2, confidence: 1, transcription_doubt: null }] },
        items,
      ).map((i) => i.message),
    ).toEqual(['missing item "q2"']);
  });
});
