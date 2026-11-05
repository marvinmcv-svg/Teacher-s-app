/**
 * Release-token isolation (§9): a token exposes only its own submission;
 * revoked/expired/unknown tokens expose nothing; unapproved work can't be released.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { loadReleaseByToken } from "@/lib/release/load";
import { newReleaseToken } from "@/lib/release/tokens";
import { getAdminClient } from "@/lib/supabase/admin";

const db = getAdminClient();
let teacherId = "";
const subs: Record<string, string> = {};

beforeAll(async () => {
  const { data: u, error } = await db.auth.admin.createUser({
    email: `rel-${Date.now()}@tinta.test`,
    email_confirm: true,
  });
  if (error) throw error;
  teacherId = u.user.id;
  const { data: cls } = await db.from("classes").insert({ teacher_id: teacherId, name: "R" }).select().single();
  const { data: students } = await db
    .from("students")
    .insert([
      { class_id: cls!.id, display_name: "Ana" },
      { class_id: cls!.id, display_name: "Luis" },
      { class_id: cls!.id, display_name: "Sofía" },
    ])
    .select();
  const { data: a } = await db
    .from("assignments")
    .insert({
      class_id: cls!.id,
      title: "T",
      scale: { type: "numeric", preset: "bo_100", min: 1, max: 100, pass_mark: 51, decimals: 0 },
      feedback_settings: { show_score: true },
    })
    .select()
    .single();
  for (const [i, key] of ["ana", "luis", "sofia"].entries()) {
    const { data: s } = await db
      .from("submissions")
      .insert({
        assignment_id: a!.id,
        student_id: students![i].id,
        status: key === "sofia" ? "ready" : "approved",
        total_score: 3,
        total_max: 5,
      })
      .select()
      .single();
    subs[key] = s!.id;
    await db
      .from("feedback")
      .insert({ submission_id: s!.id, locale: "es", glows: [`glow ${key}`], grows: [], next_step: "x" });
  }
});

afterAll(async () => {
  await db.auth.admin.deleteUser(teacherId);
});

describe("release tokens", () => {
  it("a token returns exactly its own submission", async () => {
    const tA = newReleaseToken();
    const tL = newReleaseToken();
    await db.from("releases").insert([
      { submission_id: subs.ana, token: tA, channel: "link" },
      { submission_id: subs.luis, token: tL, channel: "link" },
    ]);
    await db.from("submissions").update({ status: "released" }).in("id", [subs.ana, subs.luis]);
    const a = await loadReleaseByToken(tA);
    const l = await loadReleaseByToken(tL);
    expect(a?.submissionId).toBe(subs.ana);
    expect(a?.studentName).toBe("Ana");
    expect(a?.feedback.glows).toEqual(["glow ana"]);
    expect(JSON.stringify(a)).not.toContain("luis");
    expect(l?.submissionId).toBe(subs.luis);
    expect(a?.grade?.display).toBe("60"); // 1 + 99 × 0.6 = 60.4 → 60
    const { data: rel } = await db.from("releases").select("viewed_at").eq("token", tA).single();
    expect(rel!.viewed_at).not.toBeNull();
  });

  it("unknown, malformed, revoked and expired tokens expose nothing", async () => {
    expect(await loadReleaseByToken(newReleaseToken())).toBeNull();
    expect(await loadReleaseByToken("../../etc/passwd")).toBeNull();
    const tR = newReleaseToken();
    const tE = newReleaseToken();
    await db.from("releases").insert([
      { submission_id: subs.ana, token: tR, channel: "link", revoked_at: new Date().toISOString() },
      { submission_id: subs.ana, token: tE, channel: "link", expires_at: new Date(Date.now() - 1000).toISOString() },
    ]);
    expect(await loadReleaseByToken(tR)).toBeNull();
    expect(await loadReleaseByToken(tE)).toBeNull();
  });

  it("unapproved work cannot be released (DB trigger)", async () => {
    const { error } = await db
      .from("releases")
      .insert({ submission_id: subs.sofia, token: newReleaseToken(), channel: "link" });
    expect(error?.message).toMatch(/approved before release/);
  });

  it("a token for work that was un-released (reopened) exposes nothing", async () => {
    const t = newReleaseToken();
    await db.from("releases").insert({ submission_id: subs.luis, token: t, channel: "link" });
    await db.from("submissions").update({ status: "approved" }).eq("id", subs.luis);
    expect(await loadReleaseByToken(t)).toBeNull();
  });
});
