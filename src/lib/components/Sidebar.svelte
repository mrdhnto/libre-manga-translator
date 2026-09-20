<script lang="ts">
  import { fade, fly } from "svelte/transition";
  import {
    Settings,
    X,
    Cpu,
    BookOpen,
    Languages,
    Sliders,
    Type,
    Bug,
    ChevronDown,
    Search,
    ArrowRightLeft,
    LoaderCircle,
    HardDrive,
  } from "lucide-svelte";
  import { DefaultConfig } from "@/lib/configs";
  import DetectionSettings from "./settings/DetectionSettings.svelte";
  import OcrSettings from "./settings/OcrSettings.svelte";
  import BackendSettings from "./settings/BackendSettings.svelte";
  import TypographySettings from "./settings/TypographySettings.svelte";
  import SiteRulesSettings from "./settings/SiteRulesSettings.svelte";
  import DebugPanel from "./settings/DebugPanel.svelte";
  import InpaintSettings from "./settings/InpaintSettings.svelte";
  import ModelStorageSettings from "./settings/ModelStorageSettings.svelte";
  import { getSiteRule } from "@/lib/adapters";

  let isOpen = $state(false);
  let activeSection = $state<string>("pipeline");

  let currentMode = $state(DefaultConfig.currentMode);
  let sourceLang = $state(DefaultConfig.sourceLang);
  let targetLang = $state(DefaultConfig.targetLang);
  let shareData = $state(true);
  let detectionModel = $state(DefaultConfig.detectionModels[0].id);
  let detectionMinConfidence = $state(0.5);
  let detectionAutoUpdate = $state(true);
  let ocrMinConfidence = $state(DefaultConfig.ocrMinConfidence);
  let scriptGate = $state(DefaultConfig.scriptGate);
  let llmModel = $state(DefaultConfig.llmModels[0].id);
  let llmTemperature = $state(DefaultConfig.llmTemperature);
  let serverHost = $state(DefaultConfig.serverHost);
  let serverSchema = $state(DefaultConfig.serverSchema);
  let serverModel = $state(DefaultConfig.serverModel);
  let useServerApiKey = $state(DefaultConfig.useServerApiKey);
  let serverApiKey = $state(DefaultConfig.serverApiKey);
  let geminiKey = $state("");
  let geminiModel = $state(DefaultConfig.geminiModels[0].id);
  let cachedLlms = $state<string[]>([]);
  let textFont = $state(DefaultConfig.bundleFonts[0].id);
  let inpaintMethod = $state(DefaultConfig.inpaintMethod);
  let inpaintLama = $state(DefaultConfig.inpaintLama);
  let ocrEngine = $state(DefaultConfig.ocrEngine);
  let customFonts = $state<{ name: string; dataUrl: string }[]>([]);
  let customRules = $state<SiteRule[]>([]);
  let seriesContext = $state<SeriesContext>({
    seriesName: "",
    summary: "",
    dictionary: "",
    lastChapterId: null,
    lastPageIndex: null,
    recentHistory: [],
    translatedCount: 0,
  });

  let activeDropdown = $state<"source" | "target" | null>(null);
  let searchQuery = $state("");
  let saveTimer: ReturnType<typeof setTimeout>;
  let loadingSettings = $state(true);
  let seriesName = $state("");

  // 6 consolidated tabs (was 8)
  const SECTIONS = [
    { id: "pipeline", label: "Pipeline", icon: Cpu },
    { id: "language", label: "Language", icon: Languages },
    { id: "detection", label: "Detection", icon: Sliders },
    { id: "appearance", label: "Appearance", icon: Type },
    { id: "content", label: "Content", icon: BookOpen },
    { id: "models", label: "Models", icon: HardDrive },
    { id: "debug", label: "Debug", icon: Bug },
  ];

  const MODES = [
    {
      id: "webgpu",
      label: "WebGPU",
      classes: "text-amber-700 dark:text-amber-400",
      activeClasses: "bg-amber-100 dark:bg-amber-900/40 shadow-sm",
    },
    {
      id: "gemini",
      label: "Gemini",
      classes: "text-emerald-700 dark:text-emerald-400",
      activeClasses: "bg-emerald-100 dark:bg-emerald-900/40 shadow-sm",
    },
    {
      id: "api",
      label: "API Mode",
      classes: "text-sky-700 dark:text-sky-400",
      activeClasses: "bg-sky-100 dark:bg-sky-900/40 shadow-sm",
    },
  ];

  const visibleLanguages = $derived(
    DefaultConfig.availableLanguages.filter((l) => {
      const matchesSearch = l.toLowerCase().includes(searchQuery.toLowerCase());
      const isTargetAuto = activeDropdown === "target" && l === "Auto-Detect";
      return matchesSearch && !isTargetAuto;
    }),
  );
  
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
    try {
      const rule = await getSiteRule();
      seriesName = rule.seriesName;
      seriesContext.seriesName = seriesName;

      await migrateLocalKeys();

      const items = await storage.getItems([
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
        `sync:context-${seriesName}`,
        "sync:text-font",
        "local:custom-fonts",
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
        "local:cached-llms",
      ]);

      const saved = Object.fromEntries(items.map((i) => [i.key, i.value]));

      shareData = saved["sync:share-data"] ?? shareData;
      detectionAutoUpdate = saved["sync:detection-auto-update"] ?? detectionAutoUpdate;
      detectionMinConfidence = saved["sync:detection-min-confidence"] ?? detectionMinConfidence;
      geminiKey = saved["local:gemini-key"] ?? geminiKey;
      geminiModel = saved["sync:gemini-model"] ?? geminiModel;
      detectionModel = saved["sync:detection-model"] ?? detectionModel;
      ocrMinConfidence = saved["sync:ocr-min-confidence"] ?? ocrMinConfidence;
      ocrEngine = saved["sync:ocr-engine"] ?? ocrEngine;
      currentMode = saved["sync:current-mode"] ?? currentMode;
      sourceLang = saved["sync:source-lang"] ?? sourceLang;
      targetLang = saved["sync:target-lang"] ?? targetLang;
      textFont = saved["sync:text-font"] ?? textFont;
      customFonts = Array.isArray(saved["local:custom-fonts"]) ? saved["local:custom-fonts"] : [];
      llmModel = saved["sync:llm-model"] ?? llmModel;
      llmTemperature = saved["sync:llm-temperature"] ?? llmTemperature;
      serverHost = saved["local:server-host"] ?? serverHost;
      serverSchema = saved["local:server-schema"] ?? serverSchema;
      serverModel = saved["local:server-model"] ?? serverModel;
      useServerApiKey = saved["local:use-server-api-key"] ?? useServerApiKey;
      serverApiKey = saved["local:server-api-key"] ?? serverApiKey;
      customRules = saved["sync:custom-site-rules"] ?? customRules;
      inpaintMethod = saved["sync:inpaint-method"] ?? inpaintMethod;
      inpaintLama = saved["sync:inpaint-lama"] ?? inpaintLama;
      scriptGate = saved["sync:script-gate"] ?? scriptGate;
      cachedLlms = Array.isArray(saved["local:cached-llms"]) ? saved["local:cached-llms"] : [];

      const storedCtx = saved[`sync:context-${seriesName}`];
      if (storedCtx) seriesContext = { ...seriesContext, ...storedCtx };
    } finally {
      loadingSettings = false;
    }
  }

  function debouncedSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      storage.setItems([
        { key: "sync:share-data", value: shareData },
        { key: "sync:detection-auto-update", value: detectionAutoUpdate },
        { key: "sync:detection-min-confidence", value: detectionMinConfidence },
        { key: "sync:ocr-min-confidence", value: ocrMinConfidence },
        { key: "local:gemini-key", value: geminiKey },
        { key: "sync:gemini-model", value: geminiModel },
        { key: "sync:source-lang", value: sourceLang },
        { key: "sync:target-lang", value: targetLang },
        { key: "sync:detection-model", value: detectionModel },
        { key: "sync:current-mode", value: currentMode },
        { key: `sync:context-${seriesName}`, value: $state.snapshot(seriesContext) },
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
        { key: "sync:script-gate", value: scriptGate },
      ]);
    }, 150);
  }

  $effect(() => {
    if (loadingSettings) return;
    [
      shareData, detectionAutoUpdate, detectionMinConfidence, ocrMinConfidence, scriptGate,
      geminiKey, geminiModel, sourceLang, targetLang, detectionModel, currentMode,
      seriesContext.seriesName, seriesContext.summary, seriesContext.dictionary,
      textFont, customFonts.length, inpaintMethod, llmModel, llmTemperature,
      serverHost, serverSchema, serverModel, useServerApiKey, serverApiKey, customRules.length,
    ];
    debouncedSave();
  });

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

  function selectLanguage(lang: string) {
    if (activeDropdown === "source") sourceLang = lang;
    if (activeDropdown === "target") targetLang = lang;
    activeDropdown = null;
  }

  $effect(() => {
    if (isOpen) loadSettings();
  });
</script>

<!-- FLOATING TRIGGER -->
<div class="fixed bottom-6 right-6 z-99999 font-sans pointer-events-auto">
  <button
    onclick={() => (isOpen = !isOpen)}
    class="w-12 h-12 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 rounded-full shadow-2xl flex items-center justify-center cursor-pointer hover:scale-110 active:scale-95 transition-all border border-zinc-700/50 dark:border-zinc-300/50"
    title="LMT Settings"
    aria-label="Toggle LMT Settings Panel"
  >
    {#if isOpen}
      <X size={20} />
    {:else}
      <Settings size={20} />
    {/if}
  </button>
</div>

<!-- SLIDING PANEL -->
{#if isOpen}
  <!-- Backdrop -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 bg-black/30 z-99998 pointer-events-auto"
    transition:fade={{ duration: 200 }}
    onclick={() => (isOpen = false)}
  ></div>

  <!-- Panel -->
  <div
    role="presentation"
    class="fixed top-0 right-0 bottom-0 w-84 max-w-[90vw] bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 shadow-2xl z-99999 flex flex-col font-sans border-l border-zinc-200 dark:border-zinc-800 pointer-events-auto"
    transition:fly={{ x: 340, duration: 250 }}
    onkeydown={(e) => e.stopPropagation()}
    onkeyup={(e) => e.stopPropagation()}
    onkeypress={(e) => e.stopPropagation()}
    onmousedown={(e) => e.stopPropagation()}
    onpointerdown={(e) => e.stopPropagation()}
    onwheel={(e) => e.stopPropagation()}
  >
    <!-- Header -->
    <div class="flex items-center justify-between px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 shrink-0">
      <div class="flex items-center gap-2">
        <img
          src={browser.runtime.getURL("/icon/48.png")}
          alt="LMT"
          class="w-6 h-6 rounded-md shrink-0 object-contain"
        />
        <span class="font-bold text-sm tracking-tight">LMT Settings</span>
      </div>
      <button
        onclick={() => (isOpen = false)}
        class="p-1.5 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 rounded-md cursor-pointer transition-colors"
        aria-label="Close settings"
      >
        <X size={16} />
      </button>
    </div>

    <!-- Tab strip - hide native scrollbar, show content via overflow -->
    <div class="tabs-strip flex overflow-x-auto px-2 py-1.5 bg-zinc-50 dark:bg-zinc-900/70 border-b border-zinc-200 dark:border-zinc-800 shrink-0 gap-0.5">
      {#each SECTIONS as s}
        <button
          onclick={() => (activeSection = s.id)}
          class="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold rounded-lg whitespace-nowrap transition-all cursor-pointer shrink-0
          {activeSection === s.id
            ? 'bg-white dark:bg-zinc-800 text-blue-500 shadow-xs'
            : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 hover:bg-white/60 dark:hover:bg-zinc-800/60'}"
        >
          <s.icon size={12} />
          {s.label}
        </button>
      {/each}
    </div>

    <!-- Content area - overlay scrollbar -->
    <div class="scroll-area flex-1 overflow-y-auto p-4 space-y-4">
      {#if loadingSettings}
        <div class="flex flex-col items-center justify-center py-12 gap-3">
          <LoaderCircle size={28} class="animate-spin text-blue-500" />
          <span class="text-xs text-zinc-400">Loading settings...</span>
        </div>
      {:else}

        <!-- ── PIPELINE ── -->
        {#if activeSection === "pipeline"}
          <div class="space-y-4">
            <!-- Mode switcher -->
            <div>
              <p class="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-2">
                Translation Mode
              </p>
              <div class="flex gap-1 p-1 bg-zinc-100 dark:bg-zinc-900 rounded-xl">
                {#each MODES as mode}
                  <button
                    onclick={() => setMode(mode.id)}
                    class="flex-1 cursor-pointer px-2 py-2 rounded-lg text-[11px] font-bold text-center transition-all {mode.classes} {currentMode === mode.id
                      ? mode.activeClasses
                      : 'opacity-60 hover:opacity-100'}"
                  >
                    {mode.label}
                  </button>
                {/each}
              </div>
            </div>

            <!-- Mode-specific AI config -->
            <div class="bg-zinc-50 dark:bg-zinc-900/50 p-3 rounded-xl border border-zinc-200 dark:border-zinc-800">
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
        {/if}

        <!-- ── LANGUAGE + OCR ── -->
        {#if activeSection === "language"}
          <div class="space-y-4">
            <!-- Language pair -->
            <div>
              <p class="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-2">
                Language Pair
              </p>
              <div
                class="relative flex items-center justify-between p-1.5 bg-zinc-50 dark:bg-zinc-900/50 rounded-xl border border-zinc-200 dark:border-zinc-800"
              >
                <button
                  onclick={() => (activeDropdown = activeDropdown === "source" ? null : "source")}
                  class="flex-1 flex items-center justify-center gap-1 p-2 hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded-lg transition-colors text-xs font-semibold cursor-pointer"
                >
                  {sourceLang}
                  <ChevronDown size={11} class="opacity-50 shrink-0" />
                </button>

                <button
                  onclick={swapLanguages}
                  class="p-1.5 text-zinc-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-full transition-colors cursor-pointer mx-0.5"
                  title="Swap"
                >
                  <ArrowRightLeft size={13} />
                </button>

                <button
                  onclick={() => (activeDropdown = activeDropdown === "target" ? null : "target")}
                  class="flex-1 flex items-center justify-center gap-1 p-2 hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded-lg transition-colors text-xs font-semibold text-blue-500 cursor-pointer"
                >
                  {targetLang}
                  <ChevronDown size={11} class="opacity-50 shrink-0" />
                </button>

                {#if activeDropdown}
                  <div
                    class="absolute top-full left-0 right-0 mt-1.5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-xl shadow-xl z-50 overflow-hidden"
                    in:fade={{ duration: 120 }}
                    out:fade={{ duration: 120 }}
                  >
                    <div class="flex items-center gap-2 px-3 py-2 border-b border-zinc-100 dark:border-zinc-800">
                      <Search size={13} class="text-zinc-400 shrink-0" />
                      <input
                        type="text"
                        bind:value={searchQuery}
                        placeholder="Search language..."
                        class="w-full bg-transparent text-xs outline-none"
                      />
                    </div>
                    <div class="lang-scroll max-h-52 overflow-y-auto p-1">
                      {#each visibleLanguages as lang}
                        <button
                          onclick={() => selectLanguage(lang)}
                          class="w-full text-left px-2.5 py-1.5 text-xs rounded-md hover:bg-blue-50 dark:hover:bg-blue-900/20 hover:text-blue-600 transition-colors cursor-pointer
                          {(activeDropdown === 'source' ? sourceLang : targetLang) === lang
                            ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 font-bold'
                            : ''}"
                        >
                          {lang}
                        </button>
                      {/each}
                    </div>
                  </div>
                {/if}
              </div>
            </div>

            <!-- OCR threshold (merged into Language tab) -->
            <div class="pt-4 border-t border-zinc-200 dark:border-zinc-800">
              <p class="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-2">
                OCR Threshold
              </p>
              <OcrSettings bind:ocrMinConfidence bind:scriptGate bind:ocrEngine />
            </div>
          </div>
        {/if}

        <!-- ── DETECTION ── -->
        {#if activeSection === "detection"}
          <DetectionSettings
            bind:detectionModel
            bind:detectionMinConfidence
            bind:detectionAutoUpdate
          />
        {/if}

        <!-- ── APPEARANCE (Typography) ── -->
        {#if activeSection === "appearance"}
          <div class="space-y-3">
            <TypographySettings bind:textFont bind:customFonts />
            <InpaintSettings bind:inpaintMethod bind:inpaintLama />
          </div>
        {/if}

        <!-- ── CONTENT (Series Context + Site Rules) ── -->
        {#if activeSection === "content"}
          <div class="space-y-3">
            <p class="text-[10px] font-bold uppercase tracking-widest text-zinc-500">
              Series Context
            </p>

            <div class="space-y-2.5">
              <div class="flex flex-col gap-1">
                <label
                  for="sidebar-title"
                  class="text-[10px] font-semibold text-zinc-500 ml-0.5"
                >
                  Series Title
                </label>
                <input
                  id="sidebar-title"
                  type="text"
                  bind:value={seriesContext.seriesName}
                  placeholder="e.g. One Piece"
                  class="w-full bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-2.5 text-xs focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                />
              </div>

              <div class="flex flex-col gap-1">
                <label
                  for="sidebar-summary"
                  class="text-[10px] font-semibold text-zinc-500 ml-0.5"
                >
                  Summary
                </label>
                <textarea
                  id="sidebar-summary"
                  bind:value={seriesContext.summary}
                  placeholder="Context about the story or setting..."
                  rows={3}
                  class="w-full bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-2.5 text-xs focus:ring-2 focus:ring-blue-500 outline-none resize-none transition-all placeholder:text-zinc-400"
                ></textarea>
              </div>

              <div class="flex flex-col gap-1">
                <label
                  for="sidebar-dict"
                  class="text-[10px] font-semibold text-zinc-500 ml-0.5"
                >
                  Custom Dictionary
                </label>
                <textarea
                  id="sidebar-dict"
                  bind:value={seriesContext.dictionary}
                  placeholder="Kuro -> 黒&#10;Oni -> Demon"
                  rows={3}
                  class="w-full bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-2.5 text-xs font-mono focus:ring-2 focus:ring-blue-500 outline-none resize-none transition-all placeholder:text-zinc-400"
                ></textarea>
              </div>
            </div>

            <!-- Site Rules section divider -->
            <div class="pt-4 border-t border-zinc-200 dark:border-zinc-800">
              <p class="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-3">
                Site Rules
              </p>
              <SiteRulesSettings
                bind:customRules
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
            </div>
          </div>
        {/if}

        <!-- ── MODELS & STORAGE ── -->
        {#if activeSection === "models"}
          <ModelStorageSettings />
        {/if}

        <!-- ── DEBUG ── -->
        {#if activeSection === "debug"}
          <DebugPanel />
        {/if}

      {/if}
    </div>

    <!-- Footer -->
    <div class="px-4 py-2.5 border-t border-zinc-200 dark:border-zinc-800 flex items-center justify-between shrink-0">
      <label class="flex items-center gap-2 cursor-pointer text-[11px] text-zinc-500">
        <input type="checkbox" bind:checked={shareData} class="rounded accent-blue-500" />
        <span>Anonymous data sharing</span>
      </label>
      <span class="text-[10px] font-bold text-zinc-400">v{(browser.runtime.getManifest() as any).version_name || browser.runtime.getManifest().version}</span>
    </div>
  </div>
{/if}

<style>
  /* Overlay scrollbar - content area */
  .scroll-area::-webkit-scrollbar {
    width: 4px;
  }
  .scroll-area::-webkit-scrollbar-track {
    background: transparent;
  }
  .scroll-area::-webkit-scrollbar-thumb {
    background: rgba(161, 161, 170, 0.45);
    border-radius: 9999px;
  }
  .scroll-area::-webkit-scrollbar-thumb:hover {
    background: rgba(161, 161, 170, 0.85);
  }

  /* Thin overlay scrollbar for tab strip */
  .tabs-strip::-webkit-scrollbar {
    height: 3px;
    width: 0;
  }
  .tabs-strip::-webkit-scrollbar-track {
    background: transparent;
  }
  .tabs-strip::-webkit-scrollbar-thumb {
    background: rgba(161, 161, 170, 0.4);
    border-radius: 9999px;
  }
  .tabs-strip::-webkit-scrollbar-thumb:hover {
    background: rgba(161, 161, 170, 0.8);
  }

  /* Thin overlay scrollbar for language dropdown */
  .lang-scroll::-webkit-scrollbar {
    width: 3px;
  }
  .lang-scroll::-webkit-scrollbar-track {
    background: transparent;
  }
  .lang-scroll::-webkit-scrollbar-thumb {
    background: rgba(161, 161, 170, 0.4);
    border-radius: 9999px;
  }
</style>
