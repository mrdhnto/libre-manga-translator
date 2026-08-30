// Centralized env access. All WXT_* vars read here once; use these everywhere.
// Avoids "undefined/releases/latest" and similar from unset vars at call sites.

export const env = {
  githubRepo: import.meta.env.WXT_GITHUB_REPO || "",
  telemetryUrl: import.meta.env.WXT_TELEMETRY_URL || "",
  telemetryPublicKey: import.meta.env.WXT_TELEMETRY_PUBLIC_KEY || "",
  detectionModelRepo:
    import.meta.env.WXT_DETECTION_MODEL_REPO || "Kiuyha/Manga-Bubble-YOLO",
  ocrModelRepo: import.meta.env.WXT_OCR_MODEL_REPO || "Kiuyha/paddleocr-onnx",
  privacyUrl: import.meta.env.WXT_PRIVACY_URL || "https://raw.githubusercontent.com/mrdhnto/libre-manga-translator/refs/heads/main/privacy.md",
};

export const hasGithubRepo = () => !!env.githubRepo;
export const hasTelemetry = () => !!env.telemetryUrl && !!env.telemetryPublicKey;
