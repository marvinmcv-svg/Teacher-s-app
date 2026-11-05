import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { describe, expect, it } from "vitest";
import * as S from "@/lib/ai/schemas";

describe("AI schemas → JSON outputs", () => {
  it.each([
    ["transcription", S.TranscriptionSchema],
    ["grade", S.GradeSchema],
    ["verification", S.VerificationSchema],
    ["key extraction", S.KeyExtractionSchema],
    ["name read", S.NameReadSchema],
    ["regenerate", S.RegenerateSchema],
  ])("%s converts to a strict JSON schema", (_n, schema) => {
    const fmt = zodOutputFormat(schema) as unknown as { type: string; schema: Record<string, unknown> };
    expect(fmt.type).toBe("json_schema");
    const json = JSON.stringify(fmt.schema);
    expect(json).toContain('"additionalProperties":false');
    // every object lists all its properties as required (strict mode)
    const walk = (node: unknown): void => {
      if (!node || typeof node !== "object") return;
      const n = node as Record<string, unknown>;
      if (n.type === "object" && n.properties) {
        expect(Object.keys(n.properties as object).sort()).toEqual([...((n.required as string[]) ?? [])].sort());
      }
      Object.values(n).forEach(walk);
    };
    walk(fmt.schema);
  });
});
