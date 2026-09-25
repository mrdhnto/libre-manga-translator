<script lang="ts">
  import { X, Check } from "lucide-svelte";

  interface Props {
    open: boolean;
    bboxes: Bbox[];
    sourceTexts: string[];
    drafts: Translations;
    onApply: (updatedDrafts: Translations) => void;
    onClose: () => void;
  }

  let {
    open = false,
    bboxes = [],
    sourceTexts = [],
    drafts = [],
    onApply,
    onClose,
  }: Props = $props();

  let localDrafts = $state<Translations>([]);

  $effect(() => {
    if (open) {
      localDrafts = [...drafts];
    }
  });

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
    } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.stopPropagation();
      onApply(localDrafts);
    }
  }

  function isolateHostKeyboard(e: KeyboardEvent) {
    e.stopPropagation();
  }
</script>

{#if open}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    class="fixed inset-0 z-[999999] bg-black/35 flex items-center justify-center p-4 font-sans select-none"
    onclick={onClose}
    onkeydown={handleKeyDown}
    onkeyup={isolateHostKeyboard}
    onkeypress={isolateHostKeyboard}
    role="dialog"
    aria-modal="true"
    tabindex="-1"
  >
    <!-- Modal Card -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="bg-[var(--surface-panel)] border border-[var(--border-line)] rounded-[6px] shadow-[0_24px_70px_rgba(0,0,0,0.85),0_0_20px_var(--accent-cyan-glow)]
             w-full max-w-lg max-h-[85vh] flex flex-col overflow-hidden text-[var(--text-primary)] backdrop-blur-md"
      onclick={(e) => e.stopPropagation()}
    >
      <!-- Header -->
      <div class="flex items-center justify-between px-4 py-3 border-b border-[var(--border-line)] shrink-0 bg-[var(--surface-panel-alt)]">
        <div>
          <span class="kicker !text-[10px] !text-[var(--accent-cyan)] font-mono">01 // IN-PLACE CORRECTIONS</span>
          <h3 class="text-sm font-bold font-display tracking-tight text-[var(--text-primary)] mt-0.5">Edit Translations</h3>
        </div>
        <button
          type="button"
          onclick={onClose}
          class="p-1.5 rounded-[3px] text-[var(--text-muted)] hover:text-[var(--accent-rose)] hover:bg-[var(--surface-paper-warm)] transition-colors cursor-pointer"
          aria-label="Close modal"
        >
          <X size={16} />
        </button>
      </div>

      <!-- Bubble Items List -->
      <div class="overflow-y-auto px-4 py-3 flex flex-col gap-3.5 flex-1 custom-scrollbar">
        {#each bboxes as _, i}
          <div class="p-2.5 rounded-[4px] border border-[var(--border-line)] bg-[var(--bg-void)] flex flex-col gap-1.5 transition-colors focus-within:border-[var(--accent-cyan)]/60 focus-within:shadow-[0_0_10px_var(--accent-cyan-glow)]">
            <div class="flex items-center justify-between text-xs">
              <span class="inline-flex items-center gap-1.5">
                <span class="badge-cyber is-cyan !text-[10px] !py-0.5 !px-2 font-mono font-bold">
                  #{i + 1}
                </span>
                <span class="font-mono text-[11px] text-[var(--text-muted)] truncate max-w-[280px]">
                  {sourceTexts[i] || "N/A"}
                </span>
              </span>
            </div>
            <textarea
              bind:value={localDrafts[i]}
              rows={2}
              placeholder="Translated text..."
              class="w-full bg-[var(--surface-panel)] border border-[var(--border-line)] rounded-[3px] p-2 text-xs font-body text-[var(--text-primary)] resize-y min-h-[2.8rem]
                     focus:outline-none focus:border-[var(--accent-cyan)] focus:shadow-[0_0_10px_var(--accent-cyan-glow)] transition-all placeholder:text-[var(--text-dim)]"
            ></textarea>
          </div>
        {/each}
      </div>

      <!-- Footer Actions -->
      <div class="flex items-center justify-between px-4 py-3 border-t border-[var(--border-line)] shrink-0 bg-[var(--surface-panel-alt)]">
        <span class="text-[10px] font-mono text-[var(--text-dim)] flex items-center gap-1.5">
          <kbd class="px-1.5 py-0.5 rounded bg-[var(--bg-void)] border border-[var(--border-line)] text-[var(--text-muted)]">Ctrl+Enter</kbd> to apply
        </span>
        <div class="flex items-center gap-2">
          <button
            type="button"
            onclick={onClose}
            class="btn-ghost text-xs px-3 py-1.5"
          >
            Cancel
          </button>
          <button
            type="button"
            onclick={() => onApply(localDrafts)}
            class="btn-primary text-xs px-3.5 py-1.5"
          >
            <Check size={14} />
            Apply &amp; Repaint
          </button>
        </div>
      </div>
    </div>
  </div>
{/if}
