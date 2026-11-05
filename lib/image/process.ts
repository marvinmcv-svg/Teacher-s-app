import "server-only";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { imageConfig } from "@/lib/ai/config";
import type { BBox } from "@/lib/ocr/types";
import { measure, type QualityMetrics } from "./quality";
import { fitToTier } from "./tier";

const OCR_MAX_EDGE = 4000;

/** EXIF-rotate, strip all metadata (GPS!), cap size, re-encode JPEG. Returns the canonical page image. */
export async function normalisePage(input: Buffer) {
  const img = sharp(input, { failOn: "error" }).rotate(); // rotate() applies EXIF orientation
  const out = await img
    .resize({ width: OCR_MAX_EDGE, height: OCR_MAX_EDGE, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 90, mozjpeg: true }) // metadata is dropped unless withMetadata() is called
    .toBuffer({ resolveWithObject: true });
  return {
    buffer: out.data,
    width: out.info.width,
    height: out.info.height,
    sha256: createHash("sha256").update(out.data).digest("hex"),
  };
}

export async function measureQuality(
  input: Buffer,
): Promise<QualityMetrics & { sourceWidth: number; sourceHeight: number }> {
  const meta = await sharp(input).metadata();
  const { data, info } = await sharp(input)
    .resize({ width: 512, height: 512, fit: "inside" })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const m = measure(new Uint8Array(data.buffer, data.byteOffset, data.length), info.width, info.height);
  return { ...m, sourceWidth: meta.width ?? 0, sourceHeight: meta.height ?? 0 };
}

/** Redact the given normalised regions (names/headers) before any LLM call. */
export async function redactRegions(input: Buffer, regions: BBox[], pad = 0.01): Promise<Buffer> {
  const meta = await sharp(input).metadata();
  const W = meta.width ?? 0;
  const H = meta.height ?? 0;
  if (!regions.length || !W || !H) return sharp(input).jpeg({ quality: 90 }).toBuffer();
  const overlays = await Promise.all(
    regions.map(async (r) => {
      const left = Math.max(0, Math.floor((r.x - pad) * W));
      const top = Math.max(0, Math.floor((r.y - pad) * H));
      const width = Math.max(1, Math.min(W - left, Math.ceil((r.w + 2 * pad) * W)));
      const height = Math.max(1, Math.min(H - top, Math.ceil((r.h + 2 * pad) * H)));
      // Solid fill with the region's mean colour: irreversible (a blur/pixelation
      // can leave recoverable structure) and still reads as "paper" to the model.
      // Materialise the crop first: sharp's stats() ignores a chained extract().
      const crop = await sharp(input).extract({ left, top, width, height }).toBuffer();
      const { channels } = await sharp(crop).stats();
      const [red, green, blue] = channels.map((c) => Math.round(c.mean));
      const background = { r: red, g: green ?? red, b: blue ?? red };
      const tile = await sharp({ create: { width, height, channels: 3, background } })
        .png()
        .toBuffer();
      return { input: tile, left, top };
    }),
  );
  return sharp(input).composite(overlays).jpeg({ quality: 90 }).toBuffer();
}

/** Downscale to the model's native tier size (§6.1) and return base64 JPEG. */
export async function toModelImage(input: Buffer) {
  const meta = await sharp(input).metadata();
  const { width, height } = fitToTier(
    meta.width ?? 1,
    meta.height ?? 1,
    imageConfig.max_long_edge,
    imageConfig.max_visual_tokens,
    imageConfig.patch,
  );
  const buf = await sharp(input)
    .resize({ width, height, fit: "fill" })
    .jpeg({ quality: imageConfig.jpeg_quality })
    .toBuffer();
  return { base64: buf.toString("base64"), width, height, mediaType: "image/jpeg" as const };
}

/** Crop a normalised region (e.g. the header band for name reading). */
export async function cropRegion(input: Buffer, r: BBox): Promise<Buffer> {
  const meta = await sharp(input).metadata();
  const W = meta.width ?? 0;
  const H = meta.height ?? 0;
  const left = Math.floor(r.x * W);
  const top = Math.floor(r.y * H);
  return sharp(input)
    .extract({
      left,
      top,
      width: Math.max(1, Math.min(W - left, Math.ceil(r.w * W))),
      height: Math.max(1, Math.min(H - top, Math.ceil(r.h * H))),
    })
    .jpeg({ quality: 85 })
    .toBuffer();
}
