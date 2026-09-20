# LMT Technical Reference

Developer-facing details for Libre Manga Translator: models, settings, pipeline internals, project layout, and checks. The user-facing overview lives in [`README.md`](../README.md).

## Contents

- [LMT Technical Reference](#lmt-technical-reference)
  - [Contents](#contents)
  - [Tech Stack](#tech-stack)
  - [Pipeline](#pipeline)
  - [Detection Models](#detection-models)
  - [Detection Settings](#detection-settings)
  - [OCR Engines](#ocr-engines)
  - [Inpaint Ladder](#inpaint-ladder)
  - [Script Gate](#script-gate)
  - [Model Storage \& Cache Management](#model-storage--cache-management)
  - [Environment Overrides](#environment-overrides)
  - [Project Structure](#project-structure)
  - [Checks](#checks)
  - [Model Licenses](#model-licenses)

## Tech Stack

| Layer | Technology |
|---|---|
| Extension framework | [WXT](https://wxt.dev) |
| UI | [Svelte 5](https://svelte.dev) with runes |
| Language | TypeScript |
| Styling | Tailwind CSS |
| Bubble / text detection | YOLO26 ONNX + RT-DETR ONNX + ComicTextDetector ONNX via ONNX Runtime Web (`onnxruntime-web`) |
| Script gate | OSD script-identification LSTM (~3.7 MB, ONNX Runtime Web) + Unicode-block text verification |
| On-device OCR | PaddleOCR ONNX (`~80 MB`, multilingual default) or Manga-OCR ONNX (`~460 MB`, Japanese specialist) |
| Inpainting | Auto engine ladder: pure-JS planar fill (rung 0) / bilateral denoise (rung 1) / optional LaMa redraw (rung 2, `~207 MB`) / Telea fast-marching (rung 3) |
| Local translation | Chrome: [WebLLM](https://webllm.mlc.ai/) (Qwen3 4B / 8B MLC) · Firefox: [wllama](https://github.com/ngxson/wllama) (Qwen3.5-4B GGUF) |
| Cloud translation | Gemini API via REST |
| API Mode backends | Ollama, LM Studio, OpenAI-compatible |
| Storage | WXT storage (wraps chrome.storage); model weights in browser cache (see below) |
| Build | Bun + WXT |
| Telemetry | Supabase / REST API (opt-in bbox coordinates only) |

Runtime dependencies are minimal by design (`package.json`): `@mlc-ai/web-llm`, `onnxruntime-web`, `lucide-svelte`. No OpenCV.js / no WASM inpainting dependency — the ladder is pure TypeScript plus optional ONNX LaMa.

## Pipeline

```
detect (YOLO26 / RT-DETR / ComicTextDetector) → refine regions (merge/size)
  → script gate + OCR (PaddleOCR / Manga-OCR) → translate
  → inpaint (auto ladder + optional LaMa) → paint
```

Mode determines the translate step:

- **webgpu** → `textRecognise()` → local LLM (Chrome: `translateLocal()` via WebLLM Qwen3-MLC; Firefox: `translateWithWllama()` via wllama Qwen3.5-GGUF — see [Local LLM backends](#local-llm-backends))
- **api** → `textRecognise()` → `translateWithServer()` (HTTP to external server)
- **gemini** → `translateWithGemini()` (annotated image to Google, skips OCR)

## Local LLM backends

WebGPU mode runs fully on-device. The engine is per-browser (Firefox-only swap — Chrome keeps MLC weights, so existing Chrome users never re-download):

| Build | Engine | Model | Weights | Backend code |
|---|---|---|---|---|
| Chrome | WebLLM (`@mlc-ai/web-llm`) | Qwen3-4B / 8B `q4f16_1-MLC` | 3.4 / 5.7 GB via WebLLM cache | `src/lib/webllm.ts` |
| Firefox | wllama (`@wllama/wllama`, MIT) | Qwen3.5-4B `IQ4_XS` GGUF | ~2.3 GB (`unsloth/Qwen3.5-4B-GGUF`, env `WXT_GGUF_MODEL_REPO`) via shared CacheStorage | `src/lib/wllama.ts` |

Selection: `llmModelDef()` / `visibleLlmModels()` in `src/lib/configs.ts` (stored `sync:llm-model` ids resolve with cross-engine fallback); offscreen routes in `translateLocalRouted` / `makeSiteRuleLocalRouted` (`src/entrypoints/offscreen/main.ts`). Both backends serve the same `TranslateResult` shape with the same `response_format` JSON-schema contract (`json_schema` on wllama, `json_object` fallback, then unconstrained + the shared cleanup parse); Qwen thinking mode is disabled via `chat_template_kwargs` when the template supports it. GGUF download/delete flows through the existing model-cache plumbing (`fetchAndCacheWithProgress`, `local:cached-llms`, Model Storage UI), so no new storage keys were needed.

Shared prompts live in `src/lib/prompts.ts` (`buildTranslationPrompts`, `buildSiteRulePrompts`), used by both `webllm.ts` and `server/main.ts`. The offscreen document (`src/entrypoints/offscreen/main.ts`) switches on `currentMode`. Background (`src/entrypoints/background/index.ts`) forwards messages and handles `TEST_BACKEND`, `PREFETCH_MODEL`, `PROXY_IMAGE`, `SEND_TELEMETRY`.

Detection never sends an image anywhere. Detection and OCR run in a dedicated offscreen document, keeping inference off the page thread and away from the popup UI.

## Detection Models

Two are bundled by default; two are selectable alternatives. Switch in **Settings › Detection › Model Selection** (`src/lib/components/settings/DetectionSettings.svelte`, options from `DefaultConfig.detectionModels` in `src/lib/configs.ts`).

| Model | Size | License | Notes |
|---|---|---|---|
| YOLO26-Nano (default) | 2.4 MB | MIT | Fast enough for interactive use; handles most manga. Precision 0.929 / Recall 0.863 / mAP@50 0.947 / mAP@50-95 0.765 on 5,595 Manga109-s + MangaDex pages. |
| YOLO26-Small | 9.5 MB | MIT | More accurate on dense / small-text pages; roughly 2.5× slower than Nano. Precision 0.937 / Recall 0.893 / mAP@50 0.961 / mAP@50-95 0.802. |
| Comic Bubble Detector (RT-DETR-v2) | 11.1 MB | Apache-2.0 | `ogkalu/comic-text-and-bubble-detector`. Detects `bubble`, `text_bubble`, `text_free`. Good at bubbles and free-floating text. |
| Comic Text Detector & Segmentation | 94.7 MB | GPL-3.0 | `comictextdetector.pt.onnx` (dmMaze via manga-image-translator beta-0.3). Returns text boxes plus a per-pixel segmentation mask (`[1, 1, 1024, 1024]`) upsampled to page resolution; `buildSegmentationSeed` seeds `fitMask()` directly from the mask, falling back to `buildInkSeed` when absent. |

**Weights:**

- YOLO: [Kiuyha/Manga-Bubble-YOLO](https://huggingface.co/Kiuyha/Manga-Bubble-YOLO)
- RT-DETR: [ogkalu/comic-text-and-bubble-detector](https://huggingface.co/ogkalu/comic-text-and-bubble-detector)
- ComicTextDetector: [dmMaze/comic-text-detector](https://github.com/dmMaze/comic-text-detector) (downloaded on-demand to local browser cache, never bundled)

Inference wrappers: `src/lib/detections/main.ts` (router), `src/lib/detections/rtdetr.ts`, `src/lib/detections/comictext.ts`, `src/lib/detections/segmentation.ts`, `src/lib/detections/boxes.ts` (`refineDetections`: deterministic `(y,x,h,w)` sort, centre-in-box merge, speckle drop, growth tiers, overlap merge).

## Detection Settings

| Setting | Default | Notes |
|---|---|---|
| Model | YOLO26-Nano | Switch to Small for dense pages, RT-DETR for bubble/free-text pages, Comic Text Detector when you want pixel-mask seeding. |
| Min Confidence | 0.5 | Lower catches more bubbles but increases false positives. |
| Auto-Update | On | Downloads new weights automatically when available. |

Storage key prefix: `sync:detection-*`. Cache keys include the resolved page index plus a `quickHash` of the image source so re-translations of the same page hit the cache reliably (`resolveImagePageIndex` in `src/entrypoints/content/utils.ts`).

## OCR Engines

Selectable in **Settings › Text Recognition (OCR) › OCR Engine** (`src/lib/components/settings/OcrSettings.svelte`). Coordinator: `src/lib/ocr/main.ts`; backends implement `OcrEngine` (`src/lib/ocr/types.ts`): `src/lib/ocr/paddle.ts`, `src/lib/ocr/manga-ocr.ts`.

| Engine | Size | Best for |
|---|---|---|
| PaddleOCR (default) | `~80 MB` | Fast multilingual generalist. Per-language-group `rec.onnx` + `dict.txt` under `languages/<group>/`. |
| Manga-OCR | `~460 MB` | Japanese manga specialist (ViT encoder + BERT decoder, 6144 vocab). Handles vertical text and stylized lettering that PaddleOCR drops or misreads. One-time large download. |

Related settings:

| Setting | Default | Notes |
|---|---|---|
| Min Confidence | 0.7 | Lower reads more text but admits background noise. Retry pass runs at `0.7×` on failed crops. Single characters (`length === 1`) demand `≥ max(minConfidence, 0.75)` to suppress noise hallucinations. |
| Language Gate | On | See [Script Gate](#script-gate). |
| Auto-Update | On | Downloads new OCR weights automatically. |

Preprocessing per region (`src/lib/ocr/utils.ts`, `src/lib/ocr/main.ts`): polarity normalization → contrast boost → padding; single-line crops (`min(h, w) < 24px`) go through whole, larger regions are sliced into lines. OCR runs at `recImgHeight: 48`, batch size 4 (`src/lib/configs.ts`).

Current target: Japanese and vertical text are considered fixed via Manga-OCR. Chinese and Korean (manhua / manhwa / webtoon) coverage is the planned OCR work.

## Inpaint Ladder

Source: `src/lib/inpaint/` (`mask.ts`, `ring.ts`, `fit.ts`, `fill.ts`, `denoise.ts`, `telea.ts`, `lama.ts`, `ladder.ts`, `quality.ts`, `constants.ts`). Pure TypeScript, no new runtime dependencies. Self-check: `bun run check:inpaint` (`scripts/inpaint-selfcheck.ts`).

Default `sync:inpaint-method = auto` fits a text-shaped mask per region (`buildInkSeed`, or `buildSegmentationSeed` when a Comic Text Detector mask exists) and uses the lightest engine that passes the quality check:

| Rung | Engine | When it wins |
|---|---|---|
| 0 | Planar fill | Flat paper around the text; samples the paper annulus (`measureRing`, least-squares plane fit). |
| 1 | Bilateral denoise | Grainy / JPEG scans (5×5, range σ = page noise floor). |
| 2 (opt-in) | LaMa redraw | Complex screentone, halftone, art behind text. Toggle **LaMa Redraw Model** under **Appearance › Inpainting** (`sync:inpaint-lama`). One-time `~207 MB` download, `~500 MB` RAM/VRAM, `~1–2s` per complex region. 512² tiled inference, 128px overlap. |
| 3 | Telea fast-marching | Real rebuilds where fill/denoise fail. Pure-JS implementation (MV3-safe, no `unsafe-eval`). |

Quality check (`quality.ts`): post-edit interior edge-energy `> 2×` the 32px surround, or off-tone vs surround p5–p95 → decline and climb to the next rung. If nothing passes, the region is left exactly as-is and flagged declined (overlay shows a declined marker). Untouched pixels stay identical — no ghost rectangles, halos, or flat patches.

Method picker (`src/lib/components/settings/InpaintSettings.svelte`): **Auto** (recommended) / **Telea** (legacy full-region fast-marching) / **Fast** (edge-blend, quicker and cruder). Per-region provenance (`{method, deviation, thickness, ms}`) and per-rung counts surface in the debug panel.

## Script Gate

Source: `src/lib/gate/` (`charset.ts`, `ctc.ts`, `osd.ts`, `index.ts`). Self-check: `bun run check:gate` (`scripts/gate-selfcheck.ts`, 57 asserts).

Before translating, each region is checked against the source language: a lightweight on-device script-identification model (`ogkalu/image-script-identification`, `~3.7 MB`, `osd_lstm.onnx`) over the actual pixels, confirmed against the recognized text (`cjkShare`, neutral chars never count). Strict when a CJK source is explicit; additive page-majority under Auto-Detect. Held-back regions keep their original text, render with a dashed amber outline, and offer **Translate anyway** (`gateForce` bypass). Toggle: **Settings › OCR › Language Gate** (`sync:script-gate`). A broken or offline gate never blocks translation — it degrades to text-only verification. Gemini mode skips the gate (VLM path).

## Model Storage & Cache Management

**Settings › Model Storage** (`src/lib/components/settings/ModelStorageSettings.svelte`) lists every downloaded weight with its size, plus per-model delete and full cache clear. Background prefetch (`PREFETCH_MODEL` in `src/entrypoints/background/index.ts`) supports all model types so onboarding and settings can warm the cache. Translation results are keyed by series + chapter + resolved page + image hash, so re-opening a page reuses prior OCR/translation work.

## Environment Overrides

Copy `.env.example` to `.env` before building. You normally do not need to touch the model entries unless you self-host weights (empty = defaults):

```
WXT_YOLO_DETECTION_MODEL_REPO=Kiuyha/Manga-Bubble-YOLO
WXT_RTDETR_MODEL_REPO=ogkalu/comic-text-and-bubble-detector
WXT_COMIC_TEXT_DETECTOR_URL=https://github.com/zyddnys/manga-image-translator/releases/download/beta-0.3/comictextdetector.pt.onnx
WXT_PADDLE_OCR_MODEL_REPO=monkt/paddleocr-onnx
WXT_MANGA_OCR_MODEL_REPO=mayocream/manga-ocr-onnx
WXT_LAMA_INPAINT_MODEL_REPO=mayocream/lama-manga-onnx
WXT_GATE_MODEL_REPO=ogkalu/image-script-identification
```

Single typed source at runtime: `src/lib/env.ts`. README-relevant gotcha from September 2026: the old `WXT_DETECTION_MODEL_REPO` / `WXT_OCR_MODEL_REPO` names were split into the seven keys above.

## Project Structure

```
src/
  assets/
    app.css              # Global styles and @font-face declarations
    fonts/               # Bundled fonts (Noto Sans, Bangers, Comic Neue)

  entrypoints/
    background/          # Service worker: message router, context menu, model prefetch/cache mgmt
    content/             # Injected into the page: overlay + sidebar, debug logging, page-index resolution
    content/debug.ts     # Ring-buffer debug logger (OCR/text/timing only, no images)
    offscreen/           # Isolated document: detection, OCR, LLM inference, inpainting
    popup/               # Extension popup (Home, Context, Settings tabs)
    setup/               # Onboarding flow shown on first install

  lib/
    adapters.ts          # Trusted core rules + URL-to-metadata matching
    adapters/            # Community site adapters (auto-imported at build)
    components/
      Overlay.svelte     # Bubble editor and translation overlay
      Sidebar.svelte     # On-page sliding config panel (floating cog)
      settings/          # Detection / Ocr / Inpaint / ModelStorage / Typography / SiteRules / Debug
    configs.ts           # Defaults: models, languages, fonts, thresholds, inpaint method
    detections/          # main.ts (router) + rtdetr.ts + comictext.ts + segmentation.ts + boxes.ts (merge/size/tiers) + utils.ts
    env.ts               # Single typed source for all WXT_* env vars
    gate/                # Script gate: charset math, CTC convention, OSD session, voting/decision
    gemini/              # Gemini API client and prompt construction
    inpaint/             # Auto engine ladder: mask fit, ring stats, planar fill, denoise, LaMa, Telea, decline metric
    ocr/                 # main.ts (coordinator) + types.ts + paddle.ts + manga-ocr.ts + utils.ts
    ort.ts               # ONNX Runtime init + execution-provider resolution
    prompts.ts           # Shared prompt builders for all backends
    server/              # API Mode: schemas.ts + main.ts (Ollama/LM Studio)
    utils.ts             # Canvas painting, text fitting, bbox math, cache hashing
    webllm.ts            # WebLLM loader and translation interface

scripts/
  inpaint-selfcheck.ts   # Inpaint ladder self-check (no framework)
  gate-selfcheck.ts      # Script gate + region build self-check (57 asserts)
  ocr-selfcheck.ts       # OCR preprocessing self-check
```

## Checks

```bash
bun install             # install dependencies
bun run check           # svelte-check — must be 0 errors
bun run check:inpaint   # inpaint ladder self-check (scripts/, no framework)
bun run check:gate      # script gate + region build self-check
bun run build           # produces .output/chrome-mv3/
bun run build:firefox   # produces .output/firefox-mv2/
bun run dev             # Chrome, hot reload
bun run dev:firefox     # Firefox, hot reload
bun run zip             # package Chrome extension zip
bun run zip:firefox     # package Firefox extension zip
```

Manual test matrix: WebGPU right-click translate; Gemini with API key; API Mode against Ollama (`http://127.0.0.1:11434/v1`) with **Test Connection**; Auto inpaint on flat-paper balloon (no ghost rectangle); Japanese page with a Latin SFX box → dashed amber + **Translate anyway**.

Chunk budget (Firefox AMO allows max ~2 MB per `.js`): `wxt.config.ts` forces terser and isolates `onnxruntime-web` into an `ort-*` chunk via the `lmt-vendor-chunk-guard` plugin (a static `manualChunks` would break WXT's single-file background/content builds, so the plugin drops it when `inlineDynamicImports` is set). `@mlc-ai/web-llm` is dynamic-only at its three use sites (`lib/webllm.ts`, setup LLM download, offscreen cache-delete) so it ships as a lazy async chunk. Each LLM-vendor import additionally sits behind a build-time `import.meta.env.FIREFOX` branch: dead-branch elimination ships web-llm **only** in Chrome builds and wllama (+8.4 MB `.wasm` asset, not `.js`) **only** in Firefox builds. The background entry stays lean by construction: it never statically imports `lib/inference.ts` (that would inline ORT + the whole pipeline into single-file `background.js`) — Firefox runs inference in `offscreen.html` inside a hidden background-page iframe sharing the pages build's split chunks (`background/utils.ts` `ensureFirefoxInferencePage`), and ORT-bound downloads live in `lib/models.ts`, never `lib/utils.ts`. Result: `firefox-mv2` has no `webllm-*` chunk, `background.js` is ~27 KB, and every `.js` is ≤ ~1 MB (guard: `bun run check:size`). wllama's emitted JS is CSP-clean (no `eval`/`new Function`, verified by scanning the chunk).

## Model Licenses

LMT code is MIT. Bundled-model weights follow their upstream licenses

- **Bubble Detection Models:**
  - Custom YOLO26 trained on Manga109-s and MangaDex datasets by Ketut Shridhara - [Hugging Face](https://huggingface.co/Kiuyha/Manga-Bubble-YOLO) (MIT)
  - `comic-text-and-bubble-detector` RT-DETR-v2 by ogkalu (Apache-2.0) - [Hugging Face](https://huggingface.co/ogkalu/comic-text-and-bubble-detector)
  - `comictextdetector.pt.onnx` by dmMaze via manga-image-translator (GPL-3.0) - [GitHub](https://github.com/dmMaze/comic-text-detector) (optional on-demand user download for text boxes + pixel-level segmentation mask)
- **Script gate model:** `image-script-identification` OSD LSTM by ogkalu (Apache-2.0) - [Hugging Face](https://huggingface.co/ogkalu/image-script-identification)
- **OCR:**
  - PaddleOCR ONNX models - [Hugging Face](https://huggingface.co/monkt/paddleocr-onnx) (Apache-2.0)
  - Manga-OCR ONNX models (optional Japanese specialist) by mayocream / kha-white - [Hugging Face](https://huggingface.co/mayocream/manga-ocr-onnx) (Apache-2.0)
- **Inpainting:**
  - Auto engine ladder: pure-JS planar fill (rung 0), bilateral denoise (rung 1), and Telea fast-marching (rung 3)
  - LaMa redraw model (rung 2, opt-in): `lama-manga.onnx` by mayocream / dreMaz / advimman (MIT) - [Hugging Face](https://huggingface.co/mayocream/lama-manga-onnx)
- **Local Translation:**
  - WebLLM (MLC-AI) with Qwen3 4B / 8B (Chrome builds)
  - wllama (llama.cpp WASM, MIT) with Qwen3.5-4B GGUF - [Hugging Face](https://huggingface.co/unsloth/Qwen3.5-4B-GGUF) (Apache-2.0 weights, Firefox builds; runtime `wllama.wasm` bundled, never CDN)

`comictextdetector.pt.onnx` is **GPL-3.0** (zyddnys / manga-image-translator). It is not bundled in the repository or release packages. When the user selects it in settings, the weights download on-demand directly to the user's local browser cache from the upstream public release. LMT's client wrapper is an independent TypeScript implementation under MIT.