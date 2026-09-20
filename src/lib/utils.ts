import * as ort from "onnxruntime-web/all";
import { resolveExecutionProviders } from "./ort";

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
  autoUpdate?: boolean,
  noReturn?: boolean,
): Promise<ort.InferenceSession>;

export function downloadArtifactHF(
  repoID: string,
  path: string,
  autoUpdate?: boolean,
  noReturn?: boolean,
): Promise<Response>;

export async function downloadArtifactHF(
  repoID: string,
  path: string,
  autoUpdate?: boolean,
  noReturn?: boolean,
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

    let response = await cache.match(url);
    let needsUpdate = !response;

    if (autoUpdate && response) {
      try {
        const headResponse = await fetch(url, { method: "HEAD" });
        const currentHash =
          headResponse.headers.get("x-repo-commit") ||
          headResponse.headers.get("etag");
        const localHash =
          response.headers.get("x-repo-commit") || response.headers.get("etag");

        if (currentHash && localHash && currentHash !== localHash) needsUpdate = true;
      } catch (error) {
        console.warn(
          "Offline: skipping update check and using cache. Error:",
          error,
        );
      }
    }

    if (!response || needsUpdate) {
      response = await fetch(url);
      if (!response.ok) throw new Error(`Failed to download model from ${url} (${response.status} ${response.statusText})`);
      await cache.put(url, response.clone());
    }

    if (noReturn) return;

    if (path.endsWith(".onnx") || url.endsWith(".onnx") || url.includes(".onnx?")) {
      return ort.InferenceSession.create(await response.arrayBuffer(), {
        executionProviders: resolveExecutionProviders(),
      });
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
  autoUpdate = false,
): Promise<ort.InferenceSession> {
  const res = await downloadArtifactHF(cacheKey, url, autoUpdate);
  return res as unknown as ort.InferenceSession;
}

export async function openSetupTab(modelId?: string, clean?: boolean) {
  await browser.runtime.sendMessage({
    type: "OPEN_SETUP_TAB",
    data: { modelId, clean },
  });
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
