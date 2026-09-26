<script lang="ts">
  import { fade, fly } from "svelte/transition";
  import {
    ChevronRight,
    ShieldCheck,
    Check,
    Cpu,
    Cloud,
    Server,
    LoaderCircle,
    Download,
    Eye,
    EyeOff,
    Zap,
    CircleAlert,
    CircleCheck,
    ExternalLink,
    ArrowLeft,
    Sliders,
    Info,
  } from "lucide-svelte";
  import {
    DefaultConfig,
    defaultLlmModelId,
    llmModelDef,
    normalizeDetectionModel,
    visibleLlmModels,
  } from "@/lib/configs";
  import { UNKNOWN_DETECTION_MODEL_MESSAGE } from "@/lib/detections/main";
  // Dynamic-only: @mlc-ai/web-llm is a multi-MB prebundled file. A static
  // import would pull it into the setup page's initial chunk and break the
  // 2MB-per-.js Firefox AMO limit. It loads on demand in startLlmDownload /
  // cleanLlmModel instead (own async chunk, fetched on user click). On
  // Firefox builds the branch is statically false, so the bundler drops the
  // chunk entirely — Firefox uses wllama (GGUF).
  const loadWebLlm = () =>
    import.meta.env.FIREFOX
      ? Promise.reject(
          new Error("web-llm backend excluded from Firefox builds"),
        )
      : import("@mlc-ai/web-llm");
  import { untrack } from "svelte";
  import { env } from "@/lib/env";
  import { fetchAndCacheWithProgress, isArtifactCached } from "@/lib/utils";

  type Step =
    | "welcome"
    | "privacy"
    | "detection"
    | "mode"
    | "llm"
    | "gemini"
    | "api"
    | "ocr"
    | "inpaint";

  let step = $state<Step>("welcome");
  let isModelOnlyMode = $state(false);

  // Privacy step
  let privacyMarkdown = $state("");
  let privacyLoading = $state(false);
  let privacyFetchError = $state(false);
  let acceptedPolicy = $state(false);

  // Detection step
  let detectionModel = $state(DefaultConfig.detectionModels[0].id);
  let prevDetectionModel = untrack(() => detectionModel);
  let detectionPrefetching = $state(false);
  let detectionPrefetched = $state(false);
  let detectionProgress = $state(0);
  let detectionProgressText = $state("");
  let detectionError = $state<string | null>(null);

  // Mode step
  let selectedMode = $state<"webgpu" | "gemini" | "api">("webgpu");
  let geminiKey = $state("");
  let showKey = $state(false);
  let serverHost = $state(DefaultConfig.serverHost);
  let serverSchema = $state(DefaultConfig.serverSchema);
  let serverModel = $state(DefaultConfig.serverModel);
  let useServerApiKey = $state(DefaultConfig.useServerApiKey);
  let serverApiKey = $state(DefaultConfig.serverApiKey);

  // OCR step
  let selectedOcrEngine = $state(DefaultConfig.ocrEngine);
  let ocrDownloading = $state(false);
  let ocrDownloaded = $state(false);
  let gateDownloaded = $state(false);
  let ocrProgress = $state(0);
  let ocrProgressText = $state("");
  let ocrError = $state<string | null>(null);

  // Inpaint step
  let selectedInpaintMethod = $state<"fast" | "quality">("fast");
  let lamaDownloading = $state(false);
  let lamaDownloaded = $state(false);
  let lamaProgress = $state(0);
  let lamaProgressText = $state("");
  let lamaError = $state<string | null>(null);

  // LLM step (per-browser list: GGUF/wllama on Firefox, MLC/web-llm elsewhere)
  const browserLlmModels = visibleLlmModels();
  let selectedLlmModel = $state(defaultLlmModelId());
  let llmDownloading = $state(false);
  let llmProgress = $state(0);
  let llmProgressText = $state("Preparing...");
  let llmDone = $state(false);
  let llmError = $state<string | null>(null);
  let llmCleaning = $state(false);
  let llmCleaned = $state(false);
  let llmCleanError = $state<string | null>(null);

  // Handle ?model= query param: skip straight to LLM step
  // ?clean=1 removes the cached model then offers re-download.
  $effect(() => {
    const params = new URLSearchParams(window.location.search);
    const modelParam = params.get("model");
    if (modelParam) {
      selectedLlmModel = llmModelDef(modelParam).id;
      isModelOnlyMode = true;
      step = "llm";
      if (params.get("clean") === "1") {
        cleanLlmModel();
      }
    }
  });

  async function cleanLlmModel() {
    llmCleaning = true;
    llmCleaned = false;
    llmCleanError = null;
    llmDone = false;
    try {
      const def = llmModelDef(selectedLlmModel);
      if (def.engine === "wllama" && import.meta.env.FIREFOX) {
        const { deleteWllamaCache } = await import("@/lib/wllama");
        await deleteWllamaCache(def);
      } else {
        const { deleteModelAllInfoInCache } = await loadWebLlm();
        await deleteModelAllInfoInCache(selectedLlmModel);
      }
      const items = await storage.getItems(["local:cached-llms"]);
      const cached = (items[0].value as string[]) || [];
      await storage.setItem(
        "local:cached-llms",
        cached.filter((m) => m !== selectedLlmModel),
      );
      llmCleaned = true;
    } catch (err: any) {
      llmCleanError = err?.message ?? "Failed to clear cached model.";
    } finally {
      llmCleaning = false;
    }
  }

  $effect(() => {
    // No !llmDone guard: switching models must re-probe (a stale true would
    // pin "downloaded"). Same-value $state assignment doesn't retrigger, so
    // a settled check terminates the effect.
    if (step === "llm" && selectedLlmModel && !llmDownloading) {
      checkLlmStatus();
    }
  });

  $effect(() => {
    if (step === "detection" && detectionModel) {
      if (prevDetectionModel !== detectionModel) {
        detectionPrefetched = false;
        prevDetectionModel = detectionModel;
      }
      checkDetectionCache().then((cached) => {
        if (!cached && !detectionPrefetching) {
          prefetchDetection();
        }
      });
    }
  });

  $effect(() => {
    if (step === "ocr" && selectedOcrEngine) {
      checkOcrStatus().then((cached) => {
        if (!cached && !ocrDownloading) {
          startOcrDownload();
        }
      });
    }
  });

  $effect(() => {
    if (step === "inpaint") {
      checkLamaStatus().then((cached) => {
        if (selectedInpaintMethod === "quality" && !cached && !lamaDownloading) {
          startLamaDownload();
        }
      });
    }
  });

  async function goTo(next: Step) {
    if (next === "privacy" && !privacyMarkdown && !privacyLoading) {
      fetchPrivacy();
    }
    if (next === "detection") {
      checkDetectionCache();
    }
    if (next === "ocr") {
      checkOcrStatus();
    }
    if (next === "inpaint") {
      checkLamaStatus();
    }
    step = next;
  }

  async function fetchPrivacy() {
    privacyLoading = true;
    privacyFetchError = false;
    try {
      const res = await fetch(env.privacyUrl);
      if (!res.ok) throw new Error("Network error");
      privacyMarkdown = await res.text();
    } catch {
      privacyFetchError = true;
    } finally {
      privacyLoading = false;
    }
  }

  function parseMarkdown(md: string): string {
    const lines = md.split("\n");
    let html = "";
    let inList = false;

    for (const line of lines) {
      if (/^-{3,}$/.test(line.trim())) {
        if (inList) {
          html += "</ul>";
          inList = false;
        }
        html += '<hr class="border-[var(--border-faint)] my-3.5" />';
        continue;
      }
      if (line.startsWith("# ")) {
        if (inList) {
          html += "</ul>";
          inList = false;
        }
        html += `<h1 class="text-base font-display font-bold mb-2 text-[var(--text-primary)]">${fmt(line.slice(2))}</h1>`;
        continue;
      }
      if (line.startsWith("## ")) {
        if (inList) {
          html += "</ul>";
          inList = false;
        }
        html += `<h2 class="text-sm font-display font-bold mt-4 mb-1.5 text-[var(--text-primary)]">${fmt(line.slice(3))}</h2>`;
        continue;
      }
      if (line.startsWith("### ")) {
        if (inList) {
          html += "</ul>";
          inList = false;
        }
        html += `<h3 class="text-xs font-display font-semibold mt-3 mb-1 text-[var(--text-muted)]">${fmt(line.slice(4))}</h3>`;
        continue;
      }
      if (line.startsWith("> ")) {
        if (inList) {
          html += "</ul>";
          inList = false;
        }
        html += `<blockquote class="border-l-2 border-[var(--accent-cyan)] pl-3 my-2 py-1 text-xs italic text-[var(--text-dim)] bg-[var(--bg-void)] rounded-r">${fmt(line.slice(2))}</blockquote>`;
        continue;
      }
      if (line.startsWith("- ")) {
        if (!inList) {
          html += '<ul class="list-disc list-inside space-y-1 my-1.5">';
          inList = true;
        }
        html += `<li class="text-xs text-[var(--text-muted)] leading-relaxed">${fmt(line.slice(2))}</li>`;
        continue;
      }
      if (!line.trim()) {
        if (inList) {
          html += "</ul>";
          inList = false;
        }
        continue;
      }
      if (inList) {
        html += "</ul>";
        inList = false;
      }
      html += `<p class="text-xs leading-relaxed text-[var(--text-muted)] mb-2">${fmt(line)}</p>`;
    }
    if (inList) html += "</ul>";
    return html;
  }

  function fmt(text: string): string {
    return text
      .replace(
        /\*\*(.+?)\*\*/g,
        '<strong class="font-semibold text-[var(--text-primary)]">$1</strong>',
      )
      .replace(
        /`(.+?)`/g,
        '<code class="text-[11px] font-mono bg-[var(--surface-panel)] text-[var(--accent-cyan)] px-1.5 py-0.5 rounded border border-[var(--border-faint)]">$1</code>',
      )
      .replace(
        /\[(.+?)\]\((.+?)\)/g,
        '<a href="$2" target="_blank" rel="noopener noreferrer" class="text-[var(--accent-cyan)] hover:underline font-medium">$1</a>',
      );
  }

  async function checkDetectionCache(): Promise<boolean> {
    detectionError = null;
    let cached = false;
    if (detectionModel === "comic-bubble") {
      cached = await isArtifactCached(
        DefaultConfig.rtdetrModelRepo,
        "detector-v4-s_int8.onnx",
      );
    } else if (detectionModel === "comic-text-detector") {
      cached = await isArtifactCached(
        "direct-model-cache",
        DefaultConfig.comicTextDetectorUrl,
      );
    } else {
      throw new Error(UNKNOWN_DETECTION_MODEL_MESSAGE(detectionModel));
    }
    detectionPrefetched = cached;
    return cached;
  }

  async function prefetchDetection() {
    detectionPrefetching = true;
    detectionError = null;
    detectionProgress = 0;
    detectionProgressText = "Connecting...";
    try {
      const isCached = await checkDetectionCache();
      if (isCached) {
        detectionPrefetched = true;
        detectionProgress = 100;
        detectionPrefetching = false;
        return;
      }

      const onProgress = (loaded: number, total: number) => {
        const pct = total > 0 ? Math.round((loaded / total) * 100) : 0;
        detectionProgress = pct;
        detectionProgressText = `${(loaded / 1024 / 1024).toFixed(1)} MB${total > 0 ? ` / ${(total / 1024 / 1024).toFixed(1)} MB` : ""}`;
      };

      if (detectionModel === "comic-bubble") {
        await fetchAndCacheWithProgress(
          DefaultConfig.rtdetrModelRepo,
          "detector-v4-s_int8.onnx",
          onProgress,
        );
      } else if (detectionModel === "comic-text-detector") {
        await fetchAndCacheWithProgress(
          "direct-model-cache",
          DefaultConfig.comicTextDetectorUrl,
          onProgress,
        );
      } else {
        throw new Error(UNKNOWN_DETECTION_MODEL_MESSAGE(detectionModel));
      }
      detectionPrefetched = true;
      detectionProgress = 100;
      prevDetectionModel = detectionModel;
    } catch (err: any) {
      detectionError =
        err?.message ?? "Could not cache the model. Please check connection and retry.";
    } finally {
      detectionPrefetching = false;
    }
  }

  function ocrEngineLabel(): string {
    if (selectedOcrEngine === "manga-ocr") return "Manga-OCR";
    if (selectedOcrEngine === "ppocrv6-manga") return "PP-OCRv6 Manga";
    return "PaddleOCR";
  }

  async function checkOcrStatus(): Promise<boolean> {
    ocrError = null;
    let ocrCached = false;
    if (selectedOcrEngine === "manga-ocr") {
      ocrCached =
        (await isArtifactCached(DefaultConfig.mangaOcrRepo, "encoder_model.onnx")) &&
        (await isArtifactCached(DefaultConfig.mangaOcrRepo, "decoder_model.onnx"));
    } else if (selectedOcrEngine === "ppocrv6-manga") {
      ocrCached = await isArtifactCached(
        env.ppocrv6MangaRepo,
        "ppocr-rec-v6-small-manga.onnx",
      );
    } else {
      const [latinRec, latinDict, chineseRec, chineseDict] = await Promise.all([
        isArtifactCached(
          DefaultConfig.ocrRepo,
          DefaultConfig.ocrModelPath("latin"),
        ),
        isArtifactCached(
          DefaultConfig.ocrRepo,
          DefaultConfig.ocrDictPath("latin"),
        ),
        isArtifactCached(
          DefaultConfig.ocrRepo,
          DefaultConfig.ocrModelPath("chinese"),
        ),
        isArtifactCached(
          DefaultConfig.ocrRepo,
          DefaultConfig.ocrDictPath("chinese"),
        ),
      ]);
      ocrCached = latinRec && latinDict && chineseRec && chineseDict;
    }

    const [gateModel, gateLabels] = await Promise.all([
      isArtifactCached(DefaultConfig.gateRepo, DefaultConfig.gateModelPath),
      isArtifactCached(DefaultConfig.gateRepo, DefaultConfig.gateLabelsPath),
    ]);
    gateDownloaded = Boolean(gateModel && gateLabels);
    ocrDownloaded = ocrCached;
    return ocrCached && gateDownloaded;
  }

  async function startOcrDownload() {
    ocrDownloading = true;
    ocrError = null;
    ocrProgress = 0;
    ocrProgressText = "Preparing download...";
    try {
      if (selectedOcrEngine === "manga-ocr") {
        ocrProgressText = "Downloading Manga-OCR encoder (1/3)...";
        await fetchAndCacheWithProgress(
          DefaultConfig.mangaOcrRepo,
          "encoder_model.onnx",
          (loaded, total) => {
            const pct = total > 0 ? Math.round((loaded / total) * 40) : 0;
            ocrProgress = pct;
            ocrProgressText = `Encoder: ${(loaded / 1024 / 1024).toFixed(1)} MB${total > 0 ? ` / ${(total / 1024 / 1024).toFixed(1)} MB` : ""}`;
          },
        );
        ocrProgressText = "Downloading Manga-OCR decoder (2/3)...";
        await fetchAndCacheWithProgress(
          DefaultConfig.mangaOcrRepo,
          "decoder_model.onnx",
          (loaded, total) => {
            const pct = total > 0 ? 40 + Math.round((loaded / total) * 40) : 40;
            ocrProgress = pct;
            ocrProgressText = `Decoder: ${(loaded / 1024 / 1024).toFixed(1)} MB${total > 0 ? ` / ${(total / 1024 / 1024).toFixed(1)} MB` : ""}`;
          },
        );
        await fetchAndCacheWithProgress(DefaultConfig.mangaOcrRepo, "vocab.txt");
      } else if (selectedOcrEngine === "ppocrv6-manga") {
        ocrProgressText = "Downloading PP-OCRv6 Manga (1/2)...";
        await fetchAndCacheWithProgress(
          env.ppocrv6MangaRepo,
          "ppocr-rec-v6-small-manga.onnx",
          (loaded, total) => {
            const pct = total > 0 ? Math.round((loaded / total) * 80) : 0;
            ocrProgress = pct;
            ocrProgressText = `PP-OCRv6: ${(loaded / 1024 / 1024).toFixed(1)} MB${total > 0 ? ` / ${(total / 1024 / 1024).toFixed(1)} MB` : ""}`;
          },
        );
      } else {
        const packProgress = (stepIndex: number, steps: number) => (loaded: number, total: number) => {
          const base = ((stepIndex - 1) / steps) * 80;
          const pct = total > 0 ? Math.round((loaded / total) * (80 / steps)) : 0;
          ocrProgress = Math.min(80, Math.round(base + pct));
          ocrProgressText = `OCR Pack ${stepIndex}/${steps}: ${(loaded / 1024 / 1024).toFixed(1)} MB${total > 0 ? ` / ${(total / 1024 / 1024).toFixed(1)} MB` : ""}`;
        };
        await fetchAndCacheWithProgress(
          DefaultConfig.ocrRepo,
          DefaultConfig.ocrModelPath("latin"),
          packProgress(1, 4),
        );
        await fetchAndCacheWithProgress(
          DefaultConfig.ocrRepo,
          DefaultConfig.ocrDictPath("latin"),
          packProgress(2, 4),
        );
        await fetchAndCacheWithProgress(
          DefaultConfig.ocrRepo,
          DefaultConfig.ocrModelPath("chinese"),
          packProgress(3, 4),
        );
        await fetchAndCacheWithProgress(
          DefaultConfig.ocrRepo,
          DefaultConfig.ocrDictPath("chinese"),
          packProgress(4, 4),
        );
      }
      ocrDownloaded = true;

      // Always download language gate model (~3.7 MB)
      ocrProgressText = "Downloading Language Gate model (~3.7 MB)...";
      await fetchAndCacheWithProgress(
        DefaultConfig.gateRepo,
        DefaultConfig.gateModelPath,
        (loaded, total) => {
          const pct = total > 0 ? Math.round((loaded / total) * 20) : 0;
          ocrProgress = Math.min(99, 80 + pct);
          ocrProgressText = `Language Gate: ${(loaded / 1024 / 1024).toFixed(1)} MB${total > 0 ? ` / ${(total / 1024 / 1024).toFixed(1)} MB` : ""}`;
        },
      );
      await fetchAndCacheWithProgress(
        DefaultConfig.gateRepo,
        DefaultConfig.gateLabelsPath,
      );
      gateDownloaded = true;
      ocrProgress = 100;
      ocrProgressText = "All models ready.";
    } catch (err: any) {
      ocrError = err?.message ?? "Failed to download OCR / Language Gate model weights.";
    } finally {
      ocrDownloading = false;
    }
  }

  async function checkLamaStatus(): Promise<boolean> {
    lamaError = null;
    if (selectedInpaintMethod !== "quality") {
      lamaDownloaded = false;
      return false;
    }
    const cached = await isArtifactCached(
      DefaultConfig.lamaRepo,
      DefaultConfig.lamaModelPath,
    );
    lamaDownloaded = cached;
    return cached;
  }

  async function startLamaDownload() {
    if (selectedInpaintMethod !== "quality") return;
    lamaDownloading = true;
    lamaError = null;
    lamaProgress = 0;
    lamaProgressText = "Preparing download...";
    try {
      await fetchAndCacheWithProgress(
        DefaultConfig.lamaRepo,
        DefaultConfig.lamaModelPath,
        (loaded, total) => {
          const pct = total > 0 ? Math.round((loaded / total) * 100) : 0;
          lamaProgress = pct;
          lamaProgressText = `${(loaded / 1024 / 1024).toFixed(1)} MB${total > 0 ? ` / ${(total / 1024 / 1024).toFixed(1)} MB` : ""}`;
        },
      );
      lamaDownloaded = true;
      lamaProgress = 100;
    } catch (err: any) {
      lamaError = err?.message ?? "Failed to download LaMa model weights.";
    } finally {
      lamaDownloading = false;
    }
  }

  // LLM cache check (wllama GGUF only — web-llm manages its own opaque
  // cache, surfaced via cachedLlms). Uses the stored content-length header
  // instead of reading the body: a multi-GB blob() can stall the check.
  // Also reconciles local:cached-llms so badges agree after a refresh.
  async function checkLlmStatus(): Promise<boolean> {
    llmError = null;
    const def = llmModelDef(selectedLlmModel);
    if (def.engine !== "wllama" || !def.repo || !def.file) return false;
    try {
      const url = `https://huggingface.co/${def.repo}/resolve/main/${def.file}`;
      const cache = await caches.open(def.repo);
      const res = await cache.match(url);
      const size = res?.ok
        ? parseInt(res.headers.get("content-length") ?? "0", 10)
        : 0;
      const cached = size > 1024;
      // Assign both ways (like the OCR/LaMa checkers): a stale true would
      // otherwise pin the step to "downloaded" after switching models.
      llmDone = cached;
      if (cached) {
        llmProgress = 100;
        llmProgressText = `${(size / 1024 / 1024).toFixed(1)} MB cached`;
        const items = await storage.getItems(["local:cached-llms"]);
        const list = (items[0].value as string[]) || [];
        if (!list.includes(def.id)) {
          await storage.setItems([
            { key: "local:cached-llms", value: [...list, def.id] },
          ]);
        }
      }
      return cached;
    } catch {
      return false;
    }
  }

  async function startLlmDownload() {
    llmDownloading = true;
    llmDone = false;
    llmError = null;
    llmProgress = 0;
    llmProgressText = "Initializing...";
    try {
      const def = llmModelDef(selectedLlmModel);
      if (def.engine === "wllama" && import.meta.env.FIREFOX) {
        const { downloadWllamaModel } = await import("@/lib/wllama");
        await downloadWllamaModel(
          def,
          (loaded, total) => {
            llmProgress =
              total > 0 ? Math.round((loaded / total) * 100) : 0;
            llmProgressText = `${(loaded / 1024 / 1024).toFixed(1)} MB${total > 0 ? ` / ${(total / 1024 / 1024).toFixed(1)} MB` : ""}`;
          },
          (stage) => {
            llmProgressText = stage;
          },
        );
        llmProgress = 100;
      } else {
        const { MLCEngine } = await loadWebLlm();
        const engine = new MLCEngine({
          initProgressCallback: (p) => {
            llmProgress = Math.round((p.progress ?? 0) * 100);
            llmProgressText = p.text ?? "";
          },
        });
        await engine.reload(selectedLlmModel);
      }
      llmDone = true;
      const items = await storage.getItems(["local:cached-llms"]);
      const cached = (items[0].value as string[]) || [];
      if (!cached.includes(selectedLlmModel)) {
        await storage.setItems([
          { key: "local:cached-llms", value: [...cached, selectedLlmModel] },
        ]);
      }
    } catch (err: any) {
      llmError =
        err?.message ??
        "Download failed. Please check your connection and try again.";
    } finally {
      llmDownloading = false;
    }
  }

  async function finishSetup() {
    if (isModelOnlyMode) {
      window.close();
      return;
    }
    await storage.setItems([
      { key: "local:is-first-run", value: false },
      { key: "sync:detection-model", value: detectionModel },
      { key: "sync:current-mode", value: selectedMode },
      { key: "sync:ocr-engine", value: selectedOcrEngine },
      { key: "sync:inpaint-method", value: selectedInpaintMethod },
      ...(selectedMode === "gemini" && geminiKey.trim()
        ? ([{ key: "local:gemini-key", value: geminiKey.trim() }] as any)
        : []),
      ...(selectedMode === "api"
        ? ([
            { key: "local:server-host", value: serverHost.trim() },
            { key: "local:server-schema", value: serverSchema },
            { key: "local:server-model", value: serverModel.trim() },
            { key: "local:use-server-api-key", value: useServerApiKey },
            ...(useServerApiKey && serverApiKey.trim()
              ? [
                  {
                    key: "local:server-api-key",
                    value: serverApiKey.trim(),
                  },
                ]
              : []),
          ] as any)
        : []),
    ]);
    window.close();
  }

  let parsedPrivacy = $derived(
    privacyMarkdown ? parseMarkdown(privacyMarkdown) : "",
  );
  let activeWizardSteps = $derived<Step[]>(
    selectedMode === "gemini"
      ? ["privacy", "detection", "mode", "gemini"]
      : selectedMode === "api"
        ? ["privacy", "detection", "mode", "api", "ocr", "inpaint"]
        : ["privacy", "detection", "mode", "llm", "ocr", "inpaint"],
  );
  let wizardStepIndex = $derived(activeWizardSteps.indexOf(step));
  let progressPct = $derived(
    step === "welcome"
      ? 0
      : Math.min(100, Math.round(((wizardStepIndex + 1) / activeWizardSteps.length) * 100)),
  );
</script>

<main
  class="min-h-screen bg-[var(--bg-void-0)] text-[var(--text-primary)] flex items-center justify-center p-4 sm:p-6 font-body transition-colors"
>
  <div class="w-full max-w-[540px]">
    <!-- Model-only mode: minimal wrapper, no wizard chrome -->
    {#if isModelOnlyMode}
      <div
        in:fade={{ duration: 250 }}
        class="bg-[var(--surface-panel)] rounded-2xl border border-[var(--border-line)] shadow-[var(--shadow-panel)] overflow-hidden"
      >
        <div class="p-6 sm:p-7 space-y-5">
          <div class="flex items-center gap-3">
            <div class="p-2.5 bg-[var(--bg-void)] border border-[var(--border-line)] text-[var(--accent-cyan)] rounded-xl">
              <Download size={18} />
            </div>
            <div>
              <h2 class="text-base font-display font-bold text-[var(--text-primary)]">Update Language Model</h2>
              <p class="text-xs text-[var(--text-muted)]">
                Downloading new local inference model weights for WebGPU.
              </p>
            </div>
          </div>

          <div class="grid grid-cols-2 gap-2.5">
            {#each browserLlmModels as model}
              <button
                type="button"
                onclick={() => (selectedLlmModel = model.id)}
                disabled={llmDownloading}
                class="p-3.5 rounded-xl border text-left cursor-pointer transition-all disabled:opacity-50 disabled:cursor-not-allowed bg-[var(--bg-void)]
                  {selectedLlmModel === model.id
                  ? 'border-[var(--accent-amber)] shadow-[0_0_14px_var(--accent-amber-glow)]'
                  : 'border-[var(--border-line)] hover:border-[var(--border-line)]/80'}"
              >
                <div class="flex items-center justify-between mb-1">
                  <p
                    class="text-xs font-display font-bold {selectedLlmModel === model.id
                      ? 'text-[var(--accent-amber)]'
                      : 'text-[var(--text-primary)]'}"
                  >
                    {model.label}
                  </p>
                  <span class="badge-cyber is-amber text-[10px] !py-0.5 !px-1.5 font-mono">
                    {model.vram}{model.engine === "wllama" ? " download" : " VRAM"}
                  </span>
                </div>
                <p class="text-[11px] leading-snug {selectedLlmModel === model.id ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)]'}">
                  {model.desc}
                </p>
              </button>
            {/each}
          </div>

          {#if llmCleaning}
            <div
              in:fly={{ y: 6, duration: 200 }}
              class="flex items-center gap-2.5 p-3 bg-[var(--bg-void)] border border-[var(--accent-amber)]/40 rounded-xl"
            >
              <LoaderCircle size={16} class="text-[var(--accent-amber)] animate-spin shrink-0" />
              <p class="text-xs font-medium text-[var(--accent-amber)]">
                Cleaning up cached model info...
              </p>
            </div>
          {:else if llmCleaned}
            <div
              in:fly={{ y: 6, duration: 200 }}
              class="flex items-center gap-2.5 p-3 bg-[var(--bg-void)] border border-[var(--accent-emerald)]/40 rounded-xl"
            >
              <CircleCheck size={16} class="text-[var(--accent-emerald)] shrink-0" />
              <p class="text-xs font-medium text-[var(--accent-emerald)]">
                Cached model removed. You can download again below or close this tab.
              </p>
            </div>
          {/if}

          {#if llmCleanError}
            <div
              in:fly={{ y: 4, duration: 200 }}
              class="flex items-start gap-2.5 p-3 bg-[var(--bg-void)] border border-[var(--accent-rose)]/40 rounded-xl text-[var(--accent-rose)]"
            >
              <CircleAlert size={14} class="shrink-0 mt-0.5" />
              <p class="text-xs leading-snug">{llmCleanError}</p>
            </div>
          {/if}

          {#if !llmDone}
            <button
              type="button"
              onclick={startLlmDownload}
              disabled={llmDownloading}
              class="w-full btn-primary !py-2.5 text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer"
            >
              {#if llmDownloading}
                <LoaderCircle size={15} class="animate-spin" />
                Downloading...
              {:else}
                <Download size={15} />
                Download Model
              {/if}
            </button>

            {#if llmDownloading}
              <div in:fly={{ y: 6, duration: 200 }} class="space-y-1.5 p-3 rounded-xl bg-[var(--bg-void)] border border-[var(--border-line)]">
                <div class="flex items-center justify-between text-xs">
                  <span class="text-[var(--text-muted)]">Downloading weights</span>
                  <span class="font-mono text-[var(--accent-cyan)] font-bold">{llmProgress}%</span>
                </div>
                <div class="h-1.5 bg-[var(--surface-panel)] rounded-full overflow-hidden border border-[var(--border-faint)]">
                  <div
                    class="h-full bg-[var(--accent-cyan)] shadow-[0_0_8px_var(--accent-cyan-glow)] rounded-full transition-all duration-300"
                    style="width: {llmProgress}%"
                  ></div>
                </div>
                <p class="text-[11px] text-[var(--text-dim)] truncate font-mono">
                  {llmProgressText}
                </p>
              </div>
            {/if}
          {:else}
            <div
              in:fly={{ y: 6, duration: 200 }}
              class="flex items-center gap-2.5 p-3 bg-[var(--bg-void)] border border-[var(--accent-emerald)]/40 rounded-xl"
            >
              <CircleCheck size={16} class="text-[var(--accent-emerald)] shrink-0" />
              <p class="text-xs font-medium text-[var(--accent-emerald)]">
                Model weights cached and ready.
              </p>
            </div>
          {/if}

          {#if llmError}
            <div
              class="flex items-start gap-2 p-3 bg-[var(--bg-void)] border border-[var(--accent-rose)]/40 rounded-xl text-[var(--accent-rose)]"
            >
              <CircleAlert size={14} class="shrink-0 mt-0.5" />
              <p class="text-xs leading-snug">{llmError}</p>
            </div>
          {/if}

          <button
            type="button"
            onclick={finishSetup}
            class="w-full btn-ghost text-xs !py-2"
          >
            {llmDone ? "Done" : "Skip"}
          </button>
        </div>
      </div>
    {:else}
      <!-- Main Setup Wizard Card -->
      <div
        class="bg-[var(--surface-panel)] rounded-2xl border border-[var(--border-line)] shadow-[var(--shadow-panel)] overflow-hidden transition-all duration-200"
      >
        <!-- Card Header with Stepper Info & Integrated Progress Bar -->
        {#if step !== "welcome"}
          <div class="px-6 pt-5 pb-3 border-b border-[var(--border-faint)] flex items-center justify-between">
            <div class="flex items-center gap-2">
              <img src="/icon/48.png" alt="LMT" class="w-5 h-5 rounded object-contain" />
              <span class="font-display font-semibold text-xs tracking-tight text-[var(--text-muted)]">
                Setup Wizard
              </span>
            </div>
            <div class="flex items-center gap-2">
              <span class="badge-cyber is-cyan">
                STEP {wizardStepIndex + 1}/{activeWizardSteps.length}
              </span>
            </div>
          </div>
          <!-- Integrated progress bar -->
          <div class="h-[2px] bg-[var(--border-faint)] w-full overflow-hidden">
            <div
              class="h-full bg-[var(--accent-cyan)] shadow-[0_0_8px_var(--accent-cyan-glow)] transition-all duration-300"
              style="width: {progressPct}%"
            ></div>
          </div>
        {/if}

        {#key step}
          <div in:fly={{ y: 8, duration: 240 }} class="p-6 sm:p-7">
            <!-- ── STEP 1: WELCOME ── -->
            {#if step === "welcome"}
              <div class="flex flex-col items-center text-center gap-5">
                <div class="relative pt-2">
                  <div class="absolute -inset-1 rounded-2xl bg-[var(--accent-cyan-glow)] blur-lg opacity-40"></div>
                  <img src="/icon/128.png" alt="LMT" class="relative w-16 h-16 rounded-xl shadow-[var(--shadow-panel)] object-contain" />
                </div>

                <div class="space-y-1.5">
                  <div class="inline-flex items-center gap-1.5">
                    <h1 class="text-xl sm:text-2xl font-display font-bold tracking-tight text-[var(--text-primary)]">
                      Libre Manga Translator
                    </h1>
                  </div>
                  <p class="text-xs text-[var(--text-muted)] max-w-sm mx-auto leading-relaxed">
                    Local-first, privacy-respecting manga translation directly in your browser.
                  </p>
                </div>

                <!-- 4 Highlight Cards in 2x2 grid -->
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-left w-full">
                  <div class="p-3 rounded-xl bg-[var(--bg-void)] border border-[var(--border-line)] flex items-start gap-2.5">
                    <div class="p-1.5 rounded-lg bg-[var(--surface-panel)] border border-[var(--border-faint)] text-[var(--accent-cyan)] shrink-0 mt-0.5">
                      <ShieldCheck size={14} />
                    </div>
                    <div>
                      <p class="text-xs font-display font-bold text-[var(--text-primary)]">Private by Default</p>
                      <p class="text-[11px] text-[var(--text-muted)] leading-tight mt-0.5">
                        Zero background telemetry. Detection & OCR never leave your machine.
                      </p>
                    </div>
                  </div>

                  <div class="p-3 rounded-xl bg-[var(--bg-void)] border border-[var(--border-line)] flex items-start gap-2.5">
                    <div class="p-1.5 rounded-lg bg-[var(--surface-panel)] border border-[var(--border-faint)] text-[var(--accent-amber)] shrink-0 mt-0.5">
                      <Cpu size={14} />
                    </div>
                    <div>
                      <p class="text-xs font-display font-bold text-[var(--text-primary)]">WebGPU On-Device</p>
                      <p class="text-[11px] text-[var(--text-muted)] leading-tight mt-0.5">
                        RT-DETR + PaddleOCR + Qwen3 execute locally. Fully functional offline.
                      </p>
                    </div>
                  </div>

                  <div class="p-3 rounded-xl bg-[var(--bg-void)] border border-[var(--border-line)] flex items-start gap-2.5">
                    <div class="p-1.5 rounded-lg bg-[var(--surface-panel)] border border-[var(--border-faint)] text-[var(--accent-emerald)] shrink-0 mt-0.5">
                      <Cloud size={14} />
                    </div>
                    <div>
                      <p class="text-xs font-display font-bold text-[var(--text-primary)]">Gemini Cloud Direct</p>
                      <p class="text-[11px] text-[var(--text-muted)] leading-tight mt-0.5">
                        High accuracy multimodal translation directly to Google AI Studio.
                      </p>
                    </div>
                  </div>

                  <div class="p-3 rounded-xl bg-[var(--bg-void)] border border-[var(--border-line)] flex items-start gap-2.5">
                    <div class="p-1.5 rounded-lg bg-[var(--surface-panel)] border border-[var(--border-faint)] text-[var(--accent-cyan)] shrink-0 mt-0.5">
                      <Server size={14} />
                    </div>
                    <div>
                      <p class="text-xs font-display font-bold text-[var(--text-primary)]">API Mode Server</p>
                      <p class="text-[11px] text-[var(--text-muted)] leading-tight mt-0.5">
                        Connect your own Ollama, LM Studio, or OpenAI-compatible endpoint.
                      </p>
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onclick={() => goTo("privacy")}
                  class="w-full btn-primary !py-3 text-xs tracking-wide uppercase font-bold flex items-center justify-center gap-2 cursor-pointer mt-1"
                >
                  Get Started
                  <ChevronRight size={16} />
                </button>
              </div>

            <!-- ── STEP 2: PRIVACY ── -->
            {:else if step === "privacy"}
              <div class="space-y-4">
                <div>
                  <div class="flex items-center gap-2 mb-1">
                    <ShieldCheck size={18} class="text-[var(--accent-cyan)]" />
                    <h2 class="text-base font-display font-bold text-[var(--text-primary)]">
                      Privacy Policy &amp; Terms
                    </h2>
                  </div>
                  <p class="text-xs text-[var(--text-muted)]">
                    Local-first transparency. Review data handling practices before continuing.
                  </p>
                </div>

                <!-- Privacy Guarantee Highlights -->
                <div class="flex flex-wrap items-center gap-1.5">
                  <span class="badge-cyber is-emerald text-[10px]">
                    <Check size={10} /> Local Inference
                  </span>
                  <span class="badge-cyber is-cyan text-[10px]">
                    <Check size={10} /> Zero Tracking
                  </span>
                  <span class="badge-cyber is-amber text-[10px]">
                    <Check size={10} /> Direct Connections
                  </span>
                </div>

                <!-- Scrollable Policy Reader -->
                <div class="relative">
                  <div
                    class="h-[320px] overflow-y-auto rounded-xl bg-[var(--bg-void)] border border-[var(--border-line)] p-4 custom-scrollbar scroll-smooth"
                  >
                    {#if privacyLoading}
                      <div class="flex flex-col items-center justify-center h-full gap-2 text-[var(--text-muted)]">
                        <LoaderCircle size={20} class="animate-spin text-[var(--accent-cyan)]" />
                        <span class="text-xs font-mono">Loading policy...</span>
                      </div>
                    {:else if privacyFetchError}
                      <div class="flex flex-col items-center justify-center h-full gap-2.5 text-[var(--text-muted)] text-center p-4">
                        <CircleAlert size={22} class="text-[var(--accent-rose)]" />
                        <p class="text-xs text-[var(--text-primary)] font-medium">
                          Could not fetch remote policy document.
                        </p>
                        <p class="text-[11px] text-[var(--text-dim)]">
                          LMT performs 100% on-device processing in WebGPU mode and zero analytics tracking.
                        </p>
                        <button
                          type="button"
                          onclick={fetchPrivacy}
                          class="btn-ghost !py-1 !px-2.5 text-xs cursor-pointer mt-1"
                        >
                          Retry
                        </button>
                      </div>
                    {:else}
                      <div class="prose-clean">
                        {@html parsedPrivacy}
                      </div>
                    {/if}
                  </div>
                  <!-- Fade hint at bottom -->
                  <div
                    class="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-[var(--bg-void)] to-transparent pointer-events-none rounded-b-xl"
                  ></div>
                </div>

                <!-- Accept Checkbox -->
                <label class="flex items-center gap-3 cursor-pointer group select-none pt-0.5">
                  <div class="relative flex items-center shrink-0">
                    <input
                      type="checkbox"
                      bind:checked={acceptedPolicy}
                      class="peer sr-only"
                    />
                    <div
                      class="h-4.5 w-4.5 rounded-[4px] border border-[var(--border-line)] bg-[var(--bg-void)] peer-checked:bg-[var(--accent-cyan)] peer-checked:border-[var(--accent-cyan)] transition-all flex items-center justify-center"
                    >
                      <Check
                        size={12}
                        class="text-[#05040b] scale-0 peer-checked:scale-100 transition-transform stroke-[3]"
                      />
                    </div>
                  </div>
                  <span
                    class="text-xs font-medium text-[var(--text-primary)] group-hover:text-[var(--accent-cyan)] transition-colors"
                  >
                    I have read and agree to the Privacy Policy
                  </span>
                </label>

                <!-- Actions -->
                <div class="flex items-center gap-2.5 pt-2 border-t border-[var(--border-faint)]">
                  <button
                    type="button"
                    onclick={() => goTo("welcome")}
                    class="btn-ghost flex-1 text-xs !py-2.5 cursor-pointer"
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    onclick={() => goTo("detection")}
                    disabled={!acceptedPolicy || privacyLoading}
                    class="btn-primary flex-1 text-xs !py-2.5 font-bold cursor-pointer disabled:bg-none disabled:bg-[var(--surface-panel-alt)] disabled:border-[var(--border-line)] disabled:text-[var(--text-dim)] disabled:opacity-60 disabled:shadow-none disabled:cursor-not-allowed"
                  >
                    Accept &amp; Continue
                    <ChevronRight size={14} />
                  </button>
                </div>
              </div>

            <!-- ── STEP 3: DETECTION ── -->
            {:else if step === "detection"}
              <div class="space-y-4">
                <div>
                  <h2 class="text-base font-display font-bold text-[var(--text-primary)]">
                    Bubble Detection Model
                  </h2>
                  <p class="text-xs text-[var(--text-muted)] mt-0.5">
                    Choose the detection model used to locate text bubbles on pages.
                  </p>
                </div>

                <!-- Detection model grid -->
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {#each DefaultConfig.detectionModels as model}
                    <button
                      type="button"
                      onclick={() => (detectionModel = model.id)}
                      class="p-3.5 rounded-xl border text-left cursor-pointer transition-all disabled:opacity-60 disabled:cursor-not-allowed bg-[var(--bg-void)]
                        {detectionModel === model.id
                        ? 'border-[var(--accent-cyan)] shadow-[0_0_14px_var(--accent-cyan-glow)]'
                        : 'border-[var(--border-line)] hover:border-[var(--border-line)]/80'}"
                    >
                      <div class="flex items-center justify-between mb-1">
                        <div class="flex items-center gap-1.5">
                          <Cpu
                            size={13}
                            class={detectionModel === model.id
                              ? "text-[var(--accent-cyan)]"
                              : "text-[var(--text-dim)]"}
                          />
                          <span
                            class="text-xs font-display font-bold {detectionModel === model.id
                              ? 'text-[var(--accent-cyan)]'
                              : 'text-[var(--text-primary)]'}"
                          >
                            {model.label}
                          </span>
                        </div>
                        <span class="text-[10px] font-mono {detectionModel === model.id ? 'text-[var(--accent-cyan)] font-semibold' : 'text-[var(--text-dim)]'}">{model.size}</span>
                      </div>
                      <p class="text-[11px] leading-snug {detectionModel === model.id ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)]'}">
                        {model.desc}
                      </p>
                    </button>
                  {/each}
                </div>

                <!-- Prefetch Status Panel -->
                <div
                  class="flex flex-col gap-2 p-3.5 rounded-xl border transition-colors bg-[var(--bg-void)]
                    {detectionPrefetched
                    ? 'border-[var(--accent-emerald)]/40'
                    : detectionError
                      ? 'border-[var(--accent-rose)]/40'
                      : detectionPrefetching
                        ? 'border-[var(--accent-cyan)]/40'
                        : 'border-[var(--border-line)]'}"
                >
                  <div class="flex items-center justify-between gap-2">
                    <div class="flex items-center gap-2 min-w-0">
                      {#if detectionPrefetching}
                        <LoaderCircle size={15} class="animate-spin text-[var(--accent-cyan)] shrink-0" />
                        <span class="text-xs font-medium text-[var(--accent-cyan)] truncate">
                          Downloading detector weights...
                        </span>
                      {:else if detectionPrefetched}
                        <CircleCheck size={15} class="text-[var(--accent-emerald)] shrink-0" />
                        <span class="text-xs font-medium text-[var(--text-primary)] truncate">
                          Model cached and ready for inference.
                        </span>
                      {:else if detectionError}
                        <CircleAlert size={15} class="text-[var(--accent-rose)] shrink-0" />
                        <span class="text-xs text-[var(--accent-rose)] truncate">
                          {detectionError}
                        </span>
                      {:else}
                        <Download size={15} class="text-[var(--text-dim)] shrink-0" />
                        <span class="text-xs text-[var(--text-muted)] truncate">
                          Weights not yet downloaded.
                        </span>
                      {/if}
                    </div>

                    {#if !detectionPrefetched && !detectionPrefetching}
                      <button
                        type="button"
                        onclick={prefetchDetection}
                        class="btn-primary !py-1 !px-2.5 text-xs font-bold shrink-0 cursor-pointer"
                      >
                        Download &amp; Cache
                      </button>
                    {:else if detectionError}
                      <button
                        type="button"
                        onclick={prefetchDetection}
                        class="btn-ghost !py-1 !px-2.5 text-xs shrink-0 cursor-pointer"
                      >
                        Retry
                      </button>
                    {/if}
                  </div>

                  {#if detectionPrefetching}
                    <div class="space-y-1">
                      <div class="h-1.5 bg-[var(--surface-panel)] rounded-full overflow-hidden border border-[var(--border-faint)]">
                        <div
                          class="h-full bg-[var(--accent-cyan)] shadow-[0_0_8px_var(--accent-cyan-glow)] rounded-full transition-all duration-300"
                          style="width: {detectionProgress}%"
                        ></div>
                      </div>
                      <div class="flex justify-between text-[10px] text-[var(--text-dim)] font-mono">
                        <span>{detectionProgressText}</span>
                        <span>{detectionProgress}%</span>
                      </div>
                    </div>
                  {/if}
                </div>

                <!-- Navigation -->
                <div class="flex items-center gap-2.5 pt-2 border-t border-[var(--border-faint)]">
                  <button
                    type="button"
                    onclick={() => goTo("privacy")}
                    class="btn-ghost flex-1 text-xs !py-2.5 cursor-pointer"
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    onclick={() => goTo("mode")}
                    disabled={!detectionPrefetched || detectionPrefetching}
                    class="btn-primary flex-1 text-xs !py-2.5 font-bold cursor-pointer disabled:bg-none disabled:bg-[var(--surface-panel-alt)] disabled:border-[var(--border-line)] disabled:text-[var(--text-dim)] disabled:opacity-60 disabled:shadow-none disabled:cursor-not-allowed"
                  >
                    {#if detectionPrefetching}
                      <LoaderCircle size={14} class="animate-spin" />
                      Downloading...
                    {:else}
                      Continue
                      <ChevronRight size={14} />
                    {/if}
                  </button>
                </div>
              </div>

            <!-- ── STEP 4: MODE SELECTION ── -->
            {:else if step === "mode"}
              <div class="space-y-4">
                <div>
                  <h2 class="text-base font-display font-bold text-[var(--text-primary)]">
                    Translation Mode
                  </h2>
                  <p class="text-xs text-[var(--text-muted)] mt-0.5">
                    Select your primary translation engine. You can change this anytime from the popup.
                  </p>
                </div>

                <!-- 3 Stacked Selection Rows -->
                <div class="space-y-2.5">
                  <!-- WebGPU -->
                  <button
                    type="button"
                    onclick={() => (selectedMode = "webgpu")}
                    class="w-full p-3.5 rounded-xl border text-left cursor-pointer transition-all flex items-center justify-between gap-3 bg-[var(--bg-void)]
                      {selectedMode === 'webgpu'
                      ? 'border-[var(--accent-amber)] shadow-[0_0_14px_var(--accent-amber-glow)]'
                      : 'border-[var(--border-line)] hover:border-[var(--border-line)]/80'}"
                  >
                    <div class="flex items-start gap-3 min-w-0">
                      <div class="p-2 rounded-lg bg-[var(--surface-panel)] border border-[var(--border-faint)] text-[var(--accent-amber)] shrink-0 mt-0.5">
                        <Cpu size={18} />
                      </div>
                      <div class="min-w-0">
                        <div class="flex items-center gap-2">
                          <span class="text-xs font-display font-bold text-[var(--text-primary)]">
                            WebGPU (On-Device)
                          </span>
                          <span class="badge-cyber is-amber text-[9px] !py-0.2 !px-1.5">
                            100% Private
                          </span>
                        </div>
                        <p class="text-[11px] leading-snug mt-1 {selectedMode === 'webgpu' ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)]'}">
                          Runs offline in your browser via WebLLM. Zero text or images sent outside your PC.
                        </p>
                      </div>
                    </div>
                    <div class="w-4 h-4 rounded-full border border-[var(--border-line)] flex items-center justify-center shrink-0 {selectedMode === 'webgpu' ? 'border-[var(--accent-amber)]' : ''}">
                      {#if selectedMode === 'webgpu'}
                        <div class="w-2 h-2 rounded-full bg-[var(--accent-amber)] shadow-[0_0_6px_var(--accent-amber-glow)]"></div>
                      {/if}
                    </div>
                  </button>

                  <!-- Gemini -->
                  <button
                    type="button"
                    onclick={() => (selectedMode = "gemini")}
                    class="w-full p-3.5 rounded-xl border text-left cursor-pointer transition-all flex items-center justify-between gap-3 bg-[var(--bg-void)]
                      {selectedMode === 'gemini'
                      ? 'border-[var(--accent-emerald)] shadow-[0_0_14px_var(--accent-emerald-glow)]'
                      : 'border-[var(--border-line)] hover:border-[var(--border-line)]/80'}"
                  >
                    <div class="flex items-start gap-3 min-w-0">
                      <div class="p-2 rounded-lg bg-[var(--surface-panel)] border border-[var(--border-faint)] text-[var(--accent-emerald)] shrink-0 mt-0.5">
                        <Cloud size={18} />
                      </div>
                      <div class="min-w-0">
                        <div class="flex items-center gap-2">
                          <span class="text-xs font-display font-bold text-[var(--text-primary)]">
                            Gemini Cloud Direct
                          </span>
                          <span class="badge-cyber is-emerald text-[9px] !py-0.2 !px-1.5">
                            Fast &amp; Accurate
                          </span>
                        </div>
                        <p class="text-[11px] leading-snug mt-1 {selectedMode === 'gemini' ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)]'}">
                          Sends annotated bubbles straight to Google Gemini API using your free API key.
                        </p>
                      </div>
                    </div>
                    <div class="w-4 h-4 rounded-full border border-[var(--border-line)] flex items-center justify-center shrink-0 {selectedMode === 'gemini' ? 'border-[var(--accent-emerald)]' : ''}">
                      {#if selectedMode === 'gemini'}
                        <div class="w-2 h-2 rounded-full bg-[var(--accent-emerald)] shadow-[0_0_6px_var(--accent-emerald-glow)]"></div>
                      {/if}
                    </div>
                  </button>

                  <!-- API Mode -->
                  <button
                    type="button"
                    onclick={() => (selectedMode = "api")}
                    class="w-full p-3.5 rounded-xl border text-left cursor-pointer transition-all flex items-center justify-between gap-3 bg-[var(--bg-void)]
                      {selectedMode === 'api'
                      ? 'border-[var(--accent-cyan)] shadow-[0_0_14px_var(--accent-cyan-glow)]'
                      : 'border-[var(--border-line)] hover:border-[var(--border-line)]/80'}"
                  >
                    <div class="flex items-start gap-3 min-w-0">
                      <div class="p-2 rounded-lg bg-[var(--surface-panel)] border border-[var(--border-faint)] text-[var(--accent-cyan)] shrink-0 mt-0.5">
                        <Server size={18} />
                      </div>
                      <div class="min-w-0">
                        <div class="flex items-center gap-2">
                          <span class="text-xs font-display font-bold text-[var(--text-primary)]">
                            API Mode (Self-Hosted)
                          </span>
                          <span class="badge-cyber is-cyan text-[9px] !py-0.2 !px-1.5">
                            Custom Server
                          </span>
                        </div>
                        <p class="text-[11px] leading-snug mt-1 {selectedMode === 'api' ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)]'}">
                          Connect Llama.cpp, Ollama, LM Studio, Jan or any OpenAI Compatible. OCR stays local; text only is sent.
                        </p>
                      </div>
                    </div>
                    <div class="w-4 h-4 rounded-full border border-[var(--border-line)] flex items-center justify-center shrink-0 {selectedMode === 'api' ? 'border-[var(--accent-cyan)]' : ''}">
                      {#if selectedMode === 'api'}
                        <div class="w-2 h-2 rounded-full bg-[var(--accent-cyan)] shadow-[0_0_6px_var(--accent-cyan-glow)]"></div>
                      {/if}
                    </div>
                  </button>
                </div>

                <!-- Navigation -->
                <div class="flex items-center gap-2.5 pt-2 border-t border-[var(--border-faint)]">
                  <button
                    type="button"
                    onclick={() => goTo("detection")}
                    class="btn-ghost flex-1 text-xs !py-2.5 cursor-pointer"
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    onclick={() => goTo(selectedMode === "gemini" ? "gemini" : selectedMode === "api" ? "api" : "llm")}
                    class="btn-primary flex-1 text-xs !py-2.5 font-bold cursor-pointer"
                  >
                    Continue
                    <ChevronRight size={14} />
                  </button>
                </div>
              </div>

            <!-- ── STEP 5A: GEMINI SETUP ── -->
            {:else if step === "gemini"}
              <div class="space-y-4">
                <div>
                  <h2 class="text-base font-display font-bold text-[var(--text-primary)]">
                    Google Gemini Setup
                  </h2>
                  <p class="text-xs text-[var(--text-muted)] mt-0.5">
                    Connect directly to Gemini using your personal API key.
                  </p>
                </div>

                <!-- Security & Privacy Assurance Card -->
                <div class="p-3.5 rounded-xl bg-[var(--bg-void)] border border-[var(--border-line)] flex items-start gap-3">
                  <div class="p-1.5 rounded-lg bg-[var(--surface-panel)] border border-[var(--border-faint)] text-[var(--accent-emerald)] shrink-0 mt-0.5">
                    <ShieldCheck size={16} />
                  </div>
                  <div class="space-y-1">
                    <p class="text-xs font-display font-bold text-[var(--text-primary)]">
                      Direct Client Connection
                    </p>
                    <p class="text-[11px] text-[var(--text-muted)] leading-relaxed">
                      Your key is securely stored in your browser's local storage and sent exclusively to Google's official API endpoint. It is never routed through any LMT or third-party servers.
                    </p>
                  </div>
                </div>

                <!-- API Key Input -->
                <div class="space-y-1.5">
                  <div class="flex items-center justify-between">
                    <label
                      for="setup-gemini-key"
                      class="kicker is-emerald text-[11px]"
                    >
                      Gemini API Key
                    </label>
                    <a
                      href="https://aistudio.google.com/app/apikey"
                      target="_blank"
                      rel="noopener noreferrer"
                      class="inline-flex items-center gap-1 text-[11px] text-[var(--accent-cyan)] hover:underline font-medium"
                    >
                      Get free key from AI Studio
                      <ExternalLink size={10} />
                    </a>
                  </div>
                  <div class="relative">
                    <input
                      id="setup-gemini-key"
                      type={showKey ? "text" : "password"}
                      bind:value={geminiKey}
                      placeholder="AIzaSy..."
                      class="w-full bg-[var(--bg-void)] border border-[var(--border-line)] rounded-xl p-3 pr-11 text-xs font-mono text-[var(--text-primary)] placeholder:text-[var(--text-dim)] focus:border-[var(--accent-emerald)] outline-none transition-all"
                    />
                    <button
                      type="button"
                      onclick={() => (showKey = !showKey)}
                      class="absolute inset-y-0 right-0 flex items-center pr-3 text-[var(--text-dim)] hover:text-[var(--text-primary)] transition-colors focus:outline-none cursor-pointer"
                      aria-label={showKey ? "Hide key" : "Show key"}
                    >
                      {#if showKey}
                        <EyeOff size={15} />
                      {:else}
                        <Eye size={15} />
                      {/if}
                    </button>
                  </div>
                </div>

                <!-- Default Model Badge -->
                <div class="flex items-center justify-between p-2.5 rounded-lg bg-[var(--bg-void)] border border-[var(--border-faint)] text-xs">
                  <span class="text-[var(--text-muted)]">Active Model</span>
                  <span class="badge-cyber is-emerald text-[10px]">
                    Gemini 3.8 Flash (Default)
                  </span>
                </div>

                <!-- Cloud Multimodal Direct Info -->
                <div class="p-3 rounded-xl bg-[var(--bg-void)] border border-[var(--border-faint)] flex items-start gap-2.5 text-xs text-[var(--text-muted)]">
                  <Info size={14} class="text-[var(--accent-emerald)] shrink-0 mt-0.5" />
                  <div class="space-y-0.5">
                    <p class="font-semibold text-[var(--text-primary)]">Cloud Multimodal Pipeline</p>
                    <p class="text-[11px] leading-relaxed text-[var(--text-dim)]">
                      Gemini directly transcribes, identifies scripts, and translates speech bubbles on Google Cloud. Local OCR engines and Language Gate models are bypassed and do not require downloading.
                    </p>
                  </div>
                </div>

                <!-- Navigation -->
                <div class="flex items-center gap-2.5 pt-2 border-t border-[var(--border-faint)]">
                  <button
                    type="button"
                    onclick={() => goTo("mode")}
                    class="btn-ghost flex-1 text-xs !py-2.5 cursor-pointer"
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    onclick={finishSetup}
                    disabled={!geminiKey.trim()}
                    class="btn-primary flex-1 text-xs !py-2.5 font-bold cursor-pointer disabled:bg-none disabled:bg-[var(--surface-panel-alt)] disabled:border-[var(--border-line)] disabled:text-[var(--text-dim)] disabled:opacity-60 disabled:shadow-none disabled:cursor-not-allowed"
                  >
                    Complete Setup
                    <ChevronRight size={14} />
                  </button>
                </div>
              </div>

            <!-- ── STEP 5B: API MODE SETUP ── -->
            {:else if step === "api"}
              <div class="space-y-4">
                <div>
                  <h2 class="text-base font-display font-bold text-[var(--text-primary)]">
                    API Mode Server
                  </h2>
                  <p class="text-xs text-[var(--text-muted)] mt-0.5">
                    Connect Llama.cpp, Ollama, LM Studio, Jan or any OpenAI-compatible server.
                  </p>
                </div>

                <!-- Quick Presets -->
                <div class="space-y-1.5">
                  <span class="kicker text-[10px]">Quick Presets</span>
                  <div class="flex items-center gap-2">
                    <button
                      type="button"
                      onclick={() => {
                        serverHost = "http://127.0.0.1:11434/v1";
                        serverSchema = "openai";
                        serverModel = "qwen3.5:4b";
                      }}
                      class="btn-ghost !py-1 !px-2 text-[11px] font-mono cursor-pointer"
                    >
                      Ollama (11434)
                    </button>
                    <button
                      type="button"
                      onclick={() => {
                        serverHost = "http://127.0.0.1:1234/v1";
                        serverSchema = "openai";
                        serverModel = "qwen3.5-4b";
                      }}
                      class="btn-ghost !py-1 !px-2 text-[11px] font-mono cursor-pointer"
                    >
                      LM Studio (1234)
                    </button>
                  </div>
                </div>

                <div class="space-y-3">
                  <div class="space-y-1">
                    <label
                      for="setup-server-host"
                      class="kicker text-[11px]"
                    >
                      Server Endpoint URL
                    </label>
                    <input
                      id="setup-server-host"
                      type="text"
                      bind:value={serverHost}
                      placeholder="http://127.0.0.1:11434/v1"
                      class="w-full bg-[var(--bg-void)] border border-[var(--border-line)] rounded-xl p-2.5 text-xs focus:border-[var(--accent-cyan)] outline-none transition-all font-mono text-[var(--text-primary)]"
                    />
                  </div>

                  <div class="grid grid-cols-2 gap-2.5">
                    <div class="space-y-1">
                      <label
                        for="setup-server-schema"
                        class="kicker text-[11px]"
                      >
                        API Schema
                      </label>
                      <select
                        id="setup-server-schema"
                        bind:value={serverSchema}
                        class="w-full bg-[var(--bg-void)] border border-[var(--border-line)] rounded-xl p-2 text-xs outline-none cursor-pointer text-[var(--text-primary)]"
                      >
                        <option value="openai">OpenAI-compatible</option>
                        <option value="lmstudio">LM Studio</option>
                      </select>
                    </div>
                    <div class="space-y-1">
                      <label
                        for="setup-server-model"
                        class="kicker text-[11px]"
                      >
                        Model Identifier
                      </label>
                      <input
                        id="setup-server-model"
                        type="text"
                        bind:value={serverModel}
                        placeholder="e.g. qwen3.5:4b"
                        class="w-full bg-[var(--bg-void)] border border-[var(--border-line)] rounded-xl p-2 text-xs focus:border-[var(--accent-cyan)] outline-none transition-all text-[var(--text-primary)] font-mono"
                      />
                    </div>
                  </div>

                  <!-- API Key Toggle -->
                  <div class="space-y-2 pt-1">
                    <label class="flex items-center gap-2.5 cursor-pointer group select-none">
                      <div class="relative flex items-center shrink-0">
                        <input
                          type="checkbox"
                          bind:checked={useServerApiKey}
                          class="peer sr-only"
                        />
                        <div
                          class="h-4 w-4 rounded-[4px] border border-[var(--border-line)] bg-[var(--bg-void)] peer-checked:bg-[var(--accent-cyan)] peer-checked:border-[var(--accent-cyan)] transition-all flex items-center justify-center"
                        >
                          <Check
                            size={11}
                            class="text-[#05040b] scale-0 peer-checked:scale-100 transition-transform stroke-[3]"
                          />
                        </div>
                      </div>
                      <span class="text-xs font-medium text-[var(--text-primary)] group-hover:text-[var(--accent-cyan)] transition-colors">
                        Require Bearer API key
                      </span>
                    </label>

                    {#if useServerApiKey}
                      <div class="relative">
                        <input
                          type={showKey ? "text" : "password"}
                          bind:value={serverApiKey}
                          placeholder="Bearer API key"
                          class="w-full bg-[var(--bg-void)] border border-[var(--border-line)] rounded-xl p-2.5 pr-10 text-xs font-mono focus:border-[var(--accent-cyan)] outline-none transition-all text-[var(--text-primary)]"
                        />
                        <button
                          type="button"
                          onclick={() => (showKey = !showKey)}
                          class="absolute inset-y-0 right-0 flex items-center pr-3 text-[var(--text-dim)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
                          aria-label={showKey ? "Hide key" : "Show key"}
                        >
                          {#if showKey}
                            <EyeOff size={14} />
                          {:else}
                            <Eye size={14} />
                          {/if}
                        </button>
                      </div>
                    {/if}
                  </div>
                </div>

                <!-- Navigation -->
                <div class="flex items-center gap-2.5 pt-2 border-t border-[var(--border-faint)]">
                  <button
                    type="button"
                    onclick={() => goTo("mode")}
                    class="btn-ghost flex-1 text-xs !py-2.5 cursor-pointer"
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    onclick={() => goTo("ocr")}
                    disabled={!serverHost.trim() || !serverModel.trim()}
                    class="btn-primary flex-1 text-xs !py-2.5 font-bold cursor-pointer disabled:bg-none disabled:bg-[var(--surface-panel-alt)] disabled:border-[var(--border-line)] disabled:text-[var(--text-dim)] disabled:opacity-60 disabled:shadow-none disabled:cursor-not-allowed"
                  >
                    Continue
                    <ChevronRight size={14} />
                  </button>
                </div>
              </div>

            <!-- ── STEP 5C: LLM DOWNLOAD (WebGPU) ── -->
            {:else if step === "llm"}
              <div class="space-y-4">
                <div>
                  <h2 class="text-base font-display font-bold text-[var(--text-primary)]">
                    Local Language Model
                  </h2>
                  <p class="text-xs text-[var(--text-muted)] mt-0.5">
                    Download on-device LLM weights for WebGPU offline translation.
                  </p>
                </div>

                <!-- Model selection grid -->
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {#each browserLlmModels as model}
                    <button
                      type="button"
                      onclick={() => (selectedLlmModel = model.id)}
                      disabled={llmDownloading}
                      class="p-3.5 rounded-xl border text-left cursor-pointer transition-all disabled:opacity-50 disabled:cursor-not-allowed bg-[var(--bg-void)]
                        {selectedLlmModel === model.id
                        ? 'border-[var(--accent-amber)] shadow-[0_0_14px_var(--accent-amber-glow)]'
                        : 'border-[var(--border-line)] hover:border-[var(--border-line)]/80'}"
                    >
                      <div class="flex items-center justify-between mb-1">
                        <p
                          class="text-xs font-display font-bold {selectedLlmModel === model.id
                            ? 'text-[var(--accent-amber)]'
                            : 'text-[var(--text-primary)]'}"
                        >
                          {model.label}
                        </p>
                        <span class="badge-cyber is-amber text-[10px] !py-0.5 !px-1.5 font-mono">
                          {model.vram}{model.engine === "wllama" ? " download" : " VRAM"}
                        </span>
                      </div>
                      <p class="text-[11px] leading-snug {selectedLlmModel === model.id ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)]'}">
                        {model.desc}
                      </p>
                    </button>
                  {/each}
                </div>

                {#if !llmDone}
                  <button
                    type="button"
                    onclick={startLlmDownload}
                    disabled={llmDownloading}
                    class="w-full btn-primary !py-2.5 text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer"
                  >
                    {#if llmDownloading}
                      <LoaderCircle size={15} class="animate-spin" />
                      Downloading Weights...
                    {:else}
                      <Download size={15} />
                      Download Model Weights
                    {/if}
                  </button>

                  {#if llmDownloading}
                    <div in:fly={{ y: 6, duration: 200 }} class="space-y-1.5 p-3 rounded-xl bg-[var(--bg-void)] border border-[var(--border-line)]">
                      <div class="flex items-center justify-between text-xs">
                        <span class="text-[var(--text-muted)]">Downloading</span>
                        <span class="font-mono text-[var(--accent-cyan)] font-bold">{llmProgress}%</span>
                      </div>
                      <div class="h-1.5 bg-[var(--surface-panel)] rounded-full overflow-hidden border border-[var(--border-faint)]">
                        <div
                          class="h-full bg-[var(--accent-cyan)] shadow-[0_0_8px_var(--accent-cyan-glow)] rounded-full transition-all duration-300"
                          style="width: {llmProgress}%"
                        ></div>
                      </div>
                      <p class="text-[11px] text-[var(--text-dim)] truncate font-mono">
                        {llmProgressText}
                      </p>
                    </div>
                  {/if}
                {:else}
                  <div
                    in:fly={{ y: 6, duration: 200 }}
                    class="flex items-center gap-2.5 p-3 bg-[var(--bg-void)] border border-[var(--accent-emerald)]/40 rounded-xl"
                  >
                    <CircleCheck size={16} class="text-[var(--accent-emerald)] shrink-0" />
                    <p class="text-xs font-medium text-[var(--text-primary)]">
                      Model weights downloaded and ready for offline use.
                    </p>
                  </div>
                {/if}

                {#if llmError}
                  <div
                    class="flex items-start gap-2 p-3 bg-[var(--bg-void)] border border-[var(--accent-rose)]/40 rounded-xl text-[var(--accent-rose)]"
                  >
                    <CircleAlert size={14} class="shrink-0 mt-0.5" />
                    <p class="text-xs leading-snug">{llmError}</p>
                  </div>
                {/if}

                <!-- Navigation -->
                <div class="flex items-center gap-2.5 pt-2 border-t border-[var(--border-faint)]">
                  <button
                    type="button"
                    onclick={() => goTo("mode")}
                    class="btn-ghost flex-1 text-xs !py-2.5 cursor-pointer"
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    onclick={() => goTo("ocr")}
                    disabled={!llmDone}
                    class="btn-primary flex-1 text-xs !py-2.5 font-bold cursor-pointer disabled:bg-none disabled:bg-[var(--surface-panel-alt)] disabled:border-[var(--border-line)] disabled:text-[var(--text-dim)] disabled:opacity-60 disabled:shadow-none disabled:cursor-not-allowed"
                  >
                    Continue
                    <ChevronRight size={14} />
                  </button>
                </div>
              </div>

            <!-- ── STEP 6: OCR SELECTION ── -->
            {:else if step === "ocr"}
              <div class="space-y-4">
                <div>
                  <h2 class="text-base font-display font-bold text-[var(--text-primary)]">
                    Text Recognition (OCR)
                  </h2>
                  <p class="text-xs text-[var(--text-muted)] mt-0.5">
                    Select the on-device optical character recognition engine.
                  </p>
                </div>

                <!-- 3 Stacked OCR Cards -->
                <div class="space-y-2.5">
                  <button
                    type="button"
                    onclick={() => (selectedOcrEngine = "paddle")}
                    class="w-full p-3.5 rounded-xl border text-left cursor-pointer transition-all bg-[var(--bg-void)]
                      {selectedOcrEngine === 'paddle'
                      ? 'border-[var(--accent-cyan)] shadow-[0_0_14px_var(--accent-cyan-glow)]'
                      : 'border-[var(--border-line)] hover:border-[var(--border-line)]/80'}"
                  >
                    <div class="flex items-center justify-between mb-1">
                      <div class="flex items-center gap-2">
                        <span class="text-xs font-display font-bold {selectedOcrEngine === 'paddle' ? 'text-[var(--accent-cyan)]' : 'text-[var(--text-primary)]'}">
                          PaddleOCR (Recommended)
                        </span>
                        <span class="badge-cyber is-cyan text-[9px] !py-0.5 !px-1.5">
                          Multilingual
                        </span>
                      </div>
                      <span class="text-[10px] font-mono {selectedOcrEngine === 'paddle' ? 'text-[var(--accent-cyan)] font-semibold' : 'text-[var(--text-dim)]'}">~90 MB</span>
                    </div>
                    <p class="text-[11px] leading-snug {selectedOcrEngine === 'paddle' ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)]'}">
                      Fast multilingual engine. Ships Latin + Chinese/Japanese packs (other languages download on demand).
                    </p>
                  </button>

                  <button
                    type="button"
                    onclick={() => (selectedOcrEngine = "ppocrv6-manga")}
                    class="w-full p-3.5 rounded-xl border text-left cursor-pointer transition-all bg-[var(--bg-void)]
                      {selectedOcrEngine === 'ppocrv6-manga'
                      ? 'border-[var(--accent-cyan)] shadow-[0_0_14px_var(--accent-cyan-glow)]'
                      : 'border-[var(--border-line)] hover:border-[var(--border-line)]/80'}"
                  >
                    <div class="flex items-center justify-between mb-1">
                      <div class="flex items-center gap-2">
                        <span class="text-xs font-display font-bold {selectedOcrEngine === 'ppocrv6-manga' ? 'text-[var(--accent-cyan)]' : 'text-[var(--text-primary)]'}">
                          PP-OCRv6 Manga
                        </span>
                        <span class="badge-cyber text-[9px] !py-0.5 !px-1.5">
                          Compact
                        </span>
                      </div>
                      <span class="text-[10px] font-mono {selectedOcrEngine === 'ppocrv6-manga' ? 'text-[var(--accent-cyan)] font-semibold' : 'text-[var(--text-dim)]'}">~21 MB</span>
                    </div>
                    <p class="text-[11px] leading-snug {selectedOcrEngine === 'ppocrv6-manga' ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)]'}">
                      Japanese-only manga fine-tune with a minimal storage footprint.
                    </p>
                  </button>

                  <button
                    type="button"
                    onclick={() => (selectedOcrEngine = "manga-ocr")}
                    class="w-full p-3.5 rounded-xl border text-left cursor-pointer transition-all bg-[var(--bg-void)]
                      {selectedOcrEngine === 'manga-ocr'
                      ? 'border-[var(--accent-cyan)] shadow-[0_0_14px_var(--accent-cyan-glow)]'
                      : 'border-[var(--border-line)] hover:border-[var(--border-line)]/80'}"
                  >
                    <div class="flex items-center justify-between mb-1">
                      <div class="flex items-center gap-2">
                        <span class="text-xs font-display font-bold {selectedOcrEngine === 'manga-ocr' ? 'text-[var(--accent-cyan)]' : 'text-[var(--text-primary)]'}">
                          Manga-OCR
                        </span>
                        <span class="badge-cyber text-[9px] !py-0.5 !px-1.5">
                          High Accuracy
                        </span>
                      </div>
                      <span class="text-[10px] font-mono {selectedOcrEngine === 'manga-ocr' ? 'text-[var(--accent-cyan)] font-semibold' : 'text-[var(--text-dim)]'}">~460 MB</span>
                    </div>
                    <p class="text-[11px] leading-snug {selectedOcrEngine === 'manga-ocr' ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)]'}">
                      Deep Transformer model for complex Japanese typography and vertical text.
                    </p>
                  </button>
                </div>

                <!-- OCR Download / Cache Status Card -->
                <div
                  class="flex flex-col gap-2 p-3.5 rounded-xl border transition-colors bg-[var(--bg-void)]
                    {ocrDownloaded && gateDownloaded
                    ? 'border-[var(--accent-emerald)]/40'
                    : ocrError
                      ? 'border-[var(--accent-rose)]/40'
                      : ocrDownloading
                        ? 'border-[var(--accent-cyan)]/40'
                        : 'border-[var(--border-line)]'}"
                >
                  <div class="flex items-center justify-between gap-2">
                    <div class="flex items-center gap-2 min-w-0">
                      {#if ocrDownloading}
                        <LoaderCircle size={15} class="animate-spin text-[var(--accent-cyan)] shrink-0" />
                        <span class="text-xs font-medium text-[var(--accent-cyan)] truncate">
                          {ocrProgressText}
                        </span>
                      {:else if ocrDownloaded && gateDownloaded}
                        <CircleCheck size={15} class="text-[var(--accent-emerald)] shrink-0" />
                        <span class="text-xs font-medium text-[var(--text-primary)] truncate">
                          {ocrEngineLabel()} and Language Gate cached and ready.
                        </span>
                      {:else if ocrError}
                        <CircleAlert size={15} class="text-[var(--accent-rose)] shrink-0" />
                        <span class="text-xs text-[var(--accent-rose)] truncate">
                          {ocrError}
                        </span>
                      {:else}
                        <Download size={15} class="text-[var(--text-dim)] shrink-0" />
                        <span class="text-xs text-[var(--text-muted)] truncate">
                          Weights not yet downloaded.
                        </span>
                      {/if}
                    </div>

                    {#if (!ocrDownloaded || !gateDownloaded) && !ocrDownloading}
                      <button
                        type="button"
                        onclick={startOcrDownload}
                        class="btn-primary !py-1 !px-2.5 text-xs font-bold shrink-0 cursor-pointer"
                      >
                        Download &amp; Cache
                      </button>
                    {:else if ocrError}
                      <button
                        type="button"
                        onclick={startOcrDownload}
                        class="btn-ghost !py-1 !px-2.5 text-xs shrink-0 cursor-pointer"
                      >
                        Retry
                      </button>
                    {/if}
                  </div>

                  {#if ocrDownloading}
                    <div class="space-y-1">
                      <div class="h-1.5 bg-[var(--surface-panel)] rounded-full overflow-hidden border border-[var(--border-faint)]">
                        <div
                          class="h-full bg-[var(--accent-cyan)] shadow-[0_0_8px_var(--accent-cyan-glow)] rounded-full transition-all duration-300"
                          style="width: {ocrProgress}%"
                        ></div>
                      </div>
                      <div class="flex justify-between text-[10px] text-[var(--text-dim)] font-mono">
                        <span>{ocrProgressText}</span>
                        <span>{ocrProgress}%</span>
                      </div>
                    </div>
                  {/if}

                  <!-- Component Status Badges -->
                  <div class="flex items-center gap-1.5 pt-1 border-t border-[var(--border-faint)] text-[10px] flex-wrap">
                    <span class="text-[var(--text-dim)]">Includes:</span>
                    <span class="badge-cyber {ocrDownloaded ? 'is-emerald' : 'is-amber'} text-[9px] !py-0.2 !px-1.5">
                      {ocrEngineLabel()}: {ocrDownloaded ? "Cached" : "Needs download"}
                    </span>
                    <span class="badge-cyber {gateDownloaded ? 'is-emerald' : 'is-amber'} text-[9px] !py-0.2 !px-1.5">
                      Language Gate: {gateDownloaded ? "Cached (~3.7 MB)" : "Needs download (~3.7 MB)"}
                    </span>
                  </div>
                </div>

                <!-- Navigation -->
                <div class="flex items-center gap-2.5 pt-2 border-t border-[var(--border-faint)]">
                  <button
                    type="button"
                    onclick={() => goTo(selectedMode === "api" ? "api" : "llm")}
                    class="btn-ghost flex-1 text-xs !py-2.5 cursor-pointer"
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    onclick={() => goTo("inpaint")}
                    disabled={!ocrDownloaded || !gateDownloaded || ocrDownloading}
                    class="btn-primary flex-1 text-xs !py-2.5 font-bold cursor-pointer disabled:bg-none disabled:bg-[var(--surface-panel-alt)] disabled:border-[var(--border-line)] disabled:text-[var(--text-dim)] disabled:opacity-60 disabled:shadow-none disabled:cursor-not-allowed"
                  >
                    {#if ocrDownloading}
                      <LoaderCircle size={14} class="animate-spin" />
                      Downloading...
                    {:else}
                      Continue
                      <ChevronRight size={14} />
                    {/if}
                  </button>
                </div>
              </div>

            <!-- ── STEP 7: INPAINTING & REDRAW ── -->
            {:else if step === "inpaint"}
              <div class="space-y-4">
                <div>
                  <h2 class="text-base font-display font-bold text-[var(--text-primary)]">
                    Inpainting &amp; Redraw
                  </h2>
                  <p class="text-xs text-[var(--text-muted)] mt-0.5">
                    Configure how original text is cleared before rendering translated text.
                  </p>
                </div>

                <!-- 2 Balanced Inpainting Options -->
                <div class="space-y-2.5">
                  <button
                    type="button"
                    onclick={() => (selectedInpaintMethod = 'fast')}
                    class="w-full p-3.5 rounded-xl border text-left cursor-pointer transition-all flex items-start justify-between gap-3 bg-[var(--bg-void)]
                      {selectedInpaintMethod === 'fast'
                      ? 'border-[var(--accent-cyan)] shadow-[0_0_14px_var(--accent-cyan-glow)]'
                      : 'border-[var(--border-line)] hover:border-[var(--border-line)]/80'}"
                  >
                    <div class="min-w-0">
                      <div class="flex items-center gap-2 mb-1">
                        <span class="text-xs font-display font-bold {selectedInpaintMethod === 'fast' ? 'text-[var(--accent-cyan)]' : 'text-[var(--text-primary)]'}">
                          Fast (Recommended)
                        </span>
                        <span class="badge-cyber is-cyan text-[9px] !py-0.5 !px-1.5">
                          0 MB Extra
                        </span>
                      </div>
                      <p class="text-[11px] leading-snug {selectedInpaintMethod === 'fast' ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)]'}">
                        Model-free ladder: planar fill, bilateral denoise, and Telea. Instant, zero extra memory, perfectly cleans flat and screentone paper.
                      </p>
                    </div>
                    <div class="w-4 h-4 rounded-full border border-[var(--border-line)] flex items-center justify-center shrink-0 {selectedInpaintMethod === 'fast' ? 'border-[var(--accent-cyan)]' : ''}">
                      {#if selectedInpaintMethod === 'fast'}
                        <div class="w-2 h-2 rounded-full bg-[var(--accent-cyan)] shadow-[0_0_6px_var(--accent-cyan-glow)]"></div>
                      {/if}
                    </div>
                  </button>

                  <button
                    type="button"
                    onclick={() => (selectedInpaintMethod = 'quality')}
                    class="w-full p-3.5 rounded-xl border text-left cursor-pointer transition-all flex items-start justify-between gap-3 bg-[var(--bg-void)]
                      {selectedInpaintMethod === 'quality'
                      ? 'border-[var(--accent-cyan)] shadow-[0_0_14px_var(--accent-cyan-glow)]'
                      : 'border-[var(--border-line)] hover:border-[var(--border-line)]/80'}"
                  >
                    <div class="min-w-0">
                      <div class="flex items-center gap-2 mb-1">
                        <span class="text-xs font-display font-bold {selectedInpaintMethod === 'quality' ? 'text-[var(--accent-cyan)]' : 'text-[var(--text-primary)]'}">
                          Quality (LaMa Redraw)
                        </span>
                        <span class="badge-cyber text-[9px] !py-0.5 !px-1.5">
                          ~207 MB
                        </span>
                      </div>
                      <p class="text-[11px] leading-snug {selectedInpaintMethod === 'quality' ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)]'}">
                        Finetuned neural inpainter that reconstructs halftone and complex art textures behind speech bubbles.
                      </p>
                    </div>
                    <div class="w-4 h-4 rounded-full border border-[var(--border-line)] flex items-center justify-center shrink-0 {selectedInpaintMethod === 'quality' ? 'border-[var(--accent-cyan)]' : ''}">
                      {#if selectedInpaintMethod === 'quality'}
                        <div class="w-2 h-2 rounded-full bg-[var(--accent-cyan)] shadow-[0_0_6px_var(--accent-cyan-glow)]"></div>
                      {/if}
                    </div>
                  </button>
                </div>

                <!-- Download Card / Status -->
                {#if selectedInpaintMethod === 'quality'}
                  <div
                    class="flex flex-col gap-2 p-3.5 rounded-xl border transition-colors bg-[var(--bg-void)]
                      {lamaDownloaded
                      ? 'border-[var(--accent-emerald)]/40'
                      : lamaError
                        ? 'border-[var(--accent-rose)]/40'
                        : lamaDownloading
                          ? 'border-[var(--accent-cyan)]/40'
                          : 'border-[var(--border-line)]'}"
                  >
                    <div class="flex items-center justify-between gap-2">
                      <div class="flex items-center gap-2 min-w-0">
                        {#if lamaDownloading}
                          <LoaderCircle size={15} class="animate-spin text-[var(--accent-cyan)] shrink-0" />
                          <span class="text-xs font-medium text-[var(--accent-cyan)] truncate">
                            Downloading LaMa weights (~207 MB)...
                          </span>
                        {:else if lamaDownloaded}
                          <CircleCheck size={15} class="text-[var(--accent-emerald)] shrink-0" />
                          <span class="text-xs font-medium text-[var(--text-primary)] truncate">
                            LaMa weights cached and ready.
                          </span>
                        {:else if lamaError}
                          <CircleAlert size={15} class="text-[var(--accent-rose)] shrink-0" />
                          <span class="text-xs text-[var(--accent-rose)] truncate">
                            {lamaError}
                          </span>
                        {:else}
                          <Download size={15} class="text-[var(--text-dim)] shrink-0" />
                          <span class="text-xs text-[var(--text-muted)] truncate">
                            LaMa weights (~207 MB) not yet downloaded.
                          </span>
                        {/if}
                      </div>

                      {#if !lamaDownloaded && !lamaDownloading}
                        <button
                          type="button"
                          onclick={startLamaDownload}
                          class="btn-primary !py-1 !px-2.5 text-xs font-bold shrink-0 cursor-pointer"
                        >
                          Download Now
                        </button>
                      {:else if lamaError}
                        <button
                          type="button"
                          onclick={startLamaDownload}
                          class="btn-ghost !py-1 !px-2.5 text-xs shrink-0 cursor-pointer"
                        >
                          Retry
                        </button>
                      {/if}
                    </div>

                    {#if lamaDownloading}
                      <div class="space-y-1">
                        <div class="h-1.5 bg-[var(--surface-panel)] rounded-full overflow-hidden border border-[var(--border-faint)]">
                          <div
                            class="h-full bg-[var(--accent-cyan)] shadow-[0_0_8px_var(--accent-cyan-glow)] rounded-full transition-all duration-300"
                            style="width: {lamaProgress}%"
                          ></div>
                        </div>
                        <div class="flex justify-between text-[10px] text-[var(--text-dim)] font-mono">
                          <span>{lamaProgressText}</span>
                          <span>{lamaProgress}%</span>
                        </div>
                      </div>
                    {/if}
                  </div>
                {:else}
                  <div class="flex items-center gap-2 p-3 bg-[var(--bg-void)] border border-[var(--border-faint)] rounded-xl text-xs text-[var(--text-muted)]">
                    <Check size={14} class="text-[var(--accent-emerald)] shrink-0" />
                    <span>Built-in mathematical ladder active. Zero extra downloads required.</span>
                  </div>
                {/if}

                <!-- Navigation -->
                <div class="flex items-center gap-2.5 pt-2 border-t border-[var(--border-faint)]">
                  <button
                    type="button"
                    onclick={() => goTo("ocr")}
                    class="btn-ghost flex-1 text-xs !py-2.5 cursor-pointer"
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    onclick={finishSetup}
                    disabled={selectedInpaintMethod === 'quality' && (!lamaDownloaded || lamaDownloading)}
                    class="btn-primary flex-1 text-xs !py-2.5 font-bold cursor-pointer disabled:bg-none disabled:bg-[var(--surface-panel-alt)] disabled:border-[var(--border-line)] disabled:text-[var(--text-dim)] disabled:opacity-60 disabled:shadow-none disabled:cursor-not-allowed"
                  >
                    {#if lamaDownloading}
                      <LoaderCircle size={14} class="animate-spin" />
                      Downloading...
                    {:else}
                      Complete Setup
                      <ChevronRight size={14} />
                    {/if}
                  </button>
                </div>
              </div>
            {/if}
          </div>
        {/key}
      </div>
    {/if}
  </div>
</main>
