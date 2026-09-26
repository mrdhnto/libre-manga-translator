// Shared heavy-inference handlers. Executed in the offscreen document on
// Chrome (MV3, via OFFSCREEN_* messages) and in offscreen.html hosted in a
// hidden background-page iframe on Firefox (MV2 has no offscreen API — see
// ensureFirefoxInferencePage). This module must never be statically imported
// by the background or content-script entries: it pulls onnxruntime-web and
// the full detection/OCR/inpaint pipeline, which would bust the single-file
// AMO size limit. Keep it free of CSS imports and DOM-at-import-time side
// effects so it stays clean in both hosts.
import { UNKNOWN_DETECTION_MODEL_MESSAGE, detectTextBubble } from "./detections/main";
import { makeSiteRuleWithGemini, translateWithGemini } from "./gemini/main";
import { textRecognise } from "./ocr/main";
import {
  makeSiteRuleWithServer,
  translateWithServer,
} from "./server/main";
// NOTE: @mlc-ai/web-llm must stay dynamically imported (see webllm.ts and
// the FIREFOX gates below). A static import would bake the multi-MB
// prebundled file into shared initial chunks and break the 2MB-per-.js
// Firefox AMO limit. Same for @wllama/wllama (lib/wllama.ts).
import { makeSiteRuleLocal, translateLocal } from "./webllm";
import type { WllamaGpuCapability } from "./wllama";
import { DefaultConfig, SUPPORTED_LANG_GROUPS, llmModelDef, normalizeDetectionModel, resolveLangGroup } from "./configs";
import { env } from "./env";
import { checkWebGPUHighPerf, ensureWasmPaths } from "./hardware";
import { downloadArtifactHF, yieldToMain } from "./utils";
import { inpaintImageAuto, inpaintImageQuality } from "./inpaint/ladder";
import { getCachedSegmentation } from "./detections/segmentation";

async function translateLocalRouted(
  ocrTexts: string[],
  targetLang: string,
  sourceLang: string,
  seriesContext: SeriesContext | undefined,
  llmModel: string,
  llmTemperature: number,
): Promise<TranslateResult> {
  const def = llmModelDef(llmModel);
  // FIREFOX-gated so Chrome builds drop the wllama chunk + wasm entirely
  // (dead-branch elimination at build time); mirrored in webllm.ts/setup.
  if (def.engine === "wllama" && import.meta.env.FIREFOX) {
    const { translateWithWllama } = await import("./wllama");
    return translateWithWllama(
      ocrTexts,
      targetLang,
      sourceLang,
      seriesContext,
      def.id,
      llmTemperature,
    );
  }
  return translateLocal(
    ocrTexts,
    targetLang,
    sourceLang,
    seriesContext,
    def.id,
    llmTemperature,
  );
}

async function makeSiteRuleLocalRouted(
  title: string,
  path: string,
  llmModel: string,
  llmTemperature: number,
): Promise<AIGeneratedRule> {
  const def = llmModelDef(llmModel);
  if (def.engine === "wllama" && import.meta.env.FIREFOX) {
    const { makeSiteRuleWithWllama } = await import("./wllama");
    return makeSiteRuleWithWllama(title, path, def.id, llmTemperature);
  }
  return makeSiteRuleLocal(title, path, def.id, llmTemperature);
}

async function detectBackend(): Promise<{ backend: "webgpu" | "wasm"; reason?: string }> {
  try {
    if ("gpu" in navigator) {
      const adapter = await (navigator.gpu as any).requestAdapter({ powerPreference: "high-performance" });
      if (adapter) return { backend: "webgpu" };
      return {
        backend: "wasm",
        reason: "navigator.gpu present but requestAdapter() returned null",
      };
    }
    return { backend: "wasm", reason: "navigator.gpu missing in inference context" };
  } catch (e) {
    return {
      backend: "wasm",
      reason: `adapter probe threw: ${(e as Error)?.message ?? String(e)}`,
    };
  }
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

export async function handleDetectBbox(msg: any): Promise<Bbox[]> {
  const { detectionModel, detectionMinConfidence } = msg.config;
  await yieldToMain();
  return detectTextBubble(msg.data, detectionMinConfidence, detectionModel);
}

export async function handleTranslateImage(msg: any): Promise<unknown> {
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
    await yieldToMain();
    const tOcr = performance.now();
    const def = llmModelDef(llmModel);
    // wllama-only WebGPU capability probe (Firefox builds), started before
    // OCR so it resolves during inference instead of adding latency. The
    // branch stays FIREFOX-gated so Chrome builds drop the wllama chunk
    // entirely (dead-branch elimination at build time); the engine check
    // additionally skips it for stale webllm prefs on Firefox profiles.
    let gpuProbe: Promise<WllamaGpuCapability> | null = null;
    if (def.engine === "wllama" && import.meta.env.FIREFOX) {
      gpuProbe = import("./wllama").then((m) => m.canUseWllamaWebGPU());
    }
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
    const gpu = gpuProbe ? await gpuProbe : null;
    const backendRes = await detectBackend();
    // On Firefox the wllama probe is authoritative: an adapter without
    // JSPI still can't run WebGPU inference (wllama disables it), so a
    // "webgpu" adapter reading must not mask the real fallback cause.
    const backend = gpu && !gpu.ok ? "wasm" : backendRes.backend;
    let gpuUnavailableReason: string | undefined;
    if (backend === "wasm") {
      if (gpu && !gpu.ok) {
        // Firefox wllama path: about:config-specific detail.
        gpuUnavailableReason = gpu.detail;
      } else if (def.engine === "wllama") {
        gpuUnavailableReason = backendRes.reason;
      } else if (import.meta.env.FIREFOX) {
        gpuUnavailableReason =
          backendRes.reason ?? "WebGPU unavailable in this context";
      } else {
        // Chrome build (WebLLM owns GPU init): actionable hint.
        gpuUnavailableReason = backendRes.reason
          ? `${backendRes.reason} — check chrome://gpu`
          : "WebGPU unavailable in this context — check chrome://gpu";
      }
    }
    const tTrans = performance.now();
    const res = await translateLocalRouted(
      ocrResults.map((r) => (r.gateSkip ? "" : r.text)),
      targetLang,
      sourceLang,
      seriesContext,
      llmModel,
      llmTemperature,
    );
    return {
      ...res,
      sourceTexts: ocrResults.map((r) => r.text),
      gateSkip: ocrResults.map((r) => r.gateSkip ?? null),
      gate: ocrOut.gate,
      timing: { ocr, translate: performance.now() - tTrans },
      backend,
      ...(gpuUnavailableReason ? { gpuUnavailableReason } : {}),
    };
  } else if (currentMode === "api") {
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
    return {
      ...res,
      sourceTexts: ocrResults.map((r) => r.text),
      gateSkip: ocrResults.map((r) => r.gateSkip ?? null),
      gate: ocrOut.gate,
    };
  }
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
}

export async function handleMakeSiteRule(msg: any): Promise<unknown> {
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
    return makeSiteRuleLocalRouted(title, path, llmModel, llmTemperature);
  } else if (currentMode === "api") {
    return makeSiteRuleWithServer(title, path, serverConfig(msg.config));
  }
  return makeSiteRuleWithGemini(title, path, geminiKey, geminiModel, llmTemperature);
}

export async function handleInpaintImage(msg: any): Promise<unknown> {
  const { src, bboxes, method } = msg.data;
  const segmentation = getCachedSegmentation(src);

  // "quality": standalone LaMa-first pass with Fast fallback per region.
  // Anything else normalizes to the Fast ladder (no model rung).
  await yieldToMain();
  return method === "quality"
    ? inpaintImageQuality(src, bboxes, { segmentation })
    : inpaintImageAuto(src, bboxes, { segmentation });
}

export async function handleDeleteLlmCache(msg: any): Promise<{ success: true }> {
  const def = llmModelDef(msg.data.modelId);
  if (def.engine === "wllama" && import.meta.env.FIREFOX) {
    const { deleteWllamaCache } = await import("./wllama");
    await deleteWllamaCache(def);
  } else if (!import.meta.env.FIREFOX) {
    // Gated so Firefox builds drop the 6MB web-llm chunk entirely
    // (dead-branch elimination at build time).
    const { deleteModelAllInfoInCache } = await import("@mlc-ai/web-llm");
    await deleteModelAllInfoInCache(msg.data.modelId);
  } else {
    throw new Error("web-llm backend excluded from Firefox builds");
  }
  return { success: true };
}

export async function handleCheckWebgpuSupport(): Promise<{ supported: boolean }> {
  ensureWasmPaths();
  return { supported: await checkWebGPUHighPerf() };
}

export async function handleGpuStateChanged(): Promise<{ success: true }> {
  // Invalidate any cached provider-keyed sessions (OCR/Inpaint will recreate on next use).
  // Best-effort: just acknowledge; actual recreate happens lazily in the next inference.
  return { success: true };
}

export async function handlePrefetchModel(msg: any): Promise<{ success: true }> {
  const { type, data } = msg.data ?? {};
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
}

export async function handleLlmCacheStatus(msg: any): Promise<{ statuses: Record<string, boolean> }> {
  const ids: string[] = Array.isArray(msg.data?.modelIds) ? msg.data.modelIds : [];
  const statuses: Record<string, boolean> = {};
  await Promise.all(
    ids.map(async (id) => {
      try {
        const def = llmModelDef(id);
        if (def.engine === "wllama" && import.meta.env.FIREFOX) {
          const { isWllamaModelCached } = await import("./wllama");
          // def falls back to the build default on stale ids — only report
          // true when the requested id itself is a known wllama model.
          statuses[id] = def.id === id ? await isWllamaModelCached(def) : false;
        } else if (!import.meta.env.FIREFOX) {
          // Gated so Firefox builds drop the web-llm chunk entirely.
          const { hasModelInCache } = await import("@mlc-ai/web-llm");
          statuses[id] = await hasModelInCache(id);
        } else {
          statuses[id] = false;
        }
      } catch {
        statuses[id] = false;
      }
    }),
  );
  return { statuses };
}

export async function handleGetModelStatuses(): Promise<{ statuses: Record<string, never>; downloads: Record<string, never> }> {
  // Best-effort: report empty but success so background can fallback to local probes.
  return { statuses: {}, downloads: {} };
}

export async function handleGetActiveDownloads(): Promise<{ downloads: Record<string, never> }> {
  return { downloads: {} };
}

export async function handleOffscreenMessage(msg: any): Promise<unknown> {
  switch (msg.type) {
    case "OFFSCREEN_DETECT_BBOX":
      return handleDetectBbox(msg);
    case "OFFSCREEN_TRANSLATE_IMAGE":
      return handleTranslateImage(msg);
    case "OFFSCREEN_MAKE_SITE_RULE_AI":
      return handleMakeSiteRule(msg);
    case "OFFSCREEN_INPAINT_IMAGE":
      return handleInpaintImage(msg);
    case "OFFSCREEN_DELETE_LLM_CACHE":
      return handleDeleteLlmCache(msg);
    case "OFFSCREEN_CHECK_WEBGPU_SUPPORT":
      return handleCheckWebgpuSupport();
    case "OFFSCREEN_GPU_STATE_CHANGED":
      return handleGpuStateChanged();
    case "OFFSCREEN_PREFETCH_MODEL":
      return handlePrefetchModel(msg);
    case "OFFSCREEN_LLM_CACHE_STATUS":
      return handleLlmCacheStatus(msg);
    case "OFFSCREEN_GET_MODEL_STATUSES":
      return handleGetModelStatuses();
    case "OFFSCREEN_GET_ACTIVE_DOWNLOADS":
      return handleGetActiveDownloads();
    default:
      throw new Error(`Unknown offscreen message: ${msg.type}`);
  }
}
