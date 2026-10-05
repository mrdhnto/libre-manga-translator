# Changelog

## v1.0.1 — October 5, 2026

Maintenance and feature release introducing dedicated Korean OCR support, an interactive multi-layer visual canvas editor, always-inpaint controls, and other code improvements.

### Added

- **Pororo OCR engine:** Korean specialist engine (~74 MB ONNX, Kakao Brain TPS-VGG-BiLSTM-CTC architecture with 2,589-character vocabulary) optimized for Manhwa and Webtoon text extraction.
- **Always Inpaint toggle:** `sync:always-inpaint` setting in popup and sidebar to force text removal even when quality checks decline, preventing leftover raw text on complex artwork.
- **Multi-Layer Visual Canvas Editor:** Interactive in-place overlay editor supporting seamless switching across **Raw Scan**, **Cleaned Scan** (inpainted background), and **Result Scan** layers.
- **Inpaint Patch & Restore tools:** Interactive drawing tools (`InpaintCanvasEditor`) allowing users to paint additional inpaint patches (`add-inpaint`) or restore raw artwork (`restore-raw`) directly onto the cleaned canvas.
- **Contextual Bubble Styling & Raw Text Pill:** On-canvas typography toolbar (`ContextualStyleBar`) for instant font family, size, alignment, and color styling directly on active bubbles, alongside `FloatingRawTextPill` for real-time OCR transcript inspection.
- **Cleaned Scan Caching:** `cleanedSrc` cached in memory (`inpaintedSrcCache`) and persisted in local page cache, enabling fast layer inspection, incremental patch application without re-translating, and multi-layer JPEG export (Raw, Cleaned, Result).

### Changed

- Replaced the standalone text edit modal with the integrated multi-layer canvas editor.
- Refactored font stack resolution (`resolveFontStack`) to properly handle custom font stacks and fallbacks across the overlay editor.
- Refined overlay event isolation to allow full interaction with form controls and text inputs while continuing to block host reader navigation.

### Fixed

- Handled empty OCR boxes and tightened translation schema validation edge cases.
- Fixed overlay box deletion and addition synchronizing with draft translations and source texts.

## v1.0.0 Stable — September 25, 2026

First stable release. Fully on-device translation pipeline with cloud and self-hosted options. And a rework to make UI/UX more seamless.

### Added

- **Three translation modes:** WebGPU (fully local), Gemini (cloud), API Mode (self-hosted Ollama / LM Studio / OpenAI-compatible).
- **Bubble detection:** Comic Bubble Detector RT-DETR (default, bubbles + free text) and Comic Text Detector with pixel-mask seeding.
- **Script gate:** on-device script verification holds back wrong-language regions instead of mistranslating them; every hold-back is one-click overridable with Translate anyway.
- **OCR engines:** PaddleOCR multilingual (11 language packs, auto-switched per page), PP-OCRv6 Manga (lightweight Japanese fine-tune), Manga-OCR (Japanese flagship, vertical text specialist).
- **Inpainting:** Fast ladder (planar fill → denoise → Telea, lightest passing rung wins) and Quality mode (LaMa neural redraw first, Fast fallback per region).
- **Floating Translate pill:** hover any image to translate; becomes an action hub after translation (edit text, adjust boxes, original/translated toggle, JPEG export).
- **Auto-translate:** batch-translate chapter pages as they scroll into view, one page at a time.
- **Site adapters:** automatic series/chapter/page detection for supported readers, plus an AI rule generator for new sites.
- **Series context:** title, summary, and glossary carry across pages so names and terms stay consistent.
- **Bubble editor:** drag, resize, add, delete, undo, redo with manga reading-order numbering.
- **Model Storage:** list, download, update-check, and delete every cached weight from one panel.
- **GPU controls:** master WebGPU switch plus per-area overrides (LLM, inpaint, OCR) with WASM fallback.
- **Debug logs:** local-only session logs with timings, OCR text, translations, and per-region inpaint provenance.
- **Security:** zero telemetry, SSRF-gated image proxy, strict translation schema validation, SHA-256 model verification.
- **Theme:** Obsidian Noir dual-theme (dark + light) with four accent colors.

### Changed

- Detection lineup reduced to two detectors; old stored model selections migrate automatically to the new default.
- WebLLM lineup is now Gemma3-1B, Qwen3.5-2B, and Qwen3.5-4B.
- Model updates are manual via the Model Storage update checker instead of automatic per-model toggles.
- API keys and server settings are stored machine-local so secrets never sync across browser accounts.
- Popup simplified to Home + Settings; sidebar consolidated to Translate / Vision / Render / System.

### Removed

- All telemetry pathways and data-sharing toggles.
- Right-click context menu translation (replaced by the hover pill).
- Legacy single-engine inpainting modes.

## v1.0.0-Beta5 — September 20, 2026

New detection and OCR architectures, LaMa inpainting, model cache controls, and page-index stability.

### Added

- **RT-DETR detector:** Comic Bubble Detector (`comic-bubble`) for speech bubbles and free-text regions.
- **ComicTextDetector:** text-line detection with pixel-level segmentation mask for dense vertical Japanese (`comic-text-detector`).
- **Manga-OCR engine:** `manga-ocr-onnx` optimized for vertical Japanese manga typography.
- **LaMa inpainting:** `lama-manga.onnx` wired into the ladder as high-quality rung with Fast fallback.
- **Model Storage panel:** `ModelStorageSettings.svelte` — inspect cached ONNX weights, sizes, per-model delete; setup wizard gains multi-model downloader with progress.
- **Verification harnesses:** `scripts/ocr-selfcheck.ts`, `scripts/inpaint-selfcheck.ts`.
- **Docs:** `docs/technical.md`, refreshed README with Ollama (`qwen3.5:4b`) / LM Studio (`tiny-aya-global`) guides and new screenshots.

### Changed

- PaddleOCR confidence threshold lowered to `0.70` with improved crop batching.
- Image page resolution via `resolveImagePageIndex` + `quickHash` byte-hash cache keys; overlay box scaling fixed for natural vs rendered dimensions.
- Telemetry / share-data default flipped to opt-in (`false`).
- Default PaddleOCR weights source updated.

### Fixed

- Overlay keyboard input isolation so host reader shortcuts no longer fire while editing.
- Translation cache collisions across dynamic readers.

## v1.0.0-Beta4 — September 16, 2026

Auto inpaint ladder, script verification gate, site-adapter auto-import, and BYOK storage hardening.

### Added

- **Auto inpaint ladder (`Auto` mode, default):** fitted text-shaped masks through Planar Fill → Bilateral Denoise → Telea; decline-metric guard escalates rungs, failed regions left pixel-identical and flagged.
- **Script gate:** on-device OSD LSTM (`ogkalu/image-script-identification`, ~3.7 MB) filters SFX / background lettering / wrong-language text before translation; dashed-amber highlight with **Translate anyway** override; strict CJK mode vs Auto-Detect majority voting.
- **Site adapter auto-import:** `src/lib/adapters/*.ts` auto-loaded; new rules for MangaFire, Comick, WeebCentral, `mgeko.cc`, `comix.to`; `containerSelector` / `imageSelector` schema extension.
- **Self-checks:** `bun run check:inpaint`, `bun run check:gate`; debug panel reports per-rung counts (`fill`, `denoise`, `telea`, `declined`).

### Changed

- Sensitive keys (Gemini API key, server host / model / auth) migrated from `sync` to `local` storage with startup backward-compatible migration; `privacy.md` reconciled.
- Detection post-processing: deterministic YOLO box merging, speckle-drop, reading-order sort with directional growth.
- README / privacy updates including KoMiQ Manga Cleaner attribution.

## v1.0.0-Beta3 — September 1, 2026

Compatibility fix for click-to-next-page readers plus branding and docs.

### Fixed

- Overlay events (`click`, `drag`, pointer, touch) trapped with `stopPropagation`; native `<a>`-wrapped images also `preventDefault` so editing no longer flips pages or scrolls the reader.
- Drag in-flight guard: mouse move/up during box drag/resize no longer reaches page listeners.

### Changed

- README branded header (centered icon + shields), roadmap reworked into Released / In Progress / Known Issues / Planned, data-sharing wording clarified to original image URL + adjusted coordinates only.

## v1.0.0-Beta2 — August 30, 2026

Readability polish, CSP reliability fix, and visual showcase.

### Added

- Background telemetry relay (`SEND_TELEMETRY`) + `sync:share-data` toggle — note: later purged entirely in v1.0.0 Phase 1.
- Centralized env accessor `src/lib/env.ts` (`privacyUrl`).
- README showcase: setup wizard, live editor, Telea vs Fast, raw OCR + debug panel screenshots under `docs/images/`.

### Changed

- Custom scrollbar styling (`.custom-scrollbar`) unified across sidebar, DebugPanel, and text areas.
- Sidebar header uses extension icon (`/icon/48.png`); added to `web_accessible_resources`.
- Edit modal padding increased; overlay box delete / clear preserves manual sort order (`isManuallySorted = true`).

### Fixed

- Telemetry / series-context fetches routed via background messaging to bypass strict-site CSP fetch blocking.

## v1.0.0-Beta1 — August 30, 2026

Initial public release. Private alpha → public beta.

### Added

- **Three-way pipeline:** WebGPU local (YOLO26 detection + PaddleOCR + Qwen3 4B/8B via WebLLM), Gemini cloud (annotated-image direct), API Mode self-hosted (Ollama / LM Studio / OpenAI-compatible, text-only payloads, OpenAI + LM Studio schemas).
- **Pure-JS Telea inpainting:** MV3-CSP-safe fast-marching engine (`src/lib/inpaint/telea.ts`); Telea / Fast toggle; `inpaintedSrcCache` for instant re-render on edit.
- **Sidebar + setup:** on-page sliding `lmt-sidebar` panel, 3-card onboarding wizard, shared popup/sidebar settings.
- **Editor + export:** raw OCR surfacing per bubble, in-place edit modal, drag/resize/add/delete with undo/redo, full-res JPEG export.
- **Image pipeline:** `PROXY_IMAGE` declarativeNetRequest `Referer` injection for anti-hotlink CDNs, `sniffMime` (JPEG/PNG/WebP/GIF/AVIF), `fetchAsImageBitmap`.
- **Observability:** 50-entry ring-buffer debug log (`local:debug-logs`) with backend, OCR text, translations, per-step timings; JSON export / clipboard copy.
