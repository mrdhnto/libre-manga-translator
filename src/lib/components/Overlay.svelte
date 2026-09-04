<script lang="ts">
  import {
    LoaderCircle,
    Check,
    X,
    Trash2,
    Eraser,
    Box,
    Undo,
    Redo,
    ArrowUpNarrowWide,
    ArrowDownUp,
    TriangleAlert,
    PenLine,
    Download,
    Image,
    BoxSelect,
  } from "lucide-svelte";

  interface Props {
    targetImageRect: DOMRect;
    scaleX: number;
    scaleY: number;
    originalSrc: string;
    wrapper: HTMLElement;
    getTranslationCache: () => Promise<
      | {
          bboxes: Bbox[];
          translatedSrc: string;
          translations: Translations;
          sourceTexts?: string[];
        }
      | undefined
    >;
    requestBubbleDetection: () => Promise<Bbox[] | { error: string }>;
    requestTextTranslation: (
      bboxes: Bbox[],
      isManuallySorted: boolean,
    ) => Promise<
      | {
          translations: Translations;
          sourceTexts?: string[];
          context?: { summary: string; dictionary: string };
        }
      | { error: string }
    >;
    renderTranslations: (
      translations: Translations,
      bboxes: Bbox[],
    ) => Promise<string>;
    exportCanvasToJpeg: (canvas: HTMLCanvasElement, quality?: number) => void;
    onClose: () => void;
    onBackToRefine?: () => void;
  }

  const PADDING_PX = 10;

  let {
    targetImageRect,
    scaleX,
    scaleY,
    originalSrc,
    wrapper,
    getTranslationCache,
    requestBubbleDetection,
    requestTextTranslation,
    renderTranslations,
    exportCanvasToJpeg,
    onClose,
    onBackToRefine,
  }: Props = $props();

  let toolbarPosition = $state<"top" | "bottom">("top");
  let mode = $state<"loading" | "refining" | "results">("loading");
  let bboxes = $state<Bbox[]>([]);
  let isManuallySorted = $state(false);
  let translatedUrl = $state("");
  let showOriginal = $state(false);
  let translations = $state<Translations>([]);
  let sourceTexts = $state<string[]>([]);
  let editDrafts = $state<Translations>([]);
  let showEditPanel = $state(false);
  let previousImageUrl = $state("");
  let activeIndex = $state<number | null>(null);
  let dragInfo = $state<{
    index: number;
    handle: string;
    startX: number;
    startY: number;
    initialBox: Bbox;
  } | null>(null);
  let history = $state<Bbox[][]>([]);
  let historyIndex = $state(-1);
  let loadingMsg = $state("Please wait while we find the text...");
  let errorMsg = $state("");
  let errorTimer: ReturnType<typeof setTimeout>;

  function showError(msg: string) {
    clearTimeout(errorTimer);
    errorMsg = msg;
    errorTimer = setTimeout(() => (errorMsg = ""), 2000);
  }

function applyBboxesSort() {
    if (bboxes.length === 0) return;

    let totalHeight = 0;
    bboxes.forEach((box) => {
      totalHeight += box.y2 - box.y1;
    });
    const avgHeight = totalHeight / bboxes.length;

    const originalBboxes = bboxes.slice();

    // Calculate Center coordinates and sort strictly top-to-bottom to prepare for grouping
    const boxesWithCenters = bboxes.map(box => ({
      box,
      centerY: (box.y1 + box.y2) / 2,
      centerX: (box.x1 + box.x2) / 2
    })).sort((a, b) => a.centerY - b.centerY);

    // Agglomerative Clustering: Group into distinct Horizontal Bands (Panels)
    const bands: typeof boxesWithCenters[] = [];
    let currentBand = [boxesWithCenters[0]];
    let currentBandAvgY = boxesWithCenters[0].centerY;

    // 80% of average bubble height is a highly reliable threshold to detect panel gutters
    const yTolerance = avgHeight * 0.8;

    for (let i = 1; i < boxesWithCenters.length; i++) {
      const item = boxesWithCenters[i];
      if (item.centerY - currentBandAvgY < yTolerance) {
        currentBand.push(item);
        currentBandAvgY = currentBand.reduce((sum, curr) => sum + curr.centerY, 0) / currentBand.length;
      } else {
        bands.push(currentBand);
        currentBand = [item];
        currentBandAvgY = item.centerY;
      }
    }
    bands.push(currentBand);

    // Sort inside each panel using Manga Diagonal Flow (Top-Right to Bottom-Left)
    const result: typeof bboxes = [];

    bands.forEach((band) => {
      band.sort((a, b) => {
        // Weight Y twice as heavily as X. This handles edge cases where a bubble is further left, but significantly higher.
        const weightY = 2.0; 

        const scoreA = a.centerX - (a.centerY * weightY);
        const scoreB = b.centerX - (b.centerY * weightY);

        return scoreB - scoreA; 
      });

      result.push(...band.map(item => item.box));
    });

    bboxes = result;

    // Verify if order actually changed to prevent unnecessary history states
    const isChanged = !originalBboxes.every(
      (box, i) => box.x1 === bboxes[i].x1 && box.y1 === bboxes[i].y1
    );

    if (isChanged) saveHistory();
    activeIndex = null;
  }

  function saveHistory() {
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push($state.snapshot(bboxes));
    history = newHistory;
    historyIndex = history.length - 1;
  }

  function undo() {
    if (historyIndex > 0) {
      historyIndex--;
      bboxes = $state.snapshot(history[historyIndex]);
      activeIndex = null;
    }
  }

  function redo() {
    if (historyIndex < history.length - 1) {
      historyIndex++;
      bboxes = $state.snapshot(history[historyIndex]);
      activeIndex = null;
    }
  }

  async function handleConfirm() {
    if (mode !== "refining") return;

    mode = "loading";
    loadingMsg = "Please wait while we translate the text...";
    applyBboxesSort();

    const result = await requestTextTranslation(
      $state.snapshot(bboxes),
      isManuallySorted,
    );
    if (typeof result === "object" && "error" in result) {
      mode = "refining";
      showError(result.error);
      return;
    }

    translations = result.translations ?? [];
    sourceTexts = result.sourceTexts ?? [];

    mode = "loading";
    loadingMsg = "Rendering...";
    try {
      translatedUrl = await renderTranslations(
        $state.snapshot(translations),
        $state.snapshot(bboxes),
      );
    } catch (err) {
      mode = "refining";
      showError((err as Error).message);
      return;
    }
    mode = "results";
  }

  function openEditPanel() {
    if (mode !== "results") return;
    editDrafts = translations.slice();
    showEditPanel = true;
  }

  function closeEditPanel() {
    showEditPanel = false;
  }

  async function applyEdits() {
    showEditPanel = false;
    mode = "loading";
    loadingMsg = "Rendering...";
    try {
      translatedUrl = await renderTranslations(
        $state.snapshot(editDrafts),
        $state.snapshot(bboxes),
      );
      translations = editDrafts.slice();
      mode = "results";
    } catch (err) {
      mode = "results";
      showError((err as Error).message);
    }
  }

  function saveJpg() {
    const imageEl = new window.Image();
    imageEl.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = imageEl.naturalWidth;
      canvas.height = imageEl.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(imageEl, 0, 0);
      exportCanvasToJpeg(canvas, 0.85);
    };
    imageEl.src = translatedUrl;
  }

  function handleBackToRefine() {
    if (mode === "results") {
      previousImageUrl = translatedUrl;
      isManuallySorted = false;
      showEditPanel = false;
      onBackToRefine?.();
      mode = "refining";
    }
  }

  function deleteActiveBox() {
    if (activeIndex !== null) {
      bboxes = bboxes.filter((_, i) => i !== activeIndex);
      isManuallySorted = true;
      saveHistory();
      activeIndex = null;
    }
  }

  function clearAllBoxes() {
    if (bboxes.length === 0) return;
    bboxes = [];
    isManuallySorted = true;
    saveHistory();
    activeIndex = null;
  }

  function addBox() {
    bboxes = [
      ...bboxes,
      {
        x1: targetImageRect.left,
        y1: targetImageRect.top,
        x2: 0.5 * targetImageRect.width + targetImageRect.left,
        y2: 0.5 * targetImageRect.height + targetImageRect.top,
        confidence: 1,
      },
    ];
    isManuallySorted = true;
    saveHistory();
    activeIndex = bboxes.length - 1;
  }

  function handleDragStart(index: number, handle: string) {
    return (e: MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();

      dragInfo = {
        index,
        handle,
        startX: e.clientX,
        startY: e.clientY,
        initialBox: { ...bboxes[index] },
      };
    };
  }

  // Prevent any mouse/pointer/drag interaction inside the overlay from
  // bubbling to the host page. Manga readers bind these on the image/wrapper
  // (click-next-page, drag-to-scroll), so without this trap every click or
  // drag on the overlay flips the page or scrolls the reader.
  // Only stopPropagation: preventDefault would suppress the compatibility
  // mousedown that handleDragStart relies on, and would block focus on the
  // edit-panel textareas.
  function isolateHostEvents(e: Event) {
    e.stopPropagation();
  }

  // Click needs preventDefault too: some readers wrap the img
  // in a native <a href="next-page">, and our overlay mounts inside that
  // anchor. stopPropagation alone does NOT cancel native link navigation -
  // only preventDefault() does. Box drag, textarea focus, and our own button
  // onclick all fire on mousedown/target phase, so preventing click's default
  // action is safe and doesn't interfere with them.
  function isolateHostClick(e: MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
  }

  onMount(async () => {
    const initialCache = await getTranslationCache();

    const rawBboxes = initialCache
      ? initialCache.bboxes
      : await requestBubbleDetection();

    if (!Array.isArray(rawBboxes)) {
      showError(rawBboxes?.error);
      setTimeout(() => onClose(), 5000); // closes after error fades
      return;
    }

    if (rawBboxes.length === 0) {
      showError("No text bubbles detected - add boxes manually");
    }

    // Pad boxes and filter out invalid/phantom boxes (NaN coords, zero or negative area)
    // so user is never stuck with unclickable invisible boxes.
    bboxes = rawBboxes
      .map((box) => ({
        ...box,
        x1: Math.max(0, box.x1 - PADDING_PX),
        y1: Math.max(0, box.y1 - PADDING_PX),
        x2: box.x2 + PADDING_PX,
        y2: box.y2 + PADDING_PX,
      }))
      .filter(
        (b) =>
          Number.isFinite(b.x1) &&
          Number.isFinite(b.y1) &&
          Number.isFinite(b.x2) &&
          Number.isFinite(b.y2) &&
          b.x2 > b.x1 &&
          b.y2 > b.y1,
      );

    applyBboxesSort();
    mode = initialCache ? "results" : "refining";
    translatedUrl = initialCache?.translatedSrc ?? "";
    translations = initialCache?.translations ?? [];
    sourceTexts = initialCache?.sourceTexts ?? [];
  });

  $effect(() => {
    const handleClick = (event: MouseEvent) => {
      const path = event.composedPath() as HTMLElement[];

      if (
        path.some(
          (el) =>
            el.classList?.contains("lmt-box") ||
            el.classList?.contains("handle") ||
            el.id === "lmt-overlay",
        )
      )
        return;

      activeIndex = null;
      event.stopPropagation();
      event.preventDefault();
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      // Never hijack typing inside the edit panel textareas
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "TEXTAREA" || target.tagName === "INPUT")
      )
        return;

      e.preventDefault();

      // If user hits Escape, close the edit panel first, else deselect the box
      if (e.key === "Escape") {
        if (showEditPanel) showEditPanel = false;
        else activeIndex = null;
      }
      // Delete active box if user hits Delete or Backspace
      if (
        (e.key === "Delete" || e.key === "Backspace") &&
        activeIndex !== null
      ) {
        deleteActiveBox();
      }

      // Undo if user click ctrl + z
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        // redo if the shift key being push
        if (e.shiftKey) redo();
        else undo();
      }

      // Undo if user click ctrl + y
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") redo();
    };

    const handleMouseMove = (e: MouseEvent) => {
      // Stop these from bubbling to page-level drag listeners while a box
      // drag/resize is in flight (reader sites track mousemove to page-flip).
      e.stopPropagation();
      e.preventDefault();

      requestAnimationFrame(() => {
        if (!dragInfo) return;
        const { index, handle, startX, startY, initialBox } = dragInfo;

        // Calculate how much the mouse has moved in "natural" pixels
        const dx = (e.clientX - startX) / scaleX;
        const dy = (e.clientY - startY) / scaleY;

        // Handle Moving the whole box
        if (handle === "move") {
          const w = initialBox.x2 - initialBox.x1;
          const h = initialBox.y2 - initialBox.y1;
          bboxes[index].x1 = initialBox.x1 + dx;
          bboxes[index].y1 = initialBox.y1 + dy;
          bboxes[index].x2 = bboxes[index].x1 + w;
          bboxes[index].y2 = bboxes[index].y1 + h;
        } else {
          // Handle Resizing
          if (handle.includes("t")) bboxes[index].y1 = initialBox.y1 + dy;
          if (handle.includes("b")) bboxes[index].y2 = initialBox.y2 + dy;
          if (handle.includes("l")) bboxes[index].x1 = initialBox.x1 + dx;
          if (handle.includes("r")) bboxes[index].x2 = initialBox.x2 + dx;
        }
      });
    };

    const handleMouseUp = (e: MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();

      if (dragInfo) {
        const box = bboxes[dragInfo.index];
        const initialBox = dragInfo.initialBox;

        // Normalize coordinates so x1/y1 is always the top-left
        if (box.x1 > box.x2) [box.x1, box.x2] = [box.x2, box.x1];
        if (box.y1 > box.y2) [box.y1, box.y2] = [box.y2, box.y1];

        // Calculate how far the box actually changed to ignore accidental micro-drags
        const dx1 = Math.abs(box.x1 - initialBox.x1);
        const dy1 = Math.abs(box.y1 - initialBox.y1);
        const dx2 = Math.abs(box.x2 - initialBox.x2);
        const dy2 = Math.abs(box.y2 - initialBox.y2);
        const moveThreshold = 2;

        if (
          dx1 > moveThreshold ||
          dy1 > moveThreshold ||
          dx2 > moveThreshold ||
          dy2 > moveThreshold
        ) {
          isManuallySorted = true;
          saveHistory();
        }
      }
      dragInfo = null;
    };

    if (dragInfo) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    }
    if (mode === "refining")
      window.addEventListener("click", handleClick, { capture: true });
    window.addEventListener("keydown", handleKeyDown);
    wrapper.addEventListener("lmt:back-to-refine", handleBackToRefine);

    return () => {
      if (mode === "refining")
        window.removeEventListener("click", handleClick, { capture: true });
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      window.removeEventListener("lmt:back-to-refine", handleBackToRefine);
    };
  });

  const maskPath = $derived.by(() => {
    if (!bboxes.length || !targetImageRect) return "none";

    const width = targetImageRect.width;
    const height = targetImageRect.height;

    // Start with a path that covers the entire image (clockwise)
    let pathString = `M 0 0 h ${width} v ${height} h -${width} z `;

    // Add each box as a sub-path (counter-clockwise or same direction with evenodd)
    const boxPaths = bboxes
      .map((box) => {
        const x = box.x1 * scaleX;
        const y = box.y1 * scaleY;
        const w = (box.x2 - box.x1) * scaleX;
        const h = (box.y2 - box.y1) * scaleY;
        return `M ${x} ${y} h ${w} v ${h} h -${w} z`;
      })
      .join(" ");

    return `path(evenodd, "${pathString} ${boxPaths}")`;
  });
</script>

<div
    id="lmt-overlay"
    role="presentation"
    class="absolute top-0 left-0 overflow-hidden pointer-events-auto group z-50 w-full h-full"
    onmousedown={isolateHostEvents}
    onpointerdown={isolateHostEvents}
    onpointerup={isolateHostEvents}
    ontouchstart={isolateHostEvents}
    ontouchend={isolateHostEvents}
    ontouchmove={isolateHostEvents}
    oncontextmenu={isolateHostEvents}
    ondblclick={isolateHostEvents}
    ondragstart={isolateHostEvents}
    onclickcapture={(e) => e.preventDefault()}
    onclick={isolateHostClick}
  >
  {#if mode === "loading"}
    <div
      class="absolute inset-0 bg-black/60 backdrop-blur-[1px] flex items-center justify-center z-70"
    >
      <div class="flex flex-col items-center gap-3">
        <LoaderCircle size={40} class="animate-spin text-white" />
        <p class="text-white text-sm font-medium tracking-wide animate-pulse">
          {loadingMsg}
        </p>
      </div>
    </div>
  {/if}

  {#if mode === "refining"}
    <div
      class="absolute left-1/2 -translate-x-1/2 flex items-center gap-2 z-60 transition-all duration-300
    {toolbarPosition === 'top'
        ? 'top-4 flex-col'
        : 'bottom-4 flex-col-reverse'} 
    {dragInfo ? 'opacity-30 pointer-events-none' : ''}"
      onmousedown={(e) => e.stopPropagation()}
      role="presentation"
    >
      <div
        class="relative bg-white shadow-lg rounded-lg p-2 flex gap-2 border border-gray-200"
      >
        <button
          onclick={(e) => {
            e.stopPropagation();
            if (previousImageUrl) {
              translatedUrl = previousImageUrl;
              previousImageUrl = "";
              mode = "results";
            } else onClose();
          }}
          class="absolute -top-2 -right-2 cursor-pointer bg-gray-200 rounded-full p-1 hover:bg-gray-300 transition-colors"
        >
          <X size={18} />
        </button>

        <button
          onclick={() =>
            (toolbarPosition = toolbarPosition === "top" ? "bottom" : "top")}
          class="absolute -top-2 -left-2 cursor-pointer bg-gray-200 rounded-full p-1 hover:bg-gray-300 transition-colors"
        >
          <ArrowDownUp size={18} />
        </button>

        <button
          onclick={addBox}
          class="cursor-pointer flex flex-col items-center justify-center px-3 py-1 rounded text-sm font-medium transition-colors hover:bg-gray-100 text-gray-700 border border-gray-200"
        >
          <Box size={18} />
          <span>Add Box</span>
        </button>

        <button
          onclick={deleteActiveBox}
          class="cursor-pointer flex flex-col items-center justify-center px-3 py-1 rounded text-sm font-medium transition-colors
      {activeIndex === null
            ? 'hover:bg-gray-100 text-gray-700 border border-gray-200'
            : 'border border-blue-200 bg-blue-100 text-blue-700'}"
        >
          <Trash2 size={18} />
          <span>Delete Box</span>
        </button>

        <button
          onclick={clearAllBoxes}
          disabled={bboxes.length === 0}
          title="Clear all OCR boxes to add your own manually"
          class="cursor-pointer flex flex-col items-center justify-center px-3 py-1 rounded text-sm font-medium transition-colors hover:bg-red-100 text-red-700 border border-red-200 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent"
        >
          <Eraser size={18} />
          <span>Clear All</span>
        </button>

        <button
          onclick={() => {
            applyBboxesSort();
          }}
          class="cursor-pointer flex flex-col items-center px-3 py-1 rounded text-sm font-medium transition-colors hover:bg-purple-100 text-purple-700 border border-purple-200"
        >
          <ArrowUpNarrowWide size={18} />
          <span>Auto Sort</span>
        </button>

        <button
          onclick={handleConfirm}
          class="cursor-pointer flex flex-col items-center px-3 py-1 rounded text-sm font-medium transition-colors hover:bg-green-100 text-green-700 border border-green-200"
        >
          <Check size={18} />
          <span>Confirm</span>
        </button>
      </div>

      <div class="flex gap-2">
        <button
          onclick={undo}
          disabled={historyIndex <= 0}
          title="Undo"
          class="cursor-pointer p-1.5 bg-white shadow-sm rounded-md border border-gray-200 text-gray-700 hover:bg-gray-100 transition-colors disabled:opacity-70 disabled:cursor-not-allowed"
        >
          <Undo size={16} />
        </button>

        <button
          onclick={redo}
          disabled={historyIndex >= history.length - 1}
          title="Redo"
          class="cursor-pointer p-1.5 bg-white shadow-sm rounded-md border border-gray-200 text-gray-700 hover:bg-gray-100 transition-colors disabled:opacity-70 disabled:cursor-not-allowed"
        >
          <Redo size={16} />
        </button>
      </div>
    </div>

    {#if bboxes.length > 0}
      <div
        class="absolute inset-0 bg-black/50 pointer-events-none"
        style="
          clip-path: {maskPath};
          transition: none;
          will-change: clip-path;
        "
      ></div>
    {/if}

    {#each bboxes as box, i}
      {@const isActive = activeIndex === i}

      <div
        role="presentation"
        class="lmt-box absolute border-2 p-0 m-0 bg-transparent {isActive
          ? 'border-blue-500 z-50 ring-2 ring-blue-300'
          : 'border-red-500 z-40'}"
        style:left="{box.x1 * scaleX}px"
        style:top="{box.y1 * scaleY}px"
        style:width="{(box.x2 - box.x1) * scaleX}px"
        style:height="{(box.y2 - box.y1) * scaleY}px"
        onmousedown={(e) => {
          e.stopPropagation();
          activeIndex = i;
          handleDragStart(i, "move")(e);
        }}
        title={`Confidence: ${(box.confidence * 100).toPrecision(2)}%`}
      >
        <div
          class="absolute -top-5.5 -left-0.5 bg-red-500 text-white font-bold text-sm px-1.5 py-0.5 min-w-6 text-center rounded-t-sm pointer-events-none"
        >
          {i + 1}
        </div>

        {#if isActive}
          <button
            type="button"
            class="handle top-left"
            onmousedown={handleDragStart(i, "tl")}
            aria-label="Resize top left"
          ></button>
          <button
            type="button"
            class="handle top-right"
            onmousedown={handleDragStart(i, "tr")}
            aria-label="Resize top right"
          ></button>
          <button
            type="button"
            class="handle bottom-left"
            onmousedown={handleDragStart(i, "bl")}
            aria-label="Resize bottom left"
          ></button>
          <button
            type="button"
            class="handle bottom-right"
            onmousedown={handleDragStart(i, "br")}
            aria-label="Resize bottom right"
          ></button>
        {/if}
      </div>
    {/each}
  {/if}

  {#if mode === "results"}
    <img
      src={showOriginal ? originalSrc : translatedUrl}
      alt={showOriginal ? "Original Img" : "Translated Img"}
      class="w-full h-full object-contain"
    />
    <!-- Floating action cluster beside the image -->
    <div
      class="absolute right-1 top-1/2 -translate-y-1/2 flex flex-col gap-1.5 z-50"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => e.stopPropagation()}
      role="presentation"
    >
      <button
        onclick={handleBackToRefine}
        title="Refine Boxes"
        class="cursor-pointer bg-white/90 hover:bg-white shadow-sm rounded-lg p-2 border border-gray-200 text-gray-700 hover:text-amber-600 transition-colors"
      >
        <BoxSelect size={18} />
      </button>
      <button
        onclick={openEditPanel}
        title="Edit translations"
        class="cursor-pointer bg-white/90 hover:bg-white shadow-sm rounded-lg p-2 border border-gray-200 text-gray-700 hover:text-blue-600 transition-colors"
      >
        <PenLine size={18} />
      </button>
      <button
        onclick={saveJpg}
        title="Save as JPG"
        class="cursor-pointer bg-white/90 hover:bg-white shadow-sm rounded-lg p-2 border border-gray-200 text-gray-700 hover:text-green-600 transition-colors"
      >
        <Download size={18} />
      </button>
      <button
        onclick={(e) => {
          e.stopPropagation();
          showOriginal = !showOriginal;
        }}
        title={showOriginal ? "Show Translated" : "Show Original"}
        class="cursor-pointer bg-white/90 hover:bg-white shadow-sm rounded-lg p-2 border border-gray-200 text-gray-700 hover:text-purple-600 transition-colors"
      >
        <Image size={18} />
      </button>
      <button
        onclick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        title="Close"
        class="cursor-pointer bg-white/90 hover:bg-white shadow-sm rounded-lg p-2 border border-gray-200 text-gray-700 hover:text-red-600 transition-colors"
      >
        <X size={18} />
      </button>
    </div>
  {/if}

  {#if showEditPanel}
    <div
      class="absolute inset-0 z-80 bg-black/50 flex items-center justify-center p-10"
      onclick={(e) => e.stopPropagation()}
      role="presentation"
    >
      <div
        class="bg-white rounded-xl shadow-xl w-full max-w-md max-h-full flex flex-col overflow-hidden"
        onclick={(e) => e.stopPropagation()}
        onkeydown={(e) => e.stopPropagation()}
        role="presentation"
      >
        <div class="flex items-center justify-between px-4 py-3 border-b shrink-0">
          <h3 class="font-semibold text-gray-800">Edit Translations</h3>
          <button
            onclick={() => (showEditPanel = false)}
            class="cursor-pointer p-1 rounded hover:bg-gray-100 transition-colors"
          >
            <X size={16} />
          </button>
        </div>
        <div class="overflow-y-auto px-4 py-3 flex flex-col gap-4 flex-1">
          {#each bboxes as box, i}
            {@const isLast = i === bboxes.length - 1}
            <div>
              <label
                class="block text-xs font-medium text-gray-500 mb-1"
                for="lmt-edit-{i}"
              >
                <span class="inline-flex items-center gap-1">
                  <span class="bg-red-500 text-white font-bold text-xs px-1.5 py-0.5 rounded min-w-5 text-center">
                    {i + 1}
                  </span>
                  <span class="text-gray-400 truncate max-w-[260px]"
                    >{sourceTexts[i] ?? "N/A"}</span
                  >
                </span>
              </label>
              <textarea
                id="lmt-edit-{i}"
                bind:value={editDrafts[i]}
                rows={2}
                class="w-full border border-gray-300 rounded-md p-2 text-sm resize-y min-h-[3rem] focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              ></textarea>
            </div>
          {/each}
        </div>
        <div
          class="flex justify-end gap-2 px-4 py-3 border-t shrink-0"
        >
          <button
            onclick={() => (showEditPanel = false)}
            class="cursor-pointer px-3 py-1.5 rounded-md text-sm font-medium border border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onclick={applyEdits}
            class="cursor-pointer px-3 py-1.5 rounded-md text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 transition-colors"
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  {/if}

  {#if errorMsg}
    <div
      class="absolute inset-0 flex items-center justify-center z-70 bg-black/40 backdrop-blur-[1px]"
    >
      <div
        class="flex flex-col items-center gap-3 bg-white rounded-xl shadow-xl px-6 py-5 max-w-[80%] text-center
                animate-[fadeSlideUp_0.3s_ease_forwards]"
      >
        <TriangleAlert size={32} class="text-red-500 shrink-0" />
        <p class="text-sm font-medium text-red-600">{errorMsg}</p>
      </div>
    </div>
  {/if}
</div>

<style>
  @reference "@/assets/app.css";

  .handle {
    @apply absolute w-3 h-3 bg-white border-2 border-blue-500 rounded-full z-50;
    transform: translate(-50%, -50%);
  }
  .top-left {
    top: 0;
    left: 0;
    cursor: nwse-resize;
  }
  .top-right {
    top: 0;
    left: 100%;
    cursor: nesw-resize;
  }
  .bottom-left {
    top: 100%;
    left: 0;
    cursor: nesw-resize;
  }
  .bottom-right {
    top: 100%;
    left: 100%;
    cursor: nwse-resize;
  }
  button {
    appearance: none;
    outline: none;
  }
  @keyframes fadeSlideUp {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
</style>
