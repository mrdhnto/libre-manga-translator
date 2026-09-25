import * as ort from "onnxruntime-web/all";
import { resolveExecutionProviders, resolveExecutionProvidersForModel } from "./ort";
import { getExpectedSha256, verifyBufferSha256 } from "./manifests/hashes";

export function sniffMime(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  )
    return "image/png";
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  )
    return "image/webp";
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46)
    return "image/gif";
  if (
    bytes[4] === 0x66 &&
    bytes[5] === 0x74 &&
    bytes[6] === 0x79 &&
    bytes[7] === 0x70
  )
    return "image/avif";
  return "image/jpeg";
}

export async function fetchAsImageBitmap(url: string): Promise<ImageBitmap> {
  const response = await fetch(url);
  const arrayBuffer = await response.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  const mime = sniffMime(bytes);
  const blob = new Blob([arrayBuffer], { type: mime });
  return createImageBitmap(blob);
}

export function arrayBufferToBase64DataUrl(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  const mime = sniffMime(bytes);
  const chunkSize = 8192;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

export async function fetchAsBase64(url: string) {
  const res = await fetch(url);
  const blob = await res.blob();
  const mimeType = blob.type || "image/jpeg";
  const arrayBuffer = await blob.arrayBuffer();
  const uint8 = new Uint8Array(arrayBuffer);
  const chunkSize = 8192;
  let binary = "";
  for (let i = 0; i < uint8.length; i += chunkSize) {
    binary += String.fromCharCode(...uint8.subarray(i, i + chunkSize));
  }
  const base64 = btoa(binary);
  return `data:${mimeType};base64,${base64}`;
}

// Store in-flight requests to prevent duplicate network calls
const inFlightRequests = new Map<
  string,
  Promise<ort.InferenceSession | Response | undefined>
>();

export function downloadArtifactHF(
  repoID: string,
  path: `${string}.onnx`,
  noReturn?: boolean,
  options?: { gpu?: boolean },
): Promise<ort.InferenceSession>;

export function downloadArtifactHF(
  repoID: string,
  path: string,
  noReturn?: boolean,
  options?: { gpu?: boolean },
): Promise<Response>;

export async function downloadArtifactHF(
  repoID: string,
  path: string,
  noReturn?: boolean,
  options?: { gpu?: boolean },
): Promise<ort.InferenceSession | Response | undefined> {
  const isDirectUrl =
    path.startsWith("http://") ||
    path.startsWith("https://") ||
    repoID.startsWith("http://") ||
    repoID.startsWith("https://");

  const url = isDirectUrl
    ? path.startsWith("http://") || path.startsWith("https://")
      ? path
      : `${repoID}/${path}`
    : `https://huggingface.co/${repoID}/resolve/main/${path}`;

  const cacheName = isDirectUrl ? "direct-model-cache" : repoID;

  if (inFlightRequests.has(url)) {
    const result = await inFlightRequests.get(url);
    return result instanceof Response ? result.clone() : result;
  }

  const requestPromise = (async () => {
    const cache = await caches.open(cacheName);

    // Cache-first: silent per-load update checks were removed. Updates are
    // manual via CHECK_MODEL_UPDATES / UPDATE_CACHED_MODEL (updates.ts).
    let response = await cache.match(url);

    if (!response) {
      const fetched = await fetch(url);
      if (!fetched.ok) throw new Error(`Failed to download model from ${url} (${fetched.status} ${fetched.statusText})`);
      const buffer = await fetched.arrayBuffer();

      const expectedSha256 = getExpectedSha256(path, url);
      if (expectedSha256) {
        const isValid = await verifyBufferSha256(buffer, expectedSha256);
        if (!isValid) {
          await cache.delete(url).catch(() => {});
          throw new Error(`Integrity check failed: SHA-256 mismatch for ${path}`);
        }
      }

      response = new Response(buffer, {
        headers: fetched.headers,
        status: fetched.status,
        statusText: fetched.statusText,
      });
      await cache.put(url, response.clone());
    }

    if (noReturn) return;

    if (path.endsWith(".onnx") || url.endsWith(".onnx") || url.includes(".onnx?")) {
      const modelIdentifier = path || url;
      const providers = resolveExecutionProvidersForModel(modelIdentifier, options?.gpu);
      // Copy bytes per attempt: a failed create() may neuter the buffer,
      // so the WASM retry gets fresh bytes, not a detached view.
      const modelBytes = new Uint8Array(await response.arrayBuffer());
      try {
        return await ort.InferenceSession.create(modelBytes.slice().buffer, {
          executionProviders: providers,
        });
      } catch (err: any) {
        if (providers.includes("webgpu")) {
          console.warn(`[ort] WebGPU session creation failed for ${modelIdentifier}, falling back to WASM:`, err?.message);
          return await ort.InferenceSession.create(modelBytes.slice().buffer, {
            executionProviders: ["wasm"],
          });
        }
        throw err;
      }
    } else {
      return response.clone();
    }
  })();

  inFlightRequests.set(url, requestPromise);

  try {
    const result = await requestPromise;
    return result instanceof Response ? result.clone() : result;
  } finally {
    inFlightRequests.delete(url);
  }
}

export async function downloadArtifactFromUrl(
  url: string,
  cacheKey: string = "direct-model-cache",
  options?: { gpu?: boolean },
): Promise<ort.InferenceSession> {
  const res = await downloadArtifactHF(cacheKey, url, false, options);
  return res as unknown as ort.InferenceSession;
}

export async function openSetupTab(modelId?: string, clean?: boolean) {
  await browser.runtime.sendMessage({
    type: "OPEN_SETUP_TAB",
    data: { modelId, clean },
  });
}

/**
 * Probe the extension-side CacheStorage via the background service worker.
 * Direct `caches.open()` from a content-world context (sidebar/overlay
 * shadow UIs) reads the page's partition — not the partition the popup,
 * setup tab, offscreen doc, and service worker share. Routing through the
 * background guarantees every UI reads the same partition.
 * Falls back to a local probe if the background is unreachable.
 */
export async function probeArtifactsCached(
  entries: { repo: string; path: string }[],
): Promise<boolean[]> {
  try {
    const res = (await browser.runtime.sendMessage({
      type: "IS_MODEL_CACHED",
      data: { entries },
    })) as { results?: boolean[] };
    if (Array.isArray(res?.results) && res.results.length === entries.length) {
      return res.results;
    }
  } catch {
    // fall through to local probe
  }
  return Promise.all(
    entries.map((e) => isArtifactCached(e.repo, e.path)),
  );
}

/**
 * Intersect `local:cached-llms` (stale-prone: written once at setup
 * download) with real WebLLM weight presence via offscreen
 * `hasModelInCache`. Returns the verified-cached ids; prunes stale
 * entries from storage as a side effect (self-heal).
 */
export async function probeLlmsCached(modelIds: string[]): Promise<string[]> {
  let statuses: Record<string, boolean> | null = null;
  try {
    const res = (await browser.runtime.sendMessage({
      type: "LLM_CACHE_STATUS",
      data: { modelIds },
    })) as { success?: boolean; statuses?: Record<string, boolean> };
    // Only trust an explicit success: a failed probe must not wipe the list.
    if (res?.success && res.statuses) statuses = res.statuses;
  } catch {
    // fall through: probe unavailable, keep existing list
  }
  if (!statuses) return [...modelIds];
  const verified = modelIds.filter((id) => statuses[id] === true);
  // Self-heal: drop ids the probe says are missing.
  try {
    const items = await storage.getItems(["local:cached-llms"]);
    const listed = (items[0]?.value as string[]) || [];
    const pruned = listed.filter((id) => verified.includes(id));
    if (pruned.length !== listed.length) {
      await storage.setItem("local:cached-llms", pruned);
    }
  } catch {
    // storage prune is best-effort
  }
  return verified;
}

/**
 * Check if a specific artifact exists in CacheStorage with a valid (> 1KB) body.
 */
export async function isArtifactCached(
  repoID: string,
  path: string,
): Promise<boolean> {
  try {
    const isDirectUrl =
      path.startsWith("http://") ||
      path.startsWith("https://") ||
      repoID.startsWith("http://") ||
      repoID.startsWith("https://");

    const url = isDirectUrl
      ? path.startsWith("http://") || path.startsWith("https://")
        ? path
        : `${repoID}/${path}`
      : `https://huggingface.co/${repoID}/resolve/main/${path}`;

    const cacheName = isDirectUrl ? "direct-model-cache" : repoID;
    const cache = await caches.open(cacheName);
    const matched = await cache.match(url);
    if (!matched || !matched.ok) return false;
    const blob = await matched.blob();
    return blob.size > 1024;
  } catch {
    return false;
  }
}

/**
 * Download an artifact with streaming progress reporting and store in CacheStorage.
 */
export async function fetchAndCacheWithProgress(
  repoID: string,
  path: string,
  onProgress?: (loaded: number, total: number) => void,
): Promise<void> {
  const isDirectUrl =
    path.startsWith("http://") ||
    path.startsWith("https://") ||
    repoID.startsWith("http://") ||
    repoID.startsWith("https://");

  const url = isDirectUrl
    ? path.startsWith("http://") || path.startsWith("https://")
      ? path
      : `${repoID}/${path}`
    : `https://huggingface.co/${repoID}/resolve/main/${path}`;

  const cacheName = isDirectUrl ? "direct-model-cache" : repoID;
  const cache = await caches.open(cacheName);

  // If already cached and valid, notify 100% and finish
  const existing = await cache.match(url);
  if (existing && existing.ok) {
    const blob = await existing.blob();
    if (blob.size > 1024) {
      if (onProgress) onProgress(blob.size, blob.size);
      return;
    }
    await cache.delete(url);
  }

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status} (${res.statusText})`);

  const contentLength = res.headers.get("content-length");
  const total = contentLength ? parseInt(contentLength, 10) : 0;

  if (!res.body) {
    const blob = await res.blob();
    await cache.put(url, new Response(blob, { headers: res.headers }));
    if (onProgress) onProgress(blob.size, blob.size);
    return;
  }

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      loaded += value.length;
      if (onProgress) onProgress(loaded, total);
    }
  }

  const combined = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }

  const finalResponse = new Response(combined, {
    status: res.status,
    statusText: res.statusText,
    headers: res.headers,
  });

  await cache.put(url, finalResponse);
}

/**
 * Cooperative time-slicing. Yields event loop to pending UI tasks (e.g. extension popup clicks).
 * Uses native `scheduler.yield()` when available (Chromium 115+), falling back to `setTimeout(0)`.
 */
export async function yieldToMain(): Promise<void> {
  if (typeof (globalThis as any).scheduler?.yield === "function") {
    return (globalThis as any).scheduler.yield();
  }
  return new Promise((resolve) => setTimeout(resolve, 0));
}
