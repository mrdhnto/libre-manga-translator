<script lang="ts">
  import { onMount } from "svelte";
  import { fade, fly } from "svelte/transition";
  import {
    Download,
    LoaderCircle,
    CircleCheck,
    CircleAlert,
  } from "lucide-svelte";
  import { DefaultConfig } from "@/lib/configs";
  import { MLCEngine, deleteModelAllInfoInCache } from "@mlc-ai/web-llm";

  let selectedLlmModel = $state(DefaultConfig.llmModels[0].id);
  let llmDownloading = $state(false);
  let llmProgress = $state(0);
  let llmProgressText = $state("Preparing...");
  let llmDone = $state(false);
  let llmError = $state<string | null>(null);
  let llmCleaning = $state(false);
  let llmCleaned = $state(false);
  let llmCleanError = $state<string | null>(null);

  onMount(() => {
    const params = new URLSearchParams(window.location.search);
    const modelParam = params.get("model");
    if (modelParam) {
      const found = DefaultConfig.llmModels.find((m) => m.id === modelParam);
      if (found) selectedLlmModel = found.id;
      if (params.get("clean") === "1") {
        cleanLlmModel();
      }
    }
  });

  async function cleanLlmModel() {
    llmCleaning = true;
    llmCleaned = false;
    llmCleanError = null;
    llmDone = false;
    try {
      await deleteModelAllInfoInCache(selectedLlmModel);
      const items = await storage.getItems(["local:cached-llms"]);
      const cached = (items[0].value as string[]) || [];
      await storage.setItem(
        "local:cached-llms",
        cached.filter((m) => m !== selectedLlmModel),
      );
      llmCleaned = true;
    } catch (err: any) {
      llmCleanError = err?.message ?? "Failed to clear cached model.";
    } finally {
      llmCleaning = false;
    }
  }

  async function startLlmDownload() {
    llmDownloading = true;
    llmDone = false;
    llmError = null;
    llmProgress = 0;
    llmProgressText = "Initializing...";
    try {
      const engine = new MLCEngine({
        initProgressCallback: (p) => {
          llmProgress = Math.round((p.progress ?? 0) * 100);
          llmProgressText = p.text ?? "";
        },
      });
      await engine.reload(selectedLlmModel);
      llmDone = true;
      const items = await storage.getItems(["local:cached-llms"]);
      const cached = (items[0].value as string[]) || [];
      if (!cached.includes(selectedLlmModel)) {
        await storage.setItems([
          { key: "local:cached-llms", value: [...cached, selectedLlmModel] },
        ]);
      }
    } catch (err: any) {
      llmError =
        err?.message ??
        "Download failed. Please check your connection and try again.";
    } finally {
      llmDownloading = false;
    }
  }

  function finish() {
    window.close();
  }
</script>

<div
  in:fade={{ duration: 250 }}
  class="bg-[var(--surface-panel)] rounded-2xl border border-[var(--border-line)] shadow-[var(--shadow-panel)] overflow-hidden"
>
  <div class="p-6 sm:p-7 space-y-5">
    <div class="flex items-center gap-3">
      <div
        class="p-2.5 bg-[var(--bg-void)] border border-[var(--border-line)] text-[var(--accent-cyan)] rounded-xl"
      >
        <Download size={18} />
      </div>
      <div>
        <h2 class="text-base font-display font-bold text-[var(--text-primary)]">
          Update Language Model
        </h2>
        <p class="text-xs text-[var(--text-muted)]">
          Downloading new local inference model weights for WebGPU.
        </p>
      </div>
    </div>

    <div class="grid grid-cols-2 gap-2.5">
      {#each DefaultConfig.llmModels as model}
        <button
          type="button"
          onclick={() => (selectedLlmModel = model.id)}
          disabled={llmDownloading}
          class="p-3.5 rounded-xl border text-left cursor-pointer transition-all disabled:opacity-50 disabled:cursor-not-allowed bg-[var(--bg-void)]
            {selectedLlmModel === model.id
            ? 'border-[var(--accent-amber)] shadow-[0_0_14px_var(--accent-amber-glow)]'
            : 'border-[var(--border-line)] hover:border-[var(--border-line)]/80'}"
        >
          <div class="flex items-center justify-between mb-1">
            <p
              class="text-xs font-display font-bold {selectedLlmModel === model.id
                ? 'text-[var(--accent-amber)]'
                : 'text-[var(--text-primary)]'}"
            >
              {model.label}
            </p>
            <span
              class="badge-cyber is-amber text-[10px] !py-0.5 !px-1.5 font-mono"
            >
              {model.vram} VRAM
            </span>
          </div>
          <p
            class="text-[11px] leading-snug {selectedLlmModel === model.id
              ? 'text-[var(--text-primary)]'
              : 'text-[var(--text-muted)]'}"
          >
            {model.desc}
          </p>
        </button>
      {/each}
    </div>

    {#if llmCleaning}
      <div
        in:fly={{ y: 6, duration: 200 }}
        class="flex items-center gap-2.5 p-3 bg-[var(--bg-void)] border border-[var(--accent-amber)]/40 rounded-xl"
      >
        <LoaderCircle
          size={16}
          class="text-[var(--accent-amber)] animate-spin shrink-0"
        />
        <p class="text-xs font-medium text-[var(--accent-amber)]">
          Cleaning up cached model info...
        </p>
      </div>
    {:else if llmCleaned}
      <div
        in:fly={{ y: 6, duration: 200 }}
        class="flex items-center gap-2.5 p-3 bg-[var(--bg-void)] border border-[var(--accent-emerald)]/40 rounded-xl"
      >
        <CircleCheck size={16} class="text-[var(--accent-emerald)] shrink-0" />
        <p class="text-xs font-medium text-[var(--accent-emerald)]">
          Cached model removed. You can download again below or close this tab.
        </p>
      </div>
    {/if}

    {#if llmCleanError}
      <div
        in:fly={{ y: 4, duration: 200 }}
        class="flex items-start gap-2.5 p-3 bg-[var(--bg-void)] border border-[var(--accent-rose)]/40 rounded-xl text-[var(--accent-rose)]"
      >
        <CircleAlert size={14} class="shrink-0 mt-0.5" />
        <p class="text-xs leading-snug">{llmCleanError}</p>
      </div>
    {/if}

    {#if !llmDone}
      <button
        type="button"
        onclick={startLlmDownload}
        disabled={llmDownloading}
        class="w-full btn-primary !py-2.5 text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer"
      >
        {#if llmDownloading}
          <LoaderCircle size={15} class="animate-spin" />
          Downloading...
        {:else}
          <Download size={15} />
          Download Model
        {/if}
      </button>

      {#if llmDownloading}
        <div
          in:fly={{ y: 6, duration: 200 }}
          class="space-y-1.5 p-3 rounded-xl bg-[var(--bg-void)] border border-[var(--border-line)]"
        >
          <div class="flex items-center justify-between text-xs">
            <span class="text-[var(--text-muted)]">Downloading weights</span>
            <span class="font-mono text-[var(--accent-cyan)] font-bold">{llmProgress}%</span>
          </div>
          <div
            class="h-1.5 bg-[var(--surface-panel)] rounded-full overflow-hidden border border-[var(--border-faint)]"
          >
            <div
              class="h-full bg-[var(--accent-cyan)] shadow-[0_0_8px_var(--accent-cyan-glow)] rounded-full transition-all duration-300"
              style="width: {llmProgress}%"
            ></div>
          </div>
          <p class="text-[11px] text-[var(--text-dim)] truncate font-mono">
            {llmProgressText}
          </p>
        </div>
      {/if}
    {:else}
      <div
        in:fly={{ y: 6, duration: 200 }}
        class="flex items-center gap-2.5 p-3 bg-[var(--bg-void)] border border-[var(--accent-emerald)]/40 rounded-xl"
      >
        <CircleCheck size={16} class="text-[var(--accent-emerald)] shrink-0" />
        <p class="text-xs font-medium text-[var(--accent-emerald)]">
          Model weights cached and ready.
        </p>
      </div>
    {/if}

    {#if llmError}
      <div
        class="flex items-start gap-2 p-3 bg-[var(--bg-void)] border border-[var(--accent-rose)]/40 rounded-xl text-[var(--accent-rose)]"
      >
        <CircleAlert size={14} class="shrink-0 mt-0.5" />
        <p class="text-xs leading-snug">{llmError}</p>
      </div>
    {/if}

    <button
      type="button"
      onclick={finish}
      class="w-full btn-ghost text-xs !py-2"
    >
      {llmDone ? "Done" : "Skip"}
    </button>
  </div>
</div>
