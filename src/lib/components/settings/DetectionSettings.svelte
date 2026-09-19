<script lang="ts">
  import { DefaultConfig } from "@/lib/configs";
  import { LoaderCircle } from "lucide-svelte";

  let {
    detectionModel = $bindable(DefaultConfig.detectionModels[0].id),
    detectionMinConfidence = $bindable(0.5),
    detectionAutoUpdate = $bindable(true),
    isFetchingDetection = false,
  }: {
    detectionModel: string;
    detectionMinConfidence: number;
    detectionAutoUpdate: boolean;
    isFetchingDetection?: boolean;
  } = $props();

  const activeModel = $derived(
    DefaultConfig.detectionModels.find((m) => m.id === detectionModel),
  );
</script>

<div>
  <span class="text-sm font-bold uppercase tracking-widest text-zinc-500 ml-1">
    Detection Model
  </span>
  <div
    class="bg-zinc-50 dark:bg-zinc-900/50 p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 mt-2 space-y-4"
  >
    <div class="flex flex-col space-y-1.5">
      <div class="flex items-center justify-between">
        <label
          for="detection-model"
          class="text-[10px] font-bold uppercase tracking-widest text-zinc-500"
        >
          Model Selection
        </label>
        {#if isFetchingDetection}
          <LoaderCircle size={12} class="animate-spin text-blue-500" />
        {/if}
      </div>
      <select
        id="detection-model"
        bind:value={detectionModel}
        class="w-full bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-700 rounded-lg p-2.5 text-sm outline-none cursor-pointer shadow-sm"
      >
        {#each DefaultConfig.detectionModels as model}
          <option value={model.id}>{model.label} ({model.size})</option>
        {/each}
      </select>
      {#if activeModel}
        <div class="flex items-center justify-between text-[11px] text-zinc-500 pt-0.5">
          <div>
            <span class="font-mono bg-zinc-200 dark:bg-zinc-800 px-1.5 py-0.5 rounded text-[10px]">
              {activeModel.size}
            </span>
            {activeModel.desc}
          </div>
        </div>
      {/if}
    </div>

    <div class="grid grid-cols-[1fr_auto] gap-6 items-center pt-1">
      <div class="flex flex-col space-y-2">
        <div class="flex justify-between items-center">
          <label
            for="detection-min-confidence"
            class="text-[10px] font-bold uppercase tracking-widest text-zinc-500"
          >
            Min Confidence
          </label>
          <span class="text-[10px] font-mono text-zinc-500">
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
          class="w-full h-1.5 bg-zinc-200 dark:bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
        />
      </div>

      <div class="flex flex-col items-end space-y-2">
        <span class="text-[10px] font-bold uppercase tracking-widest text-zinc-500">
          Auto-Update
        </span>
        <label class="relative inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            bind:checked={detectionAutoUpdate}
            class="sr-only peer"
          />
          <div
            class="w-9 h-5 bg-zinc-200 dark:bg-zinc-700 rounded-full peer peer-checked:bg-blue-500 transition-all after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-4"
          ></div>
        </label>
      </div>
    </div>
  </div>
</div>
