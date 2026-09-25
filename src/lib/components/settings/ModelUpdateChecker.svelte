<script lang="ts">
  import {
    ArrowDownToLine,
    Check,
    Download,
    LoaderCircle,
    RefreshCw,
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

  interface UpdateItem extends CachedModelItem {
    error?: string;
  }

  let updates = $state<UpdateItem[]>([]);
  let checking = $state(false);
  let updatingId = $state<string | null>(null);
  let updatingAll = $state(false);
  let hasChecked = $state(false);
  let checkError = $state<string | null>(null);
  let checkedCount = $state(0);
  let lastChecked = $state<string | null>(null);

  function formatBytes(bytes: number): string {
    if (!bytes) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
  }

  function getLangBadge(item: CachedModelItem): string | null {
    const match = item.url.match(/languages\/([^/]+)\//);
    return match ? match[1] : null;
  }

  async function checkForUpdates() {
    if (checking || updatingAll || updatingId) return;
    checking = true;
    checkError = null;
    try {
      // Names/sizes come from the list call; the check call returns only
      // { cacheName, url } for stale entries. Join the two.
      const listed = (await browser.runtime.sendMessage({
        type: "LIST_CACHED_MODELS",
      })) as CachedModelItem[];
      const cached = (Array.isArray(listed) ? listed : []).filter((m) => !m.isLlm);
      const byKey = new Map(cached.map((m) => [`${m.cacheName}::${m.url}`, m]));

      const res = (await browser.runtime.sendMessage({
        type: "CHECK_MODEL_UPDATES",
      })) as { updates: { cacheName: string; url: string }[]; checked: number; skipped: string[] };

      checkedCount = res?.checked ?? 0;
      const stale = Array.isArray(res?.updates) ? res.updates : [];
      updates = stale.flatMap((u) => {
        const full = byKey.get(`${u.cacheName}::${u.url}`);
        return full ? [{ ...full }] : [];
      });
      hasChecked = true;
      lastChecked = new Date().toLocaleTimeString();
    } catch (err) {
      checkError = (err as Error)?.message ?? String(err);
      hasChecked = true;
    } finally {
      checking = false;
    }
  }

  async function updateOne(item: UpdateItem) {
    if (updatingId || updatingAll) return;
    updatingId = item.id;
    try {
      const res = await browser.runtime.sendMessage({
        type: "UPDATE_CACHED_MODEL",
        data: { cacheName: item.cacheName, url: item.url },
      });
      if (res?.error) throw new Error(res.error);
      updates = updates.filter((u) => u.id !== item.id);
    } catch (err) {
      const msg = (err as Error)?.message ?? String(err);
      updates = updates.map((u) => (u.id === item.id ? { ...u, error: msg } : u));
    } finally {
      updatingId = null;
    }
  }

  async function updateAll() {
    if (updatingId || updatingAll || updates.length === 0) return;
    updatingAll = true;
    try {
      // Sequential: one full-model GET at a time (bandwidth + memory).
      for (const item of [...updates]) {
        updatingId = item.id;
        try {
          const res = await browser.runtime.sendMessage({
            type: "UPDATE_CACHED_MODEL",
            data: { cacheName: item.cacheName, url: item.url },
          });
          if (res?.error) throw new Error(res.error);
          updates = updates.filter((u) => u.id !== item.id);
        } catch (err) {
          const msg = (err as Error)?.message ?? String(err);
          updates = updates.map((u) => (u.id === item.id ? { ...u, error: msg } : u));
        }
      }
    } finally {
      updatingId = null;
      updatingAll = false;
    }
  }

  const categoryBadgeClasses: Record<string, string> = {
    Inpaint: "bg-[var(--accent-rose-soft)] text-[var(--accent-rose)] border border-[var(--accent-rose)]/30",
    Detection: "bg-[var(--accent-cyan-soft)] text-[var(--accent-cyan)] border border-[var(--accent-cyan)]/30",
    OCR: "bg-[var(--accent-emerald-soft)] text-[var(--accent-emerald)] border border-[var(--accent-emerald)]/30",
    LLM: "bg-[var(--accent-amber-soft)] text-[var(--accent-amber)] border border-[var(--accent-amber)]/30",
    "Script Gate": "bg-[var(--surface-panel)] text-[var(--text-muted)] border border-[var(--border-line)]",
    Other: "bg-[var(--surface-panel)] text-[var(--text-dim)] border border-[var(--border-line)]",
  };
</script>

<div class="space-y-1.5">
  <div class="flex items-center justify-between ml-0.5">
    <span class="kicker">Model updates</span>
    {#if lastChecked}
      <span class="text-[10px] font-mono text-[var(--text-dim)]">checked {lastChecked}</span>
    {/if}
  </div>

  <div class="panel-card !p-2.5 space-y-2.5">
    <div class="flex flex-col gap-2">
      <p class="text-[10px] text-[var(--text-muted)] leading-snug">
        Compare cached weights against remote ({checkedCount > 0 ? `${checkedCount} checked` : "ONNX weights, dictionaries, gate"}). WebLLM chat models are excluded.
      </p>
      <div class="flex items-center gap-1.5">
        <button
          type="button"
          onclick={checkForUpdates}
          disabled={checking || updatingAll || updatingId !== null}
          class="btn-ghost flex-1 justify-center py-1.5 text-xs font-bold font-display disabled:opacity-50"
        >
          {#if checking}
            <LoaderCircle size={14} class="animate-spin" />
            Checking…
          {:else}
            <RefreshCw size={14} />
            Check for updates
          {/if}
        </button>
        {#if updates.length > 0}
          <button
            type="button"
            onclick={updateAll}
            disabled={checking || updatingAll || updatingId !== null}
            class="px-2.5 py-1.5 text-xs font-bold font-display rounded-lg cursor-pointer transition-colors
                   bg-[var(--accent-emerald)] text-[#05040b] hover:opacity-90 disabled:opacity-50
                   inline-flex items-center gap-1.5 shrink-0"
          >
            {#if updatingAll}
              <LoaderCircle size={14} class="animate-spin" />
              Updating…
            {:else}
              <Download size={14} />
              Update all ({updates.length})
            {/if}
          </button>
        {/if}
      </div>
    </div>

    {#if checkError}
      <p class="text-[11px] text-[var(--accent-rose)] leading-snug border border-[var(--accent-rose)]/30 bg-[var(--accent-rose-soft)] rounded-[3px] px-2 py-1">
        Check failed: {checkError}
      </p>
    {:else if hasChecked && !checking && updates.length === 0}
      <div class="flex items-center gap-1.5 text-[11px] text-[var(--accent-emerald)] pt-1 border-t border-[var(--border-faint)]">
        <Check size={13} class="shrink-0" />
        <span>All models up to date.</span>
      </div>
    {/if}

    {#if updates.length > 0}
      <div class="space-y-1.5 max-h-72 overflow-y-auto custom-scrollbar pr-1 pt-2 border-t border-[var(--border-faint)]">
        {#each updates as item (item.id)}
          <div class="flex items-center justify-between p-2 rounded-[3px] border border-[var(--border-faint)] bg-[var(--bg-void)] text-xs">
            <div class="min-w-0 pr-2">
              <div class="flex items-center gap-1.5">
                <ArrowDownToLine size={12} class="text-[var(--accent-amber)] shrink-0" />
                <span class="font-display font-medium text-[var(--text-primary)] truncate">
                  {item.name}
                </span>
              </div>
              <div class="text-[10px] font-mono text-[var(--text-muted)] mt-0.5">
                <span class="text-[9px] font-semibold px-1.5 py-0.2 rounded {categoryBadgeClasses[item.category] ?? categoryBadgeClasses.Other}">
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
              {#if item.error}
                <p class="text-[10px] text-[var(--accent-rose)] mt-1 leading-snug">{item.error}</p>
              {/if}
            </div>

            <button
              onclick={() => updateOne(item)}
              disabled={updatingId === item.id || updatingAll}
              title="Download the new version of this model"
              class="p-1.5 text-[var(--text-dim)] hover:text-[var(--accent-emerald)] hover:bg-[var(--accent-emerald-soft)] rounded-lg transition-colors cursor-pointer shrink-0 disabled:opacity-50"
            >
              {#if updatingId === item.id}
                <LoaderCircle size={14} class="animate-spin text-[var(--accent-emerald)]" />
              {:else}
                <Download size={14} />
              {/if}
            </button>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>
