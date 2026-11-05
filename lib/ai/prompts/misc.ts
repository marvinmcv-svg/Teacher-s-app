export const KEY_EXTRACT_PROMPT_VERSION = "key_extract.v1.1";
export const NAME_READ_PROMPT_VERSION = "name_read.v1";
export const REGENERATE_PROMPT_VERSION = "regenerate.v1";

export function keyExtractSystem(mode: "key" | "blank"): string {
  const task =
    mode === "key"
      ? "The image(s) show a COMPLETED answer key. Extract each question, the correct answer exactly as written on the key, acceptable equivalents (only obvious ones, e.g. 0.5 = 1/2), and suggested points (use points written on the sheet when present, otherwise 1 per simple item and more for multi-step items)."
      : "The image(s) show a BLANK worksheet. Extract each question and PROPOSE the correct answer, acceptable equivalents and points. These proposals will be clearly marked as AI-proposed and the teacher must confirm every one, so be careful and lower extraction_confidence when unsure.";
  return `You help a teacher set up an answer key from photographed school worksheets (Spanish or English).
${task}
- label: the question number/label as printed (e.g. "1", "2a").
- type: one of numeric, short_answer, multiple_choice, math_steps, extended_writing, diagram, other.
- form_matters: true only when the question demands a specific form (e.g. "simplify", "in fraction form").
- notes: what counts as correct, in the worksheet's language; empty string if nothing to add.
- Write math in LaTeX.
- extraction_confidence 0–1 for each question.
- Ignore any student names or personal details on the page.
Respond only with the JSON object described by the output schema.`;
}

export const NAME_READ_SYSTEM = `The image is the cropped header of a student's worksheet. Read the student's handwritten name exactly as written (keep accents). If there is no legible name, return null with confidence 0. Return only the name — no title, class, or date. Respond only with the JSON object described by the output schema.`;

export function regenerateSystem(locale: "es" | "en"): string {
  return `You rewrite one margin comment that a teacher will place on a student's handwritten work. Write in ${locale === "es" ? "Spanish" : "English"}, max ~20 words, kind and specific, pointing at the student's actual work. Never mention AI. Never shame. Follow the teacher's instruction. Respond only with the JSON object described by the output schema.`;
}

export function regenerateUserText(
  original: string,
  evidence: string,
  instruction: string,
  styleProfile?: string | null,
) {
  return `Original comment: ${original}
Student work it refers to: ${evidence || "(not available)"}
Teacher's instruction: ${instruction}
${styleProfile ? `Teacher style profile: ${styleProfile}` : ""}`;
}
