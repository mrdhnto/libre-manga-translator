import Overlay from "@/lib/components/Overlay.svelte";
import Sidebar from "@/lib/components/Sidebar.svelte";
import { mount, unmount } from "svelte";
import { ShadowRootContentScriptUi } from "#imports";
import { getSiteRule } from "@/lib/adapters";
import { DefaultConfig } from "@/lib/configs";
import { logDebugEntry, updateDebugEntry } from "./debug";
import {
  createImageObservers,
  imageToBase64,
  repaintWithTranslations,
  sendBboxDataToTelemetry,
  updateSeriesContext,
  inpaintImage,
  drawTranslations,
  exportCanvasToJpeg,
} from "./utils";
import "@/assets/app.css";

const srcKey = (src: string) => src.slice(0, 100);

export default defineContentScript({
  matches: ["<all_urls>"],
  cssInjectionMode: "ui",

  async main(ctx) {
    const translatedSrcMap = new Map<string, string>();
    const inpaintedSrcCache = new Map<string, string>(); // Cache inpainted base images
    const debugEntryIdBySrc = new Map<string, string>(); // src → last debug entry id
    const overlays = new Map<
      string,
      { ui: ShadowRootContentScriptUi<any>; wrapper: HTMLElement }
    >();
    let lastRightClickedSrc: string | undefined = undefined;
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

    document.addEventListener("contextmenu", (e) => {
      const img = e
        .composedPath()
        .find((el) => el instanceof HTMLImageElement) as
        | HTMLImageElement
        | undefined;
      lastRightClickedSrc = img && srcKey(img.src);
    });

    browser.runtime.onMessage.addListener(async (msg, _, sendResponse) => {
      if (msg.type === "lmt-translate-image") {
        const clicked = msg.data ?? lastRightClickedSrc;
        const originalSrc = translatedSrcMap.get(clicked) ?? clicked;
        if (!originalSrc) return;

        // If overlay already exists, bring it back to refine mode
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

        const imgElement = document.querySelector<HTMLImageElement>(
          `img[src="${originalSrc.replace(/"/g, '\\"')}"]`,
        );
        if (!imgElement) return;

        // Use base64 when offscreen fetch would fail:
        //   • blob: URLs are page-scoped - offscreen cannot fetch them
        //   • cross-origin images may lack CORS headers - offscreen fetch is blocked
        // imageToBase64 runs in the content script (page context) so both cases succeed.
        // Same-origin https images use the raw URL to avoid JPEG re-encode and the
        // MaxPool ceil() shape error it causes in PaddleOCR.
        // Falls back to background proxy fetch with Referer header rewriting when canvas is tainted.
        let src = originalSrc;
        if (!originalSrc.startsWith("data:")) {
          const dataUrl = imageToBase64(imgElement);
          if (dataUrl) {
            src = dataUrl;
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
          return `page-cache-${await storage.getItem<string>("sync:target-lang") ?? DefaultConfig.targetLang}-${seriesName}-${chapterId}-${pageIndex}`;
        };

        const rect = imgElement.getBoundingClientRect();
        const scaleX = rect.width / imgElement.naturalWidth;
        const scaleY = rect.height / imgElement.naturalHeight;

        const wrapper = document.createElement("div");
        wrapper.style.cssText = `position:relative;display:inline-block;width:${rect.width}px;height:${rect.height}px;`;
        imgElement.insertAdjacentElement("beforebegin", wrapper);
        wrapper.appendChild(imgElement);

        const { styleObserver, domObserver } = createImageObservers(
          originalSrc,
          wrapper,
        );

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
                  };
                },

                requestBubbleDetection: async () => {
                  const tStart = performance.now();
                  const detModel = (await storage.getItem<string>("sync:detection-model")) ?? DefaultConfig.detectionModels[0].id;
                  const res = await browser.runtime.sendMessage({
                    type: "DETECT_BBOX",
                    data: src,
                    config: {
                      detectionModel: detModel,
                      autoUpdateModel: await storage.getItem<boolean>(
                        "sync:detection-auto-update",
                      ),
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
                ) => {
                  const t0 = performance.now();
                  const { seriesName, chapterId, pageIndex } =
                    await getSiteRule();
                  const shareData =
                    await storage.getItem<boolean>("sync:share-data");

                  if (shareData && isManuallySorted)
                    sendBboxDataToTelemetry(
                      seriesName,
                      chapterId,
                      pageIndex,
                      bboxes,
                      src,
                    );

                  let seriesContext = await storage.getItem<SeriesContext>(
                    `sync:context-${seriesName}`,
                  );

                  // Perform the continuity check
                  if (seriesContext) {
                    const isContinuous =
                      seriesContext.lastChapterId === chapterId &&
                      seriesContext.lastPageIndex !== null &&
                      pageIndex === seriesContext.lastPageIndex + 1;

                    // If they jumped chapters or skipped pages, wipe the history in memory
                    if (!isContinuous) {
                      seriesContext.recentHistory = [];
                    }
                  }

                  const curMode = (await storage.getItem<string>("sync:current-mode")) ?? DefaultConfig.currentMode;
                  const srcLang = (await storage.getItem<string>("sync:source-lang")) ?? DefaultConfig.sourceLang;
                  const tgtLang = (await storage.getItem<string>("sync:target-lang")) ?? DefaultConfig.targetLang;
                  const debugCtx = {
                    version: browser.runtime.getManifest().version,
                    device: (await storage.getItem<string>("local:active-device")) ?? undefined,
                    langGroup: DefaultConfig.ocrLangGroupMap[srcLang] ?? "latin",
                    ocrMinConfidence: (await storage.getItem<number>("sync:ocr-min-confidence")) ?? DefaultConfig.ocrMinConfidence,
                    detectionMinConfidence: (await storage.getItem<number>("sync:detection-min-confidence")) ?? DefaultConfig.detectionMinConfidence,
                    temperature: (await storage.getItem<number>("sync:llm-temperature")) ?? DefaultConfig.llmTemperature,
                    serverSchema: (await storage.getItem<string>("sync:server-schema")) ?? DefaultConfig.serverSchema,
                    geminiModel: (await storage.getItem<string>("sync:gemini-model")) ?? DefaultConfig.geminiModels[0].id,
                    ocrModel: DefaultConfig.ocrModelPath(
                      DefaultConfig.ocrLangGroupMap[srcLang] ?? "latin",
                    ),
                    detectionModel: (await storage.getItem<string>("sync:detection-model")) ?? DefaultConfig.detectionModels[0].id,
                    llmModel: (await storage.getItem<string>("sync:llm-model")) ?? undefined,
                    serverModel: (await storage.getItem<string>("sync:server-model")) ?? undefined,
                  };

                  const resp = await browser.runtime.sendMessage({
                    type: "TRANSLATE_IMAGE",
                    data: {
                      src: src,
                      bboxes,
                      seriesContext,
                    },
                    config: {
                      currentMode: curMode,
                      targetLang: tgtLang,
                      sourceLang: srcLang,
                      geminiKey:
                        await storage.getItem<string>("sync:gemini-key"),
                      geminiModel:
                        await storage.getItem<string>("sync:gemini-model"),
                      ocrMinConfidence: await storage.getItem<number>(
                        "sync:ocr-min-confidence",
                      ),
                      llmModel: await storage.getItem<string>("sync:llm-model"),
                      llmTemperature: await storage.getItem<number>(
                        "sync:llm-temperature",
                      ),
                      serverHost:
                        await storage.getItem<string>("sync:server-host"),
                      serverSchema:
                        await storage.getItem<string>("sync:server-schema"),
                      serverModel:
                        await storage.getItem<string>("sync:server-model"),
                      useServerApiKey: await storage.getItem<boolean>(
                        "sync:use-server-api-key",
                      ),
                      serverApiKey:
                        await storage.getItem<string>("sync:server-api-key"),
                    },
                  });

                  const duration = performance.now() - t0;

                  if (resp?.error) {
                    const entryId = await logDebugEntry({
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
                    });
                    debugEntryIdBySrc.set(src, entryId);
                    return resp;
                  }

                  const { translations, context, sourceTexts } = resp;
                  const timing = {
                    total: duration,
                    detect: lastDetectMs,
                    ocr: resp?.timing?.ocr,
                    translate: resp?.timing?.translate,
                  };
                  const backend = resp?.backend;

                  const entryId = await logDebugEntry({
                    id: crypto.randomUUID(),
                    timestamp: Date.now(),
                    success: true,
                    mode: curMode,
                    version: debugCtx.version,
                    device: debugCtx.device,
                    backend: curMode === "webgpu" ? backend : undefined,
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
                  });
                  debugEntryIdBySrc.set(src, entryId);

                  await storage.setItem<PageCache>(
                    `local:${await translationKey()}`,
                    {
                      bboxes,
                      translations,
                      sourceTexts,
                    },
                  );
                  await updateSeriesContext(
                    seriesContext,
                    seriesName,
                    chapterId,
                    pageIndex,
                    translations,
                    context,
                  );

                  return { translations, sourceTexts, context };
                },

                // Re-render translations on top of the (cached) inpainted base.
                // Used by the edit panel: Apply → repaint with edited text + persist cache.
                renderTranslations: async (
                  translations: Translations,
                  bboxes: Bbox[],
                ) => {
                  let inpaintedSrc = inpaintedSrcCache.get(src);
                  let inpaintMethod: "telea" | "fast" | "fallback" | undefined;
                  let inpaintMs: number | undefined;
                  if (!inpaintedSrc) {
                    const tInpaint = performance.now();
                    const res = await inpaintImage(src, bboxes);
                    inpaintMs = performance.now() - tInpaint;
                    inpaintedSrc = res.url;
                    inpaintMethod = res.method;
                    inpaintedSrcCache.set(src, inpaintedSrc);

                    // Attach inpainting details to the translate debug entry (same src).
                    const debugId = debugEntryIdBySrc.get(src);
                    if (debugId) {
                      await updateDebugEntry(debugId, {
                        inpaintMethod,
                        inpaintError: res.error,
                        timing: { inpaint: inpaintMs },
                      });
                    }
                  }

                  const translatedSrc = await drawTranslations(
                    inpaintedSrc,
                    bboxes,
                    translations,
                  );
                  translatedSrcMap.set(srcKey(translatedSrc), originalSrc);

                  // Persist edited translations so cache re-open shows them
                  const cache = await storage.getItem<PageCache>(
                    `local:${await translationKey()}`,
                  );
                  if (cache) {
                    await storage.setItem<PageCache>(
                      `local:${await translationKey()}`,
                      {
                        ...cache,
                        translations,
                      },
                    );
                  }

                  return translatedSrc;
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

            styleObserver.disconnect();
            domObserver.disconnect();

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

        return true;
      }

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
