<script lang="ts">
  import {
    DefaultConfig,
    defaultLlmModelId,
    visibleLlmModels,
  } from "@/lib/configs";
  import { openSetupTab, probeLlmsCached } from "@/lib/utils";
  import { onMount } from "svelte";
  import ModelSelect from "@/lib/components/ui/ModelSelect.svelte";
  import {
    Eye,
    EyeOff,
    LoaderCircle,
    Play,
  } from "lucide-svelte";

  let {
    currentMode = "webgpu",
    llmModel = $bindable(defaultLlmModelId()),
    llmTemperature = $bindable(DefaultConfig.llmTemperature),
    serverHost = $bindable(DefaultConfig.serverHost),
    serverSchema = $bindable(DefaultConfig.serverSchema),
    serverModel = $bindable(DefaultConfig.serverModel),
    useServerApiKey = $bindable(DefaultConfig.useServerApiKey),
    serverApiKey = $bindable(DefaultConfig.serverApiKey),
    geminiKey = $bindable(""),
    geminiModel = $bindable(DefaultConfig.geminiModels[0].id),
    cachedLlms = $bindable([]),
  }: {
    currentMode?: string;
    llmModel: string;
    llmTemperature: number;
    serverHost: string;
    serverSchema: string;
    serverModel: string;
    useServerApiKey: boolean;
    serverApiKey: string;
    geminiKey: string;
    geminiModel: string;
    cachedLlms?: string[];
  } = $props();

  let showKey = $state(false);
  let showServerKey = $state(false);
  let serverTesting = $state(false);
  let serverTestResult = $state<{
    success: boolean;
    models?: string[];
    error?: string;
  } | null>(null);
  let deletingLlm = $state(false);
  let deletingLlmError = $state<string | null>(null);
  let showDeleteConfirm = $state(false);
  let llmProbing = $state(false);

  // Intersect the stored list with real local-LLM weight presence.
  // The stored list is stale-prone (written once at setup download);
  // without this the selected row shows Active even when weights are gone.
  async function refreshLlmCacheStatus() {
    if (llmProbing) return;
    llmProbing = true;
    try {
      const listed = [...cachedLlms];
      const candidates = [...new Set([...listed, llmModel])];
      const verified = await probeLlmsCached(candidates);
      cachedLlms = verified;
    } finally {
      llmProbing = false;
    }
  }

  onMount(() => {
    refreshLlmCacheStatus();
  });

  async function testServer() {
    serverTesting = true;
    serverTestResult = null;
    try {
      serverTestResult = await browser.runtime.sendMessage({
        type: "TEST_BACKEND",
        data: {
          kind: "api",
          config: {
            serverHost,
            serverSchema,
            serverModel,
            useServerApiKey,
            serverApiKey,
            temperature: llmTemperature,
          },
        },
      });
    } catch (err: any) {
      serverTestResult = { success: false, error: err?.message ?? "Failed" };
    } finally {
      serverTesting = false;
    }
  }

  async function deleteLlmModel() {
    deletingLlm = true;
    deletingLlmError = null;
    try {
      const res = await browser.runtime.sendMessage({
        type: "DELETE_LLM_CACHE",
        data: { modelId: llmModel },
      });
      if (res?.error) throw new Error(res.error);
      await openSetupTab(llmModel, true);
      cachedLlms = cachedLlms.filter((m) => m !== llmModel);
    } catch (err: any) {
      deletingLlmError = err?.message ?? "Failed to delete model.";
    } finally {
      deletingLlm = false;
    }
  }
</script>

{#if currentMode === "webgpu"}
  <div class="space-y-3">
    <div class="space-y-1.5">
      <div class="min-w-0">
        <ModelSelect
          id="llm-model"
          label="Local LLM Model"
          bind:value={llmModel}
          options={visibleLlmModels().map((m) => ({ id: m.id, label: m.label, size: m.vram, desc: m.desc }))}
          cached={Object.fromEntries(cachedLlms.map((id) => [id, true]))}
          onDownload={(id) => openSetupTab(id)}
        />
      </div>

      {#if cachedLlms.includes(llmModel)}
        <div class="flex items-center gap-2 mt-1.5">
          {#if showDeleteConfirm}
            <span class="text-[10px] text-[var(--accent-rose)] font-medium whitespace-nowrap">
              Delete cached model?
            </span>
            <button
              onclick={() => {
                showDeleteConfirm = false;
                deleteLlmModel();
              }}
              disabled={deletingLlm}
              class="px-2 py-1 bg-[var(--accent-rose)] text-[#05040b] hover:opacity-90 disabled:opacity-50 rounded-lg text-[10px] font-bold cursor-pointer transition-colors"
            >
              {#if deletingLlm}
                <LoaderCircle size={11} class="animate-spin" />
              {:else}
                Delete
              {/if}
            </button>
            <button
              onclick={() => (showDeleteConfirm = false)}
              disabled={deletingLlm}
              class="px-2 py-1 bg-[var(--bg-void)] border border-[var(--border-faint)] hover:border-[var(--text-primary)] text-[var(--text-muted)] rounded-lg text-[10px] font-bold cursor-pointer transition-colors"
            >
              Cancel
            </button>
          {:else}
            <button
              onclick={() => (showDeleteConfirm = true)}
              class="w-full px-3 py-1.5 bg-[var(--bg-void)] border border-[var(--border-faint)] text-[var(--text-primary)] hover:border-[var(--accent-rose)]/50 hover:text-[var(--accent-rose)] rounded-lg transition-colors flex items-center justify-center cursor-pointer text-[10px] font-bold"
              title="Delete cached model to free space"
            >
              Delete Cached Model
            </button>
          {/if}
        </div>
      {/if}

      {#if deletingLlmError}
        <p class="text-[10px] text-rose-400 mt-1">{deletingLlmError}</p>
      {/if}
    </div>

    <div class="pt-2.5 border-t border-[var(--border-faint)]">
      <div class="flex justify-between items-center mb-1.5">
        <label for="llm-temperature-wgpu" class="text-[10px] font-bold uppercase tracking-widest text-[var(--text-dim)]">
          Temperature
        </label>
        <span class="text-[10px] font-mono font-bold text-[var(--text-primary)]">
          {llmTemperature.toFixed(1)}
        </span>
      </div>
      <input
        id="llm-temperature-wgpu"
        type="range"
        min="0"
        max="1"
        step="0.1"
        bind:value={llmTemperature}
        class="slider-cyber"
      />
      <div class="flex justify-between text-[10px] text-[var(--text-dim)] font-mono mt-1">
        <span>Precise</span>
        <span>Creative</span>
      </div>
    </div>
  </div>

{:else if currentMode === "api"}
  <div class="space-y-3">
    <div class="space-y-1.5">
      <label for="server-host" class="text-[10px] font-bold uppercase tracking-widest text-[var(--text-dim)]">
        Server URL
      </label>
      <input
        id="server-host"
        type="text"
        bind:value={serverHost}
        placeholder="http://127.0.0.1:11434/v1"
        class="w-full bg-[var(--bg-void)] border border-[var(--border-faint)] rounded-lg p-2.5 text-sm focus:border-[var(--border-line)] outline-none transition-all font-mono text-[var(--text-primary)] placeholder:text-[var(--text-dim)]"
      />
    </div>

    <div class="grid grid-cols-2 gap-3">
      <div class="space-y-1.5">
        <label for="server-schema" class="text-[10px] font-bold uppercase tracking-widest text-[var(--text-dim)]">
          Schema
        </label>
        <select
          id="server-schema"
          bind:value={serverSchema}
          class="w-full bg-[var(--bg-void)] border border-[var(--border-faint)] rounded-lg p-2.5 text-sm outline-none cursor-pointer text-[var(--text-primary)]"
        >
          <option value="openai">OpenAI-compatible</option>
          <option value="lmstudio">LM Studio</option>
        </select>
      </div>
      <div class="space-y-1.5">
        <label for="server-model" class="text-[10px] font-bold uppercase tracking-widest text-[var(--text-dim)]">
          Model
        </label>
        <input
          id="server-model"
          type="text"
          bind:value={serverModel}
          placeholder="model name"
          class="w-full bg-[var(--bg-void)] border border-[var(--border-faint)] rounded-lg p-2.5 text-sm focus:border-[var(--border-line)] outline-none transition-all text-[var(--text-primary)] placeholder:text-[var(--text-dim)]"
        />
      </div>
    </div>

    <div class="flex items-center gap-3">
      <label class="switch-cyber shrink-0">
        <input type="checkbox" bind:checked={useServerApiKey} />
        <span class="track"><span class="thumb"></span></span>
      </label>
      {#if useServerApiKey}
        <input
          type={showServerKey ? "text" : "password"}
          bind:value={serverApiKey}
          placeholder="API key"
          class="flex-1 bg-[var(--bg-void)] border border-[var(--border-faint)] rounded-lg p-2.5 text-sm focus:border-[var(--border-line)] outline-none transition-all text-[var(--text-primary)] placeholder:text-[var(--text-dim)]"
        />
        <button
          type="button"
          onclick={() => (showServerKey = !showServerKey)}
          class="text-[var(--text-dim)] hover:text-[var(--text-primary)] cursor-pointer shrink-0 transition-colors"
          aria-label={showServerKey ? "Hide key" : "Show key"}
        >
          {#if showServerKey}<EyeOff size={15} />{:else}<Eye size={15} />{/if}
        </button>
      {:else}
        <span class="text-xs text-[var(--text-dim)] font-mono">No auth header</span>
      {/if}
    </div>

    <button
      onclick={testServer}
      disabled={serverTesting}
      class="cursor-pointer w-full flex items-center justify-center gap-2 py-2 bg-[var(--bg-void)] border border-[var(--border-line)] text-[var(--text-primary)] hover:border-[var(--accent-cyan)] hover:text-[var(--accent-cyan)] rounded-lg text-xs font-semibold tracking-wide transition-colors disabled:opacity-50"
    >
      {#if serverTesting}
        <LoaderCircle size={13} class="animate-spin text-[var(--accent-cyan)]" />
        Testing…
      {:else}
        <Play size={13} />
        Test Connection
      {/if}
    </button>

    {#if serverTestResult}
      <div
        class="text-xs p-2 rounded-lg border font-mono
        {serverTestResult.success
          ? 'bg-[var(--accent-emerald-soft)] border-[var(--accent-emerald)]/30 text-[var(--accent-emerald)]'
          : 'bg-[var(--accent-rose-soft)] border-[var(--accent-rose)]/30 text-[var(--accent-rose)]'}"
      >
        {#if serverTestResult.success}
          Connected — {serverTestResult.models?.length ?? 0} model(s) found.
        {:else}
          {serverTestResult.error}
        {/if}
      </div>
    {/if}

    <div class="pt-2.5 border-t border-[var(--border-faint)]">
      <div class="flex justify-between items-center mb-1.5">
        <label for="llm-temperature-api" class="text-[10px] font-bold uppercase tracking-widest text-[var(--text-dim)]">
          Temperature
        </label>
        <span class="text-[10px] font-mono font-bold text-[var(--text-primary)]">
          {llmTemperature.toFixed(1)}
        </span>
      </div>
      <input
        id="llm-temperature-api"
        type="range"
        min="0"
        max="1"
        step="0.1"
        bind:value={llmTemperature}
        class="slider-cyber"
      />
      <div class="flex justify-between text-[10px] text-[var(--text-dim)] font-mono mt-1">
        <span>Precise</span>
        <span>Creative</span>
      </div>
    </div>
  </div>

{:else if currentMode === "gemini"}
  <div class="space-y-3">
    <div class="space-y-1.5">
      <label for="gemini-key" class="text-[10px] font-bold uppercase tracking-widest text-[var(--text-dim)]">
        Gemini API Key
      </label>
      <div class="relative">
        <input
          id="gemini-key"
          type={showKey ? "text" : "password"}
          bind:value={geminiKey}
          placeholder="AIzaSy..."
          class="w-full bg-[var(--bg-void)] border border-[var(--border-faint)] rounded-lg p-2.5 pr-10 text-sm focus:border-[var(--border-line)] outline-none transition-all text-[var(--text-primary)] placeholder:text-[var(--text-dim)]"
        />
        <button
          type="button"
          onclick={() => (showKey = !showKey)}
          class="absolute inset-y-0 right-0 flex items-center pr-3 text-[var(--text-dim)] hover:text-[var(--text-primary)] transition-colors focus:outline-none cursor-pointer"
        >
          {#if showKey}<EyeOff size={15} />{:else}<Eye size={15} />{/if}
        </button>
      </div>
    </div>

    <div class="space-y-1.5">
      <label for="gemini-model" class="text-[10px] font-bold uppercase tracking-widest text-[var(--text-dim)]">
        Gemini Model
      </label>
      <select
        id="gemini-model"
        bind:value={geminiModel}
        class="w-full bg-[var(--bg-void)] border border-[var(--border-faint)] rounded-lg p-2.5 text-sm outline-none cursor-pointer text-[var(--text-primary)]"
      >
        {#each DefaultConfig.geminiModels as model}
          <option value={model.id}>{model.label}</option>
        {/each}
      </select>
    </div>

    <div class="pt-2.5 border-t border-[var(--border-faint)]">
      <div class="flex justify-between items-center mb-1.5">
        <label for="llm-temperature-gemini" class="text-[10px] font-bold uppercase tracking-widest text-[var(--text-dim)]">
          Temperature
        </label>
        <span class="text-[10px] font-mono font-bold text-[var(--text-primary)]">
          {llmTemperature.toFixed(1)}
        </span>
      </div>
      <input
        id="llm-temperature-gemini"
        type="range"
        min="0"
        max="1"
        step="0.1"
        bind:value={llmTemperature}
        class="slider-cyber"
      />
      <div class="flex justify-between text-[10px] text-[var(--text-dim)] font-mono mt-1">
        <span>Precise</span>
        <span>Creative</span>
      </div>
    </div>
  </div>
{/if}
