/**
 * Hardware probe + GPU offload contract — Phase 4.1b (MIT-only, LMT-native).
 *
 * Single ownership point for:
 *  - WebGPU `high-performance` adapter probe (`checkWebGPUHighPerf`)
 *  - Persisted GPU state (`normalizeGpuState`, cache `true` only)
 *  - ONNX execution-provider resolution (`resolveExecutionProviders`)
 *
 * This module is the *only* place that imports `onnxruntime-web` eagerly
 * for `ort.env.wasm.wasmPaths` configuration. All callers import
 * helpers from here, so the module identity is stable.
 */
import * as ort from "onnxruntime-web/all";

// Keep ort log level error-only (same as ort.ts legacy).
ort.env.logLevel = "error";

/**
 * Probe for a high-performance WebGPU adapter.
 * - Must run in offscreen/document context (service workers have no `navigator.gpu`).
 * - Returns false if no adapter, adapter is null, or probe throws.
 * - No side effects — caller decides persistence.
 */
export async function checkWebGPUHighPerf(): Promise<boolean> {
  try {
    const gpu: unknown = (globalThis as unknown as Record<string, unknown>).navigator
      ? (navigator as unknown as { gpu?: { requestAdapter: (opts: unknown) => Promise<unknown> } }).gpu
      : undefined;
    if (!gpu || typeof (gpu as { requestAdapter?: unknown }).requestAdapter !== "function") return false;
    const adapter = await (gpu as { requestAdapter: (opts: unknown) => Promise<unknown> }).requestAdapter({
      powerPreference: "high-performance",
    });
    return Boolean(adapter);
  } catch {
    return false;
  }
}

/**
 * Execution provider list for ONNX Runtime Web.
 * - When `gpu` is true: WebGPU + WASM fallback.
 * - When `gpu` is false: WASM only (MV3-safe).
 */
export function resolveExecutionProviders(gpu: boolean): readonly string[] {
  if (gpu) {
    return ["webgpu", "wasm"];
  }
  return ["wasm"];
}

/**
 * Models known to require WASM CPU execution because their ONNX graph
 * contains operators not supported by WebGPU:
 * - MaxPool with ceil_mode=1 (RT-DETR detector, PaddleOCR Chinese pack)
 * - LaMa FFC complex-Add (`/model/model.5/conv1/ffc/convg2g/Add` has no
 *   JSEP kernel in WebGPU — create() succeeds, run() throws)
 */
export function isModelWebGpuCapable(pathOrUrl: string): boolean {
  if (pathOrUrl.includes("detector-v4-s_int8.onnx")) return false;
  if (pathOrUrl.includes("chinese/rec.onnx") || pathOrUrl.includes("languages/chinese/rec.onnx")) return false;
  if (pathOrUrl.includes("lama-manga")) return false;
  return true;
}

/**
 * Resolve execution providers for a specific model path or URL.
 * Automatically restricts models with unsupported operators (e.g. ceil_mode=1)
 * to WASM CPU, while allowing compatible models to leverage WebGPU.
 */
export function resolveExecutionProvidersForModel(
  pathOrUrl: string,
  gpu?: boolean,
): readonly string[] {
  if (!isModelWebGpuCapable(pathOrUrl)) {
    return ["wasm"];
  }
  const useGpu = gpu ?? (typeof navigator !== "undefined" && "gpu" in navigator);
  return resolveExecutionProviders(useGpu);
}

/** Persisted GPU state shape (stored via `wxt/storage`). */
export interface GpuState {
  webgpuSupported: boolean | null; // null = unknown, true/false = probed
  webgpuMaster: boolean;
  webgpuOverrides: {
    llm: boolean;
    inpaint: boolean;
    ocr: boolean;
  };
}

export const DEFAULT_GPU_STATE: GpuState = {
  webgpuSupported: null,
  webgpuMaster: true,
  webgpuOverrides: { llm: true, inpaint: true, ocr: true },
};

/**
 * Deep-merge persisted GPU state over defaults.
 * - Sparse legacy objects (e.g. missing `webgpuOverrides`) are completed.
 * - Transient `false` probes are *not* persisted here — callers should only
 *   write `true` (verified high-performance) and leave `null` otherwise.
 */
export function normalizeGpuState(raw: Partial<GpuState> | undefined | null): GpuState {
  return {
    webgpuSupported: raw?.webgpuSupported ?? DEFAULT_GPU_STATE.webgpuSupported,
    webgpuMaster: raw?.webgpuMaster ?? DEFAULT_GPU_STATE.webgpuMaster,
    webgpuOverrides: {
      llm: raw?.webgpuOverrides?.llm ?? DEFAULT_GPU_STATE.webgpuOverrides.llm,
      inpaint: raw?.webgpuOverrides?.inpaint ?? DEFAULT_GPU_STATE.webgpuOverrides.inpaint,
      ocr: raw?.webgpuOverrides?.ocr ?? DEFAULT_GPU_STATE.webgpuOverrides.ocr,
    },
  };
}

/** Effective GPU flag for a subsystem (`master && per-subsystem`). */
export function isGpuEnabledFor(state: GpuState, key: keyof GpuState["webgpuOverrides"]): boolean {
  return state.webgpuSupported === true && state.webgpuMaster && state.webgpuOverrides[key] === true;
}

/**
 * Probe once (offscreen) and persist `true` only.
 * - Returns the probed boolean (true/false).
 * - When true, writes `local:webgpu-supported = true` so future loads skip probing.
 * - When false, does NOT overwrite a previously verified `true` — leaves cache as-is.
 */
export async function probeAndCacheWebGPU(): Promise<boolean> {
  const ok = await checkWebGPUHighPerf();
  if (ok) {
    try {
      // `storage` is provided by WXT globals; guard for node/test contexts.
      const maybeStorage = (globalThis as unknown as { storage?: { setItem: (k: string, v: unknown) => Promise<void> } }).storage;
      if (maybeStorage) await maybeStorage.setItem("local:webgpu-supported", true);
    } catch {}
  }
  return ok;
}

/** Ensure `ort.env.wasm.wasmPaths` points to extension-local assets (MV3-safe, no CDN). */
export function ensureWasmPaths(): void {
  try {
    const url = typeof browser !== "undefined" && (browser as unknown as { runtime?: { getURL: (p: string) => string } }).runtime?.getURL
      ? (browser as unknown as { runtime: { getURL: (p: string) => string } }).runtime.getURL("/")
      : "/";
    // Only set if not already set — respects existing test harnesses.
    if (!(ort.env.wasm as unknown as Record<string, unknown>).wasmPaths) {
      (ort.env.wasm as unknown as Record<string, unknown>).wasmPaths = url;
    }
  } catch {}
}
