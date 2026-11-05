/**
 * TEST-ONLY provider fakes and fixtures (master prompt §0.2: production code never
 * uses these). They stand in for Google Vision and Claude at the provider
 * boundary so the rest of the pipeline runs for real.
 */
import sharp from "sharp";
import type { StructuredCall } from "@/lib/ai/client";
import { AiRefusalError } from "@/lib/ai/errors";
import type { Grade, Transcription, Verification } from "@/lib/ai/schemas";
import type { OcrProvider } from "@/lib/ocr/types";

/** A fake but realistic handwritten-ish page rendered with sharp (sharp text, grey paper). */
export async function makePage(lines: string[]): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="2200">
    <rect width="100%" height="100%" fill="#e9e4da"/>
    ${lines.map((t, i) => `<text x="120" y="${140 + i * 160}" font-size="72" font-family="sans-serif" fill="#1a1a1a">${t}</text>`).join("")}
  </svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 92 }).toBuffer();
}

export const fakeOcr: OcrProvider = {
  name: "fake-ocr",
  async recognise() {
    const line = (n: number, text: string, y: number, confidence = 0.97) => ({
      n,
      text,
      confidence,
      bbox: { x: 0.07, y, w: 0.6, h: 0.04 },
      words: [],
    });
    return {
      width: 1600,
      height: 2200,
      provider: "fake",
      lines: [line(1, "Nombre: Ana Pérez", 0.035), line(2, "1) 3/4", 0.11), line(3, "2) x = 7", 0.18, 0.9)],
    };
  },
};

export type Seen = { role: string; text: string; images: number; system: string };
export function fakeAi(seen: Seen[], opts: { refuseGrade?: boolean } = {}) {
  return async <T>(call: StructuredCall<T>): Promise<T> => {
    seen.push({ role: call.role, text: call.text, images: call.images.length, system: call.system });
    let out: unknown;
    if (call.role === "transcribe") {
      out = {
        pages: [{ page_position: 1, legibility: 0.95, notes: null }],
        answers: [
          {
            question_key: "q1",
            mapping_confidence: 0.98,
            status: "answered",
            text: "\\frac{3}{4}",
            line_keys: ["p1-l2"],
            struck_text: null,
            has_diagram: false,
            diagram_description: null,
            illegible_spans: 0,
            ocr_corrections: [],
          },
          {
            question_key: "q2",
            mapping_confidence: 0.95,
            status: "answered",
            text: "x = 7",
            line_keys: ["p1-l3"],
            struck_text: null,
            has_diagram: false,
            diagram_description: null,
            illegible_spans: 0,
            ocr_corrections: [],
          },
        ],
        flags: [],
      } satisfies Transcription;
    } else if (call.role === "grade") {
      if (opts.refuseGrade) throw new AiRefusalError(null);
      out = {
        items: [
          {
            question_key: "q1",
            criterion_key: null,
            score: 2,
            max: 2,
            level_label: null,
            evidence_line_keys: ["p1-l2"],
            rationale: "Correct.",
            confidence: 0.95,
            error_type: "none",
            misconception_tag: null,
          },
          {
            question_key: "q2",
            criterion_key: null,
            score: 0,
            max: 3,
            level_label: null,
            evidence_line_keys: ["p1-l3"],
            rationale: "Sign error when moving 2.",
            confidence: 0.9,
            error_type: "computational",
            misconception_tag: "sign_error_transposing",
          },
        ],
        annotations: [
          { page_position: 1, kind: "correct", line_keys: ["p1-l2"], approx_bbox: null, text: "¡Bien simplificado!" },
          {
            page_position: 1,
            kind: "error",
            line_keys: ["p1-l3"],
            approx_bbox: null,
            text: "Revisa el signo al pasar el 2.",
          },
        ],
        feedback: {
          glows: ["Fracción correcta en la 1."],
          grows: [{ point: "Signos al despejar", how: "Cambia el signo al pasar un término." }],
          next_step: "Rehaz la 2.",
          practice_item: null,
          summary_for_teacher: "Error de signo.",
        },
        flags: [],
      } satisfies Grade;
    } else if (call.role === "verify") {
      out = {
        items: [
          { question_key: "q1", criterion_key: null, score: 2, confidence: 0.95, transcription_doubt: null },
          { question_key: "q2", criterion_key: null, score: 1, confidence: 0.7, transcription_doubt: null },
        ],
      } satisfies Verification;
    } else if (call.role === "name_read") {
      out = { name_text: "Ana Pérez", confidence: 0.9 };
    } else throw new Error(`unexpected role ${call.role}`);
    const problems = call.validate?.(out as T);
    if (problems) throw new Error(`fake output failed validation: ${problems}`);
    return out as T;
  };
}
