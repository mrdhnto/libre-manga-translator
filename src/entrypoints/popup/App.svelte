<script lang="ts">
  import {
    Zap,
    Settings as SettingsIcon,
    ArrowRightLeft,
    ChevronDown,
    Search,
    TriangleAlert,
    Download,
    Compass,
  } from "lucide-svelte";
  import { DefaultConfig, normalizeDetectionModel, resolveLangGroup } from "@/lib/configs";
  import { normalizeInpaintMethod } from "@/lib/inpaint/ladder";
  import { env } from "@/lib/env";
  import { untrack, onMount } from "svelte";
  import { openSetupTab } from "@/lib/utils";
  import { getSiteRule } from "@/lib/adapters";
  import DetectionSettings from "@/lib/components/settings/DetectionSettings.svelte";
  import OcrSettings from "@/lib/components/settings/OcrSettings.svelte";
  import BackendSettings from "@/lib/components/settings/BackendSettings.svelte";
  import TypographySettings from "@/lib/components/settings/TypographySettings.svelte";
  import InpaintSettings from "@/lib/components/settings/InpaintSettings.svelte";
  import SiteRulesSettings from "@/lib/components/settings/SiteRulesSettings.svelte";
  import GpuAccelerationPanel from "@/lib/components/settings/GpuAccelerationPanel.svelte";

  let {
    hostname = "",
    title = "",
    path = "",
  }: {
    hostname?: string;
    title?: string;
    path?: string;
  } = $props();

  let activeTab = $state<"home" | "settings">("home");
  let seriesName = $state("Unknown Series");
  let ruleId = $state("");

  // Pipeline & Models State
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
  let ocrEngine = $state(DefaultConfig.ocrEngine);
  let inpaintMethod = $state(DefaultConfig.inpaintMethod);
  let textFont = $state(DefaultConfig.bundleFonts[0].id);
  let customFonts = $state<{ name: string; dataUrl: string }[]>([]);

  // Backend / AI Keys
  let geminiKey = $state("");
  let geminiModel = $state(DefaultConfig.geminiModels[0].id);
  let llmModel = $state(DefaultConfig.llmModels[0].id);
  let llmTemperature = $state(DefaultConfig.llmTemperature);
  let serverHost = $state(DefaultConfig.serverHost);
  let serverSchema = $state(DefaultConfig.serverSchema);
  let serverModel = $state(DefaultConfig.serverModel);
  let useServerApiKey = $state(DefaultConfig.useServerApiKey);
  let serverApiKey = $state(DefaultConfig.serverApiKey);
  let cachedLlms = $state<string[]>([]);
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

  let showContextDrawer = $state(false);
  let activeDropdown = $state<"source" | "target" | null>(null);
  let searchQuery = $state("");
  let loadingSettings = $state(true);
  let saveTimer: ReturnType<typeof setTimeout>;

  const MODES = [
    { id: "webgpu", label: "WebGPU", desc: "100% Local" },
    { id: "gemini", label: "Gemini", desc: "Cloud Direct" },
    { id: "api", label: "API Mode", desc: "Self-Hosted" },
  ];

  const visibleLanguages = $derived(
    DefaultConfig.availableLanguages.filter((l) => {
      const matchesSearch = l.toLowerCase().includes(searchQuery.toLowerCase());
      const isTargetAuto = activeDropdown === "target" && l === "Auto-Detect";
      return matchesSearch && !isTargetAuto;
    }),
  );

  async function loadSettings() {
    // ── Per-step timeouts: any individual storage round-trip must not be
    //    allowed to block popup paint indefinitely. A hung read falls through
    //    to defaults so the popup never sits on the BOOTING spinner.
    const withTimeout = <T,>(p: Promise<T>, ms = 1200, fallback: T): Promise<T> =>
      Promise.race([
        p,
        new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
      ]);

    // Hard ceiling so even if every step takes its full timeout budget we
    // still flip `loadingSettings=false` within ~2s of popup open.
    const hardTimer = setTimeout(() => {
      loadingSettings = false;
    }, 2000);

    try {
      ({ ruleId, seriesName } = await withTimeout(
        getSiteRule(undefined, hostname, title, path),
        1500,
        { ruleId: "", seriesName: "Unknown Series" } as any,
      ));
      seriesContext.seriesName = seriesName;

      // One-time cleanup: per-model auto-update was replaced by the manual
      // System-tab update checker.
      await withTimeout(
        storage.removeItems(["sync:detection-auto-update"]).catch(() => {}),
        800,
        undefined,
      );

      const items = await withTimeout(
        storage.getItems([
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
          "sync:ocr-engine",
          "sync:script-gate",
        ]),
        1500,
        [] as { key: string; value: unknown }[],
      );

      const saved = Object.fromEntries(
        items.map((i) => [i.key, i.value]),
      ) as Record<string, any>;
      detectionMinConfidence = saved["sync:detection-min-confidence"] ?? detectionMinConfidence;
      skipBboxRefining = saved["sync:skip-bbox-refining"] ?? skipBboxRefining;
      autoTranslate = saved["sync:auto-translate"] ?? autoTranslate;
      autoTranslateConcurrency = saved["sync:auto-translate-concurrency"] ?? autoTranslateConcurrency;
      geminiKey = saved["local:gemini-key"] ?? geminiKey;
      geminiModel = saved["sync:gemini-model"] ?? geminiModel;
      detectionModel = normalizeDetectionModel(saved["sync:detection-model"] ?? detectionModel);
      ocrMinConfidence = saved["sync:ocr-min-confidence"] ?? ocrMinConfidence;
      ocrEngine = saved["sync:ocr-engine"] ?? ocrEngine;
      scriptGate = saved["sync:script-gate"] ?? scriptGate;
      currentMode = saved["sync:current-mode"] ?? currentMode;
      sourceLang = saved["sync:source-lang"] ?? sourceLang;
      targetLang = saved["sync:target-lang"] ?? targetLang;
      textFont = saved["sync:text-font"] ?? textFont;
      customFonts = Array.isArray(saved["local:custom-fonts"]) ? saved["local:custom-fonts"] : [];
      cachedLlms = Array.isArray(saved["local:cached-llms"]) ? saved["local:cached-llms"] : [];
      llmModel = saved["sync:llm-model"] ?? llmModel;
      llmTemperature = saved["sync:llm-temperature"] ?? llmTemperature;
      serverHost = saved["local:server-host"] ?? serverHost;
      serverSchema = saved["local:server-schema"] ?? serverSchema;
      serverModel = saved["local:server-model"] ?? serverModel;
      useServerApiKey = saved["local:use-server-api-key"] ?? useServerApiKey;
      serverApiKey = saved["local:server-api-key"] ?? serverApiKey;
      customRules = Array.isArray(saved["sync:custom-site-rules"]) ? saved["sync:custom-site-rules"] : [];
      inpaintMethod = normalizeInpaintMethod(saved["sync:inpaint-method"] ?? inpaintMethod);

      const storedCtx = saved[`sync:context-${seriesName}`];
      if (storedCtx) seriesContext = { ...seriesContext, ...storedCtx };
    } finally {
      clearTimeout(hardTimer);
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
        { key: "sync:script-gate", value: scriptGate },
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
      ]);
    }, 150);
  }

  $effect(() => {
    if (loadingSettings) return;
    [
      detectionMinConfidence, skipBboxRefining, autoTranslate, autoTranslateConcurrency,
      ocrMinConfidence, ocrEngine, scriptGate, geminiKey, geminiModel, sourceLang, targetLang,
      detectionModel, currentMode, seriesContext.seriesName, seriesContext.summary, seriesContext.dictionary,
      textFont, customFonts.length, inpaintMethod, llmModel, llmTemperature, serverHost, serverSchema,
      serverModel, useServerApiKey, serverApiKey, customRules.length,
    ];
    debouncedSave();
  });

  function setMode(modeId: string) {
    currentMode = modeId;
    if (modeId === "gemini") sourceLang = "Auto-Detect";
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

  onMount(() => {
    loadSettings();
    const handleClick = () => (activeDropdown = null);
    window.addEventListener("click", handleClick);
    return () => window.removeEventListener("click", handleClick);
  });
</script>

<!-- Calm 360x540 container -->
<main
  class="w-[360px] h-[540px] max-w-[360px] max-h-[540px] bg-[var(--bg-void-0)] text-[var(--text-primary)] font-body flex flex-col overflow-hidden select-none"
>
  <!-- Simplified header -->
  <header class="flex items-center justify-between px-3.5 py-2.5 border-b border-[var(--border-line)] shrink-0">
    <div class="flex items-center gap-2 min-w-0">
      <img src="/icon/48.png" alt="LMT" class="w-6 h-6 rounded-md shrink-0 object-contain" />
      <span class="font-display font-semibold text-[13px] tracking-tight truncate">LMT</span>
    </div>

    <!-- Quiet section switch -->
    <div class="flex items-center gap-0.5 bg-[var(--bg-void)] p-0.5 rounded-lg border border-[var(--border-line)]">
      <button
        type="button"
        onclick={() => (activeTab = "home")}
        class="flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md transition-all cursor-pointer border
               {activeTab === 'home'
                 ? 'bg-[var(--surface-panel)] text-[var(--accent-cyan)] border-[var(--accent-cyan)]/40 shadow-[0_0_8px_var(--accent-cyan-glow)]'
                 : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] border-transparent'}"
      >
        <Zap size={12} />
        Home
      </button>
      <button
        type="button"
        onclick={() => (activeTab = "settings")}
        class="flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md transition-all cursor-pointer border
               {activeTab === 'settings'
                 ? 'bg-[var(--surface-panel)] text-[var(--accent-amber)] border-[var(--accent-amber)]/40 shadow-[0_0_8px_var(--accent-amber-glow)]'
                 : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] border-transparent'}"
      >
        <SettingsIcon size={12} />
        Config
      </button>
    </div>
  </header>

  <!-- Main View Area -->
  <div class="flex-1 overflow-y-auto custom-scrollbar p-3 flex flex-col gap-2.5 min-h-0 relative">
    {#if activeTab === "home"}
      <!-- ── SECTION 1: Pipeline Switcher ── -->
      <section class="panel-card !p-2 flex flex-col gap-2">
        <div class="flex items-center justify-between">
          <span class="kicker">Translation pipeline</span>
          {#if currentMode === "webgpu"}
            <span class="text-xs text-[var(--accent-amber)] font-medium">Offline · WebLLM</span>
          {:else if currentMode === "gemini"}
            <span class="text-xs text-[var(--accent-emerald)] font-medium">Cloud · Gemini</span>
          {:else}
            <span class="text-xs text-[var(--accent-cyan)] font-medium">Self-hosted · API</span>
          {/if}
        </div>

        <!-- 3-Segment Mode Pill -->
        <div class="grid grid-cols-3 gap-1 bg-[var(--bg-void)] p-1 rounded-lg border border-[var(--border-line)]">
          {#each MODES as m}
            <button
              type="button"
              onclick={() => setMode(m.id)}
              aria-pressed={currentMode === m.id}
              class="flex flex-col items-center justify-center py-1.5 px-1 rounded-md transition-all cursor-pointer text-center border
                     {currentMode === m.id
                       ? (m.id === 'webgpu'
                           ? 'bg-[var(--surface-panel)] text-[var(--accent-amber)] font-semibold border-[var(--accent-amber)]/40 shadow-[0_0_8px_var(--accent-amber-glow)]'
                           : m.id === 'gemini'
                             ? 'bg-[var(--surface-panel)] text-[var(--accent-emerald)] font-semibold border-[var(--accent-emerald)]/40 shadow-[0_0_8px_var(--accent-emerald-glow)]'
                             : 'bg-[var(--surface-panel)] text-[var(--accent-cyan)] font-semibold border-[var(--accent-cyan)]/40 shadow-[0_0_8px_var(--accent-cyan-glow)]')
                       : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] border-transparent'}"
            >
              <span class="text-xs">{m.label}</span>
              <span class="text-[10px] text-[var(--text-dim)]">{m.desc}</span>
            </button>
          {/each}
        </div>

        <!-- Mode Status Alert / Downloader -->
        {#if currentMode === "webgpu"}
          {#if !cachedLlms.includes(llmModel)}
            <div class="p-2 rounded-[4px] bg-[var(--accent-amber-soft)] border border-[var(--accent-amber)]/40 flex items-center justify-between gap-2">
              <div class="flex items-center gap-1.5 min-w-0">
                <TriangleAlert size={13} class="text-[var(--accent-amber)] shrink-0" />
                <span class="text-[10px] text-[var(--accent-amber)] truncate font-medium">Model {llmModel} not downloaded</span>
              </div>
              <button
                type="button"
                onclick={() => openSetupTab(llmModel)}
                class="inline-flex items-center gap-1 px-2 py-0.5 rounded-[3px] bg-[var(--accent-amber)] hover:opacity-90 text-[#05040b] text-[10px] font-bold font-display cursor-pointer shrink-0"
              >
                <Download size={10} />
                Get
              </button>
            </div>
          {:else}
            <div class="flex items-center justify-between text-xs text-[var(--text-dim)] px-1">
              <span>Active: {llmModel}</span>
              <span class="text-[var(--accent-emerald)] font-medium">Ready</span>
            </div>
          {/if}
        {:else if currentMode === "gemini"}
          <div class="flex items-center justify-between text-xs text-[var(--text-dim)] px-1">
            <span>Model: {geminiModel}</span>
            <span class="{geminiKey ? 'text-[var(--accent-emerald)] font-medium' : 'text-[var(--accent-amber)] font-medium'}">
              {geminiKey ? "Key set" : "Needs key"}
            </span>
          </div>
        {:else}
          <div class="flex items-center justify-between text-xs text-[var(--text-dim)] px-1 truncate">
            <span class="truncate">{serverHost}</span>
            <span class="shrink-0 text-[var(--accent-cyan)] font-medium">API</span>
          </div>
        {/if}
      </section>

      <!-- ── SECTION 2: Language Matrix ── -->
      <section class="panel-card !p-2 flex flex-col gap-1.5 relative">
        <span class="kicker">Language pair</span>

        <div class="flex items-center justify-between gap-1.5 bg-[var(--bg-void)] p-1.5 rounded-lg border border-[var(--border-faint)]">
          <!-- Source Lang -->
          <button
            type="button"
            onclick={(e) => {
              e.stopPropagation();
              activeDropdown = activeDropdown === "source" ? null : "source";
              searchQuery = "";
            }}
            class="flex-1 flex items-center justify-between px-2 py-1.5 bg-[var(--surface-panel)] border border-[var(--border-line)] rounded-lg text-xs font-medium hover:border-[var(--accent-cyan)]/60 transition-colors cursor-pointer"
          >
            <span class="truncate">{sourceLang}</span>
            <ChevronDown size={11} class="text-[var(--text-dim)] shrink-0 ml-1" />
          </button>

          <!-- Swap Button -->
          <button
            type="button"
            onclick={swapLanguages}
            title="Swap Source ⇄ Target"
            class="p-1.5 rounded-lg bg-[var(--surface-panel)] border border-[var(--border-line)] hover:border-[var(--accent-cyan)]/60 text-[var(--text-dim)] hover:text-[var(--accent-cyan)] transition-colors cursor-pointer shrink-0"
          >
            <ArrowRightLeft size={12} />
          </button>

          <!-- Target Lang -->
          <button
            type="button"
            onclick={(e) => {
              e.stopPropagation();
              activeDropdown = activeDropdown === "target" ? null : "target";
              searchQuery = "";
            }}
            class="flex-1 flex items-center justify-between px-2 py-1.5 bg-[var(--surface-panel)] border border-[var(--border-line)] rounded-lg text-xs font-medium hover:border-[var(--accent-cyan)]/60 transition-colors cursor-pointer"
          >
            <span class="truncate">{targetLang}</span>
            <ChevronDown size={11} class="text-[var(--text-dim)] shrink-0 ml-1" />
          </button>
        </div>

        <!-- Dropdown Popover -->
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
            <div class="max-h-40 overflow-y-auto p-1 custom-scrollbar space-y-0.5">
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
      </section>

      <!-- ── SECTION 3: Quick toggles (2x2 Grid) ── -->
      <section class="grid grid-cols-2 gap-2">
        <!-- Auto Translate -->
        <div class="panel-card !p-2 flex flex-col justify-between gap-1.5">
          <div class="flex items-center justify-between">
            <span class="text-xs font-medium">Auto-translate</span>
            <label class="switch-cyber is-emerald">
              <input type="checkbox" bind:checked={autoTranslate} />
              <span class="track"><span class="thumb"></span></span>
            </label>
          </div>
          <span class="text-[11px] text-[var(--text-muted)] leading-tight">
            {autoTranslate ? `1 page/queue (${autoTranslateConcurrency} max)` : "Disabled (manual hover)"}
          </span>
        </div>

        <!-- Skip Bbox Editor -->
        <div class="panel-card !p-2 flex flex-col justify-between gap-1.5">
          <div class="flex items-center justify-between">
            <span class="text-xs font-medium">Direct flow</span>
            <label class="switch-cyber is-amber">
              <input type="checkbox" bind:checked={skipBboxRefining} />
              <span class="track"><span class="thumb"></span></span>
            </label>
          </div>
          <span class="text-[11px] text-[var(--text-muted)] leading-tight">
            {skipBboxRefining ? "Skip box refinement" : "Review boxes first"}
          </span>
        </div>

        <!-- Inpaint Method -->
        <div class="panel-card !p-2 flex flex-col justify-between gap-1.5">
          <div class="flex items-center justify-between">
            <span class="text-xs font-medium">Inpaint</span>
            <button
              type="button"
              onclick={() => (inpaintMethod = inpaintMethod === "fast" ? "quality" : "fast")}
              aria-pressed={inpaintMethod === "quality"}
              class="text-[11px] font-medium px-2 py-0.5 rounded-md border cursor-pointer transition-colors
                     {inpaintMethod === 'quality'
                       ? 'bg-[var(--accent-emerald-soft)] border-[var(--accent-emerald)]/40 text-[var(--accent-emerald)]'
                       : 'border-[var(--border-line)] text-[var(--text-dim)] hover:text-[var(--text-primary)]'}"
            >
              {inpaintMethod === "quality" ? "Quality" : "Fast"}
            </button>
          </div>
          <span class="text-[11px] text-[var(--text-dim)] leading-tight">
            {inpaintMethod === "quality" ? "Neural redraw behind text" : "Fast edge-blend fill"}
          </span>
        </div>

        <!-- Detection Engine -->
        <div class="panel-card !p-2 flex flex-col justify-between gap-1.5">
          <div class="flex items-center justify-between">
            <span class="text-xs font-medium">Detector</span>
            <span class="text-[11px] text-[var(--text-dim)]">{detectionModel}</span>
          </div>
          <span class="text-[11px] text-[var(--text-dim)] leading-tight truncate">
            {DefaultConfig.detectionModels.find((m) => m.id === detectionModel)?.desc || "text detector"}
          </span>
        </div>
      </section>

      <!-- ── SECTION 4: Active Site & Series Quick Context ── -->
      <section class="panel-card !p-2 flex flex-col gap-1.5">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-1.5 min-w-0">
            <span class="badge-cyber is-cyan shrink-0">{ruleId || "Site"}</span>
            <span class="text-xs font-medium truncate">{seriesName}</span>
          </div>
          <button
            type="button"
            onclick={() => (showContextDrawer = !showContextDrawer)}
            class="text-xs text-[var(--text-dim)] hover:text-[var(--accent-cyan)] cursor-pointer shrink-0 transition-colors"
          >
            {showContextDrawer ? "Hide glossary" : "Glossary ▾"}
          </button>
        </div>

        {#if showContextDrawer}
          <div class="pt-1.5 border-t border-[var(--border-faint)] flex flex-col gap-1.5">
            <input
              type="text"
              bind:value={seriesContext.seriesName}
              placeholder="Series title override..."
              class="w-full bg-[var(--bg-void)] border border-[var(--border-faint)] rounded-lg px-2 py-1 text-xs outline-none focus:border-[var(--border-line)] placeholder:text-[var(--text-dim)]"
            />
            <textarea
              bind:value={seriesContext.dictionary}
              placeholder="Character glossary (e.g. Kuro -> Black)..."
              rows={2}
              class="w-full bg-[var(--bg-void)] border border-[var(--border-faint)] rounded-lg p-1.5 text-xs outline-none resize-none focus:border-[var(--border-line)] placeholder:text-[var(--text-dim)]"
            ></textarea>
          </div>
        {/if}
      </section>

    {:else if activeTab === "settings"}
      <!-- ── CONFIGURATION TAB (Dense, modular settings) ── -->
      <div class="flex flex-col gap-3">
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

        <div class="panel-card !p-2.5">
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

        <InpaintSettings bind:inpaintMethod />

        <GpuAccelerationPanel />

        <TypographySettings bind:textFont bind:customFonts />

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

        <!-- Re-run setup wizard button -->
        <button
          type="button"
          onclick={() => openSetupTab()}
          class="btn-ghost w-full justify-center py-2 text-xs font-medium"
        >
          <Compass size={14} />
          Launch first-run setup wizard
        </button>
      </div>
    {/if}
  </div>

  <!-- Bottom status strip -->
  <footer class="px-3.5 py-2 border-t border-[var(--border-line)] shrink-0 flex items-center justify-between text-[11px] text-[var(--text-dim)] bg-[var(--bg-void)]">
    <div class="flex items-center gap-1.5 min-w-0">
      {#if loadingSettings}
        <span class="w-1.5 h-1.5 rounded-full bg-[var(--accent-cyan)] animate-pulse shrink-0" title="Loading settings"></span>
      {/if}
      <span class="truncate">Hover an image to translate</span>
    </div>
    <span class="text-[var(--text-muted)] truncate max-w-[120px]">{seriesName}</span>
  </footer>
</main>
