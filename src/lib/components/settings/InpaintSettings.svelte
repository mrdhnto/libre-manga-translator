<script lang="ts">
  import { onMount } from "svelte";
  import { DefaultConfig } from "@/lib/configs";
  import { probeArtifactsCached, fetchAndCacheWithProgress } from "@/lib/utils";
  import { Info, Download, LoaderCircle, CircleCheck, CircleAlert } from "lucide-svelte";

  let {
    inpaintMethod = $bindable(DefaultConfig.inpaintMethod),
  }: {
    inpaintMethod: string;
  } = $props();

  let lamaCached = $state(false);
  let lamaDownloading = $state(false);
  let lamaProgress = $state(0);
  let lamaProgressText = $state("");
  let lamaError = $state<string | null>(null);

  async function probeLama() {
    try {
      // Routed through background: Sidebar runs in page content context whose
      // CacheStorage partition is invisible to the extension partition where
      // the wizard/popup/offscreen download. Direct isArtifactCached() here
      // would always read false after a wizard download.
      const [cached] = await probeArtifactsCached([
        { repo: DefaultConfig.lamaRepo, path: DefaultConfig.lamaModelPath },
      ]);
      lamaCached = cached ?? false;
    } catch {
      lamaCached = false;
    }
  }

  onMount(() => {
    probeLama();
  });

  // Re-probe when Quality becomes active (e.g. model downloaded in wizard
  // while the sidebar was already mounted showing Fast).
  $effect(() => {
    if (inpaintMethod === "quality") {
      void probeLama();
    }
  });

  async function startLamaDownload() {
    lamaDownloading = true;
    lamaError = null;
    lamaProgress = 0;
    lamaProgressText = "Connecting...";
    try {
      await fetchAndCacheWithProgress(
        DefaultConfig.lamaRepo,
        DefaultConfig.lamaModelPath,
        (loaded, total) => {
          const pct = total > 0 ? Math.round((loaded / total) * 100) : 0;
          lamaProgress = pct;
          lamaProgressText = `${(loaded / 1024 / 1024).toFixed(1)} MB${total > 0 ? ` / ${(total / 1024 / 1024).toFixed(1)} MB` : ""}`;
        },
      );
      try {
        await browser.runtime.sendMessage({
          type: "PREFETCH_MODEL",
          data: { type: "inpaint", data: "lama" },
        });
      } catch {}
      lamaCached = true;
      lamaProgress = 100;
      await probeLama();
    } catch (err: any) {
      lamaError = err?.message ?? "Failed to download LaMa model weights.";
    } finally {
      lamaDownloading = false;
    }
  }

  function handleSelectQuality() {
    inpaintMethod = "quality";
    if (!lamaCached && !lamaDownloading) {
      startLamaDownload();
    }
  }

  const OPTIONS = [
    {
      id: "fast",
      label: "Fast",
      desc: "Model-Free Ladder (Telea)",
    },
    {
      id: "quality",
      label: "Quality",
      desc: "LaMa Neural Redraw (~197 MB, test: dynamic)",
    },
  ];
</script>

<div class="space-y-1.5">
  <span class="kicker ml-0.5">
    Inpainting
  </span>
  <div class="panel-card !p-2.5 space-y-2.5">
    <div class="grid grid-cols-2 gap-2">
      {#each OPTIONS as opt}
        {@const isSelected = inpaintMethod === opt.id}
        <button
          type="button"
          onclick={() => {
            if (opt.id === "quality") {
              handleSelectQuality();
            } else {
              inpaintMethod = opt.id;
            }
          }}
          class="p-2 rounded-lg border text-left transition-all cursor-pointer flex flex-col justify-between
          {isSelected
            ? (opt.id === 'quality'
                ? 'border-[var(--accent-emerald)] bg-[var(--surface-panel-alt)] text-[var(--accent-emerald)] font-medium shadow-[0_0_8px_var(--accent-emerald-glow)]'
                : 'border-[var(--accent-cyan)] bg-[var(--surface-panel-alt)] text-[var(--accent-cyan)] font-medium shadow-[0_0_8px_var(--accent-cyan-glow)]')
            : 'border-[var(--border-line)] bg-[var(--bg-void)] text-[var(--text-primary)] hover:border-[var(--border-line)]/80'}"
        >
          <div>
            <div class="flex items-center justify-between gap-1 mb-0.5">
              <span class="block font-semibold text-xs {isSelected ? (opt.id === 'quality' ? 'text-[var(--accent-emerald)]' : 'text-[var(--accent-cyan)]') : 'text-[var(--text-primary)]'}">
                {opt.label}
              </span>
              {#if opt.id === "quality"}
                {#if lamaCached}
                  <span class="badge-cyber is-emerald">
                    Cached
                  </span>
                {:else if lamaDownloading}
                  <span class="badge-cyber is-cyan">
                    {lamaProgress}%
                  </span>
                {:else}
                  <span class="badge-cyber is-amber">
                    ~197 MB
                  </span>
                {/if}
              {:else}
                <span class="badge-cyber is-cyan">
                  0 MB
                </span>
              {/if}
            </div>
            <span class="block text-[11px] leading-tight {isSelected ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)]'}">
              {opt.desc}
            </span>
          </div>
        </button>
      {/each}
    </div>

    <!-- Download & Cache Status for LaMa / Quality -->
    {#if inpaintMethod === "quality"}
      <div
        class="flex flex-col gap-2 p-2.5 rounded-lg border transition-colors bg-[var(--bg-void)]
          {lamaCached
          ? 'border-[var(--accent-emerald)]/40'
          : lamaError
            ? 'border-[var(--accent-rose)]/40'
            : lamaDownloading
              ? 'border-[var(--accent-cyan)]/40'
              : 'border-[var(--border-line)]'}"
      >
        <div class="flex items-center justify-between gap-2">
          <div class="flex items-center gap-2 min-w-0">
            {#if lamaDownloading}
              <LoaderCircle size={14} class="animate-spin text-[var(--accent-cyan)] shrink-0" />
              <span class="text-xs font-medium text-[var(--accent-cyan)] truncate">
                Downloading LaMa weights (~197 MB)...
              </span>
            {:else if lamaCached}
              <CircleCheck size={14} class="text-[var(--accent-emerald)] shrink-0" />
              <span class="text-xs font-medium text-[var(--text-primary)] truncate">
                LaMa weights cached and ready.
              </span>
            {:else if lamaError}
              <CircleAlert size={14} class="text-[var(--accent-rose)] shrink-0" />
              <span class="text-xs text-[var(--accent-rose)] truncate">
                {lamaError}
              </span>
            {:else}
              <Download size={14} class="text-[var(--text-dim)] shrink-0" />
              <span class="text-xs text-[var(--text-muted)] truncate">
                LaMa weights (~197 MB) not yet downloaded.
              </span>
            {/if}
          </div>

          {#if !lamaCached && !lamaDownloading}
            <button
              type="button"
              onclick={startLamaDownload}
              class="btn-primary !py-1 !px-2.5 text-xs font-bold shrink-0 cursor-pointer"
            >
              Download Now
            </button>
          {:else if lamaError}
            <button
              type="button"
              onclick={startLamaDownload}
              class="btn-ghost !py-1 !px-2.5 text-xs shrink-0 cursor-pointer"
            >
              Retry
            </button>
          {/if}
        </div>

        {#if lamaDownloading}
          <div class="space-y-1">
            <div class="h-1.5 bg-[var(--surface-panel)] rounded-full overflow-hidden border border-[var(--border-faint)]">
              <div
                class="h-full bg-[var(--accent-cyan)] shadow-[0_0_8px_var(--accent-cyan-glow)] rounded-full transition-all duration-300"
                style="width: {lamaProgress}%"
              ></div>
            </div>
            <div class="flex justify-between text-[10px] text-[var(--text-dim)] font-mono">
              <span>{lamaProgressText}</span>
              <span>{lamaProgress}%</span>
            </div>
          </div>
        {/if}
      </div>

      <div class="p-2 bg-[var(--bg-void)] border border-[var(--border-line)] rounded-lg text-[var(--text-muted)] text-[11px] leading-snug">
        <strong class="text-[var(--text-primary)] font-medium">Neural redraw:</strong> Reconstructs screentone and artwork behind text. Regions LaMa declines fall back into Fast automatically.
      </div>
    {/if}

    <div
      class="flex gap-1.5 p-2 bg-[var(--bg-void)] border border-[var(--border-line)] rounded-lg text-[var(--text-muted)] text-[11px] leading-snug"
    >
      <Info size={12} class="shrink-0 mt-0.5 text-[var(--accent-cyan)]" />
      <p>
        <strong class="font-semibold text-[var(--text-primary)]">Fast:</strong> Planar fill → bilateral denoise → Telea fast-marching.<br />
        <strong class="font-semibold text-[var(--text-primary)]">Quality:</strong> Standalone LaMa pass per region with Fast fallback.
      </p>
    </div>
  </div>
</div>
