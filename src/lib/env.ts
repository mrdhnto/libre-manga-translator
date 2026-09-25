// Centralized env access. All WXT_* vars read here once; use these everywhere.
// Avoids "undefined/releases/latest" and similar from unset vars at call sites.

export const env = {
  githubRepo: import.meta.env.WXT_GITHUB_REPO || "",

  // Detection models
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
  ppocrv6MangaRepo:
    import.meta.env.WXT_PPOCRV6_MANGA_REPO ||
    "fumetodev/PP-OCRv6_small_rec_manga_ONNX",

  // Inpaint models (dynamic-axes LaMa for WebGPU trial)
  lamaInpaintModelRepo:
    import.meta.env.WXT_LAMA_INPAINT_MODEL_REPO || "ogkalu/lama-manga-onnx-dynamic",

  // Script gate model (Apache-2.0)
  gateModelRepo:
    import.meta.env.WXT_GATE_MODEL_REPO || "ogkalu/image-script-identification",

  privacyUrl:
    import.meta.env.WXT_PRIVACY_URL ||
    "https://raw.githubusercontent.com/mrdhnto/libre-manga-translator/refs/heads/main/privacy.md",
};

export const hasGithubRepo = () => !!env.githubRepo;
