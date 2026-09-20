<script lang="ts">
  import { getDebugLogs, clearDebugLogs } from "@/entrypoints/content/debug";
  import { Check, Copy, Download, LoaderCircle, RefreshCw, Trash2 } from "lucide-svelte";

  const DEBUG_ENABLED_KEY = "local:debug-enabled";

  let logs = $state<DebugEntry[]>([]);
  let loading = $state(false);
  let copied = $state(false);
  let copiedId = $state<string | null>(null);
  let expandedId = $state<string | null>(null);
  let debugEnabled = $state(false);
  let togglingEnabled = $state(false);

  async function loadLogs() {
    loading = true;
    try {
      logs = await getDebugLogs();
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    (async () => {
      debugEnabled = (await storage.getItem<boolean>(DEBUG_ENABLED_KEY)) ?? false;
      loadLogs();
    })();
  });

  async function toggleEnabled() {
    togglingEnabled = true;
    debugEnabled = !debugEnabled;
    await storage.setItem(DEBUG_ENABLED_KEY, debugEnabled);
    togglingEnabled = false;
  }

  async function handleClear() {
    await clearDebugLogs();
    logs = [];
  }

  function handleCopy() {
    navigator.clipboard.writeText(JSON.stringify(logs, null, 2));
    copied = true;
    setTimeout(() => (copied = false), 2000);
  }

  function handleCopyOne(id: string) {
    const log = logs.find((l) => l.id === id);
    if (!log) return;
    navigator.clipboard.writeText(JSON.stringify(log, null, 2));
    copiedId = id;
    setTimeout(() => (copiedId = null), 2000);
  }

  function handleExport() {
    const blob = new Blob([JSON.stringify(logs, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `lmt-debug-logs-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function formatTime(ts: number): string {
    return new Date(ts).toLocaleTimeString();
  }

  function formatDuration(ms?: number): string {
    if (ms === undefined) return "-";
    if (ms < 1000) return `${Math.round(ms)}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  }
</script>

<!-- Enable toggle row -->
<div
  class="flex items-center justify-between p-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50"
>
  <div class="flex flex-col gap-0.5">
    <span class="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
      Enable Debug Logging
    </span>
    <span class="text-[10px] text-zinc-400">
      {debugEnabled ? "Capturing translation data" : "Not recording - enable to start"}
    </span>
  </div>
  <button
    onclick={toggleEnabled}
    disabled={togglingEnabled}
    class="relative shrink-0 cursor-pointer disabled:opacity-50"
    aria-label={debugEnabled ? "Disable debug logging" : "Enable debug logging"}
  >
    <div
      class="w-10 h-6 rounded-full transition-colors duration-200 {debugEnabled
        ? 'bg-blue-500'
        : 'bg-zinc-300 dark:bg-zinc-600'}"
    ></div>
    <div
      class="absolute top-1 left-1 w-4 h-4 bg-white rounded-full shadow transition-transform duration-200 {debugEnabled
        ? 'translate-x-4'
        : 'translate-x-0'}"
    ></div>
  </button>
</div>

<!-- Log list header -->
<div class="flex items-center justify-between mt-4 mb-2">
  <span class="text-[10px] font-bold uppercase tracking-widest text-zinc-500">
    Logs ({logs.length}{logs.length === 50 ? ", max" : ""})
  </span>
  <div class="flex items-center gap-1">
    <button
      onclick={loadLogs}
      disabled={loading}
      class="p-1 text-zinc-400 hover:text-blue-500 rounded cursor-pointer transition-colors"
      title="Refresh"
    >
      <RefreshCw size={12} class={loading ? "animate-spin" : ""} />
    </button>
    {#if logs.length > 0}
      <button
        onclick={handleCopy}
        class="p-1 text-zinc-400 hover:text-blue-500 rounded cursor-pointer transition-colors"
        title="Copy JSON"
      >
        {#if copied}<Check size={12} class="text-emerald-500" />{:else}<Copy size={12} />{/if}
      </button>
      <button
        onclick={handleExport}
        class="p-1 text-zinc-400 hover:text-blue-500 rounded cursor-pointer transition-colors"
        title="Export JSON"
      >
        <Download size={12} />
      </button>
      <button
        onclick={handleClear}
        class="p-1 text-zinc-400 hover:text-red-500 rounded cursor-pointer transition-colors"
        title="Clear logs"
      >
        <Trash2 size={12} />
      </button>
    {/if}
  </div>
</div>

<!-- Log entries -->
<div class="space-y-2">
  {#if logs.length === 0}
    <div class="text-center py-6 text-xs text-zinc-400 italic">
      {#if debugEnabled}
        No logs yet. Translate a page to capture data.
      {:else}
        Debug logging is disabled. Enable above to start capturing.
      {/if}
    </div>
  {:else}
    {#each logs as log (log.id)}
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="p-2 bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg text-xs cursor-pointer hover:border-zinc-300 dark:hover:border-zinc-700 transition-all"
        onclick={() => (expandedId = expandedId === log.id ? null : log.id)}
      >
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-1.5 font-medium">
            <span
              class="w-2 h-2 rounded-full shrink-0 {log.success
                ? 'bg-emerald-500'
                : 'bg-red-500'}"
            ></span>
            <span class="font-mono text-[10px] text-zinc-400">
              {formatTime(log.timestamp)}
            </span>
            <span
              class="px-1.5 rounded text-[10px] font-bold uppercase
              {log.mode === 'gemini'
                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                : log.mode === 'api'
                  ? 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300'
                  : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'}"
            >
              {log.mode}
            </span>
          </div>
          <div class="flex items-center gap-1.5 text-[10px] text-zinc-400 font-mono">
            <button
              onclick={(e) => {
                e.stopPropagation();
                handleCopyOne(log.id);
              }}
              class="p-1 text-zinc-400 hover:text-blue-500 rounded cursor-pointer transition-colors"
              title="Copy this entry as JSON"
              aria-label="Copy entry JSON"
            >
              {#if copiedId === log.id}
                <Check size={12} class="text-emerald-500" />
              {:else}
                <Copy size={12} />
              {/if}
            </button>
            <span>{log.bboxCount}b</span>
            <span>{formatDuration(log.timing?.total)}</span>
          </div>
        </div>

        {#if log.error}
          <div class="mt-1 text-[10px] text-red-500 font-mono truncate">
            {log.error}
          </div>
        {/if}

        {#if expandedId === log.id}
          <div
            class="mt-2 pt-2 border-t border-zinc-100 dark:border-zinc-800 space-y-2"
          >
            <div class="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px] font-mono text-zinc-500">
              <div>{log.sourceLang} → {log.targetLang}</div>
              <div>Total: {formatDuration(log.timing?.total)}</div>
              {#if log.timing?.detect}
                <div>Detect: {formatDuration(log.timing.detect)}</div>
              {/if}
              {#if log.timing?.ocr}
                <div>OCR: {formatDuration(log.timing.ocr)}</div>
              {/if}
              {#if log.timing?.translate}
                <div>Translate: {formatDuration(log.timing.translate)}</div>
              {/if}
              {#if log.timing?.inpaint}
                <div>Inpaint: {formatDuration(log.timing.inpaint)}</div>
              {/if}
            </div>

            <!-- Models & pipeline metadata -->
            <div class="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px] font-mono text-zinc-400">
              {#if log.models?.detection}
                <div class="flex items-center gap-1">
                  <span class="text-zinc-500 uppercase">Det:</span>
                  <span title="{log.models.detection}">{log.models.detection}</span>
                </div>
              {/if}
              {#if log.models?.ocr}
                <div class="flex items-center gap-1 truncate">
                  <span class="text-zinc-500 uppercase">OCR:</span>
                  <span title="{log.models.ocr}">{log.models.ocr}</span>
                </div>
              {/if}
              {#if log.models?.llm}
                <div class="flex items-center gap-1 truncate">
                  <span class="text-zinc-500 uppercase">LLM:</span>
                  <span title="{log.models.llm}">{log.models.llm}</span>
                </div>
              {/if}
              {#if log.models?.server}
                <div class="flex items-center gap-1 truncate">
                  <span class="text-zinc-500 uppercase">Srv:</span>
                  <span title="{log.models.server}">{log.models.server}</span>
                </div>
              {/if}
              {#if log.inpaintMethod}
                <div class="flex items-center gap-1">
                  <span class="text-zinc-500 uppercase">Inpaint:</span>
                  <span>{log.inpaintMethod}</span>
                </div>
              {/if}
              {#if log.inpaintStats}
                <div
                  class="col-span-2 text-[10px] font-mono text-zinc-500"
                  title="fill · denoise · lama · telea · rect-telea · declined · skipped"
                >
                  {log.inpaintStats.fill} fill ·
                  {log.inpaintStats.denoise} denoise ·
                  {#if (log.inpaintStats as any).lama}
                    {(log.inpaintStats as any).lama} lama ·
                  {/if}
                  {log.inpaintStats.telea} telea ·
                  {log.inpaintStats.rectTelea} rect
                  {#if log.inpaintStats.declined}
                    · <span class="text-red-400">{log.inpaintStats.declined} declined</span>
                  {/if}
                  {#if log.inpaintStats.skipped}
                    · {log.inpaintStats.skipped} skipped
                  {/if}
                </div>
              {/if}
              {#if log.inpaintError}
                <div class="col-span-2 text-[10px] font-mono text-red-400 truncate" title="{log.inpaintError}">
                  Inpaint err: {log.inpaintError}
                </div>
              {/if}
              {#if log.gate}
                <div
                  class="col-span-2 text-[10px] font-mono text-zinc-500"
                  title="mode · regions checked · regions held back · language group"
                >
                  Gate: {log.gate.mode} · {log.gate.checked} checked ·
                  <span class:text-amber-500={log.gate.skipped > 0}>
                    {log.gate.skipped} skipped
                  </span>
                  {#if log.gate.group}· {log.gate.group}{/if}
                  {#if log.gate.unavailable}
                    · <span class="text-red-400">model unavailable - text-only</span>
                  {/if}
                </div>
              {/if}
              {#if log.langGroup}
                <div>
                  <span class="text-zinc-500 uppercase">Group:</span> {log.langGroup}
                </div>
              {/if}
              {#if log.version || log.device || log.backend}
                <div class="col-span-2 flex items-center gap-1.5 flex-wrap">
                  {log.version}{#if log.device} · {log.device}{/if}
                  {#if log.backend}
                    <span
                      class="px-1.5 rounded text-[9px] font-bold uppercase
                      {log.backend === 'webgpu'
                        ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                        : 'bg-zinc-200 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300'}"
                    >
                      {log.backend}
                    </span>
                  {/if}
                </div>
              {/if}
            </div>

            {#if log.sourceTexts && log.sourceTexts.length > 0}
              <div>
                <div class="text-[10px] font-bold uppercase text-zinc-400 mb-0.5">
                  OCR Source
                </div>
                <div class="space-y-0.5 max-h-20 overflow-y-auto custom-scrollbar">
                  {#each log.sourceTexts as txt, i}
                    <div class="font-mono text-[10px] text-zinc-600 dark:text-zinc-400 truncate">
                      <strong class="text-zinc-400">#{i + 1}:</strong>
                      {txt || "(empty)"}
                    </div>
                  {/each}
                </div>
              </div>
            {/if}

            {#if log.translations && log.translations.length > 0}
              <div>
                <div class="text-[10px] font-bold uppercase text-zinc-400 mb-0.5">
                  Translations
                </div>
                <div class="space-y-0.5 max-h-20 overflow-y-auto custom-scrollbar">
                  {#each log.translations as txt, i}
                    <div class="font-mono text-[10px] text-zinc-600 dark:text-zinc-400 truncate">
                      <strong class="text-zinc-400">#{i + 1}:</strong> {txt}
                    </div>
                  {/each}
                </div>
              </div>
            {/if}
          </div>
        {/if}
      </div>
    {/each}
  {/if}
</div>
