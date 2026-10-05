<script lang="ts">
  import { GripVertical, Copy, Check } from "lucide-svelte";

  interface Props {
    boxIndex: number;
    sourceText: string;
    gateSkip?: GateReason;
    anchorX: number;
    anchorY: number;
  }

  let {
    boxIndex,
    sourceText,
    gateSkip,
    anchorX,
    anchorY,
  }: Props = $props();

  let offsetX = $state(0);
  let offsetY = $state(0);
  let isDragging = $state(false);
  let dragStart = { x: 0, y: 0, initialOffsetX: 0, initialOffsetY: 0 };
  let copied = $state(false);

  // Reset custom drag offset whenever active box index changes
  $effect(() => {
    void boxIndex;
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
    if (!sourceText) return;
    try {
      await navigator.clipboard.writeText(sourceText);
      copied = true;
      setTimeout(() => (copied = false), 1800);
    } catch (err) {
      console.warn("Failed to copy source text", err);
    }
  }
</script>

<!-- Floating Draggable Raw Text Pill -->
<div
  role="presentation"
  class="absolute z-60 pointer-events-auto select-none flex items-center gap-1.5 px-2 py-1 rounded-[4px]
         bg-[var(--surface-panel)]/95 border border-[var(--border-line)] shadow-[0_4px_16px_rgba(0,0,0,0.7),0_0_8px_var(--accent-cyan-glow)]
         text-[var(--text-primary)] font-mono text-[11px] backdrop-blur-md transition-shadow
         hover:border-[var(--accent-cyan)]/80 {isDragging ? 'cursor-grabbing scale-102 ring-1 ring-[var(--accent-cyan)]' : ''}"
  style="left: max(8px, min(calc(100% - 220px), {anchorX + offsetX}px)); top: max(6px, min(calc(100% - 36px), {anchorY + offsetY + 6}px));"
  onmousedown={(e) => e.stopPropagation()}
>
  <!-- Drag Grip Handle -->
  <button
    type="button"
    class="p-0.5 -ml-1 text-[var(--text-dim)] hover:text-[var(--text-primary)] cursor-grab active:cursor-grabbing focus:outline-none"
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
    class="max-w-[180px] sm:max-w-[240px] truncate text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors select-text"
    title={sourceText || "No OCR text detected"}
  >
    {sourceText || "N/A"}
  </span>

  <!-- Copy Button -->
  {#if sourceText}
    <button
      type="button"
      onclick={handleCopy}
      class="p-1 rounded-[3px] text-[var(--text-dim)] hover:text-[var(--accent-cyan)] hover:bg-[var(--surface-panel-alt)] transition-colors cursor-pointer"
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
</div>
