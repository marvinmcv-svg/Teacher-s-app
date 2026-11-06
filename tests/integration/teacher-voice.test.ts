/**
 * Teacher voice (§3.7) on local Supabase: comment-bank dedupe, and the style
 * profile distilled from edits with names scrubbed. TEST-ONLY fake model.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

import type { StructuredCall } from "@/lib/ai/client";
import { addToBank } from "@/lib/actions/comment-bank-store";
import { distillStyleProfile, loadStyleProfile } from "@/lib/pipeline/style-profile";
import { getAdminClient } from "@/lib/supabase/admin";

const db = getAdminClient();
let teacherId = "";

beforeAll(async () => {
  const { data: u, error } = await db.auth.admin.createUser({
    email: `voice-${Date.now()}@tinta.test`,
    email_confirm: true,
  });
  if (error) throw error;
  teacherId = u.user.id;
  const { data: cls } = await db.from("classes").insert({ teacher_id: teacherId, name: "5A" }).select().single();
  await db.from("students").insert({ class_id: cls!.id, display_name: "Ana Pérez" });
});
afterAll(async () => {
  if (!process.env.KEEP_TEST_DATA) await db.auth.admin.deleteUser(teacherId);
});

describe("comment bank", () => {
  it("dedupes by normalised text, counts uses, and teacher-written wins", async () => {
    await addToBank(db as never, teacherId, [
      { text: "Revisa el signo.", locale: "es", subject: "Mate", tags: ["error"], source: "ai_approved" },
    ]);
    await addToBank(db as never, teacherId, [
      { text: "  revisa el signo.  ", locale: "es", subject: "Mate", tags: ["signos"], source: "teacher" },
      { text: "ok", locale: "es", subject: null, source: "teacher" }, // too short: ignored
    ]);
    const { data } = await db.from("comment_bank").select("text, uses, source, tags").eq("teacher_id", teacherId);
    expect(data).toEqual([{ text: "Revisa el signo.", uses: 2, source: "teacher", tags: ["error", "signos"] }]);
  });
});

describe("style profile", () => {
  it("is skipped below the edit threshold, then built from scrubbed edits", async () => {
    const seen: string[] = [];
    const fake = async <T>(call: StructuredCall<T>): Promise<T> => {
      seen.push(call.text);
      return {
        summary: "Comentarios breves y cálidos.",
        preferred_phrases: ["¡Vas bien, Ana!"],
        avoid_phrases: ["Excelente trabajo"],
        typical_length: "short",
        tone: "cálido",
        praise_style: "específico",
        correction_style: "con una pregunta",
      } as T;
    };
    expect(await distillStyleProfile(db, fake, teacherId)).toEqual({ skipped: true });
    const ids = Array.from({ length: 12 }, () => crypto.randomUUID());
    await db.from("teacher_edits").insert(
      ids.map((id, i) => ({
        teacher_id: teacherId,
        target_table: "annotations",
        target_id: id,
        before: { text: `Excelente trabajo ${i}` },
        after: { text: `¡Vas bien, Ana! Mira el paso ${i}.` },
      })),
    );
    const res = await distillStyleProfile(db, fake, teacherId);
    expect(res).toEqual({ skipped: false, version: 1 });
    expect(seen.join("\n")).not.toMatch(/Ana/);
    expect(seen.join("\n")).toContain("[student]");
    const p = await loadStyleProfile(db, teacherId);
    expect(p!.preferred_phrases).toEqual(["¡Vas bien, [student]!"]); // scrubbed on the way out too
    expect(p!.comment_words_median).toBe(7);
    const { data: runs } = await db.from("grading_runs").select("kind").eq("teacher_id", teacherId);
    expect(runs).toEqual([]); // fake model doesn't record; the real client records with teacher_id
  });
});
