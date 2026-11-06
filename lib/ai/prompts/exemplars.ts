import { scrubNames } from "@/lib/privacy/names";

export type ExemplarForPrompt = {
  answers: { key: string; text: string | null; status: string }[];
  scores: {
    item_key: string | null;
    score: number;
    max: number;
    level_label: string | null;
    rationale: string | null;
  }[];
  feedback: { glows?: string[]; grows?: { point: string; how: string }[]; next_step?: string | null } | null;
};

/**
 * Teacher-graded exemplars as few-shot text (§8.5, max 3). Built from the
 * transcription (which came from redacted pages) and the teacher's final
 * scores; roster names are scrubbed from anything the teacher typed.
 * Deterministic for a given set of exemplars, so it caches with the system prompt.
 */
export function renderExemplars(list: ExemplarForPrompt[], rosterNames: string[]): string | null {
  if (!list.length) return null;
  const clean = (s: string | null | undefined) => scrubNames((s ?? "").trim(), rosterNames);
  return list
    .slice(0, 3)
    .map((ex, i) => {
      const lines = [`## Exemplar ${i + 1} (graded by the teacher — match this strictness and style)`];
      lines.push("Student answers (transcribed):");
      for (const a of ex.answers)
        lines.push(`- ${a.key}: ${a.status === "no_answer" ? "(no answer)" : clean(a.text) || "(empty)"}`);
      lines.push("Teacher's scores:");
      for (const s of ex.scores)
        lines.push(
          `- ${s.item_key}: ${s.score}/${s.max}${s.level_label ? ` (${clean(s.level_label)})` : ""}${s.rationale ? ` — ${clean(s.rationale)}` : ""}`,
        );
      const fb = ex.feedback;
      if (fb) {
        if (fb.glows?.length) lines.push(`Teacher's glows: ${fb.glows.map(clean).join(" | ")}`);
        if (fb.grows?.length)
          lines.push(`Teacher's grows: ${fb.grows.map((g) => `${clean(g.point)} → ${clean(g.how)}`).join(" | ")}`);
        if (fb.next_step) lines.push(`Teacher's next step: ${clean(fb.next_step)}`);
      }
      return lines.join("\n");
    })
    .join("\n\n");
}
