import "server-only";
import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import sharp from "sharp";
import { pinAnchor } from "@/components/pin-style";
import type { BBox } from "./load";

type Kind = "correct" | "error" | "partial" | "unclear" | "praise" | "note";
export type RenderPin = {
  kind: Kind;
  region: BBox | null;
  approximate: boolean;
  text: string;
  number: number;
  page_id: string;
};

// Light-theme pen colours (§5) — printed exports are always on white paper.
const COLOR: Record<Kind, string> = {
  correct: "#1B7A50",
  error: "#C81E34",
  partial: "#8F6400",
  unclear: "#2B59C3",
  praise: "#7A4CC2",
  note: "#2B59C3",
};
// Icons drawn as paths (no font dependency) — never colour alone (§5).
const ICON: Record<Kind, string> = {
  correct: `<path d="M-5 0 L-1.5 4 L5.5 -4.5" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>`,
  error: `<path d="M-4 -4 L4 4 M4 -4 L-4 4" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/>`,
  partial: `<path d="M-5.5 1 C-3 -3 -1 4 1 0 S4 -2 5.5 -1" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/>`,
  unclear: `<path d="M-2.6 -2.6 C-2.6 -6 2.8 -6 2.8 -2.4 C2.8 0 0 0 0 2.2" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/><circle cx="0" cy="5" r="1.3" fill="#fff"/>`,
  praise: `<path d="M0 -6 L1.8 -1.9 L6 -1.9 L2.6 0.8 L3.8 5 L0 2.5 L-3.8 5 L-2.6 0.8 L-6 -1.9 L-1.8 -1.9 Z" fill="#fff"/>`,
  note: `<path d="M-4.5 4.5 L-4 1.5 L2.5 -5 L5 -2.5 L-1.5 4 Z" fill="#fff"/>`,
};

const EXPORT_LONG_EDGE = 1800;

/** Burn pins + highlights into one page image. Returns JPEG. */
export async function renderAnnotatedPage(
  image: Buffer,
  pins: RenderPin[],
): Promise<{ jpeg: Buffer; width: number; height: number }> {
  const base = sharp(image)
    .rotate()
    .resize({ width: EXPORT_LONG_EDGE, height: EXPORT_LONG_EDGE, fit: "inside", withoutEnlargement: true });
  const { data, info } = await base.jpeg({ quality: 88 }).toBuffer({ resolveWithObject: true });
  const W = info.width;
  const H = info.height;
  const r = Math.round(Math.max(14, W * 0.013)); // pin radius
  const parts: string[] = [];
  for (const p of pins) {
    if (!p.region) continue;
    const x = p.region.x * W;
    const y = p.region.y * H;
    const w = p.region.w * W;
    const h = p.region.h * H;
    const c = COLOR[p.kind];
    parts.push(
      `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="${c}" fill-opacity="0.15" stroke="${c}" stroke-width="2" ${p.approximate ? 'stroke-dasharray="8 6"' : ""}/>`,
    );
    // pin in the margin next to the region, never on top of the writing (same rule as the UI)
    const a = pinAnchor(p.region);
    const px = a.x * W;
    const py = a.y * H;
    const s = r / 8; // icon paths are drawn on a ~16px grid
    parts.push(
      `<g transform="translate(${px},${py})"><circle r="${r}" fill="${c}" stroke="#fff" stroke-width="3"/><g transform="scale(${s})">${ICON[p.kind]}</g>` +
        `<circle cx="${r * 0.85}" cy="${-r * 0.85}" r="${r * 0.55}" fill="#1E1B18" stroke="#fff" stroke-width="2"/>` +
        `<text x="${r * 0.85}" y="${-r * 0.85}" dy="0.35em" text-anchor="middle" font-family="sans-serif" font-weight="700" font-size="${r * 0.7}" fill="#fff">${p.number}</text></g>`,
    );
  }
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${parts.join("")}</svg>`);
  const jpeg = await sharp(data)
    .composite([{ input: svg, top: 0, left: 0 }])
    .jpeg({ quality: 85 })
    .toBuffer();
  return { jpeg, width: W, height: H };
}

/** pdf-lib's standard fonts are WinAnsi: covers Spanish (á é í ó ú ñ ¿ ¡) but not math symbols — map or replace. */
function sanitize(font: PDFFont, text: string): string {
  const mapped = text
    .replace(/[−–—]/g, "-")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/→/g, "->")
    .replace(/≤/g, "<=")
    .replace(/≥/g, ">=")
    .replace(/×/g, "x")
    .replace(/÷/g, "/");
  let out = "";
  for (const ch of mapped) {
    try {
      font.encodeText(ch);
      out += ch;
    } catch {
      out += "?";
    }
  }
  return out;
}

function wrap(font: PDFFont, text: string, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) > maxWidth && line) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    lines.push(line);
  }
  return lines;
}

export type PdfStrings = {
  title: string;
  student: string | null;
  grade: string | null;
  glows: string;
  grows: string;
  nextStep: string;
  practice: string;
  comments: string;
  disclosure: string;
};
export type PdfInput = {
  pages: { jpeg: Buffer; width: number; height: number }[];
  pins: RenderPin[];
  feedback: { glows: string[]; grows: { point: string; how: string }[]; nextStep: string; practiceItem: string | null };
  strings: PdfStrings;
};

/** Annotated pages (A4, fit) + a feedback page in the student's language. */
export async function renderAnnotatedPdf(input: PdfInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(input.strings.title);
  pdf.setProducer("Tinta");
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const A4: [number, number] = [595.28, 841.89];
  const margin = 40;

  for (const pg of input.pages) {
    const page = pdf.addPage(A4);
    const img = await pdf.embedJpg(pg.jpeg);
    const scale = Math.min((A4[0] - 2 * margin) / pg.width, (A4[1] - 2 * margin) / pg.height);
    const w = pg.width * scale;
    const h = pg.height * scale;
    page.drawImage(img, { x: (A4[0] - w) / 2, y: (A4[1] - h) / 2, width: w, height: h });
  }

  let page = pdf.addPage(A4);
  let y = A4[1] - margin;
  const ink = rgb(0.118, 0.106, 0.094);
  const write = (
    text: string,
    opts: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; indent?: number } = {},
  ) => {
    const size = opts.size ?? 11;
    const f = opts.bold ? bold : font;
    for (const line of wrap(f, sanitize(f, text), size, A4[0] - 2 * margin - (opts.indent ?? 0))) {
      if (y < margin + size) {
        page = pdf.addPage(A4);
        y = A4[1] - margin;
      }
      page.drawText(line, { x: margin + (opts.indent ?? 0), y: y - size, size, font: f, color: opts.color ?? ink });
      y -= size * 1.4;
    }
  };
  const gap = (n = 8) => (y -= n);

  write(input.strings.title, { size: 18, bold: true });
  if (input.strings.student) write(input.strings.student, { size: 12 });
  if (input.strings.grade) write(input.strings.grade, { size: 14, bold: true });
  gap(10);
  if (input.feedback.glows.length) {
    write(input.strings.glows, { bold: true, color: rgb(0.106, 0.478, 0.314) });
    input.feedback.glows.forEach((g) => write(`+ ${g}`, { indent: 8 }));
    gap();
  }
  if (input.feedback.grows.length) {
    write(input.strings.grows, { bold: true, color: rgb(0.784, 0.118, 0.204) });
    input.feedback.grows.forEach((g) => {
      write(`- ${g.point}`, { indent: 8 });
      if (g.how) write(g.how, { indent: 20, color: rgb(0.42, 0.392, 0.361) });
    });
    gap();
  }
  if (input.feedback.nextStep) {
    write(input.strings.nextStep, { bold: true, color: rgb(0.169, 0.349, 0.765) });
    write(input.feedback.nextStep, { indent: 8 });
    gap();
  }
  if (input.feedback.practiceItem) {
    write(input.strings.practice, { bold: true });
    write(input.feedback.practiceItem, { indent: 8 });
    gap();
  }
  const visible = input.pins.filter((p) => p.region);
  if (visible.length) {
    write(input.strings.comments, { bold: true });
    visible.forEach((p) => write(`${p.number}. ${p.text}`, { indent: 8 }));
    gap();
  }
  gap(12);
  write(input.strings.disclosure, { size: 9, color: rgb(0.42, 0.392, 0.361) });
  return pdf.save();
}
