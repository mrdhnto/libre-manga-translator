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
import { downloadArtifactHF } from "../utils";
import { DefaultConfig } from "../configs";
import type { OcrEngine, SingleOcrResult } from "./types";
import type { GateReason } from "../gate";

export class PaddleOcrEngine implements OcrEngine {
  id = "paddle";
  label = "PaddleOCR (Multilingual)";

  private session: ort.InferenceSession | null = null;
  private charset: string[] | null = null;
  private currentLangGroup: string | null = null;
  private runLock: Promise<void> = Promise.resolve();

  async release(): Promise<void> {
    if (this.session) {
      try {
        await this.session.release();
      } catch (err) {
        console.warn("Failed to cleanly release PaddleOCR session:", err);
      }
      this.session = null;
      this.charset = null;
      this.currentLangGroup = null;
    }
  }

  async recognize(
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
  ): Promise<SingleOcrResult[]> {
    const minConfidence = options?.minConfidence ?? DefaultConfig.ocrMinConfidence;
    const autoUpdate = options?.autoUpdate ?? DefaultConfig.ocrAutoUpdate;
    const batchSize = options?.batchSize ?? DefaultConfig.ocrBatchSize;
    const recImgHeight = options?.recImgHeight ?? DefaultConfig.ocrRecImgHeight;
    const langGroup = options?.langGroup ?? "latin";

    if (this.session && this.currentLangGroup !== langGroup) {
      await this.release();
    }

    if (!this.session) {
      this.session = await downloadArtifactHF(
        DefaultConfig.ocrRepo,
        DefaultConfig.ocrModelPath(langGroup),
        autoUpdate,
      );
      this.currentLangGroup = langGroup;
    }

    if (!this.charset) {
      const dictResp = await downloadArtifactHF(
        DefaultConfig.ocrRepo,
        DefaultConfig.ocrDictPath(langGroup),
      );
      const dictText = await dictResp.text();
      this.charset = buildCharset(dictText);
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

    let result!: SingleOcrResult[];
    this.runLock = this.runLock.then(async () => {
      result = await this.runBatches(
        crops,
        batchSize,
        recImgHeight,
        minConfidence,
        bboxes.length,
        langGroup,
      );
    });
    await this.runLock;

    // Retry path for empty results (regions that were not gate-skipped)
    const failedIndexes = result
      .map((r, i) => (r.failed && !gateSkip[i] ? i : -1))
      .filter((i) => i >= 0);

    if (failedIndexes.length > 0) {
      const retryCrops = failedIndexes
        .map((bboxIdx, retryIdx) => {
          const rawCrop = cropBubbleFromImage(
            bitmap,
            bboxes[bboxIdx],
            sourceLang,
          );
          const normalizedCrop = normalizePolarity(rawCrop);
          const boostedCrop = boostContrast(normalizedCrop);
          const paddedCrop = padImageForOCR(boostedCrop, 6);

          const bubbleH = bboxes[bboxIdx].y2 - bboxes[bboxIdx].y1;
          const bubbleW = bboxes[bboxIdx].x2 - bboxes[bboxIdx].x1;
          const isSingleLine = Math.min(bubbleH, bubbleW) < 24;

          const lines = isSingleLine
            ? [paddedCrop]
            : sliceImageDataIntoLines(paddedCrop);

          return lines.map((imageData) => ({
            originalBboxIndex: retryIdx,
            imageData: padImageForOCR(imageData, 4),
          }));
        })
        .flat();

      let retryResults!: SingleOcrResult[];
      this.runLock = this.runLock.then(async () => {
        retryResults = await this.runBatches(
          retryCrops,
          batchSize,
          recImgHeight,
          minConfidence,
          failedIndexes.length,
          langGroup,
        );
      });
      await this.runLock;

      failedIndexes.forEach((origIdx, retryIdx) => {
        if (!retryResults[retryIdx].failed) {
          result[origIdx] = retryResults[retryIdx];
        }
      });
    }

    return result;
  }

  private async runBatches(
    crops: { originalBboxIndex: number; imageData: ImageData }[],
    batchSize: number,
    recImgHeight: number,
    minConfidence: number,
    numBboxes: number,
    langGroup: string,
  ): Promise<SingleOcrResult[]> {
    if (!this.session || !this.charset) {
      throw new Error("PaddleOCR session or charset not initialized");
    }

    const stitchedResults = Array.from({ length: numBboxes }, () => ({
      text: "",
      totalConf: 0,
      lineCount: 0,
    }));

    for (let start = 0; start < crops.length; start += batchSize) {
      const end = Math.min(crops.length, start + batchSize);
      const batchData = crops.slice(start, end);
      const batchImages = batchData.map(({ imageData }) => imageData);

      if (batchImages.length === 0) continue;

      const whRatios = batchImages.map((c) => c.width / c.height);
      const maxWHRatio = Math.max(...whRatios);
      const targetW = Math.max(Math.ceil(recImgHeight * maxWHRatio), 1);

      const preprocessed = batchImages.map((c) =>
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

      const inputName = this.session.inputNames[0];
      const outputMap = await this.session.run({ [inputName]: inputTensor });
      const outputName = this.session.outputNames[0];
      const output = outputMap[outputName];

      const [, T, C] = output.dims as number[];
      const outputData = output.data as Float32Array;

      for (let i = 0; i < N; i++) {
        const slice = outputData.slice(i * T * C, (i + 1) * T * C);
        const decoded = ctcDecode(slice, this.charset, C, langGroup);
        const textLen = decoded.text.trim().length;

        if (decoded.confidence >= minConfidence) {
          const isSingleCharNoise =
            textLen === 1 && decoded.confidence < Math.max(minConfidence, 0.75);

          if (!isSingleCharNoise && textLen > 0) {
            const bboxIdx = batchData[i].originalBboxIndex;
            const target = stitchedResults[bboxIdx];

            const newText = decoded.text.trim();

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
}
