import { describe, expect, it } from "vitest";
import { lastFirst, planFileNames, safeFileName } from "@/lib/marking/filenames";

describe("marked-paper file names", () => {
  it("writes names last-name first", () => {
    expect(lastFirst("Ana Pérez")).toBe("Pérez, Ana");
    expect(lastFirst("Luis Mamani Quispe")).toBe("Mamani Quispe, Luis");
    expect(lastFirst("Ana María Pérez Quispe")).toBe("Pérez Quispe, Ana María");
    expect(lastFirst("Pérez, Ana")).toBe("Pérez, Ana");
    expect(lastFirst("Bo")).toBe("Bo");
  });
  it("strips characters file systems reject", () => {
    expect(safeFileName('Ana/"Pé:rez"?')).toBe("Ana Pé rez");
  });
  it("orders by last name (accent-insensitive), numbers pages, dedupes, unnamed last", () => {
    const out = planFileNames(
      [
        { submissionId: "1", studentName: "Zoe Álvarez", pages: 1 },
        { submissionId: "2", studentName: "Ana Pérez", pages: 2 },
        { submissionId: "3", studentName: null, pages: 1 },
        { submissionId: "4", studentName: "Bruno Ochoa", pages: 1 },
        { submissionId: "5", studentName: "Ana Pérez", pages: 1 },
      ],
      "Sin nombre",
    );
    expect(out.map((f) => f.name)).toEqual([
      "Álvarez, Zoe.jpg",
      "Ochoa, Bruno.jpg",
      "Pérez, Ana - 1.jpg",
      "Pérez, Ana - 2.jpg",
      "Pérez, Ana (2).jpg",
      "Sin nombre 1.jpg",
    ]);
  });
});
