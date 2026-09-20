import * as ort from "onnxruntime-web/all";
import { resolveExecutionProviders } from "./ort";

// ORT-bound model download helpers. Split out of `utils.ts` so light
// consumers (background PROXY_IMAGE, content scripts, setup progress UI)
// never bundle onnxruntime-web: importing this module pulls the full ORT
// runtime into the entry chunk. Only inference contexts
// (offscreen document / Firefox inference page) and explicit prefetch
// handlers should import from here.

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
