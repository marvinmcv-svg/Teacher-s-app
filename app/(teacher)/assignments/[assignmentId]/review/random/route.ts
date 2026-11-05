import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getSiteUrl } from "@/lib/site-url";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** Opens a random, not-yet-opened green submission — the sampling step before "Approve all green" (§3.4). */
export async function GET(_req: NextRequest, ctx: RouteContext<"/assignments/[assignmentId]/review/random">) {
  const { assignmentId } = await ctx.params;
  const base = await getSiteUrl();
  if (!z.uuid().safeParse(assignmentId).success) return NextResponse.redirect(new URL("/", base));
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("submissions")
    .select("id, flags")
    .eq("assignment_id", assignmentId)
    .eq("status", "ready")
    .eq("confidence", "high")
    .is("opened_at", null);
  const candidates = (data ?? []).filter((s) => s.flags.length === 0);
  const pick = candidates[Math.floor(Math.random() * candidates.length)];
  return NextResponse.redirect(new URL(`/assignments/${assignmentId}/review${pick ? `/${pick.id}` : ""}`, base));
}
