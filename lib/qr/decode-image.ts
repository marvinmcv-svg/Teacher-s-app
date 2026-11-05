import "server-only";
import sharp, { type Sharp } from "sharp";
import { decodeRgba, type TintaQr } from "./payload";

const ANALYSIS_EDGE = 1600;

async function tryDecode(img: Sharp): Promise<TintaQr | null> {
  const { data, info } = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return decodeRgba(new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), info.width, info.height);
}

/**
 * Find a Tinta QR on a page photo. Tries the whole page at a moderate size,
 * then each quarter at a higher effective resolution (small stickers on big pages).
 * Box coordinates are normalised to the whole page.
 */
export async function decodePageQr(input: Buffer): Promise<TintaQr | null> {
  const base = sharp(input).rotate();
  const meta = await base.clone().metadata();
  const W = meta.autoOrient?.width ?? meta.width ?? 0;
  const H = meta.autoOrient?.height ?? meta.height ?? 0;
  if (!W || !H) return null;
  const whole = await tryDecode(
    base.clone().resize({ width: ANALYSIS_EDGE, height: ANALYSIS_EDGE, fit: "inside", withoutEnlargement: true }),
  );
  if (whole) return whole;
  const normalised = await base.clone().toBuffer(); // orientation applied
  for (const [qx, qy] of [
    [1, 0],
    [0, 0],
    [0, 1],
    [1, 1],
  ]) {
    const left = Math.floor((qx * W) / 2);
    const top = Math.floor((qy * H) / 2);
    const width = Math.ceil(W / 2) - (qx && W % 2 ? 1 : 0);
    const height = Math.ceil(H / 2) - (qy && H % 2 ? 1 : 0);
    const hit = await tryDecode(
      sharp(normalised)
        .extract({ left, top, width: Math.min(width, W - left), height: Math.min(height, H - top) })
        .resize({ width: ANALYSIS_EDGE, height: ANALYSIS_EDGE, fit: "inside", withoutEnlargement: true }),
    );
    if (hit?.box)
      return {
        ...hit,
        box: { x: qx / 2 + hit.box.x / 2, y: qy / 2 + hit.box.y / 2, w: hit.box.w / 2, h: hit.box.h / 2 },
      };
  }
  return null;
}
