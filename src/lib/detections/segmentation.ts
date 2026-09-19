/**
 * In-memory cache and coordinate transformations for true per-pixel text segmentation masks.
 * Produced by ComicTextDetector and consumed by inpainting ladder rungs.
 */

let currentSegMap: {
  imageSrc: string;
  width: number;
  height: number;
  data: Uint8Array;
} | null = null;

export function setPageSegmentation(
  imageSrc: string,
  width: number,
  height: number,
  data: Uint8Array,
): void {
  currentSegMap = { imageSrc, width, height, data };
}

export function getCachedSegmentation(imageSrc?: string): Uint8Array | null {
  if (!currentSegMap) return null;
  if (imageSrc && currentSegMap.imageSrc !== imageSrc) return null;
  return currentSegMap.data;
}

export function clearSegmentation(): void {
  currentSegMap = null;
}

/**
 * Bilinear resize from letterboxed model segmentation tensor back to original page coordinates.
 */
export function resizeSegmentation(
  segData: Float32Array,
  segW: number,
  segH: number,
  origW: number,
  origH: number,
  modelSize: number,
): Uint8Array {
  const scale = Math.min(modelSize / origW, modelSize / origH);
  const fittedW = origW * scale;
  const fittedH = origH * scale;
  const padX = (modelSize - fittedW) / 2;
  const padY = (modelSize - fittedH) / 2;

  const levels = new Uint8Array(origW * origH);

  for (let py = 0; py < origH; py++) {
    const my = (py * scale + padY) * (segH / modelSize);
    const y0 = Math.max(0, Math.min(segH - 1, Math.floor(my)));
    const y1 = Math.min(segH - 1, y0 + 1);
    const ty = my - y0;

    for (let px = 0; px < origW; px++) {
      const mx = (px * scale + padX) * (segW / modelSize);
      const x0 = Math.max(0, Math.min(segW - 1, Math.floor(mx)));
      const x1 = Math.min(segW - 1, x0 + 1);
      const tx = mx - x0;

      const top = segData[y0 * segW + x0] * (1 - tx) + segData[y0 * segW + x1] * tx;
      const bottom = segData[y1 * segW + x0] * (1 - tx) + segData[y1 * segW + x1] * tx;
      const val = Math.max(0, Math.min(1, top * (1 - ty) + bottom * ty));
      levels[py * origW + px] = Math.round(val * 255);
    }
  }

  return levels;
}
