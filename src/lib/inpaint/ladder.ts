import { fetchAsImageBitmap, yieldToMain } from "../utils";
import { teleaInpaint } from "./telea";
import {
  buildInkSeed,
  buildSegmentationSeed,
  dilate,
  maskCount,
  type Mask,
} from "./mask";
import { pageNoiseSigma, sobelMagnitude, strongEdgeFloor, toLuma } from "./noise";
import { fitMask, type Fitted, type Route } from "./fit";
import { renderFill } from "./fill";
import { renderDenoise } from "./denoise";
import { renderLama, renderLamaPatches, getLastLamaError } from "./lama";
import { regionDeclines } from "./quality";
import {
  CROP_MARGIN,
  DENOISE_DILATION,
  DENOISE_FEATHER,
  ISOLATION_RADIUS,
  MAX_MASKED_FRACTION,
} from "./constants";

/**
 * The engine ladder, per region: given a page and a fitted mask, produce the
 * pixels for one patch covering the mask's bounds, everything outside copied
 * through.
 *
 * Two paths share the seed/fit machinery:
 * - Fast (`inpaintImageAuto`): rungs 0 planar fill, 1 denoise, 3 Telea
 *   fast-marching. No model, no downloads. The default.
 * - Quality (`inpaintImageQuality`): a standalone LaMa-first pass over the
 *   fitted `ink` hole; a region LaMa declines or fails falls back into the
 *   Fast ladder. Fully decoupled from the rung ladder.
 *
 * Every attempt is scored by the ONE decline metric; a declined attempt is
 * rolled back and the region climbs (or falls back).
 */

export interface InpaintRegionResult {
  index: number;
  method: "fill" | "denoise" | "lama" | "telea" | "rect-telea" | "declined" | "skipped";
  route: Route | "rect";
  deviation: number;
  thickness: number;
  ms: number;
  lamaError?: string | null;
}

export interface InpaintAutoResult {
  url: string;
  regions: InpaintRegionResult[];
}

export interface InpaintAutoOptions {
  segmentation?: Uint8Array | null;
}

interface PageRect {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

interface Attempt {
  method: InpaintRegionResult["method"];
  mask: Mask;
  render: () => Promise<boolean | void> | void;
}

type PreparedRegion =
  | { kind: "skipped"; index: number }
  | {
      kind: "rect";
      index: number;
      ms: () => number;
      otherRects: PageRect[];
      rect: Mask;
      cropRgb: Uint8ClampedArray;
    }
  | {
      kind: "fitted";
      index: number;
      ms: () => number;
      otherRects: PageRect[];
      fitted: Fitted;
      cropRgb: Uint8ClampedArray;
    };

/**
 * Stored method values normalize forward: only "quality" selects the LaMa
 * path — every legacy value ("auto", "telea", old edge-blend "fast") is Fast.
 */
export function normalizeInpaintMethod(value: unknown): "fast" | "quality" {
  return value === "quality" ? "quality" : "fast";
}

/**
 * Fast attempt plan per route. LaMa is never a Fast rung —
 * see inpaintImageQuality for the decoupled model path.
 */
export function planFastMethods(
  route: Route,
): ("fill" | "denoise" | "telea")[] {
  if (route === "fill") return ["fill", "denoise", "telea"];
  if (route === "denoise") return ["denoise", "telea"];
  return ["telea"];
}

async function openPage(imageSrc: string): Promise<{
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  page: ImageData;
}> {
  const bitmap = await fetchAsImageBitmap(imageSrc);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();

  const page = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { canvas, ctx, page };
}

function pageStats(page: ImageData): {
  strongFloor: number;
  noiseSigma: number;
} {
  const lumaPage = new Float32Array(page.width * page.height);
  toLuma(page.data, lumaPage);
  return {
    strongFloor: strongEdgeFloor(lumaPage, page.width, page.height),
    noiseSigma: pageNoiseSigma(lumaPage, page.width, page.height),
  };
}

/**
 * Shared region prep for both paths: crop, seed (segmentation mask when the
 * comic-text-detector is active, else the percentile heuristic), fit.
 */
function prepareRegion(
  page: ImageData,
  strongFloor: number,
  noiseSigma: number,
  bboxes: Bbox[],
  i: number,
  segmentation?: Uint8Array | null,
): PreparedRegion {
  const pw = page.width;
  const ph = page.height;
  const t0 = performance.now();
  const ms = () => Math.round(performance.now() - t0);
  const bbox = bboxes[i];
  const rx1 = Math.max(0, Math.round(bbox.x1));
  const ry1 = Math.max(0, Math.round(bbox.y1));
  const rx2 = Math.min(pw - 1, Math.round(bbox.x2));
  const ry2 = Math.min(ph - 1, Math.round(bbox.y2));
  if (rx2 - rx1 < 4 || ry2 - ry1 < 4) {
    return { kind: "skipped", index: i };
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

  const seedBox = {
    x1: rx1 - cx0,
    y1: ry1 - cy0,
    x2: rx2 - cx0,
    y2: ry2 - cy0,
  };
  let seed = segmentation
    ? buildSegmentationSeed(segmentation, pw, ph, cw, ch, cx0, cy0, seedBox)
    : buildInkSeed(cropLuma, cw, ch, cx0, cy0, seedBox);

  if (maskCount(seed) < 3 && segmentation) {
    seed = buildInkSeed(cropLuma, cw, ch, cx0, cy0, seedBox);
  }

  if (maskCount(seed) < 3) {
    return {
      kind: "rect",
      index: i,
      ms,
      otherRects,
      rect: rectMask(cw, ch, cx0, cy0, rx1, ry1, rx2, ry2),
      cropRgb,
    };
  }

  return {
    kind: "fitted",
    index: i,
    ms,
    otherRects,
    fitted: fitMask(seed, cropLuma, cropRgb, mag, strongFloor, noiseSigma),
    cropRgb,
  };
}

/** Fast attempt list for a fitted region, in cost order. */
function fastAttempts(
  page: ImageData,
  fitted: Fitted,
  cropRgb: Uint8ClampedArray,
  noiseSigma: number,
): Attempt[] {
  const denoiseApplied = dilate(
    fitted.mask,
    DENOISE_DILATION + DENOISE_FEATHER,
  );
  const teleaAttempt: Attempt = {
    method: "telea",
    mask: fitted.mask,
    render: () => runTelea(page, fitted.mask, cropRgb),
  };
  if (fitted.route === "fill") {
    return [
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
    ];
  }
  if (fitted.route === "denoise") {
    return [
      {
        method: "denoise",
        mask: denoiseApplied,
        render: () =>
          renderDenoise(page, fitted.mask, fitted, noiseSigma),
      },
      teleaAttempt,
    ];
  }
  return [teleaAttempt];
}

function lamaAttemptFor(page: ImageData, fitted: Fitted): Attempt {
  return {
    method: "lama",
    mask: dilate(fitted.ink, ISOLATION_RADIUS),
    render: async () => await renderLama(page, fitted),
  };
}

async function runAttempts(
  page: ImageData,
  index: number,
  attempts: Attempt[],
  noiseSigma: number,
  otherRects: PageRect[],
  skipDecline = false,
): Promise<{
  done: InpaintRegionResult["method"];
  lamaError: string | null;
}> {
  let done: InpaintRegionResult["method"] = "declined";
  let lamaError: string | null = null;
  for (const attempt of attempts) {
    const ok = await runRung(
      page,
      attempt.mask,
      attempt.render,
      skipDecline
        ? () => false
        : () => regionDeclines(page, attempt.mask, noiseSigma, otherRects),
    );
    if (ok) {
      done = attempt.method;
      break;
    }
    if (attempt.method === "lama") {
      lamaError = getLastLamaError();
      if (lamaError) {
        console.warn(`LMT: LaMa declined region ${index}:`, lamaError);
      }
    }
  }
  return { done, lamaError };
}

function fittedProvenance(
  fitted: Fitted,
): Pick<InpaintRegionResult, "route" | "deviation" | "thickness"> {
  return {
    route: fitted.route,
    deviation: Math.round(fitted.ring.deviation * 100) / 100,
    thickness: fitted.thickness,
  };
}

async function paintRectFallback(
  page: ImageData,
  prep: Extract<PreparedRegion, { kind: "rect" }>,
  noiseSigma: number,
): Promise<InpaintRegionResult> {
  // No usable ink: rectangle Telea on the bbox, still decline-gated.
  const { rect, cropRgb, otherRects, index, ms } = prep;
  const ok = await runRung(
    page,
    rect,
    () => runTelea(page, rect, cropRgb),
    () => regionDeclines(page, rect, noiseSigma, otherRects),
  );
  return {
    index,
    method: ok ? "rect-telea" : "declined",
    route: "rect",
    deviation: 999,
    thickness: 0,
    ms: ms(),
  };
}

/**
 * Fast path (default): per-region fitted mask through the model-free ladder
 * (planar fill → bilateral denoise → crop-local Telea), each rung
 * decline-gated with snapshot/rollback. A region nothing can clean is left
 * exactly as it was and reported.
 */
export async function inpaintImageAuto(
  imageSrc: string,
  bboxes: Bbox[],
  options?: InpaintAutoOptions,
): Promise<InpaintAutoResult> {
  const { canvas, ctx, page } = await openPage(imageSrc);
  const { strongFloor, noiseSigma } = pageStats(page);

  const regions: InpaintRegionResult[] = [];

  for (let i = 0; i < bboxes.length; i++) {
    await yieldToMain();
    const prep = prepareRegion(
      page,
      strongFloor,
      noiseSigma,
      bboxes,
      i,
      options?.segmentation,
    );
    if (prep.kind === "skipped") {
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
    if (prep.kind === "rect") {
      regions.push(await paintRectFallback(page, prep, noiseSigma));
      continue;
    }

    const { fitted, cropRgb, otherRects, ms } = prep;
    const { done, lamaError } = await runAttempts(
      page,
      i,
      fastAttempts(page, fitted, cropRgb, noiseSigma),
      noiseSigma,
      otherRects,
    );
    regions.push({
      index: i,
      method: done,
      ...fittedProvenance(fitted),
      ms: ms(),
      lamaError,
    });
  }

  ctx.putImageData(page, 0, 0);
  return { url: canvas.toDataURL("image/png"), regions };
}

export async function inpaintImageQuality(
  imageSrc: string,
  bboxes: Bbox[],
  options?: InpaintAutoOptions,
): Promise<InpaintAutoResult> {
  const { canvas, ctx } = await openPage(imageSrc);

  if (bboxes.length === 0) {
    return { url: canvas.toDataURL("image/png"), regions: [] };
  }

  const t0 = performance.now();
  const lamaRes = await renderLamaPatches(canvas, ctx, bboxes);
  const totalMs = Math.round(performance.now() - t0);

  if (lamaRes.success) {
    const regions: InpaintRegionResult[] = bboxes.map((_, i) => ({
      index: i,
      method: "lama",
      route: "inpaint",
      deviation: 0,
      thickness: 0,
      ms: Math.round(totalMs / bboxes.length),
      lamaError: null,
    }));
    return { url: canvas.toDataURL("image/png"), regions };
  }

  // Model failed to initialize/execute (e.g. offline first-run): fall back to Fast ladder
  console.warn("LMT: LaMa neural inpainting failed, falling back to Fast ladder:", lamaRes.error);
  return await inpaintImageAuto(imageSrc, bboxes, options);
}

/**
 * Apply one rung with rollback: snapshot the write rect, render, decline-test;
 * on decline restore and report false. (runRung's `declined` callback runs on
 * the POST pixels - the pixels that would ship.)
 */
async function runRung(
  page: ImageData,
  mask: Mask,
  render: () => Promise<boolean | void> | void,
  declined: () => boolean = () => false,
): Promise<boolean> {
  const rect = maskWriteRect(page, mask);
  const snapshot = snapshotRect(page, rect);
  try {
    const res = await render();
    if (res === false) {
      restoreRect(page, rect, snapshot);
      return false;
    }
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
