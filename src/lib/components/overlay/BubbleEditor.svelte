<script lang="ts">
  import FloatingRawTextPill from "./FloatingRawTextPill.svelte";
  import ContextualStyleBar from "./ContextualStyleBar.svelte";
  import { calculateFittedTextLayout } from "@/lib/canvas";

  interface Props {
    mode?: "refining" | "editing";
    bboxes: Bbox[];
    translations?: Translations;
    sourceTexts?: string[];
    scaleX: number;
    scaleY: number;
    activeIndex: number | null;
    fontStack?: string;
    maskPath?: string;
    onSelectBox: (index: number) => void;
    onDragStart: (index: number, handle: string) => (e: MouseEvent) => void;
    onUpdateTranslation?: (index: number, text: string) => void;
    onUpdateStyle?: (index: number, style: TextStyle) => void;
  }

  let {
    mode = "refining",
    bboxes = [],
    translations = [],
    sourceTexts = [],
    scaleX = 1,
    scaleY = 1,
    activeIndex = null,
    fontStack = "'Segoe UI', sans-serif",
    maskPath = "",
    onSelectBox,
    onDragStart,
    onUpdateTranslation,
    onUpdateStyle,
  }: Props = $props();

  function stopHostKeydown(e: KeyboardEvent) {
    e.stopPropagation();
    // Do not let manga reader arrow keys / page-turns fire while typing
  }
</script>

{#if mode === "refining" && bboxes.length > 0 && maskPath}
  <!-- Dark Vignette Mask over image, cutting out active text bubbles (Refining mode only) -->
  <div
    class="absolute inset-0 bg-black/60 pointer-events-none"
    style="clip-path: {maskPath}; transition: none; will-change: clip-path;"
  ></div>
{/if}

{#each bboxes as box, i}
  {@const isActive = activeIndex === i}
  {@const boxRawW = box.x2 - box.x1}
  {@const boxRawH = box.y2 - box.y1}
  {@const boxW = Math.max(20, boxRawW * scaleX)}
  {@const boxH = Math.max(20, boxRawH * scaleY)}
  {@const style = box.style}
  {@const textValue = translations[i] ?? ""}
  {@const isBold = style?.bold ?? true}
  {@const isItalic = style?.italic ?? false}
  {@const strokeColor = style?.strokeColor ?? "rgba(255,255,255,0.85)"}
  {@const hasStroke = strokeColor !== "none" && strokeColor !== "transparent"}
  {@const layout = calculateFittedTextLayout(
    textValue,
    boxRawW,
    boxRawH,
    fontStack,
    style?.fontSize,
    isBold,
    isItalic,
  )}
  {@const fittedFontSize = layout.fontSize * scaleY}
  {@const strokeWidth = (style?.strokeWidth ?? layout.fontSize * 0.25) * scaleY}
  {@const strokeCss = hasStroke
    ? `-webkit-text-stroke: ${Math.max(1, Math.round(strokeWidth))}px ${strokeColor}; paint-order: stroke fill;`
    : ""}
  {@const padX = layout.pad * scaleX}
  {@const padY = layout.pad * scaleY}
  {@const blockH = layout.blockH * scaleY}
  {@const paddingTop = padY + Math.max(0, (layout.maxH * scaleY - blockH) / 2)}

  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    role="presentation"
    class="lmt-box absolute p-0 m-0 transition-colors select-none group
           {isActive
             ? `border-2 border-[var(--accent-cyan)] z-50 shadow-[0_0_14px_var(--accent-cyan-glow)] ${mode === 'editing' ? 'bg-transparent' : 'bg-black/10'}`
             : box.gateSkip
               ? `border-2 border-dashed border-[var(--accent-amber)]/90 z-40 ${mode === 'editing' ? 'bg-transparent' : 'bg-amber-950/10'}`
               : `border-2 border-[var(--accent-cyan)]/50 hover:border-[var(--accent-cyan)] z-40 ${mode === 'editing' ? 'bg-transparent' : 'bg-cyan-950/5'}`}"
    style:left="{box.x1 * scaleX}px"
    style:top="{box.y1 * scaleY}px"
    style:width="{boxW}px"
    style:height="{boxH}px"
    onmousedown={(e) => {
      e.stopPropagation();
      onSelectBox(i);
      // If clicking near edges, initiate move drag
      const target = e.target as HTMLElement;
      if (target.tagName !== "TEXTAREA" && !target.classList.contains("handle")) {
        onDragStart(i, "move")(e);
      }
    }}
    title={box.gateSkip
      ? `${box.gateSkip === "not-japanese" ? "Language gate: not Japanese" : "Language gate: low confidence"}`
      : `Box #${i + 1}`}
  >
    <!-- Reading Order Badge -->
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

    <!-- IN-PLACE TEXT EDITING (Editing Mode) -->
    {#if mode === "editing"}
      {#if isActive}
        <!-- Active inline editable textarea -->
        <textarea
          value={textValue}
          oninput={(e) => onUpdateTranslation?.(i, (e.target as HTMLTextAreaElement).value)}
          onkeydown={stopHostKeydown}
          onkeyup={stopHostKeydown}
          onkeypress={stopHostKeydown}
          placeholder="Type translation here..."
          class="w-full h-full bg-transparent resize-none border-none outline-none overflow-y-auto custom-scrollbar select-text text-center"
          style="
            font-family: {fontStack};
            font-size: {fittedFontSize}px;
            font-weight: {isBold ? '700' : '600'};
            font-style: {isItalic ? 'italic' : 'normal'};
            line-height: 1.25;
            color: {style?.color ?? '#1a1a1a'};
            text-align: center;
            padding: {paddingTop}px {padX}px;
            text-decoration: {style?.underline ? 'underline' : 'none'};
            caret-color: var(--accent-cyan);
            box-sizing: border-box;
            {strokeCss}
          "
          onmousedown={(e) => e.stopPropagation()}
        ></textarea>
      {:else}
        <!-- Inactive box: exact 1:1 multi-line preview matching canvas render -->
        <div
          class="w-full h-full flex flex-col justify-center items-center text-center overflow-hidden pointer-events-none select-none"
          style="
            font-family: {fontStack};
            font-size: {fittedFontSize}px;
            font-weight: {isBold ? '700' : '600'};
            font-style: {isItalic ? 'italic' : 'normal'};
            line-height: 1.25;
            color: {style?.color ?? '#1a1a1a'};
            text-align: center;
            padding: {paddingTop}px {padX}px;
            text-decoration: {style?.underline ? 'underline' : 'none'};
            box-sizing: border-box;
            {strokeCss}
          "
        >
          {#if layout.lines.length > 0}
            {#each layout.lines as line}
              <span class="whitespace-pre">{line}</span>
            {/each}
          {:else}
            <span class="opacity-25 italic text-xs">...</span>
          {/if}
        </div>
      {/if}
    {/if}

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

<!-- Contextual Floating Controls for Active Box in Editing Mode -->
{#if mode === "editing" && activeIndex !== null && bboxes[activeIndex]}
  {@const activeBox = bboxes[activeIndex]}
  {@const boxLeft = activeBox.x1 * scaleX}
  {@const boxTop = activeBox.y1 * scaleY}
  {@const boxBottom = activeBox.y2 * scaleY}

  <!-- Contextual Typography Style Toolbar (Positioned above box) -->
  <ContextualStyleBar
    boxIndex={activeIndex}
    style={activeBox.style}
    onChange={(newStyle) => onUpdateStyle?.(activeIndex, newStyle)}
    anchorX={boxLeft}
    anchorY={boxTop}
  />

  <!-- Floating Draggable Raw Source Text Pill (Positioned below box) -->
  <FloatingRawTextPill
    boxIndex={activeIndex}
    sourceText={sourceTexts[activeIndex] ?? ""}
    gateSkip={activeBox.gateSkip}
    anchorX={boxLeft}
    anchorY={boxBottom}
  />
{/if}

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
