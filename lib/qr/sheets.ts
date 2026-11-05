import "server-only";
import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import QRCode from "qrcode";
import { encodeQr } from "./payload";

export type SheetStudent = { name: string; token: string };
export type SheetStrings = {
  className: string;
  coverTitle: string;
  coverInstructions: string;
  stickerHint: string;
};

const MM = 72 / 25.4;
const A4: [number, number] = [595.28, 841.89];

/** Helvetica is WinAnsi: keeps Spanish accents, replaces anything else with "?". */
function safeText(font: PDFFont, s: string) {
  return [...s]
    .map((c) => {
      try {
        font.encodeText(c);
        return c;
      } catch {
        return "?";
      }
    })
    .join("");
}

function fit(font: PDFFont, s: string, size: number, maxWidth: number) {
  let out = safeText(font, s);
  while (out.length > 1 && font.widthOfTextAtSize(out, size) > maxWidth) out = out.slice(0, -1);
  return out === safeText(font, s) ? out : `${out.slice(0, -1)}.`;
}

async function qrPng(payload: string) {
  // ECC "Q" survives a smudge or a fold; quiet zone of 2 modules.
  return QRCode.toBuffer(payload, { errorCorrectionLevel: "Q", margin: 2, width: 420 });
}

/**
 * Name stickers on A4 (3 × 8 labels, 70 × 37 mm — standard "24 per sheet" label paper).
 * Layout per label: QR on the left, the name on the right — the pipeline redacts
 * that whole strip before any model sees the page.
 */
export async function renderStickerSheet(students: SheetStudent[], s: SheetStrings, copies = 1): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const cols = 3;
  const rows = 8;
  const lw = 70 * MM;
  const lh = 37 * MM;
  const x0 = (A4[0] - cols * lw) / 2;
  const y0 = A4[1] - (A4[1] - rows * lh) / 2;
  const labels = students.flatMap((st) => Array.from({ length: Math.max(1, copies) }, () => st));
  for (let i = 0; i < Math.max(labels.length, 1); i += cols * rows) {
    const page = pdf.addPage(A4);
    for (const [j, st] of labels.slice(i, i + cols * rows).entries()) {
      const x = x0 + (j % cols) * lw;
      const yTop = y0 - Math.floor(j / cols) * lh;
      const qr = await pdf.embedPng(await qrPng(encodeQr("sticker", st.token)));
      const q = lh - 8 * MM;
      page.drawImage(qr, { x: x + 3 * MM, y: yTop - lh + 4 * MM, width: q, height: q });
      const tx = x + 3 * MM + q + 2 * MM;
      const tw = lw - (tx - x) - 3 * MM;
      page.drawText(fit(bold, st.name, 11, tw), { x: tx, y: yTop - 14 * MM, size: 11, font: bold });
      page.drawText(fit(font, s.className, 8, tw), {
        x: tx,
        y: yTop - 19 * MM,
        size: 8,
        font,
        color: rgb(0.35, 0.35, 0.35),
      });
      page.drawText(fit(font, s.stickerHint, 6.5, tw), {
        x: tx,
        y: yTop - lh + 6 * MM,
        size: 6.5,
        font,
        color: rgb(0.45, 0.45, 0.45),
      });
    }
  }
  return pdf.save();
}

/** One cover sheet per student: placed on top of their pages before scanning. Dropped from grading. */
export async function renderCoverSheets(students: SheetStudent[], s: SheetStrings): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const [W, H] = A4;
  for (const st of students.length ? students : [null]) {
    const page = pdf.addPage(A4);
    if (!st) continue;
    const size = 60 * MM;
    const qr = await pdf.embedPng(await qrPng(encodeQr("cover", st.token)));
    page.drawImage(qr, { x: W - size - 20 * MM, y: H - size - 20 * MM, width: size, height: size });
    const tw = W - size - 50 * MM;
    page.drawText(fit(font, s.coverTitle, 14, tw), {
      x: 20 * MM,
      y: H - 30 * MM,
      size: 14,
      font,
      color: rgb(0.35, 0.35, 0.35),
    });
    page.drawText(fit(bold, st.name, 28, tw), { x: 20 * MM, y: H - 45 * MM, size: 28, font: bold });
    page.drawText(fit(font, s.className, 14, tw), { x: 20 * MM, y: H - 55 * MM, size: 14, font });
    const words = safeText(font, s.coverInstructions).split(/\s+/);
    let line = "";
    let y = H - 100 * MM;
    for (const w of words) {
      const next = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(next, 12) > W - 40 * MM) {
        page.drawText(line, { x: 20 * MM, y, size: 12, font });
        y -= 16;
        line = w;
      } else line = next;
    }
    if (line) page.drawText(line, { x: 20 * MM, y, size: 12, font });
  }
  return pdf.save();
}
