<script lang="ts">
  import { fade, fly } from "svelte/transition";
  import {
    Zap,
    BookOpen,
    SettingsIcon,
    Cpu,
    Info,
    Check,
    LoaderCircle,
    Sparkles,
    ArrowRightLeft,
    ChevronDown,
    Search,
    TriangleAlert,
    Download,
  } from "lucide-svelte";
  import {
    DefaultConfig,
    defaultLlmModelId,
    llmModelDef,
  } from "@/lib/configs";
  import { env } from "@/lib/env";
  import { untrack } from "svelte";
  import { openSetupTab } from "@/lib/utils";
  import { getSiteRule } from "@/lib/adapters";
  import DetectionSettings from "@/lib/components/settings/DetectionSettings.svelte";
  import OcrSettings from "@/lib/components/settings/OcrSettings.svelte";
  import BackendSettings from "@/lib/components/settings/BackendSettings.svelte";
  import TypographySettings from "@/lib/components/settings/TypographySettings.svelte";
  import SiteRulesSettings from "@/lib/components/settings/SiteRulesSettings.svelte";
  import InpaintSettings from "@/lib/components/settings/InpaintSettings.svelte";

  let {
    hostname,
    title,
    path,
  }: {
    hostname: string;
    title: string;
    path: string;
  } = $props();

  let seriesName = "Unknown Series";
  let ruleId = $state("");
  let activeTab = $state("home");
  let shareData = $state(false);
  let geminiKey = $state("");
  let geminiModel = $state(DefaultConfig.geminiModels[0].id);
  let currentMode = $state(DefaultConfig.currentMode);
  let detectionModel = $state(DefaultConfig.detectionModels[0].id);
  let ocrMinConfidence = $state(DefaultConfig.ocrMinConfidence);
  let scriptGate = $state(DefaultConfig.scriptGate);
  let sourceLang = $state(DefaultConfig.sourceLang);
  let targetLang = $state(DefaultConfig.targetLang);
  let activeDropdown = $state<"source" | "target" | null>(null);
  let searchQuery = $state("");
  let detectionAutoUpdate = $state(true);
  let detectionMinConfidence = $state(0.5);
  let seriesContext = $state<SeriesContext>({
    seriesName: "",
    summary: "",
    dictionary: "",
    lastChapterId: null,
    lastPageIndex: null,
    recentHistory: [],
    translatedCount: 0,
  });
  let activeDevice = $state(DefaultConfig.activeDevice);
  let loadingSettings = $state(true);
  let saveTimer: ReturnType<typeof setTimeout>;
  let textFont = $state(DefaultConfig.bundleFonts[0].id);
  let inpaintMethod = $state(DefaultConfig.inpaintMethod);
  let inpaintLama = $state(DefaultConfig.inpaintLama);
  let ocrEngine = $state(DefaultConfig.ocrEngine);
  let customFonts = $state<{ name: string; dataUrl: string }[]>([]);
  let latestVersion = $state<{
    currentVersion: string;
    version: string;
    url: string;
  }>({
    currentVersion: (browser.runtime.getManifest() as any).version_name || browser.runtime.getManifest().version,
    version: "",
    url: "",
  });
  let prevDetectionModel = untrack(() => detectionModel);
  let prevSourceLang = untrack(() => sourceLang);
  let prevMode = untrack(() => currentMode);
  let isFetchingDetection = $state(false);
  let isFetchingOCR = $state(false);
  let cachedLlms = $state<string[]>([]);
  let llmModel = $state(defaultLlmModelId());
  let llmTemperature = $state(DefaultConfig.llmTemperature);
  let serverHost = $state(DefaultConfig.serverHost);
  let serverSchema = $state(DefaultConfig.serverSchema);
  let serverModel = $state(DefaultConfig.serverModel);
  let useServerApiKey = $state(DefaultConfig.useServerApiKey);
  let serverApiKey = $state(DefaultConfig.serverApiKey);
  let customRules = $state<SiteRule[]>([]);

  const TABS = [
    { id: "home", label: "Home", icon: Zap },
    { id: "context", label: "Context", icon: BookOpen },
    { id: "settings", label: "Settings", icon: SettingsIcon },
  ];

  const MODES = [
    {
      id: "webgpu",
      label: "WebGPU",
      color: "amber",
      classes: "text-amber-700 dark:text-amber-400",
      activeClasses: "bg-amber-100 dark:bg-amber-900/30",
      disable: () => false,
    },
    {
      id: "gemini",
      label: "Gemini",
      color: "emerald",
      classes: "text-emerald-700 dark:text-emerald-400",
      activeClasses: "bg-emerald-100 dark:bg-emerald-900/30",
      disable: () => false,
    },
    {
      id: "api",
      label: "API Mode",
      color: "sky",
      classes: "text-sky-700 dark:text-sky-400",
      activeClasses: "bg-sky-100 dark:bg-sky-900/30",
      disable: () => false,
    },
  ];

  let tabIndex = $derived(TABS.findIndex((t) => t.id === activeTab));

  const visibleLanguages = $derived(
    DefaultConfig.availableLanguages.filter((l) => {
      const matchesSearch = l.toLowerCase().includes(searchQuery.toLowerCase());
      const isTargetAuto = activeDropdown === "target" && l === "Auto-Detect";
      return matchesSearch && !isTargetAuto;
    }),
  );

  function setMode(modeId: string) {
    currentMode = modeId;
    if (modeId === "gemini") {
      sourceLang = "Auto-Detect";
    }
  }

  function swapLanguages() {
    if (sourceLang === "Auto-Detect") {
      sourceLang = targetLang;
      targetLang = "English";
    } else {
      [sourceLang, targetLang] = [targetLang, sourceLang];
    }
  }

  function openDropdown(type: "source" | "target") {
    activeDropdown = activeDropdown === type ? null : type;
    searchQuery = "";
  }

  function selectLanguage(lang: string) {
    if (activeDropdown === "source") sourceLang = lang;
    if (activeDropdown === "target") targetLang = lang;
    activeDropdown = null;
  }

  type StorageKey = `local:${string}` | `sync:${string}`;

  // Keys migrated from sync→local to prevent BYOK from leaking across browser accounts.
  const MIGRATE_SYNC_TO_LOCAL = [
    ["sync:gemini-key",         "local:gemini-key"],
    ["sync:server-api-key",     "local:server-api-key"],
    ["sync:server-host",        "local:server-host"],
    ["sync:server-schema",      "local:server-schema"],
    ["sync:server-model",       "local:server-model"],
    ["sync:use-server-api-key", "local:use-server-api-key"],
  ] as const;

  async function migrateLocalKeys() {
    const oldItems = await storage.getItems(MIGRATE_SYNC_TO_LOCAL.map(([s]) => s));
    const toWrite: { key: StorageKey; value: any }[] = [];
    const toRemove: StorageKey[] = [];
    for (const [syncKey, localKey] of MIGRATE_SYNC_TO_LOCAL) {
      const val = oldItems.find((i) => i.key === syncKey)?.value;
      if (val !== null && val !== undefined) {
        toWrite.push({ key: localKey, value: val });
        toRemove.push(syncKey);
      }
    }
    if (toWrite.length) {
      await storage.setItems(toWrite);
      await storage.removeItems(toRemove);
    }
  }

  async function loadSettings() {
    ({ ruleId, seriesName } = await getSiteRule(
      undefined,
      hostname,
      title,
      path,
    ));
    seriesContext.seriesName = seriesName;

    await migrateLocalKeys();

    const items = await storage.getItems([
      "local:is-first-run",
      "sync:share-data",
      "sync:detection-auto-update",
      "sync:detection-min-confidence",
      "sync:ocr-min-confidence",
      "local:gemini-key",
      "sync:gemini-model",
      "sync:detection-model",
      "sync:current-mode",
      "sync:source-lang",
      "sync:target-lang",
      "local:active-device",
      `sync:context-${seriesName}`,
      "sync:text-font",
      "local:custom-fonts",
      "local:cached-llms",
      "sync:llm-model",
      "sync:llm-temperature",
      "local:server-host",
      "local:server-schema",
      "local:server-model",
      "local:use-server-api-key",
      "local:server-api-key",
      "sync:custom-site-rules",
      "sync:inpaint-method",
      "sync:inpaint-lama",
      "sync:ocr-engine",
      "sync:script-gate",
    ]);

    const saved = Object.fromEntries(items.map((i) => [i.key, i.value]));

    shareData = saved["sync:share-data"] ?? shareData;
    detectionAutoUpdate =
      saved["sync:detection-auto-update"] ?? detectionAutoUpdate;
    detectionMinConfidence =
      saved["sync:detection-min-confidence"] ?? detectionMinConfidence;
    geminiKey = saved["local:gemini-key"] ?? geminiKey;
    geminiModel = saved["sync:gemini-model"] ?? geminiModel;
    detectionModel = saved["sync:detection-model"] ?? detectionModel;
    ocrMinConfidence = saved["sync:ocr-min-confidence"] ?? ocrMinConfidence;
    ocrEngine = saved["sync:ocr-engine"] ?? ocrEngine;
    scriptGate = saved["sync:script-gate"] ?? scriptGate;
    currentMode = saved["sync:current-mode"] ?? currentMode;
    sourceLang = saved["sync:source-lang"] ?? sourceLang;
    targetLang = saved["sync:target-lang"] ?? targetLang;
    activeDevice = saved["local:active-device"] ?? activeDevice;
    textFont = saved["sync:text-font"] ?? textFont;
    customFonts = Array.isArray(saved["local:custom-fonts"])
      ? saved["local:custom-fonts"]
      : [];
    cachedLlms = Array.isArray(saved["local:cached-llms"])
      ? saved["local:cached-llms"]
      : [];
    llmModel = llmModelDef(saved["sync:llm-model"] ?? llmModel).id;
    llmTemperature = saved["sync:llm-temperature"] ?? llmTemperature;
    serverHost = saved["local:server-host"] ?? serverHost;
    serverSchema = saved["local:server-schema"] ?? serverSchema;
    serverModel = saved["local:server-model"] ?? serverModel;
    useServerApiKey = saved["local:use-server-api-key"] ?? useServerApiKey;
    serverApiKey = saved["local:server-api-key"] ?? serverApiKey;
    customRules = Array.isArray(saved["sync:custom-site-rules"])
      ? saved["sync:custom-site-rules"]
      : [];
    inpaintMethod = saved["sync:inpaint-method"] ?? inpaintMethod;
    inpaintLama = saved["sync:inpaint-lama"] ?? inpaintLama;
    const storedCtx = saved[`sync:context-${seriesName}`];
    if (storedCtx) {
      seriesContext = {
        ...seriesContext,
        ...storedCtx,
      };
    }

    loadingSettings = false;
  }

  loadSettings();

  function debouncedSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      storage.setItems([
        { key: "sync:share-data", value: shareData },
        { key: "sync:detection-auto-update", value: detectionAutoUpdate },
        { key: "sync:detection-min-confidence", value: detectionMinConfidence },
        { key: "sync:ocr-min-confidence", value: ocrMinConfidence },
        { key: "sync:script-gate", value: scriptGate },
        { key: "local:gemini-key", value: geminiKey },
        { key: "sync:gemini-model", value: geminiModel },
        { key: "sync:source-lang", value: sourceLang },
        { key: "sync:target-lang", value: targetLang },
        { key: "sync:detection-model", value: detectionModel },
        { key: "sync:current-mode", value: currentMode },
        {
          key: `sync:context-${seriesName}`,
          value: $state.snapshot(seriesContext),
        },
        { key: "sync:text-font", value: textFont },
        { key: "local:custom-fonts", value: $state.snapshot(customFonts) },
        { key: "sync:llm-model", value: llmModel },
        { key: "sync:llm-temperature", value: llmTemperature },
        { key: "local:server-host", value: serverHost },
        { key: "local:server-schema", value: serverSchema },
        { key: "local:server-model", value: serverModel },
        { key: "local:use-server-api-key", value: useServerApiKey },
        { key: "local:server-api-key", value: serverApiKey },
        { key: "sync:custom-site-rules", value: $state.snapshot(customRules) },
        { key: "sync:inpaint-method", value: inpaintMethod },
        { key: "sync:inpaint-lama", value: inpaintLama },
        { key: "sync:ocr-engine", value: ocrEngine },
      ]);
    }, 150);
  }

  $effect(() => {
    if (loadingSettings) return;
    [
      shareData,
      detectionAutoUpdate,
      detectionMinConfidence,
      ocrMinConfidence,
      ocrEngine,
      scriptGate,
      geminiKey,
      geminiModel,
      sourceLang,
      targetLang,
      detectionModel,
      currentMode,
      seriesContext.seriesName,
      seriesContext.summary,
      seriesContext.dictionary,
      textFont,
      customFonts.length,
      inpaintMethod,
      inpaintLama,
      llmModel,
      llmTemperature,
      serverHost,
      serverSchema,
      serverModel,
      useServerApiKey,
      serverApiKey,
      customRules.length,
    ];
    debouncedSave();

    if (detectionModel !== prevDetectionModel) {
      prevDetectionModel = detectionModel;
      isFetchingDetection = true;

      browser.runtime
        .sendMessage({
          type: "PREFETCH_MODEL",
          data: {
            type: "detection",
            data: detectionModel,
          },
        })
        .finally(() => (isFetchingDetection = false));
    }

    const isOcrMode = currentMode === "webgpu" || currentMode === "api";
    const switchedToLocal = currentMode !== prevMode && isOcrMode;
    const currentLangGroup =
      DefaultConfig.ocrLangGroupMap[sourceLang] ?? "latin";
    const prevLangGroup =
      DefaultConfig.ocrLangGroupMap[prevSourceLang] ?? "latin";
    const langGroupChangedInLocal =
      currentLangGroup !== prevLangGroup && isOcrMode;

    if (
      switchedToLocal ||
      (langGroupChangedInLocal && sourceLang !== "Auto-Detect")
    ) {
      prevSourceLang = sourceLang;
      prevMode = currentMode;
      isFetchingOCR = true;

      browser.runtime
        .sendMessage({
          type: "PREFETCH_MODEL",
          data: {
            type: "ocr",
            data: currentLangGroup,
          },
        })
        .finally(() => (isFetchingOCR = false));
    } else {
      prevSourceLang = sourceLang;
      prevMode = currentMode;
    }
  });

  $effect(() => {
    const handleClick = () => (activeDropdown = null);
    window.addEventListener("click", handleClick);
    return () => window.removeEventListener("click", handleClick);
  });

  $effect(() => {
    customFonts.forEach(({ name, dataUrl }) => {
      if (!document.fonts.check(`12px "${name}"`)) {
        const face = new FontFace(name, `url(${dataUrl})`);
        face.load().then(() => document.fonts.add(face));
      }
    });
  });

  $effect(() => {
    if (!env.githubRepo) return;
    (async () => {
      try {
        const res = await fetch(`${env.githubRepo}/releases/latest`, {
          method: "HEAD",
        });
        const finalUrl = res.url;
        const tag = finalUrl.split("/").pop();

        if (!tag) return;

        const fetchedVersion = tag.replace(/^v/, "");
        if (fetchedVersion !== latestVersion.currentVersion) {
          latestVersion = {
            currentVersion: latestVersion.currentVersion,
            version: fetchedVersion,
            url: finalUrl,
          };
        }
      } catch (error) {
        console.error("LMT: Failed to check for updates", error);
      }
    })();
  });
</script>

<main
  class="w-96 min-h-125 bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 p-4 font-sans flex flex-col transition-colors duration-300"
>
  {#if loadingSettings}
    <div
      in:fade={{ duration: 300 }}
      class="flex flex-col h-full justify-center items-center space-y-6 mt-6"
    >
      <LoaderCircle size={48} class="animate-spin text-white" />
      <h1 class="text-3xl font-bold tracking-tight mb-2">
        Loading Settings Config...
      </h1>
    </div>
  {:else}
    <div class="relative flex bg-zinc-100 dark:bg-zinc-900 p-1 rounded-xl mb-6">
      <div
        class="absolute top-1 bottom-1 left-1 bg-white dark:bg-zinc-800 rounded-lg shadow-sm transition-all duration-300 ease-out"
        style="width: calc(33.33% - 2px); transform: translateX({tabIndex *
          100}%);"
      ></div>

      {#each TABS as tab}
        <button
          onclick={() => (activeTab = tab.id)}
          class="relative flex-1 flex items-center justify-center gap-2 py-2 text-sm font-semibold transition-colors duration-300 cursor-pointer z-10 {activeTab ===
          tab.id
            ? 'text-blue-500'
            : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'}"
        >
          <tab.icon size={16} />
          {tab.label}
        </button>
      {/each}
    </div>

    <div class="grow grid">
      {#key activeTab}
        <div
          in:fly={{ y: 10, duration: 300, delay: 150 }}
          out:fade={{ duration: 150 }}
          class="col-start-1 row-start-1 space-y-5 flex flex-col h-full"
        >
          {#if latestVersion?.version && latestVersion.version !== latestVersion.currentVersion}
            <div
              class="flex items-center gap-3 p-2 mb-3 text-sm bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 text-amber-800 dark:text-amber-200 rounded-xl"
            >
              <TriangleAlert
                size={25}
                class="shrink-0 mt-0.5 text-amber-600 dark:text-amber-400"
              />
              <p class="leading-relaxed">
                <strong class="font-semibold text-amber-900 dark:text-amber-100"
                  >Update Available:</strong
                >
                Version {latestVersion.version} is out.
                <a
                  href={latestVersion.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="font-medium underline decoration-amber-400/50 hover:decoration-amber-500 dark:hover:decoration-amber-300 transition-colors"
                >
                  Download from GitHub
                </a>
              </p>
            </div>
          {/if}

          {#if ruleId === "fallback"}
            <div
              class="mt-2 flex items-start gap-2 p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg text-amber-700 dark:text-amber-400"
            >
              <TriangleAlert size={16} class="shrink-0 mt-0.5" />
              <div class="flex-1 text-xs">
                <p class="font-bold">Unrecognized Site</p>
                <p class="mt-0.5 opacity-90 leading-snug">
                  Using fallback parsers. If the chapter or series name looks
                  wrong, add a custom rule in Settings.
                </p>
              </div>
            </div>
          {/if}

          <!-- HOME TAB -->
          {#if activeTab === "home"}
            <div
              class="bg-zinc-100 dark:bg-zinc-900 p-4 rounded-2xl border border-zinc-200 dark:border-zinc-800"
            >
              <div class="flex flex-col gap-2 mb-2">
                <span
                  class="text-sm font-bold uppercase tracking-wider text-zinc-500"
                >
                  Processing Pipeline
                </span>

                <div class="flex items-center gap-1">
                  {#each MODES as mode}
                    <button
                      disabled={mode.disable()}
                      onclick={() => setMode(mode.id)}
                      class="cursor-pointer px-2 py-0.5 rounded-full font-bold disabled:cursor-not-allowed disabled:text-gray-500 {mode.classes} {currentMode ===
                      mode.id
                        ? mode.activeClasses
                        : ''}"
                    >
                      {mode.label}
                    </button>
                  {/each}
                </div>
              </div>

              {#if currentMode === "webgpu"}
                {#if !cachedLlms.includes(llmModel)}
                  <div
                    class="flex flex-col gap-2 p-3 bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800/30 rounded-xl"
                  >
                    <div class="flex gap-2 text-red-600 dark:text-red-500">
                      <TriangleAlert size={14} class="shrink-0 mt-0.5" />
                      <p class="text-xs leading-relaxed">
                        <strong class="font-bold">Model not cached.</strong> You
                        must download the selected LLM to use WebGPU mode. If you
                        proceed, it will attempt to download automatically on first
                        use.
                      </p>
                    </div>
                    <button
                      onclick={() => openSetupTab(llmModel)}
                      class="flex items-center justify-center gap-2 w-full py-1.5 mt-1 bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-900/60 rounded-lg text-xs font-bold transition-colors cursor-pointer"
                    >
                      <Download size={14} />
                      Download Now
                    </button>
                  </div>
                {:else}
                  <div
                    class="flex gap-2 p-3 bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800/30 rounded-xl text-amber-600 dark:text-amber-500"
                  >
                    <Info size={14} class="shrink-0 mt-0.5" />
                    <p class="text-xs leading-relaxed">
                      WebGPU mode active. Translation runs on the GPU via WebLLM;
                      detection and OCR run on the CPU.
                    </p>
                  </div>
                {/if}
              {:else if currentMode === "gemini"}
                <div
                  class="flex gap-2 p-3 bg-emerald-50 dark:bg-emerald-900/10 border border-emerald-200 dark:border-emerald-800/30 rounded-xl text-emerald-600 dark:text-emerald-500"
                >
                  <Sparkles size={14} class="shrink-0 mt-0.5" />
                  <p class="text-xs leading-relaxed">
                    Gemini mode active. Using Gemini API for improved
                    translation. Detection runs on your {activeDevice.toUpperCase()}.
                  </p>
                </div>
              {:else if currentMode === "api"}
                <div
                  class="flex gap-2 p-3 bg-sky-50 dark:bg-sky-900/10 border border-sky-200 dark:border-sky-800/30 rounded-xl text-sky-600 dark:text-sky-500"
                >
                  <Info size={14} class="shrink-0 mt-0.5" />
                  <p class="text-xs leading-relaxed">
                    API Mode active. OCR runs locally, then text is sent to your
                    server at <strong class="font-semibold">{serverHost}</strong>
                    {serverSchema === "lmstudio" ? " (LM Studio)" : " (OpenAI)"}.
                  </p>
                </div>
              {/if}
            </div>

            <div class="space-y-2">
              <span
                class="text-sm font-bold uppercase tracking-wider text-zinc-500 ml-1"
              >
                Language Pair
              </span>

              <div
                class="relative flex items-center justify-between p-2 bg-zinc-50 dark:bg-zinc-900/50 rounded-xl border border-zinc-200 dark:border-zinc-800 w-full shadow-sm"
                onclick={(e) => e.stopPropagation()}
                role="presentation"
              >
                <button
                  onclick={() => openDropdown("source")}
                  class="flex-1 flex items-center justify-center gap-2 p-2 hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded-lg transition-colors text-sm font-semibold"
                >
                  {#if isFetchingOCR}
                    <LoaderCircle
                      size={14}
                      class="animate-spin text-blue-500"
                    />
                  {/if}
                  {sourceLang}
                  <ChevronDown size={14} class="opacity-50" />
                </button>

                <button
                  onclick={swapLanguages}
                  class="p-2 text-zinc-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-full transition-colors mx-1 cursor-pointer"
                  title="Swap languages"
                >
                  <ArrowRightLeft size={16} />
                </button>

                <button
                  onclick={() => openDropdown("target")}
                  class="flex-1 flex items-center justify-center gap-2 p-2 hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded-lg transition-colors text-sm font-semibold text-blue-500"
                >
                  {targetLang}
                  <ChevronDown size={14} class="opacity-50" />
                </button>

                {#if activeDropdown}
                  <div
                    class="absolute top-full left-0 right-0 mt-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-xl shadow-xl z-50 overflow-hidden"
                    in:fade={{ duration: 150 }}
                    out:fade={{ duration: 150 }}
                  >
                    <div
                      class="flex items-center gap-2 p-3 border-b border-zinc-100 dark:border-zinc-800"
                    >
                      <Search size={16} class="text-zinc-400" />
                      <input
                        type="text"
                        bind:value={searchQuery}
                        placeholder="Search language..."
                        class="w-full bg-transparent text-sm outline-none"
                      />
                    </div>

                    <div class="max-h-48 overflow-y-auto p-1">
                      {#each visibleLanguages as lang}
                        <button
                          onclick={() => selectLanguage(lang)}
                          class="w-full text-left px-3 py-2 text-sm rounded-md hover:bg-blue-50 dark:hover:bg-blue-900/20 hover:text-blue-600 dark:hover:text-blue-400 transition-colors cursor-pointer
                          {(activeDropdown === 'source'
                            ? sourceLang
                            : targetLang) === lang
                            ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 font-bold'
                            : ''}"
                        >
                          {lang}
                        </button>
                      {/each}

                      {#if visibleLanguages.length === 0}
                        <div
                          class="px-3 py-4 text-center text-sm text-zinc-500"
                        >
                          No languages found
                        </div>
                      {/if}
                    </div>
                  </div>
                {/if}
              </div>
            </div>

            <!-- Helper Tip -->
            <div
              class="mt-auto pt-4 flex flex-col items-center justify-center text-center gap-2 text-zinc-500 dark:text-zinc-400"
            >
              <div
                class="p-2 bg-zinc-100 dark:bg-zinc-800 rounded-full border border-zinc-200 dark:border-zinc-700"
              >
                <BookOpen size={16} />
              </div>
              <p class="text-xs max-w-62.5 leading-relaxed">
                Right-click any manga image on a webpage and select <strong
                  class="text-zinc-700 dark:text-zinc-300"
                  >Translate Image</strong
                > to begin.
              </p>
            </div>
          {/if}

          <!-- CONTEXT TAB -->
          {#if activeTab === "context"}
            <div
              class="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-xl border border-blue-100 dark:border-blue-900/30 flex gap-2"
            >
              <Cpu size={14} class="text-blue-500 shrink-0 mt-0.5" />
              <p
                class="text-[11px] text-blue-700 dark:text-blue-400 leading-snug"
              >
                {currentMode === "gemini"
                  ? "Gemini uses these as system context for better nuance."
                  : "Translation models use these as prompt prefixes for consistent naming."}
              </p>
            </div>

            <div class="flex flex-col grow space-y-1.5">
              <label
                for="title"
                class="text-xs font-bold uppercase tracking-widest text-zinc-500 ml-1"
                >Series Title</label
              >
              <input
                type="text"
                id="title"
                bind:value={seriesContext.seriesName}
                placeholder="e.g. One Piece"
                class="w-full bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all"
              />
            </div>

            <div class="flex flex-col grow space-y-1.5">
              <label
                for="summary"
                class="text-xs font-bold uppercase tracking-widest text-zinc-500 ml-1"
                >Series Summary</label
              >
              <textarea
                id="summary"
                bind:value={seriesContext.summary}
                placeholder="e.g. Set in the Edo period, a ronin seeks..."
                class="w-full h-24 bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none resize-none transition-all placeholder:text-zinc-400"
              ></textarea>
            </div>

            <div class="flex flex-col grow space-y-1.5">
              <label
                for="dict"
                class="text-xs font-bold uppercase tracking-widest text-zinc-500 ml-1"
                >Custom Dictionary</label
              >
              <textarea
                id="dict"
                bind:value={seriesContext.dictionary}
                placeholder="Kuro -> 黑&#10;Oni -> Demon"
                class="w-full h-24 bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-3 text-sm font-mono focus:ring-2 focus:ring-blue-500 outline-none resize-none transition-all placeholder:text-zinc-400"
              ></textarea>
            </div>
          {/if}

          <!-- SETTINGS TAB -->
          {#if activeTab === "settings"}
            <div class="space-y-4">
              <DetectionSettings
                bind:detectionModel
                bind:detectionMinConfidence
                bind:detectionAutoUpdate
                {isFetchingDetection}
              />

              <OcrSettings bind:ocrMinConfidence bind:scriptGate bind:ocrEngine />

              <div>
                <span class="text-sm font-bold uppercase tracking-widest text-zinc-500 ml-1">
                  Translation AI
                </span>
                <div class="bg-zinc-50 dark:bg-zinc-900/50 p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 mt-2">
                  <BackendSettings
                    {currentMode}
                    bind:llmModel
                    bind:llmTemperature
                    bind:serverHost
                    bind:serverSchema
                    bind:serverModel
                    bind:useServerApiKey
                    bind:serverApiKey
                    bind:geminiKey
                    bind:geminiModel
                    bind:cachedLlms
                  />
                </div>
              </div>

              <TypographySettings bind:textFont bind:customFonts />

              <InpaintSettings bind:inpaintMethod bind:inpaintLama />

              <SiteRulesSettings
                bind:customRules
                {hostname}
                {title}
                {path}
                {currentMode}
                {geminiKey}
                {geminiModel}
                {llmModel}
                {llmTemperature}
                {serverHost}
                {serverSchema}
                {serverModel}
                {useServerApiKey}
                {serverApiKey}
              />

              <!-- FOOTER OPTIONS -->
              <div class="pt-2 pb-1">
                <label
                  class="flex items-center justify-between cursor-pointer group px-1"
                >
                  <span
                    class="text-sm font-medium text-zinc-700 dark:text-zinc-300 group-hover:text-blue-500 transition-colors"
                  >
                    Allow anonymous data sharing
                  </span>
                  <div class="relative flex items-center">
                    <input
                      type="checkbox"
                      bind:checked={shareData}
                      class="peer sr-only"
                    />
                    <div
                      class="h-5 w-5 rounded border-2 border-zinc-300 dark:border-zinc-700 peer-checked:bg-blue-500 peer-checked:border-blue-500 transition-all"
                    ></div>
                    <Check
                      size={14}
                      class="absolute text-white scale-0 peer-checked:scale-100 transition-transform left-0.5"
                    />
                  </div>
                </label>
              </div>

              <div class="text-center pt-2">
                <span
                  class="text-xs font-bold tracking-wide text-zinc-400 dark:text-zinc-600"
                >
                  LMT v{latestVersion.currentVersion}
                </span>
              </div>
            </div>
          {/if}
        </div>
      {/key}
    </div>
  {/if}
</main>
