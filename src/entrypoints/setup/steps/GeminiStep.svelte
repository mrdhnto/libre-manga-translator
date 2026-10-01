<script lang="ts">
  import {
    ShieldCheck,
    Eye,
    EyeOff,
    ExternalLink,
    Info,
    ChevronRight,
  } from "lucide-svelte";

  let {
    geminiKey = $bindable(""),
    onBack,
    onComplete,
  }: {
    geminiKey?: string;
    onBack: () => void;
    onComplete: () => void;
  } = $props();

  let showKey = $state(false);
</script>

<div class="space-y-4">
  <div>
    <h2 class="text-base font-display font-bold text-[var(--text-primary)]">
      Google Gemini Setup
    </h2>
    <p class="text-xs text-[var(--text-muted)] mt-0.5">
      Connect directly to Gemini using your personal API key.
    </p>
  </div>

  <!-- Security & Privacy Assurance Card -->
  <div
    class="p-3.5 rounded-xl bg-[var(--bg-void)] border border-[var(--border-line)] flex items-start gap-3"
  >
    <div
      class="p-1.5 rounded-lg bg-[var(--surface-panel)] border border-[var(--border-faint)] text-[var(--accent-emerald)] shrink-0 mt-0.5"
    >
      <ShieldCheck size={16} />
    </div>
    <div class="space-y-1">
      <p class="text-xs font-display font-bold text-[var(--text-primary)]">
        Direct Client Connection
      </p>
      <p class="text-[11px] text-[var(--text-muted)] leading-relaxed">
        Your key is securely stored in your browser's local storage and sent exclusively to Google's official API endpoint. It is never routed through any LMT or third-party servers.
      </p>
    </div>
  </div>

  <!-- API Key Input -->
  <div class="space-y-1.5">
    <div class="flex items-center justify-between">
      <label
        for="setup-gemini-key"
        class="kicker is-emerald text-[11px]"
      >
        Gemini API Key
      </label>
      <a
        href="https://aistudio.google.com/app/api-keys"
        target="_blank"
        rel="noopener noreferrer"
        class="inline-flex items-center gap-1 text-[11px] text-[var(--accent-cyan)] hover:underline font-medium"
      >
        Get free key from AI Studio
        <ExternalLink size={10} />
      </a>
    </div>
    <div class="relative">
      <input
        id="setup-gemini-key"
        type={showKey ? "text" : "password"}
        bind:value={geminiKey}
        placeholder="AIzaSy..."
        class="w-full bg-[var(--bg-void)] border border-[var(--border-line)] rounded-xl p-3 pr-11 text-xs font-mono text-[var(--text-primary)] placeholder:text-[var(--text-dim)] focus:border-[var(--accent-emerald)] outline-none transition-all"
      />
      <button
        type="button"
        onclick={() => (showKey = !showKey)}
        class="absolute inset-y-0 right-0 flex items-center pr-3 text-[var(--text-dim)] hover:text-[var(--text-primary)] transition-colors focus:outline-none cursor-pointer"
        aria-label={showKey ? "Hide key" : "Show key"}
      >
        {#if showKey}
          <EyeOff size={15} />
        {:else}
          <Eye size={15} />
        {/if}
      </button>
    </div>
  </div>

  <!-- Default Model Badge -->
  <div
    class="flex items-center justify-between p-2.5 rounded-lg bg-[var(--bg-void)] border border-[var(--border-faint)] text-xs"
  >
    <span class="text-[var(--text-muted)]">Active Model</span>
    <span class="badge-cyber is-emerald text-[10px]">
      Gemini 3.8 Flash (Default)
    </span>
  </div>

  <!-- Cloud Multimodal Direct Info -->
  <div
    class="p-3 rounded-xl bg-[var(--bg-void)] border border-[var(--border-faint)] flex items-start gap-2.5 text-xs text-[var(--text-muted)]"
  >
    <Info size={14} class="text-[var(--accent-emerald)] shrink-0 mt-0.5" />
    <div class="space-y-0.5">
      <p class="font-semibold text-[var(--text-primary)]">
        Cloud Multimodal Pipeline
      </p>
      <p class="text-[11px] leading-relaxed text-[var(--text-dim)]">
        Gemini directly transcribes, identifies scripts, and translates speech bubbles on Google Cloud. Local OCR engines and Language Gate models are bypassed and do not require downloading.
      </p>
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
      onclick={onComplete}
      disabled={!geminiKey.trim()}
      class="btn-primary flex-1 text-xs !py-2.5 font-bold cursor-pointer disabled:bg-none disabled:bg-[var(--surface-panel-alt)] disabled:border-[var(--border-line)] disabled:text-[var(--text-dim)] disabled:opacity-60 disabled:shadow-none disabled:cursor-not-allowed"
    >
      Complete Setup
      <ChevronRight size={14} />
    </button>
  </div>
</div>
