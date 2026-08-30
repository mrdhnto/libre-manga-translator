import * as ort from "onnxruntime-web/all";

function getBackgroundBrightness(
  grayPixels: Uint8Array,
  width: number,
  height: number,
): number {
  const samples: number[] = [];
  // Sample the four edges of the crop — that's where background lives
  for (let x = 0; x < width; x++) {
    samples.push(grayPixels[x]); // top row
    samples.push(grayPixels[(height - 1) * width + x]); // bottom row
  }
  for (let y = 0; y < height; y++) {
    samples.push(grayPixels[y * width]); // left col
    samples.push(grayPixels[y * width + (width - 1)]); // right col
  }
  // Use 75th percentile — robust against corner artifacts
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length * 0.75)];
}

export function sliceImageDataIntoLines(imageData: ImageData): ImageData[] {
  const { width, height, data } = imageData;

  const grayPixels = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      grayPixels[y * width + x] = Math.round(
        // Standard Grayscale formula
        0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2],
      );
    }
  }

  // Sort a copy of the pixels from darkest (0) to lightest (255)
  const sortedPixels = new Uint8Array(grayPixels).sort();
  
  // The 5th percentile is guaranteed to be the ink color
  const inkBrightness = sortedPixels[Math.floor(sortedPixels.length * 0.05)];
  
  // The 75th percentile of the edges is guaranteed to be the paper color
  const bgBrightness = getBackgroundBrightness(grayPixels, width, height);

  // The threshold is 40% of the way between ink and bg
  const threshold = inkBrightness + ((bgBrightness - inkBrightness) * 0.4); 

  const rowIntensities = new Array(height).fill(0);
  for (let y = 0; y < height; y++) {
    let count = 0;
    for (let x = 0; x < width; x++) {
      if (grayPixels[y * width + x] < threshold) count++;
    }
    rowIntensities[y] = count;
  }
  const pixelThreshold = Math.max(3, width * 0.02);
  
  const MIN_CONFIRM = 2;
  const lines: ImageData[] = [];
  let inTextLine = false;
  let lineStartY = 0;
  let confirmCount = 0;
  let pendingStart = -1;
  const PAD = 2; // idk the best most of the time
  const minLineHeight = Math.max(4, Math.floor(height * 0.05));

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
        const start = Math.max(0, lineStartY - PAD);
        const end = Math.min(height, y + PAD);
        if (end - start > minLineHeight) {
          lines.push(
            new ImageData(
              data.slice(start * width * 4, end * width * 4),
              width,
              end - start,
            ),
          );
        }
      }
      pendingStart = -1;
      confirmCount = 0;
    }
  }

  return lines.length > 0 ? lines : [imageData];
}

export function normalizePolarity(imageData: ImageData): ImageData {
  const w = imageData.width;
  const h = imageData.height;
  const data = imageData.data;

  // Sample the perimeter to guess the background luminance
  let edgeLuminanceSum = 0;
  let edgePixelCount = 0;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Check if the pixel is on the outer edge of the canvas
      if (x === 0 || x === w - 1 || y === 0 || y === h - 1) {
        const i = (y * w + x) * 4;
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];

        // Standard Grayscale formula
        edgeLuminanceSum += 0.299 * r + 0.587 * g + 0.114 * b;
        edgePixelCount++;
      }
    }
  }

  const avgBackgroundLuminance = edgeLuminanceSum / edgePixelCount;

  // If the background is dark (< 128), INVERT the entire image
  if (avgBackgroundLuminance < 128) {
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
];

export function cropBubbleFromImage(
  bitmap: ImageBitmap,
  bbox: Bbox,
  sourceLanguage: string,
) {
  const { x1, y1, x2, y2 } = bbox;
  const w = x2 - x1;
  const h = y2 - y1;

  const isTallBox = h / w >= 1.5;
  const isVerticalLanguage = VERTICAL_LANGUAGES.includes(sourceLanguage);
  const shouldRotate = isTallBox && isVerticalLanguage;

  const outW = shouldRotate ? h : w;
  const outH = shouldRotate ? w : h;

  const canvas = new OffscreenCanvas(outW, outH);
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;

  if (shouldRotate) {
    // Rotate 90° CCW for Japanese/Chinese/Korean vertical text
    ctx.translate(outW / 2, outH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.drawImage(bitmap, x1, y1, w, h, -h / 2, -w / 2, h, w);
  } else {
    // Standard horizontal draw for Spanish, English, Indonesian, etc.
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

  // If the crop is already smaller than recImgHeight, upscale with a sharper
  // interpolation by drawing onto a 2x canvas first, then down to target
  const needsUpscale = crop.height < recImgHeight;
  const intermediateH = needsUpscale ? recImgHeight * 2 : crop.height;
  const intermediateW = needsUpscale ? Math.round(scaledW * 2) : crop.width;

  let sourceForResize: OffscreenCanvas = srcCanvas;
  if (needsUpscale) {
    const upscaled = new OffscreenCanvas(intermediateW, intermediateH);
    const upCtx = upscaled.getContext("2d")!;
    upCtx.imageSmoothingEnabled = false; // nearest-neighbour for upscale — keeps edges sharp
    upCtx.drawImage(
      srcCanvas,
      0,
      0,
      crop.width,
      crop.height,
      0,
      0,
      intermediateW,
      intermediateH,
    );
    sourceForResize = upscaled;
  }

  const resized = new OffscreenCanvas(scaledW, recImgHeight);
  const ctx = resized.getContext("2d")!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high"; // bilinear for the final downscale
  ctx.drawImage(
    sourceForResize,
    0,
    0,
    intermediateW,
    intermediateH,
    0,
    0,
    scaledW,
    recImgHeight,
  );

  const raw = resized
    .getContext("2d")!
    .getImageData(0, 0, scaledW, recImgHeight).data;
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
  const data = new Uint8ClampedArray(imageData.data);
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    
    // Calculate grayscale luminance
    const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
    
    // If it is darker than 150, darken it further. If lighter, push to white.
    const multiplier = luminance < 150 ? 0.7 : 1.3; 
    
    data[i] = Math.min(255, Math.max(0, r * multiplier));
    data[i + 1] = Math.min(255, Math.max(0, g * multiplier));
    data[i + 2] = Math.min(255, Math.max(0, b * multiplier));
    // Keep alpha intact
  }
  return new ImageData(data, imageData.width, imageData.height);
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
