import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { toCsv } from "@/lib/release/csv";
import { renderAnnotatedPage, renderAnnotatedPdf } from "@/lib/release/render";
import { newReleaseToken, TOKEN_RE } from "@/lib/release/tokens";

describe("release tokens", () => {
  it("are 256-bit base64url and unique", () => {
    const a = newReleaseToken();
    expect(a).toMatch(TOKEN_RE);
    expect(new Set(Array.from({ length: 1000 }, newReleaseToken)).size).toBe(1000);
  });
});

describe("CSV export", () => {
  it("adds a BOM, quotes and escapes, and neutralises formula injection", () => {
    const csv = toCsv([
      ["Estudiante", "Nota"],
      ['Pérez, "Ana"', 51],
      ['=HYPERLINK("x")', null],
    ]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain('"Pérez, ""Ana"""');
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    expect(csv.endsWith("\r\n")).toBe(true);
  });
});

describe("pin placement (§5)", () => {
  it("prefers the right margin, falls back left, never on the writing", async () => {
    const { pinAnchor } = await import("@/components/pin-style");
    const r = { x: 0.07, y: 0.1, w: 0.5, h: 0.04 };
    const a = pinAnchor(r);
    expect(a.x).toBeGreaterThan(r.x + r.w);
    expect(a.y).toBeCloseTo(0.12);
    const wide = { x: 0.1, y: 0.1, w: 0.88, h: 0.04 };
    expect(pinAnchor(wide).x).toBeLessThan(wide.x);
  });
});

describe("annotated exports", () => {
  const page = () =>
    sharp({ create: { width: 1200, height: 1600, channels: 3, background: "#f4f1ea" } })
      .jpeg()
      .toBuffer();
  const pins = [
    {
      kind: "correct" as const,
      region: { x: 0.1, y: 0.1, w: 0.5, h: 0.04 },
      approximate: false,
      text: "¡Bien!",
      number: 1,
      page_id: "p",
    },
    {
      kind: "error" as const,
      region: { x: 0.1, y: 0.2, w: 0.5, h: 0.04 },
      approximate: true,
      text: "Revisa el signo: −2 → +2",
      number: 2,
      page_id: "p",
    },
  ];
  it("burns pins into the page image", async () => {
    const out = await renderAnnotatedPage(await page(), pins);
    expect(out.width).toBe(1200);
    // the error pin's red must now be present where the page was plain paper
    // pin sits in the right margin of the answer: x = 0.6 + 0.045 → 774px, y = 0.22 → 352px
    const { data } = await sharp(out.jpeg)
      .extract({ left: 744, top: 322, width: 60, height: 60 })
      .raw()
      .toBuffer({ resolveWithObject: true });
    let redish = 0;
    for (let i = 0; i < data.length; i += 3) if (data[i] > 150 && data[i + 1] < 90 && data[i + 2] < 100) redish++;
    expect(redish).toBeGreaterThan(50);
  });
  it("builds a PDF with Spanish text and maps unsupported math symbols", async () => {
    const img = await renderAnnotatedPage(await page(), pins);
    const pdf = await renderAnnotatedPdf({
      pages: [img],
      pins,
      feedback: {
        glows: ["Simplificaste ¾ → 3/4 ¡muy bien!"],
        grows: [{ point: "Signos ≤ y ≥", how: "Practica −x" }],
        nextStep: "Rehaz la 2",
        practiceItem: null,
      },
      strings: {
        title: "Fracciones · 6.º A",
        student: "Ana Pérez",
        grade: "Nota: 51",
        glows: "Lo que hiciste bien",
        grows: "Para mejorar",
        nextStep: "Siguiente paso",
        practice: "Practica",
        comments: "Comentarios",
        disclosure: "Tu profe usó IA y revisó todo.",
      },
    });
    expect(Buffer.from(pdf.slice(0, 5)).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(10_000);
  });
});
