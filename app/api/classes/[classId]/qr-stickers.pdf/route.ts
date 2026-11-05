import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { renderCoverSheets, renderStickerSheet } from "@/lib/qr/sheets";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * QR name stickers / cover sheets for a class (§3.2 matching priority 1).
 * `?layout=stickers|covers`, `&copies=1..4` (stickers only — one per worksheet).
 */
export async function GET(req: Request, ctx: RouteContext<"/api/classes/[classId]/qr-stickers.pdf">) {
  const { classId } = await ctx.params;
  if (!z.uuid().safeParse(classId).success) return new Response("Not found", { status: 404 });
  const url = new URL(req.url);
  const layout = url.searchParams.get("layout") === "covers" ? "covers" : "stickers";
  const copies = Math.min(4, Math.max(1, Number(url.searchParams.get("copies")) || 1));
  const supabase = await createSupabaseServerClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return new Response("Unauthorized", { status: 401 });
  const { data: cls } = await supabase.from("classes").select("id, name").eq("id", classId).maybeSingle();
  if (!cls) return new Response("Not found", { status: 404 });
  const { data: students } = await supabase
    .from("students")
    .select("display_name, qr_code_token")
    .eq("class_id", cls.id)
    .eq("active", true)
    .order("display_name");
  const t = await getTranslations("qr");
  const strings = {
    className: cls.name,
    coverTitle: t("coverTitle"),
    coverInstructions: t("coverInstructions"),
    stickerHint: t("stickerHint"),
  };
  const list = (students ?? []).map((s) => ({ name: s.display_name, token: s.qr_code_token }));
  const bytes =
    layout === "covers" ? await renderCoverSheets(list, strings) : await renderStickerSheet(list, strings, copies);
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${layout}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
