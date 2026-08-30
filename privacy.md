# Privacy Policy

**Effective Date:** August 29, 2026
**Last Updated:** August 29, 2026

This Privacy Policy describes how Libre Manga Translator ("LMT," "the Extension," "we," "us," or "our") handles information when you install and use the LMT browser extension. Please read it carefully before using the Extension.

---

## 1. Overview

LMT is an open-source browser extension that translates manga pages in-place using artificial intelligence. Its architecture is built around one principle: your manga stays on your device.

In its default operating mode (WebGPU Mode), the Extension performs all image processing, text detection, text extraction, and translation directly within your browser using your own hardware. No manga images and no translated text are ever transmitted to our servers (unless you opt into telemetry) or to any third-party server in this mode, because we do not operate any inference servers.

This policy covers the following operating modes and data practices:

- **WebGPU Mode:** fully on-device processing with no external data transmission (default).
- **Gemini Mode:** optional, user-initiated mode using the user's own Gemini API key.
- **API Mode:** optional, user-initiated mode connecting to a self-hosted or third-party LLM server.
- **Anonymous Telemetry:** an opt-in data sharing program that includes bounding box coordinates, image or page URLs, and series metadata.

> **Default state:** LMT collects no personal data and transmits no content data by default. You must affirmatively opt into Gemini Mode, API Mode, and/or telemetry for any outbound data to occur.

---

## 2. WebGPU Mode: Your Device, Your Data

When you use LMT in WebGPU Mode (the default), this guarantee holds:

> **WebGPU Mode Guarantee:** No manga images, no raw page content, no extracted text, and no translation output are transmitted to any server operated by LMT or any third party while WebGPU Mode is active except you opt into telemetry.

### What runs on your device

All of the following processing occurs exclusively within your browser's sandboxed extension environment, on your local hardware:

- **Bubble detection:** A YOLO-Nano or YOLO-Small ONNX model runs inside a dedicated offscreen document via ONNX Runtime Web. No image data leaves this sandboxed context.
- **Text extraction:** PaddleOCR ONNX model processes the content of each detected bounding box on-device.
- **Inpainting:** Pure-JS Telea fast-marching algorithm (with local fallback) removes text from speech bubbles on-device before rendering translations.
- **Translation:** WebLLM loads a local language model (Qwen3-4B or Qwen3-8B) into memory and performs inference using your device's GPU via WebGPU. No text is transmitted to any external endpoint.
- **Result rendering:** Translated text is painted onto the inpainted page using a canvas overlay that exists only in your browser tab.

### Model weights

The model weights are downloaded from [Hugging Face](https://huggingface.co) when the Extension is first installed or when a model update is available. This download involves only the model weight files and does not include any of your manga images or personal data. Hugging Face's own privacy policy governs that download request.

---

## 3. Gemini Mode: Optional Gemini API Integration

LMT offers an optional Gemini Mode that uses Google's Gemini API for translation. Gemini Mode is **disabled by default** and must be explicitly enabled through the Extension's onboarding or Settings.

> **Gemini Mode is opt-in.** It is inactive until you explicitly enable it and enter your own Gemini API key. Once enabled, some data is transmitted to Google's servers as described below.

### What is transmitted in Gemini Mode

When Gemini Mode is active and you confirm a translation, the following data is sent directly from your browser to the Google Gemini API endpoint using your personal API key:

- **The annotated image:** A version of the manga page with numbered bounding boxes drawn over the detected speech bubbles. This processed rendering is sent to Gemini, which performs both OCR and translation in a single step.
- **Series context:** Any title, summary, or custom dictionary entries you have set for the active series in the Context tab.

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
- **Series context:** Any title, summary, or custom dictionary entries you have set for the active series in the Context tab.
- **Translation prompt:** A structured prompt requesting translation from the source language to the target language.

### What is not transmitted in API Mode

- **Raw manga images:** The original page image and inpainted image are processed entirely on-device. Only extracted text is sent to your LLM server.
- **Your API key (if configured):** If you configure an API key for your self-hosted server, it is stored locally in the Extension's storage and is sent only to your configured server endpoint. It is never transmitted to LMT's servers or any other third party.

### Third-party server data practices

When you use API Mode with a self-hosted server (e.g., Ollama, LM Studio running on localhost), the data handling is entirely under your control.

When you use API Mode with a third-party LLM provider (e.g., OpenAI, Anthropic), your use of that provider's API is governed by their Terms of Service and Privacy Policy. LMT has no control over and accepts no liability for how third-party providers process, store, or use data transmitted to their endpoints.

You are solely responsible for configuring your server endpoint, managing any API keys, and reviewing applicable terms before enabling API Mode.

---

## 5. Anonymous Telemetry: Opt-In Data Sharing

LMT provides an option for users to voluntarily share data to help improve the accuracy of the YOLO detection model. This program is **strictly opt-in** and is presented during the Extension's onboarding flow. You may withdraw at any time through the Settings tab.

> **Default state: OFF.** Telemetry is disabled by default during onboarding. If you did not opt in, no telemetry data is ever collected or transmitted.

### What telemetry data contains

If you opt in, the Extension submits the following data to our telemetry database when you manually adjust, add, or delete bounding boxes:

- **Bounding box coordinates:** The pixel coordinates (x, y, width, height) of each detected and user-adjusted speech bubble, stored as structured JSON.
- **Image reference / URL:** The image source URL (or the full page URL if the image source is an embedded data/blob URL). The Extension does not upload or transmit raw page image files or base64 payloads to telemetry.
- **Series metadata:** The series name, chapter identifier, and page index are recorded to organize submissions by source and to avoid counting duplicate pages multiple times.

### What telemetry data does not contain

The telemetry submission is not capable of transmitting personal information. It contains no browser fingerprints, no device identifiers, no account credentials, and no translated or extracted text.

The submission schema is limited to: a random UUID, a timestamp, series name, chapter ID, page index, image/page URL, and the bounding box array. Nothing in that schema can be traced back to a specific person.

### How telemetry data is used

Telemetry data is used solely to build and verify training datasets for future versions of the LMT YOLO bubble detection model. The bounding box coordinates and associated page/image references allow us to understand how users correct automated detections, which improves model recall and precision over time. The data is not sold, shared with third parties for commercial purposes, or used for any purpose other than model improvement.

### Telemetry data storage

Telemetry data is stored in our database backend (such as Cloudflare D1 / serverless storage). We retain telemetry submissions indefinitely for model training and evaluation purposes.

---

## 6. Local Storage and Browser Data

The Extension stores certain data locally in your browser using the `chrome.storage` API (or its Firefox equivalent). This data never leaves your device unless you explicitly use Gemini Mode or API Mode as described in Sections 3 and 4. Locally stored data includes:

- **Extension settings:** Your selected operating mode (WebGPU, Gemini, or API), model size preference, minimum confidence threshold, font selection, server configuration (API Mode), and auto-update preference.
- **Your Gemini API key (Gemini Mode only):** Stored in local extension storage. Never transmitted to LMT's servers.
- **Your LLM server API key (API Mode only):** Stored in local extension storage. Never transmitted to LMT's servers.
- **Series context:** Any title, summary, and custom dictionary data you create in the Context tab. Stored locally and, in Gemini Mode or API Mode, transmitted to Google's Gemini API or your configured LLM server as part of the translation prompt.
- **Translation history:** The last five translation results per series, stored locally to provide context for subsequent page translations. This data remains on your device.
- **Translation cache:** Translated page images are cached locally per series/chapter/page to avoid re-translating the same page. This data remains on your device.
- **Inpainted image cache:** Inpainted base images (text removed via pure-JS Telea fast-marching) are cached locally per image source during a translation session to enable fast text redrawing. This cache is cleared when you close the translation overlay.
- **Onboarding state:** A flag indicating whether you have completed the onboarding flow and your telemetry opt-in decision.

You may clear all locally stored Extension data at any time by uninstalling the Extension or by clearing browser extension storage through your browser's developer tools.

---

## 7. Third-Party Services

LMT interacts with the following third-party services under the conditions specified.

### Hugging Face (huggingface.co)

Model weight files are downloaded from Hugging Face's model hosting infrastructure on first install and when model updates are available (if Auto-Update is enabled in Settings). The download request contains no user content. Hugging Face may log standard server request metadata, such as IP address, per its own privacy policy.

### Google Gemini API (Gemini Mode only)

If you enable Gemini Mode and provide a Gemini API key, annotated manga images and series context data are transmitted directly from your browser to the Google Gemini API. LMT does not intermediate or proxy this request. Google's Privacy Policy and Terms of Service govern this transmission.

### Self-Hosted or Third-Party LLM Servers (API Mode only)

If you enable API Mode and configure a server endpoint, extracted text and series context data are transmitted directly from your browser to your configured server. For self-hosted servers (localhost), you control all data handling. For third-party servers, the provider's Privacy Policy and Terms of Service govern this transmission.

### Telemetry Backend (Telemetry opt-in only)

If you opt into the anonymous telemetry program, bounding box coordinate data and associated image/page URLs are transmitted to our telemetry ingest endpoint. Database records are stored on secure serverless infrastructure (such as Cloudflare D1). No raw page image files or base64 image data are transmitted.

---

## 8. Children's Privacy

LMT is not directed to children under the age of 13, and we do not knowingly collect personal information from children under 13. Because the Extension does not collect personal information by default, this risk is minimal. If you are a parent or guardian and believe your child has submitted data through the Extension's optional telemetry program, please contact us using the information in Section 11 and we will take steps to delete that data.

---

## 9. Your Rights and Choices

Depending on your jurisdiction, you may have the following rights with respect to your data.

- **Right to access:** You may request a copy of any data we hold. Because LMT collects no personal data by default, this right is primarily relevant if you have participated in the opt-in telemetry program.
- **Right to deletion:** You may request deletion of any telemetry data linked to your submissions. Note that telemetry submissions contain no unique user identifiers, which may limit our ability to isolate submissions from a specific individual. Contact us at the address in Section 11 and we will make reasonable efforts to comply.
- **Right to opt out of telemetry:** You may disable telemetry participation at any time by navigating to the Settings tab in the Extension popup and toggling off the data sharing option.
- **Right to uninstall:** Uninstalling the Extension removes all locally stored Extension data from your browser.

Residents of the European Economic Area (EEA) and the United Kingdom may have additional rights under the General Data Protection Regulation (GDPR) and the UK GDPR, including the right to lodge a complaint with a supervisory authority. Because LMT processes no personal data in its default operation, the legal basis for any telemetry processing is your explicit consent, which you may withdraw at any time.

Residents of California may have rights under the California Consumer Privacy Act (CCPA). LMT does not sell personal information.

---

## 10. Changes to This Policy

We may update this Privacy Policy from time to time to reflect changes in the Extension's functionality, applicable law, or our data practices. When we make material changes, we will update the "Last Updated" date at the top of this page and, where feasible, provide notice through the Extension or its GitHub repository.

Continued use of the Extension after a policy update constitutes your acceptance of the revised policy. If you do not agree with any update, you should discontinue use of the Extension and uninstall it from your browser.

All prior versions of this Privacy Policy are available in the commit history of the Extension's GitHub repository.

---

## 11. Contact

LMT is an open-source project maintained by LMT Maintainer. If you have questions, concerns, or requests regarding this Privacy Policy or data handling practices, please contact us through one of the following channels:

- **GitHub Issues:** Open an issue at the LMT repository labeled "Privacy".

We will make reasonable efforts to respond to privacy-related inquiries within 30 days of receipt.