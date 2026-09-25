<script lang="ts">
  import { Zap } from "lucide-svelte";

  let {
    autoTranslate = $bindable(false),
    concurrency = $bindable(1),
  }: {
    autoTranslate?: boolean;
    concurrency?: number;
  } = $props();
</script>

<div class="panel-card !p-2.5">
  <div class="flex items-center justify-between gap-3">
    <div class="flex items-center gap-2.5 min-w-0">
      <div
        class="shrink-0 w-6 h-6 rounded-md border flex items-center justify-center bg-[var(--bg-void)] border-[var(--border-faint)] text-[var(--text-dim)]"
      >
        <Zap size={13} />
      </div>
      <div class="flex flex-col min-w-0">
        <span class="text-xs font-medium leading-tight text-[var(--text-primary)]">
          Auto-translate pages
        </span>
        <span class="text-[11px] text-[var(--text-muted)] leading-tight">
          Translate pages automatically as you scroll
        </span>
      </div>
    </div>
    <label class="switch-cyber is-emerald ml-2">
      <input type="checkbox" bind:checked={autoTranslate} />
      <span class="track"><span class="thumb"></span></span>
    </label>
  </div>

  {#if autoTranslate}
    <div class="mt-2.5 pt-2 border-t border-[var(--border-faint)]">
      <div class="flex items-center justify-between mb-1">
        <span class="text-[11px] font-medium text-[var(--text-muted)]">
          Parallel limit
        </span>
        <span class="text-[11px] font-medium px-1.5 py-px rounded bg-[var(--bg-void)] text-[var(--accent-emerald)] border border-[var(--accent-emerald)]/30">
          {concurrency}
        </span>
      </div>
      <input
        type="range"
        min="1"
        max="10"
        step="1"
        bind:value={concurrency}
        disabled={!autoTranslate}
        class="slider-cyber is-emerald"
      />
      <div class="flex justify-between text-[10px] text-[var(--text-dim)] mt-0.5">
        <span>1 (sequential)</span>
        <span>10 (max)</span>
      </div>
    </div>
  {/if}
</div>
