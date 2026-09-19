/** Firefox MV2 has no offscreen API — inference runs in the background page. */
export function hasOffscreenApi(): boolean {
  return typeof browser.offscreen !== "undefined";
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