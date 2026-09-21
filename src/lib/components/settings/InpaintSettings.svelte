<script lang="ts">
  import { DefaultConfig } from "@/lib/configs";
  import { Info } from "lucide-svelte";

  let {
    inpaintMethod = $bindable(DefaultConfig.inpaintMethod),
  }: {
    inpaintMethod: string;
  } = $props();

  const OPTIONS = [
    {
      id: "fast",
      label: "Fast",
      desc: "Recommended",
    },
    {
      id: "quality",
      label: "Quality",
      desc: "LaMa redraw · ~207 MB · slower",
    },
  ];
</script>

<div>
  <span class="text-sm font-bold uppercase tracking-widest text-zinc-500 ml-1">
    Inpainting
  </span>
  <div
    class="bg-zinc-50 dark:bg-zinc-900/50 p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 mt-2"
  >
    <div class="grid grid-cols-2 gap-2">
      {#each OPTIONS as opt}
        <button
          onclick={() => (inpaintMethod = opt.id)}
          class="px-3 py-2 rounded-lg border text-sm transition-all cursor-pointer text-left shadow-sm
          {inpaintMethod === opt.id
            ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400'
            : 'border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-zinc-700 dark:text-zinc-300 hover:border-zinc-400'}"
        >
          <span class="block font-medium">{opt.label}</span>
          <span class="block text-[10px] opacity-70">{opt.desc}</span>
        </button>
      {/each}
    </div>

    {#if inpaintMethod === "quality"}
      <div class="mt-3 p-2 bg-blue-50 dark:bg-blue-900/10 border border-blue-200 dark:border-blue-800/30 rounded-lg text-blue-700 dark:text-blue-400 text-[10px] leading-snug">
        <strong>Trade-off:</strong> Requires one-time ~207 MB model download and ~500 MB RAM/VRAM. Slower inference (~30–60s per complex region on CPU), but reconstructs screentone, halftone, and art behind text. Regions LaMa declines fall back into Fast automatically.
      </div>
    {/if}

    <div
      class="flex gap-1.5 mt-3 p-2 bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800/30 rounded-lg text-amber-700 dark:text-amber-400"
    >
      <Info size={12} class="shrink-0 mt-0.5" />
      <p class="text-[10px] leading-snug">
        <strong>Fast</strong> fits a text-shaped mask per region and uses the
        lightest engine that passes quality (planar fill, denoise, then Telea).
        <strong>Quality</strong> runs the LaMa redraw model first per region and
        falls back into Fast where LaMa declines.
      </p>
    </div>
  </div>
</div>
