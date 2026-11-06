import "server-only";
import sharp from "sharp";
import { textPath, textWidth, wrapText } from "./handwriting";

export type MarkKind = "correct" | "error" | "partial" | "unclear" | "praise" | "note";
export type BBox = { x: number; y: number; w: number; h: number };
export type Mark = { kind: MarkKind; region: BBox | null; text: string };

const INK = "#C81E34"; // teacher's red pen
const OUTPUT_LONG_EDGE = 2000;

/** Small deterministic wobble so strokes look drawn by hand, not by a ruler. */
function rng(seed: number) {
  let s = seed % 2147483647 || 1;
  return () => ((s = (s * 48271) % 2147483647) / 2147483647) * 2 - 1;
}

type Rect = { x: number; y: number; w: number; h: number };
const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

function check(cx: number, cy: number, s: number, r: () => number) {
  const j = () => r() * s * 0.06;
  return `M${cx - 0.45 * s + j()} ${cy - 0.05 * s + j()} Q${cx - 0.25 * s} ${cy + 0.15 * s} ${cx - 0.12 * s + j()} ${cy + 0.42 * s + j()} Q${cx + 0.1 * s} ${cy - 0.15 * s} ${cx + 0.55 * s + j()} ${cy - 0.6 * s + j()}`;
}
function cross(cx: number, cy: number, s: number, r: () => number) {
  const j = () => r() * s * 0.06;
  const d = 0.4 * s;
  return `M${cx - d + j()} ${cy - d + j()} L${cx + d + j()} ${cy + d + j()} M${cx + d + j()} ${cy - d + j()} L${cx - d + j()} ${cy + d + j()}`;
}
/** A loose, not-quite-closed loop around a region (how teachers circle a mistake). */
function loop(b: Rect, r: () => number) {
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const rx = b.w / 2 + Math.max(12, b.h * 0.35);
  const ry = b.h / 2 + Math.max(10, b.h * 0.45);
  const pts: string[] = [];
  const start = -0.4 + r() * 0.1;
  for (let i = 0; i <= 36; i++) {
    const a = start + (i / 36) * (Math.PI * 2 + 0.35);
    const k = 1 + r() * 0.025;
    pts.push(`${(cx + Math.cos(a) * rx * k).toFixed(1)} ${(cy + Math.sin(a) * ry * k).toFixed(1)}`);
  }
  return `M${pts.join(" L")}`;
}
function star(cx: number, cy: number, s: number) {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rad = i % 2 ? s * 0.22 : s * 0.5;
    pts.push(`${(cx + Math.cos(a) * rad).toFixed(1)} ${(cy + Math.sin(a) * rad).toFixed(1)}`);
  }
  return `M${pts.join(" L")} Z`;
}

/**
 * Mark one page like a teacher with a red pen: ✓ next to right answers,
 * ✗ / a loop around mistakes, ~ for partial, ? for unreadable, a star for
 * praise, and each comment handwritten in the margin beside its answer.
 * `score` (page 1 only) is written and circled in the top-right corner.
 */
export async function renderMarkedPage(
  image: Buffer,
  marks: Mark[],
  opts: { score?: string | null; seed?: number } = {},
): Promise<{ jpeg: Buffer; width: number; height: number }> {
  const { data, info } = await sharp(image)
    .rotate()
    .resize({ width: OUTPUT_LONG_EDGE, height: OUTPUT_LONG_EDGE, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 90 })
    .toBuffer({ resolveWithObject: true });
  const W = info.width;
  const H = info.height;
  const fs = Math.round(Math.max(22, W * 0.03)); // handwriting size
  const sw = Math.max(3, W * 0.0032); // pen width
  const markSize = fs * 1.15;
  const r = rng(opts.seed ?? 7);
  const strokes: string[] = [];
  const texts: string[] = [];
  const placed: Rect[] = [];

  const write = (lines: string[], x: number, y: number, size: number) => {
    lines.forEach((line, i) => texts.push(textPath(line, x, y + i * size * 1.05, size)));
  };

  // Score first so comments avoid it.
  if (opts.score) {
    const size = fs * 1.7;
    const tw = textWidth(opts.score, size);
    const x = W - tw - fs * 2.2;
    const y = fs * 2.2;
    write([opts.score], x, y, size);
    const box = { x: x - fs * 0.5, y: y - size * 0.85, w: tw + fs, h: size * 1.15 };
    strokes.push(loop(box, r));
    placed.push({ x: box.x - fs, y: box.y - fs * 0.6, w: box.w + fs * 2, h: box.h + fs * 1.2 });
  }

  const ordered = marks
    .filter((m): m is Mark & { region: BBox } => !!m.region)
    .sort((a, b) => a.region.y - b.region.y || a.region.x - b.region.x);

  for (const m of ordered) {
    const b = { x: m.region.x * W, y: m.region.y * H, w: m.region.w * W, h: m.region.h * H };
    const cy = b.y + b.h / 2;
    // the mark sits just right of the answer (left of it if the answer runs to the edge)
    // mistakes get a loop around them, so their mark sits outside the loop
    const loopPad = m.kind === "error" ? Math.max(12, b.h * 0.35) + markSize * 0.3 : 0;
    const rightRoom = W - (b.x + b.w + loopPad);
    const onRight = rightRoom > markSize * 1.6;
    const mx = onRight ? b.x + b.w + loopPad + markSize * 0.8 : Math.max(markSize, b.x - loopPad - markSize * 0.8);
    switch (m.kind) {
      case "correct":
        strokes.push(check(mx, cy, markSize, r));
        break;
      case "error":
        strokes.push(loop(b, r));
        strokes.push(cross(mx, cy, markSize * 0.8, r));
        break;
      case "partial":
        strokes.push(check(mx, cy, markSize, r));
        strokes.push(
          `M${mx - markSize * 0.15} ${cy - markSize * 0.45} L${mx + markSize * 0.25} ${cy + markSize * 0.15}`,
        );
        break;
      case "unclear":
        write(["?"], mx - fs * 0.25, cy + fs * 0.35, fs * 1.3);
        break;
      case "praise":
        strokes.push(star(mx, cy, markSize));
        break;
      case "note":
        break;
    }
    if (!m.text.trim()) continue;

    // Comment: in the margin beside the mark, wrapped; under the answer when there's no room.
    const startRight = onRight ? mx + markSize * 0.9 : -1;
    const room = startRight > 0 ? W - startRight - fs * 0.6 : 0;
    let x: number;
    let width: number;
    let y: number;
    if (room >= W * 0.22) {
      x = startRight;
      width = room;
      y = cy - fs * 0.2;
    } else {
      x = Math.max(fs * 0.6, b.x);
      width = W - x - fs * 0.6;
      y = b.y + b.h + fs * 1.1;
    }
    const lines = wrapText(m.text, fs, width).slice(0, 4);
    const lh = fs * 1.05;
    const blockW = Math.max(...lines.map((l) => textWidth(l, fs)));
    let rect = { x, y: y - fs, w: blockW, h: lines.length * lh + fs * 0.2 };
    for (let guard = 0; guard < 40 && placed.some((p) => overlaps(p, rect)); guard++) {
      y += lh * 0.6;
      rect = { ...rect, y: y - fs };
    }
    y = Math.min(y, H - lines.length * lh);
    write(lines, x, y, fs);
    placed.push({ ...rect, y: y - fs });
  }

  // White halo under the ink keeps comments readable where they cross the student's writing.
  const textD = texts.join(" ");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
<g fill="none" stroke="${INK}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" opacity="0.92">${strokes
    .map((d) => `<path d="${d}"/>`)
    .join("")}</g>
<path d="${textD}" fill="none" stroke="#ffffff" stroke-opacity="0.85" stroke-width="${fs * 0.16}" stroke-linejoin="round"/>
<path d="${textD}" fill="${INK}"/>
</svg>`;
  const jpeg = await sharp(data)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer();
  return { jpeg, width: W, height: H };
}
