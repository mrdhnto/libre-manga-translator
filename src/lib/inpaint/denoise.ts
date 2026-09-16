import type { Fitted } from "./fit";
import type { Mask } from "./mask";
import { dilate } from "./mask";
import { planeAt } from "./ring";
import { renderFill } from "./fill";
import { DENOISE_DILATION, DENOISE_FEATHER } from "./constants";

/**
 * Rung 1 - denoise fill.
 *
 * Exists for the case rung 0 makes worse: a tight mask on a grainy/JPEG-blocked
 * scan, where a perfectly smooth rectangle inside grain is more visible than
 * the text was. It runs rung 0 first, then a bilateral filter (fixed 5x5
 * kernel, range σ = the page's own noise floor - "noise" is not absolute) over
 * the fill **together with the band of real paper around it**, composited
 * through the whole dilated mask: the seam is the thing being removed.
 * Feather is one ring at α 0.5 - a hard radius cut, never a Gaussian
 * (a σ=1 Gaussian spreads non-zero alpha 2-3 px and escapes EDIT_MARGIN).
 */
const SPATIAL_RADIUS = 2;
const SPATIAL_SIGMA = SPATIAL_RADIUS / 2;
const FEATHER_ALPHA = 0.5;

const SPATIAL_WEIGHTS: number[] = (() => {
  const denom = 2 * SPATIAL_SIGMA * SPATIAL_SIGMA;
  const out: number[] = [];
  for (let dy = -SPATIAL_RADIUS; dy <= SPATIAL_RADIUS; dy++) {
    for (let dx = -SPATIAL_RADIUS; dx <= SPATIAL_RADIUS; dx++) {
      out.push(Math.exp(-(dx * dx + dy * dy) / denom));
    }
  }
  return out;
})();

const useMedians = (fitted: Pick<Fitted, "ring">) => fitted.ring.count < 12;

export function renderDenoise(
  page: ImageData,
  mask: Mask,
  fitted: Pick<Fitted, "ring">,
  noiseSigma: number,
): void {
  const core = dilate(mask, DENOISE_DILATION);
  const applied = dilate(mask, DENOISE_DILATION + DENOISE_FEATHER);

  // Rung 0's output first: the filter must see the FILLED page, not the text
  // being removed. Snapshot keeps every other pixel as the original paper.
  renderFill(page, mask, fitted);
  const snapshot = new Uint8ClampedArray(page.data);

  const sigmaRange = Math.max(noiseSigma, 0.5); // floor: no measurable noise -> degenerate kernel, near-identity filter
  const denom = 2 * sigmaRange * sigmaRange;

  const { w, h, ox, oy } = mask;
  const pw = page.width;
  const ph = page.height;

  /** The value the filter reads at a PAGE coordinate: fill inside the mask,
   * original elsewhere (source() in the Rust version). */
  const source = (sx: number, sy: number, c: number): number => {
    const cx = sx - ox;
    const cy = sy - oy;
    if (cx >= 0 && cy >= 0 && cx < w && cy < h && mask.data[cy * w + cx]) {
      return useMedians(fitted)
        ? fitted.ring.medians[c]
        : planeAt(fitted.ring.planes[c], sx, sy);
    }
    return snapshot[(sy * pw + sx) * 4 + c];
  };

  for (let y = 0; y < h; y++) {
    const py = oy + y;
    if (py < 0 || py >= ph) continue;
    for (let x = 0; x < w; x++) {
      const ai = y * w + x;
      if (!applied.data[ai]) continue;
      const px = ox + x;
      if (px < 0 || px >= pw) continue;
      const alpha = core.data[ai] ? 1 : FEATHER_ALPHA;

      const pi = (py * pw + px) * 4;
      for (let c = 0; c < 3; c++) {
        const centre = source(px, py, c);
        let weighted = 0;
        let total = 0;
        let k = 0;
        for (let dy = -SPATIAL_RADIUS; dy <= SPATIAL_RADIUS; dy++) {
          const sy = py + dy;
          if (sy < 0 || sy >= ph) {
            k += 2 * SPATIAL_RADIUS + 1;
            continue;
          }
          for (let dx = -SPATIAL_RADIUS; dx <= SPATIAL_RADIUS; dx++, k++) {
            const sx = px + dx;
            if (sx < 0 || sx >= pw) continue;
            const value = source(sx, sy, c);
            const difference = value - centre;
            const weight =
              SPATIAL_WEIGHTS[k] * Math.exp(-(difference * difference) / denom);
            weighted += weight * value;
            total += weight;
          }
        }
        // The centre's own weight is 1x1, so total is never zero.
        const filtered = weighted / total;
        const original = source(px, py, c);
        page.data[pi + c] = Math.round(
          alpha * filtered + (1 - alpha) * original,
        );
      }
      page.data[pi + 3] = snapshot[pi + 3]; // alpha copied, never filtered
    }
  }
}
