import { describe, expect, it } from "vitest";
import { normaliseName, parseRoster, splitCsvLine } from "@/lib/roster/parse";

describe("parseRoster — pasted lists", () => {
  it("parses one name per line, stripping numbering and bullets", () => {
    const { students, skipped } = parseRoster("1. Ana Pérez\n2) Luis Mamani\n- Sofía Quispe\n• José Ñúñez\n\n");
    expect(students.map((s) => s.displayName)).toEqual(["Ana Pérez", "Luis Mamani", "Sofía Quispe", "José Ñúñez"]);
    expect(skipped).toEqual([]);
  });

  it("skips accent/case-insensitive duplicates, including existing roster names", () => {
    const { students, skipped } = parseRoster("Ana Perez\nANA PÉREZ\nLuis Mamani", ["luis mamani"]);
    expect(students.map((s) => s.displayName)).toEqual(["Ana Perez"]);
    expect(skipped.map((s) => s.reason)).toEqual(["duplicate", "duplicate"]);
  });

  it("handles Windows newlines and BOM", () => {
    expect(parseRoster("﻿Ana\r\nLuis\r\n").students).toHaveLength(2);
  });

  it("rejects absurdly long names", () => {
    expect(parseRoster("x".repeat(500)).skipped[0].reason).toBe("too_long");
  });
});

describe("parseRoster — CSV", () => {
  it("reads name + id columns by header (Spanish, semicolon — Excel ES default)", () => {
    const csv = 'Código;Nombre completo;Curso\nA-01;Ana Pérez;5A\nA-02;"Mamani, Luis";5A\n';
    const { students } = parseRoster(csv);
    expect(students).toEqual([
      { displayName: "Ana Pérez", externalId: "A-01" },
      { displayName: "Mamani, Luis", externalId: "A-02" },
    ]);
  });

  it("joins first + last name columns", () => {
    const csv = "First name,Last name,Student ID\nAna,Pérez,7\nLuis,Mamani,8";
    expect(parseRoster(csv).students).toEqual([
      { displayName: "Ana Pérez", externalId: "7" },
      { displayName: "Luis Mamani", externalId: "8" },
    ]);
  });

  it("treats header-less CSV as name in first column", () => {
    expect(parseRoster("Ana Pérez,5A\nLuis Mamani,5A").students.map((s) => s.displayName)).toEqual([
      "Ana Pérez",
      "Luis Mamani",
    ]);
  });
});

describe("helpers", () => {
  it("normaliseName strips accents and punctuation", () => {
    expect(normaliseName("  José-María  Ñúñez ")).toBe("jose maria nunez");
  });
  it("splitCsvLine handles escaped quotes", () => {
    expect(splitCsvLine('a,"b ""c""",d', ",")).toEqual(["a", 'b "c"', "d"]);
  });
});
