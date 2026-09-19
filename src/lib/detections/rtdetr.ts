import * as ort from "onnxruntime-web/all";
import { fetchAsImageBitmap } from "../utils";
import { containmentNMS } from "./utils";
import { refineDetections } from "./boxes";

/**
 * RT-DETR-v2 detector wrapper for `ogkalu/comic-text-and-bubble-detector`
 * Model: `detector-v4-s_int8.onnx` (Apache-2.0, ~11.1 MB).
 * Classes: 0: bubble, 1: text_bubble, 2: text_free.
 */
export async function runRtDetrDetection(
  session: ort.InferenceSession,
  imageSrc: string,
  minConfidence = 0.35,
): Promise<Bbox[]> {
  const bitmap = await fetchAsImageBitmap(imageSrc);
  const origWidth = bitmap.width;
  const origHeight = bitmap.height;

  const INPUT_SIZE = 640;
  const canvas = new OffscreenCanvas(INPUT_SIZE, INPUT_SIZE);
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0, INPUT_SIZE, INPUT_SIZE);
  bitmap.close();

  const imgData = ctx.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE);
  const plane = INPUT_SIZE * INPUT_SIZE;
  const buffer = new Float32Array(3 * plane);

  for (let i = 0; i < plane; i++) {
    const idx = i * 4;
    buffer[i] = imgData.data[idx] / 255.0;
    buffer[plane + i] = imgData.data[idx + 1] / 255.0;
    buffer[plane * 2 + i] = imgData.data[idx + 2] / 255.0;
  }

  const imageTensor = new ort.Tensor("float32", buffer, [1, 3, INPUT_SIZE, INPUT_SIZE]);
  // Model contract measured: width first [origWidth, origHeight]
  const sizeArray = new BigInt64Array([BigInt(origWidth), BigInt(origHeight)]);
  const sizeTensor = new ort.Tensor("int64", sizeArray, [1, 2]);

  const inNames = session.inputNames;
  const feeds: Record<string, ort.Tensor> = {};
  feeds[inNames[0] ?? "images"] = imageTensor;
  feeds[inNames[1] ?? "orig_target_sizes"] = sizeTensor;

  const results = await session.run(feeds);
  const labelsData = (await results["labels"].getData()) as BigInt64Array | Int32Array;
  const boxesData = (await results["boxes"].getData()) as Float32Array;
  const scoresData = (await results["scores"].getData()) as Float32Array;

  const textBoxes: Bbox[] = [];
  const bubbleBoxes: Bbox[] = [];
  const count = Math.min(labelsData.length, scoresData.length);

  for (let i = 0; i < count; i++) {
    const score = scoresData[i];
    if (score < minConfidence) continue;
    const label = Number(labelsData[i]);

    const x1 = Math.max(0, Math.min(origWidth, boxesData[i * 4]));
    const y1 = Math.max(0, Math.min(origHeight, boxesData[i * 4 + 1]));
    const x2 = Math.max(0, Math.min(origWidth, boxesData[i * 4 + 2]));
    const y2 = Math.max(0, Math.min(origHeight, boxesData[i * 4 + 3]));
    if (x2 - x1 < 4 || y2 - y1 < 4) continue;

    const box: Bbox = { x1, y1, x2, y2, confidence: score };
    if (label === 1 || label === 2) {
      textBoxes.push(box);
    } else if (label === 0) {
      bubbleBoxes.push(box);
    }
  }

  // If text boxes found, use them; if only bubbles found, fall back to bubbles
  const targetBoxes = textBoxes.length > 0 ? textBoxes : bubbleBoxes;
  const nms = containmentNMS(targetBoxes);
  return refineDetections(nms, origWidth, origHeight).boxes;
}
