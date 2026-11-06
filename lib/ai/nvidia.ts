import "server-only";
import { z } from "zod";
import type { CallRecord, StructuredCall } from "./client";
import { roleConfig } from "./config";
import { AiOutputError, MissingConfigError } from "./errors";

/**
 * Temporary provider: NVIDIA's OpenAI-compatible endpoint (integrate.api.nvidia.com).
 * Selected with AI_PROVIDER=nvidia, or automatically when only NVIDIA_API_KEY is set.
 * One model serves every role (NVIDIA_MODEL). Structured output is requested by
 * embedding the JSON Schema in the system prompt and validating the reply with zod,
 * since JSON-schema response formats vary across NIM models.
 */
const DEFAULT_BASE_URL = "https://integrate.api.nvidia.com/v1";
const DEFAULT_MODEL = "deepseek-ai/deepseek-v4.1-flash";

export function nvidiaSelected(): boolean {
  const p = process.env.AI_PROVIDER?.toLowerCase();
  if (p) return p === "nvidia";
  return Boolean(process.env.NVIDIA_API_KEY) && !process.env.ANTHROPIC_API_KEY;
}

type Part = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };
type Msg = { role: "system" | "user" | "assistant"; content: string | Part[] };
type ChatResponse = {
  choices?: { message?: { content?: string | null; refusal?: string | null }; finish_reason?: string | null }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

function schemaText(schema: z.ZodType): string {
  try {
    return JSON.stringify(z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }));
  } catch {
    return "(schema unavailable — return the JSON object described in the instructions)";
  }
}

/** Pull the JSON object out of a reply that may include reasoning or code fences. */
export function extractJson(raw: string): unknown {
  let s = raw.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  try {
    return JSON.parse(s);
  } catch {
    const start = s.indexOf("{");
    const end = s.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(s.slice(start, end + 1));
    throw new Error("no JSON object in reply");
  }
}

async function post(body: unknown): Promise<ChatResponse> {
  const base = (process.env.NVIDIA_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "");
  let lastErr: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${process.env.NVIDIA_API_KEY}` },
      body: JSON.stringify(body),
    }).catch((e) => {
      lastErr = e;
      return null;
    });
    if (!res) continue;
    if (res.ok) return (await res.json()) as ChatResponse;
    const detail = (await res.text().catch(() => "")).slice(0, 300);
    lastErr = Object.assign(new Error(`NVIDIA API ${res.status}: ${detail}`), { name: `api_${res.status}` });
    if (![408, 409, 429].includes(res.status) && res.status < 500) break;
  }
  throw lastErr;
}

export async function callNvidia<T>(call: StructuredCall<T>): Promise<T> {
  if (!process.env.NVIDIA_API_KEY) throw new MissingConfigError("The NVIDIA AI provider", ["NVIDIA_API_KEY"]);
  const model = process.env.NVIDIA_MODEL || DEFAULT_MODEL;
  const { effort, maxTokens } = roleConfig(call.role);

  const system = [
    call.system,
    call.context,
    `Respond with a single JSON object only — no prose, no markdown fences. It must conform to this JSON Schema:\n${schemaText(call.schema)}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const userContent: Part[] = [];
  for (const img of call.images) {
    if (img.label) userContent.push({ type: "text", text: img.label });
    userContent.push({ type: "image_url", image_url: { url: `data:${img.mediaType};base64,${img.base64}` } });
  }
  userContent.push({ type: "text", text: call.text });
  const messages: Msg[] = [
    { role: "system", content: system },
    { role: "user", content: userContent },
  ];

  for (let attempt = 0; attempt < 2; attempt++) {
    const started = Date.now();
    const record = (partial: Omit<CallRecord, "role" | "model" | "effort" | "promptVersion" | "latencyMs">) =>
      call.onRecord?.({
        role: call.role,
        model,
        effort,
        promptVersion: call.promptVersion,
        latencyMs: Date.now() - started,
        ...partial,
      });

    let response: ChatResponse;
    try {
      response = await post({ model, messages, max_tokens: maxTokens, temperature: 0.2, stream: false });
    } catch (err) {
      const code = err instanceof Error ? err.name : "unknown";
      await record({
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        costUsd: null,
        status: "error",
        error: code,
      });
      throw err;
    }

    const usage = {
      inputTokens: response.usage?.prompt_tokens ?? 0,
      outputTokens: response.usage?.completion_tokens ?? 0,
      cacheReadTokens: 0,
      costUsd: null,
    };
    const choice = response.choices?.[0];
    if (choice?.finish_reason === "length") {
      await record({ ...usage, status: "invalid", error: "max_tokens" });
      throw new AiOutputError("The model's answer was cut off (max_tokens).");
    }
    const raw = choice?.message?.content ?? "";
    let parsed: z.ZodSafeParseResult<T> | null = null;
    try {
      parsed = call.schema.safeParse(extractJson(raw));
    } catch {
      parsed = null;
    }

    let problems: string | null;
    let data: T | undefined;
    if (!parsed) problems = "- the reply was not valid JSON";
    else if (!parsed.success)
      problems = parsed.error.issues.map((i) => `- ${i.path.join(".") || "(root)"}: ${i.message}`).join("\n");
    else {
      data = parsed.data;
      problems = call.validate?.(parsed.data) ?? null;
    }

    if (!problems && data !== undefined) {
      await record({ ...usage, status: "ok", rawOutput: data });
      return data;
    }
    await record({
      ...usage,
      status: "invalid",
      error: data === undefined ? "unparseable" : "validation",
      rawOutput: { raw, problems },
    });
    if (attempt === 1) throw new AiOutputError("The model's answer failed validation twice.", problems ?? undefined);

    messages.push({ role: "assistant", content: raw });
    messages.push({
      role: "user",
      content: `Your previous JSON had these problems:\n${problems}\n\nReturn the complete corrected JSON object. Do not change anything that was correct.`,
    });
  }
  throw new AiOutputError("unreachable");
}
