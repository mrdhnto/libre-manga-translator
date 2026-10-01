<script lang="ts">
  import {
    GripVertical,
    SquarePlus,
    Trash2,
    Image as ImageIcon,
    Eraser,
    Layers,
    Stamp,
    RotateCcw,
    Download,
    Check,
    X,
    LoaderCircle,
  } from "lucide-svelte";

  export type EditorLayer = "raw" | "cleaned" | "inpainted";
  export type InpaintTool = "none" | "mark-inpaint" | "restore-raw";

  interface Props {
    activeLayer: EditorLayer;
    activeInpaintTool: InpaintTool;
    hasActiveBox: boolean;
    pendingPatchCount?: number;
    isApplying?: boolean;
    onSelectLayer: (layer: EditorLayer) => void;
    onSelectInpaintTool: (tool: InpaintTool) => void;
    onAddBox: () => void;
    onDeleteBox: () => void;
    onDownload: () => void;
    onApply: () => void;
    onCancel: () => void;
  }

  let {
    activeLayer,
    activeInpaintTool,
    hasActiveBox,
    pendingPatchCount = 0,
    isApplying = false,
    onSelectLayer,
    onSelectInpaintTool,
    onAddBox,
    onDeleteBox,
    onDownload,
    onApply,
    onCancel,
  }: Props = $props();

  let offsetY = $state(0);
  let isDragging = $state(false);
  let dragStartY = 0;
  let initialOffsetY = 0;

  function handleDragStart(e: MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    isDragging = true;
    dragStartY = e.clientY;
    initialOffsetY = offsetY;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      offsetY = initialOffsetY + (moveEvent.clientY - dragStartY);
    };

    const handleMouseUp = () => {
      isDragging = false;
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  }

  const downloadTooltip = $derived.by(() => {
    if (activeLayer === "raw") return "Download raw original scan (JPG)";
    if (activeLayer === "cleaned") return "Download clean scan without text (JPG)";
    return "Download translated image (JPG)";
  });
</script>

<!-- Vertical Floating Toolbar on the Right Edge of the Manga Viewport -->
<div
  role="toolbar"
  tabindex={-1}
  class="absolute right-3 top-1/2 -translate-y-1/2 z-60 pointer-events-auto select-none
         flex flex-col items-center gap-1.5 p-1.5 rounded-[6px]
         bg-[var(--surface-panel)]/95 border border-[var(--border-line)] shadow-[0_12px_36px_rgba(0,0,0,0.85),0_0_16px_var(--accent-cyan-glow)]
         text-[var(--text-primary)] backdrop-blur-md transition-shadow
         {isDragging ? 'ring-1 ring-[var(--accent-cyan)] cursor-grabbing' : ''}"
  style:transform="translateY(calc(-50% + {offsetY}px))"
  onmousedown={(e) => e.stopPropagation()}
>
  <!-- Vertical Drag Handle -->
  <button
    type="button"
    onmousedown={handleDragStart}
    class="w-full py-0.5 flex justify-center text-[var(--text-dim)] hover:text-[var(--text-primary)] cursor-grab active:cursor-grabbing focus:outline-none"
    title="Drag toolbar vertically"
    aria-label="Drag toolbar"
  >
    <GripVertical size={14} />
  </button>

  <div class="w-5 h-px bg-[var(--border-line)] my-0.5"></div>

  <!-- GROUP 1: Bbox Management -->
  <div class="flex flex-col items-center gap-1">
    <!-- Add Bbox -->
    <button
      type="button"
      onclick={onAddBox}
      disabled={activeLayer !== "inpainted"}
      title={activeLayer === "inpainted" ? "Create new text bounding box" : "Switch to Result mode to edit boxes"}
      class="w-8 h-8 flex items-center justify-center rounded-[4px] transition-colors cursor-pointer border border-transparent
             {activeLayer === 'inpainted'
               ? 'text-[var(--accent-cyan)] hover:bg-[var(--surface-panel-alt)] hover:border-[var(--accent-cyan)]/40 hover:shadow-[0_0_8px_var(--accent-cyan-glow)]'
               : 'opacity-30 cursor-not-allowed text-[var(--text-dim)]'}"
    >
      <SquarePlus size={16} />
    </button>

    <!-- Remove Bbox -->
    <button
      type="button"
      onclick={onDeleteBox}
      disabled={!hasActiveBox || activeLayer !== "inpainted"}
      title={hasActiveBox ? "Remove selected bounding box" : "Select a bounding box to delete"}
      class="w-8 h-8 flex items-center justify-center rounded-[4px] transition-colors cursor-pointer border border-transparent
             {hasActiveBox && activeLayer === 'inpainted'
               ? 'text-[var(--accent-rose)] hover:bg-[var(--surface-panel-alt)] hover:border-[var(--accent-rose)]/40 hover:shadow-[0_0_8px_rgba(244,63,94,0.3)]'
               : 'opacity-30 cursor-not-allowed text-[var(--text-dim)]'}"
    >
      <Trash2 size={16} />
    </button>
  </div>

  <div class="w-5 h-px bg-[var(--border-line)] my-0.5"></div>

  <!-- GROUP 2: Image Layer Switcher -->
  <div class="flex flex-col items-center gap-1 bg-[var(--bg-void)]/60 p-0.5 rounded-[4px] border border-[var(--border-faint)]">
    <!-- Raw Image -->
    <button
      type="button"
      onclick={() => onSelectLayer("raw")}
      title="Show raw original image scan"
      class="w-8 h-8 flex items-center justify-center rounded-[3px] transition-all cursor-pointer border
             {activeLayer === 'raw'
               ? 'bg-[var(--accent-amber-soft)] border-[var(--accent-amber)] text-[var(--accent-amber)] shadow-[0_0_10px_var(--accent-amber-glow)] font-bold'
               : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-panel)]'}"
    >
      <ImageIcon size={15} />
    </button>

    <!-- Cleaned Image (Inpainted background without text) -->
    <button
      type="button"
      onclick={() => onSelectLayer("cleaned")}
      title="Show cleaned image (original text erased, no translated text)"
      class="w-8 h-8 flex items-center justify-center rounded-[3px] transition-all cursor-pointer border relative
             {activeLayer === 'cleaned'
               ? 'bg-[var(--accent-emerald-soft)] border-[var(--accent-emerald)] text-[var(--accent-emerald)] shadow-[0_0_10px_var(--accent-emerald-glow)] font-bold'
               : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-panel)]'}"
    >
      <Eraser size={15} />
      {#if pendingPatchCount > 0}
        <span class="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse"></span>
      {/if}
    </button>

    <!-- Inpainted / Result Image -->
    <button
      type="button"
      onclick={() => onSelectLayer("inpainted")}
      title="Show inpainted result with translated text editor"
      class="w-8 h-8 flex items-center justify-center rounded-[3px] transition-all cursor-pointer border
             {activeLayer === 'inpainted'
               ? 'bg-[var(--accent-cyan-soft)] border-[var(--accent-cyan)] text-[var(--accent-cyan)] shadow-[0_0_10px_var(--accent-cyan-glow)] font-bold'
               : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-panel)]'}"
    >
      <Layers size={15} />
    </button>
  </div>

  <!-- GROUP 3: Inpainting Area Refinement (Contextual: ONLY when Cleaned Image is active) -->
  {#if activeLayer === "cleaned"}
    <div class="w-5 h-px bg-[var(--border-line)] my-0.5"></div>

    <div class="flex flex-col items-center gap-1 bg-amber-950/20 p-0.5 rounded-[4px] border border-amber-500/30">
      <!-- Mark Inpaint Area -->
      <button
        type="button"
        onclick={() => onSelectInpaintTool(activeInpaintTool === "mark-inpaint" ? "none" : "mark-inpaint")}
        title="Mark area to inpaint / erase text (click & drag rectangle)"
        class="w-8 h-8 flex items-center justify-center rounded-[3px] transition-all cursor-pointer border
               {activeInpaintTool === 'mark-inpaint'
                 ? 'bg-amber-500/30 border-amber-400 text-amber-300 shadow-[0_0_8px_rgba(251,191,36,0.4)]'
                 : 'border-transparent text-amber-400/70 hover:text-amber-300 hover:bg-amber-900/30'}"
      >
        <Stamp size={15} />
      </button>

      <!-- Remove Inpaint Area (Restore Raw Image) -->
      <button
        type="button"
        onclick={() => onSelectInpaintTool(activeInpaintTool === "restore-raw" ? "none" : "restore-raw")}
        title="Mark area to restore raw original image pixels (click & drag rectangle)"
        class="w-8 h-8 flex items-center justify-center rounded-[3px] transition-all cursor-pointer border
               {activeInpaintTool === 'restore-raw'
                 ? 'bg-rose-500/30 border-rose-400 text-rose-300 shadow-[0_0_8px_rgba(244,63,94,0.4)]'
                 : 'border-transparent text-rose-400/70 hover:text-rose-300 hover:bg-rose-900/30'}"
      >
        <RotateCcw size={15} />
      </button>

      {#if pendingPatchCount > 0}
        <span class="text-[9px] font-mono font-bold text-amber-300 mt-0.5" title="{pendingPatchCount} inpaint edit patches queued">
          {pendingPatchCount}
        </span>
      {/if}
    </div>
  {/if}

  <div class="w-5 h-px bg-[var(--border-line)] my-0.5"></div>

  <!-- ACTION GROUP: Download, Apply & Cancel -->
  <div class="flex flex-col items-center gap-1">
    <!-- Download Image based on active layer -->
    <button
      type="button"
      onclick={onDownload}
      title={downloadTooltip}
      class="w-8 h-8 flex items-center justify-center rounded-[4px] text-[var(--text-muted)] hover:text-[var(--accent-emerald)] hover:bg-[var(--surface-panel-alt)] transition-colors cursor-pointer border border-transparent hover:border-[var(--accent-emerald)]/40"
    >
      <Download size={15} />
    </button>

    <!-- Apply Changes (commits text, inpaint edits, saves) -->
    <button
      type="button"
      onclick={onApply}
      disabled={isApplying}
      title="Apply changes & update translation"
      class="w-8 h-8 flex items-center justify-center rounded-[4px] transition-all cursor-pointer border border-[var(--accent-cyan)]
             bg-gradient-to-tr from-cyan-500 to-[#00f0ff] text-black font-bold shadow-[0_0_12px_var(--accent-cyan-glow)]
             hover:shadow-[0_0_18px_rgba(0,240,255,0.6)] disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {#if isApplying}
        <LoaderCircle size={15} class="animate-spin text-black" />
      {:else}
        <Check size={15} />
      {/if}
    </button>

    <!-- Cancel / Close Editor -->
    <button
      type="button"
      onclick={onCancel}
      title="Cancel & discard changes"
      class="w-8 h-8 flex items-center justify-center rounded-[4px] text-[var(--text-dim)] hover:text-[var(--accent-rose)] hover:bg-[var(--surface-panel-alt)] transition-colors cursor-pointer border border-transparent hover:border-rose-500/40"
    >
      <X size={15} />
    </button>
  </div>
</div>
