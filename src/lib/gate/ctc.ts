/**
 * Pure pieces of the script-ID model path: the 48-px strip preprocessing
 * convention and the CTC best-path decoder. No ONNX import here, so both are
 * unit-checkable (`scripts/gate-selfcheck.ts`) and shared with `osd.ts`.
 *
 * Convention measured against the model (its card documents none of this):
 * `[1,1,48,W]` one line, median<64 invert, Tesseract
 * ComputeBlackWhite over the middle row only, scores are CTC with class 2
 * (`Broken`) as the blank.
 */

const STRIP_HEIGHT = 48;
const BLANK_CHAR = 2;

export function osdPreprocess(
  line: ImageData,
): { data: Float32Array; width: number } | null {
  const srcW = line.width;
  const srcH = line.height;
  if (srcW < 1 || srcH < 1) return null;
  const scale = STRIP_HEIGHT / srcH;
  const outW = Math.max(1, Math.round(srcW * scale));

  const grey = new Uint8Array(STRIP_HEIGHT * outW);
  for (let oy = 0; oy < STRIP_HEIGHT; oy++) {
    const sy = Math.min(
      srcH - 1,
      Math.max(0, Math.floor((oy + 0.5) / scale - 0.5)),
    );
    for (let ox = 0; ox < outW; ox++) {
      const sx = Math.min(
        srcW - 1,
        Math.max(0, Math.floor((ox + 0.5) / scale - 0.5)),
      );
      const i = (sy * srcW + sx) * 4;
      grey[oy * outW + ox] =
        0.299 * line.data[i] +
        0.587 * line.data[i + 1] +
        0.114 * line.data[i + 2];
    }
  }

  const sorted = [...grey].sort((a, b) => a - b);
  if (sorted[Math.floor(sorted.length / 2)] < 64) {
    for (let i = 0; i < grey.length; i++) grey[i] = 255 - grey[i];
  }

  const [black, white] = blackWhite(grey, outW);
  const contrast = (white - black) / 2;
  const c = contrast <= 0 ? 1 : contrast;
  const data = new Float32Array(STRIP_HEIGHT * outW);
  for (let i = 0; i < grey.length; i++) data[i] = (grey[i] - black) / c - 1;
  return { data, width: outW };
}

/** Tesseract `networkio.cpp` ComputeBlackWhite, middle row only. */
function blackWhite(grey: Uint8Array, w: number): [number, number] {
  const mins = new Int32Array(256);
  const maxes = new Int32Array(256);
  if (w >= 3) {
    const rowStart = Math.floor(STRIP_HEIGHT / 2) * w;
    for (let x = 1; x < w - 1; x++) {
      const previous = grey[rowStart + x - 1];
      const current = grey[rowStart + x];
      const next = grey[rowStart + x + 1];
      if (
        (current < previous && current <= next) ||
        (current <= previous && current < next)
      )
        mins[current]++;
      if (
        (current > previous && current >= next) ||
        (current >= previous && current > next)
      )
        maxes[current]++;
    }
  }
  if (mins.reduce((a, b) => a + b, 0) === 0) mins[0] = 1;
  if (maxes.reduce((a, b) => a + b, 0) === 0) maxes[255] = 1;
  return [ile(mins, 0.25), ile(maxes, 0.75)];
}

/** Tesseract `STATS::ile`, 256 buckets. */
function ile(buckets: Int32Array, fraction: number): number {
  const total = buckets.reduce((a, b) => a + b, 0);
  if (total === 0) return 0;
  const target = Math.max(1, Math.min(total, fraction * total));
  let sum = 0;
  let index = 0;
  while (index <= 255 && sum < target) {
    sum += buckets[index];
    index++;
  }
  return index > 0 ? index - (sum - target) / buckets[index - 1] : 0;
}

/**
 * CTC best path: argmax per timestep, collapse repeats, drop the blank, then
 * the most frequent label remaining; ties break on the lower index so two
 * runs agree.
 */
export function ctcBestPath(
  scores: Float32Array,
  classes: number,
): { index: number; strength: number; total: number } | null {
  const steps = Math.floor(scores.length / classes);
  const counts: [number, number][] = [];
  let previous = BLANK_CHAR;
  for (let t = 0; t < steps; t++) {
    let best = 0;
    let bestProb = -Infinity;
    for (let c = 0; c < classes; c++) {
      const v = scores[t * classes + c];
      if (v > bestProb) {
        bestProb = v;
        best = c;
      }
    }
    if (best !== BLANK_CHAR && best !== previous) {
      const found = counts.find((i) => i[0] === best);
      if (found) found[1]++;
      else counts.push([best, 1]);
    }
    previous = best;
  }
  if (counts.length === 0) return null;
  const total = counts.reduce((a, b) => a + b[1], 0);
  counts.sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  return { index: counts[0][0], strength: counts[0][1], total };
}
