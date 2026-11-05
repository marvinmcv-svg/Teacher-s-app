import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { findNameLines, matchRoster, nameScore } from "@/lib/grading/names";
import { assess, measure } from "@/lib/image/quality";
import { fitToTier, visualTokens } from "@/lib/image/tier";
import { buildLines, lineKey, type VisionPage } from "@/lib/ocr/vision-lines";

const word = (text: string, x: number, y: number, conf: number, brk?: string) => ({
  confidence: conf,
  boundingBox: {
    vertices: [
      { x, y },
      { x: x + text.length * 10, y },
      { x: x + text.length * 10, y: y + 20 },
      { x, y: y + 20 },
    ],
  },
  symbols: text.split("").map((ch, i, arr) => ({
    text: ch,
    property: i === arr.length - 1 && brk ? { detectedBreak: { type: brk } } : undefined,
  })),
});

describe("Vision line builder (§6.2)", () => {
  const page: VisionPage = {
    width: 1000,
    height: 2000,
    blocks: [
      {
        paragraphs: [
          {
            words: [
              word("Nombre:", 50, 40, 0.9, "SPACE"),
              word("Ana", 130, 40, 0.8, "SPACE"),
              word("Pérez", 170, 40, 0.7, "EOL_SURE_SPACE"),
              word("1)", 50, 100, 0.99, "SPACE"),
              word("3/4", 80, 100, 0.95, "LINE_BREAK"),
            ],
          },
          { words: [word("2)", 50, 160, 0.99, "SPACE"), word("x=5", 80, 160, 0.6)] },
        ],
      },
    ],
  };
  const lines = buildLines(page);
  it("splits on EOL_SURE_SPACE / LINE_BREAK and paragraph ends", () => {
    expect(lines.map((l) => l.text)).toEqual(["Nombre: Ana Pérez", "1) 3/4", "2) x=5"]);
    expect(lines.map((l) => lineKey(2, l.n))).toEqual(["p2-l1", "p2-l2", "p2-l3"]);
  });
  it("line confidence = min word confidence; boxes normalised 0..1", () => {
    expect(lines[0].confidence).toBe(0.7);
    expect(lines[0].bbox.x).toBeCloseTo(0.05);
    expect(lines[0].bbox.y).toBeCloseTo(0.02);
    expect(lines[0].bbox.w).toBeCloseTo((170 + 50 - 50) / 1000);
    expect(lines[0].words).toHaveLength(3);
  });
});

describe("tier fitting (§6.1)", () => {
  it("fits A4 portrait photos under 2576px and 4784 tokens", () => {
    for (const [w, h] of [
      [3024, 4032],
      [4000, 5657],
      [1200, 1600],
      [4032, 3024],
    ]) {
      const r = fitToTier(w, h, 2576, 4784);
      expect(Math.max(r.width, r.height)).toBeLessThanOrEqual(2576);
      expect(visualTokens(r.width, r.height)).toBeLessThanOrEqual(4784);
      expect(Math.abs(r.width / r.height - w / h)).toBeLessThan(0.01);
    }
  });
  it("never upscales", () => {
    expect(fitToTier(800, 600, 2576, 4784)).toEqual({ width: 800, height: 600 });
  });
});

describe("quality gate", () => {
  it("sharp text-like noise passes, flat grey is blurry", () => {
    const W = 200,
      H = 200;
    const crisp = new Uint8Array(W * H).map((_, i) => ((i * 7919) % 13 < 3 ? 20 : 235));
    const flat = new Uint8Array(W * H).fill(180);
    expect(assess(measure(crisp, W, H), 3000)).toEqual([]);
    expect(assess(measure(flat, W, H), 3000)).toContain("blurry");
  });
  it("detects dark, glare and small captures", () => {
    const dark = new Uint8Array(100 * 100).map((_, i) => (i % 2 ? 10 : 60));
    expect(assess(measure(dark, 100, 100), 3000)).toContain("too_dark");
    // grey paper with one blown-out blob in a corner
    const glare = new Uint8Array(160 * 160).map((_, i) =>
      i % 160 < 40 && Math.floor(i / 160) < 40 ? 255 : i % 7 ? 200 : 40,
    );
    expect(assess(measure(glare, 160, 160), 3000)).toContain("glare");
    // a clean white scan with text is NOT glare
    const scan = new Uint8Array(160 * 160).map((_, i) => (i % 23 < 2 ? 0 : 255));
    expect(assess(measure(scan, 160, 160), 3000)).not.toContain("glare");
    expect(assess(measure(dark, 100, 100), 640)).toContain("too_small");
  });
});

describe("redaction", () => {
  it("destroys detail inside the region and leaves the rest intact", async () => {
    const { redactRegions } = await import("@/lib/image/process");
    // checkerboard 400x400
    const raw = Buffer.alloc(400 * 400 * 3);
    for (let y = 0; y < 400; y++)
      for (let x = 0; x < 400; x++)
        raw.fill(((x >> 2) + (y >> 2)) % 2 ? 255 : 0, (y * 400 + x) * 3, (y * 400 + x) * 3 + 3);
    const png = await sharp(raw, { raw: { width: 400, height: 400, channels: 3 } })
      .png()
      .toBuffer();
    const out = await redactRegions(png, [{ x: 0, y: 0, w: 0.5, h: 0.25 }], 0);
    const g = await sharp(out).greyscale().raw().toBuffer();
    const variance = (x0: number, y0: number, x1: number, y1: number) => {
      const v: number[] = [];
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) v.push(g[y * 400 + x]);
      const m = v.reduce((s, a) => s + a, 0) / v.length;
      return v.reduce((s, a) => s + (a - m) ** 2, 0) / v.length;
    };
    expect(variance(20, 20, 180, 80)).toBeLessThan(200); // redacted: near-uniform
    expect(variance(220, 220, 380, 380)).toBeGreaterThan(8000); // untouched checkerboard
  });
});

describe("name matching (in code, never by the model)", () => {
  const roster = [{ display_name: "Ana Pérez" }, { display_name: "Ana Quispe" }, { display_name: "Luis Mamani" }];
  it("tolerates accents, order and small misspellings", () => {
    expect(nameScore("ana perez", "Ana Pérez")).toBeGreaterThan(0.9);
    expect(nameScore("Perez Ana", "Ana Pérez")).toBeGreaterThan(0.9);
    expect(nameScore("Luiz Mamami", "Luis Mamani")).toBeGreaterThan(0.75);
  });
  it("is only confident when the best match is clearly ahead", () => {
    expect(matchRoster("Ana Pérez", roster)).toMatchObject({ confident: true, best: { student: roster[0] } });
    expect(matchRoster("Ana", roster).confident).toBe(false); // ambiguous between two Anas
    expect(matchRoster("Juan Torrez", roster).confident).toBe(false);
  });
  it("finds the name field in the header band", () => {
    const lines = [
      { text: "Nombre: Ana Pérez", bbox: { y: 0.03 } },
      { text: "1) 3/4", bbox: { y: 0.1 } },
      { text: "Luis Mamani", bbox: { y: 0.6 } }, // outside header band → not redacted as name
    ];
    const hits = findNameLines(
      lines,
      roster.map((r) => r.display_name),
    );
    expect(hits.map((h) => h.reason)).toEqual(["label"]);
    expect(hits[0].written).toBe("Ana Pérez");
  });
});
