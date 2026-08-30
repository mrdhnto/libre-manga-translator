import { defineConfig } from "wxt";
import tailwindcss from "@tailwindcss/vite";

// See https://wxt.dev/api/config.html
export default defineConfig({
  vite: () => ({
    plugins: [tailwindcss()],
    build: {
      minify: import.meta.env.PROD ? "terser" : "esbuild",
    },
  }),

  manifest: {
    name: "Libre Manga Translator",
    description: "Privacy-focused manga translator: local WebGPU, Gemini cloud, or self-hosted LLM",
    permissions: [
      "activeTab",
      "scripting",
      "offscreen",
      "storage",
      "contextMenus",
      "unlimitedStorage",
      "declarativeNetRequest",
    ],
    host_permissions: ["<all_urls>"],
    web_accessible_resources: [
      {
        resources: [
          "/offscreen.html",
          "/setup.html",
          "/content-scripts/*",
          "/*.wasm",
          "/*.mjs",
          "/fonts/*",
        ],
        matches: ["<all_urls>"],
      },
    ],
    content_security_policy: {
      extension_pages:
        "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
    },
  },

  srcDir: "src",
  modules: ["@wxt-dev/module-svelte"],
  webExt: {
    binaries: {
      firefox: "/usr/bin/firefox",
    },
    chromiumArgs: [
      "--enable-unsafe-webgpu",
      "--ozone-platform=x11",
      "--use-angle=vulkan",
      "--enable-features=Vulkan,VulkanFromANGLE",
      "--user-data-dir=./.wxt/chrome-data",
    ],
  },
});
