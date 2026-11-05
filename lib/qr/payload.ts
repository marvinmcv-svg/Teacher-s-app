/**
 * Tinta QR codes (§3.2 student matching, priority 1).
 *
 * Payload: `TINTA:S:<token>` on a name sticker stuck on the work itself, or
 * `TINTA:C:<token>` on a cover sheet placed on top of a student's pages.
 * The token is the student's random 128-bit `qr_code_token` — never a name —
 * written in upper-case hex so the code uses the compact QR alphanumeric mode.
 */
import jsQR from "jsqr";

export type QrKind = "sticker" | "cover";
export type TintaQr = {
  kind: QrKind;
  token: string;
  /** Normalised 0..1 bounding box of the code on the image it was read from. */
  box: { x: number; y: number; w: number; h: number } | null;
};

const PATTERN = /^TINTA:(S|C):([0-9A-F]{32})$/i;

export function encodeQr(kind: QrKind, token: string): string {
  if (!/^[0-9a-f]{32}$/i.test(token)) throw new Error("invalid qr token");
  return `TINTA:${kind === "cover" ? "C" : "S"}:${token.toUpperCase()}`;
}

export function parseQr(text: string | null | undefined): Omit<TintaQr, "box"> | null {
  const m = PATTERN.exec((text ?? "").trim());
  if (!m) return null;
  return { kind: m[1].toUpperCase() === "C" ? "cover" : "sticker", token: m[2].toLowerCase() };
}

/** Decode a Tinta QR from RGBA pixels (browser canvas or sharp raw output). */
export function decodeRgba(data: Uint8ClampedArray, width: number, height: number): TintaQr | null {
  const hit = jsQR(data, width, height, { inversionAttempts: "dontInvert" });
  const parsed = parseQr(hit?.data);
  if (!hit || !parsed) return null;
  const pts = [
    hit.location.topLeftCorner,
    hit.location.topRightCorner,
    hit.location.bottomLeftCorner,
    hit.location.bottomRightCorner,
  ];
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const x0 = Math.max(0, Math.min(...xs));
  const y0 = Math.max(0, Math.min(...ys));
  return {
    ...parsed,
    box: {
      x: x0 / width,
      y: y0 / height,
      w: (Math.min(width, Math.max(...xs)) - x0) / width,
      h: (Math.min(height, Math.max(...ys)) - y0) / height,
    },
  };
}

/**
 * The privacy region around a sticker: the QR plus the printed name to its
 * right (sticker layout: QR on the left, name on the right, ~3.2 QR-widths wide).
 */
export function stickerRedactionBox(qrBox: NonNullable<TintaQr["box"]>) {
  const padY = qrBox.h * 0.25;
  const padX = qrBox.w * 0.25;
  const x = Math.max(0, qrBox.x - padX);
  const y = Math.max(0, qrBox.y - padY);
  const w = Math.min(1 - x, qrBox.w * 3.4 + padX);
  const h = Math.min(1 - y, qrBox.h + 2 * padY);
  return { x, y, w, h };
}

export type PageQr = Pick<TintaQr, "kind" | "token"> | null;
export type PageGroup = { token: string | null; pages: number[] };

/**
 * Split an ordered stack of pages into students (§3.2: auto-split by QR / page count).
 * - No QR anywhere → fixed `perStudent` chunks (unmatched; name reading suggests later).
 * - A cover sheet starts a new student and is itself dropped.
 * - A sticker puts its page in that student's group (starting a new group when needed).
 * - Pages without a code follow the previous page.
 * Returned page numbers are the input indexes.
 */
export function splitByQr(qrs: PageQr[], perStudent: number): PageGroup[] {
  const per = Math.max(1, Math.floor(perStudent));
  if (!qrs.some(Boolean)) {
    const out: PageGroup[] = [];
    for (let i = 0; i < qrs.length; i += per)
      out.push({ token: null, pages: qrs.slice(i, i + per).map((_, j) => i + j) });
    return out;
  }
  const out: PageGroup[] = [];
  let cur: PageGroup | null = null;
  qrs.forEach((qr, i) => {
    if (qr?.kind === "cover") {
      cur = { token: qr.token, pages: [] };
      out.push(cur);
      return;
    }
    if (qr?.kind === "sticker") {
      if (cur && cur.token === qr.token) cur.pages.push(i);
      else if (cur && cur.token === null && cur.pages.length === 0) {
        cur.token = qr.token;
        cur.pages.push(i);
      } else if (cur && cur.pages.length === 0 && cur.token !== qr.token) {
        // a cover for someone else directly followed by another student's sticker: trust the sticker
        cur.token = qr.token;
        cur.pages.push(i);
      } else {
        cur = { token: qr.token, pages: [i] };
        out.push(cur);
      }
      return;
    }
    if (!cur) {
      cur = { token: null, pages: [] };
      out.push(cur);
    }
    cur.pages.push(i);
  });
  return out.filter((g) => g.pages.length > 0);
}
