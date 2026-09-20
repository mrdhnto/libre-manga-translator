/** Firefox MV2 has no offscreen API — inference runs in the background page. */
export function hasOffscreenApi(): boolean {
  return typeof browser.offscreen !== "undefined";
}

/**
 * Firefox (MV2) inference host: offscreen.html running in a hidden iframe
 * inside the persistent background page.
 *
 * Why an iframe instead of a dynamic import(): the MV2 background must stay
 * a classic single-file script (no `type: module` in MV2 manifests), so any
 * `import()` would be inlined at build time and bloat background.js past the
 * AMO 2MB-per-.js limit. The iframe reuses the pages build's already-split
 * chunks (ort-*, wllama-*), so inference code is never bundled into
 * background.js and loads lazily on first use.
 */
let inferencePageReady: Promise<void> | null = null;

export function ensureFirefoxInferencePage(): Promise<void> {
  if (inferencePageReady) return inferencePageReady;
  inferencePageReady = new Promise<void>((resolve, reject) => {
    try {
      const existing = document.getElementById(
        "lmt-inference-page",
      ) as HTMLIFrameElement | null;
      if (existing?.contentWindow) {
        resolve();
        return;
      }
      existing?.remove();
      const iframe = document.createElement("iframe");
      iframe.id = "lmt-inference-page";
      iframe.style.display = "none";
      iframe.setAttribute("aria-hidden", "true");
      iframe.tabIndex = -1;
      const timer = setTimeout(
        () => reject(new Error("Inference page load timed out")),
        30_000,
      );
      iframe.addEventListener(
        "load",
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
      iframe.addEventListener(
        "error",
        () => {
          clearTimeout(timer);
          reject(new Error("Inference page failed to load"));
        },
        { once: true },
      );
      iframe.src = browser.runtime.getURL("/offscreen.html");
      (document.body ?? document.documentElement).appendChild(iframe);
    } catch (e) {
      reject(e);
    }
  });
  // A failed load must not poison later calls — retry from scratch.
  inferencePageReady.catch(() => {
    inferencePageReady = null;
  });
  return inferencePageReady;
}

export async function ensureOffscreen() {
  if (!hasOffscreenApi()) return;
  if (await browser.offscreen.hasDocument()) return;

  await browser.offscreen.createDocument({
    url: "/offscreen.html",
    reasons: [browser.offscreen.Reason.BLOBS],
    justification: "Image Processing",
  });
}
export async function detectHardware() {
  if ("ml" in navigator) {
    try {
      const mlContext = await (navigator.ml as any).createContext({
        deviceType: "npu",
      });
      if (mlContext) {
        return "npu";
      }
    } catch (error) {
      console.warn("WebNN NPU not available or context creation failed.");
    }
  }

  if ("gpu" in navigator) {
    try {
      const adapter = await (navigator.gpu as any).requestAdapter();
      if (adapter) {
        return "gpu";
      }
    } catch (error) {
      console.warn("GPU adapter request failed.");
    }
  }

  return "cpu";
}