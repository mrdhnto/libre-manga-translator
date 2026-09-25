import { env } from "@/lib/env";
import { fetchAsImageBitmap } from "@/lib/utils";
import {
  normalizeInpaintMethod,
  type InpaintRegionResult,
} from "@/lib/inpaint/ladder";
import {
  imageToBase64,
  exportCanvasToJpeg,
  BUNDLED_FONT_STACKS,
  sampleRegionAvg,
  inpaintBbox,
  inpaintLocal,
  wrapText,
  drawFittedText,
} from "@/lib/canvas";

export {
  imageToBase64,
  exportCanvasToJpeg,
  BUNDLED_FONT_STACKS,
  sampleRegionAvg,
  inpaintBbox,
  inpaintLocal,
  wrapText,
  drawFittedText,
};

/**
 * Request inpainting from the offscreen document.
 * Method selection is user-configurable via `sync:inpaint-method`:
 *   "fast"    → model-free ladder: per-region fitted mask, planar fill ->
 *              denoise -> Telea, each rung decline-gated (default).
 *   "quality" → standalone LaMa-first pass per region, falling back into the
 *              Fast ladder where LaMa declines (slower, ~207 MB download).
 * Legacy stored values ("auto", "telea", old edge-blend "fast") all read as
 * "fast". Falls back to local pixel-buffer inpainting if offscreen fails or
 * times out. Returns the inpainted data URL, which pipeline produced it
 * ("fast" | "quality" | "fallback"), and per-region provenance.
 */
export async function inpaintImage(
  imageSrc: string,
  bboxes: Bbox[],
): Promise<{
  url: string;
  method: "fast" | "quality" | "fallback";
  regions?: InpaintRegionResult[];
  error?: string;
}> {
  const method = normalizeInpaintMethod(
    await storage.getItem<string>("sync:inpaint-method"),
  );

  // No client-side race here on purpose: heavy jobs queue behind the
  // unified backend limiter, and the backend owns the execution budget
  // (180s, quality max(300s, n*60s)). A local timeout would false-fire
  // during queue wait and fall back to main-thread inpaint.
  try {
    const response = await browser.runtime.sendMessage({
      type: "INPAINT_IMAGE",
      data: { src: imageSrc, bboxes, method },
    });

    if (response?.error) throw new Error(response.error);

    const result = response as {
      url?: string;
      regions?: InpaintRegionResult[];
    };
    if (!result?.url) throw new Error("inpaint returned no image");
    return { url: result.url, method, regions: result.regions };
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

  // Re-attaches wrapper when SPA website remounts a fresh img element
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

/**
 * 32-bit FNV-1a hash returned as 8-character hex string.
 * Used for deterministic cache keying and image src identification.
 */
export function quickHash(str: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * Resolves a reliable page number when URL regex returns 0 (e.g. MangaFire, Comix).
 * 1. Image URL pathname / filename (e.g. /page-003.jpg, /03.webp, ?page=3)
 * 2. DOM data attributes (data-page, data-number, data-index, id="page-N")
 * 3. Ordinal index among manga images on the page
 */
export function resolveImagePageIndex(
  img: HTMLImageElement,
  srcUrl: string,
  urlPageIndex: number,
): number {
  if (urlPageIndex > 0) return urlPageIndex;

  // 1. Try image URL pathname / filename
  if (srcUrl && !srcUrl.startsWith("data:") && !srcUrl.startsWith("blob:")) {
    try {
      const base =
        typeof window !== "undefined" && window.location?.href
          ? window.location.href
          : "https://localhost/";
      const parsed = new URL(srcUrl, base);
      const filename = parsed.pathname.split("/").pop() || "";
      const cleanName = filename.replace(/\.[a-z0-9]+$/i, "");
      const match =
        cleanName.match(/(?:page|p|img)?[-_]?(\d+)$/i) ||
        parsed.search.match(/[?&](?:page|p|index)=(\d+)/i);
      if (match) {
        const num = parseInt(match[1], 10);
        if (!isNaN(num) && num > 0) return num;
      }
    } catch {
      // Ignore URL parse errors
    }
  }

  // 2. Try DOM data attributes on img or parent containers
  const attrTargets = [
    img,
    img.closest("[data-page], [data-number], [data-index], [id*='page']"),
  ];
  for (const target of attrTargets) {
    if (!target) continue;
    const rawVal =
      target.getAttribute("data-page") ||
      target.getAttribute("data-number") ||
      target.getAttribute("data-index") ||
      target.id?.match(/page[-_]?(\d+)/i)?.[1];
    if (rawVal) {
      const num = parseInt(rawVal, 10);
      if (!isNaN(num) && num >= 0) return num;
    }
  }

  // 3. Positional index among manga images on the page
  try {
    const allImgs = Array.from(document.querySelectorAll("img")).filter(
      (el) => el.naturalWidth >= 260 && el.naturalHeight >= 260,
    );
    const idx = allImgs.indexOf(img);
    if (idx >= 0) return idx + 1;
  } catch {
    // Ignore
  }

  return 0;
}
