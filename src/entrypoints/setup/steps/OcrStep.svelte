<script lang="ts">
  import { onMount } from "svelte";
  import {
    LoaderCircle,
    CircleCheck,
    CircleAlert,
    Download,
    ChevronRight,
  } from "lucide-svelte";
  import { DefaultConfig } from "@/lib/configs";
  import { env } from "@/lib/env";
  import { fetchAndCacheWithProgress, isArtifactCached } from "@/lib/utils";

  let {
    selectedOcrEngine = $bindable(DefaultConfig.ocrEngine),
    onBack,
    onNext,
  }: {
    selectedOcrEngine?: string;
    onBack: () => void;
    onNext: () => void;
  } = $props();

  let ocrDownloading = $state(false);
  let ocrDownloaded = $state(false);
  let gateDownloaded = $state(false);
  let ocrProgress = $state(0);
  let ocrProgressText = $state("");
  let ocrError = $state<string | null>(null);

  function ocrEngineLabel(): string {
    if (selectedOcrEngine === "manga-ocr") return "Manga-OCR";
    if (selectedOcrEngine === "ppocrv6-manga") return "PP-OCRv6 Manga";
    if (selectedOcrEngine === "pororo") return "Pororo OCR";
    return "PaddleOCR";
  }

  async function checkOcrStatus(): Promise<boolean> {
    ocrError = null;
    let ocrCached = false;
    if (selectedOcrEngine === "manga-ocr") {
      ocrCached =
        (await isArtifactCached(DefaultConfig.mangaOcrRepo, "encoder_model.onnx")) &&
        (await isArtifactCached(DefaultConfig.mangaOcrRepo, "decoder_model.onnx"));
    } else if (selectedOcrEngine === "ppocrv6-manga") {
      ocrCached = await isArtifactCached(
        env.ppocrv6MangaRepo,
        "ppocr-rec-v6-small-manga.onnx",
      );
    } else if (selectedOcrEngine === "pororo") {
      ocrCached = await isArtifactCached(
        env.pororoModelRepo,
        "brainocr.onnx",
      );
    } else {
      const [latinRec, latinDict, chineseRec, chineseDict] = await Promise.all([
        isArtifactCached(
          DefaultConfig.ocrRepo,
          DefaultConfig.ocrModelPath("latin"),
        ),
        isArtifactCached(
          DefaultConfig.ocrRepo,
          DefaultConfig.ocrDictPath("latin"),
        ),
        isArtifactCached(
          DefaultConfig.ocrRepo,
          DefaultConfig.ocrModelPath("chinese"),
        ),
        isArtifactCached(
          DefaultConfig.ocrRepo,
          DefaultConfig.ocrDictPath("chinese"),
        ),
      ]);
      ocrCached = Boolean(latinRec && latinDict && chineseRec && chineseDict);
    }

    const [gateModel, gateLabels] = await Promise.all([
      isArtifactCached(DefaultConfig.gateRepo, DefaultConfig.gateModelPath),
      isArtifactCached(DefaultConfig.gateRepo, DefaultConfig.gateLabelsPath),
    ]);
    gateDownloaded = Boolean(gateModel && gateLabels);
    ocrDownloaded = ocrCached;
    return ocrCached && gateDownloaded;
  }

  async function startOcrDownload() {
    ocrDownloading = true;
    ocrError = null;
    ocrProgress = 0;
    ocrProgressText = "Preparing download...";
    try {
      if (selectedOcrEngine === "manga-ocr") {
        ocrProgressText = "Downloading Manga-OCR encoder (1/3)...";
        await fetchAndCacheWithProgress(
          DefaultConfig.mangaOcrRepo,
          "encoder_model.onnx",
          (loaded, total) => {
            const pct = total > 0 ? Math.round((loaded / total) * 40) : 0;
            ocrProgress = pct;
            ocrProgressText = `Encoder: ${(loaded / 1024 / 1024).toFixed(1)} MB${total > 0 ? ` / ${(total / 1024 / 1024).toFixed(1)} MB` : ""}`;
          },
        );
        ocrProgressText = "Downloading Manga-OCR decoder (2/3)...";
        await fetchAndCacheWithProgress(
          DefaultConfig.mangaOcrRepo,
          "decoder_model.onnx",
          (loaded, total) => {
            const pct = total > 0 ? 40 + Math.round((loaded / total) * 40) : 40;
            ocrProgress = pct;
            ocrProgressText = `Decoder: ${(loaded / 1024 / 1024).toFixed(1)} MB${total > 0 ? ` / ${(total / 1024 / 1024).toFixed(1)} MB` : ""}`;
          },
        );
        await fetchAndCacheWithProgress(DefaultConfig.mangaOcrRepo, "vocab.txt");
      } else if (selectedOcrEngine === "ppocrv6-manga") {
        ocrProgressText = "Downloading PP-OCRv6 Manga (1/2)...";
        await fetchAndCacheWithProgress(
          env.ppocrv6MangaRepo,
          "ppocr-rec-v6-small-manga.onnx",
          (loaded, total) => {
            const pct = total > 0 ? Math.round((loaded / total) * 80) : 0;
            ocrProgress = pct;
            ocrProgressText = `PP-OCRv6: ${(loaded / 1024 / 1024).toFixed(1)} MB${total > 0 ? ` / ${(total / 1024 / 1024).toFixed(1)} MB` : ""}`;
          },
        );
      } else if (selectedOcrEngine === "pororo") {
        ocrProgressText = "Downloading Pororo OCR (1/2)...";
        await fetchAndCacheWithProgress(
          env.pororoModelRepo,
          "brainocr.onnx",
          (loaded, total) => {
            const pct = total > 0 ? Math.round((loaded / total) * 80) : 0;
            ocrProgress = pct;
            ocrProgressText = `Pororo OCR: ${(loaded / 1024 / 1024).toFixed(1)} MB${total > 0 ? ` / ${(total / 1024 / 1024).toFixed(1)} MB` : ""}`;
          },
        );
        await fetchAndCacheWithProgress(env.pororoModelRepo, "ocr-opt.txt");
      } else {
        const packProgress = (stepIndex: number, steps: number) => (loaded: number, total: number) => {
          const base = ((stepIndex - 1) / steps) * 80;
          const pct = total > 0 ? Math.round((loaded / total) * (80 / steps)) : 0;
          ocrProgress = Math.min(80, Math.round(base + pct));
          ocrProgressText = `OCR Pack ${stepIndex}/${steps}: ${(loaded / 1024 / 1024).toFixed(1)} MB${total > 0 ? ` / ${(total / 1024 / 1024).toFixed(1)} MB` : ""}`;
        };
        await fetchAndCacheWithProgress(
          DefaultConfig.ocrRepo,
          DefaultConfig.ocrModelPath("latin"),
          packProgress(1, 4),
        );
        await fetchAndCacheWithProgress(
          DefaultConfig.ocrRepo,
          DefaultConfig.ocrDictPath("latin"),
          packProgress(2, 4),
        );
        await fetchAndCacheWithProgress(
          DefaultConfig.ocrRepo,
          DefaultConfig.ocrModelPath("chinese"),
          packProgress(3, 4),
        );
        await fetchAndCacheWithProgress(
          DefaultConfig.ocrRepo,
          DefaultConfig.ocrDictPath("chinese"),
          packProgress(4, 4),
        );
      }
      ocrDownloaded = true;

      // Always download language gate model (~3.7 MB)
      ocrProgressText = "Downloading Language Gate model (~3.7 MB)...";
      await fetchAndCacheWithProgress(
        DefaultConfig.gateRepo,
        DefaultConfig.gateModelPath,
        (loaded, total) => {
          const pct = total > 0 ? Math.round((loaded / total) * 20) : 0;
          ocrProgress = Math.min(99, 80 + pct);
          ocrProgressText = `Language Gate: ${(loaded / 1024 / 1024).toFixed(1)} MB${total > 0 ? ` / ${(total / 1024 / 1024).toFixed(1)} MB` : ""}`;
        },
      );
      await fetchAndCacheWithProgress(
        DefaultConfig.gateRepo,
        DefaultConfig.gateLabelsPath,
      );
      gateDownloaded = true;
      ocrProgress = 100;
      ocrProgressText = "All models ready.";
    } catch (err: any) {
      ocrError = err?.message ?? "Failed to download OCR / Language Gate model weights.";
    } finally {
      ocrDownloading = false;
    }
  }

  onMount(() => {
    checkOcrStatus().then((cached) => {
      if (!cached && !ocrDownloading) {
        startOcrDownload();
      }
    });
  });

  $effect(() => {
    if (selectedOcrEngine) {
      checkOcrStatus().then((cached) => {
        if (!cached && !ocrDownloading) {
          startOcrDownload();
        }
      });
    }
  });
</script>

<div class="space-y-4">
  <div>
    <h2 class="text-base font-display font-bold text-[var(--text-primary)]">
      Text Recognition (OCR)
    </h2>
    <p class="text-xs text-[var(--text-muted)] mt-0.5">
      Select the on-device optical character recognition engine.
    </p>
  </div>

  <!-- 4 Stacked OCR Cards -->
  <div class="space-y-2.5">
    <button
      type="button"
      onclick={() => (selectedOcrEngine = "paddle")}
      class="w-full p-3.5 rounded-xl border text-left cursor-pointer transition-all bg-[var(--bg-void)]
        {selectedOcrEngine === 'paddle'
        ? 'border-[var(--accent-cyan)] shadow-[0_0_14px_var(--accent-cyan-glow)]'
        : 'border-[var(--border-line)] hover:border-[var(--border-line)]/80'}"
    >
      <div class="flex items-center justify-between gap-2 mb-1 min-w-0">
        <div class="flex items-center gap-2 min-w-0">
          <span
            class="text-xs font-display font-bold {selectedOcrEngine === 'paddle'
              ? 'text-[var(--accent-cyan)]'
              : 'text-[var(--text-primary)]'}"
          >
            PaddleOCR (Recommended)
          </span>
          <span
            class="badge-cyber is-cyan text-[9px] !py-0.5 !px-1.5 shrink-0 whitespace-nowrap"
          >
            Multilingual
          </span>
        </div>
        <span
          class="badge-cyber text-[10px] font-mono shrink-0 whitespace-nowrap !py-0.5 !px-1.5 {selectedOcrEngine ===
          'paddle'
            ? 'is-cyan'
            : ''}">~90 MB</span
        >
      </div>
      <p
        class="text-[11px] leading-snug {selectedOcrEngine === 'paddle'
          ? 'text-[var(--text-primary)]'
          : 'text-[var(--text-muted)]'}"
      >
        Fast multilingual engine. Ships Latin + Chinese/Japanese packs (other languages download on demand).
      </p>
    </button>

    <button
      type="button"
      onclick={() => (selectedOcrEngine = "ppocrv6-manga")}
      class="w-full p-3.5 rounded-xl border text-left cursor-pointer transition-all bg-[var(--bg-void)]
        {selectedOcrEngine === 'ppocrv6-manga'
        ? 'border-[var(--accent-cyan)] shadow-[0_0_14px_var(--accent-cyan-glow)]'
        : 'border-[var(--border-line)] hover:border-[var(--border-line)]/80'}"
    >
      <div class="flex items-center justify-between gap-2 mb-1 min-w-0">
        <div class="flex items-center gap-2 min-w-0">
          <span
            class="text-xs font-display font-bold {selectedOcrEngine === 'ppocrv6-manga'
              ? 'text-[var(--accent-cyan)]'
              : 'text-[var(--text-primary)]'}"
          >
            PP-OCRv6 Manga
          </span>
          <span
            class="badge-cyber text-[9px] !py-0.5 !px-1.5 shrink-0 whitespace-nowrap"
          >
            Compact
          </span>
        </div>
        <span
          class="badge-cyber text-[10px] font-mono shrink-0 whitespace-nowrap !py-0.5 !px-1.5 {selectedOcrEngine ===
          'ppocrv6-manga'
            ? 'is-cyan'
            : ''}">~21 MB</span
        >
      </div>
      <p
        class="text-[11px] leading-snug {selectedOcrEngine === 'ppocrv6-manga'
          ? 'text-[var(--text-primary)]'
          : 'text-[var(--text-muted)]'}"
      >
        Japanese-only manga fine-tune with a minimal storage footprint.
      </p>
    </button>

    <button
      type="button"
      onclick={() => (selectedOcrEngine = "manga-ocr")}
      class="w-full p-3.5 rounded-xl border text-left cursor-pointer transition-all bg-[var(--bg-void)]
        {selectedOcrEngine === 'manga-ocr'
        ? 'border-[var(--accent-cyan)] shadow-[0_0_14px_var(--accent-cyan-glow)]'
        : 'border-[var(--border-line)] hover:border-[var(--border-line)]/80'}"
    >
      <div class="flex items-center justify-between gap-2 mb-1 min-w-0">
        <div class="flex items-center gap-2 min-w-0">
          <span
            class="text-xs font-display font-bold {selectedOcrEngine === 'manga-ocr'
              ? 'text-[var(--accent-cyan)]'
              : 'text-[var(--text-primary)]'}"
          >
            Manga-OCR
          </span>
          <span
            class="badge-cyber text-[9px] !py-0.5 !px-1.5 shrink-0 whitespace-nowrap"
          >
            High Accuracy
          </span>
        </div>
        <span
          class="badge-cyber text-[10px] font-mono shrink-0 whitespace-nowrap !py-0.5 !px-1.5 {selectedOcrEngine ===
          'manga-ocr'
            ? 'is-cyan'
            : ''}">~460 MB</span
        >
      </div>
      <p
        class="text-[11px] leading-snug {selectedOcrEngine === 'manga-ocr'
          ? 'text-[var(--text-primary)]'
          : 'text-[var(--text-muted)]'}"
      >
        Deep Transformer model for complex Japanese typography and vertical text.
      </p>
    </button>

    <button
      type="button"
      onclick={() => (selectedOcrEngine = "pororo")}
      class="w-full p-3.5 rounded-xl border text-left cursor-pointer transition-all bg-[var(--bg-void)]
        {selectedOcrEngine === 'pororo'
        ? 'border-[var(--accent-cyan)] shadow-[0_0_14px_var(--accent-cyan-glow)]'
        : 'border-[var(--border-line)] hover:border-[var(--border-line)]/80'}"
    >
      <div class="flex items-center justify-between gap-2 mb-1 min-w-0">
        <div class="flex items-center gap-2 min-w-0">
          <span
            class="text-xs font-display font-bold {selectedOcrEngine === 'pororo'
              ? 'text-[var(--accent-cyan)]'
              : 'text-[var(--text-primary)]'}"
          >
            Pororo OCR
          </span>
          <span
            class="badge-cyber text-[9px] !py-0.5 !px-1.5 shrink-0 whitespace-nowrap"
          >
            Korean Specialist
          </span>
        </div>
        <span
          class="badge-cyber text-[10px] font-mono shrink-0 whitespace-nowrap !py-0.5 !px-1.5 {selectedOcrEngine ===
          'pororo'
            ? 'is-cyan'
            : ''}">~74 MB</span
        >
      </div>
      <p
        class="text-[11px] leading-snug {selectedOcrEngine === 'pororo'
          ? 'text-[var(--text-primary)]'
          : 'text-[var(--text-muted)]'}"
      >
        Kakao Brain TPS-VGG-BiLSTM architecture specialized for Korean webtoons and text.
      </p>
    </button>
  </div>

  <!-- OCR Download / Cache Status Card -->
  <div
    class="flex flex-col gap-2 p-3.5 rounded-xl border transition-colors bg-[var(--bg-void)]
      {ocrDownloaded && gateDownloaded
      ? 'border-[var(--accent-emerald)]/40'
      : ocrError
        ? 'border-[var(--accent-rose)]/40'
        : ocrDownloading
          ? 'border-[var(--accent-cyan)]/40'
          : 'border-[var(--border-line)]'}"
  >
    <div class="flex items-center justify-between gap-2">
      <div class="flex items-center gap-2 min-w-0">
        {#if ocrDownloading}
          <LoaderCircle size={15} class="animate-spin text-[var(--accent-cyan)] shrink-0" />
          <span class="text-xs font-medium text-[var(--accent-cyan)] truncate">
            {ocrProgressText}
          </span>
        {:else if ocrDownloaded && gateDownloaded}
          <CircleCheck size={15} class="text-[var(--accent-emerald)] shrink-0" />
          <span class="text-xs font-medium text-[var(--text-primary)] truncate">
            {ocrEngineLabel()} and Language Gate cached and ready.
          </span>
        {:else if ocrError}
          <CircleAlert size={15} class="text-[var(--accent-rose)] shrink-0" />
          <span class="text-xs text-[var(--accent-rose)] truncate">
            {ocrError}
          </span>
        {:else}
          <Download size={15} class="text-[var(--text-dim)] shrink-0" />
          <span class="text-xs text-[var(--text-muted)] truncate">
            Weights not yet downloaded.
          </span>
        {/if}
      </div>

      {#if (!ocrDownloaded || !gateDownloaded) && !ocrDownloading}
        <button
          type="button"
          onclick={startOcrDownload}
          class="btn-primary !py-1 !px-2.5 text-xs font-bold shrink-0 cursor-pointer"
        >
          Download &amp; Cache
        </button>
      {:else if ocrError}
        <button
          type="button"
          onclick={startOcrDownload}
          class="btn-ghost !py-1 !px-2.5 text-xs shrink-0 cursor-pointer"
        >
          Retry
        </button>
      {/if}
    </div>

    {#if ocrDownloading}
      <div class="space-y-1">
        <div
          class="h-1.5 bg-[var(--surface-panel)] rounded-full overflow-hidden border border-[var(--border-faint)]"
        >
          <div
            class="h-full bg-[var(--accent-cyan)] shadow-[0_0_8px_var(--accent-cyan-glow)] rounded-full transition-all duration-300"
            style="width: {ocrProgress}%"
          ></div>
        </div>
        <div class="flex justify-between text-[10px] text-[var(--text-dim)] font-mono">
          <span>{ocrProgressText}</span>
          <span>{ocrProgress}%</span>
        </div>
      </div>
    {/if}

    <!-- Component Status Badges -->
    <div
      class="flex items-center gap-1.5 pt-1 border-t border-[var(--border-faint)] text-[10px] flex-wrap"
    >
      <span class="text-[var(--text-dim)]">Includes:</span>
      <span
        class="badge-cyber {ocrDownloaded
          ? 'is-emerald'
          : 'is-amber'} text-[9px] !py-0.5 !px-1.5"
      >
        {ocrEngineLabel()}: {ocrDownloaded ? "Cached" : "Needs download"}
      </span>
      <span
        class="badge-cyber {gateDownloaded
          ? 'is-emerald'
          : 'is-amber'} text-[9px] !py-0.5 !px-1.5"
      >
        Language Gate: {gateDownloaded ? "Cached (~3.7 MB)" : "Needs download (~3.7 MB)"}
      </span>
    </div>
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
      disabled={!ocrDownloaded || !gateDownloaded || ocrDownloading}
      class="btn-primary flex-1 text-xs !py-2.5 font-bold cursor-pointer disabled:bg-none disabled:bg-[var(--surface-panel-alt)] disabled:border-[var(--border-line)] disabled:text-[var(--text-dim)] disabled:opacity-60 disabled:shadow-none disabled:cursor-not-allowed"
    >
      {#if ocrDownloading}
        <LoaderCircle size={14} class="animate-spin" />
        Downloading...
      {:else}
        Continue
        <ChevronRight size={14} />
      {/if}
    </button>
  </div>
</div>
