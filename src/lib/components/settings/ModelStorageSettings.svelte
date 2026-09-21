<script lang="ts">
  import { onMount } from "svelte";
  import { openSetupTab } from "@/lib/utils";
  import {
    Compass,
    HardDrive,
    LoaderCircle,
    RefreshCw,
    Trash2,
    Check,
    AlertTriangle,
  } from "lucide-svelte";

  interface CachedModelItem {
    id: string;
    name: string;
    category: "LLM" | "Detection" | "OCR" | "Inpaint" | "Script Gate" | "Other";
    size: number;
    cacheName: string;
    url: string;
    isLlm: boolean;
  }

  let items = $state<CachedModelItem[]>([]);
  let loading = $state(true);
  let deletingId = $state<string | null>(null);
  let clearingAll = $state(false);
  let showClearConfirm = $state(false);

  function formatBytes(bytes: number): string {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
  }

  const totalBytes = $derived(
    items.reduce((acc, item) => acc + (item.size || 0), 0),
  );

  /**
   * PaddleOCR rec/dict URLs look like
   * `…/resolve/main/languages/<group>/rec.onnx` — the parent folder is the
   * language group the pack represents. Returns it, or null so the template
   * can fall back to the model name for non-PaddleOCR items.
   */
  function getLangBadge(item: CachedModelItem): string | null {
    const match = item.url.match(/languages\/([^/]+)\//);
    return match ? match[1] : null;
  }

  async function loadCachedModels() {
    loading = true;
    try {
      const res = (await browser.runtime.sendMessage({
        type: "LIST_CACHED_MODELS",
      })) as CachedModelItem[];
      items = Array.isArray(res) ? res : [];
    } catch (err) {
      console.warn("Failed to list cached models:", err);
      items = [];
    } finally {
      loading = false;
    }
  }

  async function deleteItem(item: CachedModelItem) {
    deletingId = item.id;
    try {
      await browser.runtime.sendMessage({
        type: "DELETE_CACHED_MODEL",
        data: {
          isLlm: item.isLlm,
          modelId: item.url,
          cacheName: item.cacheName,
          url: item.url,
        },
      });
      await loadCachedModels();
    } catch (err) {
      console.warn("Failed to delete cached model:", err);
    } finally {
      deletingId = null;
    }
  }

  async function clearAll() {
    clearingAll = true;
    showClearConfirm = false;
    try {
      await browser.runtime.sendMessage({
        type: "CLEAR_ALL_CACHED_MODELS",
      });
      await loadCachedModels();
    } catch (err) {
      console.warn("Failed to clear all cached models:", err);
    } finally {
      clearingAll = false;
    }
  }

  onMount(() => {
    loadCachedModels();
  });

  const categoryBadgeClasses: Record<string, string> = {
    Inpaint: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300",
    Detection: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
    OCR: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
    LLM: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
    "Script Gate": "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
    Other: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
  };
</script>

<div class="space-y-4">
  <!-- Retrigger Onboarding Card -->
  <div>
    <span class="text-sm font-bold uppercase tracking-widest text-zinc-500 ml-1">
      Setup &amp; Onboarding
    </span>
    <div
      class="bg-zinc-50 dark:bg-zinc-900/50 p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 mt-2 flex flex-col"
      style="flex-flow: column; gap: 6px;"
    >
      <div>
        <div class="flex items-center gap-2 mb-1">
          <Compass size={16} class="text-blue-500" />
          <span class="text-xs font-bold text-zinc-800 dark:text-zinc-200">
            Setup Wizard
          </span>
        </div>
        <p class="text-[11px] text-zinc-500 dark:text-zinc-400 leading-snug">
          Re-run the initial onboarding flow to configure detection, OCR, inpainting, and translation backends step-by-step.
        </p>
      </div>
      <button
        type="button"
        onclick={() => openSetupTab()}
        class="w-full px-3 py-1.5 text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white rounded-lg shadow-sm transition-all cursor-pointer whitespace-nowrap text-center"
        style="width: -webkit-fill-available;"
      >
        Launch Wizard
      </button>
    </div>
  </div>

  <!-- Downloaded Models Storage Manager -->
  <div>
    <div class="flex items-center justify-between ml-1">
      <span class="text-sm font-bold uppercase tracking-widest text-zinc-500">
        Downloaded Models
      </span>
      <div class="flex items-center gap-1">
        <button
          onclick={loadCachedModels}
          disabled={loading}
          title="Refresh storage"
          class="p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors cursor-pointer"
        >
          <RefreshCw size={13} class={loading ? "animate-spin" : ""} />
        </button>
      </div>
    </div>

    <div
      class="bg-zinc-50 dark:bg-zinc-900/50 p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 mt-2 space-y-3"
    >
      <div class="flex items-center justify-between text-xs pb-2 border-b border-zinc-200 dark:border-zinc-800">
        <div class="flex items-center gap-1.5 font-medium text-zinc-700 dark:text-zinc-300">
          <HardDrive size={14} class="text-zinc-400" />
          <span>Used Offline Storage:</span>
          <span class="font-mono font-bold text-zinc-900 dark:text-zinc-100">
            {formatBytes(totalBytes)}
          </span>
        </div>
        {#if items.length > 0}
          {#if showClearConfirm}
            <div class="flex items-center gap-1.5">
              <button
                onclick={clearAll}
                disabled={clearingAll}
                class="px-2 py-0.5 text-[10px] bg-red-600 text-white font-semibold rounded hover:bg-red-500 cursor-pointer"
              >
                {clearingAll ? "Clearing..." : "Confirm Clear"}
              </button>
              <button
                onclick={() => (showClearConfirm = false)}
                class="px-1.5 py-0.5 text-[10px] text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 cursor-pointer"
              >
                Cancel
              </button>
            </div>
          {:else}
            <button
              onclick={() => (showClearConfirm = true)}
              class="text-[10px] text-red-500 hover:text-red-600 font-medium cursor-pointer transition-colors"
            >
              Clear All
            </button>
          {/if}
        {/if}
      </div>

      {#if loading && items.length === 0}
        <div class="flex items-center justify-center py-6 gap-2 text-zinc-400 text-xs">
          <LoaderCircle size={16} class="animate-spin" />
          Scanning local cache...
        </div>
      {:else if items.length === 0}
        <div class="text-center py-6 text-zinc-400 dark:text-zinc-500 text-xs">
          No model weights currently stored in local browser cache.
        </div>
      {:else}
        <div class="space-y-2 max-h-72 overflow-y-auto custom-scrollbar pr-1">
          {#each items as item}
            <div
              class="flex items-center justify-between p-2.5 rounded-lg border border-zinc-200/80 dark:border-zinc-800 bg-white dark:bg-zinc-950 text-xs shadow-xs"
            >
              <div class="min-w-0 pr-2">
                <div class="flex items-center gap-1.5">
                  <span class="font-medium text-zinc-800 dark:text-zinc-200 truncate">
                    {item.name}
                  </span>
                </div>
                <div class="text-[10px] font-mono text-zinc-400 mt-0.5">
                  <span
                    class="text-[9px] font-semibold px-1.5 py-0.2 rounded {categoryBadgeClasses[item.category] ?? categoryBadgeClasses.Other}"
                  >
                    {item.category}
                  </span>
                  <!-- parent folder name (eg. language, ocr name as fallback) -->
                  {#if getLangBadge(item)}
                    <span
                      class="text-[9px] font-semibold px-1.5 py-0.2 rounded bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300"
                      title="PaddleOCR language group"
                    >
                      {getLangBadge(item)}
                    </span>
                  {:else}
                    <span
                      class="text-[9px] font-semibold px-1.5 py-0.2 rounded bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
                    >
                      {item.name}
                    </span>
                  {/if}
                  {formatBytes(item.size)}
                </div>
              </div>

              <button
                onclick={() => deleteItem(item)}
                disabled={deletingId === item.id}
                title="Delete this model from cache"
                class="p-1.5 text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors cursor-pointer shrink-0 disabled:opacity-50"
              >
                {#if deletingId === item.id}
                  <LoaderCircle size={14} class="animate-spin text-red-500" />
                {:else}
                  <Trash2 size={14} />
                {/if}
              </button>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  </div>
</div>
