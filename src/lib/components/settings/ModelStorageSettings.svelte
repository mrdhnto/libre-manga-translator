<script lang="ts">
  import { onMount } from "svelte";
  import {
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
    Inpaint: "bg-[var(--accent-rose-soft)] text-[var(--accent-rose)] border border-[var(--accent-rose)]/30",
    Detection: "bg-[var(--accent-cyan-soft)] text-[var(--accent-cyan)] border border-[var(--accent-cyan)]/30",
    OCR: "bg-[var(--accent-emerald-soft)] text-[var(--accent-emerald)] border border-[var(--accent-emerald)]/30",
    LLM: "bg-[var(--accent-amber-soft)] text-[var(--accent-amber)] border border-[var(--accent-amber)]/30",
    "Script Gate": "bg-[var(--surface-panel)] text-[var(--text-muted)] border border-[var(--border-line)]",
    Other: "bg-[var(--surface-panel)] text-[var(--text-dim)] border border-[var(--border-line)]",
  };
</script>

<div class="space-y-3">
  <!-- Downloaded Models Storage Manager -->
  <div class="space-y-1.5">
    <div class="flex items-center justify-between ml-0.5">
      <span class="kicker">
        Offline model cache
      </span>
      <button
        onclick={loadCachedModels}
        disabled={loading}
        title="Refresh storage"
        class="p-1 text-[var(--text-dim)] hover:text-[var(--text-primary)] rounded cursor-pointer transition-colors"
      >
        <RefreshCw size={12} class={loading ? "animate-spin" : ""} />
      </button>
    </div>

    <div class="panel-card !p-2.5 space-y-2.5">
      <div class="flex items-center justify-between text-xs pb-2 border-b border-[var(--border-faint)]">
        <div class="flex items-center gap-1.5 font-medium text-[var(--text-muted)]">
          <HardDrive size={13} class="text-[var(--text-dim)]" />
          <span class="text-[11px]">Storage Used:</span>
          <span class="font-mono font-bold text-[var(--text-primary)] text-[11px]">
            {formatBytes(totalBytes)}
          </span>
        </div>
        {#if items.length > 0}
          {#if showClearConfirm}
            <div class="flex items-center gap-1.5">
              <button
                onclick={clearAll}
                disabled={clearingAll}
                class="px-2 py-0.5 text-[10px] bg-rose-600 text-white font-semibold rounded-[2px] hover:bg-rose-500 cursor-pointer"
              >
                {clearingAll ? "Clearing..." : "Confirm Clear"}
              </button>
              <button
                onclick={() => (showClearConfirm = false)}
                class="px-1.5 py-0.5 text-[10px] text-[var(--text-dim)] hover:text-[var(--text-primary)] cursor-pointer"
              >
                Cancel
              </button>
            </div>
          {:else}
            <button
              onclick={() => (showClearConfirm = true)}
              class="text-[10px] text-rose-400 hover:text-rose-300 font-medium cursor-pointer transition-colors"
            >
              Clear All
            </button>
          {/if}
        {/if}
      </div>

      {#if loading && items.length === 0}
        <div class="flex items-center justify-center py-6 gap-2 text-[var(--text-muted)] text-xs font-mono">
          <LoaderCircle size={14} class="animate-spin text-cyan-400" />
          Scanning local cache…
        </div>
      {:else if items.length === 0}
        <div class="text-center py-6 text-[var(--text-dim)] text-xs font-mono">
          No model weights stored in cache.
        </div>
      {:else}
        <div class="space-y-1.5 max-h-72 overflow-y-auto custom-scrollbar pr-1">
          {#each items as item}
            <div
              class="flex items-center justify-between p-2 rounded-[3px] border border-[var(--border-faint)] bg-[var(--bg-void)] text-xs"
            >
              <div class="min-w-0 pr-2">
                <div class="flex items-center gap-1.5">
                  <span class="font-display font-medium text-[var(--text-primary)] truncate">
                    {item.name}
                  </span>
                </div>
                <div class="text-[10px] font-mono text-[var(--text-muted)] mt-0.5">
                  <span
                    class="text-[9px] font-semibold px-1.5 py-0.2 rounded {categoryBadgeClasses[item.category] ?? categoryBadgeClasses.Other}"
                  >
                    {item.category}
                  </span>
                  {#if getLangBadge(item)}
                    <span
                      class="text-[9px] font-semibold px-1.5 py-0.2 rounded bg-[var(--accent-cyan-soft)] text-[var(--accent-cyan)] border border-[var(--accent-cyan)]/30"
                      title="PaddleOCR language group"
                    >
                      {getLangBadge(item)}
                    </span>
                  {/if}
                  {formatBytes(item.size)}
                </div>
              </div>

              <button
                onclick={() => deleteItem(item)}
                disabled={deletingId === item.id}
                title="Delete this model from cache"
                class="p-1.5 text-[var(--text-dim)] hover:text-[var(--accent-rose)] hover:bg-[var(--accent-rose-soft)] rounded-lg transition-colors cursor-pointer shrink-0 disabled:opacity-50"
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
