import { describe, expect, it } from "vitest";
import { redactString, scrubBreadcrumb, scrubEvent } from "@/lib/observability/scrub";

describe("Sentry scrubbing", () => {
  it("drops request bodies, cookies, headers, query strings and user", () => {
    const out = scrubEvent({
      request: {
        url: "https://app/classes/1?name=Ana",
        data: "Ana Pérez",
        cookies: { a: "b" },
        headers: { cookie: "x" },
      },
      user: { email: "t@x" },
      extra: { transcription: "2+2=5" },
    });
    expect(out).toEqual({ request: { url: "https://app/classes/1" } });
  });
  it("redacts student share tokens", () => {
    expect(redactString("GET /s/3f9a1c2b4d5e6f708192a3b4c5d6e7f8a9b0c1d2 404")).toBe("GET /s/[redacted] 404");
  });
  it("removes console and ui breadcrumbs", () => {
    expect(scrubBreadcrumb({ category: "console", message: "Ana Pérez" })).toBeNull();
    expect(scrubBreadcrumb({ category: "ui.click", message: "Ana" })).toBeNull();
    expect(scrubBreadcrumb({ category: "fetch", data: { url: "/api/x?student=Ana", body: "x" } })).toEqual({
      category: "fetch",
      data: { url: "/api/x" },
    });
  });
});
