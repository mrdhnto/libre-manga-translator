import { defineConfig } from "wxt";
import tailwindcss from "@tailwindcss/vite";
import pkg from "./package.json";

/**
 * Isolate the two heavy prebundled vendors into their own chunks so every
 * emitted .js stays under the 2MB Firefox AMO validation limit.
 *
 * Why a plugin instead of static rollupOptions.output.manualChunks: WXT
 * builds background/content entries with output.inlineDynamicImports, which
 * Rollup rejects manualChunks for. The outputOptions hook runs before
 * Rollup validates, so single-file builds drop the splitter while the
 * extension-pages build (popup/setup/offscreen, real code-splitting) keeps
 * it. @mlc-ai/web-llm is additionally dynamic-import()ed at its three use
 * sites (lib/webllm.ts, setup page, offscreen cache-delete) so it never
 * lands in an initial chunk.
 */
const vendorChunkGuard = () => ({
  name: "lmt-vendor-chunk-guard",
  outputOptions(options: any) {
    if (options.inlineDynamicImports) {
      delete options.manualChunks;
    } else {
      options.manualChunks = (id: string) => {
        if (id.includes("node_modules/onnxruntime-web")) return "ort";
        if (id.includes("node_modules/@mlc-ai/web-llm")) return "webllm";
        if (id.includes("node_modules/@wllama/wllama")) return "wllama";
      };
    }
    return options;
  },
});

// See https://wxt.dev/api/config.html
export default defineConfig({
  vite: () => ({
    plugins: [tailwindcss(), vendorChunkGuard()],
    build: {
      // Forced terser (not the PROD-conditional esbuild fallback): better
      // compression on the multi-MB vendor bundles, and required to keep
      // every emitted .js under the 2MB Firefox AMO validation limit.
      minify: "terser",
      terserOptions: {
        compress: {
          passes: 2,
        },
        mangle: true,
        format: {
          comments: false,
        },
      },
      // Warn when any chunk approaches the 2MB Firefox AMO validation
      // limit. (NOTE: no manualChunks here — WXT builds background/content
      // entries with inlineDynamicImports, which Rollup rejects manualChunks
      // for. Splitting is achieved via dynamic import() of the heavy vendors
      // instead: @mlc-ai/web-llm loads lazily in lib/webllm.ts + setup page,
      // so the pages build emits it as its own async chunk automatically.)
      chunkSizeWarningLimit: 1900,
    },
  }),

  manifest: {
    name: "Libre Manga Translator",
    version_name: pkg.version,
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
          "/icon/*",
        ],
        matches: ["<all_urls>"],
      },
    ],
    content_security_policy: {
      // Default is Chrome-strict (Web Store rejects blob: in worker-src).
      // The build:manifestGenerated hook below appends blob: for Firefox,
      // where wllama must construct its inference worker from a blob URL
      // (no remote code executes — the worker source ships inside the
      // package). Without it Firefox blocks the worker and model loading
      // hangs silently.
      extension_pages:
        "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; worker-src 'self'",
    },
    // Fixed add-on ID: Firefox disables storage.sync for temporary install
    // IDs, which breaks onboarding/settings on sideloaded dev builds. AMO
    // requires a fixed ID at submission anyway. Chrome ignores this key.
    browser_specific_settings: {
      gecko: {
        id: "libre-manga-translator@mrdhnto",
      },
    },
  },

  // "offscreen" is Chrome-only: Firefox rejects it with a manifest
  // warning (and has no offscreen API — inference runs in the background
  // page, see lib/inference.ts). Strip it from Firefox builds only.
  // Same hook also swaps the CSP per build: Chrome keeps the strict
  // default above, Firefox gains worker-src blob: for the wllama worker.
  hooks: {
    "build:manifestGenerated": (wxt: any, manifest: any) => {
      if (wxt.config.browser === "firefox") {
        if (Array.isArray(manifest.permissions)) {
          manifest.permissions = manifest.permissions.filter(
            (p: unknown) => p !== "offscreen",
          );
        }
        manifest.content_security_policy ??= {};
        manifest.content_security_policy.extension_pages =
          "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; worker-src 'self' blob:";
      }
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
