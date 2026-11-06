import { getTranslations } from "next-intl/server";
import { safeFileName } from "@/lib/marking/filenames";
import { teacherCanSee } from "@/lib/marking/load";
import { buildMarkedZip } from "@/lib/marking/zip";
import { getAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 300; // a class of 30–40 two-page papers renders well within this

/**
 * Every approved paper of the assignment as marked JPEGs in one zip, named
 * "Last, First.jpg" so the files sort by last name.
 */
export async function GET(_req: Request, ctx: RouteContext<"/api/assignments/[assignmentId]/marked.zip">) {
  const { assignmentId } = await ctx.params;
  if (!(await teacherCanSee("assignments", assignmentId))) return new Response("Not found", { status: 404 });
  const db = getAdminClient();
  const [{ data: a }, { data: subs }] = await Promise.all([
    db.from("assignments").select("title").eq("id", assignmentId).single(),
    db.from("submissions").select("id").eq("assignment_id", assignmentId).eq("status", "approved"),
  ]);
  if (!subs?.length) return new Response("Nothing approved yet", { status: 409 });
  const t = await getTranslations("download");
  const { zip } = await buildMarkedZip(
    subs.map((s) => s.id),
    t("unnamed"),
  );
  const name = `${safeFileName(a?.title ?? "tinta")}.zip`;
  return new Response(new Uint8Array(zip), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="tinta.zip"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "private, no-store",
    },
  });
}
