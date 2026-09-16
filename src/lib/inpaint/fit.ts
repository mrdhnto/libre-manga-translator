import type { Mask } from "./mask";
import {
  bandIndices,
  crossesEdgeMask,
  dilate,
  maskCount,
} from "./mask";
import { measureRing, type RingMeasurement } from "./ring";
import type { RingStats } from "./ring";
import {
  DENOISE_NOISE_FLOOR,
  FIT_DEV_MIN,
  FIT_DEV_NOISE_FACTOR,
  FLAT_FLOOR,
  INPAINT_MIN_STD,
  MASK_GROWTH_STEPS,
  MASK_GROWTH_STEP,
  MIN_INPAINTING_RADIUS,
  MIN_MASK_THICKNESS,
} from "./constants";

/**
 * Mask fitting: how far to grow the text mask, and where it should route.
 * The subtle parts are the failure
 * cases, and they are load-bearing:
 *
 * - Ratchet for selection, TRUE MINIMUM for failure: a rejected candidate
 *   never updates the incumbent, but `bestDeviation` tracks the min over ALL
 *   candidates and that is what says "fit failed".
 * - The zero case: below FLAT_FLOOR the largest under-floor candidate wins
 *   (swallows the anti-aliasing fringe), and the floor takes precedence over
 *   the monotone gate.
 * - Candidates that cross a strong edge are rejected and the loop stops -
 *   never append the raw rectangle (a grown mask across a bubble stroke scores
 *   better on the outside paper, wins, and the fill paints over the outline).
 * - The fail threshold is relative to the page noise floor.
 */

export type Route = "fill" | "denoise" | "inpaint";

export interface Fitted {
  /** the mask that will actually be applied */
  mask: Mask;
  /** seed grown by the first step only - the tight hole Beta5's LaMa needs */
  ink: Mask;
  ring: RingStats;
  /** restricted ring pixels the route was decided from (fill must reuse) */
  ringIdx: number[];
  route: Route;
  /** growth (px) that produced `mask` */
  thickness: number;
  /** smallest deviation ANY candidate achieved, accepted or not */
  bestDeviation: number;
}

export const deviationThreshold = (noiseSigma: number): number =>
  Math.max(FIT_DEV_MIN, FIT_DEV_NOISE_FACTOR * noiseSigma);

/**
 * Seed measured on the crop. `mag` = crop Sobel, `strongFloor` page-level.
 * Planes come back in PAGE coords; `ox/oy` place the crop on the page.
 */
export function fitMask(
  seed: Mask,
  luma: Float32Array,
  rgb: Uint8ClampedArray,
  mag: Float32Array,
  strongFloor: number,
  noiseSigma: number,
): Fitted {
  const ink = dilate(seed, MIN_MASK_THICKNESS);

  let incumbent = seed;
  let incumbentRing: RingMeasurement | null = null;
  let incumbentDev = Infinity;
  let thickness = 0;
  let bestDeviation = Infinity;

  let cur = seed;
  let prev = seed;

  for (let s = 0; s <= MASK_GROWTH_STEPS; s++) {
    cur =
      s === 0
        ? dilate(seed, MIN_MASK_THICKNESS)
        : dilate(prev, MASK_GROWTH_STEP);
    const growth = MIN_MASK_THICKNESS + s * MASK_GROWTH_STEP;

    // Candidate rejected outright if its border rides a strong edge - the
    // same object reaches the annulus before the mask, and stopping here is
    // what keeps a ring from lying on a bubble stroke.
    if (crossesEdgeMask(cur, mag, strongFloor)) break;

    const ring = measureRing(
      cur,
      luma,
      rgb,
      mag,
      strongFloor,
      seed.ox,
      seed.oy,
    );
    if (ring.stats.count > 0 && ring.stats.deviation < bestDeviation) {
      bestDeviation = ring.stats.deviation;
    }

    const underFloor = ring.stats.deviation < FLAT_FLOOR;
    const improving = ring.stats.deviation < incumbentDev - 0.05;
    if (underFloor || improving) {
      incumbent = cur;
      incumbentRing = ring;
      incumbentDev = ring.stats.deviation;
      thickness = growth;
    } else {
      break; // monotone gate: no further growth can rescue this region
    }

    prev = cur;
  }

  // Fit failed outright: no ring was ever measurable. Fall back to the first
  // step (never the raw rectangle as a "fit") and send it to the inpainter.
  if (!incumbentRing) {
    return {
      mask: ink,
      ink,
      ring: {
        count: 0,
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
      route: "inpaint",
      thickness: 0,
      bestDeviation: Infinity,
    };
  }

  const stats = incumbentRing.stats;
  const failThreshold = deviationThreshold(noiseSigma);

  const fitFailed =
    stats.count < 12 || bestDeviation > failThreshold;
  const secondPopulation =
    stats.deviation > INPAINT_MIN_STD &&
    thickness <= MIN_INPAINTING_RADIUS &&
    maskCount(incumbent) > maskCount(seed);

  let route: Route = "fill";
  if (fitFailed || stats.multimodal || stats.periodic || secondPopulation) {
    route = "inpaint";
  } else if (noiseSigma >= DENOISE_NOISE_FLOOR || stats.deviation > failThreshold / 2) {
    route = "denoise";
  }

  return {
    mask: incumbent,
    ink,
    ring: stats,
    ringIdx: incumbentRing.ringIdx,
    route,
    thickness,
    bestDeviation: Math.min(bestDeviation, stats.deviation),
  };
}

/** Pixels the mask grew between two dilations (diagnostics/tests). */
export const growthBand = (a: Mask, b: Mask): number[] => bandIndices(a, b);
