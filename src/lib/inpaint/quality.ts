import type { Mask } from "./mask";
import { dilate } from "./mask";
import { sobelMagnitude, toLuma } from "./noise";
import { deviationThreshold } from "./fit";
import { QUALITY_EDGE_RATIO, QUALITY_SURROUND_WIDTH } from "./constants";

/**
 * The decline metric: the one check every rung's output is scored by:
 *
 *   reject when post-edit interior edge-energy exceeds the surround annulus by
 *   more than 2x, or when the interior median falls outside the surround
 *   p5..p95 widened by the noise allowance.
 *
 * Two rules that are the whole design: the structural prior is the SURROUND -
 * the pre-edit interior is never read (it contains the removed text, so
 * density is always lower and "the engine added strokes" could never fire -
 * the bug the first version of this metric shipped with). And an edge-energy
 * sample counts only when its whole 3x3 neighbourhood lies on one side of the
 * edit boundary: a border interior sample reads the seam, and a surround
 * sample beside the mask reaches into pre-edit text ink - so the surround also
 * excludes the mask's whole bounding box, and neighbouring bbox rects.
 */
export function regionDeclines(
  page: ImageData,
  mask: Mask,
  noiseSigma: number,
  /** other regions' page rects to exclude from the surround */
  otherRects: { x1: number; y1: number; x2: number; y2: number }[],
): boolean {
  const { w: mw, h: mh, ox, oy, data } = mask;

  // mask bounds in page coords
  let bx1 = page.width,
    by1 = page.height,
    bx2 = -1,
    by2 = -1;
  const maskCountPx: number[] = [];
  for (let y = 0; y < mh; y++) {
    for (let x = 0; x < mw; x++) {
      if (!data[y * mw + x]) continue;
      maskCountPx.push(y * mw + x);
      const px = ox + x;
      const py = oy + y;
      if (px < bx1) bx1 = px;
      if (px > bx2) bx2 = px;
      if (py < by1) by1 = py;
      if (py > by2) by2 = py;
    }
  }
  if (maskCountPx.length < 20) return false;

  const pad = QUALITY_SURROUND_WIDTH + 4;
  const wx1 = Math.max(0, bx1 - pad);
  const wy1 = Math.max(0, by1 - pad);
  const wx2 = Math.min(page.width - 1, bx2 + pad);
  const wy2 = Math.min(page.height - 1, by2 + pad);
  const ww = wx2 - wx1 + 1;
  const wh = wy2 - wy1 + 1;
  if (ww < 12 || wh < 12) return false;

  const luma = new Float32Array(ww * wh);
  const rgb = new Uint8ClampedArray(ww * wh * 4);
  for (let y = 0; y < wh; y++) {
    const py = wy1 + y;
    for (let x = 0; x < ww; x++) {
      const px = wx1 + x;
      const src = (py * page.width + px) * 4;
      const dst = (y * ww + x) * 4;
      rgb[dst] = page.data[src];
      rgb[dst + 1] = page.data[src + 1];
      rgb[dst + 2] = page.data[src + 2];
      rgb[dst + 3] = 255;
    }
  }
  toLuma(rgb, luma);
  const mag = sobelMagnitude(luma, ww, wh);

  // window-local masks: the applied mask, its dilate(4) and dilate(pad)
  const wmask = { data: new Uint8Array(ww * wh), w: ww, h: wh, ox: wx1, oy: wy1 };
  for (const idx of maskCountPx) {
    const x = idx % mw;
    const y = (idx / mw) | 0;
    wmask.data[(y + oy - wy1) * ww + (x + ox - wx1)] = 1;
  }
  const dil4 = dilate(wmask, 4);
  const dilPad = dilate(wmask, QUALITY_SURROUND_WIDTH);

  // interior: all 8 neighbours inside the mask (3x3 fully on one side)
  let inN = 0,
    inE = 0;
  const innerHist = new Int32Array(256);
  for (let y = 1; y < wh - 1; y++) {
    for (let x = 1; x < ww - 1; x++) {
      const i = y * ww + x;
      if (!wmask.data[i]) continue;
      let full = true;
      for (let dy = -1; dy <= 1 && full; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!wmask.data[i + dy * ww + dx]) {
            full = false;
            break;
          }
        }
      }
      if (!full) continue;
      inN++;
      inE += mag[i];
      innerHist[luma[i] | 0]++;
    }
  }

  // surround: dilate(32) minus dilate(4), minus every bbox rect
  const rectBlocks = (px: number, py: number): boolean => {
    if (px >= bx1 && px <= bx2 && py >= by1 && py <= by2) return true;
    for (const r of otherRects) {
      if (px >= r.x1 && px <= r.x2 && py >= r.y1 && py <= r.y2) return true;
    }
    return false;
  };

  let suN = 0,
    suE = 0;
  const surHist = new Int32Array(256);
  for (let y = 1; y < wh - 1; y += 2) {
    for (let x = 1; x < ww - 1; x += 2) {
      const i = y * ww + x;
      if (!dilPad.data[i] || dil4.data[i]) continue;
      const px = wx1 + x;
      const py = wy1 + y;
      if (rectBlocks(px, py)) continue;
      // 3x3 fully on the surround side: no mask pixel in the window's interior
      let ok = true;
      for (let dy = -1; dy <= 1 && ok; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const j = i + dy * ww + dx;
          if (wmask.data[j]) {
            ok = false;
            break;
          }
        }
      }
      if (!ok) continue;
      suN++;
      suE += mag[i];
      surHist[luma[i] | 0]++;
    }
  }

  if (suN < 40 || inN < 12) return false; // no evidence: never decline

  const innerEdge = inE / inN;
  const surrEdge = suE / suN;
  if (surrEdge > 0.5 && innerEdge > QUALITY_EDGE_RATIO * surrEdge) return true;

  // histogram test: interior tone must belong to the paper around it
  const allow = deviationThreshold(noiseSigma);
  const q = (hist: Int32Array, f: number) => {
    const total = Array.from(hist).reduce((a, b) => a + b, 0);
    let acc = 0;
    for (let v = 0; v < 256; v++) {
      acc += hist[v];
      if (acc >= total * f) return v;
    }
    return 255;
  };
  const s5 = q(surHist, 0.05);
  const s95 = q(surHist, 0.95);
  const iMedian = q(innerHist, 0.5);
  if (iMedian < s5 - allow || iMedian > s95 + allow) return true;

  return false;
}
