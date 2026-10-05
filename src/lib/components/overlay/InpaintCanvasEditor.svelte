<script lang="ts">
  import { X, Sparkles, Undo2 } from "lucide-svelte";

  export interface InpaintPatch {
    id: string;
    type: "add-inpaint" | "restore-raw";
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  }

  interface Props {
    activeTool: "none" | "mark-inpaint" | "restore-raw";
    scaleX: number;
    scaleY: number;
    patches: InpaintPatch[];
    onAddPatch: (patch: InpaintPatch) => void;
    onRemovePatch: (id: string) => void;
  }

  let {
    activeTool = "none",
    scaleX = 1,
    scaleY = 1,
    patches = [],
    onAddPatch,
    onRemovePatch,
  }: Props = $props();

  let isDrawing = $state(false);
  let startX = $state(0);
  let startY = $state(0);
  let currentX = $state(0);
  let currentY = $state(0);

  const rubberband = $derived.by(() => {
    if (!isDrawing) return null;
    const left = Math.min(startX, currentX);
    const top = Math.min(startY, currentY);
    const width = Math.abs(currentX - startX);
    const height = Math.abs(currentY - startY);
    return { left, top, width, height };
  });

  function handleMouseDown(e: MouseEvent) {
    if (activeTool === "none") return;
    // Only left click
    if (e.button !== 0) return;

    const target = e.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    isDrawing = true;
    startX = x;
    startY = y;
    currentX = x;
    currentY = y;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      currentX = moveEvent.clientX - rect.left;
      currentY = moveEvent.clientY - rect.top;
    };

    const handleMouseUp = () => {
      isDrawing = false;
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);

      const minX = Math.min(startX, currentX);
      const maxX = Math.max(startX, currentX);
      const minY = Math.min(startY, currentY);
      const maxY = Math.max(startY, currentY);

      // Require at least a 6x6 pixel area
      if (maxX - minX >= 6 && maxY - minY >= 6) {
        const natX1 = minX / (scaleX || 1);
        const natY1 = minY / (scaleY || 1);
        const natX2 = maxX / (scaleX || 1);
        const natY2 = maxY / (scaleY || 1);

        onAddPatch({
          id: crypto.randomUUID(),
          type: activeTool === "mark-inpaint" ? "add-inpaint" : "restore-raw",
          x1: natX1,
          y1: natY1,
          x2: natX2,
          y2: natY2,
        });
      }
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  }
</script>

<!-- Interactive Inpaint Patch Surface (Active when Cleaned Layer is shown) -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="absolute inset-0 z-40 select-none {activeTool !== 'none' ? 'cursor-crosshair pointer-events-auto' : 'pointer-events-none'}"
  onmousedown={handleMouseDown}
>
  <!-- Rubberband Box While Drawing -->
  {#if rubberband && rubberband.width > 2 && rubberband.height > 2}
    <div
      class="absolute pointer-events-none border-2 border-dashed z-50 transition-none
             {activeTool === 'mark-inpaint'
               ? 'border-amber-400 bg-amber-500/20 shadow-[0_0_12px_rgba(251,191,36,0.4)]'
               : 'border-rose-400 bg-rose-500/20 shadow-[0_0_12px_rgba(244,63,94,0.4)]'}"
      style:left="{rubberband.left}px"
      style:top="{rubberband.top}px"
      style:width="{rubberband.width}px"
      style:height="{rubberband.height}px"
    >
      <div
        class="absolute -top-5 left-0 font-mono text-[10px] font-bold px-1.5 py-0.5 rounded-[2px]
               {activeTool === 'mark-inpaint' ? 'bg-amber-500 text-black' : 'bg-rose-500 text-white'}"
      >
        {activeTool === "mark-inpaint" ? "+ INPAINT" : "RESTORE RAW"}
      </div>
    </div>
  {/if}

  <!-- Render Pending Patches -->
  {#each patches as patch (patch.id)}
    {@const isAdd = patch.type === "add-inpaint"}
    {@const px1 = patch.x1 * scaleX}
    {@const py1 = patch.y1 * scaleY}
    {@const pw = (patch.x2 - patch.x1) * scaleX}
    {@const ph = (patch.y2 - patch.y1) * scaleY}

    <div
      class="absolute border-2 border-dashed z-45 group pointer-events-auto transition-colors
             {isAdd
               ? 'border-amber-400/90 bg-amber-500/15 hover:bg-amber-500/25'
               : 'border-rose-400/90 bg-rose-500/15 hover:bg-rose-500/25'}"
      style:left="{px1}px"
      style:top="{py1}px"
      style:width="{pw}px"
      style:height="{ph}px"
      title={isAdd ? "Area queued to be inpainted/erased" : "Area queued to restore raw original image pixels"}
    >
      <!-- Label & Delete Button -->
      <div
        class="absolute -top-5 left-0 flex items-center gap-1 font-mono text-[10px] font-bold px-1.5 py-0.5 rounded-[2px] shadow-sm
               {isAdd ? 'bg-amber-500 text-black' : 'bg-rose-500 text-white'}"
      >
        {#if isAdd}
          <Sparkles size={10} />
          <span>+ INPAINT</span>
        {:else}
          <Undo2 size={10} />
          <span>RESTORE</span>
        {/if}

        <button
          type="button"
          onclick={(e) => {
            e.stopPropagation();
            onRemovePatch(patch.id);
          }}
          class="ml-1 p-0.5 rounded hover:bg-black/30 cursor-pointer"
          title="Remove this patch"
          aria-label="Remove patch"
        >
          <X size={10} />
        </button>
      </div>
    </div>
  {/each}
</div>
