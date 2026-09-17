import * as ort from "onnxruntime-web/all";

function getBackgroundBrightness(
  grayPixels: Uint8Array,
  width: number,
  height: number,
): number {
  const samples: number[] = [];
  // Sample the four edges of the crop - that's where background lives
  for (let x = 0; x < width; x++) {
    samples.push(grayPixels[x]); // top row
    samples.push(grayPixels[(height - 1) * width + x]); // bottom row
  }
  for (let y = 0; y < height; y++) {
    samples.push(grayPixels[y * width]); // left col
    samples.push(grayPixels[y * width + (width - 1)]); // right col
  }
  // Use 75th percentile - robust against corner artifacts
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length * 0.75)];
}

export function sliceImageDataIntoLines(imageData: ImageData): ImageData[] {
  const { width, height, data } = imageData;
  if (height < 20 || width < 10) return [imageData];

  const grayPixels = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      grayPixels[y * width + x] = Math.round(
        0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2],
      );
    }
  }

  // Sort a copy of the pixels from darkest (0) to lightest (255)
  const sortedPixels = new Uint8Array(grayPixels).sort();
  const inkBrightness = sortedPixels[Math.floor(sortedPixels.length * 0.05)];
  const bgBrightness = Math.max(
    sortedPixels[Math.floor(sortedPixels.length * 0.9)],
    getBackgroundBrightness(grayPixels, width, height),
  );

  const threshold = inkBrightness + (bgBrightness - inkBrightness) * 0.45;

  const rowIntensities = new Array(height).fill(0);
  for (let y = 0; y < height; y++) {
    let count = 0;
    for (let x = 0; x < width; x++) {
      if (grayPixels[y * width + x] < threshold) count++;
    }
    rowIntensities[y] = count;
  }
  const pixelThreshold = Math.max(2, width * 0.015);

  const MIN_CONFIRM = 2;
  const rawSpans: { start: number; end: number }[] = [];
  let inTextLine = false;
  let lineStartY = 0;
  let confirmCount = 0;
  let pendingStart = -1;

  for (let y = 0; y <= height; y++) {
    const isText = y < height && rowIntensities[y] > pixelThreshold;

    if (isText) {
      if (!inTextLine) {
        if (pendingStart === -1) pendingStart = y;
        confirmCount++;
        if (confirmCount >= MIN_CONFIRM) {
          inTextLine = true;
          lineStartY = pendingStart;
        }
      }
    } else {
      if (inTextLine) {
        inTextLine = false;
        rawSpans.push({ start: lineStartY, end: y });
      }
      pendingStart = -1;
      confirmCount = 0;
    }
  }

  if (rawSpans.length === 0) return [imageData];

  // Merge nearby spans (gap <= 4px) to keep diacritics / split strokes with line
  const mergedSpans: { start: number; end: number }[] = [];
  for (const span of rawSpans) {
    if (mergedSpans.length === 0) {
      mergedSpans.push({ ...span });
    } else {
      const prev = mergedSpans[mergedSpans.length - 1];
      if (span.start - prev.end <= 4) {
        prev.end = span.end;
      } else {
        mergedSpans.push({ ...span });
      }
    }
  }

  const PAD_Y = 4;
  const PAD_X = 4;
  const minLineHeight = Math.max(6, Math.floor(height * 0.04));
  const lines: ImageData[] = [];

  for (const span of mergedSpans) {
    const startY = Math.max(0, span.start - PAD_Y);
    const endY = Math.min(height, span.end + PAD_Y);
    const lineH = endY - startY;
    if (lineH < minLineHeight) continue;

    // Tight horizontal bounding box of ink pixels within this line
    let minX = width;
    let maxX = 0;
    for (let y = startY; y < endY; y++) {
      for (let x = 0; x < width; x++) {
        if (grayPixels[y * width + x] < threshold) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
        }
      }
    }

    const startX = minX < maxX ? Math.max(0, minX - PAD_X) : 0;
    const endX = minX < maxX ? Math.min(width, maxX + PAD_X + 1) : width;
    const lineW = endX - startX;
    if (lineW < 6) continue;

    const lineCanvas = new OffscreenCanvas(lineW, lineH);
    const ctx = lineCanvas.getContext("2d")!;
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, lineW, lineH);

    const tempCanvas = new OffscreenCanvas(width, height);
    tempCanvas.getContext("2d")!.putImageData(imageData, 0, 0);
    ctx.drawImage(tempCanvas, startX, startY, lineW, lineH, 0, 0, lineW, lineH);

    lines.push(ctx.getImageData(0, 0, lineW, lineH));
  }

  return lines.length > 0 ? lines : [imageData];
}

export function normalizePolarity(imageData: ImageData): ImageData {
  const w = imageData.width;
  const h = imageData.height;
  const data = imageData.data;

  // Sample perimeter to guess background luminance
  const edgeSamples: number[] = [];
  for (let x = 0; x < w; x++) {
    const topIdx = x * 4;
    const botIdx = ((h - 1) * w + x) * 4;
    edgeSamples.push(
      0.299 * data[topIdx] + 0.587 * data[topIdx + 1] + 0.114 * data[topIdx + 2],
    );
    edgeSamples.push(
      0.299 * data[botIdx] + 0.587 * data[botIdx + 1] + 0.114 * data[botIdx + 2],
    );
  }
  for (let y = 0; y < h; y++) {
    const leftIdx = (y * w) * 4;
    const rightIdx = (y * w + (w - 1)) * 4;
    edgeSamples.push(
      0.299 * data[leftIdx] + 0.587 * data[leftIdx + 1] + 0.114 * data[leftIdx + 2],
    );
    edgeSamples.push(
      0.299 * data[rightIdx] + 0.587 * data[rightIdx + 1] + 0.114 * data[rightIdx + 2],
    );
  }

  edgeSamples.sort((a, b) => a - b);
  // 75th percentile of edge is robust even if 1-2 sides touch panel border / dark art
  const bgLuminance = edgeSamples[Math.floor(edgeSamples.length * 0.75)] ?? 255;

  // If the background is dark (< 128), INVERT the entire image
  if (bgLuminance < 128) {
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 255 - data[i]; // R
      data[i + 1] = 255 - data[i + 1]; // G
      data[i + 2] = 255 - data[i + 2]; // B
      // Leave alpha (data[i+3]) alone
    }
  }

  return imageData;
}

const VERTICAL_LANGUAGES = [
  "Japanese",
  "Chinese (Simplified)",
  "Chinese (Traditional)",
  "Korean",
  "Auto-Detect",
];

function detectVerticalColumns(
  bitmap: ImageBitmap,
  x: number,
  y: number,
  w: number,
  h: number,
): boolean {
  if (w < 20 || h < 20) return false;
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bitmap, x, y, w, h, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;

  const colSums = new Float32Array(w);
  const rowSums = new Float32Array(h);
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      const idx = (r * w + c) * 4;
      const lum =
        0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
      if (lum < 140) {
        colSums[c]++;
        rowSums[r]++;
      }
    }
  }

  const colVar = getProfileVariance(colSums) / (h * h || 1);
  const rowVar = getProfileVariance(rowSums) / (w * w || 1);
  return colVar > rowVar * 1.15;
}

function getProfileVariance(arr: Float32Array): number {
  if (arr.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < arr.length; i++) sum += arr[i];
  const mean = sum / arr.length;
  let v = 0;
  for (let i = 0; i < arr.length; i++) {
    const d = arr[i] - mean;
    v += d * d;
  }
  return v / arr.length;
}

export function cropBubbleFromImage(
  bitmap: ImageBitmap,
  bbox: Bbox,
  sourceLanguage: string,
) {
  const x1 = Math.max(0, Math.min(bitmap.width - 1, Math.round(bbox.x1)));
  const y1 = Math.max(0, Math.min(bitmap.height - 1, Math.round(bbox.y1)));
  const x2 = Math.max(x1 + 1, Math.min(bitmap.width, Math.round(bbox.x2)));
  const y2 = Math.max(y1 + 1, Math.min(bitmap.height, Math.round(bbox.y2)));
  const w = x2 - x1;
  const h = y2 - y1;

  const isVerticalLanguage = VERTICAL_LANGUAGES.includes(sourceLanguage);
  let shouldRotate = false;
  if (isVerticalLanguage) {
    if (h / w >= 1.25) {
      shouldRotate = true;
    } else if (h / w >= 0.8) {
      shouldRotate = detectVerticalColumns(bitmap, x1, y1, w, h);
    }
  }

  const outW = shouldRotate ? h : w;
  const outH = shouldRotate ? w : h;

  const canvas = new OffscreenCanvas(outW, outH);
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;

  if (shouldRotate) {
    // Rotate 90° CCW for vertical text
    ctx.translate(outW / 2, outH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.drawImage(bitmap, x1, y1, w, h, -h / 2, -w / 2, h, w);
  } else {
    // Standard horizontal draw
    ctx.drawImage(bitmap, x1, y1, w, h, 0, 0, w, h);
  }

  return ctx.getImageData(0, 0, outW, outH);
}

/**
 * Converts a cropped canvas into the Float32 tensor the rec model expects.
 *
 * Pipeline:
 *   1. Scale the crop to a fixed height (REC_IMG_H=48px), keeping aspect ratio
 *   2. Pad with zeros on the right up to targetW
 *   3. Normalise: (pixel / 255 - 0.5) / 0.5  → range [-1, 1]
 *   4. Transpose HWC → CHW  (what ONNX Runtime Web needs)
 */
export function preprocessCrop(
  crop: ImageData,
  targetW: number,
  recImgHeight: number,
) {
  const naturalRatio = crop.width / crop.height;
  const scaledW = Math.min(targetW, Math.ceil(recImgHeight * naturalRatio));

  const srcCanvas = new OffscreenCanvas(crop.width, crop.height);
  srcCanvas.getContext("2d")!.putImageData(crop, 0, 0);

  const resized = new OffscreenCanvas(scaledW, recImgHeight);
  const ctx = resized.getContext("2d")!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(
    srcCanvas,
    0,
    0,
    crop.width,
    crop.height,
    0,
    0,
    scaledW,
    recImgHeight,
  );

  const raw = ctx.getImageData(0, 0, scaledW, recImgHeight).data;
  const channels = 3;
  const buffer = new Float32Array(channels * recImgHeight * targetW);

  for (let row = 0; row < recImgHeight; row++) {
    for (let col = 0; col < scaledW; col++) {
      const srcIdx = (row * scaledW + col) * 4;
      for (let c = 0; c < channels; c++) {
        buffer[c * recImgHeight * targetW + row * targetW + col] =
          (raw[srcIdx + c] / 255 - 0.5) / 0.5;
      }
    }
  }

  return new ort.Tensor("float32", buffer, [
    1,
    channels,
    recImgHeight,
    targetW,
  ]);
}

/**
 * Loads the character list from a PaddleOCR dict.txt file.
 * The file is one character per line.  Two special tokens are inserted:
 *   index 0  → "blank"  (CTC blank)
 *   last     → " "      (space)
 *
 */
export function buildCharset(dictText: string) {
  const chars = dictText
    .split("\n")
    .map((l) => l.replace(/\r$/, "")) // strip \r on Windows line-endings
    .filter((l) => l.length > 0);

  return ["blank", ...chars, " "];
}

/**
 * Decodes a single CTC output sequence into text + per-char confidence.
 *
 * Algorithm:
 *   1. argmax across character axis at every time step
 *   2. Remove consecutive duplicates (CTC merging)
 *   3. Remove blank tokens (index 0)
 *   4. Map indices → characters from charset
 *   5. Mean of the kept probabilities = confidence
 */
export function ctcDecode(
  logits: Float32Array,
  charset: string[],
  numChars: number,
  langGroup: string,
) {
  const T = logits.length / numChars;
  const chars: string[] = [];
  const probs: number[] = [];
  let prevIdx = -1;

  for (let t = 0; t < T; t++) {
    // argmax + max-prob over the C dimension at time t
    let bestIdx = 0;
    let bestProb = -Infinity;
    for (let c = 0; c < numChars; c++) {
      const v = logits[t * numChars + c];
      if (v > bestProb) {
        bestProb = v;
        bestIdx = c;
      }
    }

    if (bestIdx !== 0 && bestIdx !== prevIdx) {
      chars.push(charset[bestIdx] ?? "");
      probs.push(bestProb);
    }
    prevIdx = bestIdx;
  }

  const text = chars.join("");
  const confidence =
    probs.length > 0 ? probs.reduce((a, b) => a + b, 0) / probs.length : 0;

  return {
    text,
    confidence,
  };
}


export function boostContrast(imageData: ImageData): ImageData {
  const { width, height, data } = imageData;
  const n = width * height;
  if (n === 0) return imageData;

  const gray = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const idx = i * 4;
    gray[i] = Math.round(
      0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2],
    );
  }

  const sorted = new Uint8Array(gray).sort();
  const pLow = sorted[Math.floor(n * 0.04)];
  const pHigh = sorted[Math.floor(n * 0.96)];
  const range = pHigh - pLow;

  if (range < 15) return imageData;

  const out = new Uint8ClampedArray(data);
  for (let i = 0; i < n; i++) {
    const idx = i * 4;
    for (let c = 0; c < 3; c++) {
      const val = data[idx + c];
      const stretched = ((val - pLow) / range) * 255;
      out[idx + c] = Math.min(255, Math.max(0, Math.round(stretched)));
    }
  }
  return new ImageData(out, width, height);
}

export function padImageForOCR(imageData: ImageData, padding = 4): ImageData {
  const targetW = imageData.width + padding * 2;
  const targetH = imageData.height + padding * 2;
  
  const canvas = new OffscreenCanvas(targetW, targetH);
  const ctx = canvas.getContext("2d")!;
  
  // Fill the background with white
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, targetW, targetH);
  
  // Draw the original image in the center
  const tempCanvas = new OffscreenCanvas(imageData.width, imageData.height);
  tempCanvas.getContext("2d")!.putImageData(imageData, 0, 0);
  ctx.drawImage(tempCanvas, padding, padding);
  
  return ctx.getImageData(0, 0, targetW, targetH);
}
