import * as ort from "onnxruntime-web/all";
import { downloadArtifactFromUrl, downloadArtifactHF } from "../utils";
import { scalingImage, restoreBoundingBox, containmentNMS } from "./utils";
import { refineDetections } from "./boxes";
import { DefaultConfig } from "../configs";
import { runRtDetrDetection } from "./rtdetr";
import { runComicTextDetection } from "./comictext";
import { clearSegmentation } from "./segmentation";

ort.env.wasm.wasmPaths = browser.runtime.getURL("/");

let session: ort.InferenceSession | null = null;
let currentModelName: string | null = null;
let runLock: Promise<void> = Promise.resolve();

async function loadDetectionSession(
  model: string,
  autoUpdate: boolean,
): Promise<ort.InferenceSession> {
  if (model === "comic-bubble") {
    return (await downloadArtifactHF(
      DefaultConfig.rtdetrModelRepo,
      "detector-v4-s_int8.onnx",
      autoUpdate,
    )) as ort.InferenceSession;
  }

  if (model === "comic-text-detector") {
    return await downloadArtifactFromUrl(
      DefaultConfig.comicTextDetectorUrl,
      "comic-text-detector",
      autoUpdate,
    );
  }

  return (await downloadArtifactHF(
    DefaultConfig.detectionModelRepo,
    DefaultConfig.detectionModelPath(model),
    autoUpdate,
  )) as ort.InferenceSession;
}

export async function detectTextBubble(
  imageSrc: string,
  minConfidence: number = DefaultConfig.detectionMinConfidence,
  requestedModel: string = DefaultConfig.detectionModels[0].id,
  autoUpdate: boolean = DefaultConfig.detectionAutoUpdate,
): Promise<Bbox[]> {
  if (session && currentModelName !== requestedModel) {
    try {
      await session.release();
    } catch (error) {
      console.warn("Failed to cleanly release the previous session:", error);
    }
    session = null;
  }

  if (!session) {
    session = await loadDetectionSession(requestedModel, autoUpdate);
    currentModelName = requestedModel;
  }

  let result: Bbox[] = [];
  runLock = runLock.then(async () => {
    if (!session) throw new Error("Detection session uninitialized");

    if (requestedModel === "comic-bubble") {
      clearSegmentation();
      result = await runRtDetrDetection(session, imageSrc, minConfidence);
    } else if (requestedModel === "comic-text-detector") {
      result = await runComicTextDetection(session, imageSrc, minConfidence);
    } else {
      clearSegmentation();
      const { imageData, origWidth, origHeight } = await scalingImage(imageSrc);
      result = await runYoloDetection(
        session,
        imageData,
        origWidth,
        origHeight,
        minConfidence,
      );
    }
  });

  await runLock;
  return result;
}

async function runYoloDetection(
  session: ort.InferenceSession,
  imageData: ImageData,
  origWidth: number,
  origHeight: number,
  minConfidence: number,
): Promise<Bbox[]> {
  const targetSize = imageData.width;
  const channelSize = targetSize * targetSize;
  const imageBuffer = new Float32Array(3 * channelSize);

  for (let i = 0; i < channelSize; i++) {
    const rgbaIndex = i * 4;
    imageBuffer[i] = imageData.data[rgbaIndex] / 255.0;
    imageBuffer[i + channelSize] = imageData.data[rgbaIndex + 1] / 255.0;
    imageBuffer[i + channelSize * 2] = imageData.data[rgbaIndex + 2] / 255.0;
  }

  const inputTensor = new ort.Tensor("float32", imageBuffer, [
    1,
    3,
    targetSize,
    targetSize,
  ]);

  const inputName = session.inputNames[0];
  const results = await session.run({ [inputName]: inputTensor });
  const outputName = session.outputNames[0];
  const detections = (await results[outputName].getData()) as Float32Array;

  const formattedDetections: Bbox[] = [];

  for (let i = 0; i < detections.length; i += 6) {
    const x1 = detections[i];
    const y1 = detections[i + 1];
    const x2 = detections[i + 2];
    const y2 = detections[i + 3];
    const confidence = detections[i + 4];

    if (Number.isNaN(confidence) || confidence < minConfidence) {
      continue;
    }
    formattedDetections.push(
      restoreBoundingBox(
        {
          x1,
          y1,
          x2,
          y2,
          confidence,
        },
        origWidth,
        origHeight,
        targetSize,
      ),
    );
  }

  const nms = containmentNMS(formattedDetections);
  return refineDetections(nms, origWidth, origHeight).boxes;
}
