import * as ort from "onnxruntime-web/all";
import { resolveExecutionProvidersForModel } from "../ort";
import { downloadArtifactHF } from "../utils";
import { DefaultConfig } from "../configs";
import type { Fitted } from "./fit";
import { dilate, type Mask } from "./mask";
import {
  ISOLATION_FEATHER,
  ISOLATION_RADIUS,
  MAX_BOX,
  MODEL_INPUT,
  TILE_HANDOFF,
  TILE_STRIDE,
} from "./constants";

let session: ort.InferenceSession | null = null;
let loadPromise: Promise<ort.InferenceSession | null> | null = null;
let lastLamaError: string | null = null;
let sessionWasmFallback = false;

export const lamaReady = (): boolean => !!session;
export const getLastLamaError = (): string | null => lastLamaError;

/** Padding margin around each speech bubble component in pixels (matches XianScan pad = 24). */
export const LAMA_PATCH_PAD = 24;
/** Dimension snapping bucket size to avoid GPU driver shader recompilation pauses (matches XianScan DirectML 64px rule). */
export const LAMA_BUCKET_SIZE = 64;
/** Stroke expansion applied to text polygon masks to swallow character anti-aliasing edges. */
export const LAMA_MASK_STROKE_WIDTH = 4;

interface BoundingBoxCluster {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  indices: number[];
}

function createLocalCanvas(w: number, h: number): HTMLCanvasElement | OffscreenCanvas {
  if (typeof OffscreenCanvas !== "undefined") {
    return new OffscreenCanvas(w, h);
  }
  if (typeof document !== "undefined") {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    return c;
  }
  throw new Error("No canvas implementation available");
}

export async function renderLamaPatches(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  bboxes: Bbox[],
): Promise<{ success: boolean; error: string | null }> {
  const ready = await ensureLama();
  if (!ready || !session) {
    lastLamaError = "LaMa session not ready";
    return { success: false, error: lastLamaError };
  }
  lastLamaError = null;

  if (bboxes.length === 0) {
    return { success: true, error: null };
  }

  const width = canvas.width;
  const height = canvas.height;

  // 1. Group text boxes that belong to the same bubble component (gap <= 24px)
  const boxes: BoundingBoxCluster[] = bboxes.map((b, idx) => ({
    minX: b.x1,
    minY: b.y1,
    maxX: b.x2,
    maxY: b.y2,
    indices: [idx],
  }));

  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        const intersects = !(
          a.maxX + LAMA_PATCH_PAD < b.minX - LAMA_PATCH_PAD ||
          a.minX - LAMA_PATCH_PAD > b.maxX + LAMA_PATCH_PAD ||
          a.maxY + LAMA_PATCH_PAD < b.minY - LAMA_PATCH_PAD ||
          a.minY - LAMA_PATCH_PAD > b.maxY + LAMA_PATCH_PAD
        );
        if (intersects) {
          boxes[i] = {
            minX: Math.min(a.minX, b.minX),
            minY: Math.min(a.minY, b.minY),
            maxX: Math.max(a.maxX, b.maxX),
            maxY: Math.max(a.maxY, b.maxY),
            indices: [...a.indices, ...b.indices],
          };
          boxes.splice(j, 1);
          merged = true;
          break;
        }
      }
      if (merged) break;
    }
  }

  // 2. Process each bubble cluster independently at 1:1 native resolution
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    const x0 = Math.max(0, Math.floor(b.minX - LAMA_PATCH_PAD));
    const y0 = Math.max(0, Math.floor(b.minY - LAMA_PATCH_PAD));
    const x1 = Math.min(width, Math.ceil(b.maxX + LAMA_PATCH_PAD));
    const y1 = Math.min(height, Math.ceil(b.maxY + LAMA_PATCH_PAD));

    const pw = x1 - x0;
    const ph = y1 - y0;
    if (pw < 8 || ph < 8) continue;

    // Snap dimensions to 64px multiple
    const snapW = Math.max(64, Math.ceil(pw / LAMA_BUCKET_SIZE) * LAMA_BUCKET_SIZE);
    const snapH = Math.max(64, Math.ceil(ph / LAMA_BUCKET_SIZE) * LAMA_BUCKET_SIZE);

    // Crop patch image from current canvas
    const patchCanvas = createLocalCanvas(snapW, snapH);
    const patchCtx = (patchCanvas as any).getContext("2d", { willReadFrequently: true })!;
    patchCtx.drawImage(canvas, x0, y0, pw, ph, 0, 0, pw, ph);

    // Prepare patch mask: solid black, white for text bboxes with 4px stroke expansion
    const maskCanvas = createLocalCanvas(snapW, snapH);
    const maskCtx = (maskCanvas as any).getContext("2d", { willReadFrequently: true })!;
    maskCtx.fillStyle = "black";
    maskCtx.fillRect(0, 0, snapW, snapH);

    maskCtx.fillStyle = "white";
    maskCtx.strokeStyle = "white";
    maskCtx.lineWidth = LAMA_MASK_STROKE_WIDTH;
    maskCtx.lineJoin = "round";
    maskCtx.lineCap = "round";

    for (const idx of b.indices) {
      const bbox = bboxes[idx];
      const bx = bbox.x1 - x0;
      const by = bbox.y1 - y0;
      const bw = Math.max(1, bbox.x2 - bbox.x1);
      const bh = Math.max(1, bbox.y2 - bbox.y1);

      maskCtx.beginPath();
      maskCtx.rect(bx, by, bw, bh);
      maskCtx.fill();
      maskCtx.stroke();
    }

    const totalPx = snapW * snapH;
    const imgData = patchCtx.getImageData(0, 0, snapW, snapH).data;
    const maskData = maskCtx.getImageData(0, 0, snapW, snapH).data;

    const imgFloat = new Float32Array(3 * totalPx);
    const maskFloat = new Float32Array(totalPx);

    for (let p = 0; p < totalPx; p++) {
      const off = p * 4;
      const m = maskData[off] >= 127 ? 1.0 : 0.0;
      maskFloat[p] = m;
      imgFloat[0 * totalPx + p] = (imgData[off] / 255.0) * (1.0 - m);
      imgFloat[1 * totalPx + p] = (imgData[off + 1] / 255.0) * (1.0 - m);
      imgFloat[2 * totalPx + p] = (imgData[off + 2] / 255.0) * (1.0 - m);
    }

    let imageTensor: ort.Tensor | null = null;
    let maskTensor: ort.Tensor | null = null;
    let outTensor: ort.Tensor | null = null;

    try {
      imageTensor = new ort.Tensor("float32", imgFloat, [1, 3, snapH, snapW]);
      maskTensor = new ort.Tensor("float32", maskFloat, [1, 1, snapH, snapW]);

      const inNames = session.inputNames;
      const feeds: Record<string, ort.Tensor> = {
        [inNames[0] ?? "image"]: imageTensor,
        [inNames[1] ?? "mask"]: maskTensor,
      };

      let outputs: Record<string, ort.Tensor>;
      try {
        outputs = await session.run(feeds);
      } catch (runErr) {
        const retried = await fallbackLamaToWasm();
        if (!retried || !session) throw runErr;
        const retryIn = session.inputNames;
        const retryFeeds: Record<string, ort.Tensor> = {
          [retryIn[0] ?? "image"]: imageTensor,
          [retryIn[1] ?? "mask"]: maskTensor,
        };
        outputs = await session.run(retryFeeds);
      }

      const outName = session.outputNames[0];
      outTensor = outputs[outName];
      const outData = (await outTensor.getData()) as Float32Array;

      // Transfer output to patch canvas
      const outCanvas = createLocalCanvas(snapW, snapH);
      const outCtx = (outCanvas as any).getContext("2d", { willReadFrequently: true })!;
      const outImgData = outCtx.createImageData(snapW, snapH);

      for (let p = 0; p < totalPx; p++) {
        const idx = p * 4;
        outImgData.data[idx] = Math.max(0, Math.min(255, Math.round(outData[0 * totalPx + p] * 255.0)));
        outImgData.data[idx + 1] = Math.max(0, Math.min(255, Math.round(outData[1 * totalPx + p] * 255.0)));
        outImgData.data[idx + 2] = Math.max(0, Math.min(255, Math.round(outData[2 * totalPx + p] * 255.0)));
        outImgData.data[idx + 3] = 255;
      }
      outCtx.putImageData(outImgData, 0, 0);

      // Composite patch back to ctx strictly where mask is active!
      const currentPatchData = ctx.getImageData(x0, y0, pw, ph);
      const hallucinatedPatchData = outCtx.getImageData(0, 0, pw, ph);
      const localMaskData = maskCtx.getImageData(0, 0, pw, ph);

      for (let p = 0; p < currentPatchData.data.length; p += 4) {
        if (localMaskData.data[p] >= 127) {
          currentPatchData.data[p] = hallucinatedPatchData.data[p];
          currentPatchData.data[p + 1] = hallucinatedPatchData.data[p + 1];
          currentPatchData.data[p + 2] = hallucinatedPatchData.data[p + 2];
        }
      }
      ctx.putImageData(currentPatchData, x0, y0);
    } catch (err) {
      lastLamaError = (err as Error)?.message ?? String(err);
      console.warn(`[inpaint] LaMa patch ${i + 1}/${boxes.length} failed:`, err);
      return { success: false, error: lastLamaError };
    } finally {
      imageTensor?.dispose?.();
      maskTensor?.dispose?.();
      outTensor?.dispose?.();
    }
  }

  return { success: true, error: null };
}

export async function ensureLama(): Promise<boolean> {
  if (session) return true;
  if (!loadPromise) {
    loadPromise = (async () => {
      try {
        session = await downloadArtifactHF(
          DefaultConfig.lamaRepo,
          DefaultConfig.lamaModelPath,
        );
        // InferenceSession exposes no public .providers in ORT 1.30, so log
        // the requested list instead of reading back.
        console.info(`[inpaint] LaMa session ready (${resolveExecutionProvidersForModel(DefaultConfig.lamaModelPath).join("+")})`);
      } catch (err) {
        console.warn("LMT: LaMa inpainter model unavailable:", err);
        session = null;
      } finally {
        loadPromise = null;
      }
      return session;
    })();
  }
  await loadPromise;
  return !!session;
}

/**
 * Rebuild the session forced onto WASM CPU after a WebGPU run() throw.
 * Retried once per renderLama call; returns true when a WASM session exists.
 */
async function fallbackLamaToWasm(): Promise<boolean> {
  if (sessionWasmFallback) return !!session;
  sessionWasmFallback = true;
  console.warn("[inpaint] LaMa WebGPU run failed, rebuilding session on WASM");
  await releaseLama();
  session = null;
  loadPromise = (async () => {
    try {
      session = await downloadArtifactHF(
        DefaultConfig.lamaRepo,
        DefaultConfig.lamaModelPath,
        false,
        { gpu: false },
      );
      console.info("[inpaint] LaMa WASM fallback session ready (wasm)");
    } catch (err) {
      console.warn("LMT: LaMa WASM fallback unavailable:", err);
      session = null;
    } finally {
      loadPromise = null;
    }
    return session;
  })();
  await loadPromise;
  return !!session;
}

export async function releaseLama(): Promise<void> {
  if (session) {
    try {
      await session.release();
    } catch (e) {
      console.warn("LMT: error releasing LaMa session:", e);
    }
    session = null;
  }
}

/** Compute 1-D tile origins along an axis spanning extent from start. */
export function tileOrigins(start: number, extent: number): number[] {
  if (extent <= MODEL_INPUT) {
    return [Math.round(start + extent / 2 - MODEL_INPUT / 2)];
  }
  const count = Math.ceil((extent - MODEL_INPUT) / TILE_STRIDE) + 1;
  const span = extent - MODEL_INPUT;
  const origins: number[] = [];
  for (let i = 0; i < count; i++) {
    origins.push(Math.round(start + (span * i) / (count - 1)));
  }
  return origins;
}

interface Tile {
  crop: { x: number; y: number; w: number; h: number };
  commit: { x: number; y: number; w: number; h: number };
}

export function planTiles(bounds: { x: number; y: number; w: number; h: number }): Tile[] {
  const xs = tileOrigins(bounds.x, bounds.w);
  const ys = tileOrigins(bounds.y, bounds.h);
  const cols = xs.length;
  const rows = ys.length;
  const tiles: Tile[] = [];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = xs[c];
      const y = ys[r];
      tiles.push({
        crop: { x, y, w: MODEL_INPUT, h: MODEL_INPUT },
        commit: {
          x,
          y,
          w: MODEL_INPUT - (c + 1 < cols ? TILE_HANDOFF : 0),
          h: MODEL_INPUT - (r + 1 < rows ? TILE_HANDOFF : 0),
        },
      });
    }
  }
  return tiles;
}

/** Linear ramp sampled across feather rings around Fitted.ink. */
export class AlphaRamp {
  private core: Mask;
  private ring1: Mask;
  private ring2: Mask;

  constructor(fitted: Pick<Fitted, "ink">) {
    const inner = ISOLATION_RADIUS - ISOLATION_FEATHER; // 3
    this.core = dilate(fitted.ink, inner);
    this.ring1 = dilate(fitted.ink, inner + 1); // 4
    this.ring2 = dilate(fitted.ink, ISOLATION_RADIUS); // 5
  }

  at(px: number, py: number): number {
    const lx = px - this.core.ox;
    const ly = py - this.core.oy;
    if (lx < 0 || lx >= this.core.w || ly < 0 || ly >= this.core.h) return 0;
    const idx = ly * this.core.w + lx;
    if (this.core.data[idx]) return 1.0;
    if (this.ring1.data[idx]) return 2 / 3;
    if (this.ring2.data[idx]) return 1 / 3;
    return 0;
  }
}

function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

function inRect(x: number, y: number, r: { x: number; y: number; w: number; h: number }): boolean {
  return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
}

/**
 * Execute LaMa inpainting on the region.
 * Returns true if the model ran and rendered into page, false on decline / failure.
 */
export async function renderLama(
  page: ImageData,
  fitted: Fitted,
): Promise<boolean> {
  const ready = await ensureLama();
  if (!ready || !session) {
    lastLamaError = "LaMa session not ready";
    return false;
  }
  lastLamaError = null;

  const pw = page.width;
  const ph = page.height;

  // Measure page-coordinate bounding box of ink
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let inkCount = 0;

  for (let y = 0; y < fitted.ink.h; y++) {
    for (let x = 0; x < fitted.ink.w; x++) {
      if (fitted.ink.data[y * fitted.ink.w + x]) {
        inkCount++;
        const px = fitted.ink.ox + x;
        const py = fitted.ink.oy + y;
        if (px < minX) minX = px;
        if (py < minY) minY = py;
        if (px > maxX) maxX = px;
        if (py > maxY) maxY = py;
      }
    }
  }

  if (inkCount === 0) return false;
  const extentW = maxX - minX + 1;
  const extentH = maxY - minY + 1;
  if (extentW > MAX_BOX || extentH > MAX_BOX) return false;

  const tiles = planTiles({ x: minX, y: minY, w: extentW, h: extentH });
  const ramp = new AlphaRamp(fitted);
  const done = new Uint8Array(pw * ph);
  const planeSize = MODEL_INPUT * MODEL_INPUT;

  const isInkHole = (px: number, py: number): boolean => {
    const lx = px - fitted.ink.ox;
    const ly = py - fitted.ink.oy;
    if (lx < 0 || lx >= fitted.ink.w || ly < 0 || ly >= fitted.ink.h) return false;
    return fitted.ink.data[ly * fitted.ink.w + lx] === 1;
  };

  for (const tile of tiles) {
    let commitHoles = 0;
    const modelMask = new Float32Array(planeSize);

    for (let ty = 0; ty < MODEL_INPUT; ty++) {
      const py = tile.crop.y + ty;
      for (let tx = 0; tx < MODEL_INPUT; tx++) {
        const px = tile.crop.x + tx;
        const pageIdx = py >= 0 && py < ph && px >= 0 && px < pw ? py * pw + px : -1;
        const alreadyDone = pageIdx >= 0 ? done[pageIdx] === 1 : false;

        if (isInkHole(px, py) && !alreadyDone) {
          modelMask[ty * MODEL_INPUT + tx] = 1.0;
          if (inRect(px, py, tile.commit)) {
            commitHoles++;
          }
        }
      }
    }

    if (commitHoles === 0) continue;

    // Build RGB image input: 3 x 512 x 512 normalized 0..1
    const modelImage = new Float32Array(3 * planeSize);
    for (let ty = 0; ty < MODEL_INPUT; ty++) {
      const py = tile.crop.y + ty;
      const cy = Math.max(0, Math.min(ph - 1, py)); // edge-replicate
      for (let tx = 0; tx < MODEL_INPUT; tx++) {
        const px = tile.crop.x + tx;
        const cx = Math.max(0, Math.min(pw - 1, px)); // edge-replicate
        const tIdx = ty * MODEL_INPUT + tx;

        // The model expects hole zeroed in image
        if (modelMask[tIdx] === 1.0) continue;

        const srcIdx = (cy * pw + cx) * 4;
        modelImage[tIdx] = page.data[srcIdx] / 255.0;
        modelImage[planeSize + tIdx] = page.data[srcIdx + 1] / 255.0;
        modelImage[planeSize * 2 + tIdx] = page.data[srcIdx + 2] / 255.0;
      }
    }

    let imageTensor: ort.Tensor | null = null;
    let maskTensor: ort.Tensor | null = null;
    let outTensor: ort.Tensor | null = null;
    try {
      imageTensor = new ort.Tensor("float32", modelImage, [1, 3, MODEL_INPUT, MODEL_INPUT]);
      maskTensor = new ort.Tensor("float32", modelMask, [1, 1, MODEL_INPUT, MODEL_INPUT]);

      const feeds: Record<string, ort.Tensor> = {};
      const inNames = session.inputNames;
      feeds[inNames[0] ?? "image"] = imageTensor;
      feeds[inNames[1] ?? "mask"] = maskTensor;

      let outputs: Record<string, ort.Tensor>;
      try {
        outputs = await session.run(feeds);
      } catch (runErr) {
        // WebGPU kernels can throw at run() even when create() succeeded
        // (unsupported op combo). Rebuild once on WASM and retry this tile.
        const retried = await fallbackLamaToWasm();
        if (!retried || !session) throw runErr;
        const retryIn = session.inputNames;
        const retryFeeds: Record<string, ort.Tensor> = {
          [retryIn[0] ?? "image"]: imageTensor,
          [retryIn[1] ?? "mask"]: maskTensor,
        };
        outputs = await session.run(retryFeeds);
      }
      const outNames = session.outputNames;
      outTensor = outputs[outNames[0] ?? Object.keys(outputs)[0]];
      const outData = (await outTensor.getData()) as Float32Array;

      // Composite commit pixels into page with AlphaRamp
      for (let ty = 0; ty < MODEL_INPUT; ty++) {
        const py = tile.crop.y + ty;
        if (py < 0 || py >= ph) continue;
        for (let tx = 0; tx < MODEL_INPUT; tx++) {
          const px = tile.crop.x + tx;
          if (px < 0 || px >= pw) continue;
          if (!inRect(px, py, tile.commit)) continue;

          const pIdx = py * pw + px;
          if (done[pIdx]) continue;

          const alpha = ramp.at(px, py);
          if (alpha <= 0) continue;

          const i = pIdx * 4;
          const tIdx = ty * MODEL_INPUT + tx;

          for (let c = 0; c < 3; c++) {
            const sample = clamp255(Math.round(outData[c * planeSize + tIdx] * 255.0));
            page.data[i + c] = Math.round(alpha * sample + (1 - alpha) * page.data[i + c]);
          }
          done[pIdx] = 1;
        }
      }
    } catch (err) {
      lastLamaError = (err as Error)?.message ?? String(err);
      console.warn("LMT: LaMa tile inference failed:", err);
      return false;
    } finally {
      imageTensor?.dispose?.();
      maskTensor?.dispose?.();
      outTensor?.dispose?.();
    }
  }

  return true;
}
