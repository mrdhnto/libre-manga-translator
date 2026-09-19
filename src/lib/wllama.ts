import type { Wllama } from "@wllama/wllama";
import { DefaultConfig, type LlmModelDef } from "./configs";
import { buildSiteRulePrompts, buildTranslationPrompts } from "./prompts";
import { fetchAndCacheWithProgress } from "./utils";
// Bundled at build time (8.4MB .wasm asset, not .js — outside the AMO
// 2MB-per-.js rule). Never the CDN variant (remote code is rejected).
import wllamaWasmUrl from "@wllama/wllama/src/wasm/wllama.wasm?url";

// Dynamic-only, same as webllm.ts: keeps the engine out of initial chunks.
const loadWllama = () => import("@wllama/wllama");

let wllama: Wllama | null = null;
let loadedModelId: string | null = null;

export function ggufUrl(def: LlmModelDef): string {
  return `https://huggingface.co/${def.repo}/resolve/main/${def.file}`;
}

async function cachedGgufBlob(def: LlmModelDef): Promise<Blob | null> {
  try {
    const cache = await caches.open(def.repo as string);
    const res = await cache.match(ggufUrl(def));
    if (!res || !res.ok) return null;
    const blob = await res.blob();
    return blob.size > 1024 ? blob : null;
  } catch {
    return null;
  }
}

/** Load can stall silently (blocked worker, slow ingest) — fail loudly instead. */
const LOAD_TIMEOUT_MS = 10 * 60 * 1000;

async function ensureWllama(
  def: LlmModelDef,
  onProgress?: (loaded: number, total: number) => void,
  onStage?: (text: string) => void,
): Promise<Wllama> {
  if (wllama && loadedModelId === def.id && wllama.isModelLoaded()) {
    return wllama;
  }
  if (wllama) {
    try {
      await wllama.exit();
    } catch {
      // ignore teardown errors when switching models
    }
    wllama = null;
    loadedModelId = null;
  }
  onStage?.("Starting runtime…");
  const { Wllama: WllamaClass, LoggerWithoutDebug } = await loadWllama();
  const instance = new WllamaClass({ default: wllamaWasmUrl }, {
    logger: LoggerWithoutDebug,
    suppressNativeLog: true,
  });

  onStage?.("Reading cached model…");
  let blob = await cachedGgufBlob(def);
  if (!blob) {
    await fetchAndCacheWithProgress(
      def.repo as string,
      def.file as string,
      onProgress,
    );
    blob = await cachedGgufBlob(def);
    if (!blob) throw new Error("GGUF download produced no cached file");
  }

  onStage?.("Loading weights into memory — first run takes minutes…");
  const params = { n_ctx: 4096 };
  const load = (async () => {
    try {
      await instance.loadModel([blob], { ...params, n_gpu_layers: 999999 });
    } catch (err) {
      // WebGPU-by-default builds can fail where WebGPU is unavailable or
      // blocked: retry pure CPU before giving up.
      const msg = (err as Error)?.message ?? "";
      if (/webgpu|gpu|dawn/i.test(msg)) {
        await instance.loadModel([blob], { ...params, n_gpu_layers: 0 });
      } else {
        throw err;
      }
    }
  })();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new Error(
            "GGUF load timed out after 10 minutes — check the setup-tab console for worker/CSP errors",
          ),
        ),
      LOAD_TIMEOUT_MS,
    );
  });
  try {
    await Promise.race([load, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
  wllama = instance;
  loadedModelId = def.id;
  return instance;
}

/** Explicit download step for setup UI (progress) — reuses the shared model cache. */
export async function downloadWllamaModel(
  def: LlmModelDef,
  onProgress?: (loaded: number, total: number) => void,
  onStage?: (text: string) => void,
): Promise<void> {
  await ensureWllama(def, onProgress, onStage);
}

export async function deleteWllamaCache(def: LlmModelDef): Promise<void> {
  if (wllama && loadedModelId === def.id) {
    try {
      await wllama.exit();
    } catch {
      // ignore teardown errors
    }
    wllama = null;
    loadedModelId = null;
  }
  try {
    const cache = await caches.open(def.repo as string);
    await cache.delete(ggufUrl(def));
  } catch {
    // cache already gone — nothing to do
  }
}

export function isWllamaModelLoaded(id: string): boolean {
  return !!wllama && loadedModelId === id && wllama.isModelLoaded();
}

export interface WllamaGpuCapability {
  ok: boolean;
  reason: "webgpu-ready" | "no-navigator-gpu" | "no-jspi" | "no-adapter";
  /** human-readable cause, persisted to the debug log when WebGPU is unusable */
  detail: string;
}

/**
 * Pre-check whether this browser can run wllama on WebGPU. The three
 * probes mirror @wllama/wllama src/utils.ts (isSupportWebGPU /
 * isSupportJSPI) plus an adapter request; they are inlined so the check
 * runs without instantiating Wllama. An adapter alone is NOT enough on
 * Firefox: without JSPI wllama disables WebGPU and falls back to CPU.
 */
export async function canUseWllamaWebGPU(): Promise<WllamaGpuCapability> {
  if (!(navigator as any)?.gpu) {
    return {
      ok: false,
      reason: "no-navigator-gpu",
      detail: "navigator.gpu missing — enable dom.webgpu.enabled in about:config",
    };
  }
  if (!(WebAssembly as any)?.Suspending) {
    return {
      ok: false,
      reason: "no-jspi",
      detail:
        "WebAssembly.Suspending (JSPI) missing — enable javascript.options.wasm_js_promise_integration in about:config",
    };
  }
  try {
    const adapter = await (navigator as any).gpu.requestAdapter();
    if (!adapter) {
      return {
        ok: false,
        reason: "no-adapter",
        detail: "navigator.gpu present but requestAdapter() returned null",
      };
    }
  } catch (e) {
    return {
      ok: false,
      reason: "no-adapter",
      detail: `requestAdapter() threw: ${(e as Error)?.message ?? String(e)}`,
    };
  }
  return { ok: true, reason: "webgpu-ready", detail: "WebGPU adapter + JSPI available" };
}

async function runWllamaModel(
  systemPrompt: string,
  userPrompt: string,
  schema: string,
  def: LlmModelDef,
  temperature = DefaultConfig.llmTemperature,
) {
  const instance = await ensureWllama(def);
  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ] as { role: "system" | "user" | "assistant"; content: string }[];

  // Disable Qwen thinking mode when the template supports it; harmless otherwise.
  let chat_template_kwargs: Record<string, unknown> | undefined;
  try {
    const tpl = instance.getChatTemplate() ?? "";
    if (tpl.includes("thinking")) chat_template_kwargs = { enable_thinking: false };
  } catch {
    // template unreadable — proceed without kwargs
  }

  const parsedSchema = JSON.parse(schema);
  const attempts: ({ type: "json_schema" } | { type: "json_object" } | null)[] =
    [
      { type: "json_schema" },
      { type: "json_object" },
      null, // unconstrained fallback; cleanup + JSON.parse below still applies
    ];
  let resultText = "";
  let llmPerf: LlmPerf | undefined;
  let lastErr: unknown = null;
  for (const mode of attempts) {
    try {
      const t0 = performance.now();
      const reply = await instance.createChatCompletion({
        messages,
        temperature,
        max_tokens: 1024,
        timings_per_token: true,
        ...(chat_template_kwargs ? { chat_template_kwargs } : {}),
        ...(mode === null
          ? {}
          : mode.type === "json_schema"
            ? {
                response_format: {
                  type: "json_schema",
                  json_schema: {
                    name: "translation",
                    schema: parsedSchema,
                  },
                },
              }
            : { response_format: { type: "json_object" } }),
      });
      llmPerf = extractWllamaPerf(reply, performance.now() - t0);
      resultText = reply.choices[0].message.content as string;
      break;
    } catch (err) {
      lastErr = err;
    }
  }
  if (!resultText) throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));

  try {
    const cleanJsonString = resultText
      .replace(/^```(?:json)?/im, "")
      .replace(/```$/im, "")
      .trim();

    const parsed = JSON.parse(cleanJsonString);
    if (llmPerf && typeof parsed === "object" && parsed !== null) {
      (parsed as TranslateResult).llmPerf = llmPerf;
    }
    return parsed;
  } catch (error) {
    console.error("Failed to parse LLM output:", resultText);
    throw new Error("Local LLM generated invalid JSON");
  }
}

/**
 * Token stats for one wllama request. The non-streaming response type
 * carries usage but no timings, so prefer the llama-server timings block
 * when the runtime includes it and fall back to wall-clock decode rate.
 */
function extractWllamaPerf(reply: unknown, totalMs: number): LlmPerf | undefined {
  const raw = reply as unknown as {
    usage?: { prompt_tokens?: number; completion_tokens?: number };
    timings?: {
      prompt_n?: number;
      predicted_n?: number;
      prompt_ms?: number;
      predicted_ms?: number;
      prompt_per_second?: number;
      predicted_per_second?: number;
    };
  };
  const usage = raw?.usage;
  const t = raw?.timings;
  if (!usage && !t) return undefined;
  const promptTokens = usage?.prompt_tokens ?? t?.prompt_n;
  const completionTokens = usage?.completion_tokens ?? t?.predicted_n;
  const promptTps = t?.prompt_per_second;
  const genTps = t?.predicted_per_second ??
    (totalMs > 0 && completionTokens
      ? completionTokens / (totalMs / 1000)
      : undefined);
  return {
    ...(promptTokens !== undefined ? { promptTokens } : {}),
    ...(completionTokens !== undefined ? { completionTokens } : {}),
    ...(t?.prompt_ms !== undefined ? { promptMs: t.prompt_ms } : {}),
    ...(t?.predicted_ms !== undefined ? { genMs: t.predicted_ms } : {}),
    ...(promptTps !== undefined ? { promptTps } : {}),
    ...(genTps !== undefined ? { genTps } : {}),
    totalMs,
  };
}

export async function translateWithWllama(
  ocrResults: string[],
  targetLang: string,
  sourceLang: string,
  seriesContext?: SeriesContext,
  model?: string,
  temperature = DefaultConfig.llmTemperature,
): Promise<TranslateResult> {
  if (!ocrResults || ocrResults.length === 0) {
    return { translations: [] };
  }
  const def = (DefaultConfig.llmModels as LlmModelDef[]).find(
    (m) => m.id === model,
  ) ?? (DefaultConfig.llmModels as LlmModelDef[])[0];

  const { systemPrompt, userPrompt, schema } = buildTranslationPrompts(
    ocrResults,
    targetLang,
    sourceLang,
    seriesContext,
  );

  return await runWllamaModel(systemPrompt, userPrompt, schema, def, temperature);
}

export async function makeSiteRuleWithWllama(
  title: string,
  path: string,
  model?: string,
  temperature = DefaultConfig.llmTemperature,
): Promise<AIGeneratedRule> {
  const def = (DefaultConfig.llmModels as LlmModelDef[]).find(
    (m) => m.id === model,
  ) ?? (DefaultConfig.llmModels as LlmModelDef[])[0];
  const { systemPrompt, userPrompt, schema } = buildSiteRulePrompts(
    title,
    path,
  );

  return await runWllamaModel(systemPrompt, userPrompt, schema, def, temperature);
}
