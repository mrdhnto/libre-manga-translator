// Polyfill browser globals for node/bun headless selfcheck
if (typeof (globalThis as any).ImageData === "undefined") {
  (globalThis as any).ImageData = class ImageData {
    width: number;
    height: number;
    data: Uint8ClampedArray;
    constructor(data: Uint8ClampedArray, width: number, height?: number) {
      this.data = data;
      this.width = width;
      this.height = height ?? data.length / (4 * width);
    }
  };
}

if (typeof (globalThis as any).OffscreenCanvas === "undefined") {
  (globalThis as any).OffscreenCanvas = class OffscreenCanvas {
    width: number;
    height: number;
    _data: Uint8ClampedArray;
    fillStyle: string = "#000000";
    imageSmoothingEnabled: boolean = true;
    imageSmoothingQuality: string = "high";

    constructor(width: number, height: number) {
      this.width = width;
      this.height = height;
      this._data = new Uint8ClampedArray(width * height * 4);
    }

    getContext(type: string) {
      const self = this;
      return {
        get fillStyle() {
          return self.fillStyle;
        },
        set fillStyle(val: string) {
          self.fillStyle = val;
        },
        set imageSmoothingEnabled(v: boolean) {
          self.imageSmoothingEnabled = v;
        },
        set imageSmoothingQuality(v: string) {
          self.imageSmoothingQuality = v;
        },
        fillRect(x: number, y: number, w: number, h: number) {
          const val = self.fillStyle === "#FFFFFF" ? 255 : 0;
          for (let row = y; row < y + h && row < self.height; row++) {
            for (let col = x; col < x + w && col < self.width; col++) {
              const idx = (row * self.width + col) * 4;
              self._data[idx] = val;
              self._data[idx + 1] = val;
              self._data[idx + 2] = val;
              self._data[idx + 3] = 255;
            }
          }
        },
        putImageData(img: ImageData, dx: number, dy: number) {
          for (let row = 0; row < img.height && dy + row < self.height; row++) {
            for (let col = 0; col < img.width && dx + col < self.width; col++) {
              const srcIdx = (row * img.width + col) * 4;
              const dstIdx = ((dy + row) * self.width + (dx + col)) * 4;
              self._data[dstIdx] = img.data[srcIdx];
              self._data[dstIdx + 1] = img.data[srcIdx + 1];
              self._data[dstIdx + 2] = img.data[srcIdx + 2];
              self._data[dstIdx + 3] = img.data[srcIdx + 3];
            }
          }
        },
        drawImage(
          src: any,
          sx: number,
          sy: number,
          sw?: number,
          sh?: number,
          dx?: number,
          dy?: number,
          dw?: number,
          dh?: number,
        ) {
          const sX = sw !== undefined ? sx : 0;
          const sY = sw !== undefined ? sy : 0;
          const sW = sw !== undefined ? sw : src.width;
          const sH = sw !== undefined ? sh : src.height;
          const dX = dx !== undefined ? dx : (sw !== undefined ? 0 : sx);
          const dY = dy !== undefined ? dy : (sw !== undefined ? 0 : sy);
          const srcData = src._data || src.data;
          for (let r = 0; r < sH && dY + r < self.height; r++) {
            for (let c = 0; c < sW && dX + c < self.width; c++) {
              const srcIdx = ((sY + r) * src.width + (sX + c)) * 4;
              const dstIdx = ((dY + r) * self.width + (dX + c)) * 4;
              self._data[dstIdx] = srcData[srcIdx];
              self._data[dstIdx + 1] = srcData[srcIdx + 1];
              self._data[dstIdx + 2] = srcData[srcIdx + 2];
              self._data[dstIdx + 3] = srcData[srcIdx + 3];
            }
          }
        },
        getImageData(sx: number, sy: number, sw: number, sh: number) {
          const out = new Uint8ClampedArray(sw * sh * 4);
          for (let r = 0; r < sh && sy + r < self.height; r++) {
            for (let c = 0; c < sw && sx + c < self.width; c++) {
              const srcIdx = ((sy + r) * self.width + (sx + c)) * 4;
              const dstIdx = (r * sw + c) * 4;
              out[dstIdx] = self._data[srcIdx];
              out[dstIdx + 1] = self._data[srcIdx + 1];
              out[dstIdx + 2] = self._data[srcIdx + 2];
              out[dstIdx + 3] = self._data[srcIdx + 3];
            }
          }
          return new ImageData(out, sw, sh);
        },
      };
    }
  };
}

import {
  boostContrast,
  buildCharset,
  ctcDecode,
  normalizePolarity,
  padImageForOCR,
  sliceImageDataIntoLines,
} from "../src/lib/ocr/utils";

let failures = 0;
const check = (name: string, cond: boolean) => {
  if (!cond) {
    failures++;
    console.error(`FAIL ${name}`);
  } else {
    console.log(`ok   ${name}`);
  }
};

// 1. Polarity normalization
{
  const w = 20;
  const h = 20;
  const darkData = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < darkData.length; i += 4) {
    darkData[i] = 30;
    darkData[i + 1] = 30;
    darkData[i + 2] = 30;
    darkData[i + 3] = 255;
  }
  const darkImg = new ImageData(darkData, w, h);
  const inverted = normalizePolarity(darkImg);
  check("polarity: dark background inverts to bright", inverted.data[0] === 225);

  const lightData = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < lightData.length; i += 4) {
    lightData[i] = 240;
    lightData[i + 1] = 240;
    lightData[i + 2] = 240;
    lightData[i + 3] = 255;
  }
  const lightImg = new ImageData(lightData, w, h);
  const untouched = normalizePolarity(lightImg);
  check("polarity: bright background untouched", untouched.data[0] === 240);
}

// 2. Dynamic contrast stretching
{
  const w = 10;
  const h = 10;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const val = i % 2 === 0 ? 100 : 180;
    data[i * 4] = val;
    data[i * 4 + 1] = val;
    data[i * 4 + 2] = val;
    data[i * 4 + 3] = 255;
  }
  const img = new ImageData(data, w, h);
  const boosted = boostContrast(img);
  check("contrast: low percentile stretches down", boosted.data[0] < 50);
  check("contrast: high percentile stretches up", boosted.data[4] > 200);
}

// 3. Padding for OCR
{
  const w = 16;
  const h = 16;
  const data = new Uint8ClampedArray(w * h * 4);
  const img = new ImageData(data, w, h);
  const padded = padImageForOCR(img, 4);
  check(
    "padding: width and height increased by 2 * padding",
    padded.width === 24 && padded.height === 24,
  );
}

// 4. Line slicing with horizontal trimming
{
  const w = 100;
  const h = 80;
  const data = new Uint8ClampedArray(w * h * 4);
  data.fill(255);

  // Line 1: rows 15-25, columns 30-50 (ink = 0)
  for (let y = 15; y <= 25; y++) {
    for (let x = 30; x <= 50; x++) {
      const idx = (y * w + x) * 4;
      data[idx] = 0;
      data[idx + 1] = 0;
      data[idx + 2] = 0;
    }
  }

  // Line 2: rows 45-55, columns 40-70 (ink = 0)
  for (let y = 45; y <= 55; y++) {
    for (let x = 40; x <= 70; x++) {
      const idx = (y * w + x) * 4;
      data[idx] = 0;
      data[idx + 1] = 0;
      data[idx + 2] = 0;
    }
  }

  const img = new ImageData(data, w, h);
  const lines = sliceImageDataIntoLines(img);
  check("slicing: splits into 2 distinct lines", lines.length === 2);
  check(
    "slicing: trims horizontal whitespace (not full 100px)",
    lines[0].width < 100 && lines[1].width < 100,
  );
  check(
    "slicing: line 1 tightly bounds text (w ~ 20 + padding)",
    lines[0].width >= 20 && lines[0].width <= 40,
  );
}

// 5. CTC decoding
{
  const charset = ["blank", "A", "B", "C", " "];
  const numChars = 5;
  const timesteps = [1, 1, 0, 2, 3];
  const logits = new Float32Array(timesteps.length * numChars);
  logits.fill(-10);
  timesteps.forEach((cls, t) => {
    logits[t * numChars + cls] = 5.0;
  });

  const decoded = ctcDecode(logits, charset, numChars, "latin");
  check("ctcDecode: decodes merged 'ABC'", decoded.text === "ABC");
  check("ctcDecode: reports positive confidence", decoded.confidence > 0);
}

// 6. Image-aware page resolution and hash uniqueness
{
  const { quickHash, resolveImagePageIndex } = await import(
    "../src/entrypoints/content/utils"
  );

  const h1 = quickHash("https://static.mangafire.to/i/0/02/chapter-9425959/page-002.jpg");
  const h2 = quickHash("https://static.mangafire.to/i/0/02/chapter-9425959/page-003.jpg");
  check("quickHash: different URLs yield distinct hashes", h1 !== h2);
  check(
    "quickHash: deterministic for identical input",
    h1 === quickHash("https://static.mangafire.to/i/0/02/chapter-9425959/page-002.jpg"),
  );

  // Mock img element
  const fakeImg = {
    getAttribute: () => null,
    closest: () => null,
    id: "",
  } as unknown as HTMLImageElement;

  check(
    "resolvePageIndex: parses page from /page-003.jpg",
    resolveImagePageIndex(fakeImg, "https://example.com/ch1/page-003.jpg", 0) === 3,
  );
  check(
    "resolvePageIndex: parses page from /04.webp",
    resolveImagePageIndex(fakeImg, "https://example.com/ch1/04.webp", 0) === 4,
  );
  check(
    "resolvePageIndex: parses page from ?page=5 query param",
    resolveImagePageIndex(fakeImg, "https://example.com/ch1/view?page=5", 0) === 5,
  );
  check(
    "resolvePageIndex: respects explicit urlPageIndex > 0",
    resolveImagePageIndex(fakeImg, "https://example.com/ch1/04.webp", 7) === 7,
  );
}

if (failures > 0) {
  console.error(`\n${failures} ocr check(s) failed`);
  process.exit(1);
}
console.log("\nocr self-check: all passed");
