<script lang="ts">
  import {
    GripVertical,
    Bold,
    Italic,
    Underline,
    Type,
    Minus,
    Plus,
    Palette,
  } from "lucide-svelte";

  interface Props {
    boxIndex?: number;
    style?: TextStyle;
    onChange: (style: TextStyle) => void;
    anchorX: number;
    anchorY: number;
  }

  let {
    boxIndex,
    style = {},
    onChange,
    anchorX,
    anchorY,
  }: Props = $props();

  let offsetX = $state(0);
  let offsetY = $state(0);
  let isDragging = $state(false);
  let dragStart = { x: 0, y: 0, initialOffsetX: 0, initialOffsetY: 0 };
  let showColorMenu = $state(false);

  // Reset custom drag offset whenever active box index changes
  $effect(() => {
    void boxIndex;
    offsetX = 0;
    offsetY = 0;
    showColorMenu = false;
  });

  const currentSize = $derived(style?.fontSize ?? 0); // 0 means auto
  const isBold = $derived(!!style?.bold);
  const isItalic = $derived(!!style?.italic);
  const isUnderline = $derived(!!style?.underline);
  const currentColor = $derived(style?.color ?? "#1a1a1a");
  const currentStroke = $derived(style?.strokeColor ?? "rgba(255,255,255,0.85)");

  let hexInputText = $state("");

  // Keep hexInputText synced when currentColor changes
  $effect(() => {
    if (currentColor.startsWith("#")) {
      hexInputText = currentColor.toUpperCase();
    } else {
      hexInputText = currentColor;
    }
  });

  function handleHexInput(e: Event) {
    const val = (e.target as HTMLInputElement).value.trim();
    hexInputText = val;
    let cleanHex = val;
    if (!cleanHex.startsWith("#")) {
      cleanHex = "#" + cleanHex;
    }
    if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(cleanHex)) {
      updateStyle({ color: cleanHex });
    }
  }

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

  function updateStyle(patch: Partial<TextStyle>) {
    onChange({
      ...style,
      ...patch,
    });
  }

  function adjustFontSize(delta: number) {
    const base = currentSize > 0 ? currentSize : 18;
    const next = Math.max(8, Math.min(72, base + delta));
    updateStyle({ fontSize: next });
  }

  function toggleAutoFont() {
    if (currentSize === 0) {
      updateStyle({ fontSize: 20 });
    } else {
      updateStyle({ fontSize: undefined });
    }
  }
</script>

<!-- Draggable Contextual Typography Toolbar -->
<div
  role="toolbar"
  tabindex={-1}
  class="absolute z-60 pointer-events-auto select-none flex items-center gap-1 p-1 rounded-[5px]
         bg-[var(--surface-panel)]/95 border border-[var(--border-line)] shadow-[0_6px_20px_rgba(0,0,0,0.8),0_0_10px_var(--accent-cyan-glow)]
         text-[var(--text-primary)] backdrop-blur-md transition-shadow
         {isDragging ? 'cursor-grabbing ring-1 ring-[var(--accent-cyan)]' : ''}"
  style="left: max(8px, min(calc(100% - 240px), {anchorX + offsetX}px)); top: max(6px, {anchorY + offsetY - 38}px);"
  onmousedown={(e) => e.stopPropagation()}
>
  <!-- Drag Handle -->
  <button
    type="button"
    class="p-1 text-[var(--text-dim)] hover:text-[var(--text-primary)] cursor-grab active:cursor-grabbing focus:outline-none"
    onmousedown={handleMouseDown}
    title="Drag typography toolbar"
    aria-label="Drag typography toolbar"
  >
    <GripVertical size={13} />
  </button>

  <div class="w-px h-4 bg-[var(--border-line)] mx-0.5"></div>

  <!-- Font Size Controls -->
  <div class="flex items-center gap-0.5 bg-[var(--bg-void)]/80 rounded-[3px] p-0.5 border border-[var(--border-faint)]">
    <button
      type="button"
      onclick={() => adjustFontSize(-2)}
      disabled={currentSize === 0}
      class="w-5 h-5 flex items-center justify-center rounded-[2px] text-[var(--text-muted)] hover:text-[var(--accent-cyan)] hover:bg-[var(--surface-panel)] disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"
      title="Decrease font size"
    >
      <Minus size={11} />
    </button>

    <button
      type="button"
      onclick={toggleAutoFont}
      class="px-1.5 h-5 flex items-center justify-center text-[10px] font-mono font-semibold rounded-[2px] cursor-pointer
             {currentSize === 0 ? 'text-[var(--accent-cyan)] bg-[var(--accent-cyan-soft)]' : 'text-[var(--text-primary)] hover:bg-[var(--surface-panel)]'}"
      title={currentSize === 0 ? "Auto-fit font size active (click to set manual)" : "Manual font size (click to toggle auto-fit)"}
    >
      {currentSize === 0 ? "Auto" : `${currentSize}px`}
    </button>

    <button
      type="button"
      onclick={() => adjustFontSize(2)}
      disabled={currentSize === 0}
      class="w-5 h-5 flex items-center justify-center rounded-[2px] text-[var(--text-muted)] hover:text-[var(--accent-cyan)] hover:bg-[var(--surface-panel)] disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"
      title="Increase font size"
    >
      <Plus size={11} />
    </button>
  </div>

  <div class="w-px h-4 bg-[var(--border-line)] mx-0.5"></div>

  <!-- Text Styles: Bold, Italic, Underline -->
  <button
    type="button"
    onclick={() => updateStyle({ bold: !isBold })}
    class="w-6 h-6 flex items-center justify-center rounded-[3px] transition-colors cursor-pointer
           {isBold ? 'bg-[var(--accent-cyan-soft)] text-[var(--accent-cyan)] border border-[var(--accent-cyan)]/50' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-panel-alt)]'}"
    title="Bold (Ctrl+B)"
  >
    <Bold size={12} />
  </button>

  <button
    type="button"
    onclick={() => updateStyle({ italic: !isItalic })}
    class="w-6 h-6 flex items-center justify-center rounded-[3px] transition-colors cursor-pointer
           {isItalic ? 'bg-[var(--accent-cyan-soft)] text-[var(--accent-cyan)] border border-[var(--accent-cyan)]/50' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-panel-alt)]'}"
    title="Italic (Ctrl+I)"
  >
    <Italic size={12} />
  </button>

  <button
    type="button"
    onclick={() => updateStyle({ underline: !isUnderline })}
    class="w-6 h-6 flex items-center justify-center rounded-[3px] transition-colors cursor-pointer
           {isUnderline ? 'bg-[var(--accent-cyan-soft)] text-[var(--accent-cyan)] border border-[var(--accent-cyan)]/50' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-panel-alt)]'}"
    title="Underline (Ctrl+U)"
  >
    <Underline size={12} />
  </button>

  <div class="w-px h-4 bg-[var(--border-line)] mx-0.5"></div>

  <!-- Color Selector Popover Trigger -->
  <div class="relative">
    <button
      type="button"
      onclick={(e) => {
        e.stopPropagation();
        showColorMenu = !showColorMenu;
      }}
      class="h-6 px-1.5 flex items-center gap-1 rounded-[3px] text-[11px] font-mono transition-colors cursor-pointer border border-[var(--border-faint)]
             hover:border-[var(--accent-cyan)]/60 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-panel-alt)]"
      title="Text and outline colors"
    >
      <span
        class="w-3 h-3 rounded-full border border-black/40 shrink-0"
        style:background-color={currentColor}
      ></span>
      <Palette size={11} class="text-[var(--text-dim)]" />
    </button>

    {#if showColorMenu}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <div
        class="absolute left-0 top-8 z-70 p-2.5 rounded-[5px] bg-[var(--surface-panel)] border border-[var(--border-line)]
               shadow-[0_12px_32px_rgba(0,0,0,0.85),0_0_12px_var(--accent-cyan-glow)] flex flex-col gap-2 min-w-[170px]"
        onmousedown={(e) => e.stopPropagation()}
        onclick={(e) => e.stopPropagation()}
      >
        <!-- Text Fill Color -->
        <div>
          <span class="text-[10px] font-mono text-[var(--text-dim)] uppercase block mb-1">Text Color</span>
          <div class="flex items-center gap-1.5">
            <button
              type="button"
              onclick={() => updateStyle({ color: "#1a1a1a" })}
              class="w-5 h-5 rounded-full bg-[#1a1a1a] border {currentColor === '#1a1a1a' ? 'border-[var(--accent-cyan)] ring-1 ring-[var(--accent-cyan)]' : 'border-white/20'} cursor-pointer"
              title="Black text"
            ></button>
            <button
              type="button"
              onclick={() => updateStyle({ color: "#ffffff" })}
              class="w-5 h-5 rounded-full bg-white border {currentColor === '#ffffff' ? 'border-[var(--accent-cyan)] ring-1 ring-[var(--accent-cyan)]' : 'border-black/30'} cursor-pointer"
              title="White text"
            ></button>
            <button
              type="button"
              onclick={() => updateStyle({ color: "#fbbf24" })}
              class="w-5 h-5 rounded-full bg-amber-400 border {currentColor === '#fbbf24' ? 'border-[var(--accent-cyan)] ring-1 ring-[var(--accent-cyan)]' : 'border-black/30'} cursor-pointer"
              title="Amber text"
            ></button>
            <!-- Custom Color Picker Circle -->
            <div
              class="relative w-5 h-5 rounded-full overflow-hidden border border-[var(--border-line)] hover:scale-110 active:scale-95 transition-transform cursor-pointer"
              title="Pick custom hex color"
            >
              <span class="w-full h-full block bg-gradient-to-tr from-rose-500 via-emerald-400 to-cyan-400 pointer-events-none"></span>
              <input
                type="color"
                value={currentColor.startsWith("#") ? currentColor : "#1a1a1a"}
                oninput={(e) => {
                  const val = (e.target as HTMLInputElement).value;
                  hexInputText = val.toUpperCase();
                  updateStyle({ color: val });
                }}
                onchange={(e) => {
                  const val = (e.target as HTMLInputElement).value;
                  hexInputText = val.toUpperCase();
                  updateStyle({ color: val });
                }}
                class="absolute inset-0 w-full h-full opacity-0 cursor-pointer p-0 m-0 border-0"
              />
            </div>
          </div>
        </div>

        <!-- Hex Code Input Field -->
        <div class="flex items-center gap-1.5 pt-1.5 border-t border-[var(--border-hairline)]">
          <span class="text-[10px] font-mono text-[var(--text-dim)] uppercase">Hex</span>
          <div class="flex items-center gap-1 flex-1">
            <div
              class="w-3.5 h-3.5 rounded-full border border-black/40 shrink-0"
              style:background-color={currentColor}
            ></div>
            <input
              type="text"
              bind:value={hexInputText}
              oninput={handleHexInput}
              placeholder="#1a1a1a"
              maxlength="7"
              spellcheck="false"
              class="w-full px-1.5 py-0.5 text-[11px] font-mono rounded-[3px] bg-[var(--surface-panel-alt)] border border-[var(--border-line)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-cyan)] uppercase"
            />
          </div>
        </div>

        <!-- Stroke / Outline Color -->
        <div class="pt-1.5 border-t border-[var(--border-hairline)]">
          <span class="text-[10px] font-mono text-[var(--text-dim)] uppercase block mb-1">Stroke Outline</span>
          <div class="flex items-center gap-1.5">
            <button
              type="button"
              onclick={() => updateStyle({ strokeColor: "rgba(255,255,255,0.85)" })}
              class="px-1.5 py-0.5 text-[10px] font-mono rounded-[3px] border {currentStroke.includes('255,255,255') ? 'border-[var(--accent-cyan)] text-[var(--accent-cyan)] bg-[var(--accent-cyan-soft)]' : 'border-[var(--border-line)] text-[var(--text-muted)]'} cursor-pointer"
            >
              White
            </button>
            <button
              type="button"
              onclick={() => updateStyle({ strokeColor: "#05040b" })}
              class="px-1.5 py-0.5 text-[10px] font-mono rounded-[3px] border {currentStroke === '#05040b' ? 'border-[var(--accent-cyan)] text-[var(--accent-cyan)] bg-[var(--accent-cyan-soft)]' : 'border-[var(--border-line)] text-[var(--text-muted)]'} cursor-pointer"
            >
              Black
            </button>
            <button
              type="button"
              onclick={() => updateStyle({ strokeColor: "none" })}
              class="px-1.5 py-0.5 text-[10px] font-mono rounded-[3px] border {currentStroke === 'none' ? 'border-[var(--accent-cyan)] text-[var(--accent-cyan)] bg-[var(--accent-cyan-soft)]' : 'border-[var(--border-line)] text-[var(--text-muted)]'} cursor-pointer"
            >
              None
            </button>
            <!-- Custom Stroke Color Picker -->
            <div
              class="relative w-5 h-5 rounded-full overflow-hidden border border-[var(--border-line)] hover:scale-110 active:scale-95 transition-transform cursor-pointer"
              title="Pick custom stroke color"
            >
              <span class="w-full h-full block bg-gradient-to-tr from-cyan-400 via-indigo-500 to-pink-500 pointer-events-none"></span>
              <input
                type="color"
                value={currentStroke.startsWith("#") ? currentStroke : "#ffffff"}
                oninput={(e) => updateStyle({ strokeColor: (e.target as HTMLInputElement).value })}
                onchange={(e) => updateStyle({ strokeColor: (e.target as HTMLInputElement).value })}
                class="absolute inset-0 w-full h-full opacity-0 cursor-pointer p-0 m-0 border-0"
              />
            </div>
          </div>
        </div>
      </div>
    {/if}
  </div>
</div>
