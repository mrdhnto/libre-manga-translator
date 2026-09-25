<script lang="ts">
  import { onMount } from "svelte";
  import { Sparkles, LoaderCircle } from "lucide-svelte";

  let {
    onTranslate,
    getOverlayMode,
    getOverlayProgress,
  }: {
    onTranslate?: (img: HTMLImageElement) => void;
    getOverlayMode?: (img: HTMLImageElement) => "idle" | "translating" | "translated";
    getOverlayProgress?: (img: HTMLImageElement) => string;
  } = $props();

  let x = $state(0);
  let y = $state(0);
  let visible = $state(false);
  let status = $state<"idle" | "translating" | "translated">("idle");
  let progressText = $state("Detecting text…");
  let targetImg = $state<HTMLImageElement | null>(null);

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

      const renderedW = target.offsetWidth || target.clientWidth;
      const renderedH = target.offsetHeight || target.clientHeight;
      const naturalW = target.naturalWidth;
      const naturalH = target.naturalHeight;

      if (
        (renderedW >= 260 && renderedH >= 260) ||
        (naturalW >= 260 && naturalH >= 260)
      ) {
        cancelHide();
        const rect = target.getBoundingClientRect();
        targetImg = target;
        x = rect.left + 8;
        y = rect.top + 8;
        status = getOverlayMode?.(target) ?? "idle";
        if (status === "translating") {
          progressText = getOverlayProgress?.(target) ?? "Translating…";
        }
        visible = true;
      }
    }

    function handleMouseOut(e: MouseEvent) {
      if (e.target instanceof HTMLImageElement && e.target === targetImg) {
        scheduleHide();
      }
    }

    function handleScroll() {
      updatePosition();
    }

    function handleModeChange() {
      if (targetImg) {
        const prevStatus = status;
        status = getOverlayMode?.(targetImg) ?? "idle";
        if (status === "translating") {
          progressText = getOverlayProgress?.(targetImg) ?? "Translating…";
        } else if (prevStatus === "translating" && status === "idle") {
          scheduleHide();
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
      if (!targetImg) return;
      const detail = (e as CustomEvent<{ status?: string }>).detail;
      if (detail?.status !== "idle" && detail?.status !== "done") return;
      // Safety net for queue-dropped / early-return no-ops that never emit
      // lmt:mode-change: the optimistic "translating" set on click must fall
      // back to "idle" so the next click can retry. Re-query is safe for
      // unrelated images — their events leave our target's mode unchanged.
      const next = getOverlayMode?.(targetImg) ?? "idle";
      if (next !== status) {
        const prevStatus = status;
        status = next;
        if (status === "translating") {
          progressText = getOverlayProgress?.(targetImg) ?? "Translating…";
        } else if (prevStatus === "translating" && status === "idle") {
          scheduleHide();
        }
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
    if (status === "idle" && targetImg) {
      status = "translating";
      progressText = "Detecting text…";
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
