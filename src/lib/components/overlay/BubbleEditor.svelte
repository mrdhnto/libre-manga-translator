<script lang="ts">
  interface Props {
    bboxes: Bbox[];
    scaleX: number;
    scaleY: number;
    activeIndex: number | null;
    maskPath: string;
    onSelectBox: (index: number) => void;
    onDragStart: (index: number, handle: string) => (e: MouseEvent) => void;
  }

  let {
    bboxes = [],
    scaleX = 1,
    scaleY = 1,
    activeIndex = null,
    maskPath = "",
    onSelectBox,
    onDragStart,
  }: Props = $props();
</script>

{#if bboxes.length > 0}
  <!-- Dark Vignette Mask over image, cutting out active text bubbles -->
  <div
    class="absolute inset-0 bg-black/60 pointer-events-none"
    style="clip-path: {maskPath}; transition: none; will-change: clip-path;"
  ></div>
{/if}

{#each bboxes as box, i}
  {@const isActive = activeIndex === i}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    role="presentation"
    class="lmt-box absolute p-0 m-0 bg-transparent transition-colors select-none
           {isActive
             ? 'border-2 border-[var(--accent-cyan)] z-50 shadow-[0_0_12px_var(--accent-cyan-glow)]'
             : box.gateSkip
               ? 'border-2 border-dashed border-[var(--accent-amber)]/90 z-40'
               : 'border-2 border-[var(--accent-cyan)]/60 hover:border-[var(--accent-cyan)] z-40'}"
    style:left="{box.x1 * scaleX}px"
    style:top="{box.y1 * scaleY}px"
    style:width="{(box.x2 - box.x1) * scaleX}px"
    style:height="{(box.y2 - box.y1) * scaleY}px"
    onmousedown={(e) => {
      e.stopPropagation();
      onSelectBox(i);
      onDragStart(i, "move")(e);
    }}
    title={box.gateSkip
      ? `${box.gateSkip === "not-japanese" ? "Language gate: text is not in the selected language" : "Language gate: unclear language"} - original left untouched`
      : `Confidence: ${(box.confidence * 100).toPrecision(2)}%`}
  >
    <!-- Reading Order Index Badge (Void-0) -->
    <div
      class="absolute -top-5 -left-0.5 font-mono font-bold text-[10px] px-1.5 py-0.5 rounded-[2px] border pointer-events-none text-center
             {box.gateSkip
               ? 'bg-[var(--accent-amber-soft)] border-[var(--accent-amber)]/60 text-[var(--accent-amber)]'
               : isActive
                 ? 'bg-[#121a26] border-[var(--accent-cyan)] text-[var(--accent-cyan)] shadow-[0_0_8px_var(--accent-cyan-glow)]'
                 : 'bg-[#121a26]/90 border-[var(--border-line)] text-[var(--accent-cyan)]'}"
    >
      #{i + 1}
    </div>

    <!-- Active Resize Handles -->
    {#if isActive}
      <button
        type="button"
        class="handle top-left"
        onmousedown={onDragStart(i, "tl")}
        aria-label="Resize top left"
      ></button>
      <button
        type="button"
        class="handle top-right"
        onmousedown={onDragStart(i, "tr")}
        aria-label="Resize top right"
      ></button>
      <button
        type="button"
        class="handle bottom-left"
        onmousedown={onDragStart(i, "bl")}
        aria-label="Resize bottom left"
      ></button>
      <button
        type="button"
        class="handle bottom-right"
        onmousedown={onDragStart(i, "br")}
        aria-label="Resize bottom right"
      ></button>
    {/if}
  </div>
{/each}

<style>
  .handle {
    position: absolute;
    width: 8px;
    height: 8px;
    background-color: #00f0ff;
    border: 1.5px solid #04070b;
    border-radius: 2px;
    z-index: 60;
    box-shadow: 0 0 6px rgba(0, 240, 255, 0.6);
  }
  .handle.top-left {
    top: -4px;
    left: -4px;
    cursor: nwse-resize;
  }
  .handle.top-right {
    top: -4px;
    right: -4px;
    cursor: nesw-resize;
  }
  .handle.bottom-left {
    bottom: -4px;
    left: -4px;
    cursor: nesw-resize;
  }
  .handle.bottom-right {
    bottom: -4px;
    right: -4px;
    cursor: nwse-resize;
  }
</style>
