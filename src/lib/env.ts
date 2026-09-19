// Centralized env access. All WXT_* vars read here once; use these everywhere.
// Avoids "undefined/releases/latest" and similar from unset vars at call sites.

export const env = {
  githubRepo: import.meta.env.WXT_GITHUB_REPO || "",
  telemetryUrl: import.meta.env.WXT_TELEMETRY_URL || "",
  telemetryPublicKey: import.meta.env.WXT_TELEMETRY_PUBLIC_KEY || "",

  // Detection models
  yoloDetectionModelRepo:
    import.meta.env.WXT_YOLO_DETECTION_MODEL_REPO || "Kiuyha/Manga-Bubble-YOLO",
  rtdetrModelRepo:
    import.meta.env.WXT_RTDETR_MODEL_REPO ||
    "ogkalu/comic-text-and-bubble-detector",
  comicTextDetectorUrl:
    import.meta.env.WXT_COMIC_TEXT_DETECTOR_URL ||
    "https://github.com/zyddnys/manga-image-translator/releases/download/beta-0.3/comictextdetector.pt.onnx",

  // OCR models
  paddleOCRModelRepo:
    import.meta.env.WXT_PADDLE_OCR_MODEL_REPO || "monkt/paddleocr-onnx",
  mangaOCRModelRepo:
    import.meta.env.WXT_MANGA_OCR_MODEL_REPO || "mayocream/manga-ocr-onnx",

  // Inpaint models
  lamaInpaintModelRepo:
    import.meta.env.WXT_LAMA_INPAINT_MODEL_REPO || "mayocream/lama-manga-onnx",

  // Script gate model (Apache-2.0)
  gateModelRepo:
    import.meta.env.WXT_GATE_MODEL_REPO || "ogkalu/image-script-identification",

  privacyUrl:
    import.meta.env.WXT_PRIVACY_URL ||
    "https://raw.githubusercontent.com/mrdhnto/libre-manga-translator/refs/heads/main/privacy.md",
};

export const hasGithubRepo = () => !!env.githubRepo;
export const hasTelemetry = () => !!env.telemetryUrl && !!env.telemetryPublicKey;
