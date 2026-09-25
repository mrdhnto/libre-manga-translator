<script lang="ts">
  import { DefaultConfig, normalizeDetectionModel } from "@/lib/configs";
  import { UNKNOWN_DETECTION_MODEL_MESSAGE } from "@/lib/detections/main";
  import { probeArtifactsCached, fetchAndCacheWithProgress } from "@/lib/utils";
  import ModelSelect from "@/lib/components/ui/ModelSelect.svelte";
  import { onMount } from "svelte";

  let {
    detectionModel = $bindable(DefaultConfig.detectionModels[0].id),
    detectionMinConfidence = $bindable(0.5),
    skipBboxRefining = $bindable(false),
    isFetchingDetection = false,
  }: {
    detectionModel: string;
    detectionMinConfidence: number;
    skipBboxRefining?: boolean;
    isFetchingDetection?: boolean;
  } = $props();

  let cached: Record<string, boolean> = $state({});
  let loadingId: string | null = $state(null);
  let progress: Record<string, number> = $state({});

  function detectionRepoPath(id: string): { repo: string; path: string } {
    const detId = normalizeDetectionModel(id);
    if (detId === "comic-bubble") return { repo: DefaultConfig.rtdetrModelRepo, path: "detector-v4-s_int8.onnx" };
    if (detId === "comic-text-detector") return { repo: "direct-model-cache", path: DefaultConfig.comicTextDetectorUrl };
    throw new Error(UNKNOWN_DETECTION_MODEL_MESSAGE(detId));
  }

  async function probeAll() {
    // Routed through background: sidebar runs in page content context whose
    // CacheStorage partition is invisible to the extension partition.
    const paths = DefaultConfig.detectionModels.map((m) => detectionRepoPath(m.id));
    const results = await probeArtifactsCached(paths);
    const next: Record<string, boolean> = {};
    DefaultConfig.detectionModels.forEach((m, i) => {
      next[m.id] = results[i] ?? false;
    });
    cached = next;
  }

  async function handleDownload(id: string) {
    if (loadingId) return;
    loadingId = id;
    progress = { ...progress, [id]: 0 };
    try {
      // Download in-page for progress UI, then mirror into the extension
      // partition via background so probes (and inference) see it.
      const { repo, path } = detectionRepoPath(id);
      await fetchAndCacheWithProgress(repo, path, (loaded, total) => {
        const frac = total > 0 ? loaded / total : 0;
        progress = { ...progress, [id]: frac };
      });
      progress = { ...progress, [id]: 1 };
      try {
        await browser.runtime.sendMessage({ type: "PREFETCH_MODEL", data: { type: "detection", data: id } });
      } catch {}
      await probeAll();
    } catch (e) {
      console.warn("[DetectionSettings] download failed", id, e);
      progress = { ...progress, [id]: 0 };
    } finally {
      loadingId = null;
      // allow spinner to settle before clearing progress bar
      setTimeout(() => {
        progress = { ...progress, [id]: 0 };
      }, 1200);
    }
  }

  // Keep legacy isFetchingDetection in sync with internal loading
  $effect(() => {
    isFetchingDetection = loadingId !== null;
  });

  onMount(() => {
    probeAll();
  });

  // Re-probe when detectionModel changes externally
  $effect(() => {
    detectionModel;
    probeAll();
  });

  const modelOptions = $derived(
    DefaultConfig.detectionModels.map((m) => ({ id: m.id, label: m.label, size: m.size, desc: m.desc })),
  );

  const activeModel = $derived(
    DefaultConfig.detectionModels.find((m) => m.id === detectionModel),
  );
</script>

<div class="space-y-1.5">
  <span class="kicker ml-0.5">
    Detection model
  </span>
  <div class="panel-card !p-2.5 space-y-3">
    <div class="flex flex-col space-y-1.5">
      <ModelSelect
        id="detection-model"
        label="Model Selection"
        bind:value={detectionModel}
        options={modelOptions}
        {cached}
        {loadingId}
        {progress}
        onDownload={handleDownload}
      />
      {#if activeModel}
        <div class="flex items-center gap-1.5 text-[11px] text-[var(--text-dim)] pt-0.5">
          <span class="font-mono bg-[var(--bg-void)] border border-[var(--border-faint)] px-1.5 py-0.2 rounded-[2px] text-[10px] text-[var(--text-primary)]">
            {activeModel.size}
          </span>
          <span class="text-[var(--text-dim)]">{activeModel.desc}</span>
        </div>
      {/if}
    </div>

    <div class="flex flex-col space-y-1.5 pt-2 border-t border-[var(--border-faint)]">
      <div class="flex justify-between items-center">
        <label for="detection-min-confidence" class="text-[10px] font-bold uppercase tracking-widest text-[var(--text-dim)]">
          Min Confidence
        </label>
        <span class="text-[10px] font-mono font-bold text-[var(--accent-amber)]">
          {Math.round(detectionMinConfidence * 100)}%
        </span>
      </div>
      <input
        id="detection-min-confidence"
        type="range"
        min="0.1"
        max="1"
        step="0.05"
        bind:value={detectionMinConfidence}
        class="slider-cyber is-amber"
      />
    </div>

    <div class="flex items-center justify-between pt-2 border-t border-[var(--border-faint)]">
      <div class="flex flex-col">
        <span class="text-[13px] font-medium text-[var(--text-primary)]">
          Skip bbox editor
        </span>
        <span class="text-[11px] text-[var(--text-muted)]">
          Translate directly after detection (edit boxes later if needed)
        </span>
      </div>
      <label class="switch-cyber is-amber">
        <input type="checkbox" bind:checked={skipBboxRefining} />
        <span class="track"><span class="thumb"></span></span>
      </label>
    </div>
  </div>
</div>
