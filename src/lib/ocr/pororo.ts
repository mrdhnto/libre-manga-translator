import * as ort from "onnxruntime-web/all";
import {
  boostContrast,
  cropBubbleFromImage,
  normalizePolarity,
  padImageForOCR,
  sliceImageDataIntoLines,
} from "./utils";
import { downloadArtifactHF, yieldToMain } from "../utils";
import { DefaultConfig } from "../configs";
import { env } from "../env";
import type { OcrEngine, SingleOcrResult } from "./types";
import type { GateReason } from "../gate";

const INPUT_HEIGHT = 64;
const INPUT_WIDTH = 640;
const TIME_STEPS = 100;
const NUM_CLASSES = 2589;

/**
 * Preprocesses a cropped text line for Pororo BrainOCR (TPS-VGG-BiLSTM-CTC).
 *
 * Requirements:
 *  1. Grayscale luminance (L = 0.299*R + 0.587*G + 0.114*B)
 *  2. Scale to fixed height (64px), keeping aspect ratio up to max width (640px)
 *  3. Normalization to range [-1, 1] via (pixel / 255.0) * 2.0 - 1.0
 *  4. Right border padding by replicating the rightmost column to fill width 640
 *  5. Tensor format: [1, 1, 64, 640] Float32
 */
export function preprocessPororoLine(crop: ImageData): Float32Array {
  const naturalRatio = crop.width / Math.max(1, crop.height);
  const scaledW = Math.min(
    INPUT_WIDTH,
    Math.max(1, Math.ceil(INPUT_HEIGHT * naturalRatio)),
  );

  const srcCanvas = new OffscreenCanvas(crop.width, crop.height);
  const srcCtx = srcCanvas.getContext("2d")!;
  srcCtx.putImageData(crop, 0, 0);

  const resizedCanvas = new OffscreenCanvas(scaledW, INPUT_HEIGHT);
  const ctx = resizedCanvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(
    srcCanvas,
    0,
    0,
    crop.width,
    crop.height,
    0,
    0,
    scaledW,
    INPUT_HEIGHT,
  );

  const raw = ctx.getImageData(0, 0, scaledW, INPUT_HEIGHT).data;

  // Single-channel grayscale buffer of shape [1, INPUT_HEIGHT, INPUT_WIDTH]
  const planeSize = INPUT_HEIGHT * INPUT_WIDTH;
  const buffer = new Float32Array(planeSize);

  for (let row = 0; row < INPUT_HEIGHT; row++) {
    // Read the rightmost pixel in this row to replicate for right padding
    const lastColIdx = (row * scaledW + (scaledW - 1)) * 4;
    const lastColGray =
      0.299 * raw[lastColIdx] +
      0.587 * raw[lastColIdx + 1] +
      0.114 * raw[lastColIdx + 2];
    const lastColNorm = (lastColGray / 255.0) * 2.0 - 1.0;

    for (let col = 0; col < INPUT_WIDTH; col++) {
      const destIdx = row * INPUT_WIDTH + col;
      if (col < scaledW) {
        const srcIdx = (row * scaledW + col) * 4;
        const gray =
          0.299 * raw[srcIdx] +
          0.587 * raw[srcIdx + 1] +
          0.114 * raw[srcIdx + 2];
        buffer[destIdx] = (gray / 255.0) * 2.0 - 1.0;
      } else {
        // Replicate last column to the right edge (matches PyTorch NormalizePAD)
        buffer[destIdx] = lastColNorm;
      }
    }
  }

  return buffer;
}

/**
 * Parses vocabulary from `ocr-opt.txt`.
 * The file contains multiple option blocks; the final section defines the active
 * 2588 characters (+ 1 CTC blank = 2589 classes).
 */
export function parsePororoVocab(optText: string): string[] {
  let characterString = "";

  for (const line of optText.split("\n")) {
    const l = line.trim();
    if (l.startsWith("character:")) {
      characterString = l.slice("character:".length).trim();
    }
  }

  if (!characterString) {
    throw new Error("Failed to parse 'character' set from Pororo ocr-opt.txt");
  }

  // Index 0 is [blank] for CTC loss/decoding, followed by the characters
  const vocab = ["[blank]", ...Array.from(characterString)];
  if (vocab.length !== NUM_CLASSES) {
    console.warn(
      `[pororo] Vocab length (${vocab.length}) differs from expected (${NUM_CLASSES})`,
    );
  }

  return vocab;
}

export class PororoOcrEngine implements OcrEngine {
  id = "pororo";
  label = "Pororo OCR (Korean Specialist)";

  private session: ort.InferenceSession | null = null;
  private vocab: string[] | null = null;
  private runLock: Promise<void> = Promise.resolve();

  async release(): Promise<void> {
    if (this.session) {
      try {
        await this.session.release();
      } catch (err) {
        console.warn("Failed to release Pororo OCR session:", err);
      }
      this.session = null;
      this.vocab = null;
    }
  }

  private async ensureModels(): Promise<void> {
    if (this.session && this.vocab) return;

    const repo = env.pororoModelRepo;
    const [recModel, optResp] = await Promise.all([
      downloadArtifactHF(repo, "brainocr.onnx"),
      downloadArtifactHF(repo, "ocr-opt.txt"),
    ]);

    this.session = recModel as ort.InferenceSession;
    const optText = await (optResp as Response).text();
    this.vocab = parsePororoVocab(optText);
  }

  async recognize(
    bitmap: ImageBitmap,
    bboxes: Bbox[],
    sourceLang: string,
    regionLines: ImageData[][],
    gateSkip: (GateReason | null)[],
    options?: {
      minConfidence?: number;
      batchSize?: number;
      recImgHeight?: number;
      langGroup?: string;
    },
  ): Promise<SingleOcrResult[]> {
    await this.ensureModels();
    if (!this.session || !this.vocab) {
      throw new Error("Pororo OCR uninitialized");
    }

    const minConfidence = options?.minConfidence ?? DefaultConfig.ocrMinConfidence;
    const batchSize = options?.batchSize ?? DefaultConfig.ocrBatchSize;

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
    this.runLock = this.runLock.catch(() => {}).then(async () => {
      result = await this.runBatches(
        crops,
        batchSize,
        minConfidence,
        bboxes.length,
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
            this.id,
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
      this.runLock = this.runLock.catch(() => {}).then(async () => {
        retryResults = await this.runBatches(
          retryCrops,
          batchSize,
          minConfidence * 0.7,
          failedIndexes.length,
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
    minConfidence: number,
    numBboxes: number,
  ): Promise<SingleOcrResult[]> {
    if (!this.session || !this.vocab) {
      throw new Error("Pororo OCR session or vocab not initialized");
    }

    const stitchedResults = Array.from({ length: numBboxes }, () => ({
      text: "",
      totalConf: 0,
      lineCount: 0,
    }));

    const vocab = this.vocab;
    const numClasses = vocab.length;
    const slicePixels = INPUT_HEIGHT * INPUT_WIDTH;

    for (let start = 0; start < crops.length; start += batchSize) {
      await yieldToMain();
      const end = Math.min(crops.length, start + batchSize);
      const batchData = crops.slice(start, end);
      const N = batchData.length;

      if (N === 0) continue;

      const batchBuffer = new Float32Array(N * slicePixels);
      for (let i = 0; i < N; i++) {
        const lineBuffer = preprocessPororoLine(batchData[i].imageData);
        batchBuffer.set(lineBuffer, i * slicePixels);
      }

      const inputTensor = new ort.Tensor("float32", batchBuffer, [
        N,
        1,
        INPUT_HEIGHT,
        INPUT_WIDTH,
      ]);

      await yieldToMain();
      let output: ort.Tensor | null = null;
      try {
        const inputName = this.session.inputNames[0] ?? "images";
        const outputMap = await this.session.run({ [inputName]: inputTensor });
        await yieldToMain();

        const outputName = this.session.outputNames[0] ?? "prediction";
        output = outputMap[outputName];
        const outputData = output.data as Float32Array;

        // Output shape is [N, TIME_STEPS, numClasses]
        const stepStride = numClasses;
        const batchStride = TIME_STEPS * stepStride;

        for (let i = 0; i < N; i++) {
          const batchOffset = i * batchStride;
          const decodedChars: string[] = [];
          const keptProbs: number[] = [];
          let prevIdx = -1;

          for (let t = 0; t < TIME_STEPS; t++) {
            const stepOffset = batchOffset + t * stepStride;
            let bestIdx = 0;
            let maxLogit = -Infinity;

            // Find argmax for time step t
            for (let c = 0; c < numClasses; c++) {
              const val = outputData[stepOffset + c];
              if (val > maxLogit) {
                maxLogit = val;
                bestIdx = c;
              }
            }

            // CTC collapsing: skip blank (index 0) and repeat of previous token
            if (bestIdx !== 0 && bestIdx !== prevIdx) {
              // Compute softmax probability for maxLogit
              let sumExp = 0;
              for (let c = 0; c < numClasses; c++) {
                sumExp += Math.exp(outputData[stepOffset + c] - maxLogit);
              }
              const prob = 1.0 / Math.max(1e-8, sumExp);

              decodedChars.push(vocab[bestIdx] ?? "");
              keptProbs.push(prob);
            }
            prevIdx = bestIdx;
          }

          const text = decodedChars.join("");
          const confidence =
            keptProbs.length > 0
              ? keptProbs.reduce((a, b) => a + b, 0) / keptProbs.length
              : 0;

          const textLen = text.trim().length;
          if (confidence >= minConfidence && textLen > 0) {
            const newText = text.trim();
            // Single Hangul characters are full words in Korean (e.g. 네, 왜, 뭐, 응, 야);
            // do not drop them with the ASCII-noise 0.75 penalty.
            const isHangul = /[\uAC00-\uD7AF\u1100-\u11FF]/.test(newText);
            const isSingleCharNoise =
              !isHangul &&
              textLen === 1 &&
              confidence < Math.max(minConfidence, 0.75);

            if (!isSingleCharNoise) {
              const bboxIdx = batchData[i].originalBboxIndex;
              const target = stitchedResults[bboxIdx];

              if (target.text.endsWith("-")) {
                target.text = target.text.slice(0, -1) + newText;
              } else {
                target.text += (target.text ? " " : "") + newText;
              }

              target.totalConf += confidence;
              target.lineCount += 1;
            }
          }
        }
      } finally {
        inputTensor?.dispose?.();
        output?.dispose?.();
      }
    }

    return stitchedResults.map(({ text, totalConf, lineCount }) => {
      if (lineCount === 0) {
        return { text: "", confidence: 0, failed: true };
      }
      return {
        text,
        confidence: totalConf / lineCount,
        failed: text.length === 0,
      };
    });
  }
}
