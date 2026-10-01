<script lang="ts">
  import { onMount } from "svelte";
  import { Sparkles, LoaderCircle } from "lucide-svelte";
  import { isPending as isRegistryPending } from "@/entrypoints/content/translation-registry";

  let {
    onTranslate,
    getOverlayMode,
    getOverlayProgress,
    isSameSource,
  }: {
    onTranslate?: (img: HTMLImageElement) => void;
    getOverlayMode?: (img: HTMLImageElement) => "idle" | "translating" | "translated";
    getOverlayProgress?: (img: HTMLImageElement) => string;
    isSameSource?: (img: HTMLImageElement, src: string) => boolean;
  } = $props();

  let x = $state(0);
  let y = $state(0);
  let visible = $state(false);
  let status = $state<"idle" | "translating" | "translated">("idle");
  let progressText = $state("Detecting text…");
  let targetImg = $state<HTMLImageElement | null>(null);
  // Pipeline-active image shown without hover (manual click optimistic or
  // auto-queue). Hover takes over while hovering; pointer-leave snaps back.
  let autoImg = $state<HTMLImageElement | null>(null);
  let hoverImg = $state<HTMLImageElement | null>(null);

  let hideTimer: ReturnType<typeof setTimeout> | null = null;
  function cancelHide() {
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
  }
  function scheduleHide() {
    cancelHide();
    if (status === "translating") return;
    hideTimer = setTimeout(() => {
      if (status !== "translating") {
        visible = false;
        targetImg = null;
      }
    }, 250);
  }

  function meetsThreshold(img: HTMLImageElement) {
    const renderedW = img.offsetWidth || img.clientWidth;
    const renderedH = img.offsetHeight || img.clientHeight;
    return (
      (renderedW >= 260 && renderedH >= 260) ||
      (img.naturalWidth >= 260 && img.naturalHeight >= 260)
    );
  }

  function srcMatches(img: HTMLImageElement, src: string) {
    return isSameSource?.(img, src) ?? img.src === src;
  }

  function queryMode(img: HTMLImageElement) {
    return getOverlayMode?.(img) ?? "idle";
  }

  // Adopt the queried overlay mode, except never downgrade an optimistic
  // "translating" while the registry still holds the image pending — the
  // overlay mounts ~1s after click, and re-querying that gap used to flash
  // the pill back to Translate (then hide on pointer-out).
  function adoptMode(img: HTMLImageElement) {
    const q = queryMode(img);
    if (q === "translating") {
      status = q;
      progressText = getOverlayProgress?.(img) ?? "Translating…";
    } else if (status !== "translating" || !isRegistryPending(img.src)) {
      status = q;
    }
    return q;
  }

  function showFor(img: HTMLImageElement, auto: boolean) {
    cancelHide();
    const rect = img.getBoundingClientRect();
    targetImg = img;
    if (auto) autoImg = img;
    x = rect.left + 8;
    y = rect.top + 8;
    visible = true;
    if (adoptMode(img) === "translated") {
      if (auto) autoImg = null;
      scheduleHide();
    }
  }

  // Settle the pill after a terminal-ish signal for the current target.
  // Keeps optimistic "translating" while the registry claim is still pending.
  function settleTarget() {
    if (!targetImg) return;
    if (!document.body.contains(targetImg)) {
      targetImg = null;
      if (autoImg && !document.body.contains(autoImg)) autoImg = null;
      visible = false;
      return;
    }
    const wasAuto = autoImg === targetImg;
    adoptMode(targetImg);
    if (status === "idle" || status === "translated") {
      if (wasAuto) autoImg = null;
      scheduleHide();
    }
  }

  function findImgForSrc(src: string): HTMLImageElement | null {
    const imgs = document.querySelectorAll("img");
    for (const img of imgs) {
      if (
        img instanceof HTMLImageElement &&
        document.body.contains(img) &&
        meetsThreshold(img) &&
        srcMatches(img, src)
      ) {
        return img;
      }
    }
    return null;
  }

  function isActive(img: HTMLImageElement) {
    if (!document.body.contains(img)) return false;
    if (queryMode(img) === "translating") return true;
    try {
      return isRegistryPending(img.src);
    } catch {
      return false;
    }
  }

  function pinFromModeEvent(e: Event) {
    const target = e.target;
    if (!(target instanceof HTMLElement) || typeof target.querySelector !== "function") {
      return null;
    }
    const img = target.querySelector("img");
    if (
      !(img instanceof HTMLImageElement) ||
      !document.body.contains(img) ||
      !meetsThreshold(img)
    ) {
      return null;
    }
    return img;
  }

  function updatePosition() {
    if (visible && targetImg && document.body.contains(targetImg)) {
      const rect = targetImg.getBoundingClientRect();
      x = rect.left + 8;
      y = rect.top + 8;
    }
  }

  onMount(() => {
    function handleMouseOver(e: MouseEvent) {
      const target = e.target;
      if (!(target instanceof HTMLImageElement)) return;
      if (!document.body.contains(target)) return;

      if (!meetsThreshold(target)) return;
      hoverImg = target;
      cancelHide();
      if (targetImg !== target) {
        showFor(target, false);
      } else {
        adoptMode(target);
      }
    }

    function handleMouseOut(e: MouseEvent) {
      if (!(e.target instanceof HTMLImageElement)) return;
      if (e.target === hoverImg) hoverImg = null;
      if (e.target !== targetImg) return;
      // Pinned pipeline image stays visible without hover.
      if (targetImg === autoImg) return;
      // Snap back to the pipeline-active image instead of hiding.
      if (autoImg && isActive(autoImg)) {
        showFor(autoImg, true);
        return;
      }
      scheduleHide();
    }

    function handleScroll() {
      updatePosition();
    }

    function handleModeChange(e: Event) {
      const detail = (e as CustomEvent<{ mode?: string }>).detail;
      if (targetImg) {
        // Foreign overlay chatter must not clobber our target: settleTarget
        // only downgrades when the registry no longer holds it pending.
        settleTarget();
      }
      if (detail?.mode === "loading") {
        const img = pinFromModeEvent(e);
        if (img && img !== autoImg) autoImg = img;
        if (img && !hoverImg && (!targetImg || !isActive(targetImg))) {
          showFor(img, true);
        }
      }
    }

    function handleProgress(e: Event) {
      if (targetImg) {
        const customEvent = e as CustomEvent<{ message?: string }>;
        if (customEvent.detail?.message) {
          progressText = customEvent.detail.message;
        }
      }
    }

    function handleTranslationStatus(e: Event) {
      const detail = (e as CustomEvent<{ src?: string; status?: string }>).detail;
      if (!detail?.src || !detail?.status) return;

      if (detail.status === "pending") {
        const img =
          targetImg && srcMatches(targetImg, detail.src)
            ? targetImg
            : findImgForSrc(detail.src);
        if (!img) return;
        autoImg = img;
        // Stay on the hovered image; pointer-leave snaps back to autoImg.
        if (hoverImg && hoverImg !== img) return;
        if (targetImg !== img) showFor(img, true);
        // No overlay yet → keep generic progress, but show translating.
        if (queryMode(img) === "translating") adoptMode(img);
        else status = "translating";
        return;
      }

      if (detail.status !== "idle" && detail.status !== "done") return;
      // Safety net for queue-dropped / early-return no-ops that never emit
      // lmt:mode-change: fall back to the queried mode — but only for OUR
      // image. Unrelated images' events used to reset the optimistic
      // "translating" set on click (the flash). The registry-pending guard
      // inside settleTarget covers the pre-mount gap.
      if (targetImg && srcMatches(targetImg, detail.src)) settleTarget();
      if (autoImg && autoImg !== targetImg && srcMatches(autoImg, detail.src)) {
        autoImg = null;
      }
    }

    document.addEventListener("mouseover", handleMouseOver, { passive: true });
    document.addEventListener("mouseout", handleMouseOut, { passive: true });
    window.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("resize", handleScroll, { passive: true });
    document.addEventListener("lmt:mode-change", handleModeChange, { passive: true });
    document.addEventListener("lmt:progress", handleProgress, { passive: true });
    document.addEventListener("lmt:translation-status", handleTranslationStatus, { passive: true });

    return () => {
      document.removeEventListener("mouseover", handleMouseOver);
      document.removeEventListener("mouseout", handleMouseOut);
      window.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", handleScroll);
      document.removeEventListener("lmt:mode-change", handleModeChange);
      document.removeEventListener("lmt:progress", handleProgress);
      document.removeEventListener("lmt:translation-status", handleTranslationStatus);
      cancelHide();
    };
  });

  function handleTriggerClick(e: MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    if (status === "idle" && targetImg && document.body.contains(targetImg)) {
      status = "translating";
      progressText = "Detecting text…";
      autoImg = targetImg;
      onTranslate?.(targetImg);
    }
  }

</script>

{#if visible && status !== "translated"}
  <!-- Pinned Floating Container -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="lmt-floating-root fixed z-[999999] pointer-events-auto select-none transition-opacity duration-200"
    style="top: {Math.max(8, y)}px; left: {Math.max(8, x)}px;"
    onmouseenter={cancelHide}
    onmouseleave={scheduleHide}
  >
    <div class="flex items-center rounded-lg">
      <!-- Main Trigger Button -->
      <button
        type="button"
        onclick={handleTriggerClick}
        class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold tracking-wide transition-all cursor-pointer border {status === 'translating' ? 'bg-[var(--surface-panel)] text-[var(--accent-cyan)] border-[var(--accent-cyan-glow)] cursor-wait' : 'bg-[var(--surface-panel)] text-[var(--text-primary)] border-[var(--border-line)] hover:border-[var(--accent-amber)] hover:text-[var(--accent-amber)] hover:shadow-[0_0_12px_var(--accent-amber-glow)]'}"
        title={status === 'translating' ? progressText : 'Translate manga image'}
      >
        {#if status === "translating"}
          <LoaderCircle size={13} class="animate-spin text-[var(--accent-cyan)]" />
          <span class="text-[11px] animate-pulse">{progressText}</span>
        {:else}
          <Sparkles size={13} class="text-[var(--accent-amber)]" />
          <span class="text-[11px]">Translate</span>
        {/if}
      </button>
    </div>
  </div>
{/if}

<style>
  .lmt-floating-root {
    font-family: 'JetBrains Mono', monospace, -apple-system, sans-serif;
  }
</style>
