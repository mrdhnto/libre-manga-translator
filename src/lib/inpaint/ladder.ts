import { fetchAsImageBitmap } from "../utils";
import { teleaInpaint } from "./telea";
import {
  buildInkSeed,
  dilate,
  maskCount,
  type Mask,
} from "./mask";
import { pageNoiseSigma, sobelMagnitude, strongEdgeFloor, toLuma } from "./noise";
import { fitMask, type Route } from "./fit";
import { renderFill } from "./fill";
import { renderDenoise } from "./denoise";
import { regionDeclines } from "./quality";
import {
  CROP_MARGIN,
  DENOISE_DILATION,
  DENOISE_FEATHER,
  MAX_MASKED_FRACTION,
} from "./constants";

/**
 * The engine ladder, per region: given a page and a fitted mask, produce the
 * pixels for one patch covering the mask's bounds, everything outside copied
 * through.
 *
 * Rungs: 0 planar fill, 1 denoise, 2 Telea fast-marching (our model rung is
 * Beta5's LaMa). A rung's output is scored by the ONE decline metric; a
 * declined attempt is rolled back and the region climbs. The automatic pass
 * never starts above rung 2, and a region nothing can clean is left exactly
 * as it was and reported - "declined" means the same thing whichever rung
 * produced it.
 */

export interface InpaintRegionResult {
  index: number;
  method: "fill" | "denoise" | "telea" | "rect-telea" | "declined" | "skipped";
  route: Route | "rect";
  deviation: number;
  thickness: number;
  ms: number;
}

export interface InpaintAutoResult {
  url: string;
  regions: InpaintRegionResult[];
}

export async function inpaintImageAuto(
  imageSrc: string,
  bboxes: Bbox[],
): Promise<InpaintAutoResult> {
  const bitmap = await fetchAsImageBitmap(imageSrc);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();

  const page = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const pw = page.width;
  const ph = page.height;

  const lumaPage = new Float32Array(pw * ph);
  toLuma(page.data, lumaPage);
  const strongFloor = strongEdgeFloor(lumaPage, pw, ph);
  const noiseSigma = pageNoiseSigma(lumaPage, pw, ph);

  const regions: InpaintRegionResult[] = [];

  for (let i = 0; i < bboxes.length; i++) {
    const t0 = performance.now();
    const bbox = bboxes[i];
    const rx1 = Math.max(0, Math.round(bbox.x1));
    const ry1 = Math.max(0, Math.round(bbox.y1));
    const rx2 = Math.min(pw - 1, Math.round(bbox.x2));
    const ry2 = Math.min(ph - 1, Math.round(bbox.y2));
    if (rx2 - rx1 < 4 || ry2 - ry1 < 4) {
      regions.push({
        index: i,
        method: "skipped",
        route: "rect",
        deviation: 0,
        thickness: 0,
        ms: 0,
      });
      continue;
    }

    const cx0 = Math.max(0, rx1 - CROP_MARGIN);
    const cy0 = Math.max(0, ry1 - CROP_MARGIN);
    const cx1 = Math.min(pw - 1, rx2 + CROP_MARGIN);
    const cy1 = Math.min(ph - 1, ry2 + CROP_MARGIN);
    const cw = cx1 - cx0 + 1;
    const ch = cy1 - cy0 + 1;

    const cropRgb = new Uint8ClampedArray(cw * ch * 4);
    for (let y = 0; y < ch; y++) {
      const src = ((cy0 + y) * pw + cx0) * 4;
      cropRgb.set(page.data.subarray(src, src + cw * 4), y * cw * 4);
    }
    const cropLuma = new Float32Array(cw * ch);
    toLuma(cropRgb, cropLuma);
    const mag = sobelMagnitude(cropLuma, cw, ch);

    const otherRects = bboxes
      .map((b) => ({
        x1: Math.round(b.x1),
        y1: Math.round(b.y1),
        x2: Math.round(b.x2),
        y2: Math.round(b.y2),
      }))
      .filter((_, j) => j !== i);

    const seed = buildInkSeed(cropLuma, cw, ch, cx0, cy0, {
      x1: rx1 - cx0,
      y1: ry1 - cy0,
      x2: rx2 - cx0,
      y2: ry2 - cy0,
    });
    const seedCount = maskCount(seed);

    const ms = () => Math.round(performance.now() - t0);

    if (seedCount < 3) {
      // No usable ink: legacy rectangle Telea on the bbox, still decline-gated.
      const rect = rectMask(cw, ch, cx0, cy0, rx1, ry1, rx2, ry2);
      const ok = runRung(
        page,
        rect,
        () => runTelea(page, rect, cropRgb),
        () => regionDeclines(page, rect, noiseSigma, otherRects),
      );
      regions.push({
        index: i,
        method: ok ? "rect-telea" : "declined",
        route: "rect",
        deviation: 999,
        thickness: 0,
        ms: ms(),
      });
      continue;
    }

    const fitted = fitMask(seed, cropLuma, cropRgb, mag, strongFloor, noiseSigma);

    const attempts: {
      method: InpaintRegionResult["method"];
      mask: Mask;
      render: () => void;
    }[] = [];
    const denoiseApplied = dilate(fitted.mask, DENOISE_DILATION + DENOISE_FEATHER);
    const teleaAttempt = {
      method: "telea" as const,
      mask: fitted.mask,
      render: () => runTelea(page, fitted.mask, cropRgb),
    };
    if (fitted.route === "fill") {
      attempts.push(
        {
          method: "fill",
          mask: fitted.mask,
          render: () => renderFill(page, fitted.mask, fitted),
        },
        {
          method: "denoise",
          mask: denoiseApplied,
          render: () =>
            renderDenoise(page, fitted.mask, fitted, noiseSigma),
        },
        teleaAttempt,
      );
    } else if (fitted.route === "denoise") {
      attempts.push(
        {
          method: "denoise",
          mask: denoiseApplied,
          render: () =>
            renderDenoise(page, fitted.mask, fitted, noiseSigma),
        },
        teleaAttempt,
      );
    } else {
      attempts.push(teleaAttempt);
    }

    let done: InpaintRegionResult["method"] = "declined";
    for (const attempt of attempts) {
      const ok = runRung(page, attempt.mask, attempt.render, () =>
        regionDeclines(page, attempt.mask, noiseSigma, otherRects),
      );
      if (ok) {
        done = attempt.method;
        break;
      }
    }

    regions.push({
      index: i,
      method: done,
      route: fitted.route,
      deviation: Math.round(fitted.ring.deviation * 100) / 100,
      thickness: fitted.thickness,
      ms: ms(),
    });
  }

  ctx.putImageData(page, 0, 0);
  return { url: canvas.toDataURL("image/png"), regions };
}

/**
 * Apply one rung with rollback: snapshot the write rect, render, decline-test;
 * on decline restore and report false. (runRung's `declined` callback runs on
 * the POST pixels - the pixels that would ship.)
 */
function runRung(
  page: ImageData,
  mask: Mask,
  render: () => void,
  declined: () => boolean = () => false,
): boolean {
  const rect = maskWriteRect(page, mask);
  const snapshot = snapshotRect(page, rect);
  try {
    render();
  } catch {
    restoreRect(page, rect, snapshot);
    return false; // a rung that cannot render the region declines it
  }
  if (declined()) {
    restoreRect(page, rect, snapshot);
    return false;
  }
  return true;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function maskWriteRect(page: ImageData, mask: Mask): Rect {
  let x1 = page.width,
    y1 = page.height,
    x2 = 0,
    y2 = 0;
  for (let y = 0; y < mask.h; y++) {
    for (let x = 0; x < mask.w; x++) {
      if (!mask.data[y * mask.w + x]) continue;
      const px = mask.ox + x;
      const py = mask.oy + y;
      if (px < x1) x1 = px;
      if (px > x2) x2 = px;
      if (py < y1) y1 = py;
      if (py > y2) y2 = py;
    }
  }
  return { x: x1, y: y1, w: x2 - x1 + 1, h: y2 - y1 + 1 };
}

function snapshotRect(page: ImageData, r: Rect): Uint8ClampedArray {
  const out = new Uint8ClampedArray(r.w * r.h * 4);
  for (let y = 0; y < r.h; y++) {
    const src = ((r.y + y) * page.width + r.x) * 4;
    out.set(page.data.subarray(src, src + r.w * 4), y * r.w * 4);
  }
  return out;
}

function restoreRect(page: ImageData, r: Rect, snap: Uint8ClampedArray): void {
  for (let y = 0; y < r.h; y++) {
    const dst = ((r.y + y) * page.width + r.x) * 4;
    page.data.set(snap.subarray(y * r.w * 4, (y + 1) * r.w * 4), dst);
  }
}

/** Telea on the crop: FMM fills the mask in a crop-local copy, then writes back. */
function runTelea(page: ImageData, mask: Mask, cropRgb: Uint8ClampedArray): void {
  const { w, h, ox, oy } = mask;
  if (maskCount(mask) > w * h * MAX_MASKED_FRACTION) {
    throw new Error("ladder: mask covers too much of the crop");
  }
  const crop = new Uint8ClampedArray(cropRgb);
  const img = new ImageData(crop, w, h);
  teleaInpaint(img, mask.data, 3);
  for (let y = 0; y < h; y++) {
    const py = oy + y;
    if (py < 0 || py >= page.height) continue;
    for (let x = 0; x < w; x++) {
      const px = ox + x;
      if (px < 0 || px >= page.width) continue;
      const src = (y * w + x) * 4;
      const dst = (py * page.width + px) * 4;
      page.data[dst] = crop[src];
      page.data[dst + 1] = crop[src + 1];
      page.data[dst + 2] = crop[src + 2];
    }
  }
}

function rectMask(
  w: number,
  h: number,
  ox: number,
  oy: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): Mask {
  const data = new Uint8Array(w * h);
  for (let y = Math.max(0, y1 - oy); y <= Math.min(h - 1, y2 - oy); y++) {
    for (let x = Math.max(0, x1 - ox); x <= Math.min(w - 1, x2 - ox); x++) {
      data[y * w + x] = 1;
    }
  }
  return { data, w, h, ox, oy };
}
