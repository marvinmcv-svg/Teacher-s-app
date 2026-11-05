import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
vi.mock("server-only", () => ({}));

const parse = vi.fn();
vi.mock("@anthropic-ai/sdk", () => {
  class APIError extends Error {
    status?: number;
  }
  class Anthropic {
    static APIError = APIError;
    messages = { parse };
  }
  return { default: Anthropic };
});

const usage = { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 500, cache_creation_input_tokens: 0 };
const ok = (parsed: unknown) => ({ stop_reason: "end_turn", stop_details: null, parsed_output: parsed, usage });

describe("callStructured (Claude client wrapper)", () => {
  beforeEach(() => {
    parse.mockReset();
    process.env.ANTHROPIC_API_KEY = "test-key";
  });

  it("fails loudly without an API key", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    vi.resetModules();
    const { callStructured } = await import("@/lib/ai/client");
    await expect(
      callStructured({ role: "grade", promptVersion: "v", system: "s", images: [], text: "t", schema: z.object({}) }),
    ).rejects.toThrow(/ANTHROPIC_API_KEY/);
  });

  it("sends images before text, explicit effort, adaptive thinking, JSON outputs, no sampling params", async () => {
    vi.resetModules();
    const { callStructured } = await import("@/lib/ai/client");
    parse.mockResolvedValue(ok({ a: 1 }));
    const records: unknown[] = [];
    const out = await callStructured({
      role: "grade",
      promptVersion: "grade.v2",
      system: "SYS",
      context: "CTX",
      images: [{ mediaType: "image/jpeg", base64: "AAA", label: "Page 1:" }],
      text: "TEXT",
      schema: z.object({ a: z.number() }),
      onRecord: (r) => void records.push(r),
    });
    expect(out).toEqual({ a: 1 });
    const req = parse.mock.calls[0][0];
    expect(req.model).toBe("claude-sonnet-5-5");
    expect(req.output_config.effort).toBe("medium");
    expect(req.output_config.format.type).toBe("json_schema");
    expect(req.thinking).toEqual({ type: "adaptive" });
    for (const k of ["temperature", "top_p", "top_k", "tool_choice"]) expect(req).not.toHaveProperty(k);
    expect(req.system.map((b: { text: string }) => b.text)).toEqual(["SYS", "CTX"]);
    expect(req.system.every((b: { cache_control?: unknown }) => b.cache_control)).toBe(true);
    const content = req.messages[0].content;
    expect(content.map((c: { type: string }) => c.type)).toEqual(["text", "image", "text"]);
    expect(content[2].text).toBe("TEXT");
    expect(records).toEqual([
      expect.objectContaining({
        role: "grade",
        model: "claude-sonnet-5-5",
        status: "ok",
        inputTokens: 1000,
        cacheReadTokens: 500,
        costUsd: 0.0041,
      }),
    ]);
  });

  it("refusal → AiRefusalError and a 'refused' record; never parsed", async () => {
    vi.resetModules();
    const { callStructured } = await import("@/lib/ai/client");
    const { AiRefusalError } = await import("@/lib/ai/errors");
    parse.mockResolvedValue({
      stop_reason: "refusal",
      stop_details: { category: "general_harms" },
      parsed_output: null,
      usage,
    });
    const records: { status: string }[] = [];
    await expect(
      callStructured({
        role: "grade",
        promptVersion: "v",
        system: "s",
        images: [],
        text: "t",
        schema: z.object({}),
        onRecord: (r) => void records.push(r),
      }),
    ).rejects.toBeInstanceOf(AiRefusalError);
    expect(records[0].status).toBe("refused");
  });

  it("validation failure → one corrective retry with the errors, then success", async () => {
    vi.resetModules();
    const { callStructured } = await import("@/lib/ai/client");
    parse.mockResolvedValueOnce(ok({ score: 5 })).mockResolvedValueOnce(ok({ score: 2 }));
    const out = await callStructured({
      role: "grade",
      promptVersion: "v",
      system: "s",
      images: [],
      text: "t",
      schema: z.object({ score: z.number() }),
      validate: (d) => (d.score > 3 ? "- items[0].score: must be within 0..3" : null),
    });
    expect(out).toEqual({ score: 2 });
    const retry = parse.mock.calls[1][0].messages;
    expect(retry.map((m: { role: string }) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(retry[2].content).toContain("must be within 0..3");
  });

  it("fails after a second invalid answer, and on truncation", async () => {
    vi.resetModules();
    const { callStructured } = await import("@/lib/ai/client");
    const { AiOutputError } = await import("@/lib/ai/errors");
    parse.mockResolvedValue(ok({ score: 9 }));
    await expect(
      callStructured({
        role: "grade",
        promptVersion: "v",
        system: "s",
        images: [],
        text: "t",
        schema: z.object({ score: z.number() }),
        validate: () => "bad",
      }),
    ).rejects.toBeInstanceOf(AiOutputError);
    parse.mockResolvedValue({ ...ok(null), stop_reason: "max_tokens" });
    await expect(
      callStructured({ role: "grade", promptVersion: "v", system: "s", images: [], text: "t", schema: z.object({}) }),
    ).rejects.toThrow(/cut off/);
  });
});
