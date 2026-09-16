// Centralized env access. All WXT_* vars read here once; use these everywhere.
// Avoids "undefined/releases/latest" and similar from unset vars at call sites.

export const env = {
  githubRepo: import.meta.env.WXT_GITHUB_REPO || "",
  telemetryUrl: import.meta.env.WXT_TELEMETRY_URL || "",
  telemetryPublicKey: import.meta.env.WXT_TELEMETRY_PUBLIC_KEY || "",
  detectionModelRepo:
    import.meta.env.WXT_DETECTION_MODEL_REPO || "Kiuyha/Manga-Bubble-YOLO",
  ocrModelRepo: import.meta.env.WXT_OCR_MODEL_REPO || "monkt/paddleocr-onnx",
  // Script-ID gate model (Apache-2.0). Env override reserved for a future
  // re-host; pins recorded at adoption (osd_lstm.onnx
  // b18e0c1479d9eb67394993098f7e1079c9a93ef6f7b0416ee333fccb865c6e72,
  // osd_labels.json a1888156b005065039c356e13a7bbef1ec454b45bf6aaf18c11f4a59b1ee35c5).
  gateModelRepo:
    import.meta.env.WXT_GATE_MODEL_REPO || "ogkalu/image-script-identification",
  privacyUrl: import.meta.env.WXT_PRIVACY_URL || "https://raw.githubusercontent.com/mrdhnto/libre-manga-translator/refs/heads/main/privacy.md",
};

export const hasGithubRepo = () => !!env.githubRepo;
export const hasTelemetry = () => !!env.telemetryUrl && !!env.telemetryPublicKey;
