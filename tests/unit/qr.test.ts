import QRCode from "qrcode";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { decodePageQr } from "@/lib/qr/decode-image";
import { encodeQr, parseQr, splitByQr, stickerRedactionBox, type PageQr } from "@/lib/qr/payload";

const TOKEN = "0123456789abcdef0123456789abcdef";
const OTHER = "fedcba9876543210fedcba9876543210";

describe("QR payload", () => {
  it("round-trips and never carries a name", () => {
    const s = encodeQr("sticker", TOKEN);
    expect(s).toBe(`TINTA:S:${TOKEN.toUpperCase()}`);
    expect(parseQr(s)).toEqual({ kind: "sticker", token: TOKEN });
    expect(parseQr(encodeQr("cover", TOKEN))).toEqual({ kind: "cover", token: TOKEN });
  });
  it("rejects foreign codes and malformed tokens", () => {
    expect(parseQr("https://example.com")).toBeNull();
    expect(parseQr("TINTA:S:123")).toBeNull();
    expect(parseQr(null)).toBeNull();
    expect(() => encodeQr("sticker", "Ana Pérez")).toThrow();
  });
  it("redaction strip covers the QR and the printed name to its right", () => {
    const r = stickerRedactionBox({ x: 0.6, y: 0.05, w: 0.08, h: 0.06 });
    expect(r.x).toBeLessThan(0.6);
    expect(r.x + r.w).toBeGreaterThan(0.6 + 0.08 * 3);
    expect(r.x + r.w).toBeLessThanOrEqual(1);
  });
});

describe("splitByQr", () => {
  const cover = (token: string): PageQr => ({ kind: "cover", token });
  const sticker = (token: string): PageQr => ({ kind: "sticker", token });

  it("falls back to fixed chunks when there are no codes", () => {
    expect(splitByQr([null, null, null, null, null], 2)).toEqual([
      { token: null, pages: [0, 1] },
      { token: null, pages: [2, 3] },
      { token: null, pages: [4] },
    ]);
  });
  it("cover sheets start a student and are dropped", () => {
    expect(splitByQr([cover(TOKEN), null, null, cover(OTHER), null], 1)).toEqual([
      { token: TOKEN, pages: [1, 2] },
      { token: OTHER, pages: [4] },
    ]);
  });
  it("stickers group following uncoded pages; leading uncoded pages stay unmatched", () => {
    expect(splitByQr([null, sticker(TOKEN), null, sticker(OTHER), sticker(OTHER)], 1)).toEqual([
      { token: null, pages: [0] },
      { token: TOKEN, pages: [1, 2] },
      { token: OTHER, pages: [3, 4] },
    ]);
  });
  it("a cover followed by the same student's sticker stays one group", () => {
    expect(splitByQr([cover(TOKEN), sticker(TOKEN), null], 1)).toEqual([{ token: TOKEN, pages: [1, 2] }]);
  });
});

describe("decodePageQr", () => {
  async function page(qrAt: { x: number; y: number; size: number } | null) {
    const base = sharp({ create: { width: 1700, height: 2200, channels: 3, background: "#f4f1ea" } });
    if (!qrAt) return base.jpeg().toBuffer();
    const qr = await QRCode.toBuffer(encodeQr("sticker", TOKEN), { margin: 2, width: qrAt.size });
    return base
      .composite([{ input: qr, left: qrAt.x, top: qrAt.y }])
      .jpeg({ quality: 85 })
      .toBuffer();
  }
  it("finds a sticker and returns its box on the page", async () => {
    const hit = await decodePageQr(await page({ x: 1200, y: 100, size: 260 }));
    expect(hit?.token).toBe(TOKEN);
    expect(hit?.kind).toBe("sticker");
    expect(hit!.box!.x).toBeGreaterThan(0.65);
    expect(hit!.box!.y).toBeLessThan(0.2);
  });
  it("finds a small sticker via the quarter scan", async () => {
    const hit = await decodePageQr(await page({ x: 1450, y: 1900, size: 130 }));
    expect(hit?.token).toBe(TOKEN);
    expect(hit!.box!.y).toBeGreaterThan(0.8);
  });
  it("returns null on a page without a code", async () => {
    expect(await decodePageQr(await page(null))).toBeNull();
  });
});
