<script lang="ts">
  import { CircleCheck, CircleAlert, TriangleAlert, Info, X } from "lucide-svelte";
  import type { OverlayToast } from "./toasts";

  interface Props {
    toasts: OverlayToast[];
    onDismiss: (id: string) => void;
  }

  let { toasts = [], onDismiss }: Props = $props();
</script>

{#if toasts.length > 0}
  <div
    role="region"
    aria-label="Notifications"
    class="absolute top-4 left-1/2 -translate-x-1/2 z-[65] pointer-events-none flex flex-col items-center gap-2 max-w-[90vw] sm:max-w-md w-full select-none"
  >
    {#each toasts as toast (toast.id)}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <div
        role="status"
        aria-live="polite"
        class="pointer-events-auto flex items-start gap-2.5 px-3 py-2 rounded-[6px] border shadow-[0_8px_24px_rgba(0,0,0,0.7)] text-xs font-sans backdrop-blur-md transition-all
               {toast.kind === 'success'
                 ? 'bg-[var(--surface-panel)]/95 border-[var(--accent-emerald)]/50 text-[var(--text-primary)] shadow-[0_0_12px_var(--accent-emerald-glow)]'
                 : toast.kind === 'warn'
                   ? 'bg-[var(--surface-panel)]/95 border-[var(--accent-amber)]/50 text-[var(--text-primary)] shadow-[0_0_12px_var(--accent-amber-glow)]'
                   : toast.kind === 'error'
                     ? 'bg-[var(--surface-panel)]/95 border-[var(--accent-rose)]/50 text-[var(--text-primary)] shadow-[0_0_12px_var(--accent-rose-glow)]'
                     : 'bg-[var(--surface-panel)]/95 border-[var(--border-line)] text-[var(--text-primary)]'}"
        onmousedown={(e) => e.stopPropagation()}
        onpointerdown={(e) => e.stopPropagation()}
        onclick={(e) => {
          e.stopPropagation();
          e.preventDefault();
        }}
      >
        <span class="shrink-0 mt-0.5">
          {#if toast.kind === 'success'}
            <CircleCheck size={14} class="text-[var(--accent-emerald)]" />
          {:else if toast.kind === 'warn'}
            <TriangleAlert size={14} class="text-[var(--accent-amber)]" />
          {:else if toast.kind === 'error'}
            <CircleAlert size={14} class="text-[var(--accent-rose)]" />
          {:else}
            <Info size={14} class="text-[var(--accent-cyan)]" />
          {/if}
        </span>

        <span class="flex-1 text-[11px] leading-relaxed break-words">
          {toast.message}
        </span>

        <button
          type="button"
          onclick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            onDismiss(toast.id);
          }}
          class="shrink-0 p-0.5 -mr-1 text-[var(--text-dim)] hover:text-[var(--text-primary)] cursor-pointer rounded transition-colors focus:outline-none"
          title="Dismiss"
          aria-label="Dismiss notification"
        >
          <X size={12} />
        </button>
      </div>
    {/each}
  </div>
{/if}