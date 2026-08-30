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

let session: ort.InferenceSession | null = null;
let charset: string[] | null = null;
let currentLangGroup: string | null = null;
let runLock: Promise<void> = Promise.resolve();

interface OCRResult {
  text: string;
  confidence: number;
  failed?: boolean;
}

export async function textRecognise(
  imageSrc: string,
  bboxes: Bbox[],
  sourceLang: string,
  minConfidence = DefaultConfig.ocrMinConfidence,
  autoUpdate = DefaultConfig.ocrAutoUpdate,
  batchSize = DefaultConfig.ocrBatchSize,
  recImgHeight = DefaultConfig.ocrRecImgHeight,
): Promise<{ text: string; confidence: number }[]> {
  const langGroup = DefaultConfig.ocrLangGroupMap[sourceLang] || "latin";
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

  const bitmap = await fetchAsImageBitmap(imageSrc);

  let crops = bboxes
    .map((bbox, index) => {
      const rawCrop = cropBubbleFromImage(bitmap, bbox, sourceLang);
      const normalizedCrop = normalizePolarity(rawCrop);

      const bubbleH = bbox.y2 - bbox.y1;
      const bubbleW = bbox.x2 - bbox.x1;
      const isSmall = bubbleH < 80 || bubbleW < 80;

      const lines = isSmall
        ? [normalizedCrop]
        : sliceImageDataIntoLines(normalizedCrop);
      return lines.map((imageData) => ({
        originalBboxIndex: index,
        imageData,
      }));
    })
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

  // Retries the result if it empty string
  const failedIndexes = result
    .map((r, i) => (r.failed ? i : -1))
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
  return result;
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
