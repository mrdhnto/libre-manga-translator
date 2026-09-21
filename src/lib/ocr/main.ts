import {
  boostContrast,
  cropBubbleFromImage,
  normalizePolarity,
  padImageForOCR,
  sliceImageDataIntoLines,
} from "./utils";
import { fetchAsImageBitmap } from "../utils";
import { DefaultConfig, resolveLangGroup } from "../configs";
import {
  groupForLabel,
  majorityLabel,
  decideSkip,
  gateModeFor,
  type GateMode,
  type GateSummary,
  type RegionVerdict,
} from "../gate";
import { judgeRegion, loadGate } from "../gate/osd";
import type { GateReason } from "../gate";
import { isTrustedLabel } from "../gate/charset";
import type { OCRResult, OcrEngine, OcrOutcome } from "./types";
import { PaddleOcrEngine } from "./paddle";
import { MangaOcrEngine } from "./manga-ocr";
import { env } from "../env";

export type { OCRResult, OcrOutcome };

const paddleEngine = new PaddleOcrEngine();
const mangaOcrEngine = new MangaOcrEngine();
// PP-OCRv6 small rec, manga fine-tune (Japanese-only): same CTC contract as
// PaddleOCR (48px height, stock ppocrv6 dict + space + blank), fixed file +
// bundled dict, so it reuses the Paddle runner.
const ppocrv6MangaEngine = new PaddleOcrEngine({
  id: "ppocrv6-manga",
  label: "PP-OCRv6 Manga (Japanese)",
  repo: env.ppocrv6MangaRepo,
  modelPath: () => "ppocr-rec-v6-small-manga.onnx",
  bundledDictPath: "dicts/ppocrv6_dict.txt",
});

export function getOcrEngine(id = DefaultConfig.ocrEngine): OcrEngine {
  if (id === "manga-ocr") return mangaOcrEngine;
  if (id === "ppocrv6-manga") return ppocrv6MangaEngine;
  return paddleEngine;
}

/**
 * Agnostic OCR Coordinator with script gate:
 * 1. Line-slicing & contrast normalization
 * 2. OSD script identification pass
 * 3. Pre-filtering confident wrong-script boxes
 * 4. Delegation to chosen OcrEngine (PaddleOCR or Manga-OCR)
 * 5. Post-OCR text-script verification (cjkShare / classShare rescue)
 */
export async function textRecognise(
  imageSrc: string,
  bboxes: Bbox[],
  sourceLang: string,
  minConfidence = DefaultConfig.ocrMinConfidence,
  autoUpdate = DefaultConfig.ocrAutoUpdate,
  batchSize = DefaultConfig.ocrBatchSize,
  recImgHeight = DefaultConfig.ocrRecImgHeight,
  gateOptions?: { enabled?: boolean; force?: boolean },
  engineId?: string,
): Promise<OcrOutcome> {
  const mode: GateMode = gateModeFor(
    sourceLang,
    gateOptions?.enabled ?? true,
    gateOptions?.force ?? false,
  );

  const bitmap = await fetchAsImageBitmap(imageSrc);

  // Crop + slice once; the gate and the recognizer read the same lines.
  const regionLines: ImageData[][] = bboxes.map((bbox) => {
    const rawCrop = cropBubbleFromImage(bitmap, bbox, sourceLang);
    const normalizedCrop = normalizePolarity(rawCrop);
    const boostedCrop = boostContrast(normalizedCrop);
    const bubbleH = bbox.y2 - bbox.y1;
    const bubbleW = bbox.x2 - bbox.x1;
    const isSingleLine = Math.min(bubbleH, bubbleW) < 24;
    return isSingleLine
      ? [padImageForOCR(boostedCrop, 4)]
      : sliceImageDataIntoLines(boostedCrop).map((line) =>
          padImageForOCR(line, 4),
        );
  });

  // --- script-ID pass ---
  let gateLoaded = false;
  if (mode !== "off") gateLoaded = await loadGate(autoUpdate);
  const verdicts: (RegionVerdict | null)[] = new Array(bboxes.length).fill(null);
  if (mode !== "off" && gateLoaded) {
    for (let i = 0; i < bboxes.length; i++) {
      verdicts[i] = await judgeRegion(regionLines[i]);
    }
  }

  let pageLabel: string | null = null;
  let langGroup: string;
  if (mode === "auto" && gateLoaded) {
    pageLabel = majorityLabel(
      verdicts.filter((v): v is RegionVerdict => v !== null),
    );
  }
  const gateGroup = mode === "auto" && gateLoaded ? groupForLabel(pageLabel) : null;
  if (gateGroup) {
    langGroup = gateGroup;
  } else {
    const resolved = resolveLangGroup(sourceLang);
    langGroup = resolved.group;
    if (resolved.fellBack) {
      console.warn(
        `[ocr] "${sourceLang}" has no dedicated rec model — using languages/${langGroup}/rec.onnx`,
      );
    }
  }

  // Pre-filter: a CONFIDENT, TRUSTED wrong-script refusal never gets read
  const gateSkip: (GateReason | null)[] = new Array(bboxes.length).fill(null);
  if (mode === "cjk" && gateLoaded) {
    for (let i = 0; i < bboxes.length; i++) {
      const v = verdicts[i];
      if (v && v.decision === "wrong-script" && isTrustedLabel(v.script)) {
        gateSkip[i] = "not-japanese";
      }
    }
  }

  const engine = getOcrEngine(engineId);
  const rawResults = await engine.recognize(
    bitmap,
    bboxes,
    sourceLang,
    regionLines,
    gateSkip,
    {
      minConfidence,
      autoUpdate,
      batchSize,
      recImgHeight,
      langGroup,
    },
  );

  const result: OCRResult[] = rawResults.map((r, i) => ({
    text: r.text,
    confidence: r.confidence,
    failed: r.failed,
    gateSkip: gateSkip[i],
  }));

  // Post-OCR verification & rescue
  let skipped = gateSkip.filter((s) => s !== null).length;
  for (let i = 0; i < bboxes.length; i++) {
    if (gateSkip[i]) continue; // already skipped by pre-filter
    const reason = decideSkip(
      mode,
      verdicts[i],
      result[i].text,
      sourceLang,
      pageLabel,
    );
    if (reason) {
      result[i].gateSkip = reason;
      skipped++;
    }
  }

  const gate: GateSummary = {
    mode,
    checked: verdicts.filter((v) => v !== null).length,
    skipped,
    group: langGroup,
    unavailable: mode !== "off" && !gateLoaded,
  };

  return { results: result, gate };
}
