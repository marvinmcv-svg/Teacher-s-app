import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import QRCode from "qrcode";
import { z } from "zod";
import { getSiteUrl } from "@/lib/site-url";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** Class QR sheet (§3.5c): one QR per released student link, cut-out grid on A4. */
export async function GET(_req: Request, ctx: RouteContext<"/api/assignments/[assignmentId]/qr-sheet.pdf">) {
  const { assignmentId } = await ctx.params;
  if (!z.uuid().safeParse(assignmentId).success) return new Response("Not found", { status: 404 });
  const supabase = await createSupabaseServerClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return new Response("Unauthorized", { status: 401 });
  const { data: a } = await supabase.from("assignments").select("id, title").eq("id", assignmentId).maybeSingle();
  if (!a) return new Response("Not found", { status: 404 });
  const { data: subs } = await supabase
    .from("submissions")
    .select("id, students!submissions_student_id_fkey(display_name), releases(token, revoked_at)")
    .eq("assignment_id", a.id)
    .eq("status", "released");
  const base = await getSiteUrl();
  const entries = (subs ?? [])
    .map((s) => ({
      name: (s.students as unknown as { display_name: string } | null)?.display_name ?? "—",
      token: (s.releases as unknown as { token: string; revoked_at: string | null }[]).find((r) => !r.revoked_at)
        ?.token,
    }))
    .filter((e): e is { name: string; token: string } => !!e.token)
    .sort((x, y) => x.name.localeCompare(y.name));

  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const [W, H] = [595.28, 841.89];
  const cols = 3;
  const rows = 4;
  const cellW = (W - 60) / cols;
  const cellH = (H - 90) / rows;
  const safe = (s: string) =>
    [...s]
      .map((c) => {
        try {
          font.encodeText(c);
          return c;
        } catch {
          return "?";
        }
      })
      .join("");
  for (let i = 0; i < Math.max(entries.length, 1); i += cols * rows) {
    const page = pdf.addPage([W, H]);
    page.drawText(safe(a.title).slice(0, 80), { x: 30, y: H - 40, size: 14, font: bold });
    for (const [j, e] of entries.slice(i, i + cols * rows).entries()) {
      const cx = 30 + (j % cols) * cellW;
      const cy = H - 60 - Math.floor(j / cols) * cellH;
      page.drawRectangle({
        x: cx + 4,
        y: cy - cellH + 4,
        width: cellW - 8,
        height: cellH - 8,
        borderColor: rgb(0.8, 0.78, 0.74),
        borderWidth: 0.5,
        borderDashArray: [4, 3],
      });
      const png = await QRCode.toBuffer(`${base}/s/${e.token}`, { errorCorrectionLevel: "M", margin: 1, width: 360 });
      const img = await pdf.embedPng(png);
      const size = Math.min(cellW, cellH) - 50;
      page.drawImage(img, { x: cx + (cellW - size) / 2, y: cy - size - 14, width: size, height: size });
      page.drawText(safe(e.name).slice(0, 34), { x: cx + 12, y: cy - cellH + 20, size: 10, font });
    }
  }
  return new Response(Buffer.from(await pdf.save()), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="qr.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
