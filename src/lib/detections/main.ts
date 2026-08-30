import * as ort from "onnxruntime-web/all";
import { downloadArtifactHF } from "../utils";
import { scalingImage, restoreBoundingBox, containmentNMS } from "./utils";
import { DefaultConfig } from "../configs";

ort.env.wasm.wasmPaths = browser.runtime.getURL("/");

let session: ort.InferenceSession | null = null;
let currentModelName: string | null = null;
let runLock: Promise<void> = Promise.resolve();

export async function detectTextBubble(
  imageSrc: string,
  minConfidence: number = DefaultConfig.detectionMinConfidence,
  requestedModel: string = DefaultConfig.detectionModels[0].id,
  autoUpdate: boolean = DefaultConfig.detectionAutoUpdate,
) {
  if (session && currentModelName !== requestedModel) {
    try {
      // Free the hardware memory allocated by the previous model
      await session.release();
    } catch (error) {
      console.warn("Failed to cleanly release the previous session:", error);
    }
    session = null;
  }

  if (!session) {
    session = await downloadArtifactHF(
      DefaultConfig.detectionModelRepo,
      DefaultConfig.detectionModelPath(requestedModel),
      autoUpdate,
    );
    currentModelName = requestedModel;
  }

  const { imageData, origWidth, origHeight } = await scalingImage(imageSrc);

  let result!: ReturnType<typeof containmentNMS>;
  runLock = runLock.then(async () => {
    result = await runDetection(
      imageData,
      origWidth,
      origHeight,
      minConfidence,
    );
  });
  await runLock;
  return result;
}

async function runDetection(
  imageData: ImageData,
  origWidth: number,
  origHeight: number,
  minConfidence: number,
) {
  if (!session) throw new Error("Session not initialized");

  const targetSize = imageData.width;
  const channelSize = targetSize * targetSize;
  const imageBuffer = new Float32Array(3 * channelSize);

  // Separate the RGB channels and normalize them to 0.0 - 1.0
  for (let i = 0; i < channelSize; i++) {
    const rgbaIndex = i * 4;
    imageBuffer[i] = imageData.data[rgbaIndex] / 255.0;
    imageBuffer[i + channelSize] = imageData.data[rgbaIndex + 1] / 255.0;
    imageBuffer[i + channelSize * 2] = imageData.data[rgbaIndex + 2] / 255.0;
  }

  // Create the tensor and execute the YOLO model
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

  // Format the detections
  const formattedDetections = [];

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

  return containmentNMS(formattedDetections);
}
