"use client";
import { assess, measure, rgbaToGray, type QualityIssue } from "@/lib/image/quality";

export const MAX_CAPTURE_EDGE = 3000;

/** Analyse a frame/image for the quality gate on a small canvas. */
export function analyse(source: CanvasImageSource, w: number, h: number, capturedLongEdge: number) {
  const scale = Math.min(1, 512 / Math.max(w, h));
  const cw = Math.max(1, Math.round(w * scale));
  const ch = Math.max(1, Math.round(h * scale));
  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(source, 0, 0, cw, ch);
  const gray = rgbaToGray(ctx.getImageData(0, 0, cw, ch).data);
  const m = measure(gray, cw, ch);
  return { metrics: m, issues: assess(m, capturedLongEdge) as QualityIssue[], gray };
}

/** Mean absolute difference between two small gray frames — used to detect a steady hand. */
export function frameDiff(a: Uint8Array | null, b: Uint8Array): number {
  if (!a || a.length !== b.length) return 255;
  let s = 0;
  for (let i = 0; i < a.length; i += 4) s += Math.abs(a[i] - b[i]);
  return s / (a.length / 4);
}

/** Draw the source at ≤ MAX_CAPTURE_EDGE and encode JPEG (also strips EXIF). */
export async function toJpeg(source: CanvasImageSource, w: number, h: number, quality = 0.85) {
  const scale = Math.min(1, MAX_CAPTURE_EDGE / Math.max(w, h));
  const cw = Math.round(w * scale);
  const ch = Math.round(h * scale);
  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  canvas.getContext("2d")!.drawImage(source, 0, 0, cw, ch);
  const blob = await new Promise<Blob>((res, rej) =>
    canvas.toBlob((b) => (b ? res(b) : rej(new Error("encode"))), "image/jpeg", quality),
  );
  return { blob, width: cw, height: ch };
}

/** Decode a picked file (respects EXIF orientation in modern browsers). */
export async function decodeFile(file: File) {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  return bmp;
}
