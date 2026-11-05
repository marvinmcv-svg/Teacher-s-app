/** Normalised 0..1 box relative to the page image. */
export type BBox = { x: number; y: number; w: number; h: number };

export type OcrWord = { text: string; bbox: BBox; confidence: number | null };
export type OcrLine = { n: number; text: string; bbox: BBox; confidence: number | null; words: OcrWord[] };
export type OcrPageResult = { width: number; height: number; lines: OcrLine[]; provider: string };

/** Pluggable OCR (§6). Implementations: google-vision (default), mathpix (later). */
export interface OcrProvider {
  readonly name: string;
  recognise(image: Buffer, opts: { languageHints: string[] }): Promise<OcrPageResult>;
}

export function unionBox(boxes: BBox[]): BBox {
  const x1 = Math.min(...boxes.map((b) => b.x));
  const y1 = Math.min(...boxes.map((b) => b.y));
  const x2 = Math.max(...boxes.map((b) => b.x + b.w));
  const y2 = Math.max(...boxes.map((b) => b.y + b.h));
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}
