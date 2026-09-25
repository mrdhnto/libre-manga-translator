/**
 * Resource SHA-256 Checksum Manifest & Verification
 * Used to verify integrity of downloaded AI model weights and dictionary files.
 */

/**
 * Known SHA-256 hashes for pinned model releases and critical artifacts.
 * Key can be file path (e.g. 'languages/latin/rec.onnx') or filename.
 */
export const KNOWN_MODEL_SHA256: Record<string, string> = {
  // Script gate (ogkalu/image-script-identification)
  "osd_lstm.onnx": "b18e0c1479d9eb67394993098f7e1079c9a93ef6f7b0416ee333fccb865c6e72",
  "osd_labels.json": "a1888156b005065039c356e13a7bbef1ec454b45bf6aaf18c11f4a59b1ee35c5",
  // Detection
  "detector-v4-s_int8.onnx": "5fe9e4f576e49d4e7e8b0e029d6d3cdc252abd4694113e1cae120e62c931ea79",
  "comictextdetector.pt.onnx": "1a86ace74961413cbd650002e7bb4dcec4980ffa21b2f19b86933372071d718f",
  // Inpaint (ogkalu/lama-manga-onnx-dynamic)
  "lama-manga-dynamic.onnx": "de31ffa5ba26916b8ea35319f6c12151ff9654d4261bccf0583a69bb095315f9",
  // Inpaint legacy static (mayocream/lama-manga-onnx)
  "lama-manga.onnx": "4512adab295ee5a5e02ccd1bdf8d45dccbac88309d9cff1532ffd5de876f02a4",
  // OCR Japanese PP-OCRv6 (fumetodev/PP-OCRv6_small_rec_manga_ONNX)
  "ppocr-rec-v6-small-manga.onnx": "c5cc5038a98c3df3e2d37de5716f603e2b0bcd3536c74078fdd91876a48a25ef",
  // Manga-OCR (mayocream/manga-ocr-onnx)
  "encoder_model.onnx": "15fa8155fe9bc1a7d25d9bb353debaa4def033d0174e907dbd2dd6d995def85f",
  "decoder_model.onnx": "ef7765261e9d1cdc34d89356986c2bbc2a082897f753a89605ae80fdfa61f5e8",
  "vocab.txt": "5cb5c5586d98a2f331d9f8828e4586479b0611bfba5d8c3b6dadffc84d6a36a3",
  // PaddleOCR packs (monkt/paddleocr-onnx) — full-path keys; filenames collide on rec.onnx
  "languages/arabic/rec.onnx": "7982d371612785238fd99080cff36354deaec84fdc6ff7da9c82af4243fa0c9a",
  "languages/arabic/dict.txt": "637c27c88512c22089bef927b34ada08f748dc132ac70facd68d8202384c2726",
  "languages/chinese/rec.onnx": "26fa4f47060f58e25962b9af6beaee05c8182b90e026c4ecc6db165d9dfdc38a",
  "languages/chinese/dict.txt": "d1979e9f794c464c0d2e0b70a7fe14dd978e9dc644c0e71f14158cdf8342af1b",
  "languages/english/rec.onnx": "4e16deb22c4da6468bdca539b2cd3c8687825538b67109177c47d359ab994cd7",
  "languages/english/dict.txt": "e025a66d31f327ba0c232e03f407ae8d105e1e709e7ccb3f408aa778c24e70d6",
  "languages/eslav/rec.onnx": "dc6bf0e855247decce214ba6dae5bc135fa0ad725a5918a7fcfb59fad6c9cdee",
  "languages/eslav/dict.txt": "3e95f1581557162870cacdba5af91a4c6be2890710d395b0c3c7578e7ee5e6eb",
  "languages/greek/rec.onnx": "13373f736dbb229e96945fc41c2573403d91503b0775c7b7294839e0c5f3a7a3",
  "languages/greek/dict.txt": "31defc62c0c3ad3674a82da6192226a2ba98ef4ff014a7045cb88d59f9c3de31",
  "languages/hindi/rec.onnx": "43df175fa3c877fbf7bcc4e5bd1e203e24ec450cd3ea96c9e802c86e39a4d4cf",
  "languages/hindi/dict.txt": "b5f1be6d8bbff1a19fb96c5d4ca96a423380234bb7d2ce0e07b5838adb4d18ea",
  "languages/korean/rec.onnx": "322f140154c820fcb83c3d24cfe42c9ec70dd1a1834163306a7338136e4f1eaa",
  "languages/korean/dict.txt": "a88071c68c01707489baa79ebe0405b7beb5cca229f4fc94cc3ef992328802d7",
  "languages/latin/rec.onnx": "614ffc2d6d3902d360fad7f1b0dd455ee45e877069d14c4e51a99dc4ef144409",
  "languages/latin/dict.txt": "3c0a8a79b612653c25f765271714f71281e4e955962c153e272b7b8c1d2b13ff",
  "languages/tamil/rec.onnx": "fba9a00af746c8f3ef4f091cf966880222cd7245a60f6a953670593630c0ca4f",
  "languages/tamil/dict.txt": "e93e694814afd9ff1e918b6f4bb4267fb4c65a9344ee5d7464f9135b90c0a270",
  "languages/telugu/rec.onnx": "669946d9ad4de93e8d1b13f7e72c59cc2cc2de91bb24e22aad7503a6cc5757ee",
  "languages/telugu/dict.txt": "ee9946a60d7701977474e89883694a4ca20eaa3868a23334bf7940dcd008f0f9",
  "languages/thai/rec.onnx": "2b6e56b1872200349e227574c25aeb0e0f9af9b8356e9ff5f75ac543a535669a",
  "languages/thai/dict.txt": "57f5406f94bb6688fb7077f7be65f08bbd71cecf48c01ea26c522cb5c4836b7a",
};

/**
 * Computes hexadecimal SHA-256 digest of an ArrayBuffer via Web Crypto API.
 */
export async function computeBufferSha256(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  const bytes = new Uint8Array(digest);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return hex.toLowerCase();
}

/**
 * Compares an ArrayBuffer's SHA-256 against an expected hex string.
 */
export async function verifyBufferSha256(
  buffer: ArrayBuffer,
  expectedHex: string,
): Promise<boolean> {
  if (!expectedHex || expectedHex.trim().length === 0) return true;
  const actual = await computeBufferSha256(buffer);
  return actual === expectedHex.trim().toLowerCase();
}

/**
 * Resolves expected SHA-256 for a given model path or URL if configured.
 */
export function getExpectedSha256(path: string, url?: string): string | null {
  const cleanPath = path.replace(/^\/+/, "");
  if (KNOWN_MODEL_SHA256[cleanPath]) return KNOWN_MODEL_SHA256[cleanPath];

  const filename = cleanPath.split("/").pop() ?? cleanPath;
  if (KNOWN_MODEL_SHA256[filename]) return KNOWN_MODEL_SHA256[filename];

  if (url) {
    const urlFilename = url.split("?")[0].split("/").pop();
    if (urlFilename && KNOWN_MODEL_SHA256[urlFilename]) {
      return KNOWN_MODEL_SHA256[urlFilename];
    }
  }

  return null;
}
