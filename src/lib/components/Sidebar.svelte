<script lang="ts">
  import { fade, fly } from "svelte/transition";
  import {
    Settings,
    X,
    Cpu,
    Sliders,
    Type,
    ChevronDown,
    Search,
    ArrowRightLeft,
    LoaderCircle,
    HardDrive,
    Compass,
  } from "lucide-svelte";
  import { DefaultConfig, defaultLlmModelId, llmModelDef, normalizeDetectionModel, resolveLangGroup } from "@/lib/configs";
  import { normalizeInpaintMethod } from "@/lib/inpaint/ladder";
  import { openSetupTab } from "@/lib/utils";
  import DetectionSettings from "./settings/DetectionSettings.svelte";
  import AutoTranslateToggle from "./settings/AutoTranslateToggle.svelte";
  import OcrSettings from "./settings/OcrSettings.svelte";
  import BackendSettings from "./settings/BackendSettings.svelte";
  import TypographySettings from "./settings/TypographySettings.svelte";
  import SiteRulesSettings from "./settings/SiteRulesSettings.svelte";
  import DebugPanel from "./settings/DebugPanel.svelte";
  import InpaintSettings from "./settings/InpaintSettings.svelte";
  import ModelStorageSettings from "./settings/ModelStorageSettings.svelte";
  import ModelUpdateChecker from "./settings/ModelUpdateChecker.svelte";
  import GpuAccelerationPanel from "./settings/GpuAccelerationPanel.svelte";
  import { getSiteRule } from "@/lib/adapters";

  let isOpen = $state(false);
  let activeSection = $state<string>("pipeline");
  const manifestVersion = (browser.runtime.getManifest() as any).version_name || browser.runtime.getManifest().version;

  let currentMode = $state(DefaultConfig.currentMode);
  let sourceLang = $state(DefaultConfig.sourceLang);
  let targetLang = $state(DefaultConfig.targetLang);
  let detectionModel = $state(DefaultConfig.detectionModels[0].id);
  let detectionMinConfidence = $state(0.5);
  let skipBboxRefining = $state(false);
  let autoTranslate = $state(false);
  let autoTranslateConcurrency = $state(DefaultConfig.autoTranslateConcurrency);
  let ocrMinConfidence = $state(DefaultConfig.ocrMinConfidence);
  let scriptGate = $state(DefaultConfig.scriptGate);
  let llmModel = $state(defaultLlmModelId());
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
  let isFetchingOCR = $state(false);
  let prevSourceLang = $state(DefaultConfig.sourceLang);
  let prevOcrEngine = $state(DefaultConfig.ocrEngine);
  let prevMode = $state(DefaultConfig.currentMode);

  // 4 consolidated tabs: no horizontal overflow on 360px panel
  const SECTIONS = [
    { id: "pipeline", label: "Translate", icon: Cpu, accent: "cyan" },
    { id: "vision", label: "Vision", icon: Sliders, accent: "amber" },
    { id: "appearance", label: "Render", icon: Type, accent: "emerald" },
    { id: "system", label: "System", icon: HardDrive, accent: "rose" },
  ];

  let systemView = $state<"settings" | "logs">("settings");

  const MODE_META: Record<string, { label: string; hint: string }> = {
    webgpu: { label: "WebGPU", hint: "local" },
    gemini: { label: "Gemini", hint: "cloud" },
    api: { label: "API", hint: "self-hosted" },
  };
  const modeMeta = $derived(MODE_META[currentMode] ?? MODE_META.webgpu);

  const MODES = [
    {
      id: "webgpu",
      label: "WebGPU",
      desc: "Local",
    },
    {
      id: "gemini",
      label: "Gemini",
      desc: "Cloud",
    },
    {
      id: "api",
      label: "API Mode",
      desc: "Self-host",
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

      // One-time cleanup: per-model auto-update was replaced by the manual
      // System-tab update checker.
      await storage.removeItems(["sync:detection-auto-update"]).catch(() => {});

      const items = await storage.getItems([
        "sync:detection-min-confidence",
        "sync:skip-bbox-refining",
        "sync:auto-translate",
        "sync:auto-translate-concurrency",
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
        "sync:ocr-engine",
        "sync:script-gate",
        "local:cached-llms",
      ]);

      const saved = Object.fromEntries(items.map((i) => [i.key, i.value]));

      detectionMinConfidence = saved["sync:detection-min-confidence"] ?? detectionMinConfidence;
      skipBboxRefining = saved["sync:skip-bbox-refining"] ?? skipBboxRefining;
      autoTranslate = saved["sync:auto-translate"] ?? autoTranslate;
      autoTranslateConcurrency =
        saved["sync:auto-translate-concurrency"] ?? autoTranslateConcurrency;
      geminiKey = saved["local:gemini-key"] ?? geminiKey;
      geminiModel = saved["sync:gemini-model"] ?? geminiModel;
      detectionModel = normalizeDetectionModel(saved["sync:detection-model"] ?? detectionModel);
      ocrMinConfidence = saved["sync:ocr-min-confidence"] ?? ocrMinConfidence;
      ocrEngine = saved["sync:ocr-engine"] ?? ocrEngine;
      currentMode = saved["sync:current-mode"] ?? currentMode;
      sourceLang = saved["sync:source-lang"] ?? sourceLang;
      targetLang = saved["sync:target-lang"] ?? targetLang;
      textFont = saved["sync:text-font"] ?? textFont;
      customFonts = Array.isArray(saved["local:custom-fonts"]) ? saved["local:custom-fonts"] : [];
      llmModel = llmModelDef(saved["sync:llm-model"] ?? llmModel).id;
      llmTemperature = saved["sync:llm-temperature"] ?? llmTemperature;
      serverHost = saved["local:server-host"] ?? serverHost;
      serverSchema = saved["local:server-schema"] ?? serverSchema;
      serverModel = saved["local:server-model"] ?? serverModel;
      useServerApiKey = saved["local:use-server-api-key"] ?? useServerApiKey;
      serverApiKey = saved["local:server-api-key"] ?? serverApiKey;
      customRules = saved["sync:custom-site-rules"] ?? customRules;
      inpaintMethod = normalizeInpaintMethod(
        saved["sync:inpaint-method"] ?? inpaintMethod,
      );
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
        { key: "sync:detection-min-confidence", value: detectionMinConfidence },
        { key: "sync:skip-bbox-refining", value: skipBboxRefining },
        { key: "sync:auto-translate", value: autoTranslate },
        { key: "sync:auto-translate-concurrency", value: autoTranslateConcurrency },
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
        { key: "sync:ocr-engine", value: ocrEngine },
        { key: "sync:script-gate", value: scriptGate },
      ]);
    }, 150);
  }

  $effect(() => {
    if (loadingSettings) return;
    [
      detectionMinConfidence, skipBboxRefining, autoTranslate, autoTranslateConcurrency, ocrMinConfidence, scriptGate,
      geminiKey, geminiModel, sourceLang, targetLang, detectionModel, currentMode,
      seriesContext.seriesName, seriesContext.summary, seriesContext.dictionary,
      textFont, customFonts.length, inpaintMethod, llmModel, llmTemperature,
      serverHost, serverSchema, serverModel, useServerApiKey, serverApiKey, customRules.length,
    ];
    debouncedSave();
  });

  // Warm the OCR weights when the language group or engine changes in a local
  // mode (mirrors the popup prefetch effect) and spin the source-language
  // loader while the download lands.
  $effect(() => {
    if (loadingSettings) return;
    const isOcrMode = currentMode === "webgpu" || currentMode === "api";
    const switchedToLocal = currentMode !== prevMode && isOcrMode;
    const groupChanged =
      resolveLangGroup(sourceLang).group !==
        resolveLangGroup(prevSourceLang).group && isOcrMode;
    const engineChanged = ocrEngine !== prevOcrEngine && isOcrMode;

    if (switchedToLocal || groupChanged || engineChanged) {
      prevSourceLang = sourceLang;
      prevOcrEngine = ocrEngine;
      prevMode = currentMode;
      isFetchingOCR = true;

      browser.runtime
        .sendMessage({
          type: "PREFETCH_MODEL",
          data: {
            type: "ocr",
            data:
              ocrEngine === "paddle"
                ? resolveLangGroup(sourceLang).group
                : ocrEngine,
          },
        })
        .finally(() => (isFetchingOCR = false));
    } else {
      prevSourceLang = sourceLang;
      prevOcrEngine = ocrEngine;
      prevMode = currentMode;
    }
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

  $effect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") isOpen = false;
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
</script>

<!-- FLOATING TRIGGER -->
<div class="fixed bottom-6 right-6 z-99999 font-sans pointer-events-auto">
  <button
    type="button"
    onclick={() => (isOpen = !isOpen)}
    class="w-11 h-11 bg-[var(--surface-panel)] text-[var(--text-primary)] rounded-lg shadow-xl flex items-center justify-center cursor-pointer hover:border-[var(--accent-cyan)] hover:text-[var(--accent-cyan)] hover:shadow-[0_0_12px_var(--accent-cyan-glow)] transition-all border border-[var(--border-line)]"
    title="LMT settings"
    aria-label="Toggle settings panel"
  >
    {#if isOpen}
      <X size={18} />
    {:else}
      <Settings size={18} />
    {/if}
  </button>
</div>

<!-- SLIDING PANEL (360px Void-0 Contract) -->
{#if isOpen}
  <!-- Backdrop -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 bg-black/25 z-99998 pointer-events-auto"
    transition:fade={{ duration: 180 }}
    onclick={() => (isOpen = false)}
  ></div>

  <!-- Panel -->
  <div
    role="presentation"
    class="fixed top-0 right-0 bottom-0 w-[360px] max-w-[95vw] bg-[var(--bg-void-0)]/95 backdrop-blur-md text-[var(--text-primary)] shadow-2xl z-99999 flex flex-col font-body border-l border-[var(--border-line)] pointer-events-auto select-none"
    transition:fly={{ x: 360, duration: 220 }}
    onkeydown={(e) => e.stopPropagation()}
    onkeyup={(e) => e.stopPropagation()}
    onkeypress={(e) => e.stopPropagation()}
    onmousedown={(e) => e.stopPropagation()}
    onpointerdown={(e) => e.stopPropagation()}
    onwheel={(e) => e.stopPropagation()}
  >
    <!-- Header -->
    <div class="flex items-center justify-between px-3.5 py-3 border-b border-[var(--border-line)] shrink-0">
      <div class="flex items-center gap-2 min-w-0">
        <img
          src={browser.runtime.getURL("/icon/48.png")}
          alt="Translator"
          class="w-6 h-6 rounded-md shrink-0 object-contain"
        />
        <span class="font-display font-semibold text-[13px] tracking-tight truncate">LMT</span>
      </div>
      <button
        type="button"
        onclick={() => (isOpen = false)}
        class="p-1.5 text-[var(--text-muted)] hover:text-[var(--accent-rose)] rounded-md cursor-pointer hover:bg-[var(--surface-panel-alt)] transition-colors"
        aria-label="Close settings"
      >
        <X size={15} />
      </button>
    </div>

    <!-- 4 quiet tabs with distinctive domain accents -->
    <div class="grid grid-cols-4 border-b border-[var(--border-line)] shrink-0">
      {#each SECTIONS as s}
        {@const Icon = s.icon}
        {@const isActive = activeSection === s.id}
        <button
          type="button"
          onclick={() => { activeSection = s.id; systemView = "settings"; }}
          aria-current={isActive ? "page" : undefined}
          class="flex items-center justify-center gap-1.5 py-2.5 px-1 text-center transition-colors cursor-pointer border-b-2
                 {isActive
                   ? (s.accent === 'cyan'
                       ? 'border-b-[var(--accent-cyan)] bg-[var(--surface-panel)] text-[var(--accent-cyan)] font-semibold'
                       : s.accent === 'amber'
                         ? 'border-b-[var(--accent-amber)] bg-[var(--surface-panel)] text-[var(--accent-amber)] font-semibold'
                         : s.accent === 'emerald'
                           ? 'border-b-[var(--accent-emerald)] bg-[var(--surface-panel)] text-[var(--accent-emerald)] font-semibold'
                           : 'border-b-[var(--accent-rose)] bg-[var(--surface-panel)] text-[var(--accent-rose)] font-semibold')
                   : 'border-b-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-panel-alt)]/50'}"
        >
          <Icon size={13} />
          <span class="font-medium text-xs tracking-tight truncate">{s.label}</span>
        </button>
      {/each}
    </div>

    <!-- Content area -->
    <div class="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-3 min-h-0">
      {#if loadingSettings}
        <div class="flex flex-col items-center justify-center py-16 gap-3">
          <LoaderCircle size={24} class="animate-spin text-[var(--accent-cyan)]" />
          <span class="text-xs text-[var(--text-dim)]">Loading…</span>
        </div>
      {:else}

        <!-- ── TAB 1: TRANSLATE ── -->
        {#if activeSection === "pipeline"}
          <div class="space-y-3">
            <!-- Mode switcher -->
            <div class="panel-card !p-2 flex flex-col gap-2">
              <span class="kicker">Translation pipeline</span>
              <div class="grid grid-cols-3 gap-1 bg-[var(--bg-void)] p-1 rounded-lg border border-[var(--border-line)]">
                {#each MODES as mode}
                  <button
                    type="button"
                    onclick={() => setMode(mode.id)}
                    aria-pressed={currentMode === mode.id}
                    class="flex flex-col items-center justify-center py-1.5 px-1 rounded-md transition-all cursor-pointer text-center border
                           {currentMode === mode.id
                             ? (mode.id === 'webgpu'
                                 ? 'bg-[var(--surface-panel)] text-[var(--accent-amber)] font-medium border-[var(--accent-amber)]/40 shadow-[0_0_8px_var(--accent-amber-glow)]'
                                 : mode.id === 'gemini'
                                   ? 'bg-[var(--surface-panel)] text-[var(--accent-emerald)] font-medium border-[var(--accent-emerald)]/40 shadow-[0_0_8px_var(--accent-emerald-glow)]'
                                   : 'bg-[var(--surface-panel)] text-[var(--accent-cyan)] font-medium border-[var(--accent-cyan)]/40 shadow-[0_0_8px_var(--accent-cyan-glow)]')
                             : 'text-[var(--text-dim)] hover:text-[var(--text-primary)] border-transparent hover:bg-[var(--surface-panel-alt)]/50'}"
                  >
                    <span class="text-xs">{mode.label}</span>
                    <span class="text-[10px] opacity-70">{mode.desc}</span>
                  </button>
                {/each}
              </div>

              <!-- AI backend configuration -->
              <div class="pt-1.5 border-t border-[var(--border-faint)]">
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

            <!-- Language selector -->
            <div class="panel-card !p-2 flex flex-col gap-1.5 relative">
              <span class="kicker">Language pair</span>
              <div class="flex items-center justify-between gap-1.5 bg-[var(--bg-void)] p-1.5 rounded-lg border border-[var(--border-faint)]">
                <button
                  type="button"
                  onclick={() => (activeDropdown = activeDropdown === "source" ? null : "source")}
                  class="flex-1 flex items-center justify-between px-2 py-1.5 bg-[var(--surface-panel)] border border-[var(--border-line)] rounded-lg text-xs font-medium hover:border-[var(--accent-cyan)]/60 transition-colors cursor-pointer"
                >
                  <span class="truncate">{sourceLang}</span>
                  <ChevronDown size={11} class="text-[var(--text-dim)] shrink-0 ml-1" />
                </button>

                <button
                  type="button"
                  onclick={swapLanguages}
                  class="p-1.5 rounded-lg bg-[var(--surface-panel)] border border-[var(--border-line)] hover:border-[var(--accent-cyan)]/60 text-[var(--text-dim)] hover:text-[var(--accent-cyan)] transition-colors cursor-pointer shrink-0"
                >
                  <ArrowRightLeft size={12} />
                </button>

                <button
                  type="button"
                  onclick={() => (activeDropdown = activeDropdown === "target" ? null : "target")}
                  class="flex-1 flex items-center justify-between px-2 py-1.5 bg-[var(--surface-panel)] border border-[var(--border-line)] rounded-lg text-xs font-medium hover:border-[var(--accent-cyan)]/60 transition-colors cursor-pointer"
                >
                  <span class="truncate">{targetLang}</span>
                  <ChevronDown size={11} class="text-[var(--text-dim)] shrink-0 ml-1" />
                </button>
              </div>

              {#if activeDropdown}
                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <div
                  class="absolute top-full left-2 right-2 mt-1 bg-[var(--surface-panel)] border border-[var(--border-line)] rounded-lg shadow-2xl z-50 overflow-hidden"
                  onclick={(e) => e.stopPropagation()}
                >
                  <div class="flex items-center gap-1.5 p-2 border-b border-[var(--border-faint)] bg-[var(--bg-void)]">
                    <Search size={12} class="text-[var(--text-dim)] shrink-0" />
                    <input
                      type="text"
                      bind:value={searchQuery}
                      placeholder="Filter language…"
                      class="w-full bg-transparent text-xs outline-none placeholder:text-[var(--text-dim)] text-[var(--text-primary)]"
                    />
                  </div>
                  <div class="max-h-48 overflow-y-auto p-1 custom-scrollbar space-y-0.5">
                    {#each visibleLanguages as lang}
                      <button
                        type="button"
                        onclick={() => selectLanguage(lang)}
                        class="w-full text-left px-2 py-1 text-xs rounded-md transition-colors cursor-pointer border
                               {(activeDropdown === 'source' ? sourceLang : targetLang) === lang
                                 ? 'bg-[var(--accent-cyan-soft)] text-[var(--accent-cyan)] font-medium border-[var(--accent-cyan)]/40'
                                 : 'text-[var(--text-muted)] hover:bg-[var(--surface-panel-alt)] hover:text-[var(--text-primary)] border-transparent'}"
                      >
                        {lang}
                      </button>
                    {/each}
                  </div>
                </div>
              {/if}
            </div>

            <!-- Auto Translate engine card -->
            <AutoTranslateToggle
              bind:autoTranslate
              bind:concurrency={autoTranslateConcurrency}
            />
          </div>
        {/if}

        <!-- ── TAB 2: VISION & OCR ── -->
        {#if activeSection === "vision"}
          <div class="space-y-3">
            <DetectionSettings
              bind:detectionModel
              bind:detectionMinConfidence
              bind:skipBboxRefining
            />

            <OcrSettings
              bind:ocrMinConfidence
              bind:scriptGate
              bind:ocrEngine
              sourceLang={sourceLang}
            />
          </div>
        {/if}

        <!-- ── TAB 3: RENDERING & CONTEXT ── -->
        {#if activeSection === "appearance"}
          <div class="space-y-3">
            <InpaintSettings bind:inpaintMethod />

            <TypographySettings bind:textFont bind:customFonts />

            <!-- Series context & dictionary -->
            <div class="panel-card !p-2.5 flex flex-col gap-2">
              <span class="kicker">Series context & glossary</span>
              <div class="flex flex-col gap-2">
                <input
                  type="text"
                  bind:value={seriesContext.seriesName}
                  placeholder="Series title (e.g. One Piece)..."
                  class="w-full bg-[var(--bg-void)] border border-[var(--border-faint)] rounded-lg p-2 text-xs outline-none focus:border-[var(--border-line)] placeholder:text-[var(--text-dim)]"
                />
                <textarea
                  bind:value={seriesContext.summary}
                  placeholder="Story summary or setting context..."
                  rows={2}
                  class="w-full bg-[var(--bg-void)] custom-scrollbar border border-[var(--border-faint)] rounded-lg p-2 text-xs outline-none resize-none focus:border-[var(--border-line)] placeholder:text-[var(--text-dim)]"
                ></textarea>
                <textarea
                  bind:value={seriesContext.dictionary}
                  placeholder="Character dictionary (e.g. Kuro -> Black)..."
                  rows={2}
                  class="w-full bg-[var(--bg-void)] custom-scrollbar border border-[var(--border-faint)] rounded-lg p-2 text-xs outline-none resize-none focus:border-[var(--border-line)] placeholder:text-[var(--text-dim)]"
                ></textarea>
              </div>
            </div>
          </div>
        {/if}

        <!-- ── TAB 4: SYSTEM & STORAGE ── -->
        {#if activeSection === "system"}
          {#if systemView === "logs"}
            <div class="space-y-3">
              <DebugPanel showList={true} onBack={() => (systemView = "settings")} />
            </div>
          {:else}
          <div class="space-y-3">
            <GpuAccelerationPanel />

            <ModelUpdateChecker />

            <ModelStorageSettings />

            <!-- Site Rules -->
            <div class="panel-card !p-2.5 flex flex-col gap-2">
              <span class="kicker">Site rules</span>
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

            <!-- Retrigger Onboarding Card -->
            <div class="panel-card !p-2.5 flex flex-col gap-2">
              <div class="flex items-center gap-1.5">
                <Compass size={14} class="text-[var(--text-dim)]" />
                <span class="text-xs font-medium text-[var(--text-primary)]">Setup wizard</span>
              </div>
              <p class="text-[10px] text-[var(--text-muted)] leading-snug">
                Re-run the initial onboarding flow to configure detection, OCR, inpainting, and translation backends step-by-step.
              </p>
              <button
                type="button"
                onclick={() => openSetupTab()}
                class="btn-ghost w-full justify-center py-1.5 text-xs font-bold font-display"
              >
                Launch Wizard
              </button>
            </div>

            <!-- Debug Logs (collapsed until enabled) -->
            <DebugPanel compact onOpenLogs={() => (systemView = "logs")} />
          </div>
          {/if}
        {/if}

      {/if}
    </div>

    <!-- Footer: live pipeline + version -->
    <div class="px-3.5 py-2 border-t border-[var(--border-line)] flex items-center justify-between shrink-0 text-[11px] text-[var(--text-dim)] bg-[var(--bg-void)]">
      <span class="flex items-center gap-1.5 min-w-0">
        <span class="pulse-dot"></span>
        <span class="truncate text-[var(--text-muted)]">{modeMeta.label} · {modeMeta.hint}</span>
      </span>
      <span class="shrink-0 font-mono text-[10px]">v{manifestVersion}</span>
    </div>
  </div>
{/if}

