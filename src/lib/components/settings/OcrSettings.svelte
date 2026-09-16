<script lang="ts">
  import { DefaultConfig } from "@/lib/configs";
  import { Info } from "lucide-svelte";

  let {
    ocrMinConfidence = $bindable(DefaultConfig.ocrMinConfidence),
    scriptGate = $bindable(DefaultConfig.scriptGate),
  }: {
    ocrMinConfidence: number;
    scriptGate: boolean;
  } = $props();
</script>

<div>
  <span class="text-sm font-bold uppercase tracking-widest text-zinc-500 ml-1">
    Text Recognition (OCR)
  </span>
  <div
    class="bg-zinc-50 dark:bg-zinc-900/50 p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 mt-2"
  >
    <div class="flex flex-col space-y-2">
      <div class="flex justify-between items-center gap-2">
        <div>
          <span class="text-[10px] font-bold uppercase tracking-widest text-zinc-500">
            Language Gate
          </span>
          <p class="text-[10px] text-zinc-500 dark:text-zinc-400 mt-0.5 leading-snug max-w-48">
            Skip boxes that aren't in the source language; marked boxes can be
            translated anyway.
          </p>
        </div>
        <label class="relative inline-flex items-center cursor-pointer shrink-0">
          <input
            type="checkbox"
            bind:checked={scriptGate}
            class="sr-only peer"
          />
          <div
            class="w-9 h-5 bg-zinc-200 dark:bg-zinc-700 rounded-full peer peer-checked:bg-blue-500 transition-all after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-4"
          ></div>
        </label>
      </div>

      <div class="flex justify-between items-center">
        <label
          for="ocr-min-confidence"
          class="text-[10px] font-bold uppercase tracking-widest text-zinc-500"
        >
          Min Confidence
        </label>
        <span class="text-[10px] font-mono text-zinc-500">
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
        class="w-full h-1.5 bg-zinc-200 dark:bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
      />
      <p class="text-[10px] text-zinc-500 dark:text-zinc-400 mt-1.5 leading-snug">
        Lower confidence reads more text but may include background noise or
        drawing artifacts.
      </p>

      <div
        class="flex gap-1.5 mt-1 p-2 bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800/30 rounded-lg text-amber-700 dark:text-amber-400"
      >
        <Info size={12} class="shrink-0 mt-0.5" />
        <p class="text-[10px] leading-snug">
          <strong>WebGPU &amp; API Mode only:</strong> Gemini mode ignores this
          and sends images with drawn bounding boxes directly to Gemini.
        </p>
      </div>
    </div>
  </div>
</div>
