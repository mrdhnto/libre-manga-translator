<script lang="ts">
  import { GripVertical, Copy, Check, Sparkles, LoaderCircle } from "lucide-svelte";

  interface Props {
    boxIndex: number;
    sourceText: string;
    gateSkip?: GateReason;
    anchorX: number;
    anchorY: number;
    isRetranslating?: boolean;
    onRetranslate?: (skipOcr: boolean) => void;
  }

  let {
    boxIndex,
    sourceText,
    gateSkip,
    anchorX,
    anchorY,
    isRetranslating = false,
    onRetranslate,
  }: Props = $props();

  let offsetX = $state(0);
  let offsetY = $state(0);
  let isDragging = $state(false);
  let dragStart = { x: 0, y: 0, initialOffsetX: 0, initialOffsetY: 0 };
  let copied = $state(false);

  // Reset custom drag offset whenever the active box changes or moves,
  // so a user-nudged pill re-seats relative to its box instead of keeping
  // a stale offset.
  $effect(() => {
    void boxIndex;
    void anchorX;
    void anchorY;
    offsetX = 0;
    offsetY = 0;
  });

  function handleMouseDown(e: MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    isDragging = true;
    dragStart = {
      x: e.clientX,
      y: e.clientY,
      initialOffsetX: offsetX,
      initialOffsetY: offsetY,
    };

    const handleMouseMove = (moveEvent: MouseEvent) => {
      offsetX = dragStart.initialOffsetX + (moveEvent.clientX - dragStart.x);
      offsetY = dragStart.initialOffsetY + (moveEvent.clientY - dragStart.y);
    };

    const handleMouseUp = () => {
      isDragging = false;
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  }

  async function handleCopy(e: MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    if (!sourceText) return;
    try {
      await navigator.clipboard.writeText(sourceText);
      copied = true;
      setTimeout(() => (copied = false), 1800);
    } catch (err) {
      console.warn("Failed to copy source text", err);
    }
  }

  function handleRetranslate(e: MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    if (isRetranslating) return;
    const skipOcr = e.ctrlKey || e.metaKey;
    onRetranslate?.(skipOcr);
  }
</script>

<!-- Floating Draggable Raw Text Pill.
     Container is pointer-events-none so it never blocks box selection or
     box move-drags underneath (incl. its own box's bottom edge while
     resizing); only the grip, text, and copy button opt back into hits. -->
<div
  role="presentation"
  class="absolute z-60 pointer-events-none select-none flex items-center gap-1.5 px-2 py-1 rounded-[4px]
         bg-[var(--surface-panel)]/95 border border-[var(--border-line)] shadow-[0_4px_16px_rgba(0,0,0,0.7),0_0_8px_var(--accent-cyan-glow)]
         text-[var(--text-primary)] font-mono text-[11px] backdrop-blur-md transition-shadow
         hover:border-[var(--accent-cyan)]/80 {isDragging ? 'cursor-grabbing scale-102 ring-1 ring-[var(--accent-cyan)]' : ''}"
  style="left: max(8px, min(calc(100% - 250px), {anchorX + offsetX}px)); top: max(6px, min(calc(100% - 36px), {anchorY + offsetY + 6}px));"
  onmousedown={(e) => e.stopPropagation()}
  onpointerdown={(e) => e.stopPropagation()}
  onclick={(e) => {
    e.stopPropagation();
    e.preventDefault();
  }}
>
  <!-- Drag Grip Handle -->
  <button
    type="button"
    class="pointer-events-auto p-0.5 -ml-1 text-[var(--text-dim)] hover:text-[var(--text-primary)] cursor-grab active:cursor-grabbing focus:outline-none"
    onmousedown={handleMouseDown}
    title="Drag to reposition source text pill"
    aria-label="Drag pill"
  >
    <GripVertical size={13} />
  </button>

  <!-- Reading Order Index Badge -->
  <span
    class="font-bold text-[10px] px-1 py-0.2 rounded-[2px] border
           {gateSkip
             ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
             : 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'}"
  >
    #{boxIndex + 1}
  </span>

  <!-- Source Text -->
  <span
    class="pointer-events-auto max-w-[180px] sm:max-w-[240px] truncate text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors select-text"
    title={sourceText || "No OCR text detected"}
  >
    {sourceText || "N/A"}
  </span>

  <!-- Actions -->
  <div class="flex items-center gap-0.5">
    {#if sourceText}
      <button
        type="button"
        onclick={handleCopy}



        class="pointer-events-auto p-1 rounded-[3px] text-[var(--text-dim)] hover:text-[var(--accent-cyan)] hover:bg-[var(--surface-panel-alt)] transition-colors cursor-pointer"
        title={copied ? "Copied!" : "Copy raw text to clipboard"}
        aria-label="Copy raw text"
      >
        {#if copied}

          <Check size={12} class="text-[var(--accent-emerald)]" />
        {:else}
          <Copy size={12} />
        {/if}
      </button>
    {/if}

    <!-- Retranslate with AI Button -->
    <div class="relative inline-flex group/retrans">
      <button
        type="button"
        onclick={handleRetranslate}
        disabled={isRetranslating}
        class="pointer-events-auto p-1 rounded-[3px] text-[var(--text-dim)] hover:text-[var(--accent-cyan)] hover:bg-[var(--surface-panel-alt)] transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none"
        aria-label="Retranslate with AI"
      >
        {#if isRetranslating}
          <LoaderCircle size={12} class="animate-spin text-[var(--accent-cyan)]" />
        {:else}
          <Sparkles size={12} />
        {/if}
      </button>

      <!-- Tooltip on hover / keyboard focus -->
      <div
        role="tooltip"
        class="absolute bottom-full right-0 mb-1.5 hidden group-hover/retrans:flex group-focus-within/retrans:flex flex-col gap-0.5 pointer-events-none z-70 px-2 py-1.5 rounded-[4px] bg-[var(--surface-panel)] border border-[var(--border-line)] shadow-[0_4px_16px_rgba(0,0,0,0.8),0_0_8px_var(--accent-cyan-glow)] text-[10px] font-sans text-[var(--text-primary)] whitespace-nowrap"
      >
        {#if isRetranslating}
          <span class="font-semibold text-[var(--accent-cyan)]">Retranslating…</span>
        {:else}
          <span class="font-semibold text-[var(--accent-cyan)]">Retranslate with AI</span>
          <span class="text-[var(--text-muted)]">Click: re-read bubble (OCR / vision)</span>
          <span class="text-[var(--text-muted)]">Ctrl/⌘ + click: use captured text (skip OCR)</span>
        {/if}
      </div>
    </div>
  </div>
</div>
