/// <reference types="svelte" />
/// <reference types="vite/client" />
declare module "*.svelte" {
  import type { ComponentType } from "svelte";
  const component: ComponentType;
  export default component;
}

type GateReason = "not-japanese" | "low-confidence";

interface Bbox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  confidence: number;
  /** the script gate held this region back (optional, cache-compatible) */
  gateSkip?: GateReason;
  /** all ladder inpaint rungs declined this region */
  inpaintDeclined?: boolean;
}

type Translations = string[];

interface SeriesContext {
  seriesName: string;
  summary: string;
  dictionary: string;

  // Tracking the last translated position
  lastChapterId: string | null;
  lastPageIndex: number | null;

  recentHistory: {
    chapterId: string;
    pageIndex: number;
    text: string;
  }[];

  translatedCount: number;
}

interface PageCache {
  bboxes: Bbox[];
  translations: Translations;
  sourceTexts?: string[];
}

interface TranslateResult {
  translations: Translations;
  sourceTexts?: string[];
  context?: { summary: string; dictionary: string };
  /** per-request LLM token stats (webgpu/local mode only) */
  llmPerf?: LlmPerf;
}

/** Token throughput for one local-LLM request. All fields optional so a
 *  partial reading (e.g. counts without per-phase rates) still logs. */
interface LlmPerf {
  promptTokens?: number;
  completionTokens?: number;
  promptMs?: number;
  genMs?: number;
  promptTps?: number;
  genTps?: number;
  totalMs?: number;
}

interface DebugEntry {
  id: string;
  timestamp: number;
  success: boolean;
  mode: string;
  version?: string;
  device?: string;
  backend?: "webgpu" | "wasm";
  sourceLang: string;
  targetLang: string;
  langGroup?: string;
  bboxCount: number;
  sourceTexts?: string[];
  translations?: string[];
  timing: {
    detect?: number;
    ocr?: number;
    translate?: number;
    inpaint?: number;
    total?: number;
  };
  ocrMinConfidence?: number;
  detectionMinConfidence?: number;
  temperature?: number;
  serverSchema?: string;
  geminiModel?: string;
  inpaintMethod?: "fast" | "quality" | "fallback";
  gate?: {
    mode: "off" | "cjk" | "other" | "auto";
    checked: number;
    skipped: number;
    group?: string;
    unavailable?: boolean;
  };
  inpaintStats?: {
    fill: number;
    denoise: number;
    lama: number;
    telea: number;
    rectTelea: number;
    declined: number;
    skipped: number;
  };
  inpaintError?: string;
  inpaintLamaError?: string;
  /** token speed for webgpu/local-LLM requests (absent on api/gemini) */
  llmPerf?: LlmPerf;
  /** local engine that served this request (webgpu mode only) */
  engine?: "wllama" | "webllm";
  /** why WebGPU inference fell back to CPU/WASM (webgpu mode only) */
  gpuUnavailableReason?: string;
  models: {
    detection?: string;
    ocr?: string;
    llm?: string;
    server?: string;
  };
  error?: string;
}

type ExtractSource = "title" | "path" | "hash";

interface SiteRule {
  id: string;
  domain: string;
  seriesName: {
    regex: string;
    source: ExtractSource;
  };
  chapterId: {
    regex: string;
    source: ExtractSource;
  };
  pageIndex: {
    regex: string;
    source: ExtractSource;
  };
  /** CSS selector targeting the manga reader container element */
  containerSelector?: string;
  /** CSS selector targeting chapter page <img> elements */
  imageSelector?: string;
}

type AIGeneratedRule = Omit<SiteRule, "id" | "domain">;
