/// <reference types="svelte" />
declare module "*.svelte" {
  import type { ComponentType } from "svelte";
  const component: ComponentType;
  export default component;
}

interface Bbox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  confidence: number;
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
  inpaintMethod?: "telea" | "fast" | "fallback";
  inpaintError?: string;
  models: {
    detection?: string;
    ocr?: string;
    llm?: string;
    server?: string;
  };
  error?: string;
}

type ExtractSource = "title" | "path";

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
}

type AIGeneratedRule = Omit<SiteRule, "id" | "domain">;
