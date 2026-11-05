/**
 * Pre-resize to the model's native size (§6.1) so coordinates map back
 * exactly. Claude 4.7+ models (incl. all 5.5 models we use) are in the
 * high-resolution tier: long edge ≤ 2576 px AND ⌈w/28⌉·⌈h/28⌉ ≤ 4784 tokens.
 */
export function visualTokens(w: number, h: number, patch = 28) {
  return Math.ceil(w / patch) * Math.ceil(h / patch);
}

export function fitToTier(
  width: number,
  height: number,
  maxEdge: number,
  maxTokens: number,
  patch = 28,
): { width: number; height: number } {
  let scale = Math.min(1, maxEdge / Math.max(width, height));
  let w = Math.max(1, Math.floor(width * scale));
  let h = Math.max(1, Math.floor(height * scale));
  // Area bound first, then step down until the patch-rounded count fits.
  const areaScale = Math.sqrt((maxTokens * patch * patch) / (w * h));
  if (areaScale < 1) {
    scale *= areaScale;
    w = Math.max(1, Math.floor(width * scale));
    h = Math.max(1, Math.floor(height * scale));
  }
  while (visualTokens(w, h, patch) > maxTokens) {
    scale *= 0.99;
    w = Math.max(1, Math.floor(width * scale));
    h = Math.max(1, Math.floor(height * scale));
  }
  return { width: w, height: h };
}
