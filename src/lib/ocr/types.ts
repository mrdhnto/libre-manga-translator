import type { GateReason, GateSummary } from "../gate";

export interface OCRResult {
  text: string;
  confidence: number;
  failed?: boolean;
  /** the script gate held this region back: text was NOT translated */
  gateSkip?: GateReason | null;
}

export interface OcrOutcome {
  results: OCRResult[];
  gate: GateSummary;
}

export interface SingleOcrResult {
  text: string;
  confidence: number;
  failed?: boolean;
}

export interface OcrEngine {
  id: string;
  label: string;
  recognize(
    bitmap: ImageBitmap,
    bboxes: Bbox[],
    sourceLang: string,
    regionLines: ImageData[][],
    gateSkip: (GateReason | null)[],
    options?: {
      minConfidence?: number;
      autoUpdate?: boolean;
      batchSize?: number;
      recImgHeight?: number;
      langGroup?: string;
    },
  ): Promise<SingleOcrResult[]>;
  release?(): Promise<void>;
}
