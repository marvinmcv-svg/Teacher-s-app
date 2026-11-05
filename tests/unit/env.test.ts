import { describe, expect, it } from "vitest";
import { MissingEnvError, __readEnvForTest } from "@/lib/env";
import { isPublicPath } from "@/lib/supabase/proxy";

describe("env", () => {
  it("fails loudly naming the missing variables", () => {
    expect(() => __readEnvForTest({})).toThrow(MissingEnvError);
    try {
      __readEnvForTest({ NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co" });
    } catch (e) {
      expect((e as MissingEnvError).missing).toEqual(["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"]);
    }
  });
  it("accepts a complete config", () => {
    expect(
      __readEnvForTest({
        NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_xxxxxxxxxxxxxxxx",
      }).NEXT_PUBLIC_SUPABASE_URL,
    ).toBe("https://x.supabase.co");
  });
});

describe("isPublicPath", () => {
  it.each([
    ["/login", true],
    ["/auth/callback", true],
    ["/s/abc123", true],
    ["/settings", false],
    ["/", false],
    ["/classes/1", false],
    ["/loginx", false],
  ])("%s → %s", (p, expected) => expect(isPublicPath(p)).toBe(expected));
});

import { safeNextPath } from "@/lib/safe-redirect";
describe("safeNextPath", () => {
  it.each([
    ["/classes/1", "/classes/1"],
    ["//evil.com", "/"],
    ["https://evil.com", "/"],
    ["/\\evil.com", "/"],
    [null, "/"],
    ["/ok\nSet-Cookie: x", "/"],
  ])("%s → %s", (input, expected) => expect(safeNextPath(input)).toBe(expected));
});
