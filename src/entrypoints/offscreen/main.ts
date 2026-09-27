import "@/assets/app.css";
import { handleOffscreenMessage } from "@/lib/inference";

// Thin listener: all inference lives in lib/inference.ts. On Chrome this
// page runs as an offscreen document; on Firefox (MV2, no offscreen API)
// the background page hosts it in a hidden iframe and forwards the same
// OFFSCREEN_* messages. Chrome behavior is unchanged.
browser.runtime.onMessage.addListener((msg, _, sendResponse) => {
  if (typeof msg?.type === "string" && msg.type.startsWith("OFFSCREEN_")) {
    handleOffscreenMessage(msg)
      .then(sendResponse)
      .catch((err) => sendResponse({ error: (err as Error).message ?? String(err) }));
    return true;
  }
});
