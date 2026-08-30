import { env } from "@/lib/env";
import { downloadArtifactHF, arrayBufferToBase64DataUrl } from "@/lib/utils";
import { detectHardware, ensureOffscreen } from "./utils";
import { DefaultConfig } from "@/lib/configs";
import { testServerConnection } from "@/lib/server/main";
import { createAsyncResponder, keepAliveWhile, withTimeout } from "./messaging";

export default defineBackground(() => {
  async function openSetupTabInBackground(modelId?: string, clean?: boolean) {
    let targetUrl = browser.runtime.getURL("/setup.html");
    if (modelId) {
      targetUrl += `?model=${modelId}`;
    }
    if (clean) {
      targetUrl += `${modelId ? "&" : "?"}clean=1`;
    }

    // Check if any tab is already open with the setup page
    const existingTabs = await browser.tabs.query({
      url: browser.runtime.getURL("/setup.html") + "*",
    });

    if (existingTabs.length > 0) {
      const tab = existingTabs[0];

      await browser.tabs.update(tab.id, {
        active: true,
        ...(targetUrl.includes("?") ? { url: targetUrl } : {}),
      });

      await browser.windows.update(tab.windowId, { focused: true });
    } else {
      await browser.tabs.create({ url: targetUrl });
    }
  }

  // Make Context menu (Popup shows on right click)
  browser.runtime.onInstalled.addListener(async (details) => {
    browser.contextMenus.removeAll();
    browser.contextMenus.create({
      id: "lmt-translate-image",
      title: "Translate Image",
      contexts: ["image"],
    });

    await storage.setItem("local:active-device", await detectHardware());
    if (details.reason === "install") {
      openSetupTabInBackground();
    }
  });

  // Send message when context menu is clicked
  browser.contextMenus.onClicked.addListener(async (info, tab) => {
    if (!tab?.id) return;

    if (info.menuItemId === "lmt-translate-image") {
      // Show popup if user not yet set up the extension
      if (await storage.getItem("local:is-first-run", { fallback: true })) {
        openSetupTabInBackground();
        return;
      }

      browser.tabs.sendMessage(tab.id, {
        type: info.menuItemId,
        data: info.srcUrl,
      });
    }
  });

  browser.runtime.onMessage.addListener((msg, _, sendResponse) => {
    const respond = createAsyncResponder(sendResponse);
    const respondErr = (err: unknown) =>
      respond({ error: (err as Error).message ?? String(err) });

    // Send anonymous bbox telemetry data from background context (bypasses page CSP)
    if (msg.type === "SEND_TELEMETRY") {
      const task = async () => {
        if (!env.telemetryUrl || !env.telemetryPublicKey) {
          return { skipped: true };
        }
        const res = await fetch(env.telemetryUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${env.telemetryPublicKey}`,
          },
          body: JSON.stringify(msg.data),
        });
        if (!res.ok) {
          throw new Error(`Telemetry failed with status ${res.status}: ${res.statusText}`);
        }
        return { success: true };
      };

      keepAliveWhile(task().then(respond).catch(respondErr));

      return true;
    }

    // Proxy image fetch for cross-origin or hotlink-protected images (Cloudflare, Referer checks).
    // Uses declarativeNetRequest to inject the proper Referer so CDNs accept the request,
    // then converts to base64 data URL to completely bypass CORS/network downstream.
    if (msg.type === "PROXY_IMAGE") {
      const { url, referer } = msg.data;
      const task = async () => {
        const ruleId = 99999;
        const dnr = (browser as any).declarativeNetRequest;
        if (dnr?.updateSessionRules && referer) {
          try {
            await dnr.updateSessionRules({
              removeRuleIds: [ruleId],
              addRules: [
                {
                  id: ruleId,
                  priority: 1,
                  action: {
                    type: "modifyHeaders",
                    requestHeaders: [
                      {
                        header: "Referer",
                        operation: "set",
                        value: referer,
                      },
                    ],
                  },
                  condition: {
                    urlFilter: url.replace(/[?#].*$/, ""),
                    resourceTypes: [
                      "xmlhttprequest",
                      "other",
                      "image",
                    ],
                  },
                },
              ],
            });
          } catch (e) {
            console.warn("LMT: Failed to set DNR rule for proxy fetch:", e);
          }
        }

        try {
          const res = await fetch(url);
          if (!res.ok) {
            throw new Error(
              `Proxy fetch failed with status ${res.status}: ${res.statusText}`,
            );
          }
          const buf = await res.arrayBuffer();
          return { dataUrl: arrayBufferToBase64DataUrl(buf) };
        } finally {
          if (dnr?.updateSessionRules && referer) {
            await dnr
              .updateSessionRules({
                removeRuleIds: [ruleId],
              })
              .catch(() => {});
          }
        }
      };

      keepAliveWhile(task().then(respond).catch(respondErr));

      return true;
    }

    // Forwarding heavy inference to the offscreen document
    if (
      ["DETECT_BBOX", "TRANSLATE_IMAGE", "MAKE_SITE_RULE_AI", "INPAINT_IMAGE"].includes(
        msg.type,
      )
    ) {
      const timeoutMs =
        msg.type === "TRANSLATE_IMAGE" || msg.type === "INPAINT_IMAGE"
          ? 180_000
          : 90_000;

      const forward = () =>
        browser.runtime.sendMessage({
          ...msg,
          type: `OFFSCREEN_${msg.type}`,
        });

      keepAliveWhile(
        withTimeout(
          ensureOffscreen()
            .then(forward)
            .catch(async () => {
              // Offscreen may be dead (e.g. CSP crash) — recreate and retry once.
              await browser.offscreen.closeDocument().catch(() => {});
              await ensureOffscreen();
              return forward();
            }),
          timeoutMs,
          msg.type,
        )
          .then(respond)
          .catch(respondErr),
      );

      return true;
    }

    // Open/reuse the setup page from any context (content script, popup)
    if (msg.type === "OPEN_SETUP_TAB") {
      keepAliveWhile(
        openSetupTabInBackground(msg.data?.modelId, msg.data?.clean)
          .then(() => respond({ success: true }))
          .catch(respondErr),
      );

      return true;
    }

    // Test a site rule regex against the active tab
    if (msg.type === "TEST_SITE_RULE") {
      const run = async () => {
        const tabs = await browser.tabs.query({
          active: true,
          currentWindow: true,
        });
        if (tabs[0]?.id) {
          return browser.tabs.sendMessage(tabs[0].id, {
            type: "TEST_REGEX_RULE",
            data: { rule: msg.data?.rule },
          });
        }
        return { error: "No active tab." };
      };

      keepAliveWhile(run().then(respond).catch(respondErr));

      return true;
    }

    // Delete a cached WebLLM model to free disk space
    if (msg.type === "DELETE_LLM_CACHE") {
      const forward = () =>
        browser.runtime.sendMessage({
          type: "OFFSCREEN_DELETE_LLM_CACHE",
          data: { modelId: msg.data?.modelId },
        });

      const task = ensureOffscreen()
        .then(forward)
        .catch(async () => {
          // Offscreen may be dead (e.g. CSP crash) — recreate and retry once.
          await browser.offscreen.closeDocument().catch(() => {});
          await ensureOffscreen();
          return forward();
        })
        .then(async (res: any) => {
          if (res?.error) throw new Error(res.error);
          const items = await storage.getItems(["local:cached-llms"]);
          const cached = (items[0].value as string[]) || [];
          await storage.setItem(
            "local:cached-llms",
            cached.filter((m) => m !== msg.data?.modelId),
          );
          return { success: true };
        });

      keepAliveWhile(withTimeout(task, 60_000, "DELETE_LLM_CACHE").then(respond).catch(respondErr));

      return true;
    }

    // Test the API Mode server connection
    if (msg.type === "TEST_BACKEND") {
      if (msg.data?.kind === "api") {
        keepAliveWhile(
          testServerConnection(msg.data.config)
            .then(respond)
            .catch(respondErr),
        );
      } else {
        respond({ success: false, error: "Unknown backend kind" });
      }

      return true;
    }

    // Caching model when user changes specific settings
    if (msg.type === "PREFETCH_MODEL") {
      const { type, data } = msg.data;

      const task =
        type === "detection"
          ? downloadArtifactHF(
              DefaultConfig.detectionModelRepo,
              DefaultConfig.detectionModelPath(data),
              false,
              true,
            )
          : downloadArtifactHF(
              DefaultConfig.ocrRepo,
              DefaultConfig.ocrModelPath(data),
              false,
              true,
            ).then(() =>
              downloadArtifactHF(
                DefaultConfig.ocrRepo,
                DefaultConfig.ocrDictPath(data),
                false,
                true,
              ),
            );

      keepAliveWhile(task.then(() => respond({ success: true })).catch(respondErr));

      return true;
    }
  });
});
