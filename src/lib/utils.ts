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
  const url = `https://huggingface.co/${repoID}/resolve/main/${path}`;

  if (inFlightRequests.has(url)) {
    const result = await inFlightRequests.get(url);
    return result instanceof Response ? result.clone() : result;
  }

  const requestPromise = (async () => {
    const cache = await caches.open(repoID);

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

        if (currentHash !== localHash) needsUpdate = true;
      } catch (error) {
        console.warn(
          "Offline: skipping update check and using cache. Error:",
          error,
        );
      }
    }

    if (!response || needsUpdate) {
      response = await fetch(url);
      await cache.put(url, response.clone());
    }

    if (noReturn) return;

    if (path.endsWith(".onnx")) {
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

export async function openSetupTab(modelId?: string, clean?: boolean) {
  await browser.runtime.sendMessage({
    type: "OPEN_SETUP_TAB",
    data: { modelId, clean },
  });
}
