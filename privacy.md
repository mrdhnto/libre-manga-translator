# Privacy Policy

**Effective Date:** September 16, 2026
**Last Updated:** October 5, 2026

This Privacy Policy describes how Libre Manga Translator ("LMT," "the Extension," "we," "us," or "our") handles information when you install and use the LMT browser extension across supported platforms, including Chromium-based browsers (Chrome, Edge, Brave) and Mozilla Firefox. Please read it carefully before using the Extension.

---

## 1. Overview

LMT is an open-source browser extension that translates manga pages in-place using artificial intelligence. Its architecture is built around one principle: your manga stays on your device.

In its default operating mode (WebGPU Mode / On-Device Local Mode), the Extension performs all image processing, text detection, text extraction, inpainting, and translation directly within your browser using your own hardware. No manga images and no translated text are ever transmitted to our servers or to any third-party server in this mode, because we do not operate any inference or tracking servers.

This policy covers the following operating modes and data practices across both Chrome and Firefox builds:

- **WebGPU / On-Device Mode:** fully on-device processing with zero external data transmission (default).
- **Gemini Mode:** optional, user-initiated cloud mode using the user's own Gemini API key.
- **API Mode:** optional, user-initiated mode connecting to a self-hosted or third-party LLM server.

> **Default state:** LMT collects no personal data and transmits zero telemetry or content data. Outbound network requests occur exclusively if you affirmatively configure and activate Gemini Mode or API Mode.

---

## 2. WebGPU Mode: Your Device, Your Data

When you use LMT in WebGPU / On-Device Mode (the default), this guarantee holds:

> **On-Device Mode Guarantee:** No manga images, no raw page content, no extracted text, and no translation output are transmitted to any server operated by LMT or any third party while on-device local translation is active. Zero telemetry is collected or transmitted.

### What runs on your device

All of the following processing occurs exclusively within your browser's sandboxed extension environment, on your local hardware:

- **Bubble detection:** A Comic Bubble Detector (RT-DETR) or Comic Text Detector ONNX model runs inside a dedicated sandboxed inference thread (offscreen document on Chrome; dedicated background inference frame on Firefox) via ONNX Runtime Web. No image data leaves this sandboxed context.
- **Script verification:** A lightweight script-identification LSTM model (OSD, ~3.7 MB, Apache-2.0 licensed) runs on-device to verify detected regions contain the source language before translation. This gate model is downloaded from Hugging Face on first use and runs entirely locally.
- **Text extraction (OCR):** On-device OCR engines process the content of each detected bounding box. Users can choose between multilingual PaddleOCR, lightweight Japanese fine-tune PP-OCRv6 Manga, Japanese specialist Manga-OCR, or Korean specialist Pororo OCR (~74 MB). All OCR inference runs 100% locally on CPU/WASM.
- **Inpainting & Redraw:** Fast engine ladder (planar fill, bilateral denoise, Telea fast-marching) with automatic quality-gated escalation removes text from speech bubbles on-device before rendering translations. An optional Quality mode runs a local LaMa neural-redraw pass first per region, and an optional "Always Inpaint" setting guarantees text removal without leaving raw text behind. All inpainting and redraw math runs entirely locally.
- **Multi-layer visual editing:** The interactive in-canvas editor allows layer switching (Raw Scan, Cleaned Scan, and Result Scan), drawing inpaint patches, and restoring original art. All patch manipulation and composite rendering happen completely in-memory on the client canvas.
- **Translation inference:**
  - **Chrome builds:** WebLLM loads a local language model (Gemma3-1B, Qwen3.5-2B, or Qwen3.5-4B) into memory and performs inference using your device's GPU via WebGPU.
  - **Firefox builds:** wllama loads local GGUF models (such as Qwen3.5-4B or Tiny Aya Global) into memory and performs inference using WebAssembly / WebGPU on-device.
  - In both browser environments, no prompt text, OCR text, or translation output is ever transmitted to any external endpoint.
- **Result rendering:** Translated text is painted onto the inpainted page using a canvas overlay that exists only in your browser tab.
- **Image intake:** Cross-origin or hotlink-protected page images may be re-fetched by the Extension's background worker (with the page URL as Referer, gated by an SSRF allowlist rejecting internal addresses) so they can be decoded for on-device inference. The fetched bytes stay in your browser; no image content is sent anywhere else.

### Model weights

The model weights are downloaded from [Hugging Face](https://huggingface.co) (or official model release repositories) when the Extension is first installed or when you select a model:

- **Bubble detection models** (RT-DETR-v2, Comic Text Detector)
- **Script gate model** (OSD script-identification LSTM, ~3.7 MB, Apache-2.0)
- **OCR models** (PaddleOCR language packs, PP-OCRv6 Manga, Manga-OCR, Pororo OCR)
- **Inpainting models** (LaMa dynamic ONNX, opt-in Quality mode)
- **Translation models** (WebLLM MLC weights in Chrome builds; GGUF model weights via wllama in Firefox builds)

These downloads involve only static model weight files and do not include any of your manga images or personal data. Hugging Face's own privacy policy governs those download requests.

---

## 3. Gemini Mode: Optional Gemini API Integration

LMT offers an optional Gemini Mode that uses Google's Gemini API for translation. Gemini Mode is **disabled by default** and must be explicitly enabled through the Extension's onboarding or Settings.

> **Gemini Mode is opt-in.** It is inactive until you explicitly enable it and enter your own Gemini API key. Once enabled, some data is transmitted to Google's servers as described below.

### What is transmitted in Gemini Mode

When Gemini Mode is active and you confirm a translation, the following data is sent directly from your browser to the Google Gemini API endpoint using your personal API key:

- **The annotated image:** A version of the manga page with numbered bounding boxes drawn over the detected speech bubbles. This processed rendering is sent to Gemini, which performs both OCR and translation in a single step.
- **Series context:** Any title, summary, or custom dictionary entries you have set for the active series in the popup Glossary or sidebar Render tab.

### What is not transmitted in Gemini Mode

Your Gemini API key is stored locally in the Extension's storage and is sent only to Google's API endpoint. It is never transmitted to LMT's servers or any other third party, because no LMT-operated server exists.

LMT does not act as a proxy for your Gemini API requests. The request goes directly from your browser to Google.

### Google's data practices

When you use Gemini Mode, your use of the Gemini API is governed by Google's Terms of Service and Google's Privacy Policy. The data you transmit to the Gemini API, including the annotated manga image and any series context, is subject to Google's data handling practices. LMT has no control over and accepts no liability for how Google processes, stores, or uses data transmitted to the Gemini API.

You are solely responsible for obtaining and managing your Gemini API key and for reviewing Google's applicable terms before enabling Gemini Mode.

---

## 4. API Mode: Optional Self-Hosted or Third-Party LLM Integration

LMT offers an optional API Mode that connects to a self-hosted or third-party LLM server (such as Ollama, LM Studio, or any OpenAI-compatible API endpoint). API Mode is **disabled by default** and must be explicitly enabled through the Extension's onboarding or Settings.

> **API Mode is opt-in.** It is inactive until you explicitly enable it and configure a server endpoint. Once enabled, some data is transmitted to your configured server as described below.

### What is transmitted in API Mode

When API Mode is active and you confirm a translation, the following data is sent directly from your browser to your configured LLM server:

- **Extracted text:** OCR results (text extracted from detected speech bubbles via PaddleOCR running on-device) are sent to your LLM server for translation. The raw page image is never transmitted in API Mode.
- **Series context:** Any title, summary, or custom dictionary entries you have set for the active series in the popup Glossary or sidebar Render tab.
- **Translation prompt:** A structured prompt requesting translation from the source language to the target language.

### What is not transmitted in API Mode

- **Raw manga images:** The original page image and inpainted image are processed entirely on-device. Only extracted text is sent to your LLM server.
- **Your API key (if configured):** If you configure an API key for your self-hosted server, it is stored locally in the Extension's storage and is sent only to your configured server endpoint. It is never transmitted to LMT's servers or any other third party.

### Third-party server data practices

When you use API Mode with a self-hosted server (e.g., Ollama, LM Studio running on localhost), the data handling is entirely under your control.

When you use API Mode with a third-party LLM provider (e.g., OpenAI, Anthropic), your use of that provider's API is governed by their Terms of Service and Privacy Policy. LMT has no control over and accepts no liability for how third-party providers process, store, or use data transmitted to their endpoints.

You are solely responsible for configuring your server endpoint, managing any API keys, and reviewing applicable terms before enabling API Mode.

---

## 5. Local Storage and Browser Data

The Extension stores certain data locally in your browser using the `chrome.storage` API (or its Firefox equivalent). This data never leaves your device unless you explicitly use Gemini Mode or API Mode as described in Sections 3 and 4. Locally stored data includes:

- **Extension settings:** Your selected operating mode (WebGPU, Gemini, or API), model selections (detection, OCR engine, LLM), confidence thresholds, font selection, server configuration (API Mode), inpainting method preference (Fast/Quality), always-inpaint toggle, language-gate toggle, auto-translate and skip-refining toggles. No telemetry or data-sharing toggle exists — there is nothing to opt out of.
- **Your Gemini API key (Gemini Mode only):** Stored in local extension storage. Never transmitted to LMT's servers.
- **Your LLM server API key (API Mode only):** Stored in local extension storage. Never transmitted to LMT's servers.
- **Series context:** Any title, summary, and custom dictionary data you create in the popup Glossary or sidebar Render tab. Stored locally and, in Gemini Mode or API Mode, transmitted to Google's Gemini API or your configured LLM server as part of the translation prompt.
- **Translation history:** The last five translation results per series, stored locally to provide context for subsequent page translations. This data remains on your device.
- **Translation cache:** Translated page images are cached locally per series/chapter/page/image-hash to avoid re-translating the same page. This data remains on your device.
- **Inpainted and cleaned scan cache:** Inpainted base images (`cleanedSrc`, via Fast ladder or Quality LaMa pass) are cached locally in memory and page storage to enable instant text redrawing, multi-layer canvas switching, and layer export. This data remains on your device.
- **Debug logs:** The last 50 translation attempts (OCR transcripts, translations, timings, error messages — no image payloads) are kept in local extension storage for troubleshooting. They are never transmitted anywhere. Do not share exported logs publicly if they contain text from pages you consider private.
- **Onboarding state:** A flag indicating whether you have completed the onboarding flow.

You may clear all locally stored Extension data at any time by uninstalling the Extension or by clearing browser extension storage through your browser's developer tools.

---

## 6. Third-Party Services

LMT interacts with the following third-party services under the conditions specified.

### Hugging Face (huggingface.co)

Model weight files are downloaded from Hugging Face's model hosting infrastructure on first install, upon engine selection, or when you trigger a manual update check (System › Model Storage). The following models may be downloaded:

- **Bubble detection:** RT-DETR-v2 (`ogkalu/comic-text-and-bubble-detector`, Apache-2.0) or Comic Text Detector (`comictextdetector.pt.onnx`, GPL-3.0)
- **Script gate:** OSD LSTM (`ogkalu/image-script-identification`, Apache-2.0)
- **OCR engines:** Multilingual PaddleOCR (`monkt/paddleocr-onnx`), PP-OCRv6 Manga (`fumetodev/PP-OCRv6_small_rec_manga_ONNX`), Manga-OCR (`mayocream/manga-ocr-onnx`), or Pororo OCR (`ogkalu/pororo`, Apache-2.0)
- **Neural inpainting:** LaMa dynamic ONNX (`ogkalu/lama-manga-onnx-dynamic`, MIT, opt-in Quality mode)
- **On-device translation:**
  - *Chrome builds:* WebLLM MLC weights (Gemma3 / Qwen3.5, Apache-2.0)
  - *Firefox builds:* GGUF quantized models (e.g., `unsloth/Qwen3.5-4B-GGUF`, `CohereLabs/tiny-aya-global-GGUF`, Apache-2.0)

The download requests contain no user content or manga images. Hugging Face may log standard server request metadata, such as IP address, per its own privacy policy.

### Google Gemini API (Gemini Mode only)

If you enable Gemini Mode and provide a Gemini API key, annotated manga images and series context data are transmitted directly from your browser to the Google Gemini API. LMT does not intermediate or proxy this request. Google's Privacy Policy and Terms of Service govern this transmission.

### Self-Hosted or Third-Party LLM Servers (API Mode only)

If you enable API Mode and configure a server endpoint, extracted text and series context data are transmitted directly from your browser to your configured server. For self-hosted servers (localhost), you control all data handling. For third-party servers, the provider's Privacy Policy and Terms of Service govern this transmission.

---

## 7. Children's Privacy

LMT is not directed to children under the age of 13, and we do not collect personal information from children under 13. Because the Extension collects no personal information, this risk is minimal.

---

## 8. Your Rights and Choices

Depending on your jurisdiction, you may have the following rights with respect to your data.

- **Right to access:** LMT collects and stores no personal data on any server. All configuration and cache data remains on your device.
- **Right to delete:** Uninstalling the Extension removes all locally stored Extension data from your browser.
- **Right to uninstall:** Uninstalling the Extension removes all locally stored Extension data from your browser.

Residents of California may have rights under the California Consumer Privacy Act (CCPA). LMT does not collect or sell personal information.

---

## 9. Changes to This Policy

We may update this Privacy Policy from time to time to reflect changes in the Extension's functionality, applicable law, or our data practices. When we make material changes, we will update the "Last Updated" date at the top of this page and, where feasible, provide notice through the Extension or its GitHub repository.

Continued use of the Extension after a policy update constitutes your acceptance of the revised policy. If you do not agree with any update, you should discontinue use of the Extension and uninstall it from your browser.

All prior versions of this Privacy Policy are available in the commit history of the Extension's GitHub repository.

---

## 10. Contact

LMT is an open-source project maintained by LMT Maintainer. If you have questions, concerns, or requests regarding this Privacy Policy or data handling practices, please contact us through one of the following channels:

- **GitHub Issues:** Open an issue at the LMT repository labeled "Privacy".

We will make reasonable efforts to respond to privacy-related inquiries within 30 days of receipt.