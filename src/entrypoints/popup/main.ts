import { mount } from "svelte";
import "@/assets/app.css";
import App from "./App.svelte";
import { openSetupTab } from "@/lib/utils";

let hostname = "";
let title = "";
let path = "";

try {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    title = tab.title ?? "";
    if (tab.url) {
      try {
        const url = new URL(tab.url);
        hostname = url.hostname;
        path = url.pathname;
      } catch {
        hostname = "";
        path = "";
      }
    }
  }
} catch {}

const app = mount(App, {
  target: document.getElementById("app")!,
  props: {
    hostname,
    title,
    path,
  },
});

export default app;

(async () => {
  try {
    if (await storage.getItem("local:is-first-run", { fallback: true })) {
      openSetupTab();
    }
  } catch {}
})();
