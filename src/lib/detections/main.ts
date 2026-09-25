import * as ort from "onnxruntime-web/all";
import { downloadArtifactFromUrl, downloadArtifactHF, yieldToMain } from "../utils";
import { DefaultConfig, normalizeDetectionModel } from "../configs";
import { runRtDetrDetection } from "./rtdetr";
import { runComicTextDetection } from "./comictext";
import { clearSegmentation } from "./segmentation";

ort.env.wasm.wasmPaths = browser.runtime.getURL("/");

let session: ort.InferenceSession | null = null;
let currentModelName: string | null = null;
let runLock: Promise<void> = Promise.resolve();

export const UNKNOWN_DETECTION_MODEL_MESSAGE = (model: string) =>
  `Unknown detection model "${model}". Re-run the setup wizard to pick a supported model: extension popup → Config tab → "Launch first-run setup wizard" (or page sidebar → System tab → Setup wizard → Launch Wizard).`;

async function loadDetectionSession(
  model: string,
): Promise<ort.InferenceSession> {
  if (model === "comic-bubble") {
    return (await downloadArtifactHF(
      DefaultConfig.rtdetrModelRepo,
      "detector-v4-s_int8.onnx",
    )) as ort.InferenceSession;
  }

  if (model === "comic-text-detector") {
    return await downloadArtifactFromUrl(
      DefaultConfig.comicTextDetectorUrl,
      "comic-text-detector",
    );
  }

  throw new Error(UNKNOWN_DETECTION_MODEL_MESSAGE(model));
}

export async function detectTextBubble(
  imageSrc: string,
  minConfidence: number = DefaultConfig.detectionMinConfidence,
  requestedModel: string = DefaultConfig.detectionModels[0].id,
): Promise<Bbox[]> {
  // Defensive: migrate stale stored ids (e.g. removed YOLO) at the gate.
  requestedModel = normalizeDetectionModel(requestedModel);
  if (session && currentModelName !== requestedModel) {
    try {
      await session.release();
    } catch (error) {
      console.warn("Failed to cleanly release the previous session:", error);
    }
    session = null;
  }

  if (!session) {
    session = await loadDetectionSession(requestedModel);
    currentModelName = requestedModel;
  }

  let result: Bbox[] = [];
  runLock = runLock.then(async () => {
    if (!session) throw new Error("Detection session uninitialized");
    await yieldToMain();

    if (requestedModel === "comic-bubble") {
      clearSegmentation();
      result = await runRtDetrDetection(session, imageSrc, minConfidence);
    } else if (requestedModel === "comic-text-detector") {
      result = await runComicTextDetection(session, imageSrc, minConfidence);
    } else {
      throw new Error(UNKNOWN_DETECTION_MODEL_MESSAGE(requestedModel));
    }
  });

  await runLock;
  await yieldToMain();
  return result;
}
