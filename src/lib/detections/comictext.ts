import * as ort from "onnxruntime-web/all";
import { scalingImage, restoreBoundingBox, containmentNMS } from "./utils";
import { refineDetections } from "./boxes";
import { resizeSegmentation, setPageSegmentation } from "./segmentation";

/**
 * ComicTextDetector (dmMaze / manga-image-translator beta-0.3, GPL-3.0, ~95 MB).
 *
 * Tensor contract (spike 6 rule: bind by shape, not name/index):
 * - Input: `image`: Float32[1, 3, 1024, 1024], letterbox RGB 0..1.
 * - Outputs:
 *   - [1, N, 7]: detection head (cx, cy, w, h, obj_conf, cls0, cls1)
 *   - [1, 1, 1024, 1024]: text segmentation mask
 *   - [1, 2, 1024, 1024]: DBNet lines map (ignored)
 */
export async function runComicTextDetection(
  session: ort.InferenceSession,
  imageSrc: string,
  minConfidence = 0.4,
): Promise<Bbox[]> {
  const MODEL_SIZE = 1024;
  const { imageData, origWidth, origHeight } = await scalingImage(imageSrc, MODEL_SIZE);

  const channelSize = MODEL_SIZE * MODEL_SIZE;
  const imageBuffer = new Float32Array(3 * channelSize);

  for (let i = 0; i < channelSize; i++) {
    const rgba = i * 4;
    imageBuffer[i] = imageData.data[rgba] / 255.0;
    imageBuffer[i + channelSize] = imageData.data[rgba + 1] / 255.0;
    imageBuffer[i + channelSize * 2] = imageData.data[rgba + 2] / 255.0;
  }

  const inputTensor = new ort.Tensor("float32", imageBuffer, [1, 3, MODEL_SIZE, MODEL_SIZE]);
  const inputName = session.inputNames[0] ?? "image";
  const results = await session.run({ [inputName]: inputTensor });

  let headTensor: ort.Tensor | null = null;
  let segTensor: ort.Tensor | null = null;

  for (const name of session.outputNames) {
    const tensor = results[name];
    if (!tensor) continue;
    const dims = tensor.dims;
    if (dims.length === 3 && dims[0] === 1 && dims[2] === 7) {
      headTensor = tensor;
    } else if (dims.length === 4 && dims[0] === 1 && dims[1] === 1) {
      segTensor = tensor;
    }
  }

  // If output names didn't map cleanly, iterate all returned values
  if (!headTensor || !segTensor) {
    for (const key of Object.keys(results)) {
      const tensor = results[key];
      const dims = tensor.dims;
      if (dims.length === 3 && dims[0] === 1 && dims[2] === 7) {
        headTensor = tensor;
      } else if (dims.length === 4 && dims[0] === 1 && dims[1] === 1) {
        segTensor = tensor;
      }
    }
  }

  // Extract segmentation mask and cache it for the inpainting ladder
  if (segTensor) {
    const segData = (await segTensor.getData()) as Float32Array;
    const segH = segTensor.dims[2];
    const segW = segTensor.dims[3];
    const pageLevels = resizeSegmentation(
      segData,
      segW,
      segH,
      origWidth,
      origHeight,
      MODEL_SIZE,
    );
    setPageSegmentation(imageSrc, origWidth, origHeight, pageLevels);
  }

  const formattedDetections: Bbox[] = [];
  if (headTensor) {
    const headData = (await headTensor.getData()) as Float32Array;
    const numQueries = headTensor.dims[1];

    for (let i = 0; i < numQueries; i++) {
      const offset = i * 7;
      const cx = headData[offset];
      const cy = headData[offset + 1];
      const w = headData[offset + 2];
      const h = headData[offset + 3];
      const objConf = headData[offset + 4];
      const cls0 = headData[offset + 5];
      const cls1 = headData[offset + 6];

      const score = objConf * Math.max(cls0, cls1);
      if (score < minConfidence || Number.isNaN(score)) continue;

      const x1 = cx - w / 2;
      const y1 = cy - h / 2;
      const x2 = cx + w / 2;
      const y2 = cy + h / 2;

      formattedDetections.push(
        restoreBoundingBox(
          { x1, y1, x2, y2, confidence: score },
          origWidth,
          origHeight,
          MODEL_SIZE,
        ),
      );
    }
  }

  const nms = containmentNMS(formattedDetections, 0.35);
  return refineDetections(nms, origWidth, origHeight).boxes;
}
