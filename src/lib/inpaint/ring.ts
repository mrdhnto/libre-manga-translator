import type { Mask } from "./mask";
import { dilate } from "./mask";
import { ANNULUS_WIDTH } from "./constants";

/**
 * What the paper around a mask looks like. Everything is decided from this
 * ring: whether a flat fill is faithful, what tone to fill with, whether the
 * region must go to a model. The five corrections encoded here:
 *  1. ring = native annulus dilate(k)..dilate(k+4), never the mask contour
 *  2. deviation about a FITTED PLANE (a gradient σ 4-8 passes and a flat fill
 *     reads as a Mach band)
 *  3. multimodal rings refused (σ small, median exists on neither tone)
 *  4. no near-white snap
 *  5. the annulus is flood-restricted to the paper on the mask's side of the
 *     page's strong edges, so a stroke lying in the ring cannot fake a fail
 *     (half a percent of stroke on the ring = +16 levels of σ)
 */

export interface Plane {
  a: number;
  b: number;
  c: number;
}

export const planeAt = (p: Plane, x: number, y: number): number =>
  p.a + p.b * x + p.c * y;

export interface RingStats {
  count: number;
  /** ring median luma, NOT snapped to white */
  median: number;
  /** population σ about the fitted plane, 8-bit levels */
  deviation: number;
  /** per-channel fitted planes for the fill (page coords baked in by caller) */
  planes: Plane[];
  medians: number[];
  multimodal: boolean;
  periodic: boolean;
}

export interface RingMeasurement {
  stats: RingStats;
  /** crop-local pixel indices of the restricted ring (fill must use THE SAME
   * pixels the route was decided from, so fill and routing never disagree) */
  ringIdx: number[];
}

/** Least-squares plane a + b·x + c·y over samples (Cramer 3x3). */
function fitPlane(
  xs: number[],
  ys: number[],
  vs: number[],
): Plane {
  const n = vs.length;
  let sx = 0,
    sy = 0,
    sxx = 0,
    syy = 0,
    sxy = 0,
    sv = 0,
    sxv = 0,
    syv = 0;
  for (let i = 0; i < n; i++) {
    const x = xs[i],
      y = ys[i],
      v = vs[i];
    sx += x;
    sy += y;
    sxx += x * x;
    syy += y * y;
    sxy += x * y;
    sv += v;
    sxv += x * v;
    syv += y * v;
  }
  const det = (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) =>
    a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  const D = det(n, sx, sy, sx, sxx, sxy, sy, sxy, syy);
  if (Math.abs(D) < 1e-6) {
    const m = sv / n;
    return { a: m, b: 0, c: 0 };
  }
  const a = det(sv, sx, sy, sxv, sxx, sxy, syv, sxy, syy) / D;
  const b = det(n, sv, sy, sx, sxv, sy, sy, syv, syy) / D;
  const c = det(n, sx, sv, sx, sxx, sxv, sy, sxy, syv) / D;
  return { a, b, c };
}

function medianOf(values: number[]): number {
  if (values.length === 0) return 255;
  const s = [...values].sort((x, y) => x - y);
  return s[(s.length / 2) | 0];
}

/**
 * Measure the paper annulus around `mask` in a crop.
 * `luma` crop luma; `rgb` crop RGBA; `mag` crop Sobel; `ox/oy` page origin of
 * the crop (planes are stated in PAGE coordinates, so the fill
 * writes a plane through page-space x/y and never depends on crop placement).
 */
export function measureRing(
  mask: Mask,
  luma: Float32Array,
  rgb: Uint8ClampedArray,
  mag: Float32Array,
  strongFloor: number,
  ox: number,
  oy: number,
): RingMeasurement {
  const { w, h, data } = mask;
  const dil = dilate(mask, ANNULUS_WIDTH);

  // band = dilate(k+4) \ dilate(k)... the annulus between dilate(k) and
  // dilate(k+4); candidate k IS the dilate here, so band = dil \ mask.
  const band = new Uint8Array(w * h);
  const seedIdx: number[] = [];
  for (let i = 0; i < w * h; i++) {
    if (dil.data[i] && !data[i]) band[i] = 1;
  }
  // flood seeds: band pixels touching the mask
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!band[i]) continue;
      const touches =
        (x > 0 && data[i - 1]) ||
        (x < w - 1 && data[i + 1]) ||
        (y > 0 && data[i - w]) ||
        (y < h - 1 && data[i + w]);
      if (touches && mag[i] < strongFloor) seedIdx.push(i);
    }
  }

  // flood through the band, blocked by strong edges (stroke seals, halftone
  // arcs leak - the shape difference that keeps tone fillable and strokes not).
  const visited = new Uint8Array(w * h);
  const ringIdx: number[] = [];
  const queue = seedIdx.slice();
  for (const i of queue) visited[i] = 1;
  let head = 0;
  while (head < queue.length) {
    const i = queue[head++];
    ringIdx.push(i);
    const x = i % w;
    const y = (i / w) | 0;
    const step = (j: number) => {
      if (!visited[j] && band[j] && mag[j] < strongFloor) {
        visited[j] = 1;
        queue.push(j);
      }
    };
    if (x > 0) step(i - 1);
    if (x < w - 1) step(i + 1);
    if (y > 0) step(i - w);
    if (y < h - 1) step(i + w);
  }

  // Too thin (page edge / sealed balloon): widen once before giving up.
  if (ringIdx.length < 12) {
    return fallbackRing(mask, luma, rgb, ox, oy, ringIdx.length);
  }

  const xs: number[] = [];
  const ys: number[] = [];
  const lumas: number[] = [];
  const chans: number[][] = [[], [], []];
  for (const i of ringIdx) {
    const x = ox + (i % w);
    const y = oy + ((i / w) | 0);
    xs.push(x);
    ys.push(y);
    lumas.push(luma[i]);
    chans[0].push(rgb[i * 4]);
    chans[1].push(rgb[i * 4 + 1]);
    chans[2].push(rgb[i * 4 + 2]);
  }

  const plane = fitPlane(xs, ys, lumas);
  const planes = [
    fitPlane(xs, ys, chans[0]),
    fitPlane(xs, ys, chans[1]),
    fitPlane(xs, ys, chans[2]),
  ];

  let sumSq = 0;
  const residual = new Array<number>(lumas.length);
  for (let i = 0; i < lumas.length; i++) {
    const r = lumas[i] - planeAt(plane, xs[i], ys[i]);
    residual[i] = r;
    sumSq += r * r;
  }
  const deviation = Math.sqrt(sumSq / lumas.length);

  const sorted = [...lumas].sort((a, b) => a - b);
  const median = sorted[(sorted.length / 2) | 0];

  // multimodal: a large empty gap inside the body of the distribution
  let multimodal = false;
  const lo = (sorted.length * 0.05) | 0;
  const hi = (sorted.length * 0.95) | 0;
  for (let i = lo + 1; i < hi; i++) {
    if (sorted[i] - sorted[i - 1] > 40) {
      multimodal = true;
      break;
    }
  }

  // periodic: autocorrelation of the residual along the index order catches
  // halftone/line-art repetition (a full 2-D patch test is the thorough
  // cheap stand-in - large dot deviation ALSO trips the fit-fail threshold,
  // so this is a second net, not the only one).
  let periodic = false;
  {
    let e0 = 0;
    for (const r of residual) e0 += r * r;
    if (e0 > 0) {
      for (let lag = 2; lag <= 8; lag++) {
        let c = 0;
        for (let i = 0; i + lag < residual.length; i++) {
          c += residual[i] * residual[i + lag];
        }
        if (e0 > 0 && c / e0 > 0.4 && deviation > 4) {
          periodic = true;
          break;
        }
      }
    }
  }

  return {
    stats: {
      count: ringIdx.length,
      median,
      deviation,
      planes,
      medians: [
        medianOf(chans[0]),
        medianOf(chans[1]),
        medianOf(chans[2]),
      ],
      multimodal,
      periodic,
    },
    ringIdx,
  };
}

/** Unrestricted stats when the flood found nothing usable (edge of page). */
function fallbackRing(
  mask: Mask,
  luma: Float32Array,
  rgb: Uint8ClampedArray,
  ox: number,
  oy: number,
  had: number,
): RingMeasurement {
  const { w, h } = mask;
  const dil = dilate(mask, ANNULUS_WIDTH * 2);
  const xs: number[] = [],
    ys: number[] = [],
    lumas: number[] = [];
  const chans: number[][] = [[], [], []];
  for (let i = 0; i < w * h; i++) {
    if (!dil.data[i] || mask.data[i]) continue;
    xs.push(ox + (i % w));
    ys.push(oy + ((i / w) | 0));
    lumas.push(luma[i]);
    chans[0].push(rgb[i * 4]);
    chans[1].push(rgb[i * 4 + 1]);
    chans[2].push(rgb[i * 4 + 2]);
  }
  if (lumas.length < 12) {
    // Nothing measurable: hand back an empty ring; fit.ts treats count==0 as
    // "no paper evidence" -> route to Inpaint, never a confident Fill.
    return {
      stats: {
        count: had,
        median: 255,
        deviation: 999,
        planes: [
          { a: 255, b: 0, c: 0 },
          { a: 255, b: 0, c: 0 },
          { a: 255, b: 0, c: 0 },
        ],
        medians: [255, 255, 255],
        multimodal: false,
        periodic: false,
      },
      ringIdx: [],
    };
  }
  const plane = fitPlane(xs, ys, lumas);
  let sumSq = 0;
  for (let i = 0; i < lumas.length; i++) {
    const r = lumas[i] - planeAt(plane, xs[i], ys[i]);
    sumSq += r * r;
  }
  const sorted = [...lumas].sort((a, b) => a - b);
  return {
    stats: {
      count: lumas.length,
      median: sorted[(sorted.length / 2) | 0],
      deviation: Math.sqrt(sumSq / lumas.length),
      planes: [
        fitPlane(xs, ys, chans[0]),
        fitPlane(xs, ys, chans[1]),
        fitPlane(xs, ys, chans[2]),
      ],
      medians: [
        medianOf(chans[0]),
        medianOf(chans[1]),
        medianOf(chans[2]),
      ],
      multimodal: false,
      periodic: false,
    },
      ringIdx: [], // fill consumes `stats` only; ring pixels == routing pixels
  };
}
