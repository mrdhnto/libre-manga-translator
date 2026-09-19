import {
  INK_PAPER_FACTOR,
  MAX_COMPONENT_FRACTION,
  MIN_COMPONENT_PX,
} from "./constants";

/**
 * Binary masks and morphology for the inpaint ladder.
 *
 * Crop-local: every mask lives in the crop's own coordinate system; `ox/oy`
 * carry the page origin of the crop so callers can map back. The seed is
 * threshold-based (Beta5 may upgrade it to a true text segmentation).
 */

export interface Mask {
  data: Uint8Array; // 1 = inside, row-major
  w: number;
  h: number;
  /** page coordinate of crop-local (0, 0) */
  ox: number;
  oy: number;
}

/** Quantile from a 256-bin luma histogram (values are 0..255 bins). */
export function percentile(hist: Int32Array, q: number): number {
  const total = Array.from(hist).reduce((a, b) => a + b, 0);
  if (total === 0) return 128;
  const want = Math.max(0, Math.min(total - 1, Math.floor(total * q)));
  let acc = 0;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc > want) return v;
  }
  return 255;
}

function histogram(luma: Float32Array): Int32Array {
  const hist = new Int32Array(256);
  for (let i = 0; i < luma.length; i++) {
    hist[luma[i] < 0 ? 0 : luma[i] > 255 ? 255 : luma[i] | 0]++;
  }
  return hist;
}

/**
 * Text-shaped seed mask inside a crop.
 *
 * Same percentile math the OCR line-slicer already uses (`ocr/utils.ts`):
 * ink from the crop extremes, paper = p75 of the crop perimeter, threshold at
 * 40% between them. Inverted (light ink on dark paper) is flipped like
 * `normalizePolarity`. Components < 4 px (grain) and > 60% of the crop
 * (whole artwork) are dropped.
 *
 * `rect` (crop-local) intersects the seed with the region's masking box:
 * without it a stroke or SFX inside the growth margin would be seeded as ink.
 */
export function buildInkSeed(
  luma: Float32Array,
  w: number,
  h: number,
  ox: number,
  oy: number,
  rect?: { x1: number; y1: number; x2: number; y2: number },
): Mask {
  const data = new Uint8Array(w * h);
  if (w < 3 || h < 3) return { data, w, h, ox, oy };

  const hist = histogram(luma);
  // Perimeter histogram = paper. 1 px border.
  const border = new Int32Array(256);
  for (let x = 0; x < w; x++) {
    border[luma[x] | 0]++;
    border[luma[(h - 1) * w + x] | 0]++;
  }
  for (let y = 0; y < h; y++) {
    border[luma[y * w] | 0]++;
    border[luma[y * w + w - 1] | 0]++;
  }

  const paper = percentile(border, 0.75);
  // Ink is a small area of the CROP (bbox + 2x growth margin), so a p5-style
  // quantile lands in paper; take the extreme 1% instead.
  const darkInk = percentile(hist, 0.01);
  const lightInk = percentile(hist, 0.99);
  const inverted = paper < 128;
  const ink = inverted ? lightInk : darkInk;

  const lo = Math.min(ink, paper);
  const hi = Math.max(ink, paper);
  if (hi - lo < 12) return { data, w, h, ox, oy }; // no usable contrast

  const thr = inverted
    ? lo + (hi - lo) * (1 - INK_PAPER_FACTOR)
    : lo + (hi - lo) * INK_PAPER_FACTOR;

  for (let i = 0; i < w * h; i++) {
    const v = luma[i];
    data[i] = inverted ? (v > thr ? 1 : 0) : (v < thr ? 1 : 0);
  }

  if (rect) {
    const x1 = Math.max(0, rect.x1);
    const y1 = Math.max(0, rect.y1);
    const x2 = Math.min(w - 1, rect.x2);
    const y2 = Math.min(h - 1, rect.y2);
    for (let y = 0; y < h; y++) {
      if (y < y1 || y > y2) {
        data.fill(0, y * w, y * w + w);
        continue;
      }
      for (let x = 0; x < w; x++) {
        if (x < x1 || x > x2) data[y * w + x] = 0;
      }
    }
  }
  dropSmallComponents(data, w, h, MIN_COMPONENT_PX);
  dropHugeComponents(data, w, h, MAX_COMPONENT_FRACTION);
  return { data, w, h, ox, oy };
}

/**
 * Seed mask derived from a true per-pixel segmentation model.
 * Rescaled segmentation levels (0..255) sampled at native page coordinates
 * and intersected with the region's masking bounds.
 */
export function buildSegmentationSeed(
  segLevels: Uint8Array,
  pageWidth: number,
  pageHeight: number,
  w: number,
  h: number,
  ox: number,
  oy: number,
  rect?: { x1: number; y1: number; x2: number; y2: number },
): Mask {
  const data = new Uint8Array(w * h);
  const MASK_THRESHOLD = 76; // 0.3 * 255
  const rx1 = rect ? Math.max(0, rect.x1) : 0;
  const ry1 = rect ? Math.max(0, rect.y1) : 0;
  const rx2 = rect ? Math.min(w - 1, rect.x2) : w - 1;
  const ry2 = rect ? Math.min(h - 1, rect.y2) : h - 1;

  for (let y = ry1; y <= ry2; y++) {
    const py = oy + y;
    if (py < 0 || py >= pageHeight) continue;
    for (let x = rx1; x <= rx2; x++) {
      const px = ox + x;
      if (px < 0 || px >= pageWidth) continue;
      if (segLevels[py * pageWidth + px] >= MASK_THRESHOLD) {
        data[y * w + x] = 1;
      }
    }
  }
  dropSmallComponents(data, w, h, MIN_COMPONENT_PX);
  return { data, w, h, ox, oy };
}

/** Square-kernel binary dilation, separable with a running-window count (O(n)). */
export function dilate(m: Mask, k: number): Mask {
  if (k <= 0) return m;
  const { data, w, h } = m;
  const tmp = new Uint8Array(w * h);
  const out = new Uint8Array(w * h);

  // horizontal: window [x-k, x+k] contains a 1 -> tmp
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let count = 0;
    for (let x = -k; x <= k; x++) count += data[row + clampI(x, 0, w - 1)];
    // dedupe clamped edges only matters near borders; overcount keeps 1s, fine.
    for (let x = 0; x < w; x++) {
      tmp[row + x] = count > 0 ? 1 : 0;
      const outPx = row + clampI(x - k, 0, w - 1);
      const inPx = row + clampI(x + k + 1, 0, w - 1);
      count += data[inPx] - data[outPx];
    }
  }
  // vertical on tmp -> out
  for (let x = 0; x < w; x++) {
    let count = 0;
    for (let y = -k; y <= k; y++) count += tmp[clampI(y, 0, h - 1) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = count > 0 ? 1 : 0;
      count +=
        tmp[clampI(y + k + 1, 0, h - 1) * w + x] -
        tmp[clampI(y - k, 0, h - 1) * w + x];
    }
  }
  return { data: out, w, h, ox: m.ox, oy: m.oy };
}

function clampI(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** 4-connected components smaller than minPx are cleared. */
function dropSmallComponents(
  data: Uint8Array,
  w: number,
  h: number,
  minPx: number,
): void {
  const seen = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  for (let start = 0; start < w * h; start++) {
    if (!data[start] || seen[start]) continue;
    let sp = 0;
    stack[sp++] = start;
    seen[start] = 1;
    const members: number[] = [];
    while (sp > 0) {
      const idx = stack[--sp];
      members.push(idx);
      const x = idx % w;
      const y = (idx / w) | 0;
      const push = (n: number) => {
        if (data[n] && !seen[n]) {
          seen[n] = 1;
          stack[sp++] = n;
        }
      };
      if (x > 0) push(idx - 1);
      if (x < w - 1) push(idx + 1);
      if (y > 0) push(idx - w);
      if (y < h - 1) push(idx + w);
    }
    if (members.length < minPx) for (const m of members) data[m] = 0;
  }
}

/** Components larger than fraction·(w·h) are cleared (whole-artwork guard). */
function dropHugeComponents(
  data: Uint8Array,
  w: number,
  h: number,
  fraction: number,
): void {
  const seen = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  const limit = w * h * fraction;
  for (let start = 0; start < w * h; start++) {
    if (!data[start] || seen[start]) continue;
    let sp = 0;
    stack[sp++] = start;
    seen[start] = 1;
    const members: number[] = [];
    while (sp > 0) {
      const idx = stack[--sp];
      members.push(idx);
      const x = idx % w;
      const y = (idx / w) | 0;
      const push = (n: number) => {
        if (data[n] && !seen[n]) {
          seen[n] = 1;
          stack[sp++] = n;
        }
      };
      if (x > 0) push(idx - 1);
      if (x < w - 1) push(idx + 1);
      if (y > 0) push(idx - w);
      if (y < h - 1) push(idx + w);
    }
    if (members.length > limit) for (const m of members) data[m] = 0;
  }
}

/**
 * Whether a candidate mask's BORDER rides on a strong edge. Only the border
 * is tested, never the interior: the text strokes inside are themselves
 * strong edges, and a whole-mask test would reject the first candidate on
 * every page.
 */
export function crossesEdgeMask(
  mask: Mask,
  mag: Float32Array,
  strongFloor: number,
): boolean {
  const { data, w, h } = mask;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!data[i]) continue;
      const border =
        x === 0 ||
        y === 0 ||
        x === w - 1 ||
        y === h - 1 ||
        !data[i - 1] ||
        !data[i + 1] ||
        !data[i - w] ||
        !data[i + w];
      if (border && mag[i] >= strongFloor) return true;
    }
  }
  return false;
}

export function maskCount(m: Mask): number {
  let n = 0;
  for (let i = 0; i < m.data.length; i++) n += m.data[i];
  return n;
}

/** Pixel indices of `a` that are not in `b` (both same dims). */
export function bandIndices(a: Mask, b: Mask): number[] {
  const idx: number[] = [];
  for (let i = 0; i < a.data.length; i++) {
    if (a.data[i] && !b.data[i]) idx.push(i);
  }
  return idx;
}
