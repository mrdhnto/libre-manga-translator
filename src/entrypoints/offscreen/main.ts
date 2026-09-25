import { UNKNOWN_DETECTION_MODEL_MESSAGE, detectTextBubble } from "@/lib/detections/main";
import { makeSiteRuleWithGemini, translateWithGemini } from "@/lib/gemini/main";
import "@/assets/app.css";
import { textRecognise } from "@/lib/ocr/main";
import {
  makeSiteRuleWithServer,
  translateWithServer,
} from "@/lib/server/main";
import { deleteModelAllInfoInCache, hasModelInCache } from "@mlc-ai/web-llm";
import { makeSiteRuleLocal, translateLocal } from "@/lib/webllm";
import { inpaintImageAuto, inpaintImageQuality } from "@/lib/inpaint/ladder";
import { getCachedSegmentation } from "@/lib/detections/segmentation";
import { checkWebGPUHighPerf, ensureWasmPaths } from "@/lib/hardware";
import { downloadArtifactHF, yieldToMain } from "@/lib/utils";
import { DefaultConfig, SUPPORTED_LANG_GROUPS, normalizeDetectionModel, resolveLangGroup } from "@/lib/configs";
import { env } from "@/lib/env";

async function detectBackend(): Promise<"webgpu" | "wasm"> {
  try {
    if ("gpu" in navigator) {
      const adapter = await (navigator.gpu as any).requestAdapter({ powerPreference: "high-performance" });
      if (adapter) return "webgpu";
    }
  } catch {
    // fall through to wasm
  }
  return "wasm";
}

function serverConfig(config: Record<string, any>) {
  return {
    serverHost: config.serverHost,
    serverSchema: config.serverSchema,
    serverModel: config.serverModel,
    useServerApiKey: config.useServerApiKey,
    serverApiKey: config.serverApiKey,
    temperature: config.llmTemperature,
  };
}

browser.runtime.onMessage.addListener((msg, _, sendResponse) => {
  if (msg.type === "OFFSCREEN_DETECT_BBOX") {
    const { detectionModel, detectionMinConfidence } = msg.config;

    (async () => {
      await yieldToMain();
      return detectTextBubble(msg.data, detectionMinConfidence, detectionModel);
    })()
      .then(sendResponse)
      .catch((err) => sendResponse({ error: err.message }));

    return true;
  }

  if (msg.type === "OFFSCREEN_TRANSLATE_IMAGE") {
    const {
      currentMode,
      targetLang,
      sourceLang,
      geminiKey,
      geminiModel,
      ocrMinConfidence,
      ocrEngine,
      llmModel,
      llmTemperature,
      serverHost,
      serverSchema,
      serverModel,
      useServerApiKey,
      serverApiKey,
      scriptGate,
      gateForce,
    } = msg.config;
    const { src, bboxes, seriesContext } = msg.data;
    const gateOptions = {
      enabled: scriptGate ?? true,
      force: gateForce ?? false,
    };

    if (currentMode === "webgpu") {
      (async () => {
        await yieldToMain();
        const tOcr = performance.now();
        const ocrOut = await textRecognise(
          src,
          bboxes,
          sourceLang,
          ocrMinConfidence,
          undefined,
          undefined,
          gateOptions,
          ocrEngine,
        );
        const ocrResults = ocrOut.results;
        const ocr = performance.now() - tOcr;
        await yieldToMain();
        const tTrans = performance.now();
        const backend = await detectBackend();
        try {
          const res = await translateLocal(
            ocrResults.map((r) => (r.gateSkip ? "" : r.text)),
            targetLang,
            sourceLang,
            seriesContext,
            llmModel,
            llmTemperature,
          );
          sendResponse({
            ...res,
            sourceTexts: ocrResults.map((r) => r.text),
            gateSkip: ocrResults.map((r) => r.gateSkip ?? null),
            gate: ocrOut.gate,
            timing: { ocr, translate: performance.now() - tTrans },
            backend,
          });
        } catch (err) {
          sendResponse({ error: (err as Error).message });
        }
      })().catch((err) => sendResponse({ error: err.message }));
    } else if (currentMode === "api") {
      (async () => {
        await yieldToMain();
        const ocrOut = await textRecognise(
          src,
          bboxes,
          sourceLang,
          ocrMinConfidence,
          undefined,
          undefined,
          gateOptions,
          ocrEngine,
        );
        await yieldToMain();
        const ocrResults = ocrOut.results;
        const res = await translateWithServer(
          ocrResults.map((r) => (r.gateSkip ? "" : r.text)),
          targetLang,
          sourceLang,
          seriesContext,
          serverConfig(msg.config),
        );
        sendResponse({
          ...res,
          sourceTexts: ocrResults.map((r) => r.text),
          gateSkip: ocrResults.map((r) => r.gateSkip ?? null),
          gate: ocrOut.gate,
        });
      })().catch((err) => sendResponse({ error: err.message }));
    } else {
      (async () => {
        await yieldToMain();
        return translateWithGemini(
          src,
          bboxes,
          geminiKey,
          targetLang,
          sourceLang,
          seriesContext,
          geminiModel,
          llmTemperature,
        );
      })()
        .then(sendResponse)
        .catch((err) => sendResponse({ error: err.message }));
    }

    return true;
  }

  if (msg.type === "OFFSCREEN_MAKE_SITE_RULE_AI") {
    const {
      currentMode,
      geminiKey,
      geminiModel,
      llmModel,
      llmTemperature,
      serverHost,
      serverSchema,
      serverModel,
      useServerApiKey,
      serverApiKey,
    } = msg.config;
    const { title, path } = msg.data;

    if (currentMode === "webgpu") {
      makeSiteRuleLocal(title, path, llmModel, llmTemperature)
        .then(sendResponse)
        .catch((err) => sendResponse({ error: err.message }));
    } else if (currentMode === "api") {
      makeSiteRuleWithServer(title, path, serverConfig(msg.config))
        .then(sendResponse)
        .catch((err) => sendResponse({ error: err.message }));
    } else {
      makeSiteRuleWithGemini(title, path, geminiKey, geminiModel, llmTemperature)
        .then(sendResponse)
        .catch((err) => sendResponse({ error: err.message }));
    }

    return true;
  }

  if (msg.type === "OFFSCREEN_INPAINT_IMAGE") {
    const { src, bboxes, method } = msg.data;
    const segmentation = getCachedSegmentation(src);

    // "quality": standalone LaMa-first pass with Fast fallback per region.
    // Anything else normalizes to the Fast ladder (no model rung).
    (async () => {
      await yieldToMain();
      return method === "quality"
        ? inpaintImageQuality(src, bboxes, { segmentation })
        : inpaintImageAuto(src, bboxes, { segmentation });
    })()
      .then(sendResponse)
      .catch((err) => sendResponse({ error: err.message }));

    return true;
  }

  if (msg.type === "OFFSCREEN_DELETE_LLM_CACHE") {
    deleteModelAllInfoInCache(msg.data.modelId)
      .then(() => sendResponse({ success: true }))
      .catch((err) => sendResponse({ error: err.message }));

    return true;
  }

  if (msg.type === "OFFSCREEN_CHECK_WEBGPU_SUPPORT") {
    ensureWasmPaths();
    checkWebGPUHighPerf()
      .then((supported) => sendResponse({ supported }))
      .catch((err) => sendResponse({ supported: false, error: (err as Error).message }));
    return true;
  }

  if (msg.type === "OFFSCREEN_GPU_STATE_CHANGED") {
    // Invalidate any cached provider-keyed sessions (OCR/Inpaint will recreate on next use).
    // Best-effort: just acknowledge; actual recreate happens lazily in the next inference.
    sendResponse({ success: true });
    return true;
  }

  if (msg.type === "OFFSCREEN_PREFETCH_MODEL") {
    const { type, data } = msg.data ?? {};
    const task = (async () => {
      ensureWasmPaths();
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
      return { success: true };
    })();
    task.then(sendResponse).catch((err) => sendResponse({ error: (err as Error).message }));
    return true;
  }

  if (msg.type === "OFFSCREEN_LLM_CACHE_STATUS") {
    const ids: string[] = Array.isArray(msg.data?.modelIds) ? msg.data.modelIds : [];
    const task = (async () => {
      const statuses: Record<string, boolean> = {};
      await Promise.all(
        ids.map(async (id) => {
          try {
            statuses[id] = await hasModelInCache(id);
          } catch {
            statuses[id] = false;
          }
        }),
      );
      return { statuses };
    })();
    task.then(sendResponse).catch((err) => sendResponse({ error: (err as Error).message }));
    return true;
  }

  if (msg.type === "OFFSCREEN_GET_MODEL_STATUSES") {
    // Best-effort: report empty but success so background can fallback to local probes.
    sendResponse({ statuses: {}, downloads: {} });
    return true;
  }

  if (msg.type === "OFFSCREEN_GET_ACTIVE_DOWNLOADS") {
    sendResponse({ downloads: {} });
    return true;
  }
});
