import { env } from "@/lib/env";
import { downloadArtifactHF, arrayBufferToBase64DataUrl, isArtifactCached } from "@/lib/utils";
import { checkArtifactUpdate, forceRefreshArtifact } from "@/lib/models/updates";
import { detectHardware, ensureFirefoxInferencePage, ensureOffscreen, hasOffscreenApi } from "./utils";
import { DefaultConfig, SUPPORTED_LANG_GROUPS, normalizeDetectionModel, resolveLangGroup } from "@/lib/configs";
import { UNKNOWN_DETECTION_MODEL_MESSAGE } from "@/lib/detections/main";
import { testServerConnection } from "@/lib/server/main";
import { createAsyncResponder, keepAliveWhile, withTimeout } from "./messaging";
import { isAllowedImageUrl } from "@/lib/security";

/**
 * Parse a VRAM label like "~800 MB" / "3.4 GB" into bytes for display.
 * Unknown format → 0 (formatter renders "0 B", never a wrong size).
 */
function parseVramToBytes(vram: string | undefined): number {
  if (!vram) return 0;
  const m = vram.match(/([\d.]+)\s*(MB|GB)/i);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * (m[2].toUpperCase() === "GB" ? 1024 ** 3 : 1024 ** 2));
}

export default defineBackground(() => {
  // ── Unified backend limiter ──────────────────────────────────────────
  // One counting semaphore shared by all pipeline backends (webgpu /
  // gemini / api) and all heavy stages (detect, translate, inpaint), so
  // auto + manual jobs across every tab can never burst past the cap.
  // Cap rule mirrors the content queue: slider 1..10 when auto is ON,
  // absolute 3 when OFF. Read per-acquire so mid-queue mode/pipeline
  // swaps keep working without resetting the queue.
  // ponytail: in-memory only, lost on SW kill; keepAliveWhile covers
  // active work and stalled waiters surface via withTimeout → markIdle.
  const MANUAL_BACKEND_CAP = 3;
  let backendActive = 0;
  const backendWaiters: Array<() => void> = [];

  async function getBackendCap(): Promise<number> {
    try {
      const [enabled, slider] = await Promise.all([
        storage.getItem<boolean>("sync:auto-translate"),
        storage.getItem<number>("sync:auto-translate-concurrency"),
      ]);
      if (enabled) return Math.min(10, Math.max(1, Math.trunc(slider as number) || 1));
      return MANUAL_BACKEND_CAP;
    } catch {
      return 1;
    }
  }

  function pumpBackendQueue(cap: number) {
    while (backendActive < cap && backendWaiters.length > 0) {
      backendActive++;
      backendWaiters.shift()!();
    }
  }

  async function acquireBackendSlot(): Promise<() => void> {
    const cap = await getBackendCap();
    // Check + increment is synchronous past this await, so concurrent
    // acquirers serialize here without over-issuing.
    if (backendActive < cap) {
      backendActive++;
      return () => {
        backendActive--;
        void getBackendCap().then(pumpBackendQueue);
      };
    }
    return new Promise<() => void>((resolve) => {
      backendWaiters.push(() => {
        resolve(() => {
          backendActive--;
          void getBackendCap().then(pumpBackendQueue);
        });
      });
      // Cap may have grown while waiting with no release in flight — pump.
      void getBackendCap().then(pumpBackendQueue);
    });
  }

  // Cap increase with an idle backend and full waiter list otherwise waits
  // for a release that may never come — pump on config change.
  storage.watch<boolean>("sync:auto-translate", () => {
    void getBackendCap().then(pumpBackendQueue);
  });
  storage.watch<number>("sync:auto-translate-concurrency", () => {
    void getBackendCap().then(pumpBackendQueue);
  });

  // Route heavy inference to its dedicated context and return the result.
  // - Chrome (MV3): the offscreen document (offscreen API).
  // - Firefox (MV2, no offscreen API): offscreen.html in a hidden iframe
  //   inside the persistent background page (see ensureFirefoxInferencePage).
  //   background.js itself stays free of inference code so every emitted .js
  //   stays under the AMO validation limit.
  function forwardToInference(message: unknown): Promise<unknown> {
    const forward = () => browser.runtime.sendMessage(message);
    if (hasOffscreenApi()) {
      return ensureOffscreen()
        .then(forward)
        .catch(async () => {
          // Offscreen may be dead (e.g. CSP crash) - recreate and retry once.
          await browser.offscreen.closeDocument().catch(() => {});
          await ensureOffscreen();
          return forward();
        });
    }
    return ensureFirefoxInferencePage().then(forward);
  }

  async function openSetupTabInBackground(modelId?: string, clean?: boolean) {    let targetUrl = browser.runtime.getURL("/setup.html");
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

  browser.runtime.onInstalled.addListener(async (details) => {
    await storage.setItem("local:active-device", await detectHardware());
    if (details.reason === "install") {
      openSetupTabInBackground();
    }
  });

  browser.runtime.onMessage.addListener((msg, _, sendResponse) => {
    const respond = createAsyncResponder(sendResponse);
    const respondErr = (err: unknown) =>
      respond({ error: (err as Error).message ?? String(err) });

    // Proxy image fetch for cross-origin or hotlink-protected images (Cloudflare, Referer checks).
    // Uses declarativeNetRequest to inject the proper Referer so CDNs accept the request,
    // then converts to base64 data URL to completely bypass CORS/network downstream.
    if (msg.type === "PROXY_IMAGE") {
      const { url, referer } = msg.data ?? {};
      if (!url || !isAllowedImageUrl(url, referer)) {
        respondErr(new Error("Security rejection: Disallowed or unsafe image URL"));
        return true;
      }
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

    // Forwarding heavy inference to the offscreen document.
    // Serialized through the unified backend semaphore: queued jobs wait
    // for a slot BEFORE the execution timeout starts, so queue wait never
    // consumes the per-job budget.
    if (
      ["DETECT_BBOX", "TRANSLATE_IMAGE", "MAKE_SITE_RULE_AI", "INPAINT_IMAGE"].includes(
        msg.type,
      )
    ) {
      // Quality (LaMa) runs on wasm CPU (~30s+ per 512px tile), so a Quality
      // inpaint over N regions needs a per-region budget, not a flat page budget.
      const inpaintBoxes = Array.isArray(msg.data?.bboxes)
        ? msg.data.bboxes.length
        : 0;
      const timeoutMs =
        msg.type === "INPAINT_IMAGE" && msg.data?.method === "quality"
          ? Math.max(300_000, inpaintBoxes * 60_000)
          : msg.type === "TRANSLATE_IMAGE" || msg.type === "INPAINT_IMAGE"
            ? 180_000
            : 90_000;

      const forward = () =>
        forwardToInference({
          ...msg,
          type: `OFFSCREEN_${msg.type}`,
        });

      const run = async () => {
        const release = await acquireBackendSlot();
        try {
          return await withTimeout(
            forward(),
            timeoutMs,
            msg.type,
          );
        } finally {
          release();
        }
      };

      keepAliveWhile(run().then(respond).catch(respondErr));

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
            // Snapshot keys once. Invalid entries are collected here and
            // deleted in a single pass after the scan — never mutate the
            // cache while iterating it (delete() used to run inside this
            // loop, racing the trailing empty-cache check).
            const requests = await cache.keys();
            const toDelete: Request[] = [];
            let survivors = 0;
            for (const req of requests) {
              const url = req.url;
              let size = 0;
              let valid: boolean;
              try {
                const resp = await cache.match(req);
                if (!resp || !resp.ok) {
                  valid = false;
                } else {
                  const blob = await resp.blob();
                  size = blob?.size ?? 0;
                  // < 1 KB is never a valid model weight (0-byte/aborted entry).
                  valid = size > 1024;
                }
              } catch {
                valid = false;
              }

              if (!valid) {
                toDelete.push(req);
                continue;
              }
              survivors++;

              let category: "Detection" | "OCR" | "Inpaint" | "Script Gate" | "LLM" | "Other" = "Other";
              let name = url.split("/").pop() ?? url;
              // Set when the cached file is a wllama GGUF: the entry is
              // reported as an LLM (deleted via the inference context, which
              // also unloads it) instead of a raw cache file.
              let llmModelId: string | null = null;

              if (url.includes("lama-manga") || cacheName.includes("lama-manga")) {
                category = "Inpaint";
                name = "LaMa Redraw Model (lama-manga-dynamic.onnx)";
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
              } else if (url.toLowerCase().includes("ppocr") || cacheName.toLowerCase().includes("ppocr")) {
                category = "OCR";
                name = `PP-OCRv6 Manga (${url.split("/").pop()})`;
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

            // Single delete pass. The cache itself is dropped only when the
            // scan found zero survivors — no post-mutation re-read of keys().
            for (const req of toDelete) {
              await cache.delete(req).catch(() => {});
            }
            if (survivors === 0) {
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
            const foundDef = (DefaultConfig.llmModels as { id: string; label: string; vram?: string; engine?: string; bytes?: number }[]).find((m) => m.id === modelId);
            // wllama GGUF models are enumerated from their CacheStorage
            // entry above (real blob size) — skip here to avoid duplicates.
            if (foundDef?.engine === "wllama") continue;
            results.push({
              id: `llm::${modelId}`,
              name: foundDef ? `${foundDef.label} (${modelId})` : modelId,
              category: "LLM",
              size: foundDef?.bytes ?? parseVramToBytes(foundDef?.vram),
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

    // Probe extension-side CacheStorage (service worker partition).
    // Content-world callers (sidebar/overlay shadow UIs) cannot see this
    // partition directly — each browsing context gets its own CacheStorage.
    if (msg.type === "IS_MODEL_CACHED") {
      const task = async () => {
        const entries: { repo: string; path: string }[] = Array.isArray(msg.data?.entries)
          ? msg.data.entries
          : [];
        const results = await Promise.all(
          entries.map(async (e) => {
            try {
              return await isArtifactCached(e.repo, e.path);
            } catch {
              return false;
            }
          }),
        );
        return { results };
      };

      keepAliveWhile(task().then(respond).catch(respondErr));
      return true;
    }

    // HEAD-compare each non-LLM cached artifact against remote, one-by-one.
    // Same `x-repo-commit || etag` protocol the old per-model autoUpdate used.
    if (msg.type === "CHECK_MODEL_UPDATES") {
      const task = async () => {
        const cacheNames = await caches.keys();
        const updates: { cacheName: string; url: string }[] = [];
        const skipped: string[] = [];
        let checked = 0;
        for (const cacheName of cacheNames) {
          const cache = await caches.open(cacheName);
          const requests = await cache.keys();
          for (const req of requests) {
            const url = req.url;
            try {
              const resp = await cache.match(req);
              if (!resp || !resp.ok) continue;
              const blob = await resp.blob();
              if ((blob?.size ?? 0) <= 1024) continue;
            } catch {
              continue;
            }
            checked++;
            const { hasUpdate, skipped: wasSkipped } = await checkArtifactUpdate(cacheName, url);
            if (hasUpdate) updates.push({ cacheName, url });
            else if (wasSkipped) skipped.push(url);
          }
        }
        return { updates, checked, skipped };
      };

      keepAliveWhile(task().then(respond).catch(respondErr));
      return true;
    }

    // Force re-download one cached artifact (unconditional GET + SHA gate).
    if (msg.type === "UPDATE_CACHED_MODEL") {
      const task = async () => {
        const { cacheName, url } = msg.data ?? {};
        if (!cacheName || !url) throw new Error("Invalid update request payload");
        await forceRefreshArtifact(cacheName, url);
        return { success: true };
      };

      keepAliveWhile(task().then(respond).catch(respondErr));
      return true;
    }

    // Delete a single cached model or file
    if (msg.type === "DELETE_CACHED_MODEL") {
      const task = async () => {
        const { isLlm, modelId, cacheName, url } = msg.data;
        if (isLlm && modelId) {
          await forwardToInference({
            type: "OFFSCREEN_DELETE_LLM_CACHE",
            data: { modelId },
          });
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
          if (hasOffscreenApi()) {
            await ensureOffscreen().catch(() => {});
          } else {
            await ensureFirefoxInferencePage().catch(() => {});
          }
          for (const modelId of cachedLlms) {
            await browser.runtime.sendMessage({
              type: "OFFSCREEN_DELETE_LLM_CACHE",
              data: { modelId },
            }).catch(() => {});
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
      const task = forwardToInference({
        type: "OFFSCREEN_DELETE_LLM_CACHE",
        data: { modelId: msg.data?.modelId },
      })
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

    // Acked model download with progress (LMT-native, MIT-only)
    // START_MODEL_DOWNLOAD {modelId, category} is the new explicit contract;
    // PREFETCH_MODEL {type,data} remains as alias for legacy callers (Sidebar/Popup).
    if (msg.type === "START_MODEL_DOWNLOAD") {
      const { modelId, category } = msg.data ?? {};
      const run = async () => {
        if (!modelId) throw new Error("Missing modelId");
        const cat = category ?? "ocr";
        // Reuse PREFETCH_MODEL mapping
        let prefetch: { type: string; data: string };
        if (cat === "detection") prefetch = { type: "detection", data: modelId };
        else if (cat === "inpaint") prefetch = { type: "inpaint", data: modelId };
        else prefetch = { type: "ocr", data: modelId === "manga-ocr" || modelId === "ppocrv6-manga" ? modelId : modelId };
        // Delegate to offscreen when possible, else direct download
        try {
          const res = await forwardToInference({ type: "OFFSCREEN_PREFETCH_MODEL", data: prefetch }) as any;
          if (res?.error) throw new Error(res.error);
        } catch {
          // Fallback: direct background download (CacheStorage accessible here)
          const { type, data } = prefetch;
          if (type === "inpaint") {
            await downloadArtifactHF(DefaultConfig.lamaRepo, DefaultConfig.lamaModelPath, true);
          } else if (type === "ocr") {
            if (data === "manga-ocr") {
              await Promise.all([
                downloadArtifactHF(DefaultConfig.mangaOcrRepo, "encoder_model.onnx", true),
                downloadArtifactHF(DefaultConfig.mangaOcrRepo, "decoder_model.onnx", true),
                downloadArtifactHF(DefaultConfig.mangaOcrRepo, "vocab.txt", true),
              ]);
            } else if (data === "ppocrv6-manga") {
              await downloadArtifactHF(env.ppocrv6MangaRepo, "ppocr-rec-v6-small-manga.onnx", true);
            } else {
              const raw = data && data !== "paddle" ? String(data) : "";
              const lang = !raw ? "chinese" : (SUPPORTED_LANG_GROUPS as readonly string[]).includes(raw) ? raw : resolveLangGroup(raw).group;
              await downloadArtifactHF(DefaultConfig.ocrRepo, DefaultConfig.ocrModelPath(lang), true);
              await downloadArtifactHF(DefaultConfig.ocrRepo, DefaultConfig.ocrDictPath(lang), true);
            }
          } else if (type === "detection") {
            const detId = normalizeDetectionModel(data);
            if (detId === "comic-bubble") await downloadArtifactHF(DefaultConfig.rtdetrModelRepo, "detector-v4-s_int8.onnx", true);
            else if (detId === "comic-text-detector") await downloadArtifactHF("direct-model-cache", DefaultConfig.comicTextDetectorUrl, true);
            else throw new Error(UNKNOWN_DETECTION_MODEL_MESSAGE(detId));
          }
        }
        return { success: true, status: "ready" as const, progress: 1 };
      };
      keepAliveWhile(
        run()
          .then((r) => {
            // Best-effort broadcast to popups/sidebars
            try {
              browser.runtime.sendMessage({ type: "MODEL_DOWNLOAD_PROGRESS", payload: { modelId, progress: 1, status: "ready" } }).catch(() => {});
            } catch {}
            respond(r);
          })
          .catch(respondErr),
      );
      return true;
    }

    if (msg.type === "GPU_STATE_CHANGED") {
      keepAliveWhile(
        (async () => {
          try {
            await forwardToInference({ type: "OFFSCREEN_GPU_STATE_CHANGED", data: msg.data }).catch(() => {});
          } catch {}
          return { success: true };
        })().then(respond).catch(respondErr),
      );
      return true;
    }

    if (msg.type === "CHECK_WEBGPU_SUPPORT") {
      const task = (async () => {
        try {
          const res = await forwardToInference({ type: "OFFSCREEN_CHECK_WEBGPU_SUPPORT", data: msg.data }) as any;
          if (res && typeof res.supported === "boolean") return res;
        } catch {}
        // Fallback: no GPU in service worker context
        return { supported: false };
      })();
      keepAliveWhile(task.then(respond).catch(respondErr));
      return true;
    }

    if (msg.type === "GET_MODEL_STATUSES") {
      const task = (async () => {
        const ids: string[] = Array.isArray(msg.data?.modelIds) ? msg.data.modelIds : [];
        // Best-effort: ask offscreen; fallback to local cache probes
        try {
          const res = await forwardToInference({ type: "OFFSCREEN_GET_MODEL_STATUSES", data: { modelIds: ids } }) as any;
          if (res?.statuses) return { success: true, statuses: res.statuses, downloads: res.downloads ?? {} };
        } catch {}
        return { success: true, statuses: {}, downloads: {} };
      })();
      keepAliveWhile(task.then(respond).catch(respondErr));
      return true;
    }

    // Real WebLLM weight presence via offscreen `hasModelInCache`.
    // `local:cached-llms` alone is stale-prone (written once at setup
    // download, never re-validated). Callers intersect list ∩ probe.
    if (msg.type === "LLM_CACHE_STATUS") {
      const task = (async () => {
        const ids: string[] = Array.isArray(msg.data?.modelIds) ? msg.data.modelIds : [];
        try {
          const res = await forwardToInference({ type: "OFFSCREEN_LLM_CACHE_STATUS", data: { modelIds: ids } }) as any;
          if (res?.statuses) return { success: true, statuses: res.statuses };
          if (res?.error) throw new Error(res.error);
        } catch (err) {
          return { success: false, error: (err as Error)?.message ?? String(err) };
        }
        const empty: Record<string, boolean> = {};
        for (const id of ids) empty[id] = false;
        return { success: true, statuses: empty };
      })();
      keepAliveWhile(task.then(respond).catch(respondErr));
      return true;
    }

    if (msg.type === "GET_ACTIVE_DOWNLOADS") {
      const task = (async () => {
        try {
          const res = await forwardToInference({ type: "OFFSCREEN_GET_ACTIVE_DOWNLOADS" }) as any;
          if (res?.downloads) return { success: true, downloads: res.downloads };
        } catch {}
        return { success: true, downloads: {} };
      })();
      keepAliveWhile(task.then(respond).catch(respondErr));
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
            true,
          );
        } else if (type === "ocr") {
          if (data === "manga-ocr") {
            await Promise.all([
              downloadArtifactHF(DefaultConfig.mangaOcrRepo, "encoder_model.onnx", true),
              downloadArtifactHF(DefaultConfig.mangaOcrRepo, "decoder_model.onnx", true),
              downloadArtifactHF(DefaultConfig.mangaOcrRepo, "vocab.txt", true),
            ]);
          } else if (data === "ppocrv6-manga") {
            // Fixed-file engine with a bundled dict — onnx only.
            await downloadArtifactHF(env.ppocrv6MangaRepo, "ppocr-rec-v6-small-manga.onnx", true);
          } else {
            // `data` is usually a resolved lang group from the popup; accept a
            // language name too. Missing/unknown stays "chinese" (CJK focus).
            const raw = data && data !== "paddle" ? String(data) : "";
            const lang = !raw
              ? "chinese"
              : (SUPPORTED_LANG_GROUPS as readonly string[]).includes(raw)
                ? raw
                : resolveLangGroup(raw).group;
            await downloadArtifactHF(DefaultConfig.ocrRepo, DefaultConfig.ocrModelPath(lang), true);
            await downloadArtifactHF(DefaultConfig.ocrRepo, DefaultConfig.ocrDictPath(lang), true);
          }
        } else if (type === "detection") {
          const detId = normalizeDetectionModel(data);
          if (detId === "comic-bubble") {
            await downloadArtifactHF(DefaultConfig.rtdetrModelRepo, "detector-v4-s_int8.onnx", true);
          } else if (detId === "comic-text-detector") {
            await downloadArtifactHF(
              "direct-model-cache",
              DefaultConfig.comicTextDetectorUrl,
              true,
            );
          } else {
            throw new Error(UNKNOWN_DETECTION_MODEL_MESSAGE(detId));
          }
        }
        return { success: true };
      };

      keepAliveWhile(runPrefetch().then(respond).catch(respondErr));

      return true;
    }
  });
});
