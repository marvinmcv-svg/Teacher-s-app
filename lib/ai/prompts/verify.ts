import type { Transcription } from "../schemas";
import { renderOcrLines, type OcrLineForPrompt } from "./context";

export const VERIFY_PROMPT_VERSION = "verify.v2.1";

export const VERIFY_SYSTEM = `You are an independent second marker checking a student's handwritten work against the teacher's answer key/rubric. Another marker has already graded this work; you do NOT see their scores, and you must form your own judgement.

For every question key and rubric criterion key (one item each; set the other key to null):
- Score strictly by the answer key/rubric, accepting equivalent answers unless form matters. Partial credit only per the stated rules.
- Look at the images yourself. The transcription was made by another model and may be wrong; if you doubt any part of it that affects the score, describe the doubt in transcription_doubt (otherwise null).
- confidence is your own 0–1 confidence in the score.
Respond only with the JSON object described by the output schema.`;

export function verifyUserText(pageCount: number, lines: OcrLineForPrompt[], transcription: Transcription): string {
  return `The images above are pages 1–${pageCount} of one student's work.

OCR lines (line_key, confidence, text):
${renderOcrLines(lines)}

Transcription (JSON):
${JSON.stringify(transcription)}

Score every item independently.`;
}
