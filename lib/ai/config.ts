import aiConfig from "@/config/ai.json";

export type AiRole = keyof typeof aiConfig.roles;
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

const ENV_OVERRIDE: Partial<Record<AiRole, string>> = {
  name_read: "TINTA_MODEL_FAST",
  transcribe: "TINTA_MODEL_GRADER",
  grade: "TINTA_MODEL_GRADER",
  key_extract: "TINTA_MODEL_GRADER",
  regenerate: "TINTA_MODEL_GRADER",
  verify: "TINTA_MODEL_VERIFIER",
  style_distill: "TINTA_MODEL_GRADER",
  mini_lesson: "TINTA_MODEL_GRADER",
};

export function roleConfig(role: AiRole): { model: string; effort: Effort; maxTokens: number } {
  const base = aiConfig.roles[role];
  const envKey = ENV_OVERRIDE[role];
  const model = (envKey && process.env[envKey]) || base.model;
  return { model, effort: base.effort as Effort, maxTokens: base.max_tokens };
}

type Usage = {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
};

/** Cost in USD from config prices. Unknown model → null (never guess). Cache writes billed at 1.25× input. */
export function costUsd(model: string, usage: Usage): number | null {
  const prices = (aiConfig.prices_per_mtok as Record<string, { input: number; output: number; cache_read: number }>)[
    model
  ];
  if (!prices) return null;
  const cost =
    (usage.input_tokens * prices.input +
      usage.output_tokens * prices.output +
      (usage.cache_read_input_tokens ?? 0) * prices.cache_read +
      (usage.cache_creation_input_tokens ?? 0) * prices.input * 1.25) /
    1_000_000;
  return Math.round(cost * 1e6) / 1e6;
}

export const imageConfig = aiConfig.image;
export const bandThresholds = aiConfig.confidence_bands;
export const perTeacherConcurrency = aiConfig.per_teacher_concurrency;
export const styleProfileConfig = aiConfig.style_profile;
