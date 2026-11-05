import { unionBox, type BBox, type OcrLine, type OcrWord } from "./types";

/**
 * Google Cloud Vision DOCUMENT_TEXT_DETECTION returns Page → Block → Paragraph
 * → Word → Symbol and NO line objects (§6.2). Lines are rebuilt here by
 * walking words in reading order and breaking on EOL_SURE_SPACE / LINE_BREAK
 * (and at paragraph ends). Line confidence = min of word confidences
 * (conservative; mean is an eval option).
 */
type Vertex = { x?: number; y?: number };
type Poly = { vertices?: Vertex[]; normalizedVertices?: Vertex[] };
type VSymbol = { text?: string; confidence?: number; property?: { detectedBreak?: { type?: string } } };
type VWord = { symbols?: VSymbol[]; confidence?: number; boundingBox?: Poly };
type VParagraph = { words?: VWord[] };
type VBlock = { paragraphs?: VParagraph[] };
export type VisionPage = { width?: number; height?: number; blocks?: VBlock[] };

const LINE_BREAKS = new Set(["EOL_SURE_SPACE", "LINE_BREAK"]);
const SPACE_BREAKS = new Set(["SPACE", "SURE_SPACE"]);

function polyToBox(poly: Poly | undefined, width: number, height: number): BBox | null {
  if (!poly) return null;
  const norm = poly.normalizedVertices?.length ? poly.normalizedVertices : null;
  const verts = norm ?? poly.vertices;
  if (!verts?.length) return null;
  const xs = verts.map((v) => (v.x ?? 0) / (norm ? 1 : width));
  const ys = verts.map((v) => (v.y ?? 0) / (norm ? 1 : height));
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  const x1 = clamp(Math.min(...xs));
  const y1 = clamp(Math.min(...ys));
  return { x: x1, y: y1, w: clamp(Math.max(...xs)) - x1, h: clamp(Math.max(...ys)) - y1 };
}

export function buildLines(page: VisionPage): OcrLine[] {
  const width = page.width || 1;
  const height = page.height || 1;
  const lines: OcrLine[] = [];
  let current: { words: OcrWord[]; text: string } = { words: [], text: "" };

  const flush = () => {
    if (!current.words.length) return;
    const confs = current.words.map((w) => w.confidence).filter((c): c is number => c !== null);
    lines.push({
      n: lines.length + 1,
      text: current.text.trim(),
      bbox: unionBox(current.words.map((w) => w.bbox)),
      confidence: confs.length ? Math.min(...confs) : null,
      words: current.words,
    });
    current = { words: [], text: "" };
  };

  for (const block of page.blocks ?? []) {
    for (const para of block.paragraphs ?? []) {
      for (const word of para.words ?? []) {
        const symbols = word.symbols ?? [];
        const text = symbols.map((s) => s.text ?? "").join("");
        const bbox = polyToBox(word.boundingBox, width, height);
        if (!text || !bbox) continue;
        current.words.push({ text, bbox, confidence: typeof word.confidence === "number" ? word.confidence : null });
        const brk = symbols[symbols.length - 1]?.property?.detectedBreak?.type;
        current.text += text;
        if (brk && LINE_BREAKS.has(brk)) flush();
        else if (brk && (SPACE_BREAKS.has(brk) || brk === "HYPHEN")) current.text += brk === "HYPHEN" ? "-" : " ";
      }
      flush(); // a paragraph never continues a line into the next paragraph
    }
  }
  flush();
  return lines;
}

export const lineKey = (pagePosition: number, n: number) => `p${pagePosition}-l${n}`;
