<script lang="ts">
  import { Cpu, Cloud, Server, ChevronRight } from "lucide-svelte";

  let {
    selectedMode = $bindable("webgpu"),
    onBack,
    onNext,
  }: {
    selectedMode?: "webgpu" | "gemini" | "api";
    onBack: () => void;
    onNext: () => void;
  } = $props();
</script>

<div class="space-y-4">
  <div>
    <h2 class="text-base font-display font-bold text-[var(--text-primary)]">
      Translation Mode
    </h2>
    <p class="text-xs text-[var(--text-muted)] mt-0.5">
      Select your primary translation engine. You can change this anytime from the popup.
    </p>
  </div>

  <!-- 3 Stacked Selection Rows -->
  <div class="space-y-2.5">
    <!-- WebGPU -->
    <button
      type="button"
      onclick={() => (selectedMode = "webgpu")}
      class="w-full p-3.5 rounded-xl border text-left cursor-pointer transition-all flex items-center justify-between gap-3 bg-[var(--bg-void)]
        {selectedMode === 'webgpu'
        ? 'border-[var(--accent-amber)] shadow-[0_0_14px_var(--accent-amber-glow)]'
        : 'border-[var(--border-line)] hover:border-[var(--border-line)]/80'}"
    >
      <div class="flex items-start gap-3 min-w-0">
        <div
          class="p-2 rounded-lg bg-[var(--surface-panel)] border border-[var(--border-faint)] text-[var(--accent-amber)] shrink-0 mt-0.5"
        >
          <Cpu size={18} />
        </div>
        <div class="min-w-0">
          <div class="flex items-center gap-2">
            <span
              class="text-xs font-display font-bold text-[var(--text-primary)]"
            >
              WebGPU (On-Device)
            </span>
            <span class="badge-cyber is-amber text-[9px] !py-0.5 !px-1.5">
              100% Private
            </span>
          </div>
          <p
            class="text-[11px] leading-snug mt-1 {selectedMode === 'webgpu'
              ? 'text-[var(--text-primary)]'
              : 'text-[var(--text-muted)]'}"
          >
            Runs offline in your browser via WebLLM. Zero text or images sent outside your PC.
          </p>
        </div>
      </div>
      <div
        class="w-4 h-4 rounded-full border border-[var(--border-line)] flex items-center justify-center shrink-0 {selectedMode ===
        'webgpu'
          ? 'border-[var(--accent-amber)]'
          : ''}"
      >
        {#if selectedMode === "webgpu"}
          <div
            class="w-2 h-2 rounded-full bg-[var(--accent-amber)] shadow-[0_0_6px_var(--accent-amber-glow)]"
          ></div>
        {/if}
      </div>
    </button>

    <!-- Gemini -->
    <button
      type="button"
      onclick={() => (selectedMode = "gemini")}
      class="w-full p-3.5 rounded-xl border text-left cursor-pointer transition-all flex items-center justify-between gap-3 bg-[var(--bg-void)]
        {selectedMode === 'gemini'
        ? 'border-[var(--accent-emerald)] shadow-[0_0_14px_var(--accent-emerald-glow)]'
        : 'border-[var(--border-line)] hover:border-[var(--border-line)]/80'}"
    >
      <div class="flex items-start gap-3 min-w-0">
        <div
          class="p-2 rounded-lg bg-[var(--surface-panel)] border border-[var(--border-faint)] text-[var(--accent-emerald)] shrink-0 mt-0.5"
        >
          <Cloud size={18} />
        </div>
        <div class="min-w-0">
          <div class="flex items-center gap-2">
            <span
              class="text-xs font-display font-bold text-[var(--text-primary)]"
            >
              Gemini Cloud Direct
            </span>
            <span class="badge-cyber is-emerald text-[9px] !py-0.5 !px-1.5">
              Fast &amp; Accurate
            </span>
          </div>
          <p
            class="text-[11px] leading-snug mt-1 {selectedMode === 'gemini'
              ? 'text-[var(--text-primary)]'
              : 'text-[var(--text-muted)]'}"
          >
            Sends annotated bubbles straight to Google Gemini API using your free API key.
          </p>
        </div>
      </div>
      <div
        class="w-4 h-4 rounded-full border border-[var(--border-line)] flex items-center justify-center shrink-0 {selectedMode ===
        'gemini'
          ? 'border-[var(--accent-emerald)]'
          : ''}"
      >
        {#if selectedMode === "gemini"}
          <div
            class="w-2 h-2 rounded-full bg-[var(--accent-emerald)] shadow-[0_0_6px_var(--accent-emerald-glow)]"
          ></div>
        {/if}
      </div>
    </button>

    <!-- API Mode -->
    <button
      type="button"
      onclick={() => (selectedMode = "api")}
      class="w-full p-3.5 rounded-xl border text-left cursor-pointer transition-all flex items-center justify-between gap-3 bg-[var(--bg-void)]
        {selectedMode === 'api'
        ? 'border-[var(--accent-cyan)] shadow-[0_0_14px_var(--accent-cyan-glow)]'
        : 'border-[var(--border-line)] hover:border-[var(--border-line)]/80'}"
    >
      <div class="flex items-start gap-3 min-w-0">
        <div
          class="p-2 rounded-lg bg-[var(--surface-panel)] border border-[var(--border-faint)] text-[var(--accent-cyan)] shrink-0 mt-0.5"
        >
          <Server size={18} />
        </div>
        <div class="min-w-0">
          <div class="flex items-center gap-2">
            <span
              class="text-xs font-display font-bold text-[var(--text-primary)]"
            >
              API Mode (Self-Hosted)
            </span>
            <span class="badge-cyber is-cyan text-[9px] !py-0.5 !px-1.5">
              Custom Server
            </span>
          </div>
          <p
            class="text-[11px] leading-snug mt-1 {selectedMode === 'api'
              ? 'text-[var(--text-primary)]'
              : 'text-[var(--text-muted)]'}"
          >
            Connect Llama.cpp, Ollama, LM Studio, Jan or any OpenAI Compatible. OCR stays local; text only is sent.
          </p>
        </div>
      </div>
      <div
        class="w-4 h-4 rounded-full border border-[var(--border-line)] flex items-center justify-center shrink-0 {selectedMode ===
        'api'
          ? 'border-[var(--accent-cyan)]'
          : ''}"
      >
        {#if selectedMode === "api"}
          <div
            class="w-2 h-2 rounded-full bg-[var(--accent-cyan)] shadow-[0_0_6px_var(--accent-cyan-glow)]"
          ></div>
        {/if}
      </div>
    </button>
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
      class="btn-primary flex-1 text-xs !py-2.5 font-bold cursor-pointer"
    >
      Continue
      <ChevronRight size={14} />
    </button>
  </div>
</div>
