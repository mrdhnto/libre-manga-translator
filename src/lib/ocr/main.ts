import * as ort from "onnxruntime-web/all";
import {
  boostContrast,
  buildCharset,
  cropBubbleFromImage,
  ctcDecode,
  normalizePolarity,
  padImageForOCR,
  preprocessCrop,
  sliceImageDataIntoLines,
} from "./utils";
import { downloadArtifactHF, fetchAsImageBitmap } from "../utils";
import { DefaultConfig } from "../configs";
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

let session: ort.InferenceSession | null = null;
let charset: string[] | null = null;
let currentLangGroup: string | null = null;
let runLock: Promise<void> = Promise.resolve();

interface OCRResult {
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

/**
 * Detect-language before you translate-language (the script gate): the
 * gate's default is DO NOT translate, because a missed
 * balloon is recoverable and painting over someone else's lettering is not.
 * The OSD model votes per sliced line; regions the model is not confident
 * about are checked against the recognized text itself (`cjkShare` /
 * `classShare`) - the text is the reader, so no extra model is needed.
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
    const bubbleH = bbox.y2 - bbox.y1;
    const bubbleW = bbox.x2 - bbox.x1;
    const isSmall = bubbleH < 80 || bubbleW < 80;
    return isSmall
      ? [normalizedCrop]
      : sliceImageDataIntoLines(normalizedCrop);
  });

  // --- script-ID pass (before session load: Auto picks the group from it) ---
  let gateLoaded = false;
  if (mode !== "off") gateLoaded = await loadGate(autoUpdate);
  const verdicts: (RegionVerdict | null)[] = new Array(bboxes.length).fill(
    null,
  );
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
  langGroup =
    groupForLabel(pageLabel) ??
    DefaultConfig.ocrLangGroupMap[sourceLang] ??
    "latin";

  if (session && currentLangGroup !== langGroup) {
    try {
      // Free the hardware memory allocated by the previous model
      await session.release();
    } catch (error) {
      console.warn("Failed to cleanly release the previous session:", error);
    }
    session = null;
    charset = null;
    currentLangGroup = null;
  }

  if (!session) {
    session = await downloadArtifactHF(
      DefaultConfig.ocrRepo,
      DefaultConfig.ocrModelPath(langGroup),
      autoUpdate,
    );

    currentLangGroup = langGroup;
  }

  if (!charset) {
    const dictText = await (
      await downloadArtifactHF(
        DefaultConfig.ocrRepo,
        DefaultConfig.ocrDictPath(langGroup),
      )
    ).text();
    charset = buildCharset(dictText);
  }

  // --- pre-filter: a CONFIDENT, TRUSTED wrong-script refusal never gets read
  // at all (judge pixels before reading them; saves the rec batch too) ---
  const gateSkip: (GateReason | null)[] = new Array(bboxes.length).fill(null);
  if (mode === "cjk" && gateLoaded) {
    for (let i = 0; i < bboxes.length; i++) {
      const v = verdicts[i];
      if (v && v.decision === "wrong-script" && isTrustedLabel(v.script))
        gateSkip[i] = "not-japanese";
    }
  }

  const crops = bboxes
    .map((bbox, index) =>
      gateSkip[index]
        ? []
        : regionLines[index].map((imageData) => ({
            originalBboxIndex: index,
            imageData,
          })),
    )
    .flat();

  let result!: OCRResult[];
  runLock = runLock.then(async () => {
    result = await runBatches(
      crops,
      batchSize,
      recImgHeight,
      minConfidence,
      bboxes.length,
      langGroup,
    );
  });
  await runLock;

  // Pre-filtered entries carry the skip, not a failed read.
  for (let i = 0; i < bboxes.length; i++) {
    if (gateSkip[i])
      result[i] = { text: "", confidence: 0, failed: false, gateSkip: gateSkip[i] };
  }

  // Retries the result if it is empty string (gate-skipped regions excluded).
  const failedIndexes = result
    .map((r, i) => (r.failed && !r.gateSkip ? i : -1))
    .filter((i) => i >= 0);

  if (failedIndexes.length > 0) {
    const retrycrops = failedIndexes
      .map((bboxIdx, retryIdx) => {
        const rawCrop = cropBubbleFromImage(
          bitmap,
          bboxes[bboxIdx],
          sourceLang,
        );
        const normalizedCrop = normalizePolarity(rawCrop);
        const paddedCrop = padImageForOCR(normalizedCrop, 4);
        const boostedCrop = boostContrast(paddedCrop);

        const bubbleH = bboxes[bboxIdx].y2 - bboxes[bboxIdx].y1;
        const bubbleW = bboxes[bboxIdx].x2 - bboxes[bboxIdx].x1;
        const isSmall = bubbleH < 80 || bubbleW < 80;

        const lines = isSmall
          ? [boostedCrop]
          : sliceImageDataIntoLines(boostedCrop);

        return lines.map((imageData) => ({
          originalBboxIndex: retryIdx,
          imageData,
        }));
      })
      .flat();

    let retryResults!: { text: string; confidence: number }[];
    runLock = runLock.then(async () => {
      retryResults = await runBatches(
        retrycrops,
        batchSize,
        recImgHeight,
        minConfidence * 0.7, // Lower confidence to reduce false positives
        failedIndexes.length,
        langGroup,
      );
    });
    await runLock;

    failedIndexes.forEach((bboxIdx, i) => {
      if (retryResults[i].text) result[bboxIdx] = retryResults[i];
    });
  }

  // --- post-recognition verification: the text itself is the rescue reader ---
  let skipped = 0;
  for (let i = 0; i < bboxes.length; i++) {
    if (result[i].gateSkip) {
      skipped++;
      continue;
    }
    const reason = decideSkip(
      mode,
      verdicts[i],
      result[i].text,
      sourceLang,
      pageLabel,
    );
    if (reason) {
      result[i] = {
        text: "",
        confidence: 0,
        failed: false,
        gateSkip: reason,
      };
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

async function runBatches(
  crops: { originalBboxIndex: number; imageData: ImageData }[],
  batchSize: number,
  recImgHeight: number,
  minConfidence: number,
  numBboxes: number,
  langGroup: string,
): Promise<OCRResult[]> {
  if (!(session && charset))
    throw new Error("Session or Charset not initialize");

  const stitchedResults = Array.from({ length: numBboxes }, () => ({
    text: "",
    totalConf: 0,
    lineCount: 0,
  }));

  // Run the OCR pipeline in batches
  for (let start = 0; start < crops.length; start += batchSize) {
    const end = Math.min(crops.length, start + batchSize);
    const batchData = crops.slice(start, end);
    const batchImages = batchData.map(({ imageData }) => imageData);

    if (batchImages.length === 0) continue;

    const whRatios = batchImages.map((c) => c.width / c.height);
    const maxWHRatio = Math.max(...whRatios);
    const targetW = Math.max(Math.ceil(recImgHeight * maxWHRatio), 1);

    const preprocessed = batchImages.map((c, i) =>
      preprocessCrop(c, targetW, recImgHeight),
    );

    const N = batchImages.length;
    const channels = 3;
    const sliceSize = channels * recImgHeight * targetW;
    const batchBuffer = new Float32Array(N * sliceSize);
    preprocessed.forEach((tensor, i) => {
      batchBuffer.set(tensor.data as Float32Array, i * sliceSize);
    });

    const inputTensor = new ort.Tensor("float32", batchBuffer, [
      N,
      channels,
      recImgHeight,
      targetW,
    ]);

    const inputName = session.inputNames[0];
    const outputMap = await session.run({ [inputName]: inputTensor });
    const outputName = session.outputNames[0];
    const output = outputMap[outputName];

    const [, T, C] = output.dims as number[];
    const outputData = output.data as Float32Array;

    // Decode and stitch back to the original bubble
    for (let i = 0; i < N; i++) {
      const slice = outputData.slice(i * T * C, (i + 1) * T * C);
      const decoded = ctcDecode(slice, charset, C, langGroup);
      const textLen = decoded.text.trim().length;

      if (decoded.confidence >= minConfidence) {
        // If it's short text demand a much higher confidence
        const isShortHallucination = textLen <= 4 && decoded.confidence < 0.85;

        if (!isShortHallucination) {
          const bboxIdx = batchData[i].originalBboxIndex;
          const target = stitchedResults[bboxIdx];

          let newText = decoded.text.trim();

          if (target.text.endsWith("-")) {
            target.text = target.text.slice(0, -1) + newText;
          } else {
            target.text += (target.text ? " " : "") + newText;
          }

          target.totalConf += decoded.confidence;
          target.lineCount += 1;
        }
      }
    }
  }

  return stitchedResults.map(({ text, totalConf, lineCount }) => {
    if (lineCount === 0) {
      return { text: "", confidence: 0, failed: true };
    }
    return {
      text: text.trim(),
      confidence: lineCount > 0 ? totalConf / lineCount : 0,
    };
  });
}
