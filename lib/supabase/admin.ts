import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { MissingConfigError } from "@/lib/ai/errors";
import type { Database } from "@/lib/db/types";

export type AdminClient = SupabaseClient<Database>;
let admin: AdminClient | null = null;

/**
 * Service-role client — bypasses RLS. Only for the grading pipeline and the
 * token-validated student route. Never import from client components.
 */
export function getAdminClient(): AdminClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key)
    throw new MissingConfigError("The Supabase service key", ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SECRET_KEY"]);
  admin ??= createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return admin;
}

export const BUCKETS = { original: "pages-original", redacted: "pages-redacted", exports: "exports" } as const;
