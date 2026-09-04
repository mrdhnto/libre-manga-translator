import * as ort from "onnxruntime-web/all";

// Configure ONNX Runtime once. Lower log level to "error" so the noisy
// "removing requested execution provider ... not available" and
// "Unknown CPU vendor" warnings stop spamming the console while real errors
// still surface. (svelte-check/dev unaffected; runtime-level setting only.)
ort.env.logLevel = "error";

// Build the execution-provider list from what this browser actually supports.
// IMPORTANT: we deliberately EXCLUDE the "webgpu" (jsep) EP. ORT's WebGPU
// backend compiles glue code via `new Function()` (see
// ort-wasm-simd-threaded.jsep.mjs) which our MV3 CSP blocks
// (`script-src 'self' 'wasm-unsafe-eval'` - no 'unsafe-eval'). When blocked,
// the uncaught CSP error kills the offscreen document mid-run, the background
// message promise never resolves, and the overlay hangs on
// "Please wait while we translate the text..." forever.
// WebLLM (the actual translation model) uses its OWN WebGPU path and is NOT
// affected by this - only YOLO detection + PaddleOCR lose GPU acceleration and
// fall back to WASM (slower but works).
export function resolveExecutionProviders(): readonly string[] {
  const providers: string[] = [];
  if ("ml" in navigator) providers.push("webnn");
  // NOTE: "webgpu" deliberately omitted - see comment above.
  providers.push("wasm");
  return providers;
}
