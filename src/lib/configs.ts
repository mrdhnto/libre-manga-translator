import { env } from "./env";

const ocrLangGroupMap: Record<string, string> = {
  // English
  English: "english",

  // Chinese/Japanese
  Japanese: "chinese",
  "Chinese (Simplified)": "chinese",
  "Chinese (Traditional)": "chinese",

  // Korean & Thai
  Korean: "korean",
  Thai: "thai",
  Greek: "greek",

  // East Slavic
  Russian: "eslav",
  Bulgarian: "eslav",
  Ukrainian: "eslav",
  Belarusian: "eslav",

  // v3 Models (South Asian & Middle Eastern)
  Arabic: "arabic",
  Urdu: "arabic",
  "Persian/Farsi": "arabic",
  Hindi: "hindi",
  Marathi: "hindi",
  Nepali: "hindi",
  Sanskrit: "hindi",
  Tamil: "tamil",
  Telugu: "telugu",

  // All other Latin-based languages will default to "latin" if not explicitly mapped
};

export const DefaultConfig = {
  currentMode: "webgpu",
  activeDevice: "cpu",
  sourceLang: "Auto-Detect",
  targetLang: "English",

  // Translation backends: "webgpu" (in-browser WebLLM) | "gemini" (cloud) | "api" (external server)
  modes: [
    {
      id: "webgpu",
      label: "WebGPU",
      color: "amber",
      classes: "text-amber-700 dark:text-amber-400",
      activeClasses: "bg-amber-100 dark:bg-amber-900/30",
    },
    {
      id: "gemini",
      label: "Gemini",
      color: "emerald",
      classes: "text-emerald-700 dark:text-emerald-400",
      activeClasses: "bg-emerald-100 dark:bg-emerald-900/30",
    },
    {
      id: "api",
      label: "API Mode",
      color: "sky",
      classes: "text-sky-700 dark:text-sky-400",
      activeClasses: "bg-sky-100 dark:bg-sky-900/30",
    },
  ],

  // External LLM server (API Mode) - Ollama / LM Studio / OpenAI-compatible
  serverHost: "http://127.0.0.1:11434/v1",
  serverSchema: "openai",
  serverModel: "qwen3.5:4b",
  useServerApiKey: false,
  serverApiKey: "",
  serverEndpoints: {
    openai: "chat/completions",
    lmstudio: "chat",
  },
  serverMaxRetries: 1,
  serverRetryDelayMs: 2000,

  detectionMinConfidence: 0.5,
  skipBboxRefining: false,
  autoTranslate: false,
  autoTranslateConcurrency: 1,
  rtdetrModelRepo: env.rtdetrModelRepo,
  comicTextDetectorUrl: env.comicTextDetectorUrl,

  // Inpainting method: "fast" (model-free ladder: fitted mask -> planar fill
  // -> denoise -> Telea, each rung decline-gated) | "quality" (standalone
  // LaMa-first pass per region, falling back into Fast where LaMa declines)
  inpaintMethod: "fast",
  lamaRepo: env.lamaInpaintModelRepo,
  lamaModelPath: "lama-manga-dynamic.onnx" as `${string}.onnx`,

  ocrEngine: "paddle", // "paddle" | "ppocrv6-manga" (JA-only) | "manga-ocr" (JA-only)
  ocrMinConfidence: 0.7,
  ocrLangGroupMap, // Map source language to language group for model & dictionary selection
  ocrBatchSize: 4,
  ocrRecImgHeight: 48,
  ocrRepo: env.paddleOCRModelRepo,
  mangaOcrRepo: env.mangaOCRModelRepo,
  ocrModelPath: (langGroup: string): `${string}.onnx` =>
    `languages/${langGroup}/rec.onnx`,
  ocrDictPath: (langGroup: string) => `languages/${langGroup}/dict.txt`,
  // Script-ID gate: verifies detected regions really hold the selected
  // source script before translating (strict when a CJK source is explicit,
  // additive page-majority under Auto-Detect).
  scriptGate: true,
  gateRepo: env.gateModelRepo,
  gateModelPath: "osd_lstm.onnx" as `${string}.onnx`,
  gateLabelsPath: "osd_labels.json",

  llmTemperature: 0.3,
  minTranslations: 5, // number of translations per series before resetting context

  geminiModels: [
    { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash" },
    { id: "gemini-3.7-flash", label: "Gemini 3.7 Flash" },
    { id: "gemini-3.6-flash", label: "Gemini 3.6 Flash" },
    { id: "gemini-3.5-flash", label: "Gemini 3.5 Flash" },
    { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash Lite" },
    { id: "gemini-3.1-flash-lite", label: "Gemini 3.1 Flash Lite" },
  ],
  detectionModels: [
    {
      id: "comic-bubble",
      label: "Comic Bubble Detector (RT-DETR)",
      size: "11.1 MB",
      desc: "Bubble & free text detection (default, Apache-2.0)",
    },
    {
      id: "comic-text-detector",
      label: "Comic Text Detector & Segmentation",
      size: "94.7 MB",
      desc: "Text boxes + pixel segmentation mask (GPL-3.0)",
    },
  ],
  llmModels: [
    {
      id: "gemma3-1b-it-q4f16_1-MLC",
      label: "Gemma3-1B",
      desc: "Small — fastest, good enough for simple dialogue.",
      vram: "~800 MB",
      engine: "webllm",
      browsers: ["chrome"],
    },
    {
      id: "Qwen3.5-2B-q4f16_1-MLC",
      label: "Qwen3.5-2B",
      desc: "Balanced — speed and quality for most manga.",
      vram: "~2.3 GB",
      engine: "webllm",
      browsers: ["chrome"],
    },
    {
      id: "Qwen3.5-4B-q4f16_1-MLC",
      label: "Qwen3.5-4B",
      desc: "Good — better reasoning for more complex manga.",
      vram: "~3.9 GB",
      engine: "webllm",
      browsers: ["chrome"],
    },
    {
      id: "Qwen3.5-4B-IQ4_XS-GGUF",
      label: "Qwen3.5-4B",
      desc: "Balanced — speed and quality for most manga.",
      vram: "~2.3 GB",
      engine: "wllama",
      browsers: ["firefox"],
      repo: env.ggufModelRepo,
      file: "Qwen3.5-4B-IQ4_XS.gguf",
      bytes: 2477053088,
    },
    {
      id: "tiny-aya-global-q4_k_m-GGUF",
      label: "Tiny Aya Global",
      desc: "Tiny multilingual model — focused on translating text.",
      vram: "~2.0 GB",
      engine: "wllama",
      browsers: ["firefox"],
      repo: "CohereLabs/tiny-aya-global-GGUF",
      file: "tiny-aya-global-q4_k_m.gguf",
      bytes: 2143977056,
    },
  ],
  availableLanguages: [
    "Auto-Detect",
    "Indonesian",
    "Spanish",
    "Portuguese",
    "French",
    "Vietnamese",
    "Tagalog",
    "Malay",
    "Thai",
    "German",
    "Italian",
    "Dutch",
    "Polish",
    "Czech",
    "Slovak",
    "Croatian",
    "Bosnian",
    "Serbian",
    "Slovenian",
    "Danish",
    "Norwegian",
    "Swedish",
    "Icelandic",
    "Estonian",
    "Lithuanian",
    "Hungarian",
    "Albanian",
    "Welsh",
    "Irish",
    "Turkish",
    "Afrikaans",
    "Swahili",
    "Uzbek",
    "Latin",
    "Greek",
    ...Object.keys(ocrLangGroupMap),
  ],
  bundleFonts: [
    { id: "system", label: "System", stack: "'Segoe UI', sans-serif" },
    { id: "noto", label: "Noto Sans", stack: "'Noto Sans', sans-serif" },
    { id: "bangers", label: "Bangers", stack: "'Bangers', cursive" },
    { id: "comic", label: "Comic Neue", stack: "'Comic Neue', cursive" },
  ],
};

// ── OCR language-group resolution ─────────────────────────────────────────
// Groups with a dedicated `languages/<group>/rec.onnx` + `dict.txt` on the
// paddleocr-onnx repo (mirrors `monkt/paddleocr-onnx/languages/`).
export const SUPPORTED_LANG_GROUPS = [
  "arabic",
  "chinese",
  "english",
  "eslav",
  "greek",
  "hindi",
  "korean",
  "latin",
  "tamil",
  "telugu",
  "thai",
] as const;

export interface ResolvedLangGroup {
  /** Repo folder under `languages/`, e.g. "thai" or fallback "latin". */
  group: string;
  /** True when `sourceLang` had no direct mapping and fell back to latin. */
  fellBack: boolean;
}

/**
 * Single source of truth for source-language → rec-model group resolution.
 * - "Latin" (capitalised UI label) and "Auto-Detect" resolve to "latin".
 * - Direct `ocrLangGroupMap` hits resolve silently.
 * - Anything else falls back to "latin" with `fellBack: true` so callers can
 *   surface which `rec.onnx` was actually used.
 */
export function resolveLangGroup(sourceLang: string): ResolvedLangGroup {
  if (sourceLang === "Latin" || sourceLang === "Auto-Detect") {
    return { group: "latin", fellBack: false };
  }
  const mapped = ocrLangGroupMap[sourceLang];
  if (mapped && (SUPPORTED_LANG_GROUPS as readonly string[]).includes(mapped)) {
    return { group: mapped, fellBack: false };
  }
  if (mapped) {
    console.warn(
      `[ocr] language "${sourceLang}" maps to unknown group "${mapped}", falling back to "latin"`,
    );
    return { group: "latin", fellBack: true };
  }
  return { group: "latin", fellBack: true };
}

/**
 * Migrate stored detection-model ids after YOLO removal.
 * - Removed YOLO ids ("yolo26n", "yolo26s") → "comic-bubble" (new default).
 * - Known ids pass through untouched.
 * - Anything else passes through so the loader throws the explicit
 *   unknown-model error (with setup-wizard directions) instead of a
 *   confusing HF 404.
 */
export function normalizeDetectionModel(id: string | null | undefined): string {
  if (id === "yolo26n" || id === "yolo26s") return "comic-bubble";
  return id || DefaultConfig.detectionModels[0].id;
}

export type LlmEngine = "webllm" | "wllama";

export interface LlmModelDef {
  id: string;
  label: string;
  desc: string;
  vram: string;
  engine: LlmEngine;
  /** build targets this model is offered on ("chrome" covers all non-Firefox builds) */
  browsers: string[];
  /** wllama-only: HF repo + file served through the shared model cache */
  repo?: string;
  file?: string;
  bytes?: number;
}

/** "firefox" for Firefox builds, "chrome" for everything else. */
export function currentBrowser(): "firefox" | "chrome" {
  try {
    const envBrowser = (import.meta.env as Record<string, string | undefined>)
      .BROWSER;
    if (envBrowser === "firefox") return "firefox";
  } catch {
    // import.meta.env unavailable (e.g. self-check scripts) — fall through
  }
  if (
    typeof navigator !== "undefined" &&
    /firefox/i.test(navigator.userAgent ?? "")
  ) {
    return "firefox";
  }
  return "chrome";
}

/** LLM models offered in this build (Firefox-only swap: GGUF on Firefox, MLC elsewhere). */
export function visibleLlmModels(): LlmModelDef[] {
  const browser = currentBrowser();
  const list = (DefaultConfig.llmModels as LlmModelDef[]).filter((m) =>
    (m.browsers ?? ["chrome"]).includes(browser),
  );
  return list.length > 0 ? list : (DefaultConfig.llmModels as LlmModelDef[]);
}

/** Resolve a stored model id, falling back to this build's default (handles cross-engine stale ids). */
export function llmModelDef(id?: string | null): LlmModelDef {
  const list = visibleLlmModels();
  return list.find((m) => m.id === id) ?? list[0];
}

export function defaultLlmModelId(): string {
  return visibleLlmModels()[0].id;
}
