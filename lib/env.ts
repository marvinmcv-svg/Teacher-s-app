import { z } from "zod";

/**
 * Environment validation. Missing configuration must fail loudly with a
 * human setup message (master prompt §0.2) — never silently degrade.
 */
const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(20),
  NEXT_PUBLIC_SITE_URL: z.url().optional(),
  NEXT_PUBLIC_SENTRY_DSN: z.url().optional(),
});

export type PublicEnv = z.infer<typeof publicSchema>;

export class MissingEnvError extends Error {
  constructor(public readonly missing: string[]) {
    super(
      `Tinta is not configured. Missing or invalid environment variables: ${missing.join(", ")}. ` +
        "Copy .env.example to .env.local and fill them in (see README → Setup).",
    );
    this.name = "MissingEnvError";
  }
}

function read(source: Record<string, string | undefined>): PublicEnv {
  // Next.js inlines NEXT_PUBLIC_* only when accessed statically, so list them explicitly.
  const parsed = publicSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: source.NEXT_PUBLIC_SUPABASE_URL || undefined,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: source.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || undefined,
    NEXT_PUBLIC_SITE_URL: source.NEXT_PUBLIC_SITE_URL || undefined,
    NEXT_PUBLIC_SENTRY_DSN: source.NEXT_PUBLIC_SENTRY_DSN || undefined,
  });
  if (!parsed.success) {
    throw new MissingEnvError([...new Set(parsed.error.issues.map((i) => String(i.path[0])))]);
  }
  return parsed.data;
}

export function getPublicEnv(): PublicEnv {
  return read({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
    NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
  });
}

export function isSupabaseConfigured(): boolean {
  try {
    getPublicEnv();
    return true;
  } catch {
    return false;
  }
}

/** Exposed for tests. */
export const __readEnvForTest = read;
