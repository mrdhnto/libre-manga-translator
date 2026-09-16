import type { Fitted } from "./fit";
import type { Mask } from "./mask";
import { dilate } from "./mask";
import { planeAt } from "./ring";
import { ISOLATION_RADIUS } from "./constants";

/**
 * Rung 0 - planar fill.
 *
 * Not cheap-first: it is *more faithful* than any model on the case it covers.
 * It pastes the plane fitted to the ring through the mask, measured from the
 * same restricted paper pixels the route was decided from (`fitted.ring` came
 * from `measureRing` over `fitted.ringIdx` - one set, both uses). Alpha is
 * copied, never filled.
 */
export function renderFill(
  page: ImageData,
  mask: Mask,
  fitted: Pick<Fitted, "ring">,
): void {
  const { data } = page;
  const planes = fitted.ring.planes;
  const useMedians = fitted.ring.count < 12;
  const { w, h, ox, oy } = mask;

  for (let y = 0; y < h; y++) {
    const py = oy + y;
    if (py < 0 || py >= page.height) continue;
    for (let x = 0; x < w; x++) {
      if (!mask.data[y * w + x]) continue;
      const px = ox + x;
      if (px < 0 || px >= page.width) continue;
      const i = (py * page.width + px) * 4;
      for (let c = 0; c < 3; c++) {
        data[i + c] = useMedians
          ? fitted.ring.medians[c]
          : clamp255(Math.round(planeAt(planes[c], px, py)));
      }
      // alpha untouched
    }
  }
}

/** Flat solid fill: the per-channel median only. */
export function renderSolid(
  page: ImageData,
  mask: Mask,
  fitted: Pick<Fitted, "ring">,
): void {
  const { data } = page;
  const { w, h, ox, oy } = mask;
  for (let y = 0; y < h; y++) {
    const py = oy + y;
    if (py < 0 || py >= page.height) continue;
    for (let x = 0; x < w; x++) {
      if (!mask.data[y * w + x]) continue;
      const px = ox + x;
      if (px < 0 || px >= page.width) continue;
      const i = (py * page.width + px) * 4;
      data[i] = fitted.ring.medians[0];
      data[i + 1] = fitted.ring.medians[1];
      data[i + 2] = fitted.ring.medians[2];
    }
  }
}

/**
 * Write-bound for any rung's output: mask ⊕ ISOLATION_RADIUS. Engines here
 * never write past their mask; the bound exists so a future model rung has one
 * statement to respect (and the ladder asserts against it in tests).
 */
export function writeBound(mask: Mask): Mask {
  return dilate(mask, ISOLATION_RADIUS);
}

const clamp255 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);
