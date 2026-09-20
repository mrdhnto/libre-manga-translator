import * as ort from "onnxruntime-web/all";
import { downloadArtifactHF } from "../models";
import { DefaultConfig } from "../configs";
import type { OcrEngine, SingleOcrResult } from "./types";
import type { GateReason } from "../gate";

const INPUT_SIDE = 224;
const PAD = 0;
const CLS = 2;
const SEP = 3;
const FIRST_ORDINARY = 5;
const MAX_TOKENS = 64;

export class MangaOcrEngine implements OcrEngine {
  id = "manga-ocr";
  label = "Manga-OCR (Japanese Specialist)";

  private encoderSession: ort.InferenceSession | null = null;
  private decoderSession: ort.InferenceSession | null = null;
  private vocab: string[] | null = null;
  private runLock: Promise<void> = Promise.resolve();

  async release(): Promise<void> {
    if (this.encoderSession) {
      try {
        await this.encoderSession.release();
      } catch (err) {
        console.warn("Failed to release Manga-OCR encoder:", err);
      }
      this.encoderSession = null;
    }
    if (this.decoderSession) {
      try {
        await this.decoderSession.release();
      } catch (err) {
        console.warn("Failed to release Manga-OCR decoder:", err);
      }
      this.decoderSession = null;
    }
    this.vocab = null;
  }

  private async ensureModels(autoUpdate = true): Promise<void> {
    if (this.encoderSession && this.decoderSession && this.vocab) return;

    const repo = DefaultConfig.mangaOcrRepo;
    const [enc, dec, vocabResp] = await Promise.all([
      downloadArtifactHF(repo, "encoder_model.onnx", autoUpdate),
      downloadArtifactHF(repo, "decoder_model.onnx", autoUpdate),
      downloadArtifactHF(repo, "vocab.txt", autoUpdate),
    ]);

    this.encoderSession = enc as ort.InferenceSession;
    this.decoderSession = dec as ort.InferenceSession;

    const vocabText = await (vocabResp as Response).text();
    this.vocab = vocabText
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
  }

  async recognize(
    bitmap: ImageBitmap,
    bboxes: Bbox[],
    _sourceLang: string,
    _regionLines: ImageData[][],
    gateSkip: (GateReason | null)[],
    options?: { autoUpdate?: boolean },
  ): Promise<SingleOcrResult[]> {
    await this.ensureModels(options?.autoUpdate);
    if (!this.encoderSession || !this.decoderSession || !this.vocab) {
      throw new Error("Manga-OCR sessions uninitialized");
    }

    const results: SingleOcrResult[] = new Array(bboxes.length);

    this.runLock = this.runLock.then(async () => {
      for (let i = 0; i < bboxes.length; i++) {
        if (gateSkip[i]) {
          results[i] = { text: "", confidence: 0, failed: false };
          continue;
        }

        const bbox = bboxes[i];
        const bw = Math.max(1, bbox.x2 - bbox.x1);
        const bh = Math.max(1, bbox.y2 - bbox.y1);

        // Squashed resize to 224x224 (ViT model trained on squashed manga crops)
        const canvas = new OffscreenCanvas(INPUT_SIDE, INPUT_SIDE);
        const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
        ctx.drawImage(bitmap, bbox.x1, bbox.y1, bw, bh, 0, 0, INPUT_SIDE, INPUT_SIDE);
        const img = ctx.getImageData(0, 0, INPUT_SIDE, INPUT_SIDE);

        const plane = INPUT_SIDE * INPUT_SIDE;
        const pixelValues = new Float32Array(3 * plane);

        for (let p = 0; p < plane; p++) {
          const r = img.data[p * 4];
          const g = img.data[p * 4 + 1];
          const b = img.data[p * 4 + 2];
          // Grayscale normalized to [-1, 1] via (v / 255 - 0.5) / 0.5
          const gray = (0.299 * r + 0.587 * g + 0.114 * b) / 255.0;
          const norm = (gray - 0.5) / 0.5;
          pixelValues[p] = norm;
          pixelValues[plane + p] = norm;
          pixelValues[plane * 2 + p] = norm;
        }

        try {
          const encTensor = new ort.Tensor("float32", pixelValues, [
            1,
            3,
            INPUT_SIDE,
            INPUT_SIDE,
          ]);
          const encFeeds: Record<string, ort.Tensor> = {};
          const encIn = this.encoderSession!.inputNames[0] ?? "pixel_values";
          encFeeds[encIn] = encTensor;

          const encOut = await this.encoderSession!.run(encFeeds);
          const hiddenState =
            encOut["last_hidden_state"] ?? encOut[Object.keys(encOut)[0]];

          // Autoregressive greedy decoding
          let tokens: bigint[] = [BigInt(CLS)];
          let text = "";
          let steps = 0;

          const decInNames = this.decoderSession!.inputNames;
          const inputIdsName = decInNames.find((n) => n.includes("input_ids")) ?? "input_ids";
          const hiddenName =
            decInNames.find((n) => n.includes("encoder_hidden_states") || n.includes("hidden")) ??
            "encoder_hidden_states";

          while (steps < MAX_TOKENS) {
            const idsTensor = new ort.Tensor("int64", new BigInt64Array(tokens), [
              1,
              tokens.length,
            ]);
            const decFeeds: Record<string, ort.Tensor> = {
              [inputIdsName]: idsTensor,
              [hiddenName]: hiddenState,
            };

            const decOut = await this.decoderSession!.run(decFeeds);
            const logitsTensor = decOut["logits"] ?? decOut[Object.keys(decOut)[0]];
            const logits = logitsTensor.data as Float32Array;
            const numClasses = this.vocab!.length;

            const lastRowOffset = (tokens.length - 1) * numClasses;
            let bestId = 0;
            let maxLogit = -Infinity;

            for (let c = 0; c < numClasses; c++) {
              const val = logits[lastRowOffset + c];
              if (val > maxLogit) {
                maxLogit = val;
                bestId = c;
              }
            }

            steps++;
            if (bestId === SEP || bestId === PAD) break;

            if (bestId >= FIRST_ORDINARY && bestId < this.vocab!.length) {
              const piece = this.vocab![bestId];
              text += piece.startsWith("##") ? piece.slice(2) : piece;
            }

            tokens.push(BigInt(bestId));
          }

          results[i] = {
            text: text.trim(),
            confidence: text.length > 0 ? 0.9 : 0.0,
            failed: text.length === 0,
          };
        } catch (err) {
          console.warn("Manga-OCR inference error on box", i, err);
          results[i] = { text: "", confidence: 0, failed: true };
        }
      }
    });

    await this.runLock;
    return results;
  }
}
