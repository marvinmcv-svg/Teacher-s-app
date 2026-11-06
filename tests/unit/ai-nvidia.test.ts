import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
vi.mock("server-only", () => ({}));

const reply = (content: string, finish = "stop") =>
  new Response(
    JSON.stringify({
      choices: [{ message: { content }, finish_reason: finish }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    }),
    {
      status: 200,
    },
  );

describe("callStructured via NVIDIA provider", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.resetModules();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    delete process.env.ANTHROPIC_API_KEY;
    process.env.NVIDIA_API_KEY = "nv-test";
    delete process.env.AI_PROVIDER;
  });
  afterEach(() => vi.unstubAllGlobals());

  it("is selected when only NVIDIA_API_KEY is set; sends images as data URLs and parses fenced JSON", async () => {
    const { callStructured } = await import("@/lib/ai/client");
    fetchMock.mockResolvedValue(reply('<think>hmm</think>\n```json\n{"a": 1}\n```'));
    const out = await callStructured({
      role: "grade",
      promptVersion: "v",
      system: "SYS",
      images: [{ mediaType: "image/jpeg", base64: "AAA", label: "Page 1:" }],
      text: "TEXT",
      schema: z.object({ a: z.number() }),
    });
    expect(out).toEqual({ a: 1 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://integrate.api.nvidia.com/v1/chat/completions");
    expect(init.headers.authorization).toBe("Bearer nv-test");
    const body = JSON.parse(init.body);
    expect(body.model).toBe("deepseek-ai/deepseek-v4.1-flash");
    expect(body.messages[0].content).toContain("JSON Schema");
    expect(body.messages[1].content.map((c: { type: string }) => c.type)).toEqual(["text", "image_url", "text"]);
    expect(body.messages[1].content[1].image_url.url).toBe("data:image/jpeg;base64,AAA");
  });

  it("retries once with schema errors, then succeeds", async () => {
    const { callStructured } = await import("@/lib/ai/client");
    fetchMock.mockResolvedValueOnce(reply('{"a": "x"}')).mockResolvedValueOnce(reply('{"a": 2}'));
    const out = await callStructured({
      role: "grade",
      promptVersion: "v",
      system: "s",
      images: [],
      text: "t",
      schema: z.object({ a: z.number() }),
    });
    expect(out).toEqual({ a: 2 });
    const second = JSON.parse(fetchMock.mock.calls[1][1].body).messages;
    expect(second.map((m: { role: string }) => m.role)).toEqual(["system", "user", "assistant", "user"]);
  });

  it("truncation → AiOutputError", async () => {
    const { callStructured } = await import("@/lib/ai/client");
    fetchMock.mockResolvedValue(reply("{", "length"));
    await expect(
      callStructured({ role: "grade", promptVersion: "v", system: "s", images: [], text: "t", schema: z.object({}) }),
    ).rejects.toThrow(/cut off/);
  });
});
