import {
  resolveExecutionProviders as resolveFromHardware,
  resolveExecutionProvidersForModel as resolveForModelFromHardware,
  isModelWebGpuCapable,
} from "./hardware";

export { isModelWebGpuCapable };

/**
 * Legacy entry point — kept for callers that do not yet pass a GPU flag.
 * Delegates to `src/lib/hardware.ts` `resolveExecutionProviders(gpu)`.
 * New code should import from `hardware.ts` directly with an explicit `gpu` boolean
 * derived from `normalizeGpuState` + `isGpuEnabledFor`.
 */
export function resolveExecutionProviders(gpu?: boolean): readonly string[] {
  const useGpu = gpu ?? (typeof navigator !== "undefined" && "gpu" in navigator);
  return resolveFromHardware(useGpu);
}

/** Forward for callers that can supply an explicit GPU flag. */
export function resolveExecutionProvidersWithGpu(gpu: boolean): readonly string[] {
  return resolveFromHardware(gpu);
}

/** Resolve providers for a specific model, gating WebGPU by operator compatibility. */
export function resolveExecutionProvidersForModel(pathOrUrl: string, gpu?: boolean): readonly string[] {
  return resolveForModelFromHardware(pathOrUrl, gpu);
}
