<script lang="ts">
  import { DefaultConfig } from "@/lib/configs";
  import { env } from "@/lib/env";
  import { probeArtifactsCached, fetchAndCacheWithProgress } from "@/lib/utils";
  import ModelSelect from "@/lib/components/ui/ModelSelect.svelte";
  import { Info } from "lucide-svelte";
  import { onMount } from "svelte";

  let {
    ocrMinConfidence = $bindable(DefaultConfig.ocrMinConfidence),
    scriptGate = $bindable(DefaultConfig.scriptGate),
    ocrEngine = $bindable(DefaultConfig.ocrEngine),
    sourceLang = DefaultConfig.sourceLang,
  }: {
    ocrMinConfidence: number;
    scriptGate: boolean;
    ocrEngine?: string;
    sourceLang?: string;
  } = $props();

  const ENGINES = [
    {
      id: "paddle",
      label: "PaddleOCR",
      size: "~90 MB",
      desc: "Fast, lightweight multilingual engine (default)",
    },
    {
      id: "ppocrv6-manga",
      label: "PP-OCRv6 Manga",
      size: "~21 MB",
      desc: "Japanese-only manga fine-tune — a little bit limited but smaller size",
    },
    {
      id: "manga-ocr",
      label: "Manga-OCR",
      size: "~460 MB",
      desc: "Flagship model for Japanese text & vertical writing",
    },
  ];

  let cached: Record<string, boolean> = $state({});
  let loadingId: string | null = $state(null);
  let progress: Record<string, number> = $state({});

  function ocrRepoPath(id: string): { repo: string; path: string }[] {
    // Returns one or more cache entries that must all exist for the engine to be "cached"
    if (id === "manga-ocr") return [{ repo: DefaultConfig.mangaOcrRepo, path: "encoder_model.onnx" }];
    if (id === "ppocrv6-manga") return [{ repo: env.ppocrv6MangaRepo, path: "ppocr-rec-v6-small-manga.onnx" }];
    // paddle is language-dependent; check latin pack as representative (setup ships latin+chinese)
    return [{ repo: DefaultConfig.ocrRepo, path: DefaultConfig.ocrModelPath("latin") }];
  }

  async function probeAll() {
    // Routed through background: see DetectionSettings — same partition issue.
    const allParts = ENGINES.map((e) => ocrRepoPath(e.id));
    const results = await probeArtifactsCached(allParts.flat());
    const next: Record<string, boolean> = {};
    let offset = 0;
    ENGINES.forEach((e, i) => {
      const parts = allParts[i];
      const checks = results.slice(offset, offset + parts.length);
      offset += parts.length;
      next[e.id] = parts.length > 0 && checks.every(Boolean);
    });
    cached = next;
  }

  async function handleDownload(id: string) {
    if (loadingId) return;
    loadingId = id;
    progress = { ...progress, [id]: 0 };
    try {
      if (id === "manga-ocr") {
        const enc = DefaultConfig.mangaOcrRepo;
        await fetchAndCacheWithProgress(enc, "encoder_model.onnx", (l, t) => (progress = { ...progress, [id]: t > 0 ? l / t * 0.45 : 0 }));
        await fetchAndCacheWithProgress(enc, "decoder_model.onnx", (l, t) => (progress = { ...progress, [id]: 0.45 + (t > 0 ? l / t * 0.45 : 0) }));
        await fetchAndCacheWithProgress(enc, "vocab.txt");
        progress = { ...progress, [id]: 1 };
      } else if (id === "ppocrv6-manga") {
        await fetchAndCacheWithProgress(env.ppocrv6MangaRepo, "ppocr-rec-v6-small-manga.onnx", (l, t) => (progress = { ...progress, [id]: t > 0 ? l / t : 0 }));
        progress = { ...progress, [id]: 1 };
      } else {
        // paddle representative
        await fetchAndCacheWithProgress(DefaultConfig.ocrRepo, DefaultConfig.ocrModelPath("latin"), (l, t) => (progress = { ...progress, [id]: t > 0 ? l / t * 0.5 : 0 }));
        await fetchAndCacheWithProgress(DefaultConfig.ocrRepo, DefaultConfig.ocrDictPath("latin"), (l, t) => (progress = { ...progress, [id]: 0.5 + (t > 0 ? l / t * 0.5 : 0) }));
        progress = { ...progress, [id]: 1 };
      }
      try {
        await browser.runtime.sendMessage({ type: "PREFETCH_MODEL", data: { type: "ocr", data: id === "paddle" ? "latin" : id } });
      } catch {}
      await probeAll();
    } catch (e) {
      console.warn("[OcrSettings] download failed", id, e);
      progress = { ...progress, [id]: 0 };
    } finally {
      loadingId = null;
      setTimeout(() => (progress = { ...progress, [id]: 0 }), 1200);
    }
  }

  onMount(() => probeAll());
  $effect(() => {
    ocrEngine;
    probeAll();
  });

  const activeEng = $derived(ENGINES.find((e) => e.id === ocrEngine));
  const engineOptions = $derived(ENGINES.map((e) => ({ id: e.id, label: e.label, size: e.size, desc: e.desc })));
</script>

<div class="space-y-1.5">
  <span class="kicker ml-0.5">
    Text recognition (OCR)
  </span>
  <div class="panel-card !p-2.5 space-y-3">
    <div class="flex flex-col space-y-1.5">
      <ModelSelect
        id="ocr-engine"
        label="OCR Engine"
        bind:value={ocrEngine}
        options={engineOptions}
        {cached}
        {loadingId}
        {progress}
        onDownload={handleDownload}
      />
      {#if activeEng}
        <div class="flex items-center gap-1.5 text-[11px] text-[var(--text-dim)] pt-0.5">
          <span class="font-mono bg-[var(--bg-void)] border border-[var(--border-faint)] px-1.5 py-0.2 rounded-[2px] text-[10px] text-[var(--text-primary)]">
            {activeEng.size}
          </span>
          <span class="text-[var(--text-dim)]">{activeEng.desc}</span>
        </div>
      {/if}
      {#if ocrEngine === "ppocrv6-manga" && sourceLang !== "Japanese"}
        <p class="text-[10px] text-amber-300 leading-snug border border-amber-500/20 bg-amber-950/20 rounded-[3px] px-2 py-1">
          PP-OCRv6 Manga is Japanese-only — results for {sourceLang} may be poor.
        </p>
      {/if}
    </div>

    <div class="flex flex-col space-y-2.5 pt-2 border-t border-[var(--border-faint)]">
      <div class="flex justify-between items-center gap-2">
        <div>
          <span class="text-[10px] font-bold uppercase tracking-widest text-[var(--text-dim)]">
            Language Gate
          </span>
          <p class="text-[11px] text-[var(--text-muted)] mt-0.5 leading-snug max-w-48">
            Skip boxes that aren't in the source language; marked boxes can be translated anyway.
          </p>
        </div>
        <label class="switch-cyber is-amber shrink-0">
          <input type="checkbox" bind:checked={scriptGate} />
          <span class="track"><span class="thumb"></span></span>
        </label>
      </div>

      <div class="flex justify-between items-center">
        <label for="ocr-min-confidence" class="text-[10px] font-bold uppercase tracking-widest text-[var(--text-dim)]">
          Min Confidence
        </label>
        <span class="text-[10px] font-mono font-bold text-[var(--accent-amber)]">
          {Math.round(ocrMinConfidence * 100)}%
        </span>
      </div>
      <input
        id="ocr-min-confidence"
        type="range"
        min="0.1"
        max="1"
        step="0.05"
        bind:value={ocrMinConfidence}
        class="slider-cyber is-amber"
      />
      <p class="text-[11px] text-[var(--text-muted)] mt-1 leading-snug">
        Lower confidence reads more text but may include background noise or drawing artifacts.
      </p>

      <div class="flex gap-1.5 p-2 bg-[var(--bg-void)] border border-[var(--border-line)] rounded-lg text-[var(--text-muted)] text-[11px] leading-snug">
        <Info size={12} class="shrink-0 mt-0.5 text-[var(--accent-amber)]" />
        <p>
          <strong class="font-medium text-[var(--text-primary)]">WebGPU &amp; API Mode only:</strong> Gemini mode ignores this and sends images with drawn bounding boxes directly to Gemini.
        </p>
      </div>
    </div>
  </div>
</div>
