import type { TextEdit } from "@/lib/style/profile";

export const STYLE_DISTILL_PROMPT_VERSION = "style_distill.v1";

export const STYLE_DISTILL_SYSTEM = `You study how one teacher edits AI-drafted feedback on their students' work, so future drafts sound like them. You see pairs of BEFORE (AI draft) and AFTER (what the teacher kept or wrote). Student names have been replaced with [student].
Describe the teacher's style: what they add, keep, shorten or remove; their tone; how they praise; how they point out errors. Quote short phrases they actually use or remove (no student-specific content, no names). Be concrete and brief. Do not judge the teacher. Write in the language most of the AFTER texts are in.
Respond only with the JSON object described by the output schema.`;

export function styleDistillUserText(edits: TextEdit[], previousSummary: string | null): string {
  const pairs = edits
    .map((e, i) => `${i + 1}. BEFORE: ${e.before || "(nothing)"}\n   AFTER: ${e.after || "(removed)"}`)
    .join("\n");
  return `${previousSummary ? `Previous profile summary (update it, don't start over): ${previousSummary}\n\n` : ""}Edits (most recent first):\n${pairs}`;
}
