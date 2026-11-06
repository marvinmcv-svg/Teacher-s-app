import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parse, type Font } from "opentype.js";

/**
 * Handwriting for the marked papers. Text is turned into vector outlines
 * (Caveat, SIL OFL 1.1, vendored in lib/fonts) so the server never depends on
 * fonts installed on the machine.
 */
let font: Font | null = null;
export function handFont(): Font {
  if (!font) {
    const buf = readFileSync(path.join(process.cwd(), "lib/fonts/caveat-600.woff"));
    font = parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  }
  return font;
}

/** Symbols the font doesn't draw → plain-text stand-ins a teacher would write. */
const MAP: [RegExp, string][] = [
  [/[−–—]/g, "-"],
  [/×/g, "x"],
  [/÷/g, "/"],
  [/≤/g, "<="],
  [/≥/g, ">="],
  [/≠/g, "=/="],
  [/→/g, "->"],
  [/√/g, "raíz "],
  [/π/g, "pi"],
  [/[“”]/g, '"'],
  [/[‘’]/g, "'"],
];

/** Replace characters the font can't draw. */
export function drawable(text: string): string {
  let s = text;
  for (const [re, to] of MAP) s = s.replace(re, to);
  const f = handFont();
  return [...s].map((ch) => (ch === " " || f.charToGlyph(ch).index > 0 ? ch : "?")).join("");
}

export function textWidth(text: string, size: number): number {
  return handFont().getAdvanceWidth(text, size);
}

/** Greedy word wrap to a pixel width (long words are kept whole). */
export function wrapText(text: string, size: number, maxWidth: number): string[] {
  const words = drawable(text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (line && textWidth(next, size) > maxWidth) {
      lines.push(line);
      line = w;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

/** SVG path data for one line of handwriting with its baseline at (x, y). */
export function textPath(text: string, x: number, y: number, size: number): string {
  return handFont().getPath(drawable(text), x, y, size).toPathData(1);
}
