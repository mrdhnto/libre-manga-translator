<script lang="ts">
  import { DefaultConfig } from "@/lib/configs";
  import { openSetupTab } from "@/lib/utils";
  import {
    Download,
    Eye,
    EyeOff,
    LoaderCircle,
    Play,
  } from "lucide-svelte";

  let {
    currentMode = "webgpu",
    llmModel = $bindable(DefaultConfig.llmModels[0].id),
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
      // Clear the offscreen document's translation-model copy...
      const res = await browser.runtime.sendMessage({
        type: "DELETE_LLM_CACHE",
        data: { modelId: llmModel },
      });
      if (res?.error) throw new Error(res.error);
      // ...and open the setup page in clean mode to clear ITS cache partition
      // (the partition where the onboarding download actually runs).
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
  <!-- WebGPU: LLM model picker -->
  <div class="space-y-3">
    <div class="space-y-1.5">
      <label
        for="llm-model"
        class="text-[10px] font-bold uppercase tracking-widest text-zinc-500"
      >
        Local WebLLM Model
      </label>
      <div class="flex gap-2">
        <select
          id="llm-model"
          bind:value={llmModel}
          class="flex-1 bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-700 rounded-lg p-2.5 text-sm outline-none cursor-pointer shadow-sm"
        >
          {#each DefaultConfig.llmModels as model}
            <option value={model.id}>{model.label}</option>
          {/each}
        </select>
        <button
          onclick={() => openSetupTab(llmModel)}
          class="px-4 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 hover:bg-blue-200 dark:hover:bg-blue-900/50 rounded-lg transition-colors flex items-center justify-center cursor-pointer shadow-sm"
          title="Download or Update Model"
        >
          <Download size={18} />
        </button>
      </div>

      {#if cachedLlms.includes(llmModel)}
        <div class="flex items-center gap-2 mt-2">
          {#if showDeleteConfirm}
            <span class="text-[10px] text-red-600 dark:text-red-400 font-medium whitespace-nowrap">
              Delete cached model?
            </span>
            <button
              onclick={() => {
                showDeleteConfirm = false;
                deleteLlmModel();
              }}
              disabled={deletingLlm}
              class="px-2 py-1 bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white rounded-md text-[10px] font-bold cursor-pointer transition-colors"
            >
              {#if deletingLlm}
                <LoaderCircle size={12} class="animate-spin" />
              {:else}
                Delete
              {/if}
            </button>
            <button
              onclick={() => (showDeleteConfirm = false)}
              disabled={deletingLlm}
              class="px-2 py-1 bg-zinc-200 dark:bg-zinc-700 hover:bg-zinc-300 dark:hover:bg-zinc-600 text-zinc-600 dark:text-zinc-400 rounded-md text-[10px] font-bold cursor-pointer transition-colors"
            >
              Cancel
            </button>
          {:else}
            <button
              onclick={() => (showDeleteConfirm = true)}
              class="w-full px-4 py-2 bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-900/50 rounded-full transition-colors flex items-center justify-center cursor-pointer shadow-sm text-[10px] font-bold"
              title="Delete cached model to free space"
            >
              Delete Model
            </button>
          {/if}
        </div>
      {/if}

      {#if deletingLlmError}
        <p class="text-[10px] text-red-500 mt-1">{deletingLlmError}</p>
      {/if}
    </div>

    <div class="pt-3 border-t border-zinc-200 dark:border-zinc-800">
      <div class="flex justify-between items-center mb-2">
        <label
          for="llm-temperature-wgpu"
          class="text-[10px] font-bold uppercase tracking-widest text-zinc-500"
        >
          Temperature
        </label>
        <span class="text-[10px] font-mono font-bold text-blue-500">
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
        class="w-full h-1.5 bg-zinc-200 dark:bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
      />
      <div class="flex justify-between text-[10px] text-zinc-400 font-medium mt-1">
        <span>Precise</span>
        <span>Creative</span>
      </div>
    </div>
  </div>

{:else if currentMode === "api"}
  <!-- API Mode: external server config -->
  <div class="space-y-3">
    <div class="space-y-1.5">
      <label
        for="server-host"
        class="text-[10px] font-bold uppercase tracking-widest text-zinc-500"
      >
        Server URL
      </label>
      <input
        id="server-host"
        type="text"
        bind:value={serverHost}
        placeholder="http://127.0.0.1:11434/v1"
        class="w-full bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-700 rounded-lg p-2.5 text-sm focus:ring-1 focus:ring-blue-500 outline-none transition-all shadow-sm font-mono"
      />
    </div>

    <div class="grid grid-cols-2 gap-3">
      <div class="space-y-1.5">
        <label
          for="server-schema"
          class="text-[10px] font-bold uppercase tracking-widest text-zinc-500"
        >
          Schema
        </label>
        <select
          id="server-schema"
          bind:value={serverSchema}
          class="w-full bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-700 rounded-lg p-2.5 text-sm outline-none cursor-pointer shadow-sm"
        >
          <option value="openai">OpenAI-compatible</option>
          <option value="lmstudio">LM Studio</option>
        </select>
      </div>
      <div class="space-y-1.5">
        <label
          for="server-model"
          class="text-[10px] font-bold uppercase tracking-widest text-zinc-500"
        >
          Model
        </label>
        <input
          id="server-model"
          type="text"
          bind:value={serverModel}
          placeholder="model name"
          class="w-full bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-700 rounded-lg p-2.5 text-sm focus:ring-1 focus:ring-blue-500 outline-none transition-all shadow-sm"
        />
      </div>
    </div>

    <div class="flex items-center gap-3">
      <label class="relative inline-flex items-center cursor-pointer shrink-0">
        <input
          type="checkbox"
          bind:checked={useServerApiKey}
          class="sr-only peer"
        />
        <div
          class="w-9 h-5 bg-zinc-200 dark:bg-zinc-700 rounded-full peer peer-checked:bg-blue-500 transition-all after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-4"
        ></div>
      </label>
      {#if useServerApiKey}
        <input
          type={showServerKey ? "text" : "password"}
          bind:value={serverApiKey}
          placeholder="API key"
          class="flex-1 bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-700 rounded-lg p-2.5 text-sm focus:ring-1 focus:ring-blue-500 outline-none transition-all shadow-sm"
        />
        <button
          type="button"
          onclick={() => (showServerKey = !showServerKey)}
          class="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 cursor-pointer shrink-0"
          aria-label={showServerKey ? "Hide key" : "Show key"}
        >
          {#if showServerKey}<EyeOff size={16} />{:else}<Eye size={16} />{/if}
        </button>
      {:else}
        <span class="text-xs text-zinc-500">No auth header</span>
      {/if}
    </div>

    <button
      onclick={testServer}
      disabled={serverTesting}
      class="cursor-pointer w-full flex items-center justify-center gap-2 py-2 bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-400 hover:bg-sky-200 dark:hover:bg-sky-900/50 rounded-lg text-xs font-bold transition-colors disabled:opacity-50"
    >
      {#if serverTesting}
        <LoaderCircle size={14} class="animate-spin" />
        Testing...
      {:else}
        <Play size={14} />
        Test Connection
      {/if}
    </button>

    {#if serverTestResult}
      <div
        class="text-xs p-2 rounded-lg border
        {serverTestResult.success
          ? 'bg-emerald-50 dark:bg-emerald-900/10 border-emerald-200 dark:border-emerald-800/30 text-emerald-600 dark:text-emerald-500'
          : 'bg-red-50 dark:bg-red-900/10 border-red-200 dark:border-red-800/30 text-red-600 dark:text-red-500'}"
      >
        {#if serverTestResult.success}
          Connected - {serverTestResult.models?.length ?? 0} model(s) found.
        {:else}
          {serverTestResult.error}
        {/if}
      </div>
    {/if}

    <div class="pt-3 border-t border-zinc-200 dark:border-zinc-800">
      <div class="flex justify-between items-center mb-2">
        <label
          for="llm-temperature-api"
          class="text-[10px] font-bold uppercase tracking-widest text-zinc-500"
        >
          Temperature
        </label>
        <span class="text-[10px] font-mono font-bold text-blue-500">
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
        class="w-full h-1.5 bg-zinc-200 dark:bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
      />
      <div class="flex justify-between text-[10px] text-zinc-400 font-medium mt-1">
        <span>Precise</span>
        <span>Creative</span>
      </div>
    </div>
  </div>

{:else if currentMode === "gemini"}
  <!-- Gemini: API key + model -->
  <div class="space-y-3">
    <div class="space-y-1.5">
      <label
        for="gemini-key"
        class="text-[10px] font-bold uppercase tracking-widest text-zinc-500"
      >
        Gemini API Key
      </label>
      <div class="relative">
        <input
          id="gemini-key"
          type={showKey ? "text" : "password"}
          bind:value={geminiKey}
          placeholder="AIzaSy..."
          class="w-full bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-700 rounded-lg p-2.5 pr-10 text-sm focus:ring-1 focus:ring-blue-500 outline-none transition-all shadow-sm"
        />
        <button
          type="button"
          onclick={() => (showKey = !showKey)}
          class="absolute inset-y-0 right-0 flex items-center pr-3 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors focus:outline-none"
        >
          {#if showKey}<EyeOff size={16} />{:else}<Eye size={16} />{/if}
        </button>
      </div>
    </div>

    <div class="space-y-1.5">
      <label
        for="gemini-model"
        class="text-[10px] font-bold uppercase tracking-widest text-zinc-500"
      >
        Gemini Model
      </label>
      <select
        id="gemini-model"
        bind:value={geminiModel}
        class="w-full bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-700 rounded-lg p-2.5 text-sm outline-none cursor-pointer shadow-sm"
      >
        {#each DefaultConfig.geminiModels as model}
          <option value={model.id}>{model.label}</option>
        {/each}
      </select>
    </div>

    <div class="pt-3 border-t border-zinc-200 dark:border-zinc-800">
      <div class="flex justify-between items-center mb-2">
        <label
          for="llm-temperature-gemini"
          class="text-[10px] font-bold uppercase tracking-widest text-zinc-500"
        >
          Temperature
        </label>
        <span class="text-[10px] font-mono font-bold text-blue-500">
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
        class="w-full h-1.5 bg-zinc-200 dark:bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
      />
      <div class="flex justify-between text-[10px] text-zinc-400 font-medium mt-1">
        <span>Precise</span>
        <span>Creative</span>
      </div>
    </div>
  </div>
{/if}
