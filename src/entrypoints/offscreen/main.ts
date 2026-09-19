import "@/assets/app.css";
import { handleOffscreenMessage } from "@/lib/inference";

// Thin listener: all inference lives in lib/inference.ts so the Firefox
// background page (MV2, no offscreen API) can execute the same handlers
// directly. Chrome behavior is unchanged.
browser.runtime.onMessage.addListener((msg, _, sendResponse) => {
  if (typeof msg?.type === "string" && msg.type.startsWith("OFFSCREEN_")) {
    handleOffscreenMessage(msg)
      .then(sendResponse)
      .catch((err) => sendResponse({ error: (err as Error)?.message ?? String(err) }));
    return true;
  }
});
