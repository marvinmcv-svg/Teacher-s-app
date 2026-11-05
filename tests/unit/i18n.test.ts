import { describe, expect, it } from "vitest";
import { negotiateLocale } from "@/lib/i18n/config";
import es from "@/messages/es.json";
import en from "@/messages/en.json";

function keys(obj: Record<string, unknown>, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === "object" ? keys(v as Record<string, unknown>, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}

describe("i18n", () => {
  it("es and en message files have identical keys", () => {
    expect(keys(en).sort()).toEqual(keys(es).sort());
  });
  it("no message is empty", () => {
    for (const [name, msgs] of [
      ["es", es],
      ["en", en],
    ] as const) {
      const flat = keys(msgs);
      expect(flat.length, name).toBeGreaterThan(0);
    }
  });
  it.each([
    ["es-BO,es;q=0.9,en;q=0.8", "es"],
    ["en-US,en;q=0.9", "en"],
    ["fr-FR,en;q=0.5", "en"],
    ["de-DE", "es"],
    [null, "es"],
  ])("negotiateLocale(%s) = %s", (header, expected) => {
    expect(negotiateLocale(header)).toBe(expected);
  });
});
