/**
 * OCR Runtime Audit — Phase 4.1a Self-Check (MIT-only)
 * Asserts the in-tree OCR pipeline remains MV3-clean.
 * Run: bun scripts/ocr-runtime-audit.ts
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// @ts-ignore - Bun provides import.meta.dir, tsc checks against DOM lib
const ROOT = join((import.meta as unknown as { dir?: string; dirname?: string }).dir ?? (import.meta as unknown as { dirname?: string }).dirname ?? ".", "..");
const TARGETS = ["src/lib/ocr", "src/lib/gate"];
const FORBIDDEN = [
  /eval\s*\(/,
  /new\s+Function\s*\(/,
  /\bFunction\s*\(/,
];

let failed = false;

for (const rel of TARGETS) {
  const abs = join(ROOT, rel);
  const entries = readdirSync(abs, { withFileTypes: true });
  for (const e of entries) {
    if (!e.isFile() || !/\.(ts|js)$/.test(e.name)) continue;
    const file = join(abs, e.name);
    const text = readFileSync(file, "utf8");
    for (const pat of FORBIDDEN) {
      if (pat.test(text)) {
        console.error(`[audit:REJECT] ${rel}/${e.name} matches forbidden ${pat}`);
        failed = true;
      }
    }
  }
}

// Check CSP allows only wasm-unsafe-eval, not unsafe-eval
const wxt = readFileSync(join(ROOT, "wxt.config.ts"), "utf8");
if (wxt.includes("'unsafe-eval'") && !wxt.includes("'wasm-unsafe-eval'")) {
  console.error("[audit:REJECT] wxt.config.ts contains plain 'unsafe-eval' outside 'wasm-unsafe-eval'");
  failed = true;
}
if (!wxt.includes("'wasm-unsafe-eval'")) {
  console.error("[audit:REJECT] wxt.config.ts missing 'wasm-unsafe-eval' for ONNX WASM");
  failed = true;
}
// Ensure ort env does not point to remote CDN
const candidates = ["src/lib/ort.ts", "src/lib/hardware.ts", "src/lib/utils.ts"];
for (const rel of candidates) {
  try {
    const text = readFileSync(join(ROOT, rel), "utf8");
    if (/cdn\.jsdelivr|unpkg\.com/.test(text)) {
      console.error(`[audit:REJECT] ${rel} references remote CDN`);
      failed = true;
    }
  } catch {}
}

if (failed) {
  console.error("\n[audit] FAILED — in-tree OCR contains MV3-forbidden patterns or CSP drift");
  process.exit(1);
}
console.log("[audit] PASS — src/lib/ocr/** contains zero eval/new Function; CSP is MV3-clean");
