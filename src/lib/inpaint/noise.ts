/**
 * Edge map + page noise floor for the mask fit. Thresholds downstream are
 * stated relative to these: a fixed deviation floor is wrong because flat
 * white on a JPEG q75 scan already measures 5-12 levels of blocking noise.
 */

export interface EdgeMap {
  /** sqrt(Gx² + Gy²) of luma, crop-sized (row-major Float32) */
  mag: Float32Array;
  /** "strong edge" level: a fraction of the page's peak gradient. Balloon
   * strokes seal the ring flood; halftone dots do not - the shape difference
   * is load-bearing (see ring.ts). */
  strongFloor: number;
}

export function toLuma(data: Uint8ClampedArray, out: Float32Array): void {
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    out[i] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
  }
}

export function sobelMagnitude(
  luma: Float32Array,
  w: number,
  h: number,
): Float32Array {
  const mag = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const at = (dx: number, dy: number) => luma[(y + dy) * w + (x + dx)];
      const gx = -at(-1, -1) - 2 * at(-1, 0) - at(-1, 1) + at(1, -1) + 2 * at(1, 0) + at(1, 1);
      const gy = -at(-1, -1) - 2 * at(0, -1) - at(1, -1) + at(-1, 1) + 2 * at(0, 1) + at(1, 1);
      mag[y * w + x] = Math.sqrt(gx * gx + gy * gy);
    }
  }
  return mag;
}

/** Strong-edge fraction of the page's max gradient. */
const EDGE_FRACTION = 0.5;

/**
 * Where the page has edges strong enough that a mask must not grow across
 * them: gradient magnitude above half the page's strongest gradient. A bubble
 * stroke is near the max; halftone dots and screentone sit far below it,
 * which is what keeps a mask growing through tone but not through an outline.
 */
export function strongEdgeFloor(luma: Float32Array, w: number, h: number): number {
  const mag = sobelMagnitude(luma, w, h);
  let peak = 0;
  for (let i = 0; i < mag.length; i++) if (mag[i] > peak) peak = mag[i];
  return peak * EDGE_FRACTION;
}

/** The tile size the noise floor is measured over. */
const TILE = 32;

/**
 * The page's noise floor, in 8-bit luma levels: the mean std of the FLATTEST
 * DECILE of 32x32 tiles - line art and screentone are signal, and averaging
 * them in would put the floor above every region. The fail threshold is
 * max(8, 2.5 sigma): a fixed threshold is wrong because flat white on a JPEG
 * q75 raw already measures 5-12 from blocking alone.
 */
export function pageNoiseSigma(
  luma: Float32Array,
  w: number,
  h: number,
): number {
  const deviations: number[] = [];
  for (let ty = 0; ty < h; ty += TILE) {
    for (let tx = 0; tx < w; tx += TILE) {
      const tw = Math.min(TILE, w - tx);
      const th = Math.min(TILE, h - ty);
      if (tw < 8 || th < 8) continue;
      let sum = 0,
        sumSq = 0;
      const n = tw * th;
      for (let y = ty; y < ty + th; y++) {
        const row = y * w;
        for (let x = tx; x < tx + tw; x++) {
          const v = luma[row + x];
          sum += v;
          sumSq += v * v;
        }
      }
      const mean = sum / n;
      deviations.push(Math.sqrt(Math.max(0, sumSq / n - mean * mean)));
    }
  }
  if (deviations.length === 0) return 0;
  deviations.sort((a, b) => a - b);
  const take = Math.max(1, Math.ceil(deviations.length * 0.1));
  return deviations.slice(0, take).reduce((a, b) => a + b, 0) / take;
}
