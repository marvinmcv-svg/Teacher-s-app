import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import { costUsd, roleConfig, type AiRole } from "./config";
import { AiOutputError, AiRefusalError, MissingConfigError } from "./errors";

let client: Anthropic | null = null;

/** Fails loudly when the key is missing (§0.2) — never silently skips AI. */
export function getAnthropic(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) throw new MissingConfigError("The Claude API", ["ANTHROPIC_API_KEY"]);
  client ??= new Anthropic({ maxRetries: 3 }); // SDK retries 408/409/429/5xx with backoff + retry-after
  return client;
}

export type ImageInput = { mediaType: "image/jpeg" | "image/png" | "image/webp"; base64: string; label?: string };

export type CallRecord = {
  role: AiRole;
  model: string;
  effort: string;
  promptVersion: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  costUsd: number | null;
  latencyMs: number;
  status: "ok" | "refused" | "invalid" | "error";
  error?: string;
  rawOutput?: unknown;
};

export type StructuredCall<T> = {
  role: AiRole;
  promptVersion: string;
  /** Stable, cacheable instructions (system prompt). */
  system: string;
  /** Stable per-assignment context, cached separately. Optional. */
  context?: string;
  images: ImageInput[];
  /** Per-request instructions/data, placed after the images (§6.1: images first). */
  text: string;
  schema: z.ZodType<T>;
  /** Business-rule validation; returning issues triggers one corrective retry (§8.3). */
  validate?: (data: T) => string | null;
  onRecord?: (rec: CallRecord) => Promise<void> | void;
};

/** The single entry point for model calls. JSON outputs only — no forced tool_choice (400 on 5.5 models). */
export async function callStructured<T>(call: StructuredCall<T>): Promise<T> {
  const anthropic = getAnthropic();
  const { model, effort, maxTokens } = roleConfig(call.role);

  const system: Anthropic.TextBlockParam[] = [
    { type: "text", text: call.system, cache_control: { type: "ephemeral" } },
  ];
  if (call.context) system.push({ type: "text", text: call.context, cache_control: { type: "ephemeral" } });

  const userContent: Anthropic.ContentBlockParam[] = [];
  for (const img of call.images) {
    if (img.label) userContent.push({ type: "text", text: img.label });
    userContent.push({ type: "image", source: { type: "base64", media_type: img.mediaType, data: img.base64 } });
  }
  userContent.push({ type: "text", text: call.text });

  const messages: Anthropic.MessageParam[] = [{ role: "user", content: userContent }];

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

    let response;
    try {
      // No temperature/top_p/top_k (400 on current models), no prefill, no forced tool_choice.
      response = await anthropic.messages.parse({
        model,
        max_tokens: maxTokens,
        thinking: { type: "adaptive" },
        output_config: { effort, format: zodOutputFormat(call.schema) },
        system,
        messages,
      });
    } catch (err) {
      await record({
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        costUsd: null,
        status: "error",
        error: errorCode(err),
      });
      throw err;
    }

    const usage = {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
      costUsd: costUsd(model, response.usage),
    };

    if (response.stop_reason === "refusal") {
      const category = response.stop_details?.category ?? null;
      await record({ ...usage, status: "refused", error: `refusal:${category ?? "unknown"}` });
      throw new AiRefusalError(category);
    }
    if (response.stop_reason === "max_tokens") {
      await record({ ...usage, status: "invalid", error: "max_tokens" });
      throw new AiOutputError("The model's answer was cut off (max_tokens).");
    }
    const data = response.parsed_output as T | null;
    if (data === null || data === undefined) {
      await record({ ...usage, status: "invalid", error: "unparseable" });
      throw new AiOutputError("The model's answer did not match the expected format.");
    }

    const problems = call.validate?.(data) ?? null;
    if (!problems) {
      await record({ ...usage, status: "ok", rawOutput: data });
      return data;
    }
    await record({ ...usage, status: "invalid", error: "validation", rawOutput: { data, problems } });
    if (attempt === 1) throw new AiOutputError("The model's answer failed validation twice.", problems);

    // One corrective retry with the validation errors (§8.3). Assistant turn is history, not a prefill.
    messages.push({ role: "assistant", content: JSON.stringify(data) });
    messages.push({
      role: "user",
      content: `Your previous JSON had these problems:\n${problems}\n\nReturn the complete corrected JSON object. Do not change anything that was correct.`,
    });
  }
  throw new AiOutputError("unreachable");
}

function errorCode(err: unknown): string {
  if (err instanceof Anthropic.APIError) return `api_${err.status ?? "error"}`;
  if (err instanceof Error) return err.name;
  return "unknown";
}
