/**
 * Photo quality metrics (§3.2 quality gate). Pure functions over a grayscale
 * buffer so the same code runs in the browser (canvas) and on the server
 * (sharp). Thresholds live in config and must be calibrated on real phone
 * photos (DECISIONS D-022).
 */
export type QualityMetrics = {
  /** variance of the Laplacian — low = blurry */
  sharpness: number;
  /** mean luminance 0-255 */
  brightness: number;
  /**
   * Localised blown highlights: (most saturated 8×8 tile) − (median tile), where
   * saturation = share of pixels ≥ 250. A clean white scan scores ~0; a glare
   * blob on a photographed page scores high.
   */
  glare: number;
  width: number;
  height: number;
};

export type QualityIssue = "blurry" | "too_dark" | "glare" | "too_small";

export const QUALITY_THRESHOLDS = {
  minSharpness: 60, // on the 512px-long-edge analysis image
  minBrightness: 70,
  maxGlare: 0.5,
  minLongEdge: 1000, // of the captured image
};

/** gray: one byte per pixel, row-major. */
export function measure(gray: Uint8Array | Uint8ClampedArray, width: number, height: number): QualityMetrics {
  let sum = 0;
  for (let i = 0; i < gray.length; i++) sum += gray[i];
  const glare = tileGlare(gray, width, height);
  // 4-neighbour Laplacian variance
  let n = 0;
  let mean = 0;
  let m2 = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const lap = gray[i - width] + gray[i + width] + gray[i - 1] + gray[i + 1] - 4 * gray[i];
      n++;
      const d = lap - mean;
      mean += d / n;
      m2 += d * (lap - mean);
    }
  }
  return {
    sharpness: n > 1 ? m2 / (n - 1) : 0,
    brightness: gray.length ? sum / gray.length : 0,
    glare,
    width,
    height,
  };
}

export function assess(m: QualityMetrics, capturedLongEdge: number, t = QUALITY_THRESHOLDS): QualityIssue[] {
  const issues: QualityIssue[] = [];
  if (capturedLongEdge < t.minLongEdge) issues.push("too_small");
  if (m.brightness < t.minBrightness) issues.push("too_dark");
  if (m.glare > t.maxGlare) issues.push("glare");
  if (m.sharpness < t.minSharpness) issues.push("blurry");
  return issues;
}

/** RGBA (canvas ImageData) → grayscale (Rec. 601 luma). */
export function rgbaToGray(rgba: Uint8ClampedArray): Uint8Array {
  const out = new Uint8Array(rgba.length / 4);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j++)
    out[j] = (rgba[i] * 299 + rgba[i + 1] * 587 + rgba[i + 2] * 114) / 1000;
  return out;
}

const GRID = 8;
function tileGlare(gray: Uint8Array | Uint8ClampedArray, width: number, height: number): number {
  const sat: number[] = [];
  for (let ty = 0; ty < GRID; ty++) {
    for (let tx = 0; tx < GRID; tx++) {
      const x0 = Math.floor((tx * width) / GRID),
        x1 = Math.floor(((tx + 1) * width) / GRID);
      const y0 = Math.floor((ty * height) / GRID),
        y1 = Math.floor(((ty + 1) * height) / GRID);
      let n = 0,
        b = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++, n++) if (gray[y * width + x] >= 250) b++;
      if (n) sat.push(b / n);
    }
  }
  if (!sat.length) return 0;
  const sorted = [...sat].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  return Math.max(0, sorted[sorted.length - 1] - median);
}
