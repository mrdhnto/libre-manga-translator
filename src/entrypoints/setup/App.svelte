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
  } from "lucide-svelte";
  import { DefaultConfig } from "@/lib/configs";
  import { MLCEngine, deleteModelAllInfoInCache } from "@mlc-ai/web-llm";
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
  let shareData = $state(false);

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

  // LLM step
  let selectedLlmModel = $state(DefaultConfig.llmModels[0].id);
  let llmDownloading = $state(false);
  let llmProgress = $state(0);
  let llmProgressText = $state("Preparing...");
  let llmDone = $state(false);
  let llmError = $state<string | null>(null);
  let llmCleaning = $state(false);
  let llmCleaned = $state(false);
  let llmCleanError = $state<string | null>(null);

  // Handle ?model= query param: skip straight to LLM step
  // ?clean=1 removes the cached model (same context, same cache partition) then offers re-download.
  $effect(() => {
    const params = new URLSearchParams(window.location.search);
    const modelParam = params.get("model");
    if (modelParam) {
      const found = DefaultConfig.llmModels.find((m) => m.id === modelParam);
      if (found) selectedLlmModel = found.id;
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
      await deleteModelAllInfoInCache(selectedLlmModel);
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
        html += '<hr class="border-zinc-200 dark:border-zinc-700 my-4" />';
        continue;
      }
      if (line.startsWith("# ")) {
        if (inList) {
          html += "</ul>";
          inList = false;
        }
        html += `<h1 class="text-xl font-bold mb-2 text-zinc-900 dark:text-zinc-100">${fmt(line.slice(2))}</h1>`;
        continue;
      }
      if (line.startsWith("## ")) {
        if (inList) {
          html += "</ul>";
          inList = false;
        }
        html += `<h2 class="text-base font-bold mt-5 mb-1.5 text-zinc-800 dark:text-zinc-200">${fmt(line.slice(3))}</h2>`;
        continue;
      }
      if (line.startsWith("### ")) {
        if (inList) {
          html += "</ul>";
          inList = false;
        }
        html += `<h3 class="text-sm font-semibold mt-3 mb-1 text-zinc-700 dark:text-zinc-300">${fmt(line.slice(4))}</h3>`;
        continue;
      }
      if (line.startsWith("> ")) {
        if (inList) {
          html += "</ul>";
          inList = false;
        }
        html += `<blockquote class="border-l-2 border-blue-400 pl-3 my-2 py-0.5 text-xs italic text-zinc-500 dark:text-zinc-400 bg-blue-50/50 dark:bg-blue-950/20 rounded-r">${fmt(line.slice(2))}</blockquote>`;
        continue;
      }
      if (line.startsWith("- ")) {
        if (!inList) {
          html += '<ul class="list-disc list-inside space-y-0.5 my-1.5">';
          inList = true;
        }
        html += `<li class="text-xs text-zinc-600 dark:text-zinc-400">${fmt(line.slice(2))}</li>`;
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
      html += `<p class="text-xs leading-relaxed text-zinc-600 dark:text-zinc-400 mb-1.5">${fmt(line)}</p>`;
    }
    if (inList) html += "</ul>";
    return html;
  }

  function fmt(text: string): string {
    return text
      .replace(
        /\*\*(.+?)\*\*/g,
        '<strong class="font-semibold text-zinc-800 dark:text-zinc-200">$1</strong>',
      )
      .replace(
        /`(.+?)`/g,
        '<code class="text-xs bg-zinc-200 dark:bg-zinc-700 px-1 rounded font-mono">$1</code>',
      )
      .replace(
        /\[(.+?)\]\((.+?)\)/g,
        '<a href="$2" target="_blank" rel="noopener noreferrer" class="text-blue-500 hover:text-blue-400 underline">$1</a>',
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
      cached = await isArtifactCached(
        DefaultConfig.detectionModelRepo,
        DefaultConfig.detectionModelPath(detectionModel),
      );
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
        await fetchAndCacheWithProgress(
          DefaultConfig.detectionModelRepo,
          DefaultConfig.detectionModelPath(detectionModel),
          onProgress,
        );
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

  async function checkOcrStatus(): Promise<boolean> {
    ocrError = null;
    let cached = false;
    if (selectedOcrEngine === "manga-ocr") {
      cached =
        (await isArtifactCached(DefaultConfig.mangaOcrRepo, "encoder_model.onnx")) &&
        (await isArtifactCached(DefaultConfig.mangaOcrRepo, "decoder_model.onnx"));
    } else {
      cached = await isArtifactCached(
        DefaultConfig.ocrRepo,
        DefaultConfig.ocrModelPath("chinese"),
      );
    }
    ocrDownloaded = cached;
    return cached;
  }

  async function startOcrDownload() {
    ocrDownloading = true;
    ocrError = null;
    ocrProgress = 0;
    ocrProgressText = "Preparing download...";
    try {
      if (selectedOcrEngine === "manga-ocr") {
        ocrProgressText = "Downloading encoder (1/2)...";
        await fetchAndCacheWithProgress(
          DefaultConfig.mangaOcrRepo,
          "encoder_model.onnx",
          (loaded, total) => {
            const pct = total > 0 ? Math.round((loaded / total) * 50) : 0;
            ocrProgress = pct;
            ocrProgressText = `Encoder: ${(loaded / 1024 / 1024).toFixed(1)} MB${total > 0 ? ` / ${(total / 1024 / 1024).toFixed(1)} MB` : ""}`;
          },
        );
        ocrProgressText = "Downloading decoder (2/2)...";
        await fetchAndCacheWithProgress(
          DefaultConfig.mangaOcrRepo,
          "decoder_model.onnx",
          (loaded, total) => {
            const pct = total > 0 ? 50 + Math.round((loaded / total) * 50) : 50;
            ocrProgress = pct;
            ocrProgressText = `Decoder: ${(loaded / 1024 / 1024).toFixed(1)} MB${total > 0 ? ` / ${(total / 1024 / 1024).toFixed(1)} MB` : ""}`;
          },
        );
        await fetchAndCacheWithProgress(DefaultConfig.mangaOcrRepo, "vocab.txt");
      } else {
        await fetchAndCacheWithProgress(
          DefaultConfig.ocrRepo,
          DefaultConfig.ocrModelPath("chinese"),
          (loaded, total) => {
            const pct = total > 0 ? Math.round((loaded / total) * 100) : 0;
            ocrProgress = pct;
            ocrProgressText = `${(loaded / 1024 / 1024).toFixed(1)} MB${total > 0 ? ` / ${(total / 1024 / 1024).toFixed(1)} MB` : ""}`;
          },
        );
        await fetchAndCacheWithProgress(
          DefaultConfig.ocrRepo,
          DefaultConfig.ocrDictPath("chinese"),
        );
      }
      ocrDownloaded = true;
      ocrProgress = 100;
    } catch (err: any) {
      ocrError = err?.message ?? "Failed to download OCR model weights.";
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

  async function startLlmDownload() {
    llmDownloading = true;
    llmDone = false;
    llmError = null;
    llmProgress = 0;
    llmProgressText = "Initializing...";
    try {
      const engine = new MLCEngine({
        initProgressCallback: (p) => {
          llmProgress = Math.round((p.progress ?? 0) * 100);
          llmProgressText = p.text ?? "";
        },
      });
      await engine.reload(selectedLlmModel);
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
      { key: "sync:share-data", value: shareData },
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
  class="min-h-screen bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 flex items-center justify-center p-6 font-sans"
>
  <div class="w-full max-w-xl">
    <!-- Model-only mode: minimal wrapper, no wizard chrome -->
    {#if isModelOnlyMode}
      <div
        in:fade={{ duration: 300 }}
        class="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-xl"
      >
        <div class="p-8 space-y-6">
          <div class="flex items-center gap-3">
            <div class="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-xl">
              <Download size={20} class="text-blue-500" />
            </div>
            <div>
              <h2 class="text-lg font-bold">Update Language Model</h2>
              <p class="text-sm text-zinc-500 dark:text-zinc-400">
                Downloading the new local inference model.
              </p>
            </div>
          </div>

          <div class="grid grid-cols-2 gap-3">
            {#each DefaultConfig.llmModels as model}
              <button
                onclick={() => (selectedLlmModel = model.id)}
                disabled={llmDownloading}
                class="p-4 rounded-xl border-2 text-left cursor-pointer transition-all disabled:opacity-50 disabled:cursor-not-allowed
                  {selectedLlmModel === model.id
                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                  : 'border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/50 hover:border-zinc-300 dark:hover:border-zinc-700'}"
              >
                <p
                  class="text-sm font-bold mb-0.5 {selectedLlmModel === model.id
                    ? 'text-blue-600 dark:text-blue-400'
                    : 'text-zinc-800 dark:text-zinc-200'}"
                >
                  {model.label}
                </p>
                <p class="text-xs text-zinc-500 dark:text-zinc-400 mb-1">
                  {model.desc}
                </p>
                <span
                  class="text-[10px] font-bold tracking-wide uppercase px-1.5 py-0.5 rounded-md bg-zinc-200 dark:bg-zinc-700 text-zinc-500 dark:text-zinc-400"
                >
                  {model.vram} VRAM
                </span>
              </button>
            {/each}
          </div>

          {#if !llmDone}
            <button
              onclick={startLlmDownload}
              disabled={llmDownloading}
              class="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-60 disabled:cursor-not-allowed text-white font-bold py-3 px-4 rounded-xl transition-all active:scale-[0.98] cursor-pointer flex items-center justify-center gap-2"
            >
              {#if llmDownloading}
                <LoaderCircle size={16} class="animate-spin" />
                Downloading...
              {:else}
                <Download size={16} />
                Download Model
              {/if}
            </button>

            {#if llmDownloading}
              <div in:fly={{ y: 6, duration: 200 }} class="space-y-1.5">
                <div
                  class="h-2 bg-zinc-200 dark:bg-zinc-700 rounded-full overflow-hidden"
                >
                  <div
                    class="h-full bg-blue-500 rounded-full transition-all duration-300"
                    style="width: {llmProgress}%"
                  ></div>
                </div>
                <p class="text-xs text-zinc-500 dark:text-zinc-400">
                  {llmProgressText}
                </p>
              </div>
            {/if}
          {:else}
            <div
              in:fly={{ y: 6, duration: 200 }}
              class="flex items-center gap-3 p-3.5 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-xl"
            >
              <CircleCheck size={18} class="text-emerald-500 shrink-0" />
              <p
                class="text-sm font-medium text-emerald-700 dark:text-emerald-400"
              >
                Model downloaded and ready.
              </p>
            </div>
          {/if}

          {#if llmError}
            <div
              class="flex items-start gap-2 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl text-red-700 dark:text-red-400"
            >
              <CircleAlert size={14} class="shrink-0 mt-0.5" />
              <p class="text-xs leading-snug">{llmError}</p>
            </div>
          {/if}

          <button
            onclick={finishSetup}
            class="w-full border border-zinc-200 dark:border-zinc-700 hover:border-zinc-300 dark:hover:border-zinc-600 text-zinc-600 dark:text-zinc-400 font-semibold py-2.5 px-4 rounded-xl transition-all text-sm cursor-pointer"
          >
            {llmDone ? "Done" : "Skip"}
          </button>
        </div>
      </div>
    {:else}
      <!-- Progress bar (hidden on welcome) -->
      {#if step !== "welcome"}
        <div
          in:fade={{ duration: 200 }}
          class="h-1 bg-zinc-200 dark:bg-zinc-800 rounded-full mb-5 overflow-hidden"
        >
          <div
            class="h-full bg-blue-500 rounded-full transition-all duration-500"
            style="width: {progressPct}%"
          ></div>
        </div>
      {/if}

      <!-- Main card -->
      <div
        class="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-xl overflow-hidden"
      >
        {#key step}
          <div in:fly={{ y: 12, duration: 280 }}>
            <!-- WELCOME -->
            {#if step === "welcome"}
              <div class="p-8 flex flex-col items-center text-center gap-6">
                <div class="flex justify-center pt-2">
                  <img src="/icon/128.png" alt="LMT" class="w-20 h-20" />
                </div>

                <div class="space-y-2">
                  <h1 class="text-4xl font-bold tracking-tight">Libre Manga Translator</h1>
                  <p class="text-zinc-500 dark:text-zinc-400 text-sm">
                    Local-first manga translation powered by AI.
                  </p>
                </div>

                <div
                  class="bg-zinc-100 dark:bg-zinc-800 rounded-xl p-4 text-left w-full space-y-3 border border-zinc-200 dark:border-zinc-700"
                >
                  {#each [{ icon: ShieldCheck, title: "Private by default", body: "Detection never sends images anywhere. Nothing leaves your browser unless you pick Gemini or API Mode; improvement data is opt-in." }, { icon: Cpu, title: "WebGPU - on-device (default)", body: "YOLO26 detection + PaddleOCR + Qwen3 via WebLLM run locally (WebGPU for translation, CPU/WASM for detection/OCR). Offline after download." }, { icon: Cloud, title: "Gemini cloud (opt-in)", body: "Sends the annotated image straight from your browser to the Gemini API. No proxy; key stored locally." }, { icon: Server, title: "API Mode - your server choice", body: "Ollama, LM Studio, or any OpenAI-compatible endpoint. OCR stays local; only extracted text is sent." }] as feature}
                    <div class="flex items-start gap-3">
                      <div
                        class="p-1.5 bg-blue-100 dark:bg-blue-900/30 rounded-lg shrink-0 mt-0.5"
                      >
                        <feature.icon size={14} class="text-blue-500" />
                      </div>
                      <div>
                        <p
                          class="text-xs font-semibold text-zinc-800 dark:text-zinc-200"
                        >
                          {feature.title}
                        </p>
                        <p
                          class="text-xs text-zinc-500 dark:text-zinc-400 leading-snug"
                        >
                          {feature.body}
                        </p>
                      </div>
                    </div>
                  {/each}
                </div>

                <button
                  onclick={() => goTo("privacy")}
                  class="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 px-4 rounded-xl transition-all active:scale-[0.98] cursor-pointer shadow-lg shadow-blue-600/20 flex items-center justify-center gap-2"
                >
                  Get Started
                  <ChevronRight size={18} />
                </button>
              </div>

              <!-- PRIVACY -->
            {:else if step === "privacy"}
              <div class="p-8 space-y-5">
                <div class="flex items-center gap-2.5">
                  <div class="p-1.5 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
                    <ShieldCheck size={18} class="text-blue-500" />
                  </div>
                  <div>
                    <h2 class="text-lg font-bold">Privacy Policy</h2>
                    <p class="text-xs text-zinc-500 dark:text-zinc-400">
                      Read carefully before using the extension.
                    </p>
                  </div>
                </div>

                <!-- Scrollable policy area -->
                <div class="relative">
                  <div
                    class="h-64 overflow-y-auto rounded-xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 p-4 scroll-smooth"
                  >
                    {#if privacyLoading}
                      <div
                        class="flex items-center justify-center h-full gap-2 text-zinc-400"
                      >
                        <LoaderCircle size={20} class="animate-spin" />
                        <span class="text-sm">Loading policy...</span>
                      </div>
                    {:else if privacyFetchError}
                      <div
                        class="flex flex-col items-center justify-center h-full gap-3 text-zinc-500"
                      >
                        <CircleAlert size={24} />
                        <p class="text-sm">
                          Could not load the privacy policy.
                        </p>
                        <button
                          onclick={fetchPrivacy}
                          class="text-xs text-blue-500 hover:text-blue-400 underline cursor-pointer"
                        >
                          Try again
                        </button>
                      </div>
                    {:else}
                      {@html parsedPrivacy}
                    {/if}
                  </div>
                  <!-- Fade hint at bottom -->
                  <div
                    class="absolute bottom-0 left-0 right-0 h-8 bg-linear-to-t from-white dark:from-zinc-900 to-transparent pointer-events-none rounded-b-xl"
                  ></div>
                </div>

                <!-- Accept policy -->
                <label class="flex items-start gap-3 cursor-pointer group">
                  <div class="relative flex items-center mt-0.5 shrink-0">
                    <input
                      type="checkbox"
                      bind:checked={acceptedPolicy}
                      class="peer sr-only"
                    />
                    <div
                      class="h-5 w-5 rounded border-2 border-zinc-300 dark:border-zinc-700 peer-checked:bg-blue-500 peer-checked:border-blue-500 transition-all"
                    ></div>
                    <Check
                      size={13}
                      class="absolute text-white scale-0 peer-checked:scale-100 transition-transform left-0.5"
                    />
                  </div>
                  <span
                    class="text-sm text-zinc-700 dark:text-zinc-300 group-hover:text-blue-500 transition-colors leading-snug"
                  >
                    I have read and accept the Privacy Policy
                  </span>
                </label>

                <!-- Data sharing option -->
                <div
                  class="bg-zinc-100 dark:bg-zinc-800 p-4 rounded-xl border border-zinc-200 dark:border-zinc-700"
                >
                  <label class="flex items-start gap-3 cursor-pointer group">
                    <div class="relative flex items-center mt-0.5 shrink-0">
                      <input
                        type="checkbox"
                        bind:checked={shareData}
                        class="peer sr-only"
                      />
                      <div
                        class="h-5 w-5 rounded border-2 border-zinc-300 dark:border-zinc-700 peer-checked:bg-blue-500 peer-checked:border-blue-500 transition-all"
                      ></div>
                      <Check
                        size={13}
                        class="absolute text-white scale-0 peer-checked:scale-100 transition-transform left-0.5"
                      />
                    </div>
                    <div>
                      <p
                        class="text-sm font-medium text-zinc-700 dark:text-zinc-300 group-hover:text-blue-500 transition-colors"
                      >
                        Allow anonymous data sharing
                      </p>
                      <p
                        class="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5 leading-snug"
                      >
                        Share bounding box corrections to help improve the
                        detection model. No personal data is collected. You can
                        change this later in Settings.
                      </p>
                    </div>
                  </label>
                </div>

                <button
                  onclick={() => goTo("detection")}
                  disabled={!acceptedPolicy || privacyLoading}
                  class="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-300 dark:disabled:bg-zinc-700 disabled:cursor-not-allowed text-white font-bold py-3 px-4 rounded-xl transition-all active:scale-[0.98] cursor-pointer flex items-center justify-center gap-2"
                >
                  Accept &amp; Continue
                  <ChevronRight size={18} />
                </button>
              </div>

              <!-- DETECTION -->
            {:else if step === "detection"}
              <div class="p-8 space-y-5">
                <div>
                  <h2 class="text-lg font-bold">Detection Model</h2>
                  <p class="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
                    Choose the YOLO model used to detect speech bubbles on manga
                    pages.
                  </p>
                </div>

                <div class="grid grid-cols-2 gap-3">
                  {#each DefaultConfig.detectionModels as model}
                    <button
                      onclick={() => (detectionModel = model.id)}
                      class="p-4 rounded-xl border-2 text-left cursor-pointer transition-all disabled:opacity-60 disabled:cursor-not-allowed
                        {detectionModel === model.id
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                        : 'border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/50 hover:border-zinc-300 dark:hover:border-zinc-700'}"
                    >
                      <div class="flex items-center justify-between mb-1">
                        <div class="flex items-center gap-1.5">
                          <Cpu
                            size={14}
                            class={detectionModel === model.id
                              ? "text-blue-500"
                              : "text-zinc-500"}
                          />
                          <span
                            class="text-sm font-bold {detectionModel === model.id
                              ? 'text-blue-600 dark:text-blue-400'
                              : 'text-zinc-700 dark:text-zinc-300'}"
                          >
                            {model.label}
                          </span>
                        </div>
                        <span class="text-[10px] font-mono text-zinc-400">{model.size}</span>
                      </div>
                      <p
                        class="text-xs text-zinc-500 dark:text-zinc-400 leading-snug"
                      >
                        {model.desc}
                      </p>
                    </button>
                  {/each}
                </div>

                <!-- Prefetch status -->
                <div
                  class="flex flex-col gap-2 p-3.5 rounded-xl border transition-colors
                    {detectionPrefetched
                    ? 'border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20'
                    : detectionError
                      ? 'border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20'
                      : detectionPrefetching
                        ? 'border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20'
                        : 'border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/50'}"
                >
                  <div class="flex items-center justify-between">
                    <div class="flex items-center gap-2">
                      {#if detectionPrefetching}
                        <LoaderCircle
                          size={15}
                          class="animate-spin text-blue-500 shrink-0"
                        />
                        <span class="text-xs font-semibold text-blue-700 dark:text-blue-300">
                          Downloading detection model weights...
                        </span>
                      {:else if detectionPrefetched}
                        <CircleCheck size={15} class="text-emerald-500 shrink-0" />
                        <span
                          class="text-xs text-emerald-700 dark:text-emerald-400 font-medium"
                        >
                          Model cached and ready to use.
                        </span>
                      {:else if detectionError}
                        <CircleAlert size={15} class="text-red-500 shrink-0" />
                        <span
                          class="text-xs text-red-700 dark:text-red-400 flex-1"
                        >
                          {detectionError}
                        </span>
                      {:else}
                        <Download size={15} class="text-zinc-500 shrink-0" />
                        <span class="text-xs text-zinc-600 dark:text-zinc-400">
                          Model not yet cached in local storage.
                        </span>
                      {/if}
                    </div>

                    {#if !detectionPrefetched && !detectionPrefetching}
                      <button
                        type="button"
                        onclick={prefetchDetection}
                        class="px-2.5 py-1 text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white rounded-lg shadow-sm transition-all cursor-pointer whitespace-nowrap shrink-0"
                      >
                        Download &amp; Cache
                      </button>
                    {:else if detectionError}
                      <button
                        type="button"
                        onclick={prefetchDetection}
                        class="px-2.5 py-1 text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white rounded-lg shadow-sm transition-all cursor-pointer whitespace-nowrap shrink-0"
                      >
                        Retry
                      </button>
                    {/if}
                  </div>

                  {#if detectionPrefetching}
                    <div class="w-full bg-blue-200/50 dark:bg-blue-950 rounded-full h-1.5 overflow-hidden">
                      <div
                        class="bg-blue-600 h-1.5 rounded-full transition-all duration-300"
                        style="width: {detectionProgress}%"
                      ></div>
                    </div>
                    <div class="flex justify-between text-[10px] text-zinc-500 dark:text-zinc-400 font-mono">
                      <span>{detectionProgressText}</span>
                      <span>{detectionProgress}%</span>
                    </div>
                  {/if}
                </div>

                <div class="flex gap-3">
                  <button
                    onclick={() => (step = "privacy")}
                    class="flex-1 border border-zinc-200 dark:border-zinc-700 hover:border-zinc-300 dark:hover:border-zinc-600 text-zinc-600 dark:text-zinc-400 font-semibold py-2.5 px-4 rounded-xl transition-all text-sm cursor-pointer"
                  >
                    Back
                  </button>
                  <button
                    onclick={() => goTo("mode")}
                    disabled={!detectionPrefetched || detectionPrefetching}
                    class="flex-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-2.5 px-4 rounded-xl transition-all active:scale-[0.98] cursor-pointer flex items-center justify-center gap-2"
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

              <!-- MODE -->
            {:else if step === "mode"}
              <div class="p-8 space-y-5">
                <div>
                  <h2 class="text-lg font-bold">Translation Mode</h2>
                  <p class="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
                    Choose how translations are processed by default.
                  </p>
                </div>

                <div class="grid grid-cols-2 gap-3">
                  <button
                    onclick={() => {
                      selectedMode = "webgpu";
                      goTo("llm");
                    }}
                    class="group p-4 rounded-xl border-2 text-left cursor-pointer transition-all border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/50 hover:border-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20 dark:hover:border-amber-400"
                  >
                    <div class="flex items-center gap-2 mb-2">
                      <Server
                        size={16}
                        class="transition-colors text-zinc-500 group-hover:text-amber-500"
                      />
                      <span
                        class="text-sm font-bold transition-colors text-zinc-700 dark:text-zinc-300 group-hover:text-amber-600 dark:group-hover:text-amber-400"
                      >
                        WebGPU
                      </span>
                    </div>
                    <p
                      class="text-xs text-zinc-500 dark:text-zinc-400 leading-snug"
                    >
                      Fully on-device via WebLLM. Private, works offline after
                      model download.
                    </p>
                  </button>

                  <button
                    onclick={() => {
                      selectedMode = "gemini";
                      goTo("gemini");
                    }}
                    class="group p-4 rounded-xl border-2 text-left cursor-pointer transition-all border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/50 hover:border-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 dark:hover:border-emerald-400"
                  >
                    <div class="flex items-center gap-2 mb-2">
                      <Cloud
                        size={16}
                        class="transition-colors text-zinc-500 group-hover:text-emerald-500"
                      />
                      <span
                        class="text-sm font-bold transition-colors text-zinc-700 dark:text-zinc-300 group-hover:text-emerald-600 dark:group-hover:text-emerald-400"
                      >
                        Gemini
                      </span>
                    </div>
                    <p
                      class="text-xs text-zinc-500 dark:text-zinc-400 leading-snug"
                    >
                      Uses Google Gemini via your own API key for higher
                      quality.
                    </p>
                  </button>

                  <button
                    onclick={() => {
                      selectedMode = "api";
                      goTo("api");
                    }}
                    class="group p-4 rounded-xl border-2 text-left cursor-pointer transition-all border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/50 hover:border-sky-400 hover:bg-sky-50 dark:hover:bg-sky-900/20 dark:hover:border-sky-400"
                  >
                    <div class="flex items-center gap-2 mb-2">
                      <Zap
                        size={16}
                        class="transition-colors text-zinc-500 group-hover:text-sky-500"
                      />
                      <span
                        class="text-sm font-bold transition-colors text-zinc-700 dark:text-zinc-300 group-hover:text-sky-600 dark:group-hover:text-sky-400"
                      >
                        API Mode
                      </span>
                    </div>
                    <p
                      class="text-xs text-zinc-500 dark:text-zinc-400 leading-snug"
                    >
                      Connect your own LLM server (Ollama, LM Studio, OpenAI).
                      OCR stays local.
                    </p>
                  </button>
                </div>

                <button
                  onclick={() => (step = "detection")}
                  class="flex-1 border border-zinc-200 dark:border-zinc-700 hover:border-zinc-300 dark:hover:border-zinc-600 text-zinc-600 dark:text-zinc-400 font-semibold py-2.5 px-4 rounded-xl transition-all text-sm cursor-pointer"
                >
                  Back
                </button>
              </div>
            {:else if step === "gemini"}
              <div class="p-8 space-y-5">
                <div in:fly={{ y: 8, duration: 200 }} class="space-y-2">
                  <label
                    for="setup-gemini-key"
                    class="text-xs font-bold uppercase tracking-widest text-zinc-500 dark:text-zinc-400 ml-1"
                  >
                    Gemini API Key
                  </label>
                  <div class="relative">
                    <input
                      id="setup-gemini-key"
                      type={showKey ? "text" : "password"}
                      bind:value={geminiKey}
                      placeholder="AIzaSy..."
                      class="w-full bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl p-3 pr-11 text-sm focus:ring-1 focus:ring-blue-500 outline-none transition-all"
                    />
                    <button
                      type="button"
                      onclick={() => (showKey = !showKey)}
                      class="absolute inset-y-0 right-0 flex items-center pr-3 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors focus:outline-none cursor-pointer"
                      aria-label={showKey ? "Hide key" : "Show key"}
                    >
                      {#if showKey}
                        <EyeOff size={16} />
                      {:else}
                        <Eye size={16} />
                      {/if}
                    </button>
                  </div>
                  <p class="text-xs text-zinc-500 dark:text-zinc-400 ml-1">
                    Your key is stored locally and sent only to Google. It never
                    touches LMT servers.
                  </p>
                </div>

                <div class="flex gap-3 pt-2">
                  <button
                    onclick={() => (step = "mode")}
                    class="flex-1 border border-zinc-200 dark:border-zinc-700 hover:border-zinc-300 dark:hover:border-zinc-600 text-zinc-600 dark:text-zinc-400 font-semibold py-2.5 px-4 rounded-xl transition-all text-sm cursor-pointer"
                  >
                    Back
                  </button>
                  <button
                    onclick={finishSetup}
                    disabled={!geminiKey}
                    class="flex-1 bg-blue-600 hover:bg-blue-500 text-white shadow-md shadow-blue-600/20 disabled:opacity-50 disabled:cursor-not-allowed font-bold py-2.5 px-4 rounded-xl transition-all active:scale-[0.98] cursor-pointer flex items-center justify-center gap-2"
                  >
                    Complete Setup
                    <ChevronRight size={14} />
                  </button>
                </div>
              </div>

              <!-- API MODE -->
            {:else if step === "api"}
              <div class="p-8 space-y-5">
                <div>
                  <h2 class="text-lg font-bold">API Mode Server</h2>
                  <p class="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
                    Connect your own LLM server (Ollama, LM Studio, or any
                    OpenAI-compatible endpoint). OCR still runs locally - only
                    extracted text is sent.
                  </p>
                </div>

                <div class="space-y-4">
                  <div class="space-y-1.5">
                    <label
                      for="setup-server-host"
                      class="text-xs font-bold uppercase tracking-widest text-zinc-500 dark:text-zinc-400 ml-1"
                    >
                      Server URL
                    </label>
                    <input
                      id="setup-server-host"
                      type="text"
                      bind:value={serverHost}
                      placeholder="http://127.0.0.1:11434/v1"
                      class="w-full bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl p-3 text-sm focus:ring-1 focus:ring-blue-500 outline-none transition-all font-mono"
                    />
                    <p class="text-xs text-zinc-500 dark:text-zinc-400 ml-1">
                      Ollama: <code>http://127.0.0.1:11434/v1</code> &middot;
                      LM Studio:
                      <code>http://127.0.0.1:1234/api/v1</code>
                    </p>
                  </div>

                  <div class="grid grid-cols-2 gap-3">
                    <div class="space-y-1.5">
                      <label
                        for="setup-server-schema"
                        class="text-xs font-bold uppercase tracking-widest text-zinc-500 dark:text-zinc-400 ml-1"
                      >
                        Schema
                      </label>
                      <select
                        id="setup-server-schema"
                        bind:value={serverSchema}
                        class="w-full bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl p-3 text-sm outline-none cursor-pointer"
                      >
                        <option value="openai">OpenAI-compatible</option>
                        <option value="lmstudio">LM Studio</option>
                      </select>
                    </div>
                    <div class="space-y-1.5">
                      <label
                        for="setup-server-model"
                        class="text-xs font-bold uppercase tracking-widest text-zinc-500 dark:text-zinc-400 ml-1"
                      >
                        Model
                      </label>
                      <input
                        id="setup-server-model"
                        type="text"
                        bind:value={serverModel}
                        placeholder="e.g. qwen2.5:7b"
                        class="w-full bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl p-3 text-sm focus:ring-1 focus:ring-blue-500 outline-none transition-all"
                      />
                    </div>
                  </div>

                  <div class="space-y-2">
                    <label class="flex items-center gap-3 cursor-pointer group">
                      <input
                        type="checkbox"
                        bind:checked={useServerApiKey}
                        class="peer sr-only"
                      />
                      <div
                        class="h-5 w-5 rounded border-2 border-zinc-300 dark:border-zinc-700 peer-checked:bg-blue-500 peer-checked:border-blue-500 transition-all"
                      ></div>
                      <span
                        class="text-sm text-zinc-700 dark:text-zinc-300 group-hover:text-blue-500 transition-colors"
                      >
                        Use API key
                      </span>
                    </label>
                    {#if useServerApiKey}
                      <div class="relative">
                        <input
                          type={showKey ? "text" : "password"}
                          bind:value={serverApiKey}
                          placeholder="API key (Bearer)"
                          class="w-full bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl p-3 pr-11 text-sm focus:ring-1 focus:ring-blue-500 outline-none transition-all"
                        />
                        <button
                          type="button"
                          onclick={() => (showKey = !showKey)}
                          class="absolute inset-y-0 right-0 flex items-center pr-3 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors focus:outline-none cursor-pointer"
                          aria-label={showKey ? "Hide key" : "Show key"}
                        >
                          {#if showKey}<EyeOff size={16} />{:else}<Eye
                              size={16}
                            />{/if}
                        </button>
                      </div>
                    {/if}
                  </div>
                </div>

                <div class="flex gap-3 pt-2">
                  <button
                    onclick={() => (step = "mode")}
                    class="flex-1 border border-zinc-200 dark:border-zinc-700 hover:border-zinc-300 dark:hover:border-zinc-600 text-zinc-600 dark:text-zinc-400 font-semibold py-2.5 px-4 rounded-xl transition-all text-sm cursor-pointer"
                  >
                    Back
                  </button>
                  <button
                    onclick={() => goTo("ocr")}
                    disabled={!serverHost.trim() || !serverModel.trim()}
                    class="flex-1 bg-blue-600 hover:bg-blue-500 text-white shadow-md shadow-blue-600/20 disabled:opacity-50 disabled:cursor-not-allowed font-bold py-2.5 px-4 rounded-xl transition-all active:scale-[0.98] cursor-pointer flex items-center justify-center gap-2"
                  >
                    Continue
                    <ChevronRight size={14} />
                  </button>
                </div>
              </div>

              <!-- LLM DOWNLOAD -->
            {:else if step === "llm"}
              <div class="p-8 space-y-5">
                <div>
                  <h2 class="text-lg font-bold">Language Model</h2>
                  <p class="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
                    Download a local LLM for on-device translation via WebLLM.
                    {#if selectedMode !== "webgpu"}
                      You can skip this since Gemini or API mode is active.
                    {/if}
                  </p>
                </div>

                <div class="grid grid-cols-2 gap-3">
                  {#each DefaultConfig.llmModels as model}
                    <button
                      onclick={() => (selectedLlmModel = model.id)}
                      disabled={llmDownloading}
                      class="p-4 rounded-xl border-2 text-left cursor-pointer transition-all disabled:opacity-50 disabled:cursor-not-allowed
                        {selectedLlmModel === model.id
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                        : 'border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/50 hover:border-zinc-300 dark:hover:border-zinc-700'}"
                    >
                      <p
                        class="text-sm font-bold mb-0.5 {selectedLlmModel ===
                        model.id
                          ? 'text-blue-600 dark:text-blue-400'
                          : 'text-zinc-800 dark:text-zinc-200'}"
                      >
                        {model.label}
                      </p>
                      <p
                        class="text-xs text-zinc-500 dark:text-zinc-400 mb-1.5 leading-snug"
                      >
                        {model.desc}
                      </p>
                      <span
                        class="text-[10px] font-bold tracking-wide uppercase px-1.5 py-0.5 rounded-md bg-zinc-200 dark:bg-zinc-700 text-zinc-500 dark:text-zinc-400"
                      >
                        {model.vram} VRAM
                      </span>
                    </button>
                  {/each}
                </div>

                {#if llmCleaning}
                  <div
                    in:fly={{ y: 6, duration: 200 }}
                    class="flex items-center gap-3 p-3.5 bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800 rounded-xl"
                  >
                    <LoaderCircle
                      size={18}
                      class="text-amber-500 animate-spin shrink-0"
                    />
                    <p
                      class="text-sm font-medium text-amber-700 dark:text-amber-400"
                    >
                      Cleaning up cached model...
                    </p>
                  </div>
                {:else if llmCleaned}
                  <div
                    in:fly={{ y: 6, duration: 200 }}
                    class="flex items-center gap-3 p-3.5 bg-emerald-50 dark:bg-emerald-900/10 border border-emerald-200 dark:border-emerald-800 rounded-xl"
                  >
                    <CircleCheck
                      size={18}
                      class="text-emerald-500 shrink-0"
                    />
                    <p
                      class="text-sm font-medium text-emerald-700 dark:text-emerald-400"
                    >
                      Cached model removed. You can download it again below or
                      close this tab.
                    </p>
                  </div>
                {/if}

                {#if llmCleanError}
                  <div
                    in:fly={{ y: 4, duration: 200 }}
                    class="flex items-start gap-2.5 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl"
                  >
                    <CircleAlert
                      size={14}
                      class="text-red-500 shrink-0 mt-0.5"
                    />
                    <p
                      class="text-xs leading-snug text-red-700 dark:text-red-400"
                    >
                      {llmCleanError}
                    </p>
                  </div>
                {/if}

                {#if !llmDone}
                  <button
                    onclick={startLlmDownload}
                    disabled={llmDownloading}
                    class="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-60 disabled:cursor-not-allowed text-white font-bold py-3 px-4 rounded-xl transition-all active:scale-[0.98] cursor-pointer flex items-center justify-center gap-2 shadow-md shadow-blue-600/20"
                  >
                    {#if llmDownloading}
                      <LoaderCircle size={16} class="animate-spin" />
                      Downloading...
                    {:else}
                      <Download size={16} />
                      Download Model
                    {/if}
                  </button>

                  {#if llmDownloading}
                    <div in:fly={{ y: 6, duration: 200 }} class="space-y-1.5">
                      <div class="flex items-center justify-between mb-0.5">
                        <span class="text-xs text-zinc-500 dark:text-zinc-400"
                          >Downloading</span
                        >
                        <span
                          class="text-xs font-bold text-zinc-700 dark:text-zinc-300"
                          >{llmProgress}%</span
                        >
                      </div>
                      <div
                        class="h-2 bg-zinc-200 dark:bg-zinc-700 rounded-full overflow-hidden"
                      >
                        <div
                          class="h-full bg-blue-500 rounded-full transition-all duration-300"
                          style="width: {llmProgress}%"
                        ></div>
                      </div>
                      <p
                        class="text-xs text-zinc-500 dark:text-zinc-400 truncate"
                      >
                        {llmProgressText}
                      </p>
                    </div>
                  {/if}
                {:else}
                  <div
                    in:fly={{ y: 6, duration: 200 }}
                    class="flex items-center gap-3 p-3.5 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-xl"
                  >
                    <CircleCheck size={18} class="text-emerald-500 shrink-0" />
                    <p
                      class="text-sm font-medium text-emerald-700 dark:text-emerald-400"
                    >
                      Model downloaded and ready.
                    </p>
                  </div>
                {/if}

                {#if llmError}
                  <div
                    in:fly={{ y: 4, duration: 200 }}
                    class="flex items-start gap-2.5 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl"
                  >
                    <CircleAlert
                      size={14}
                      class="text-red-500 shrink-0 mt-0.5"
                    />
                    <p
                      class="text-xs leading-snug text-red-700 dark:text-red-400"
                    >
                      {llmError}
                    </p>
                  </div>
                {/if}

                <div class="flex gap-3 pt-2">
                  <button
                    onclick={() => (step = "mode")}
                    class="flex-1 border border-zinc-200 dark:border-zinc-700 hover:border-zinc-300 dark:hover:border-zinc-600 text-zinc-600 dark:text-zinc-400 font-semibold py-2.5 px-4 rounded-xl transition-all text-sm cursor-pointer"
                  >
                    Back
                  </button>
                  <button
                    onclick={() => (isModelOnlyMode ? finishSetup() : goTo("ocr"))}
                    disabled={!llmDone}
                    class="flex-1 bg-blue-600 hover:bg-blue-500 text-white shadow-md shadow-blue-600/20 disabled:opacity-50 disabled:cursor-not-allowed font-bold py-2.5 px-4 rounded-xl transition-all active:scale-[0.98] cursor-pointer flex items-center justify-center gap-2"
                  >
                    {isModelOnlyMode ? "Complete Setup" : "Continue"}
                    <ChevronRight size={14} />
                  </button>
                </div>
              </div>

            <!-- OCR SELECTION -->
            {:else if step === "ocr"}
              <div class="p-8 space-y-5">
                <div>
                  <h2 class="text-lg font-bold">Text Recognition (OCR)</h2>
                  <p class="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
                    Select the on-device optical character recognition engine.
                  </p>
                </div>

                <div class="grid grid-cols-2 gap-3">
                  <button
                    onclick={() => (selectedOcrEngine = "paddle")}
                    class="p-4 rounded-xl border-2 text-left cursor-pointer transition-all
                      {selectedOcrEngine === 'paddle'
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                      : 'border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/50 hover:border-zinc-300 dark:hover:border-zinc-700'}"
                  >
                    <div class="flex items-center justify-between mb-1">
                      <span class="text-sm font-bold {selectedOcrEngine === 'paddle' ? 'text-blue-600 dark:text-blue-400' : 'text-zinc-700 dark:text-zinc-300'}">
                        PaddleOCR
                      </span>
                      <span class="text-[10px] font-mono text-zinc-400">~80 MB</span>
                    </div>
                    <p class="text-xs text-zinc-500 dark:text-zinc-400 leading-snug">
                      Fast multilingual engine (default). Supports Japanese, Chinese, Korean, English, and more.
                    </p>
                  </button>

                  <button
                    onclick={() => (selectedOcrEngine = "manga-ocr")}
                    class="p-4 rounded-xl border-2 text-left cursor-pointer transition-all
                      {selectedOcrEngine === 'manga-ocr'
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                      : 'border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/50 hover:border-zinc-300 dark:hover:border-zinc-700'}"
                  >
                    <div class="flex items-center justify-between mb-1">
                      <span class="text-sm font-bold {selectedOcrEngine === 'manga-ocr' ? 'text-blue-600 dark:text-blue-400' : 'text-zinc-700 dark:text-zinc-300'}">
                        Manga-OCR
                      </span>
                      <span class="text-[10px] font-mono text-zinc-400">~460 MB</span>
                    </div>
                    <p class="text-xs text-zinc-500 dark:text-zinc-400 leading-snug">
                      Specialized ViT + BERT seq2seq model for Japanese manga dialogue and vertical text.
                    </p>
                  </button>
                </div>

                <!-- OCR Download / Cache Status Card -->
                <div
                  class="flex flex-col gap-2 p-3.5 rounded-xl border transition-colors
                    {ocrDownloaded
                    ? 'border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20'
                    : ocrError
                      ? 'border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20'
                      : ocrDownloading
                        ? 'border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20'
                        : 'border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/50'}"
                >
                  <div class="flex items-center justify-between">
                    <div class="flex items-center gap-2">
                      {#if ocrDownloading}
                        <LoaderCircle size={15} class="animate-spin text-blue-500 shrink-0" />
                        <span class="text-xs font-semibold text-blue-700 dark:text-blue-300">
                          Downloading {selectedOcrEngine === "manga-ocr" ? "Manga-OCR" : "PaddleOCR"}...
                        </span>
                      {:else if ocrDownloaded}
                        <CircleCheck size={15} class="text-emerald-500 shrink-0" />
                        <span class="text-xs font-medium text-emerald-700 dark:text-emerald-400">
                          {selectedOcrEngine === "manga-ocr" ? "Manga-OCR" : "PaddleOCR"} cached and ready to use.
                        </span>
                      {:else if ocrError}
                        <CircleAlert size={15} class="text-red-500 shrink-0" />
                        <span class="text-xs text-red-700 dark:text-red-400 flex-1">
                          {ocrError}
                        </span>
                      {:else}
                        <Download size={15} class="text-zinc-500 shrink-0" />
                        <span class="text-xs text-zinc-600 dark:text-zinc-400">
                          Model weights not yet cached in local storage.
                        </span>
                      {/if}
                    </div>

                    {#if !ocrDownloaded && !ocrDownloading}
                      <button
                        type="button"
                        onclick={startOcrDownload}
                        class="px-2.5 py-1 text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white rounded-lg shadow-sm transition-all cursor-pointer whitespace-nowrap shrink-0"
                      >
                        Download &amp; Cache
                      </button>
                    {:else if ocrError}
                      <button
                        type="button"
                        onclick={startOcrDownload}
                        class="px-2.5 py-1 text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white rounded-lg shadow-sm transition-all cursor-pointer whitespace-nowrap shrink-0"
                      >
                        Retry
                      </button>
                    {/if}
                  </div>

                  {#if ocrDownloading}
                    <div class="w-full bg-blue-200/50 dark:bg-blue-950 rounded-full h-1.5 overflow-hidden">
                      <div
                        class="bg-blue-600 h-1.5 rounded-full transition-all duration-300"
                        style="width: {ocrProgress}%"
                      ></div>
                    </div>
                    <div class="flex justify-between text-[10px] text-zinc-500 dark:text-zinc-400 font-mono">
                      <span>{ocrProgressText}</span>
                      <span>{ocrProgress}%</span>
                    </div>
                  {/if}
                </div>

                <div class="flex gap-3 pt-2">
                  <button
                    onclick={() => (step = selectedMode === "api" ? "api" : "llm")}
                    class="flex-1 border border-zinc-200 dark:border-zinc-700 hover:border-zinc-300 dark:hover:border-zinc-600 text-zinc-600 dark:text-zinc-400 font-semibold py-2.5 px-4 rounded-xl transition-all text-sm cursor-pointer"
                  >
                    Back
                  </button>
                  <button
                    onclick={() => goTo("inpaint")}
                    disabled={!ocrDownloaded || ocrDownloading}
                    class="flex-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white shadow-md shadow-blue-600/20 font-bold py-2.5 px-4 rounded-xl transition-all active:scale-[0.98] cursor-pointer flex items-center justify-center gap-2"
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

            <!-- INPAINTING SELECTION -->
            {:else if step === "inpaint"}
              <div class="p-8 space-y-5">
                <div>
                  <h2 class="text-lg font-bold">Inpainting &amp; Redraw</h2>
                  <p class="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
                    Configure how original text is cleaned before rendering translated text.
                  </p>
                </div>

                <div class="space-y-3">
                  <!-- Fast: model-free ladder (default) -->
                  <button
                    type="button"
                    class="w-full text-left p-4 rounded-xl border-2 transition-all cursor-pointer
                      {selectedInpaintMethod === 'fast'
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                      : 'border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/50 hover:border-zinc-300 dark:hover:border-zinc-700'}"
                    onclick={() => (selectedInpaintMethod = 'fast')}
                  >
                    <div class="flex items-center justify-between mb-1">
                      <span class="text-sm font-bold {selectedInpaintMethod === 'fast' ? 'text-blue-600 dark:text-blue-400' : 'text-zinc-700 dark:text-zinc-300'}">
                        Fast (Recommended)
                      </span>
                      <span class="text-[10px] font-mono text-zinc-400">0 MB extra</span>
                    </div>
                    <p class="text-xs text-zinc-500 dark:text-zinc-400 leading-snug">
                      Model-free ladder per region: planar fill, bilateral denoise, then Telea. Instant, zero extra memory, perfectly cleans flat and JPEG paper.
                    </p>
                  </button>

                  <!-- Quality: standalone LaMa pass with Fast fallback -->
                  <button
                    type="button"
                    class="w-full text-left p-4 rounded-xl border-2 transition-all cursor-pointer
                      {selectedInpaintMethod === 'quality'
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                      : 'border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/50 hover:border-zinc-300 dark:hover:border-zinc-700'}"
                    onclick={() => (selectedInpaintMethod = 'quality')}
                  >
                    <div class="flex items-center justify-between mb-1">
                      <div class="flex items-center gap-1.5">
                        <span class="text-sm font-bold {selectedInpaintMethod === 'quality' ? 'text-blue-600 dark:text-blue-400' : 'text-zinc-700 dark:text-zinc-300'}">
                          Quality
                        </span>
                        <span class="text-[9px] font-semibold px-1.5 py-0.2 rounded bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">
                          LaMa redraw
                        </span>
                      </div>
                      <span class="text-[10px] font-mono text-zinc-400">~207 MB</span>
                    </div>
                    <p class="text-xs text-zinc-500 dark:text-zinc-400 leading-snug">
                      Finetuned neural inpainter that reconstructs screentone, halftone, and art textures behind text. Regions LaMa declines fall back into Fast automatically.
                    </p>
                    {#if selectedInpaintMethod === 'quality'}
                      <div class="mt-2.5 p-2.5 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg text-amber-800 dark:text-amber-300 text-xs leading-snug">
                        <strong>Drawbacks &amp; Trade-offs:</strong>
                        <ul class="list-disc list-inside mt-1 space-y-0.5 text-[11px]">
                          <li>Requires downloading ~207 MB weights on first clean.</li>
                          <li>Higher memory footprint (~500 MB RAM/VRAM).</li>
                          <li>Slower inference (~30–60 seconds per complex region on CPU).</li>
                        </ul>
                      </div>
                    {/if}
                  </button>
                </div>

                <!-- Inpaint / LaMa Cache & Download Status Card -->
                {#if selectedInpaintMethod === 'quality'}
                  <div
                    class="flex flex-col gap-2 p-3.5 rounded-xl border transition-colors
                      {lamaDownloaded
                      ? 'border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20'
                      : lamaError
                        ? 'border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20'
                        : lamaDownloading
                          ? 'border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20'
                          : 'border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/50'}"
                  >
                    <div class="flex items-center justify-between">
                      <div class="flex items-center gap-2">
                        {#if lamaDownloading}
                          <LoaderCircle size={15} class="animate-spin text-blue-500 shrink-0" />
                          <span class="text-xs font-semibold text-blue-700 dark:text-blue-300">
                            Downloading LaMa weights (~207 MB)...
                          </span>
                        {:else if lamaDownloaded}
                          <CircleCheck size={15} class="text-emerald-500 shrink-0" />
                          <span class="text-xs font-medium text-emerald-700 dark:text-emerald-400">
                            LaMa weights cached and ready to use.
                          </span>
                        {:else if lamaError}
                          <CircleAlert size={15} class="text-red-500 shrink-0" />
                          <span class="text-xs text-red-700 dark:text-red-400 flex-1">
                            {lamaError}
                          </span>
                        {:else}
                          <Download size={15} class="text-zinc-500 shrink-0" />
                          <span class="text-xs text-zinc-600 dark:text-zinc-400">
                            LaMa weights (~207 MB) not yet cached in local storage.
                          </span>
                        {/if}
                      </div>

                      {#if !lamaDownloaded && !lamaDownloading}
                        <button
                          type="button"
                          onclick={startLamaDownload}
                          class="px-2.5 py-1 text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white rounded-lg shadow-sm transition-all cursor-pointer whitespace-nowrap shrink-0"
                        >
                          Download Now
                        </button>
                      {:else if lamaError}
                        <button
                          type="button"
                          onclick={startLamaDownload}
                          class="px-2.5 py-1 text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white rounded-lg shadow-sm transition-all cursor-pointer whitespace-nowrap shrink-0"
                        >
                          Retry
                        </button>
                      {/if}
                    </div>

                    {#if lamaDownloading}
                      <div class="w-full bg-blue-200/50 dark:bg-blue-950 rounded-full h-1.5 overflow-hidden">
                        <div
                          class="bg-blue-600 h-1.5 rounded-full transition-all duration-300"
                          style="width: {lamaProgress}%"
                        ></div>
                      </div>
                      <div class="flex justify-between text-[10px] text-zinc-500 dark:text-zinc-400 font-mono">
                        <span>{lamaProgressText}</span>
                        <span>{lamaProgress}%</span>
                      </div>
                    {/if}
                  </div>
                {:else}
                  <div class="flex items-center gap-2 p-3 bg-zinc-100 dark:bg-zinc-800/60 rounded-xl text-xs text-zinc-500 dark:text-zinc-400">
                    <Check size={14} class="text-emerald-500 shrink-0" />
                    <span>Built-in mathematical ladder active. Zero extra model downloads required.</span>
                  </div>
                {/if}

                <div class="flex gap-3 pt-2">
                  <button
                    onclick={() => (step = "ocr")}
                    class="flex-1 border border-zinc-200 dark:border-zinc-700 hover:border-zinc-300 dark:hover:border-zinc-600 text-zinc-600 dark:text-zinc-400 font-semibold py-2.5 px-4 rounded-xl transition-all text-sm cursor-pointer"
                  >
                    Back
                  </button>
                  <button
                    onclick={finishSetup}
                    disabled={selectedInpaintMethod === 'quality' && (!lamaDownloaded || lamaDownloading)}
                    class="flex-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white shadow-md shadow-blue-600/20 font-bold py-2.5 px-4 rounded-xl transition-all active:scale-[0.98] cursor-pointer flex items-center justify-center gap-2"
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
