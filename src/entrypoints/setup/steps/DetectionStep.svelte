<script lang="ts">
  import { onMount, untrack } from "svelte";
  import {
    Cpu,
    LoaderCircle,
    CircleCheck,
    CircleAlert,
    Download,
    ChevronRight,
  } from "lucide-svelte";
  import { DefaultConfig } from "@/lib/configs";
  import { UNKNOWN_DETECTION_MODEL_MESSAGE } from "@/lib/detections/main";
  import { fetchAndCacheWithProgress, isArtifactCached } from "@/lib/utils";

  let {
    detectionModel = $bindable(DefaultConfig.detectionModels[0].id),
    onBack,
    onNext,
  }: {
    detectionModel?: string;
    onBack: () => void;
    onNext: () => void;
  } = $props();

  let prevDetectionModel = untrack(() => detectionModel);
  let detectionPrefetching = $state(false);
  let detectionPrefetched = $state(false);
  let detectionProgress = $state(0);
  let detectionProgressText = $state("");
  let detectionError = $state<string | null>(null);

  async function checkDetectionCache(): Promise<boolean> {
    detectionError = null;
    let cached = false;
    if (detectionModel === "comic-bubble") {
      cached = await isArtifactCached(
        DefaultConfig.rtdetrModelRepo,
        "detector-v4-s_int8.onnx",
      );
    } else if (detectionModel === "comic-text-detector") {
      cached = await isArtifactCached(
        "direct-model-cache",
        DefaultConfig.comicTextDetectorUrl,
      );
    } else {
      throw new Error(UNKNOWN_DETECTION_MODEL_MESSAGE(detectionModel));
    }
    detectionPrefetched = cached;
    return cached;
  }

  async function prefetchDetection() {
    detectionPrefetching = true;
    detectionError = null;
    detectionProgress = 0;
    detectionProgressText = "Connecting...";
    try {
      const isCached = await checkDetectionCache();
      if (isCached) {
        detectionPrefetched = true;
        detectionProgress = 100;
        detectionPrefetching = false;
        return;
      }

      const onProgress = (loaded: number, total: number) => {
        const pct = total > 0 ? Math.round((loaded / total) * 100) : 0;
        detectionProgress = pct;
        detectionProgressText = `${(loaded / 1024 / 1024).toFixed(1)} MB${total > 0 ? ` / ${(total / 1024 / 1024).toFixed(1)} MB` : ""}`;
      };

      if (detectionModel === "comic-bubble") {
        await fetchAndCacheWithProgress(
          DefaultConfig.rtdetrModelRepo,
          "detector-v4-s_int8.onnx",
          onProgress,
        );
      } else if (detectionModel === "comic-text-detector") {
        await fetchAndCacheWithProgress(
          "direct-model-cache",
          DefaultConfig.comicTextDetectorUrl,
          onProgress,
        );
      } else {
        throw new Error(UNKNOWN_DETECTION_MODEL_MESSAGE(detectionModel));
      }
      detectionPrefetched = true;
      detectionProgress = 100;
      prevDetectionModel = detectionModel;
    } catch (err: any) {
      detectionError =
        err?.message ?? "Could not cache the model. Please check connection and retry.";
    } finally {
      detectionPrefetching = false;
    }
  }

  onMount(() => {
    checkDetectionCache().then((cached) => {
      if (!cached && !detectionPrefetching) {
        prefetchDetection();
      }
    });
  });

  $effect(() => {
    if (detectionModel) {
      if (prevDetectionModel !== detectionModel) {
        detectionPrefetched = false;
        prevDetectionModel = detectionModel;
        checkDetectionCache().then((cached) => {
          if (!cached && !detectionPrefetching) {
            prefetchDetection();
          }
        });
      }
    }
  });
</script>

<div class="space-y-4">
  <div>
    <h2 class="text-base font-display font-bold text-[var(--text-primary)]">
      Bubble Detection Model
    </h2>
    <p class="text-xs text-[var(--text-muted)] mt-0.5">
      Choose the detection model used to locate text bubbles on pages.
    </p>
  </div>

  <!-- Detection model grid -->
  <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
    {#each DefaultConfig.detectionModels as model}
      <button
        type="button"
        onclick={() => (detectionModel = model.id)}
        class="p-3.5 rounded-xl border text-left cursor-pointer transition-all disabled:opacity-60 disabled:cursor-not-allowed bg-[var(--bg-void)]
          {detectionModel === model.id
          ? 'border-[var(--accent-cyan)] shadow-[0_0_14px_var(--accent-cyan-glow)]'
          : 'border-[var(--border-line)] hover:border-[var(--border-line)]/80'}"
      >
        <div class="flex items-start justify-between gap-2 mb-1.5 min-w-0">
          <div class="flex items-start gap-1.5 min-w-0 flex-1">
            <Cpu
              size={14}
              class="shrink-0 mt-0.5 {detectionModel === model.id
                ? 'text-[var(--accent-cyan)]'
                : 'text-[var(--text-dim)]'}"
            />
            <span
              class="text-xs font-display font-bold leading-snug {detectionModel === model.id
                ? 'text-[var(--accent-cyan)]'
                : 'text-[var(--text-primary)]'}"
            >
              {model.label}
            </span>
          </div>
          <span
            class="badge-cyber text-[10px] font-mono shrink-0 whitespace-nowrap !py-0.5 !px-1.5 {detectionModel === model.id
              ? 'is-cyan'
              : ''}"
          >
            {model.size}
          </span>
        </div>
        <p
          class="text-[11px] leading-snug {detectionModel === model.id
            ? 'text-[var(--text-primary)]'
            : 'text-[var(--text-muted)]'}"
        >
          {model.desc}
        </p>
      </button>
    {/each}
  </div>

  <!-- Prefetch Status Panel -->
  <div
    class="flex flex-col gap-2 p-3.5 rounded-xl border transition-colors bg-[var(--bg-void)]
      {detectionPrefetched
      ? 'border-[var(--accent-emerald)]/40'
      : detectionError
        ? 'border-[var(--accent-rose)]/40'
        : detectionPrefetching
          ? 'border-[var(--accent-cyan)]/40'
          : 'border-[var(--border-line)]'}"
  >
    <div class="flex items-center justify-between gap-2">
      <div class="flex items-center gap-2 min-w-0">
        {#if detectionPrefetching}
          <LoaderCircle size={15} class="animate-spin text-[var(--accent-cyan)] shrink-0" />
          <span class="text-xs font-medium text-[var(--accent-cyan)] truncate">
            Downloading detector weights...
          </span>
        {:else if detectionPrefetched}
          <CircleCheck size={15} class="text-[var(--accent-emerald)] shrink-0" />
          <span class="text-xs font-medium text-[var(--text-primary)] truncate">
            Model cached and ready for inference.
          </span>
        {:else if detectionError}
          <CircleAlert size={15} class="text-[var(--accent-rose)] shrink-0" />
          <span class="text-xs text-[var(--accent-rose)] truncate">
            {detectionError}
          </span>
        {:else}
          <Download size={15} class="text-[var(--text-dim)] shrink-0" />
          <span class="text-xs text-[var(--text-muted)] truncate">
            Weights not yet downloaded.
          </span>
        {/if}
      </div>

      {#if !detectionPrefetched && !detectionPrefetching}
        <button
          type="button"
          onclick={prefetchDetection}
          class="btn-primary !py-1 !px-2.5 text-xs font-bold shrink-0 cursor-pointer"
        >
          Download &amp; Cache
        </button>
      {:else if detectionError}
        <button
          type="button"
          onclick={prefetchDetection}
          class="btn-ghost !py-1 !px-2.5 text-xs shrink-0 cursor-pointer"
        >
          Retry
        </button>
      {/if}
    </div>

    {#if detectionPrefetching}
      <div class="space-y-1">
        <div
          class="h-1.5 bg-[var(--surface-panel)] rounded-full overflow-hidden border border-[var(--border-faint)]"
        >
          <div
            class="h-full bg-[var(--accent-cyan)] shadow-[0_0_8px_var(--accent-cyan-glow)] rounded-full transition-all duration-300"
            style="width: {detectionProgress}%"
          ></div>
        </div>
        <div class="flex justify-between text-[10px] text-[var(--text-dim)] font-mono">
          <span>{detectionProgressText}</span>
          <span>{detectionProgress}%</span>
        </div>
      </div>
    {/if}
  </div>

  <!-- Navigation -->
  <div class="flex items-center gap-2.5 pt-2 border-t border-[var(--border-faint)]">
    <button
      type="button"
      onclick={onBack}
      class="btn-ghost flex-1 text-xs !py-2.5 cursor-pointer"
    >
      Back
    </button>
    <button
      type="button"
      onclick={onNext}
      disabled={!detectionPrefetched || detectionPrefetching}
      class="btn-primary flex-1 text-xs !py-2.5 font-bold cursor-pointer disabled:bg-none disabled:bg-[var(--surface-panel-alt)] disabled:border-[var(--border-line)] disabled:text-[var(--text-dim)] disabled:opacity-60 disabled:shadow-none disabled:cursor-not-allowed"
    >
      {#if detectionPrefetching}
        <LoaderCircle size={14} class="animate-spin" />
        Downloading...
      {:else}
        Continue
        <ChevronRight size={14} />
      {/if}
    </button>
  </div>
</div>
