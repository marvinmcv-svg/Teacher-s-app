import "server-only";
import { createCanvas } from "@napi-rs/canvas";

export const MAX_PDF_PAGES = 200;
export const MAX_PDF_BYTES = 50 * 1024 * 1024; // = the storage upload limit
const TARGET_LONG_EDGE = 2400; // ≥ the model tier (2576 px is the cap) once trimmed; plenty for OCR
const MAX_SCALE = 4;

export class PdfError extends Error {
  constructor(public readonly code: "too_large" | "too_many_pages" | "unreadable") {
    super(code);
    this.name = "PdfError";
  }
}

/**
 * Rasterise a scanner PDF to JPEG page images (§3.2 — PDFs are rasterised
 * server-side). pdf.js renders only (no XFA, no scripting, no system fonts); each page is rendered to fit
 * TARGET_LONG_EDGE on a white background. Yields one page at a time so memory
 * stays flat for long scans.
 */
export async function* rasterisePdf(bytes: Uint8Array): AsyncGenerator<{ index: number; jpeg: Buffer; count: number }> {
  if (bytes.byteLength > MAX_PDF_BYTES) throw new PdfError("too_large");
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({
    data: bytes,
    useSystemFonts: false,
    enableXfa: false,
    disableFontFace: true,
    verbosity: 0,
  });
  let doc;
  try {
    doc = await task.promise;
  } catch {
    await task.destroy();
    throw new PdfError("unreadable");
  }
  try {
    if (doc.numPages > MAX_PDF_PAGES) throw new PdfError("too_many_pages");
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(MAX_SCALE, TARGET_LONG_EDGE / Math.max(base.width, base.height));
      const vp = page.getViewport({ scale });
      const canvas = createCanvas(Math.round(vp.width), Math.round(vp.height));
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      // pdf.js accepts the node canvas at runtime; its types expect a DOM canvas.
      await page.render({ canvas, canvasContext: ctx, viewport: vp } as never).promise;
      const jpeg = Buffer.from(await canvas.encode("jpeg", 90));
      page.cleanup();
      yield { index: i - 1, jpeg, count: doc.numPages };
    }
  } finally {
    await task.destroy();
  }
}
