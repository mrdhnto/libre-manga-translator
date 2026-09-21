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
| On-device OCR | PaddleOCR ONNX (`~90 MB` Latin + Chinese/Japanese packs, multilingual default), PP-OCRv6 Manga ONNX (`~21 MB`, Japanese-only manga fine-tune) or Manga-OCR ONNX (`~460 MB`, Japanese flagship) |
| Inpainting | Auto engine ladder: pure-JS planar fill (rung 0) / bilateral denoise (rung 1) / optional LaMa redraw (rung 2, `~207 MB`) / Telea fast-marching (rung 3) |
| Local translation | [WebLLM](https://webllm.mlc.ai/) (Qwen3 4B / 8B) |
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

- **webgpu** → `textRecognise()` → `translateLocal()` (WebLLM Qwen3 in-browser)
- **api** → `textRecognise()` → `translateWithServer()` (HTTP to external server)
- **gemini** → `translateWithGemini()` (annotated image to Google, skips OCR)

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
| PaddleOCR (default) | `~90 MB` (Latin + Chinese/Japanese packs ship at setup) | Fast multilingual generalist. Per-language-group `rec.onnx` + `dict.txt` under `languages/<group>/`, resolved per page by `resolveLangGroup()` (`src/lib/configs.ts`) or the script gate's page majority under Auto-Detect; 9 more packs download on first use. |
| PP-OCRv6 Manga | `~21 MB` | Japanese-only manga fine-tune ([fumetodev/PP-OCRv6_small_rec_manga_ONNX](https://huggingface.co/fumetodev/PP-OCRv6_small_rec_manga_ONNX)) — a little bit limited but smaller size. Same CTC contract as PaddleOCR (48px height, stock ppocrv6 dict + space + blank), fixed file + bundled `public/dicts/ppocrv6_dict.txt` (refresh via `bun run extract-dict`). Limits (per model card): Japanese only; furigana is not suppressed — drop ruby lines before recognition; rare kanji outside the manga distribution and the ♥ glyph are the most common residual errors. |
| Manga-OCR | `~460 MB` | Flagship model for Japanese text & vertical writing (ViT encoder + BERT decoder, 6144 vocab). Handles vertical text and stylized lettering that PaddleOCR drops or misreads. One-time large download. |

Related settings:

| Setting | Default | Notes |
|---|---|---|
| Min Confidence | 0.7 | Lower reads more text but admits background noise. Retry pass runs at `0.7×` on failed crops. Single characters (`length === 1`) demand `≥ max(minConfidence, 0.75)` to suppress noise hallucinations. |
| Language Gate | On | See [Script Gate](#script-gate). |
| Auto-Update | On | Downloads new OCR weights automatically. |

Preprocessing per region (`src/lib/ocr/utils.ts`, `src/lib/ocr/main.ts`): polarity normalization → contrast boost → padding; single-line crops (`min(h, w) < 24px`) go through whole, larger regions are sliced into lines. OCR runs at `recImgHeight: 48`, batch size 4 (`src/lib/configs.ts`). The PaddleOCR session is keyed `repo:file` so per-group packs swap and fixed-file engines keep their session; swaps log `[ocr] swapping/loading rec model`.

Current state: per-language packs ship/fetch automatically (Latin + Chinese/Japanese in onboarding, the rest on first use, overlay names the pack while downloading). Remaining OCR work is recognition quality on Chinese/Korean layouts (manhua / manhwa / webtoon).

## Inpaint Ladder

Source: `src/lib/inpaint/` (`mask.ts`, `ring.ts`, `fit.ts`, `fill.ts`, `denoise.ts`, `telea.ts`, `lama.ts`, `ladder.ts`, `quality.ts`, `constants.ts`). Pure TypeScript, no new runtime dependencies. Self-check: `bun run check:inpaint` (`scripts/inpaint-selfcheck.ts`).

Default `sync:inpaint-method = fast` fits a text-shaped mask per region (`buildInkSeed`, or `buildSegmentationSeed` when a Comic Text Detector mask exists) and uses the lightest engine that passes the quality check:

| Rung | Engine | When it wins |
|---|---|---|
| 0 | Planar fill | Flat paper around the text; samples the paper annulus (`measureRing`, least-squares plane fit). |
| 1 | Bilateral denoise | Grainy / JPEG scans (5×5, range σ = page noise floor). |
| 2 (Quality only) | LaMa redraw | Complex screentone, halftone, art behind text. Toggle **Quality** under **Appearance › Inpainting** (`sync:inpaint-method = quality`). One-time `~207 MB` download, `~500 MB` RAM/VRAM, `~30–60s` per complex region on CPU. 512² tiled inference, 128px overlap; falls back into Fast per region where LaMa declines. |
| 3 | Telea fast-marching | Real rebuilds where fill/denoise fail. Pure-JS implementation (MV3-safe, no `unsafe-eval`). |

Quality check (`quality.ts`): post-edit interior edge-energy `> 2×` the 32px surround, or off-tone vs surround p5–p95 → decline and climb to the next rung. If nothing passes, the region is left exactly as-is and flagged declined (overlay shows a declined marker). Untouched pixels stay identical — no ghost rectangles, halos, or flat patches.

Method picker (`src/lib/components/settings/InpaintSettings.svelte`): **Fast** (model-free ladder, default) / **Quality** (LaMa-first pass, strict superset of Fast). Per-region provenance (`{method, deviation, thickness, ms}`) and per-rung counts surface in the debug panel.

## Script Gate

Source: `src/lib/gate/` (`charset.ts`, `ctc.ts`, `osd.ts`, `index.ts`). Self-check: `bun run check:gate` (`scripts/gate-selfcheck.ts`, 57 asserts).

Before translating, each region is checked against the source language: a lightweight on-device script-identification model (`ogkalu/image-script-identification`, `~3.7 MB`, `osd_lstm.onnx`) over the actual pixels, confirmed against the recognized text (`cjkShare`, neutral chars never count). Strict when a CJK source is explicit; additive page-majority under Auto-Detect. Held-back regions keep their original text, render with a dashed amber outline, and offer **Translate anyway** (`gateForce` bypass). Toggle: **Settings › OCR › Language Gate** (`sync:script-gate`). A broken or offline gate never blocks translation — it degrades to text-only verification. Gemini mode skips the gate (VLM path).

## Model Storage & Cache Management

**Settings › Model Storage** (`src/lib/components/settings/ModelStorageSettings.svelte`) lists every downloaded weight with its size plus a language badge parsed from the cached URL (`languages/<group>/` → language badge, otherwise model-name fallback), per-model delete and full cache clear. Popup and sidebar prefetch OCR weights on language/engine change (source-language loader spins while the pack lands). Onboarding ships Latin + Chinese/Japanese PaddleOCR packs so the script gate flips between them with no mid-translate fetch; other packs download on first use while the overlay names the model being downloaded. Background prefetch (`PREFETCH_MODEL` in `src/entrypoints/background/index.ts`) supports all model types so onboarding and settings can warm the cache. Translation results are keyed by series + chapter + resolved page + image hash, so re-opening a page reuses prior OCR/translation work.

## Environment Overrides

Copy `.env.example` to `.env` before building. You normally do not need to touch the model entries unless you self-host weights (empty = defaults):

```
WXT_YOLO_DETECTION_MODEL_REPO=Kiuyha/Manga-Bubble-YOLO
WXT_RTDETR_MODEL_REPO=ogkalu/comic-text-and-bubble-detector
WXT_COMIC_TEXT_DETECTOR_URL=https://github.com/zyddnys/manga-image-translator/releases/download/beta-0.3/comictextdetector.pt.onnx
WXT_PADDLE_OCR_MODEL_REPO=monkt/paddleocr-onnx
WXT_MANGA_OCR_MODEL_REPO=mayocream/manga-ocr-onnx
WXT_PPOCRV6_MANGA_REPO=fumetodev/PP-OCRv6_small_rec_manga_ONNX
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

## Model Licenses

LMT's own code is MIT. No model weights ship with the repository or the release
packages — every weight below downloads on-demand to the user's local browser
cache and follows its upstream license.

| Purpose | Model | Upstream | License | Size |
|---|---|---|---|---|
| Bubble detection (default) | YOLO26-Nano / YOLO26-Small, trained on Manga109-s + MangaDex by Ketut Shridhara ([Hugging Face](https://huggingface.co/Kiuyha/Manga-Bubble-YOLO)) | ComicTL | MIT | 2.4 / 9.5 MB |
| Bubble detection (alt) | `comic-text-and-bubble-detector` RT-DETR-v2 by ogkalu ([Hugging Face](https://huggingface.co/ogkalu/comic-text-and-bubble-detector)) | ogkalu | Apache-2.0 | 11.1 MB |
| Text boxes + segmentation | `comictextdetector.pt.onnx` by dmMaze via manga-image-translator ([GitHub](https://github.com/dmMaze/comic-text-detector)) | dmMaze / zyddnys | **GPL-3.0** (see note) | ~95 MB |
| Script gate | `image-script-identification` OSD LSTM by ogkalu ([Hugging Face](https://huggingface.co/ogkalu/image-script-identification)) | ogkalu | Apache-2.0 | ~3.7 MB |
| OCR (default) | PaddleOCR ONNX, per language group ([Hugging Face](https://huggingface.co/monkt/paddleocr-onnx)) | PaddlePaddle | Apache-2.0 | ~90 MB shipped (Latin + Chinese/Japanese); ~15 MB / further group |
| OCR (Japanese manga fine-tune) | PP-OCRv6 small rec manga ONNX by fumetodev ([Hugging Face](https://huggingface.co/fumetodev/PP-OCRv6_small_rec_manga_ONNX)) | fumetodev (base: PaddlePaddle) | Apache-2.0 | ~21 MB |
| OCR (Japanese specialist) | Manga-OCR ONNX by mayocream / kha-white ([Hugging Face](https://huggingface.co/mayocream/manga-ocr-onnx)) | mayocream / kha-white | Apache-2.0 | ~460 MB |
| Inpaint redraw (rung 2, opt-in) | `lama-manga.onnx` by mayocream / dreMaz / advimman ([Hugging Face](https://huggingface.co/mayocream/lama-manga-onnx)) | mayocream / dreMaz | MIT | ~207 MB |
| Local translation | WebLLM (MLC-AI) with Qwen3 4B / 8B | MLC-AI | Apache-2.0 | 3–6 GB |

> **GPL-3.0 note:** `comictextdetector.pt.onnx` is GPL-3.0 (zyddnys /
> manga-image-translator). It is never bundled — weights download only when the
> user explicitly selects that detector, straight from the upstream public
> release into local cache. LMT's client wrapper (`src/lib/detections/`) is an
> independent TypeScript implementation under MIT; no upstream code was copied.