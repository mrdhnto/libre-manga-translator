import { env } from "@/lib/env";
import { downloadArtifactHF, arrayBufferToBase64DataUrl } from "@/lib/utils";
import { detectHardware, ensureOffscreen, hasOffscreenApi } from "./utils";
import { handleOffscreenMessage } from "@/lib/inference";
import { DefaultConfig } from "@/lib/configs";
import { testServerConnection } from "@/lib/server/main";
import { createAsyncResponder, keepAliveWhile, withTimeout } from "./messaging";

export default defineBackground(() => {
  async function openSetupTabInBackground(modelId?: string, clean?: boolean) {
    let targetUrl = browser.runtime.getURL("/setup.html");
    if (modelId) {
      targetUrl += `?model=${modelId}`;
    }
    if (clean) {
      targetUrl += `${modelId ? "&" : "?"}clean=1`;
    }

    // Check if any tab is already open with the setup page
    const existingTabs = await browser.tabs.query({
      url: browser.runtime.getURL("/setup.html") + "*",
    });

    if (existingTabs.length > 0) {
      const tab = existingTabs[0];

      await browser.tabs.update(tab.id, {
        active: true,
        ...(targetUrl.includes("?") ? { url: targetUrl } : {}),
      });

      await browser.windows.update(tab.windowId, { focused: true });
    } else {
      await browser.tabs.create({ url: targetUrl });
    }
  }

  // Make Context menu (Popup shows on right click)
  browser.runtime.onInstalled.addListener(async (details) => {
    browser.contextMenus.removeAll();
    browser.contextMenus.create({
      id: "lmt-translate-image",
      title: "Translate Image",
      contexts: ["image"],
    });

    await storage.setItem("local:active-device", await detectHardware());
    if (details.reason === "install") {
      openSetupTabInBackground();
    }
  });

  // Re-probe on every browser launch: an install-time value goes stale when
  // the user later flips GPU prefs (e.g. dom.webgpu.enabled / JSPI flags).
  browser.runtime.onStartup.addListener(async () => {
    await storage.setItem("local:active-device", await detectHardware());
  });

  // Send message when context menu is clicked
  browser.contextMenus.onClicked.addListener(async (info, tab) => {
    if (!tab?.id) return;

    if (info.menuItemId === "lmt-translate-image") {
      // Show popup if user not yet set up the extension
      if (await storage.getItem("local:is-first-run", { fallback: true })) {
        openSetupTabInBackground();
        return;
      }

      browser.tabs.sendMessage(tab.id, {
        type: info.menuItemId,
        data: info.srcUrl,
      });
    }
  });

  browser.runtime.onMessage.addListener((msg, _, sendResponse) => {
    const respond = createAsyncResponder(sendResponse);
    const respondErr = (err: unknown) =>
      respond({ error: (err as Error).message ?? String(err) });

    // Send anonymous bbox telemetry data from background context (bypasses page CSP)
    if (msg.type === "SEND_TELEMETRY") {
      const task = async () => {
        if (!env.telemetryUrl || !env.telemetryPublicKey) {
          return { skipped: true };
        }
        const res = await fetch(env.telemetryUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${env.telemetryPublicKey}`,
          },
          body: JSON.stringify(msg.data),
        });
        if (!res.ok) {
          throw new Error(`Telemetry failed with status ${res.status}: ${res.statusText}`);
        }
        return { success: true };
      };

      keepAliveWhile(task().then(respond).catch(respondErr));

      return true;
    }

    // Proxy image fetch for cross-origin or hotlink-protected images (Cloudflare, Referer checks).
    // Uses declarativeNetRequest to inject the proper Referer so CDNs accept the request,
    // then converts to base64 data URL to completely bypass CORS/network downstream.
    if (msg.type === "PROXY_IMAGE") {
      const { url, referer } = msg.data;
      const task = async () => {
        const ruleId = 99999;
        const dnr = (browser as any).declarativeNetRequest;
        if (dnr?.updateSessionRules && referer) {
          try {
            await dnr.updateSessionRules({
              removeRuleIds: [ruleId],
              addRules: [
                {
                  id: ruleId,
                  priority: 1,
                  action: {
                    type: "modifyHeaders",
                    requestHeaders: [
                      {
                        header: "Referer",
                        operation: "set",
                        value: referer,
                      },
                    ],
                  },
                  condition: {
                    urlFilter: url.replace(/[?#].*$/, ""),
                    resourceTypes: [
                      "xmlhttprequest",
                      "other",
                      "image",
                    ],
                  },
                },
              ],
            });
          } catch (e) {
            console.warn("LMT: Failed to set DNR rule for proxy fetch:", e);
          }
        }

        try {
          const res = await fetch(url);
          if (!res.ok) {
            throw new Error(
              `Proxy fetch failed with status ${res.status}: ${res.statusText}`,
            );
          }
          const buf = await res.arrayBuffer();
          return { dataUrl: arrayBufferToBase64DataUrl(buf) };
        } finally {
          if (dnr?.updateSessionRules && referer) {
            await dnr
              .updateSessionRules({
                removeRuleIds: [ruleId],
              })
              .catch(() => {});
          }
        }
      };

      keepAliveWhile(task().then(respond).catch(respondErr));

      return true;
    }

    // Forwarding heavy inference to the offscreen document
    if (
      ["DETECT_BBOX", "TRANSLATE_IMAGE", "MAKE_SITE_RULE_AI", "INPAINT_IMAGE"].includes(
        msg.type,
      )
    ) {
      const timeoutMs =
        msg.type === "TRANSLATE_IMAGE" || msg.type === "INPAINT_IMAGE"
          ? 180_000
          : 90_000;

      const forward = () =>
        browser.runtime.sendMessage({
          ...msg,
          type: `OFFSCREEN_${msg.type}`,
        });

      // Firefox MV2 has no offscreen document — run the same handlers in
      // the (persistent, DOM-capable) background page instead.
      const runLocal = () =>
        handleOffscreenMessage({ ...msg, type: `OFFSCREEN_${msg.type}` });

      const task = () =>
        hasOffscreenApi()
          ? ensureOffscreen()
              .then(forward)
              .catch(async () => {
                // Offscreen may be dead (e.g. CSP crash) - recreate and retry once.
                await browser.offscreen.closeDocument().catch(() => {});
                await ensureOffscreen();
                return forward();
              })
          : runLocal();

      keepAliveWhile(
        withTimeout(task(), timeoutMs, msg.type)
          .then(respond)
          .catch(respondErr),
      );

      return true;
    }

    // Open/reuse the setup page from any context (content script, popup)
    if (msg.type === "OPEN_SETUP_TAB") {
      keepAliveWhile(
        openSetupTabInBackground(msg.data?.modelId, msg.data?.clean)
          .then(() => respond({ success: true }))
          .catch(respondErr),
      );

      return true;
    }

    // Test a site rule regex against the active tab
    if (msg.type === "TEST_SITE_RULE") {
      const run = async () => {
        const tabs = await browser.tabs.query({
          active: true,
          currentWindow: true,
        });
        if (tabs[0]?.id) {
          return browser.tabs.sendMessage(tabs[0].id, {
            type: "TEST_REGEX_RULE",
            data: { rule: msg.data?.rule },
          });
        }
        return { error: "No active tab." };
      };

      keepAliveWhile(run().then(respond).catch(respondErr));

      return true;
    }

    // Enumerate all downloaded models (CacheStorage + WebLLM)
    if (msg.type === "LIST_CACHED_MODELS") {
      const task = async () => {
        const results: {
          id: string;
          name: string;
          category: "LLM" | "Detection" | "OCR" | "Inpaint" | "Script Gate" | "Other";
          size: number;
          cacheName: string;
          url: string;
          isLlm: boolean;
        }[] = [];

        // 1. Enumerate CacheStorage entries
        try {
          const cacheNames = await caches.keys();
          for (const cacheName of cacheNames) {
            const cache = await caches.open(cacheName);
            const requests = await cache.keys();
            for (const req of requests) {
              const url = req.url;
              let size = 0;
              try {
                const resp = await cache.match(req);
                if (!resp || !resp.ok) {
                  await cache.delete(req).catch(() => {});
                  continue;
                }
                const blob = await resp.blob();
                size = blob?.size ?? 0;
              } catch {
                await cache.delete(req).catch(() => {});
                continue;
              }

              // Filter out 0-byte or aborted entries (< 1 KB is never a valid model weight)
              if (size <= 1024) {
                await cache.delete(req).catch(() => {});
                continue;
              }

              let category: "Detection" | "OCR" | "Inpaint" | "Script Gate" | "LLM" | "Other" = "Other";
              let name = url.split("/").pop() ?? url;
              // Set when the cached file is a wllama GGUF: the entry is
              // reported as an LLM (deleted via the offscreen engine, which
              // also unloads it) instead of a raw cache file.
              let llmModelId: string | null = null;

              if (url.includes("lama-manga") || cacheName.includes("lama-manga")) {
                category = "Inpaint";
                name = "LaMa Redraw Model (lama-manga.onnx)";
              } else if (url.includes("comictextdetector")) {
                category = "Detection";
                name = "ComicTextDetector (comictextdetector.pt.onnx)";
              } else if (url.includes("comic-text-and-bubble") || url.includes("detector-v4")) {
                category = "Detection";
                name = "RT-DETR Bubble Detector (detector-v4-s_int8.onnx)";
              } else if (url.includes("Manga-Bubble-YOLO") || url.includes("onnx/yolo")) {
                category = "Detection";
                name = url.includes("yolo26s") ? "YOLO26-Small" : "YOLO26-Nano";
              } else if (url.includes("manga-ocr") || cacheName.includes("manga-ocr")) {
                category = "OCR";
                name = `Manga-OCR (${url.split("/").pop()})`;
              } else if (url.includes("paddleocr") || url.includes("languages/")) {
                category = "OCR";
                name = `PaddleOCR (${url.split("/").pop()})`;
              } else if (url.includes("osd_lstm") || url.includes("osd_labels")) {
                category = "Script Gate";
                name = `Script Gate (${url.split("/").pop()})`;
              } else if (url.endsWith(".gguf")) {
                // wllama on-device LLM (Firefox build): real blob size is
                // already measured above; match the configured GGUF model
                // for a friendly label.
                const ggufDef = (DefaultConfig.llmModels as { id: string; label: string; file?: string }[]).find(
                  (m) => m.file && url.endsWith(`/${m.file}`),
                );
                category = "LLM";
                name = ggufDef
                  ? `${ggufDef.label} (${ggufDef.file})`
                  : `LLM (${url.split("/").pop()})`;
                llmModelId = ggufDef?.id ?? null;
              }

              results.push({
                id: llmModelId ? `llm::${llmModelId}` : `${cacheName}::${url}`,
                name,
                category,
                size,
                cacheName,
                url: llmModelId ?? url,
                isLlm: llmModelId !== null,
              });
            }

            const remaining = await cache.keys();
            if (remaining.length === 0) {
              await caches.delete(cacheName).catch(() => {});
            }
          }
        } catch (e) {
          console.warn("Failed to enumerate CacheStorage:", e);
        }

        // 2. Enumerate WebLLM cached models from local storage
        try {
          const items = await storage.getItems(["local:cached-llms"]);
          const cachedLlms = (items[0]?.value as string[]) || [];
          for (const modelId of cachedLlms) {
            const foundDef = (DefaultConfig.llmModels as { id: string; label: string; engine?: string; bytes?: number }[]).find((m) => m.id === modelId);
            // wllama GGUF models are enumerated from their CacheStorage
            // entry above (real blob size) — skip here to avoid duplicates.
            if (foundDef?.engine === "wllama") continue;
            results.push({
              id: `llm::${modelId}`,
              name: foundDef ? `${foundDef.label} (${modelId})` : modelId,
              category: "LLM",
              size: foundDef?.bytes ?? (modelId.includes("4B") ? 3.4 * 1024 * 1024 * 1024 : 5.7 * 1024 * 1024 * 1024),
              cacheName: "webllm",
              url: modelId,
              isLlm: true,
            });
          }
        } catch (e) {
          console.warn("Failed to enumerate WebLLM cached models:", e);
        }

        return results;
      };

      keepAliveWhile(task().then(respond).catch(respondErr));
      return true;
    }

    // Delete a single cached model or file
    if (msg.type === "DELETE_CACHED_MODEL") {
      const task = async () => {
        const { isLlm, modelId, cacheName, url } = msg.data;
        if (isLlm && modelId) {
          const payload = {
            type: "OFFSCREEN_DELETE_LLM_CACHE",
            data: { modelId },
          };
          if (hasOffscreenApi()) {
            await ensureOffscreen();
            await browser.runtime.sendMessage(payload);
          } else {
            await handleOffscreenMessage(payload);
          }
          const items = await storage.getItems(["local:cached-llms"]);
          const cached = (items[0]?.value as string[]) || [];
          await storage.setItem(
            "local:cached-llms",
            cached.filter((m) => m !== modelId),
          );
          return { success: true };
        }

        if (cacheName && url) {
          const cache = await caches.open(cacheName);
          await cache.delete(url);
          const remaining = await cache.keys();
          if (remaining.length === 0) {
            await caches.delete(cacheName);
          }
          return { success: true };
        }

        throw new Error("Invalid delete request payload");
      };

      keepAliveWhile(task().then(respond).catch(respondErr));
      return true;
    }

    // Clear all cached models (CacheStorage + WebLLM)
    if (msg.type === "CLEAR_ALL_CACHED_MODELS") {
      const task = async () => {
        const cacheNames = await caches.keys();
        for (const name of cacheNames) {
          await caches.delete(name).catch(() => {});
        }

        const items = await storage.getItems(["local:cached-llms"]);
        const cachedLlms = (items[0]?.value as string[]) || [];
        if (cachedLlms.length > 0) {
          await ensureOffscreen().catch(() => {});
          for (const modelId of cachedLlms) {
            const payload = {
              type: "OFFSCREEN_DELETE_LLM_CACHE",
              data: { modelId },
            };
            if (hasOffscreenApi()) {
              await browser.runtime.sendMessage(payload).catch(() => {});
            } else {
              await handleOffscreenMessage(payload).catch(() => {});
            }
          }
          await storage.setItem("local:cached-llms", []);
        }

        return { success: true };
      };

      keepAliveWhile(task().then(respond).catch(respondErr));
      return true;
    }

    // Delete a cached WebLLM model to free disk space
    if (msg.type === "DELETE_LLM_CACHE") {
      const payload = {
        type: "OFFSCREEN_DELETE_LLM_CACHE",
        data: { modelId: msg.data?.modelId },
      };
      const forward = () => browser.runtime.sendMessage(payload);

      const task = (
        hasOffscreenApi()
          ? ensureOffscreen()
              .then(forward)
              .catch(async () => {
                // Offscreen may be dead (e.g. CSP crash) - recreate and retry once.
                await browser.offscreen.closeDocument().catch(() => {});
                await ensureOffscreen();
                return forward();
              })
          : handleOffscreenMessage(payload)
      )
        .then(async (res: any) => {
          if (res?.error) throw new Error(res.error);
          const items = await storage.getItems(["local:cached-llms"]);
          const cached = (items[0].value as string[]) || [];
          await storage.setItem(
            "local:cached-llms",
            cached.filter((m) => m !== msg.data?.modelId),
          );
          return { success: true };
        });

      keepAliveWhile(withTimeout(task, 60_000, "DELETE_LLM_CACHE").then(respond).catch(respondErr));

      return true;
    }

    // Test the API Mode server connection
    if (msg.type === "TEST_BACKEND") {
      if (msg.data?.kind === "api") {
        keepAliveWhile(
          testServerConnection(msg.data.config)
            .then(respond)
            .catch(respondErr),
        );
      } else {
        respond({ success: false, error: "Unknown backend kind" });
      }

      return true;
    }

    // Caching model when user changes specific settings
    if (msg.type === "PREFETCH_MODEL") {
      const { type, data } = msg.data;

      const runPrefetch = async () => {
        if (type === "inpaint") {
          await downloadArtifactHF(
            DefaultConfig.lamaRepo,
            DefaultConfig.lamaModelPath,
            false,
            true,
          );
        } else if (type === "ocr") {
          if (data === "manga-ocr") {
            await Promise.all([
              downloadArtifactHF(DefaultConfig.mangaOcrRepo, "encoder_model.onnx", false, true),
              downloadArtifactHF(DefaultConfig.mangaOcrRepo, "decoder_model.onnx", false, true),
              downloadArtifactHF(DefaultConfig.mangaOcrRepo, "vocab.txt", false, true),
            ]);
          } else {
            const lang = data && data !== "paddle" ? data : "chinese";
            await downloadArtifactHF(DefaultConfig.ocrRepo, DefaultConfig.ocrModelPath(lang), false, true);
            await downloadArtifactHF(DefaultConfig.ocrRepo, DefaultConfig.ocrDictPath(lang), false, true);
          }
        } else if (type === "detection") {
          if (data === "comic-bubble") {
            await downloadArtifactHF(DefaultConfig.rtdetrModelRepo, "detector-v4-s_int8.onnx", false, true);
          } else if (data === "comic-text-detector") {
            await downloadArtifactHF(
              "direct-model-cache",
              DefaultConfig.comicTextDetectorUrl,
              false,
              true,
            );
          } else {
            await downloadArtifactHF(DefaultConfig.detectionModelRepo, DefaultConfig.detectionModelPath(data), false, true);
          }
        }
        return { success: true };
      };

      keepAliveWhile(runPrefetch().then(respond).catch(respondErr));

      return true;
    }
  });
});
