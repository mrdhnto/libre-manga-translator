import { mount } from "svelte";
import "@/assets/app.css";
import App from "./App.svelte";
import { openSetupTab } from "@/lib/utils";

const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
const url = new URL(tab.url || "");

if (await storage.getItem("local:is-first-run", { fallback: true })) {
  openSetupTab();
}

const app = mount(App, {
  target: document.getElementById("app")!,
  props: {
    hostname: url.hostname,
    title: tab.title ?? "",
    path: url.pathname,
  },
});

export default app;
