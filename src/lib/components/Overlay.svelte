<script lang="ts">
  import { TriangleAlert } from "lucide-svelte";
  import { DefaultConfig, resolveLangGroup } from "@/lib/configs";
  import { env } from "@/lib/env";
  import { probeArtifactsCached } from "@/lib/utils";
  import * as Registry from "@/entrypoints/content/translation-registry";
  import {
    OverlayToolbar,
    TextEditModal,
    BubbleEditor,
  } from "@/lib/components/overlay";

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
      opts?: { gateForce?: boolean },
    ) => Promise<
      | {
          translations: Translations;
          sourceTexts?: string[];
          context?: { summary: string; dictionary: string };
          gateSkip?: (GateReason | null)[];
          gate?: DebugEntry["gate"];
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

  let toolbarPosition = $state({ x: 0, y: 12 }); // center-top initial, viewport-relative
  let toolbarDragStart = $state<{ startX: number; startY: number; initialX: number; initialY: number } | null>(null);
  let readingDirection = $state<"rtl" | "ltr">("rtl");
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
  let loadingMsg = $state("Detecting text…");
  let errorMsg = $state("");
  let errorTimer: ReturnType<typeof setTimeout>;

  // Set true to restore the legacy 5s auto-dismiss of error dialogs.
  const ERROR_AUTOCLOSE = false;

  // Load reading direction from localStorage on mount
  $effect(() => {
    const stored = localStorage.getItem("lmt-reading-direction");
    if (stored === "rtl" || stored === "ltr") readingDirection = stored;
  });

  // Persist reading direction to localStorage on change
  $effect(() => {
    localStorage.setItem("lmt-reading-direction", readingDirection);
  });

  function showError(msg: string) {
    clearTimeout(errorTimer);
    errorMsg = msg;
    if (ERROR_AUTOCLOSE) {
      errorTimer = setTimeout(() => (errorMsg = ""), 5000);
    }
  }

  async function handleErrorDismiss() {
    errorMsg = "";
    const skip =
      await storage.getItem<boolean>("sync:skip-bbox-refining");
    if (skip ?? false) {
      onClose();
      return;
    }
    // Detection failed before any boxes existed (mode still "loading"):
    // drop to refining so the user can draw boxes manually.
    mode = "refining";
    Registry.markIdle(originalSrc);
  }

function applyBboxesSort(direction: "rtl" | "ltr" = "rtl") {
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

    // Sort inside each panel using reading flow:
    // RTL (Manga): Top-Right to Bottom-Left
    // LTR (Western/Manhwa): Top-Left to Bottom-Right
    const result: typeof bboxes = [];
    const weightY = 2.0;

    bands.forEach((band) => {
      band.sort((a, b) => {
        if (direction === "ltr") {
          const scoreA = -a.centerX - (a.centerY * weightY);
          const scoreB = -b.centerX - (b.centerY * weightY);
          return scoreB - scoreA;
        } else {
          const scoreA = a.centerX - (a.centerY * weightY);
          const scoreB = b.centerX - (b.centerY * weightY);
          return scoreB - scoreA;
        }
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

  async function executeTranslation() {
    mode = "loading";
    applyBboxesSort();

    // If the expected rec pack isn't cached, say so: otherwise a first-run
    // model download looks like a hang. (Auto-Detect pre-checks latin; the
    // gate may still resolve another script mid-translate — that pack's
    // identity lands in the debug entry via gate.group.)
    try {
      const [srcLang, engine] = await Promise.all([
        storage.getItem<string>("sync:source-lang"),
        storage.getItem<string>("sync:ocr-engine"),
      ]);
      const engineId = engine ?? DefaultConfig.ocrEngine;
      if (engineId !== "gemini" && typeof caches !== "undefined") {
        let langGroup = "";
        let missing = false;
        // Routed through background: Overlay runs in page content context
        // whose CacheStorage partition is invisible to the extension
        // partition where the wizard/popup download.
        if (engineId === "paddle") {
          const { group } = resolveLangGroup(
            srcLang ?? DefaultConfig.sourceLang,
          );
          const [recCached, dictCached] = await probeArtifactsCached([
            { repo: DefaultConfig.ocrRepo, path: DefaultConfig.ocrModelPath(group) },
            { repo: DefaultConfig.ocrRepo, path: DefaultConfig.ocrDictPath(group) },
          ]);
          langGroup = group;
          missing = !recCached || !dictCached;
        } else if (engineId === "ppocrv6-manga") {
          const [cached] = await probeArtifactsCached([
            { repo: env.ppocrv6MangaRepo, path: "ppocr-rec-v6-small-manga.onnx" },
          ]);
          missing = !cached;
        } else if (engineId === "manga-ocr") {
          const [encCached, decCached] = await probeArtifactsCached([
            { repo: DefaultConfig.mangaOcrRepo, path: "encoder_model.onnx" },
            { repo: DefaultConfig.mangaOcrRepo, path: "decoder_model.onnx" },
          ]);
          missing = !encCached || !decCached;
        }
        if (missing) {
          loadingMsg = langGroup === "" ? "Downloading model…" : `Downloading ${langGroup}…`;
        }
      }
    } catch {
      // Cache probe failed — keep the generic message.
    }

    loadingMsg = "Translating text…";

    const result = await requestTextTranslation(
      $state.snapshot(bboxes),
      isManuallySorted,
    );
    if (typeof result === "object" && "error" in result) {
      mode = "refining";
      showError(result.error);
      Registry.markIdle(originalSrc);
      return;
    }

    translations = result.translations ?? [];
    sourceTexts = result.sourceTexts ?? [];

    // The script gate records which regions it held back; those boxes get a
    // dashed mark and a per-box override, their originals stay untouched.
    bboxes.forEach((b, i) => {
      b.gateSkip = result.gateSkip?.[i] ?? undefined;
    });

    mode = "loading";
    loadingMsg = "Rendering…";
    try {
      translatedUrl = await renderTranslations(
        $state.snapshot(translations),
        $state.snapshot(bboxes),
      );
    } catch (err) {
      mode = "refining";
      showError((err as Error).message);
      Registry.markIdle(originalSrc);
      return;
    }
    mode = "results";
    Registry.markDone(originalSrc);
  }

  async function handleConfirm() {
    if (mode !== "refining") return;
    return executeTranslation();
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
    loadingMsg = "Rendering…";
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

  // Gate override escape hatch: the gate is only allowed to be strict because
  // every false positive can be undone with one click (leaving text is
  // recoverable, painting over it is not, so the override runs the same region
  // with the gate bypassed).
  let forcingIndex = $state<number | null>(null);
  async function forceTranslateBox(i: number) {
    if (mode !== "results" || forcingIndex !== null) return;
    forcingIndex = i;
    const box = $state.snapshot(bboxes[i]);
    const result = await requestTextTranslation([box], true, {
      gateForce: true,
    });
    forcingIndex = null;
    if (typeof result === "object" && "error" in result) {
      showError(result.error);
      return;
    }
    const text = result.translations?.[0];
    if (!text) {
      showError("Nothing readable in that box");
      return;
    }
    bboxes[i].gateSkip = undefined;
    translations = translations.map((t, k) => (k === i ? text : t));
    if (result.sourceTexts?.[0]) {
      sourceTexts = sourceTexts.map((s, k) =>
        k === i ? result.sourceTexts![0] : s,
      );
    }
    try {
      translatedUrl = await renderTranslations(
        $state.snapshot(translations),
        $state.snapshot(bboxes),
      );
    } catch (err) {
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
      Registry.markIdle(originalSrc);
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
    const natW = targetImageRect.width / (scaleX || 1);
    const natH = targetImageRect.height / (scaleY || 1);
    const boxW = Math.min(200, natW * 0.4);
    const boxH = Math.min(200, natH * 0.2);
    const startX = (natW - boxW) / 2;
    const startY = (natH - boxH) / 2;

    bboxes = [
      ...bboxes,
      {
        x1: startX,
        y1: startY,
        x2: startX + boxW,
        y2: startY + boxH,
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

  // Keyboard events: stop all keyboard propagation so web manga readers
  // (e.g. MangaFire, Comix) do not intercept typing or overlay shortcuts
  // (such as 'h' for help dialog, 'a'/'d' for chapter flips, 'w'/'s' for scroll).
  function isolateHostKeyboard(e: KeyboardEvent) {
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
      Registry.markIdle(originalSrc);
      // Legacy autoclose preserved behind flag (see ERROR_AUTOCLOSE above).
      if (ERROR_AUTOCLOSE) {
        setTimeout(() => onClose(), 5000); // closes after error fades
      }
      return;
    }

    if (rawBboxes.length === 0) {
      showError("No text bubbles detected - add boxes manually");
    }

    // Filter out invalid/phantom boxes (NaN coords, zero or negative area)
    // so user is never stuck with unclickable invisible boxes.
    // NOTE: Auto-padding (+10px) was removed as detection region-build (+7/+8px)
    // and inpaint/ocr pipelines already add sufficient internal margins.
    // If you need to restore padding per-box, use:
    //   x1: Math.max(0, box.x1 - 4), y1: Math.max(0, box.y1 - 4),
    //   x2: box.x2 + 4, y2: box.y2 + 4
    // Adjust the constant as needed; original was +10px.
    bboxes = rawBboxes
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
    if (initialCache) {
      mode = "results";
      translatedUrl = initialCache.translatedSrc ?? "";
      translations = initialCache.translations ?? [];
      sourceTexts = initialCache.sourceTexts ?? [];
      Registry.markDone(originalSrc);
    } else {
      const [skipRefining, autoTranslate] = await Promise.all([
        storage.getItem<boolean>("sync:skip-bbox-refining"),
        storage.getItem<boolean>("sync:auto-translate"),
      ]);
      if ((skipRefining || autoTranslate) && bboxes.length > 0) {
        await executeTranslation();
      } else {
        mode = "refining";
        Registry.markIdle(originalSrc);
      }
    }
  });

  const handleKeyDown = (e: KeyboardEvent) => {
    // Check if the target is inside this overlay / wrapper
    const path = (e.composedPath?.() || []) as HTMLElement[];
    const isInsideOverlay = path.some(
      (el) => el.id === "lmt-overlay" || el === wrapper,
    );
    // If user is typing in sidebar, popup, or another element on the page, don't hijack keys!
    if (!isInsideOverlay) return;

    // Use composedPath() to inspect the actual target across Shadow DOM boundaries
    const target = (path[0] || e.target) as HTMLElement | null;
    const isEditing =
      target && (target.tagName === "TEXTAREA" || target.tagName === "INPUT");

    if (isEditing) {
      // If user hits Escape while typing, close the edit panel
      if (e.key === "Escape") {
        e.stopPropagation();
        e.preventDefault();
        if (showEditPanel) showEditPanel = false;
        return;
      }
      // Never hijack or preventDefault typing inside edit panel textareas,
      // but always stop propagation so host reader shortcuts (e.g. 'h', 'a'/'d', 'w'/'s') never fire
      e.stopPropagation();
      return;
    }

    // Escape closes error modal first, then edit panel, then deselects box, then closes overlay
    if (e.key === "Escape") {
      e.stopPropagation();
      e.preventDefault();
      if (errorMsg) {
        handleErrorDismiss();
      } else if (showEditPanel) {
        showEditPanel = false;
      } else if (activeIndex !== null) {
        activeIndex = null;
      } else {
        onClose();
      }
      return;
    }

    // Box editing shortcuts only apply in refining mode
    if (mode !== "refining") {
      e.stopPropagation();
      return;
    }

    // Delete active box if user hits Delete or Backspace
    if (
      (e.key === "Delete" || e.key === "Backspace") &&
      activeIndex !== null
    ) {
      e.stopPropagation();
      e.preventDefault();
      deleteActiveBox();
      return;
    }

    // Undo if user click ctrl + z
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      e.stopPropagation();
      e.preventDefault();
      // redo if the shift key being push
      if (e.shiftKey) redo();
      else undo();
      return;
    }

    // Undo if user click ctrl + y
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
      e.stopPropagation();
      e.preventDefault();
      redo();
      return;
    }

    // Stop any other keydown on the overlay from bubbling to the reader
    e.stopPropagation();
    e.preventDefault();
  };

  $effect(() => {
    const handleClick = (event: MouseEvent) => {
      const path = (event.composedPath?.() || []) as HTMLElement[];
      const isInsideOverlay = path.some(
        (el) => el.id === "lmt-overlay" || el === wrapper,
      );
      // NEVER intercept or cancel clicks outside this overlay
      if (!isInsideOverlay) return;

      const isBoxOrHandle = path.some(
        (el) =>
          el.classList?.contains("lmt-box") ||
          el.classList?.contains("handle") ||
          el.getAttribute?.("role") === "toolbar" ||
          el.tagName === "BUTTON",
      );

      if (!isBoxOrHandle) {
        activeIndex = null;
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      // Stop these from bubbling to page-level drag listeners while a box
      // drag/resize is in flight (reader sites track mousemove to page-flip).
      e.stopPropagation();
      e.preventDefault();

      requestAnimationFrame(() => {
        // Toolbar drag
        if (toolbarDragStart) {
          const dx = e.clientX - toolbarDragStart.startX;
          const dy = e.clientY - toolbarDragStart.startY;
          toolbarPosition = {
            x: toolbarDragStart.initialX + dx,
            y: toolbarDragStart.initialY + dy,
          };
          return;
        }

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
      toolbarDragStart = null;
    };

    if (dragInfo || toolbarDragStart) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    }
    if (mode === "refining")
      window.addEventListener("click", handleClick);
    window.addEventListener("keydown", handleKeyDown);
    const handleOpenEdit = () => {
      if (mode === "results") openEditPanel();
    };
    const handleToggleOriginal = () => {
      if (mode === "results") showOriginal = !showOriginal;
    };
    const handleExport = () => {
      if (mode === "results") saveJpg();
    };

    wrapper.addEventListener("lmt:back-to-refine", handleBackToRefine);
    wrapper.addEventListener("lmt:open-edit", handleOpenEdit);
    wrapper.addEventListener("lmt:toggle-original", handleToggleOriginal);
    wrapper.addEventListener("lmt:export-jpeg", handleExport);

    return () => {
      if (mode === "refining")
        window.removeEventListener("click", handleClick);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      wrapper.removeEventListener("lmt:back-to-refine", handleBackToRefine);
      wrapper.removeEventListener("lmt:open-edit", handleOpenEdit);
      wrapper.removeEventListener("lmt:toggle-original", handleToggleOriginal);
      wrapper.removeEventListener("lmt:export-jpeg", handleExport);
    };
  });

  $effect(() => {
    if (wrapper) {
      wrapper.setAttribute("data-lmt-mode", mode);
      wrapper.setAttribute("data-lmt-progress", loadingMsg);
      wrapper.dispatchEvent(
        new CustomEvent("lmt:mode-change", { detail: { mode }, bubbles: true }),
      );
      wrapper.dispatchEvent(
        new CustomEvent("lmt:progress", { detail: { message: loadingMsg }, bubbles: true }),
      );
    }
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
    tabindex="-1"
    class="absolute top-0 left-0 overflow-hidden {mode === 'loading' ? 'pointer-events-none' : 'pointer-events-auto'} group z-50 w-full h-full outline-none"
    onmousedown={isolateHostEvents}
    onpointerdown={isolateHostEvents}
    onpointerup={isolateHostEvents}
    ontouchstart={isolateHostEvents}
    ontouchend={isolateHostEvents}
    ontouchmove={isolateHostEvents}
    oncontextmenu={isolateHostEvents}
    ondblclick={isolateHostEvents}
    ondragstart={isolateHostEvents}
    onwheel={isolateHostEvents}
    onkeydown={handleKeyDown}
    onkeyup={isolateHostKeyboard}
    onkeypress={isolateHostKeyboard}
    onclickcapture={(e) => {
      if (mode !== "loading") e.preventDefault();
    }}
    onclick={isolateHostClick}
  >
  {#if mode === "refining"}
    <OverlayToolbar
      mode="refining"
      hasBboxes={bboxes.length > 0}
      hasActiveBox={activeIndex !== null}
      canUndo={historyIndex > 0}
      canRedo={historyIndex < history.length - 1}
      position={toolbarPosition}
      isDragActive={dragInfo !== null}
      {readingDirection}
      onDragStart={(e) => {
        toolbarDragStart = {
          startX: e.clientX,
          startY: e.clientY,
          initialX: toolbarPosition.x,
          initialY: toolbarPosition.y,
        };
      }}
      onAddBox={addBox}
      onDeleteBox={deleteActiveBox}
      onClearAll={clearAllBoxes}
      onAutoSort={() => applyBboxesSort(readingDirection)}
      onToggleReadingDirection={() => (readingDirection = readingDirection === "rtl" ? "ltr" : "rtl")}
      onConfirm={handleConfirm}
      onUndo={undo}
      onRedo={redo}
      onClose={() => {
        if (previousImageUrl) {
          translatedUrl = previousImageUrl;
          previousImageUrl = "";
          mode = "results";
        } else onClose();
      }}
    />

    <BubbleEditor
      {bboxes}
      {scaleX}
      {scaleY}
      {activeIndex}
      {maskPath}
      onSelectBox={(i) => (activeIndex = i)}
      onDragStart={handleDragStart}
    />
  {/if}

  {#if mode === "results"}
    <img
      src={showOriginal ? originalSrc : translatedUrl}
      alt={showOriginal ? "Original Img" : "Translated Img"}
      class="w-full h-full object-contain select-none pointer-events-none"
    />
    {#if !showOriginal}
      {#each bboxes as box, i}
        {#if box.gateSkip}
          <div
            class="absolute border-2 border-dashed border-amber-500/90 rounded-sm pointer-events-none z-30"
            style:left="{box.x1 * scaleX}px"
            style:top="{box.y1 * scaleY}px"
            style:width="{(box.x2 - box.x1) * scaleX}px"
            style:height="{(box.y2 - box.y1) * scaleY}px"
          >
            <button
              type="button"
              onclick={() => forceTranslateBox(i)}
              disabled={forcingIndex !== null}
              title={box.gateSkip === "not-japanese"
                ? "The language gate read this as a different script"
                : "The language gate could not read this confidently"}
              class="pointer-events-auto absolute bottom-1 left-1/2 -translate-x-1/2 bg-amber-500/95 hover:bg-amber-400 disabled:opacity-60 text-black text-xs font-semibold px-2 py-0.5 rounded shadow whitespace-nowrap cursor-pointer transition-colors"
            >
              {forcingIndex === i ? "Translating..." : "Translate anyway"}
            </button>
          </div>
        {/if}
        {#if box.inpaintDeclined && !box.gateSkip}
          <div
            class="absolute border-2 border-dotted border-rose-500/80 rounded-sm pointer-events-none z-30"
            style:left="{box.x1 * scaleX}px"
            style:top="{box.y1 * scaleY}px"
            style:width="{(box.x2 - box.x1) * scaleX}px"
            style:height="{(box.y2 - box.y1) * scaleY}px"
            title="Inpainting declined: background could not be cleaned cleanly. Original paper retained."
          >
            <div
              class="pointer-events-auto absolute -top-4 right-0 bg-rose-500/90 text-white text-[9px] font-mono px-1 rounded shadow"
              title="Inpainting declined: all ladder rungs failed quality checks"
            >
              Declined
            </div>
          </div>
        {/if}
      {/each}
    {/if}

    <OverlayToolbar
      mode="results"
      {showOriginal}
      onRefine={handleBackToRefine}
      onEditTranslations={openEditPanel}
      onExportJpg={saveJpg}
      onToggleOriginal={() => (showOriginal = !showOriginal)}
      onClose={onClose}
    />
  {/if}

  <TextEditModal
    open={showEditPanel}
    {bboxes}
    {sourceTexts}
    drafts={editDrafts}
    onApply={(updated) => {
      editDrafts = updated;
      applyEdits();
    }}
    onClose={() => (showEditPanel = false)}
  />

  {#if errorMsg}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div
      class="absolute inset-0 flex items-center justify-center z-70 bg-black/60 backdrop-blur-sm pointer-events-auto select-none cursor-pointer"
      onclick={handleErrorDismiss}
      role="alert"
    >
      <div
        role="presentation"
        class="flex flex-col items-center gap-3 bg-[#121a26]/95 border border-rose-500/50 rounded-[6px] shadow-[0_8px_32px_rgba(0,0,0,0.8),0_0_16px_rgba(244,63,94,0.25)] px-6 py-5 max-w-[85%] text-center backdrop-blur-md cursor-default"
        onclick={(e) => e.stopPropagation()}
        onkeydown={(e) => e.stopPropagation()}
      >
        <TriangleAlert size={28} class="text-rose-400 shrink-0" />
        <p class="text-xs font-mono text-rose-200 leading-relaxed max-h-40 overflow-y-auto custom-scrollbar">{errorMsg}</p>
        <button
          type="button"
          onclick={handleErrorDismiss}
          class="mt-1 px-3 py-1 rounded-[3px] bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 text-xs font-mono border border-rose-500/40 cursor-pointer transition-colors"
        >
          Dismiss
        </button>
      </div>
    </div>
  {/if}
</div>

<style>
  button {
    appearance: none;
    outline: none;
  }
</style>
