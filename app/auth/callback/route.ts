import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/safe-redirect";
import { getSiteUrl } from "@/lib/site-url";

// OAuth (Google) and magic-link (PKCE) both land here with ?code=...
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  // Not request.nextUrl.origin: behind `next start`/proxies it can resolve to
  // localhost, which would drop the session cookie set for the real host.
  const origin = await getSiteUrl();
  const code = searchParams.get("code");
  const next = safeNextPath(searchParams.get("next"));
  if (code) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, origin));
    console.error("auth.callback_failed", { code: error.code });
  }
  return NextResponse.redirect(new URL("/login?error=callback", origin));
}
