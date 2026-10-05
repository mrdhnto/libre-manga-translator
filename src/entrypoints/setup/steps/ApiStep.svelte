<script lang="ts">
  import { Check, Eye, EyeOff, ChevronRight } from "lucide-svelte";

  let {
    serverHost = $bindable(""),
    serverSchema = $bindable("openai"),
    serverModel = $bindable(""),
    useServerApiKey = $bindable(false),
    serverApiKey = $bindable(""),
    onBack,
    onNext,
  }: {
    serverHost?: string;
    serverSchema?: string;
    serverModel?: string;
    useServerApiKey?: boolean;
    serverApiKey?: string;
    onBack: () => void;
    onNext: () => void;
  } = $props();

  let showKey = $state(false);
</script>

<div class="space-y-4">
  <div>
    <h2 class="text-base font-display font-bold text-[var(--text-primary)]">
      API Mode Server
    </h2>
    <p class="text-xs text-[var(--text-muted)] mt-0.5">
      Connect Llama.cpp, Ollama, LM Studio, Jan or any OpenAI-compatible server.
    </p>
  </div>

  <!-- Quick Presets -->
  <div class="space-y-1.5">
    <span class="kicker text-[10px]">Quick Presets</span>
    <div class="flex items-center gap-2">
      <button
        type="button"
        onclick={() => {
          serverHost = "http://127.0.0.1:11434/v1";
          serverSchema = "openai";
          serverModel = "qwen3.5:4b";
        }}
        class="btn-ghost !py-1 !px-2 text-[11px] font-mono cursor-pointer"
      >
        Ollama (11434)
      </button>
      <button
        type="button"
        onclick={() => {
          serverHost = "http://127.0.0.1:1234/v1";
          serverSchema = "openai";
          serverModel = "qwen3.5-4b";
        }}
        class="btn-ghost !py-1 !px-2 text-[11px] font-mono cursor-pointer"
      >
        LM Studio (1234)
      </button>
    </div>
  </div>

  <div class="space-y-3">
    <div class="space-y-1">
      <label
        for="setup-server-host"
        class="kicker text-[11px]"
      >
        Server Endpoint URL
      </label>
      <input
        id="setup-server-host"
        type="text"
        bind:value={serverHost}
        placeholder="http://127.0.0.1:11434/v1"
        class="w-full bg-[var(--bg-void)] border border-[var(--border-line)] rounded-xl p-2.5 text-xs focus:border-[var(--accent-cyan)] outline-none transition-all font-mono text-[var(--text-primary)]"
      />
    </div>

    <div class="grid grid-cols-2 gap-2.5">
      <div class="space-y-1">
        <label
          for="setup-server-schema"
          class="kicker text-[11px]"
        >
          API Schema
        </label>
        <select
          id="setup-server-schema"
          bind:value={serverSchema}
          class="w-full bg-[var(--bg-void)] border border-[var(--border-line)] rounded-xl p-2 text-xs outline-none cursor-pointer text-[var(--text-primary)]"
        >
          <option value="openai">OpenAI-compatible</option>
          <option value="lmstudio">LM Studio</option>
        </select>
      </div>
      <div class="space-y-1">
        <label
          for="setup-server-model"
          class="kicker text-[11px]"
        >
          Model Identifier
        </label>
        <input
          id="setup-server-model"
          type="text"
          bind:value={serverModel}
          placeholder="e.g. qwen3.5:4b"
          class="w-full bg-[var(--bg-void)] border border-[var(--border-line)] rounded-xl p-2 text-xs focus:border-[var(--accent-cyan)] outline-none transition-all text-[var(--text-primary)] font-mono"
        />
      </div>
    </div>

    <!-- API Key Toggle -->
    <div class="space-y-2 pt-1">
      <label class="flex items-center gap-2.5 cursor-pointer group select-none">
        <div class="relative flex items-center shrink-0">
          <input
            type="checkbox"
            bind:checked={useServerApiKey}
            class="peer sr-only"
          />
          <div
            class="h-4 w-4 rounded-[4px] border border-[var(--border-line)] bg-[var(--bg-void)] peer-checked:bg-[var(--accent-cyan)] peer-checked:border-[var(--accent-cyan)] transition-all flex items-center justify-center"
          >
            <Check
              size={11}
              class="text-[#05040b] scale-0 peer-checked:scale-100 transition-transform stroke-[3]"
            />
          </div>
        </div>
        <span
          class="text-xs font-medium text-[var(--text-primary)] group-hover:text-[var(--accent-cyan)] transition-colors"
        >
          Require Bearer API key
        </span>
      </label>

      {#if useServerApiKey}
        <div class="relative">
          <input
            type={showKey ? "text" : "password"}
            bind:value={serverApiKey}
            placeholder="Bearer API key"
            class="w-full bg-[var(--bg-void)] border border-[var(--border-line)] rounded-xl p-2.5 pr-10 text-xs font-mono focus:border-[var(--accent-cyan)] outline-none transition-all text-[var(--text-primary)]"
          />
          <button
            type="button"
            onclick={() => (showKey = !showKey)}
            class="absolute inset-y-0 right-0 flex items-center pr-3 text-[var(--text-dim)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
            aria-label={showKey ? "Hide key" : "Show key"}
          >
            {#if showKey}
              <EyeOff size={14} />
            {:else}
              <Eye size={14} />
            {/if}
          </button>
        </div>
      {/if}
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
      disabled={!serverHost.trim() || !serverModel.trim()}
      class="btn-primary flex-1 text-xs !py-2.5 font-bold cursor-pointer disabled:bg-none disabled:bg-[var(--surface-panel-alt)] disabled:border-[var(--border-line)] disabled:text-[var(--text-dim)] disabled:opacity-60 disabled:shadow-none disabled:cursor-not-allowed"
    >
      Continue
      <ChevronRight size={14} />
    </button>
  </div>
</div>
