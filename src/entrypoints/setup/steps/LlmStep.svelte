<script lang="ts">
  import { fly } from "svelte/transition";
  import {
    Download,
    LoaderCircle,
    CircleCheck,
    CircleAlert,
    ChevronRight,
  } from "lucide-svelte";
  import {
    defaultLlmModelId,
    llmModelDef,
    visibleLlmModels,
  } from "@/lib/configs";

  // Dynamic-only: @mlc-ai/web-llm is a multi-MB prebundled file. A static
  // import would pull it into the setup page's initial chunk and break the
  // 2MB-per-.js Firefox AMO limit. It loads on demand in startLlmDownload /
  // cleanLlmModel instead (own async chunk, fetched on user click). On
  // Firefox builds the branch is statically false, so the bundler drops the
  // chunk entirely — Firefox uses wllama (GGUF).
  const loadWebLlm = () =>
    import.meta.env.FIREFOX
      ? Promise.reject(
          new Error("web-llm backend excluded from Firefox builds"),
        )
      : import("@mlc-ai/web-llm");

  let {
    selectedLlmModel = $bindable(defaultLlmModelId()),
    onBack,
    onNext,
  }: {
    selectedLlmModel?: string;
    onBack: () => void;
    onNext: () => void;
  } = $props();

  const browserLlmModels = visibleLlmModels();
  let llmDownloading = $state(false);
  let llmProgress = $state(0);
  let llmProgressText = $state("Preparing...");
  let llmDone = $state(false);
  let llmError = $state<string | null>(null);

  async function checkLlmStatus(): Promise<boolean> {
    llmError = null;
    const def = llmModelDef(selectedLlmModel);
    if (def.engine === "wllama" && import.meta.env.FIREFOX) {
      if (!def.repo || !def.file) return false;
      try {
        const url = `https://huggingface.co/${def.repo}/resolve/main/${def.file}`;
        const cache = await caches.open(def.repo);
        const res = await cache.match(url);
        const size = res?.ok
          ? parseInt(res.headers.get("content-length") ?? "0", 10)
          : 0;
        const cached = size > 1024;
        llmDone = cached;
        if (cached) {
          llmProgress = 100;
          llmProgressText = `${(size / 1024 / 1024).toFixed(1)} MB cached`;
          const items = await storage.getItems(["local:cached-llms"]);
          const list = (items[0]?.value as string[]) || [];
          if (!list.includes(def.id)) {
            await storage.setItems([
              { key: "local:cached-llms", value: [...list, def.id] },
            ]);
          }
        }
        return cached;
      } catch {
        return false;
      }
    } else {
      const items = await storage.getItems(["local:cached-llms"]);
      const cached = ((items[0]?.value as string[]) || []).includes(selectedLlmModel);
      llmDone = cached;
      return cached;
    }
  }

  $effect(() => {
    if (selectedLlmModel && !llmDownloading) {
      checkLlmStatus();
    }
  });

  async function startLlmDownload() {
    llmDownloading = true;
    llmDone = false;
    llmError = null;
    llmProgress = 0;
    llmProgressText = "Initializing...";
    try {
      const def = llmModelDef(selectedLlmModel);
      if (def.engine === "wllama" && import.meta.env.FIREFOX) {
        const { downloadWllamaModel } = await import("@/lib/wllama");
        await downloadWllamaModel(
          def,
          (loaded, total) => {
            llmProgress =
              total > 0 ? Math.round((loaded / total) * 100) : 0;
            llmProgressText = `${(loaded / 1024 / 1024).toFixed(1)} MB${total > 0 ? ` / ${(total / 1024 / 1024).toFixed(1)} MB` : ""}`;
          },
          (stage) => {
            llmProgressText = stage;
          },
        );
        llmProgress = 100;
      } else {
        const { MLCEngine } = await loadWebLlm();
        const engine = new MLCEngine({
          initProgressCallback: (p) => {
            llmProgress = Math.round((p.progress ?? 0) * 100);
            llmProgressText = p.text ?? "";
          },
        });
        await engine.reload(selectedLlmModel);
      }
      llmDone = true;
      const items = await storage.getItems(["local:cached-llms"]);
      const cached = (items[0]?.value as string[]) || [];
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
</script>

<div class="space-y-4">
  <div>
    <h2 class="text-base font-display font-bold text-[var(--text-primary)]">
      Local Language Model
    </h2>
    <p class="text-xs text-[var(--text-muted)] mt-0.5">
      Download on-device LLM weights for WebGPU offline translation.
    </p>
  </div>

  <!-- Model selection grid -->
  <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
    {#each browserLlmModels as model}
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
          <span class="badge-cyber is-amber text-[10px] !py-0.5 !px-1.5 font-mono">
            {model.vram}{model.engine === "wllama" ? " download" : " VRAM"}
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

  {#if !llmDone}
    <button
      type="button"
      onclick={startLlmDownload}
      disabled={llmDownloading}
      class="w-full btn-primary !py-2.5 text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer"
    >
      {#if llmDownloading}
        <LoaderCircle size={15} class="animate-spin" />
        Downloading Weights...
      {:else}
        <Download size={15} />
        Download Model Weights
      {/if}
    </button>

    {#if llmDownloading}
      <div
        in:fly={{ y: 6, duration: 200 }}
        class="space-y-1.5 p-3 rounded-xl bg-[var(--bg-void)] border border-[var(--border-line)]"
      >
        <div class="flex items-center justify-between text-xs">
          <span class="text-[var(--text-muted)]">Downloading</span>
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
      <p class="text-xs font-medium text-[var(--text-primary)]">
        Model weights downloaded and ready for offline use.
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
      disabled={!llmDone}
      class="btn-primary flex-1 text-xs !py-2.5 font-bold cursor-pointer disabled:bg-none disabled:bg-[var(--surface-panel-alt)] disabled:border-[var(--border-line)] disabled:text-[var(--text-dim)] disabled:opacity-60 disabled:shadow-none disabled:cursor-not-allowed"
    >
      Continue
      <ChevronRight size={14} />
    </button>
  </div>
</div>
