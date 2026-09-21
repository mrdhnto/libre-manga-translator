import { detectTextBubble } from "@/lib/detections/main";
import { makeSiteRuleWithGemini, translateWithGemini } from "@/lib/gemini/main";
import "@/assets/app.css";
import { textRecognise } from "@/lib/ocr/main";
import {
  makeSiteRuleWithServer,
  translateWithServer,
} from "@/lib/server/main";
import { deleteModelAllInfoInCache } from "@mlc-ai/web-llm";
import { makeSiteRuleLocal, translateLocal } from "@/lib/webllm";
import { inpaintImageAuto, inpaintImageQuality } from "@/lib/inpaint/ladder";
import { getCachedSegmentation } from "@/lib/detections/segmentation";

async function detectBackend(): Promise<"webgpu" | "wasm"> {
  try {
    if ("gpu" in navigator) {
      const adapter = await (navigator.gpu as any).requestAdapter();
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
    const { detectionModel, autoUpdateModel, detectionMinConfidence } =
      msg.config;

    detectTextBubble(
      msg.data,
      detectionMinConfidence,
      detectionModel,
      autoUpdateModel,
    )
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
      const tOcr = performance.now();
      textRecognise(
        src,
        bboxes,
        sourceLang,
        ocrMinConfidence,
        undefined,
        undefined,
        undefined,
        gateOptions,
        ocrEngine,
      )
        .then(async (ocrOut) => {
          const ocrResults = ocrOut.results;
          const ocr = performance.now() - tOcr;
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
        })
        .catch((err) => sendResponse({ error: err.message }));
    } else if (currentMode === "api") {
      textRecognise(
        src,
        bboxes,
        sourceLang,
        ocrMinConfidence,
        undefined,
        undefined,
        undefined,
        gateOptions,
        ocrEngine,
      )
        .then((ocrOut) => {
          const ocrResults = ocrOut.results;
          translateWithServer(
            ocrResults.map((r) => (r.gateSkip ? "" : r.text)),
            targetLang,
            sourceLang,
            seriesContext,
            serverConfig(msg.config),
          )
            .then((res) =>
              sendResponse({
                ...res,
                sourceTexts: ocrResults.map((r) => r.text),
                gateSkip: ocrResults.map((r) => r.gateSkip ?? null),
                gate: ocrOut.gate,
              }),
            )
            .catch((err) => sendResponse({ error: err.message }));
        })
        .catch((err) => sendResponse({ error: err.message }));
    } else {
      translateWithGemini(
        src,
        bboxes,
        geminiKey,
        targetLang,
        sourceLang,
        seriesContext,
        geminiModel,
        llmTemperature,
      )
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
    const work: Promise<unknown> =
      method === "quality"
        ? inpaintImageQuality(src, bboxes, { segmentation })
        : inpaintImageAuto(src, bboxes, { segmentation });

    work.then(sendResponse).catch((err) => sendResponse({ error: err.message }));

    return true;
  }

  if (msg.type === "OFFSCREEN_DELETE_LLM_CACHE") {
    deleteModelAllInfoInCache(msg.data.modelId)
      .then(() => sendResponse({ success: true }))
      .catch((err) => sendResponse({ error: err.message }));

    return true;
  }
});
