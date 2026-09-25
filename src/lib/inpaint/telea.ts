/**
 * Pure-JS Telea (fast-marching) inpainting.
 *
 * Replaces OpenCV.js: emscripten embind builds its JS bindings via
 * `new Function(...)`, which Chrome MV3 forbids (`'unsafe-eval'` cannot appear
 * in `content_security_policy.extension_pages`). So `cv.inpaint` could never
 * run in the offscreen document - every translate fell back to the crude
 * edge-sample blend. This module implements the same fast-marching method
 * (Telea) in plain typed-array math: no eval, no WASM, no deps.
 *
 * The core function works on an in-place ImageData + binary mask and serves as
 * the final rung of the Fast ladder (`ladder.ts`); the legacy full-frame entry
 * point was retired when the method picker collapsed to Fast vs Quality.
 */

const INF = 1e18;
const MAX_PIXELS_FRACTION = 0.8; // skip FMM if mask covers >80% of the image (degenerate)

/**
 * In-place Telea fast-marching inpainting on an RGBA ImageData buffer.
 * Pixels where `mask[i] !== 0` are filled from surrounding known pixels.
 */
export function teleaInpaint(
  imgData: ImageData,
  mask: Uint8Array,
  radius = 3,
): void {
  const { width, height } = imgData;
  const data = imgData.data;
  const total = width * height;

  // Empty mask → nothing to do.
  let masked = 0;
  for (let i = 0; i < total; i++) {
    if (mask[i]) masked++;
  }
  if (masked === 0) return;
  // Degenerate safety: FMM over an almost-fully-masked image is slow and
  // pointless - the caller falls back to the edge-blend path on error.
  if (masked > total * MAX_PIXELS_FRACTION) {
    throw new Error("telea: mask covers too much of the image");
  }

  const dist = new Float32Array(total).fill(INF);
  const known = new Uint8Array(total); // 1 = distance finalized

  // Binary min-heap over pixel indices, keyed by dist[idx].
  const heap: number[] = [];
  const heapIndex = new Int32Array(total).fill(-1);
  const push = (idx: number) => {
    heap.push(idx);
    let c = heap.length - 1;
    heapIndex[idx] = c;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (dist[heap[p]] <= dist[heap[c]]) break;
      heapIndex[heap[c]] = p;
      heapIndex[heap[p]] = c;
      const tmp = heap[p];
      heap[p] = heap[c];
      heap[c] = tmp;
      c = p;
    }
  };
  const pop = (): number => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length > 0) {
      heap[0] = last;
      heapIndex[last] = 0;
      let c = 0;
      const n = heap.length;
      for (;;) {
        const l = c * 2 + 1;
        const r = l + 1;
        let s = c;
        if (l < n && dist[heap[l]] < dist[heap[s]]) s = l;
        if (r < n && dist[heap[r]] < dist[heap[s]]) s = r;
        if (s === c) break;
        heapIndex[heap[s]] = c;
        heapIndex[heap[c]] = s;
        const tmp = heap[s];
        heap[s] = heap[c];
        heap[c] = tmp;
        c = s;
      }
    }
    heapIndex[top] = -1;
    return top;
  };

  // Seed: known pixels adjacent to the mask form the initial front.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (mask[idx]) continue;
      known[idx] = 1;
      dist[idx] = 0;
      const isBoundary =
        (x > 0 && mask[idx - 1]) ||
        (x < width - 1 && mask[idx + 1]) ||
        (y > 0 && mask[idx - width]) ||
        (y < height - 1 && mask[idx + width]);
      if (isBoundary) {
        push(idx);
      }
    }
  }

  const idxOf = (x: number, y: number) => y * width + x;
  const inBounds = (x: number, y: number) =>
    x >= 0 && x < width && y >= 0 && y < height;

  const NX = [1, -1, 0, 0];
  const NY = [0, 0, 1, -1];

  // Number of boundary pixels + masked pixels processed total.
  let processed = 0;
  const budget = total * 2;

  while (heap.length > 0 && processed < budget) {
    const idx = pop();
    if (known[idx] && mask[idx]) continue; // already finalized masked pixel
    const x = idx % width;
    const y = (idx / width) | 0;
    processed++;

    // Only masked pixels need color estimation; seed (known) pixels just
    // propagate the front to their masked neighbors.
    if (mask[idx]) {
      // Compute gradient of the distance field at this front pixel.
      const xL = inBounds(x - 1, y) ? dist[idxOf(x - 1, y)] : dist[idx];
      const xR = inBounds(x + 1, y) ? dist[idxOf(x + 1, y)] : dist[idx];
      const yU = inBounds(x, y - 1) ? dist[idxOf(x, y - 1)] : dist[idx];
      const yD = inBounds(x, y + 1) ? dist[idxOf(x, y + 1)] : dist[idx];
      let gx = (xR - xL) * 0.5;
      let gy = (yD - yU) * 0.5;
      const gnorm = Math.hypot(gx, gy);
      if (gnorm < 1e-6) {
        gx = 0;
        gy = 0;
      } else {
        gx /= gnorm;
        gy /= gnorm;
      }

      // Telea color estimation: weighted average of known neighbors.
      // weight = dirWeight² · dstWeight
      //   dirWeight = |N(p)·(p−q)| / |p−q|   (directional, along gradient)
      //   dstWeight = 1 / (1 + distSq)
      let r = 0,
        g = 0,
        b = 0,
        sumW = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (dx === 0 && dy === 0) continue;
          const qx = x + dx;
          const qy = y + dy;
          if (!inBounds(qx, qy)) continue;
          const qIdx = qy * width + qx;
          if (!known[qIdx]) continue;

          const distSq = dx * dx + dy * dy;
          const invLen = 1 / Math.sqrt(distSq);
          // Telea dirWeight uses the ABSOLUTE normalized dot with the gradient:
          // pixels aligned with the propagation direction (either side of the
          // front) carry the boundary texture. Sign is irrelevant.
          const dir = Math.abs(dx * gx + dy * gy) * invLen;
          const weight = dir * dir * (1 / (1 + distSq));
          const o = qIdx * 4;
          r += data[o] * weight;
          g += data[o + 1] * weight;
          b += data[o + 2] * weight;
          sumW += weight;
        }
      }

      const out = idx * 4;
      if (sumW > 0) {
        data[out] = r / sumW;
        data[out + 1] = g / sumW;
        data[out + 2] = b / sumW;
        data[out + 3] = 255;
      }

      known[idx] = 1; // mask pixel finalized
    }
    const myDist = dist[idx] + 1;

    // Propagate the front to masked 4-neighbors.
    for (let d = 0; d < 4; d++) {
      const nx = x + NX[d];
      const ny = y + NY[d];
      if (!inBounds(nx, ny)) continue;
      const nIdx = ny * width + nx;
      if (!mask[nIdx] || known[nIdx]) continue;
      if (myDist < dist[nIdx]) {
        const wasQueued = heapIndex[nIdx] >= 0;
        dist[nIdx] = myDist;
        if (!wasQueued) push(nIdx);
        else {
          // re-heapify upward after decreasing key
          let c = heapIndex[nIdx];
          while (c > 0) {
            const p = (c - 1) >> 1;
            if (dist[heap[p]] <= dist[heap[c]]) break;
            heapIndex[heap[c]] = p;
            heapIndex[heap[p]] = c;
            const tmp = heap[p];
            heap[p] = heap[c];
            heap[c] = tmp;
            c = p;
          }
        }
      }
    }
  }
}


