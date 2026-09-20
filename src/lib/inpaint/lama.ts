import * as ort from "onnxruntime-web/all";
import { downloadArtifactHF } from "../models";
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

/**
 * Rung 2 - manga-finetuned LaMa (mayocream/lama-manga-onnx, opset 17, MIT).
 *
 * Tensor contract:
 * - image:  Float32[1, 3, 512, 512], range 0..1 (RGB).
 * - mask:   Float32[1, 1, 512, 512], range 0..1, 1 = hole to fill.
 * - output: Float32[1, 3, 512, 512], range 0..1 (RGB).
 *
 * Tiling:
 * - 512x512 window. Boxes > 512 px tiled with 128 px overlap.
 * - Each tile commits core, handoff margin preserved for next tile.
 * - Hole cut at `done` so already filled parts serve as unmasked context.
 * - Alpha ramp over 2 px inside ISOLATION_RADIUS along glyph contours.
 */

let session: ort.InferenceSession | null = null;
let loadPromise: Promise<ort.InferenceSession | null> | null = null;

export const lamaReady = (): boolean => !!session;

export async function ensureLama(autoUpdate = true): Promise<boolean> {
  if (session) return true;
  if (!loadPromise) {
    loadPromise = (async () => {
      try {
        session = await downloadArtifactHF(
          DefaultConfig.lamaRepo,
          DefaultConfig.lamaModelPath,
          autoUpdate,
        );
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
  if (!ready || !session) return false;

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

    try {
      const imageTensor = new ort.Tensor("float32", modelImage, [1, 3, MODEL_INPUT, MODEL_INPUT]);
      const maskTensor = new ort.Tensor("float32", modelMask, [1, 1, MODEL_INPUT, MODEL_INPUT]);

      const feeds: Record<string, ort.Tensor> = {};
      const inNames = session.inputNames;
      feeds[inNames[0] ?? "image"] = imageTensor;
      feeds[inNames[1] ?? "mask"] = maskTensor;

      const outputs = await session.run(feeds);
      const outNames = session.outputNames;
      const outTensor = outputs[outNames[0] ?? Object.keys(outputs)[0]];
      const outData = outTensor.data as Float32Array;

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
      console.warn("LMT: LaMa tile inference failed:", err);
      return false;
    }
  }

  return true;
}
