<script lang="ts">
  import { DefaultConfig } from "@/lib/configs";
  import { Info } from "lucide-svelte";

  let {
    inpaintMethod = $bindable(DefaultConfig.inpaintMethod),
    inpaintLama = $bindable(DefaultConfig.inpaintLama),
  }: {
    inpaintMethod: string;
    inpaintLama?: boolean;
  } = $props();

  const OPTIONS = [
    {
      id: "auto",
      label: "Auto",
      desc: "Recommended",
    },
    {
      id: "telea",
      label: "Telea",
      desc: "Legacy quality",
    },
    {
      id: "fast",
      label: "Fast",
      desc: "Compatible",
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

    {#if inpaintMethod === "auto"}
      <div class="mt-4 pt-3 border-t border-zinc-200 dark:border-zinc-800">
        <div class="flex justify-between items-center gap-2">
          <div>
            <div class="flex items-center gap-1.5">
              <span class="text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                LaMa Redraw Model
              </span>
              <span class="text-[9px] px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 font-mono">
                ~207 MB
              </span>
            </div>
            <p class="text-[10px] text-zinc-500 dark:text-zinc-400 mt-0.5 leading-snug">
              Deep-learning redraw rung for complex screentone, halftone, and art behind text.
            </p>
          </div>
          <label class="relative inline-flex items-center cursor-pointer shrink-0">
            <input
              type="checkbox"
              bind:checked={inpaintLama}
              class="sr-only peer"
            />
            <div
              class="w-9 h-5 bg-zinc-200 dark:bg-zinc-700 rounded-full peer peer-checked:bg-blue-500 transition-all after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-4"
            ></div>
          </label>
        </div>
        {#if inpaintLama}
          <div class="mt-2 p-2 bg-blue-50 dark:bg-blue-900/10 border border-blue-200 dark:border-blue-800/30 rounded-lg text-blue-700 dark:text-blue-400 text-[10px] leading-snug">
            <strong>Trade-off:</strong> Requires one-time ~207 MB model download and ~500 MB RAM/VRAM. Slightly slower inference (~1-2s per complex region), but avoids flat patches or smudges on screentoned backgrounds.
          </div>
        {/if}
      </div>
    {/if}

    <div
      class="flex gap-1.5 mt-3 p-2 bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800/30 rounded-lg text-amber-700 dark:text-amber-400"
    >
      <Info size={12} class="shrink-0 mt-0.5" />
      <p class="text-[10px] leading-snug">
        <strong>Auto</strong> fits a text-shaped mask per region and uses the
        lightest inpainting engine that passes quality (samples the paper,
        escalates only when needed). <strong>Telea</strong> uses fast-marching
        inpainting on the whole box (better on complex backgrounds, slower on
        large images). <strong>Fast</strong> uses the legacy edge-blend
        (quicker, cruder).
      </p>
    </div>
  </div>
</div>
