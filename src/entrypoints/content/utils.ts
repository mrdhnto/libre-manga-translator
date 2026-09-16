import { env } from "@/lib/env";
import { fetchAsImageBitmap } from "@/lib/utils";
import type { InpaintRegionResult } from "@/lib/inpaint/ladder";

// Encode an <img> element to a JPEG data URL from the PAGE context at FULL natural size.

export function imageToBase64(img: HTMLImageElement): string | null {
  try {
    const width = img.naturalWidth;
    const height = img.naturalHeight;
    if (!width || !height) return null;

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, width, height);

    return canvas.toDataURL("image/jpeg", 0.95);
  } catch {
    return null;
  }
}

const BUNDLED_FONT_STACKS: Record<string, string> = {
  system: "'Segoe UI', sans-serif",
  noto: "'Noto Sans', sans-serif",
  bangers: "'Bangers', cursive",
  comic: "'Comic Neue', cursive",
};

function sampleRegionAvg(
  data: Uint8ClampedArray,
  w: number,
  rx: number,
  ry: number,
  rw: number,
  rh: number,
) {
  let r = 0,
    g = 0,
    b = 0,
    n = 0;
  for (let y = ry; y < ry + rh; y++) {
    for (let x = rx; x < rx + rw; x++) {
      const i = (y * w + x) * 4;
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
      n++;
    }
  }
  return n ? [r / n, g / n, b / n] : [255, 255, 255];
}

function inpaintBbox(imgData: ImageData, bbox: Bbox, margin = 4) {
  const { data, width, height } = imgData;
  const x1 = Math.max(0, Math.round(bbox.x1));
  const y1 = Math.max(0, Math.round(bbox.y1));
  const x2 = Math.min(width - 1, Math.round(bbox.x2));
  const y2 = Math.min(height - 1, Math.round(bbox.y2));

  const clamp = (v: number, lo: number, hi: number) =>
    Math.max(lo, Math.min(hi, v));

  // Pre-sample edge strips rather than hitting individual pixels per loop
  const edgeL = (py: number) => {
    const sx = clamp(x1 - margin, 0, width - 1);
    return sampleRegionAvg(data, width, sx, py, clamp(margin, 1, x1), 1);
  };
  const edgeR = (py: number) => {
    const sx = clamp(x2 + 1, 0, width - 1);
    return sampleRegionAvg(
      data,
      width,
      sx,
      py,
      clamp(margin, 1, width - sx),
      1,
    );
  };
  const edgeT = (px: number) => {
    const sy = clamp(y1 - margin, 0, height - 1);
    return sampleRegionAvg(data, width, px, sy, 1, clamp(margin, 1, y1));
  };
  const edgeB = (px: number) => {
    const sy = clamp(y2 + 1, 0, height - 1);
    return sampleRegionAvg(
      data,
      width,
      px,
      sy,
      1,
      clamp(margin, 1, height - sy),
    );
  };

  const bw = x2 - x1 || 1;
  const bh = y2 - y1 || 1;

  for (let py = y1; py <= y2; py++) {
    const ty = (py - y1) / bh;

    for (let px = x1; px <= x2; px++) {
      const tx = (px - x1) / bw;

      const l = edgeL(py),
        r = edgeR(py);
      const t = edgeT(px),
        b = edgeB(px);

      // Blend horizontal + vertical gradients, weighted toward edges
      const idx = (py * width + px) * 4;
      for (let c = 0; c < 3; c++) {
        const h = l[c] * (1 - tx) + r[c] * tx;
        const v = t[c] * (1 - ty) + b[c] * ty;
        // Edge-distance weighting: pixels near borders trust their closer edge more
        const wx = Math.min(tx, 1 - tx) * 2; // 0 near L/R edges, 1 at center
        const wy = Math.min(ty, 1 - ty) * 2;
        data[idx + c] =
          h * (1 - wy * 0.5) * 0.5 + v * (1 - wx * 0.5) * 0.5 + (h + v) * 0.25;
      }
      data[idx + 3] = 255;
    }
  }
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxW: number,
): string[] {
  const lines: string[] = [];

  for (const paragraph of text.split("\n")) {
    const words = paragraph.split(" ");
    let line = "";

    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;

      if (ctx.measureText(candidate).width <= maxW) {
        line = candidate;
      } else {
        // Word doesn't fit - try hyphenating it
        if (ctx.measureText(word).width > maxW) {
          // Push whatever line we had first
          if (line) {
            lines.push(line);
            line = "";
          }

          // Split the long word with hyphens
          let chunk = "";
          for (const char of word) {
            const trial = chunk + char + "-";
            if (ctx.measureText(trial).width > maxW && chunk) {
              lines.push(chunk + "-");
              chunk = char;
            } else {
              chunk += char;
            }
          }
          // chunk remainder becomes the start of the next line
          line = chunk;
        } else {
          if (line) lines.push(line);
          line = word;
        }
      }
    }

    if (line) lines.push(line);
  }

  return lines;
}

async function drawFittedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  bbox: Bbox,
  fontStack = "'Segoe UI', sans-serif",
  maxFontSize = 40,
) {
  const pad = 8;
  const maxW = bbox.x2 - bbox.x1 - pad * 2;
  const maxH = bbox.y2 - bbox.y1 - pad * 2;
  if (maxW <= 0 || maxH <= 0) return;

  // Force the font to load into memory BEFORE measuring.
  try {
    await document.fonts.load(`600 16px ${fontStack}`);
  } catch (error) {
    console.warn("LMT: Failed to load custom font, falling back.", error);
  }

  let fontSize = Math.min(maxFontSize, maxH);
  let lines: string[] = [];

  while (fontSize >= 4) {
    ctx.font = `600 ${fontSize}px ${fontStack}`;
    lines = wrapText(ctx, text, maxW);
    const lineH = fontSize <= 6 ? fontSize * 1.1 : fontSize * 1.25;
    if (lines.length * lineH <= maxH) break;
    fontSize--;
  }

  const lineH = fontSize * 1.25;
  const blockH = lines.length * lineH;
  const startY = bbox.y1 + pad + Math.max(0, (maxH - blockH) / 2);
  const centerX = (bbox.x1 + bbox.x2) / 2;

  ctx.textAlign = "center";
  ctx.textBaseline = "top";

  // Thin white stroke for legibility on any background
  ctx.lineWidth = fontSize * 0.25;
  ctx.strokeStyle = "rgba(255,255,255,0.85)";
  ctx.fillStyle = "#1a1a1a";

  lines.forEach((line, i) => {
    const y = startY + i * lineH;
    ctx.strokeText(line, centerX, y);
    ctx.fillText(line, centerX, y);
  });
}

/**
 * Local pixel-buffer inpainting fallback (used when offscreen Telea fails or
 * user selects "fast" mode).
 * Uses a crude edge-sample gradient blend.
 */
async function inpaintLocal(
  imageSrc: string,
  bboxes: Bbox[],
): Promise<string> {
  const bitmap = await fetchAsImageBitmap(imageSrc);

  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;

  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();

  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  for (const bbox of bboxes) inpaintBbox(imgData, bbox);
  ctx.putImageData(imgData, 0, 0);

  return canvas.toDataURL("image/png");
}

/**
 * Request inpainting from the offscreen document.
 * Method selection is user-configurable via `sync:inpaint-method`:
 *   "auto"   → engine ladder: per-region fitted mask, planar fill -> denoise
 *              -> Telea, each rung decline-gated (Beta4 default).
 *   "telea"  → legacy full-frame Telea fast-marching (quality, slow on big pages)
 *   "fast"   → local edge-blend directly (quick, cruder)
 * Falls back to local pixel-buffer inpainting if offscreen fails or times out.
 * Returns the inpainted data URL, which pipeline produced it ("auto" |
 * "telea" | "fast" | "fallback"), and per-region provenance for "auto".
 */
export async function inpaintImage(
  imageSrc: string,
  bboxes: Bbox[],
  radius = 3,
): Promise<{
  url: string;
  method: "auto" | "telea" | "fast" | "fallback";
  regions?: InpaintRegionResult[];
  error?: string;
}> {
  const method =
    (await storage.getItem<string>("sync:inpaint-method")) ?? "auto";

  if (method === "fast") {
    const url = await inpaintLocal(imageSrc, bboxes);
    return { url, method: "fast" };
  }

  // Offscreen paths - but don't hang forever
  const timeout = (ms: number) =>
    new Promise<{ error: string }>((_, reject) =>
      setTimeout(() => reject(new Error("inpaint timeout")), ms),
    );

  try {
    const response = await Promise.race([
      browser.runtime.sendMessage({
        type: "INPAINT_IMAGE",
        data: { src: imageSrc, bboxes, radius, method },
      }),
      timeout(30_000),
    ]);

    if (response?.error) throw new Error(response.error);

    if (method === "auto") {
      const result = response as {
        url?: string;
        regions?: InpaintRegionResult[];
      };
      if (!result?.url) throw new Error("auto inpaint returned no image");
      return { url: result.url, method: "auto", regions: result.regions };
    }

    return { url: response as string, method: "telea" };
  } catch (err) {
    const message = (err as Error).message;
    console.warn(
      "LMT: Offscreen inpainting failed, falling back to local pixel-buffer:",
      message,
    );
    const url = await inpaintLocal(imageSrc, bboxes);
    return { url, method: "fallback", error: message };
  }
}

/**
 * Draw translations onto an already-inpainted canvas/image.
 * Takes an inpainted base image and adds text overlays.
 */
export async function drawTranslations(
  inpaintedSrc: string,
  bboxes: Bbox[],
  translations: Translations,
): Promise<string> {
  const selectedFont =
    (await storage.getItem<string>("sync:text-font")) ?? "Segoe UI";
  const customFonts =
    (await storage.getItem<{ name: string; dataUrl: string }[]>(
      "local:custom-fonts",
    )) ?? [];

  let fontStack = BUNDLED_FONT_STACKS[selectedFont];

  if (!fontStack) {
    const custom = customFonts.find((f) => f.name === selectedFont);
    if (custom) {
      const face = new FontFace(custom.name, `url(${custom.dataUrl})`);
      await face.load();
      document.fonts.add(face);
      fontStack = `'${custom.name}', sans-serif`;
    } else {
      fontStack = "'Segoe UI', sans-serif";
    }
  }

  const bitmap = await fetchAsImageBitmap(inpaintedSrc);

  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;

  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();

  for (let i = 0; i < bboxes.length; i++) {
    const text = translations[i];
    if (text) {
      await drawFittedText(ctx, text, bboxes[i], fontStack);
    }
  }

  return canvas.toDataURL("image/png");
}

/**
 * Legacy wrapper: inpaint + draw text in one call.
 * Kept for backward compatibility. New code should use inpaintImage + drawTranslations separately.
 * Only regions with text get inpainted - empty/skipped ones keep their original pixels.
 */
export async function repaintWithTranslations(
  imageSrc: string,
  bboxes: Bbox[],
  translations: Translations,
): Promise<string> {
  const paintable = bboxes.filter((_, i) => translations[i]);
  const { url } = await inpaintImage(imageSrc, paintable);
  return drawTranslations(url, bboxes, translations);
}

/**
 * Export a full-resolution canvas as a JPEG file download.
 * quality: 0-1 JPEG compression quality (default 0.85).
 */
export function exportCanvasToJpeg(
  canvas: HTMLCanvasElement,
  quality = 0.85,
): void {
  const link = document.createElement("a");
  link.download = `lmt-export-${Date.now()}.jpg`;
  link.href = canvas.toDataURL("image/jpeg", quality);
  link.click();
}

export function sendBboxDataToTelemetry(
  seriesName: string,
  chapterId: string,
  pageIndex: number,
  bboxes: Bbox[],
  originalSrc: string,
) {
  if (!env.telemetryUrl || !env.telemetryPublicKey) return;

  const isDataOrBlob =
    originalSrc.startsWith("data:") || originalSrc.startsWith("blob:");
  const imageUrl = isDataOrBlob ? window.location.href : originalSrc;

  // Send via background to bypass page CSP/CORS
  browser.runtime
    .sendMessage({
      type: "SEND_TELEMETRY",
      data: {
        seriesName,
        chapterId,
        pageIndex,
        bboxes,
        imageUrl,
      },
    })
    .catch(() => {});
}

export async function updateSeriesContext(
  cleanContext: SeriesContext | null,
  seriesName: string,
  chapterId: string,
  pageIndex: number,
  translations: Translations,
  context?: { summary?: string; dictionary?: string },
) {
  // If no context existed at all, build a fresh one
  const stored = cleanContext ?? {
    seriesName: seriesName,
    summary: "",
    dictionary: "",
    lastChapterId: null,
    lastPageIndex: null,
    recentHistory: [],
    translatedCount: 0,
  };

  // Update summary/dictionary if provided
  if (context) {
    stored.summary = context.summary ?? stored.summary;
    stored.dictionary = context.dictionary ?? stored.dictionary;
  }

  stored.translatedCount += 1;
  stored.lastChapterId = chapterId;
  stored.lastPageIndex = pageIndex;

  // Push the new history object into the buffer
  const formattedText = translations.join(" | ");
  stored.recentHistory = [
    ...stored.recentHistory.slice(-4),
    { chapterId, pageIndex, text: formattedText },
  ];

  await storage.setItem(`sync:context-${seriesName}`, stored);
}

export function createImageObservers(
  originalSrc: string,
  wrapper: HTMLElement,
) {
  // Syncs wrapper visibility to whatever img is currently inside it
  const styleObserver = new MutationObserver(() => {
    const img = wrapper.querySelector("img");
    if (img) wrapper.style.display = img.style.display;
  });

  // Re-attaches wrapper when MangaDex remounts a fresh img element
  const domObserver = new MutationObserver(() => {
    // Debounce so we only react after MangaDex finishes all its mutations
    const allImgs = Array.from(
      document.querySelectorAll<HTMLImageElement>(
        `img[src="${originalSrc.replace(/"/g, '\\"')}"]`,
      ),
    );
    if (!allImgs.length) return;

    const freshImg = allImgs.find((img) => img.parentElement !== wrapper);
    if (!freshImg) return;

    domObserver.disconnect();

    wrapper.querySelectorAll("img").forEach((img) => img.remove());

    freshImg.insertAdjacentElement("beforebegin", wrapper);
    wrapper.appendChild(freshImg);

    wrapper.style.display =
      freshImg.style.display || getComputedStyle(freshImg).display;

    styleObserver.disconnect();
    styleObserver.observe(freshImg, {
      attributes: true,
      attributeFilter: ["style"],
    });

    domObserver.observe(document.body, { childList: true, subtree: true });
  });

  return { styleObserver, domObserver };
}
