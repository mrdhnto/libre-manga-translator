import Overlay from "@/lib/components/Overlay.svelte";
import Sidebar from "@/lib/components/Sidebar.svelte";
import FloatingTrigger from "@/lib/components/FloatingTrigger.svelte";
import { AutoTranslateOrchestrator } from "./auto-translate";
import * as Registry from "./translation-registry";
import { mount, unmount } from "svelte";
import { ShadowRootContentScriptUi } from "#imports";
import { getSiteRule, resolveActiveSiteRule } from "@/lib/adapters";
import { DefaultConfig, normalizeDetectionModel, resolveLangGroup } from "@/lib/configs";
import { logDebugEntry, updateDebugEntry } from "./debug";
import {
  createImageObservers,
  imageToBase64,
  repaintWithTranslations,
  updateSeriesContext,
  inpaintImage,
  drawTranslations,
  exportCanvasToJpeg,
  quickHash,
  resolveImagePageIndex,
  fetchAsImageBitmap,
  inpaintBbox,
  type MangaTargetElement,
} from "./utils";
import { getElementSrc } from "@/lib/canvas";
import "@/assets/app.css";

const srcKey = (src: string) =>
  src.startsWith("data:") ? quickHash(src) : src;

// Wait until the image has a real layout (loaded + non-zero rendered box).
// Measuring a hidden/not-yet-loaded image freezes the wrapper at 0×0 and
// misplaces the whole overlay on revisit.
async function waitForLaidOutImage(
  img: MangaTargetElement,
  timeoutMs = 3000,
): Promise<boolean> {
  const ready = () => {
    const naturalW = "naturalWidth" in img ? img.naturalWidth : img.width;
    const naturalH = "naturalHeight" in img ? img.naturalHeight : img.height;
    const rect = img.getBoundingClientRect();
    const inViewport =
      rect.right > 4 &&
      rect.bottom > 4 &&
      rect.left < window.innerWidth - 4 &&
      rect.top < window.innerHeight - 4;
    return (
      document.body.contains(img) &&
      ("complete" in img ? img.complete : true) &&
      naturalW > 0 &&
      naturalH > 0 &&
      rect.width > 0 &&
      rect.height > 0 &&
      (img instanceof HTMLCanvasElement ? inViewport : true)
    );
  };
  if (ready()) return true;
  const start = performance.now();
  while (performance.now() - start < timeoutMs) {
    if (!document.body.contains(img)) return false;
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    if (ready()) return true;
  }
  return ready();
}

async function captureTaintedCanvas(
  canvasEl: HTMLCanvasElement,
): Promise<string | null> {
  try {
    const rect = canvasEl.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    if (
      rect.right <= 0 ||
      rect.bottom <= 0 ||
      rect.left >= window.innerWidth ||
      rect.top >= window.innerHeight
    ) {
      return null;
    }

    const floatingHosts = document.querySelectorAll<HTMLElement>(
      "lmt-floating-trigger, lmt-sidebar",
    );
    const prevVisibility: string[] = [];
    floatingHosts.forEach((h, i) => {
      prevVisibility[i] = h.style.visibility;
      h.style.visibility = "hidden";
    });

    await new Promise<void>((r) =>
      requestAnimationFrame(() => requestAnimationFrame(() => r())),
    );

    let res: { dataUrl?: string; error?: string } | undefined;
    try {
      res = await browser.runtime.sendMessage({
        type: "CAPTURE_VISIBLE_TAB",
      });
    } finally {
      floatingHosts.forEach((h, i) => {
        h.style.visibility = prevVisibility[i] || "";
      });
    }

    if (!res?.dataUrl) return null;

    const bitmap = await fetchAsImageBitmap(res.dataUrl);
    try {
      const dpr = window.devicePixelRatio || 1;
      const sx = Math.max(0, Math.round(rect.left * dpr));
      const sy = Math.max(0, Math.round(rect.top * dpr));
      const sw = Math.min(bitmap.width - sx, Math.round(rect.width * dpr));
      const sh = Math.min(bitmap.height - sy, Math.round(rect.height * dpr));
      if (sw <= 0 || sh <= 0) return null;

      const outW = canvasEl.width || Math.round(rect.width);
      const outH = canvasEl.height || Math.round(rect.height);
      const outCanvas = document.createElement("canvas");
      outCanvas.width = outW;
      outCanvas.height = outH;
      const ctx = outCanvas.getContext("2d");
      if (!ctx) return null;

      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, outW, outH);
      ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, outW, outH);
      return outCanvas.toDataURL("image/jpeg", 0.95);
    } finally {
      bitmap.close?.();
    }
  } catch (err) {
    console.warn("LMT: captureTaintedCanvas failed:", err);
    return null;
  }
}

export default defineContentScript({
  matches: ["<all_urls>"],
  cssInjectionMode: "ui",

  async main(ctx) {
    const translatedSrcMap = new Map<string, string>();
    const inpaintedSrcCache = new Map<
      string,
      { url: string; boxesKey: string }
    >(); // inpainted base images, keyed to the exact set of painted boxes
    const debugEntryIdBySrc = new Map<string, string>(); // src → last debug entry id
    const overlays = new Map<
      string,
      { ui: ShadowRootContentScriptUi<any>; wrapper: HTMLElement }
    >();
    let lastDetectMs: number | undefined = undefined;

    // Mount independent sidebar shadow UI
    createShadowRootUi(ctx, {
      name: "lmt-sidebar",
      position: "inline",
      anchor: "body",
      append: "last",
      onMount: (uiContainer) =>
        mount(Sidebar, {
          target: uiContainer,
        }),
      onRemove: (app) => {
        if (app) unmount(app);
      },
    }).then((ui) => {
      ui.mount();
    });

    async function startTranslationPipeline(imgElement: MangaTargetElement) {
      if (!imgElement || !document.body.contains(imgElement)) return;
      const rawSrc = getElementSrc(imgElement);
      if (!rawSrc) return;
      const clicked = srcKey(rawSrc);
      const originalSrc = (clicked && translatedSrcMap.get(clicked)) ?? rawSrc;
      if (!originalSrc) return;

      // ── Strict early registry guard (LMT-only, no page-world exposure) ──
      const syncK = Registry.srcKeyOf(originalSrc);
      if (Registry.isPending(syncK)) return;
      if (Registry.getStatus(syncK) === "done" && overlays.has(originalSrc)) {
        const existingDone = overlays.get(originalSrc)!;
        if (document.body.contains(existingDone.wrapper)) {
          existingDone.wrapper.dispatchEvent(
            new CustomEvent("lmt:back-to-refine"),
          );
          return;
        }
        // Overlay was done but wrapper detached — clear stale done so cache-restore can run
        Registry.markIdle(originalSrc);
      }

      // If overlay already exists (idle/refining state), bring it back to refine mode
      if (overlays.has(originalSrc)) {
        const existing = overlays.get(originalSrc)!;

        if (!document.body.contains(existing.wrapper)) {
          existing.ui.remove();
          overlays.delete(originalSrc);
        } else {
          // It is still alive on the page, just bring it back to refine mode
          existing.wrapper.dispatchEvent(
            new CustomEvent("lmt:back-to-refine"),
          );
          return;
        }
      }

      // Don't claim the pipeline while the image has no layout yet (hidden
      // page, not-yet-loaded). Geometry captured now would freeze the wrapper
      // at 0×0. Nothing is claimed yet, so a plain return is safe — the queue
      // releases the slot and rescan retries when the page is visible.
      if (!(await waitForLaidOutImage(imgElement))) return;

      // Claim the pipeline SYNCHRONOUSLY (before the first await below)
      // so queue slot accounting sees pending on the same tick the queue
      // dispatched this call. The full cacheKey attaches right after.
      Registry.markPending(originalSrc);

      // Compute full cacheKey early for strict block on pending cacheKey
      let pendingCacheKey: string | undefined;
      try {
        pendingCacheKey = await Registry.resolveCacheKey(imgElement, originalSrc);
        if (Registry.getStatusByCacheKey(pendingCacheKey) === "pending") {
          Registry.markIdle(originalSrc);
          return;
        }
      } catch {
        console.warn("LMT: cache-key resolve failed; continuing without dedupe guard");
      }

      // Attach the cacheKey to the pending claim (idempotent re-mark).
      // Mark pending BEFORE any heavy work / overlay creation so second call strict-blocks
      Registry.markPending(originalSrc, pendingCacheKey);

      // Yield the main thread immediately so the user's click handler returns
      // and the browser can process the next UI event (e.g. opening the popup
      // via the action icon) before we start blocking the page on heavy work.
      // Without this, a popup mount triggered right after click is queued
      // behind our synchronous canvas.encode + DOM mutations and never paints
      // until the pipeline advances to its first await point.
      await new Promise<void>((r) => setTimeout(r, 0));

      // Use base64 when offscreen fetch would fail:
      //   - blob: URLs are page-scoped - offscreen cannot fetch them
      //   - cross-origin images may lack CORS headers - offscreen fetch is blocked
      // imageToBase64 runs in the content script (page context) so both cases succeed.
      // Same-origin https images use the raw URL to avoid JPEG re-encode and the
      // MaxPool ceil() shape error it causes in PaddleOCR.
      // Falls back to background proxy fetch with Referer header rewriting when canvas is tainted.
      let src = originalSrc;
      if (!originalSrc.startsWith("data:")) {
        const dataUrl = imageToBase64(imgElement);
        if (dataUrl) {
          src = dataUrl;
        } else if (imgElement instanceof HTMLCanvasElement) {
          const captured = await captureTaintedCanvas(imgElement);
          if (captured) {
            src = captured;
          } else {
            Registry.markIdle(originalSrc);
            return;
          }
        } else {
          try {
            const res = await browser.runtime.sendMessage({
              type: "PROXY_IMAGE",
              data: { url: originalSrc, referer: window.location.href },
            });
            if (res?.dataUrl) {
              src = res.dataUrl;
            }
          } catch (err) {
            console.warn("LMT: Background image proxy failed:", err);
          }
        }
      }

        const translationKey = async () => {
          const { seriesName, chapterId, pageIndex } = await getSiteRule();
          const resolvedPage = resolveImagePageIndex(
            imgElement,
            originalSrc,
            pageIndex,
          );
          const targetLang =
            (await storage.getItem<string>("sync:target-lang")) ??
            DefaultConfig.targetLang;
          const imgHash = quickHash(originalSrc);
          return `page-cache-${targetLang}-${seriesName}-${chapterId}-p${resolvedPage}-${imgHash}`;
        };

        const rect = imgElement.getBoundingClientRect();
        const naturalW = "naturalWidth" in imgElement ? imgElement.naturalWidth : imgElement.width;
        const naturalH = "naturalHeight" in imgElement ? imgElement.naturalHeight : imgElement.height;
        const scaleX = rect.width / (naturalW || 1);
        const scaleY = rect.height / (naturalH || 1);

        const wrapper = document.createElement("div");
        wrapper.style.cssText = `position:relative;display:inline-block;width:${rect.width}px;height:${rect.height}px;`;
        imgElement.insertAdjacentElement("beforebegin", wrapper);
        wrapper.appendChild(imgElement);

        const { styleObserver, domObserver, sizeObserver } =
          createImageObservers(originalSrc, wrapper);

        // Yield once more before mounting the Overlay Svelte component. The
        // overlay runs several synchronous $effects on mount (cache lookup,
        // reading-direction read, etc.) and the page main thread is otherwise
        // starved from running the popup's mount handler.
        await new Promise<void>((r) => setTimeout(r, 0));

        createShadowRootUi(ctx, {
          name: "lmt-overlay",
          position: "inline",
          anchor: wrapper,
          append: "last",

          onMount: (uiContainer) =>
            mount(Overlay, {
              target: uiContainer,
              props: {
                wrapper,
                targetImageRect: rect,
                scaleX,
                scaleY,
                originalSrc,
                rawImageUrl: src,

                getTranslationCache: async () => {
                  const cache = await storage.getItem<PageCache>(
                    `local:${await translationKey()}`,
                  );
                  if (!cache) return;
                  const translatedSrc = await repaintWithTranslations(
                    src,
                    cache.bboxes,
                    cache.translations,
                  );
                  translatedSrcMap.set(srcKey(translatedSrc), originalSrc);
                  return {
                    bboxes: cache.bboxes,
                    translatedSrc,
                    translations: cache.translations,
                    sourceTexts: cache.sourceTexts,
                    cleanedSrc: cache.cleanedSrc,
                  };
                },

                requestBubbleDetection: async () => {
                  const tStart = performance.now();
                  const detModel = normalizeDetectionModel(
                    (await storage.getItem<string>("sync:detection-model")) ?? DefaultConfig.detectionModels[0].id,
                  );
                  const res = await browser.runtime.sendMessage({
                    type: "DETECT_BBOX",
                    data: src,
                    config: {
                      detectionModel: detModel,
                      detectionMinConfidence: await storage.getItem<number>(
                        "sync:detection-min-confidence",
                      ),
                    },
                  });
                  lastDetectMs = performance.now() - tStart;
                  return res;
                },

                requestTextTranslation: async (
                  bboxes: Bbox[],
                  isManuallySorted: boolean,
                  opts?: {
                    gateForce?: boolean;
                    transient?: boolean;
                    rawText?: string;
                  },
                ) => {
                  const t0 = performance.now();
                  const { seriesName, chapterId, pageIndex } =
                    await getSiteRule();
                  const resolvedPage = resolveImagePageIndex(
                    imgElement,
                    originalSrc,
                    pageIndex,
                  );

                  // ── Batch all config storage reads into one round-trip ──
                  // Sequential `storage.getItem` calls each pay the SW hop cost
                  // and serialize behind popup reads. Reading them in bulk
                  // removes 13 sequential async hops from the hot path.
                  const cfgItems = await storage.getItems([
                    `sync:context-${seriesName}`,
                    "sync:current-mode",
                    "sync:source-lang",
                    "sync:target-lang",
                    "local:active-device",
                    "sync:ocr-min-confidence",
                    "sync:detection-min-confidence",
                    "sync:llm-temperature",
                    "local:server-schema",
                    "sync:gemini-model",
                    "sync:detection-model",
                    "sync:llm-model",
                    "local:server-model",
                  ]);
                  const cfg = Object.fromEntries(
                    cfgItems.map((i) => [i.key, i.value]),
                  );

                  let seriesContext = cfg[`sync:context-${seriesName}`] as
                    | SeriesContext
                    | undefined;

                  // Perform the continuity check
                  if (seriesContext) {
                    const isContinuous =
                      seriesContext.lastChapterId === chapterId &&
                      seriesContext.lastPageIndex !== null &&
                      resolvedPage === seriesContext.lastPageIndex + 1;

                    // If they jumped chapters or skipped pages, wipe the history in memory
                    if (!isContinuous) {
                      seriesContext.recentHistory = [];
                    }
                  }

                  const curMode =
                    (cfg["sync:current-mode"] as string | undefined) ??
                    DefaultConfig.currentMode;
                  const srcLang =
                    (cfg["sync:source-lang"] as string | undefined) ??
                    DefaultConfig.sourceLang;
                  const tgtLang =
                    (cfg["sync:target-lang"] as string | undefined) ??
                    DefaultConfig.targetLang;
                  const debugCtx = {
                    version: (browser.runtime.getManifest() as any).version_name || browser.runtime.getManifest().version,
                    device: (cfg["local:active-device"] as string | undefined) ?? undefined,
                    langGroup: resolveLangGroup(srcLang).group,
                    ocrMinConfidence: (cfg["sync:ocr-min-confidence"] as number | undefined) ?? DefaultConfig.ocrMinConfidence,
                    detectionMinConfidence: (cfg["sync:detection-min-confidence"] as number | undefined) ?? DefaultConfig.detectionMinConfidence,
                    temperature: (cfg["sync:llm-temperature"] as number | undefined) ?? DefaultConfig.llmTemperature,
                    serverSchema: (cfg["local:server-schema"] as string | undefined) ?? DefaultConfig.serverSchema,
                    geminiModel: (cfg["sync:gemini-model"] as string | undefined) ?? DefaultConfig.geminiModels[0].id,
                    ocrModel: DefaultConfig.ocrModelPath(
                      resolveLangGroup(srcLang).group,
                    ),
                    detectionModel: normalizeDetectionModel(
                      (cfg["sync:detection-model"] as string | undefined) ?? DefaultConfig.detectionModels[0].id,
                    ),
                    llmModel: (cfg["sync:llm-model"] as string | undefined) ?? undefined,
                    serverModel: (cfg["local:server-model"] as string | undefined) ?? undefined,
                  };

                  // ── Batch the remaining runtime keys for the message payload ──
                  const runtimeItems = await storage.getItems([
                    "local:gemini-key",
                    "sync:gemini-model",
                    "sync:ocr-min-confidence",
                    "sync:ocr-engine",
                    "sync:llm-model",
                    "sync:llm-temperature",
                    "local:server-host",
                    "local:server-schema",
                    "local:server-model",
                    "local:use-server-api-key",
                    "local:server-api-key",
                    "sync:script-gate",
                  ]);
                  const runtime = Object.fromEntries(
                    runtimeItems.map((i) => [i.key, i.value]),
                  );

                  const resp = await browser.runtime.sendMessage({
                    type: "TRANSLATE_IMAGE",
                    data: {
                      src: src,
                      bboxes,
                      seriesContext,
                      rawText: opts?.rawText,
                    },
                    config: {
                      currentMode: curMode,
                      targetLang: tgtLang,
                      sourceLang: srcLang,
                      geminiKey: runtime["local:gemini-key"] as string | undefined,
                      geminiModel: runtime["sync:gemini-model"] as string | undefined,
                      ocrMinConfidence: runtime["sync:ocr-min-confidence"] as number | undefined,
                      ocrEngine:
                        (runtime["sync:ocr-engine"] as string | undefined) ??
                        DefaultConfig.ocrEngine,
                      llmModel: runtime["sync:llm-model"] as string | undefined,
                      llmTemperature: runtime["sync:llm-temperature"] as number | undefined,
                      serverHost: runtime["local:server-host"] as string | undefined,
                      serverSchema: runtime["local:server-schema"] as string | undefined,
                      serverModel: runtime["local:server-model"] as string | undefined,
                      useServerApiKey: runtime["local:use-server-api-key"] as boolean | undefined,
                      serverApiKey: runtime["local:server-api-key"] as string | undefined,
                      scriptGate:
                        (runtime["sync:script-gate"] as boolean | undefined) ??
                        DefaultConfig.scriptGate,
                      gateForce: opts?.gateForce ?? false,
                    },
                  });

                  const duration = performance.now() - t0;

                  if (resp?.error) {
                    if (!opts?.transient) {

                      // Fire-and-forget debug log so a slow storage write never
                      // blocks the next pipeline stage or the popup from opening.
                      logDebugEntry({
                        id: crypto.randomUUID(),
                        timestamp: Date.now(),
                        success: false,
                        mode: curMode,
                        version: debugCtx.version,
                        device: debugCtx.device,
                        sourceLang: srcLang,
                        targetLang: tgtLang,
                        langGroup: debugCtx.langGroup,
                        bboxCount: bboxes.length,
                        timing: { total: duration },

                        ocrMinConfidence: debugCtx.ocrMinConfidence,
                        detectionMinConfidence: debugCtx.detectionMinConfidence,
                        temperature: debugCtx.temperature,
                        serverSchema: debugCtx.serverSchema,
                        geminiModel:

                          curMode === "gemini" ? debugCtx.geminiModel : undefined,
                        models: {

                          detection: debugCtx.detectionModel,
                          ocr: debugCtx.ocrModel,

                          llm: curMode === "webgpu" ? debugCtx.llmModel : undefined,
                          server: curMode === "api" ? debugCtx.serverModel : undefined,
                        },
                        error: resp.error,
                      })

                        .then((entryId) => debugEntryIdBySrc.set(src, entryId))
                        .catch((err) => console.warn("LMT: debug-log write failed:", err));
                    }
                    return resp;
                  }

                  const { translations, context, sourceTexts, gateSkip, gate } =
                    resp;
                  const timing = {
                    total: duration,
                    detect: lastDetectMs,
                    ocr: resp?.timing?.ocr,
                    translate: resp?.timing?.translate,
                  };
                  const backend = resp?.backend;

                  if (!opts?.transient) {

                    // Fire-and-forget: success debug log, page cache, and series
                    // context updates. None of these need to block the popup.
                    const successEntryPromise = logDebugEntry({
                    id: crypto.randomUUID(),
                    timestamp: Date.now(),
                    success: true,
                    mode: curMode,
                    version: debugCtx.version,
                    device: debugCtx.device,
                    backend: curMode === "webgpu" ? backend : undefined,
                    gate: gate
                      ? {
                          mode: gate.mode,
                          checked: gate.checked,
                          skipped: gate.skipped,
                          group: gate.group,
                          unavailable: gate.unavailable,
                        }
                      : undefined,
                    sourceLang: srcLang,
                    targetLang: tgtLang,
                    langGroup: debugCtx.langGroup,
                    bboxCount: bboxes.length,
                    sourceTexts,
                    translations,
                    timing,
                    ocrMinConfidence: debugCtx.ocrMinConfidence,
                    detectionMinConfidence: debugCtx.detectionMinConfidence,
                    temperature: debugCtx.temperature,
                    serverSchema: debugCtx.serverSchema,
                    geminiModel:
                      curMode === "gemini" ? debugCtx.geminiModel : undefined,
                    models: {
                      detection: debugCtx.detectionModel,
                      ocr: debugCtx.ocrModel,
                      llm: curMode === "webgpu" ? debugCtx.llmModel : undefined,
                      server: curMode === "api" ? debugCtx.serverModel : undefined,
                    },
                  })
                    .then((entryId) => {
                      debugEntryIdBySrc.set(src, entryId);
                    })
                    .catch((err) => console.warn("LMT: debug-log write failed:", err));

                  const cacheKey = await translationKey();
                  storage
                    .setItem<PageCache>(`local:${cacheKey}`, {
                      bboxes,
                      translations,
                      sourceTexts,
                    })
                    .catch((err) => console.warn("LMT: page-cache persist failed:", err));

                  updateSeriesContext(
                    seriesContext ?? null,
                    seriesName,
                    chapterId,
                    resolvedPage,
                    translations,
                    context,
                  ).catch((err) => console.warn("LMT: series-context update failed:", err));
                }

                  return { translations, sourceTexts, context, gateSkip, gate };
                },

                // Re-render translations on top of the (cached) inpainted base.
                // Used by the edit panel: Apply → repaint with edited text + persist cache.
                renderTranslations: async (
                  translations: Translations,
                  bboxes: Bbox[],
                ) => {
                  // Only regions we actually paint get inpainted: a gate-skipped
                  // or empty region keeps its original text untouched (erasing
                  // without painting was a latent defect for failed OCR too).
                  const paintable = bboxes.filter((_, i) => translations[i]);
                  const boxesKey = JSON.stringify(
                    paintable.map((b) => [
                      Math.round(b.x1),
                      Math.round(b.y1),
                      Math.round(b.x2),
                      Math.round(b.y2),
                    ]),
                  );
                  let cached = inpaintedSrcCache.get(src);
                  let inpaintMethod:
                    | "fast"
                    | "quality"
                    | "fallback"
                    | undefined;
                  let inpaintMs: number | undefined;
                  if (!cached || cached.boxesKey !== boxesKey) {
                    const tInpaint = performance.now();
                    const res = await inpaintImage(src, paintable);
                    inpaintMs = performance.now() - tInpaint;
                    cached = { url: res.url, boxesKey };
                    inpaintedSrcCache.set(src, cached);
                    inpaintMethod = res.method;

                    if (res.regions) {
                      // Bind by the record's own index, not by array position:
                      // `index` is the contract the ladder guarantees against
                      // the bbox array it was handed (`paintable`).
                      res.regions.forEach((r) => {
                        const target = paintable[r.index];
                        if (r.method === "declined" && target) {
                          target.inpaintDeclined = true;
                        }
                      });
                    }

                    const inpaintStats = res.regions
                      ? {
                          fill: res.regions.filter(
                            (r) => r.method === "fill",
                          ).length,
                          denoise: res.regions.filter(
                            (r) => r.method === "denoise",
                          ).length,
                          lama: res.regions.filter(
                            (r) => r.method === "lama",
                          ).length,
                          telea: res.regions.filter(
                            (r) => r.method === "telea",
                          ).length,
                          rectTelea: res.regions.filter(
                            (r) => r.method === "rect-telea",
                          ).length,
                          declined: res.regions.filter(
                            (r) => r.method === "declined",
                          ).length,
                          skipped: res.regions.filter(
                            (r) => r.method === "skipped",
                          ).length,
                        }
                      : undefined;

                    // Attach inpainting details to the translate debug entry (same src).
                    const debugId = debugEntryIdBySrc.get(src);
                    if (debugId) {
                      // A size skip carries an explanatory note in lamaError; it is
                      // not a model failure, so it must not mask (or fake) one.
                      const inpaintLamaError = res.regions
                        ?.filter((r) => r.lamaStage !== "skipped-size")
                        .map((r) => r.lamaError)
                        .find((e): e is string => !!e);
                      // Only the Quality path stamps lamaStage, so a Fast run logs none.
                      const lamaStages = res.regions?.some((r) => r.lamaStage)
                        ? {
                            painted: res.regions.filter(
                              (r) => r.lamaStage === "painted",
                            ).length,
                            skippedSize: res.regions.filter(
                              (r) => r.lamaStage === "skipped-size",
                            ).length,
                            failed: res.regions.filter(
                              (r) => r.lamaStage === "failed",
                            ).length,
                            notAttempted: res.regions.filter(
                              (r) => r.lamaStage === "not-attempted",
                            ).length,
                          }
                        : undefined;
                      await updateDebugEntry(debugId, {
                        inpaintMethod,
                        inpaintStats,
                        inpaintError: res.error,
                        inpaintLamaError,
                        lamaStages,
                        timing: { inpaint: inpaintMs },
                      });
                    }
                  }

                  const translatedSrc = await drawTranslations(
                    cached.url,
                    bboxes,
                    translations,
                  );
                  translatedSrcMap.set(srcKey(translatedSrc), originalSrc);

                  // Persist edited translations and bboxes so cache re-open shows them
                  const cache = await storage.getItem<PageCache>(
                    `local:${await translationKey()}`,
                  );
                  if (cache) {
                    await storage.setItem<PageCache>(
                      `local:${await translationKey()}`,
                      {
                        ...cache,
                        translations,
                        bboxes,
                        cleanedSrc: cached?.url,
                      },
                    );
                  }

                  return translatedSrc;
                },

                getCleanedSrc: async (currentBboxes?: Bbox[]) => {
                  let cached = inpaintedSrcCache.get(src);
                  if (cached?.url) return cached.url;
                  const boxes = currentBboxes ?? [];
                  const res = await inpaintImage(src, boxes);
                  cached = { url: res.url, boxesKey: "" };
                  inpaintedSrcCache.set(src, cached);
                  return res.url;
                },

                applyInpaintPatches: async (
                  baseCleanedSrc: string,
                  addedPatches: Bbox[],
                  removedPatches: Bbox[],
                ) => {
                  const bitmap = await fetchAsImageBitmap(baseCleanedSrc);
                  const canvas = document.createElement("canvas");
                  canvas.width = bitmap.width;
                  canvas.height = bitmap.height;
                  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
                  ctx.drawImage(bitmap, 0, 0);
                  bitmap.close();

                  // 1. Restore raw pixels for removed areas
                  if (removedPatches.length > 0) {
                    const rawBitmap = await fetchAsImageBitmap(src);
                    for (const p of removedPatches) {
                      const x = Math.max(0, Math.round(p.x1));
                      const y = Math.max(0, Math.round(p.y1));
                      const w = Math.min(canvas.width - x, Math.round(p.x2 - p.x1));
                      const h = Math.min(canvas.height - y, Math.round(p.y2 - p.y1));
                      if (w > 0 && h > 0) {
                        ctx.drawImage(rawBitmap, x, y, w, h, x, y, w, h);
                      }
                    }
                    rawBitmap.close();
                  }

                  let currentDataUrl = canvas.toDataURL("image/png");

                  // 2. Inpaint added areas
                  if (addedPatches.length > 0) {
                    try {
                      const res = await inpaintImage(currentDataUrl, addedPatches);
                      currentDataUrl = res.url;
                    } catch (err) {
                      console.warn("LMT: Patch inpaint via offscreen failed, using local fallback", err);
                      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                      for (const p of addedPatches) inpaintBbox(imgData, p);
                      ctx.putImageData(imgData, 0, 0);
                      currentDataUrl = canvas.toDataURL("image/png");
                    }
                  }

                  // Update cache
                  inpaintedSrcCache.set(src, { url: currentDataUrl, boxesKey: "" });
                  return currentDataUrl;
                },

                exportCanvasToJpeg,

                onBackToRefine: () => {
                  inpaintedSrcCache.delete(src);
                },

                onClose: () => overlays.get(originalSrc)?.ui?.remove(),
              },
            }),

          onRemove: (app) => {
            if (app) unmount(app);

            overlays.delete(originalSrc);
            inpaintedSrcCache.delete(src); // Clear inpainted cache when overlay closes
            for (const [key, value] of translatedSrcMap) {
              if (value === originalSrc) translatedSrcMap.delete(key);
            }
            // LMT-only registry: idle so pill/queue can retrigger after close/error
            // Use pendingCacheKey if known, else just bySrc
            try {
              Registry.markIdle(originalSrc, pendingCacheKey);
            } catch {
              Registry.markIdle(originalSrc);
            }

            document.dispatchEvent(new CustomEvent("lmt:mode-change"));

            styleObserver.disconnect();
            domObserver.disconnect();
            sizeObserver.disconnect();

            const currentImg = wrapper.querySelector("img");
            if (currentImg) wrapper.replaceWith(currentImg);
            else wrapper.remove();
          },
        }).then((ui) => {
          overlays.set(originalSrc, { ui, wrapper });
          ui.mount();

          styleObserver.observe(imgElement, {
            attributes: true,
            attributeFilter: ["style"],
          });
          domObserver.observe(wrapper.parentElement ?? document.body, {
            childList: true,
            subtree: true,
          });
        });
    }

    // ── Auto-Translate Engine (owns the unified queue) ────────────────────
    // Created before the pill so manual clicks enqueue through the same
    // limiter: slider cap when auto is ON, absolute 3 when OFF.
    const autoTranslator = new AutoTranslateOrchestrator();
    autoTranslator.init(startTranslationPipeline);
    ctx.onInvalidated(() => autoTranslator.destroy());

    // ── Floating Hover Trigger ──────────────────────────────────────────
    // Indirect hover mapping (descendant / beneath-cursor) is gated on the
    // active rule's reader container so episode cards and nav chrome on list
    // pages never summon the pill.
    const pillRule = await resolveActiveSiteRule();
    createShadowRootUi(ctx, {
      name: "lmt-floating-trigger",
      position: "inline",
      anchor: "body",
      append: "last",
      onMount: (uiContainer) =>
        mount(FloatingTrigger, {
          target: uiContainer,
          props: {
            onTranslate: (img: MangaTargetElement) => {
              autoTranslator.enqueueManual(img);
            },
            getOverlayMode: (img: MangaTargetElement) => {
              const raw = getElementSrc(img);
              const originalSrc = translatedSrcMap.get(srcKey(raw)) ?? raw;
              const overlay = overlays.get(originalSrc);
              if (!overlay) return "idle";
              const mode = overlay.wrapper.getAttribute("data-lmt-mode");
              if (mode === "results") return "translated";
              if (mode === "loading") return "translating";
              return "idle";
            },
            getOverlayProgress: (img: MangaTargetElement) => {
              const raw = getElementSrc(img);
              const originalSrc = translatedSrcMap.get(srcKey(raw)) ?? raw;
              const overlay = overlays.get(originalSrc);
              return (
                overlay?.wrapper.getAttribute("data-lmt-progress") ??
                "Translating…"
              );
            },
            isSameSource: (img: MangaTargetElement, src: string) => {
              const raw = getElementSrc(img);
              const originalSrc = translatedSrcMap.get(srcKey(raw)) ?? raw;
              return originalSrc === src || raw === src;
            },
            readerContainerSelector: pillRule.containerSelector ?? null,
            pillPosition: pillRule.pillPosition,
          },
        }),
      onRemove: (app) => {
        if (app) unmount(app);
      },
    }).then((ui) => {
      ui.mount();
    });

    browser.runtime.onMessage.addListener(async (msg, _, sendResponse) => {
      // Test Regex from popup settings to show live result
      if (msg.type === "TEST_REGEX_RULE") {
        getSiteRule([msg.data.rule]).then((result) =>
          sendResponse({
            context: result,
            raw: { title: document.title, path: window.location.pathname },
          }),
        );

        return true;
      }
    });
  },
});
