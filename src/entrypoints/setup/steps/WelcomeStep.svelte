<script lang="ts">
  import {
    ShieldCheck,
    Cpu,
    Cloud,
    Server,
    ChevronRight,
  } from "lucide-svelte";

  let {
    onNext,
  }: {
    onNext: () => void;
  } = $props();
</script>

<div class="flex flex-col items-center text-center gap-5">
  <div class="relative pt-2">
    <div
      class="absolute -inset-1 rounded-2xl bg-[var(--accent-cyan-glow)] blur-lg opacity-40"
    ></div>
    <img
      src="/icon/128.png"
      alt="LMT"
      class="relative w-16 h-16 rounded-xl shadow-[var(--shadow-panel)] object-contain"
    />
  </div>

  <div class="space-y-1.5">
    <div class="inline-flex items-center gap-1.5">
      <h1
        class="text-xl sm:text-2xl font-display font-bold tracking-tight text-[var(--text-primary)]"
      >
        Libre Manga Translator
      </h1>
    </div>
    <p class="text-xs text-[var(--text-muted)] max-w-sm mx-auto leading-relaxed">
      Local-first, privacy-respecting manga translation directly in your browser.
    </p>
  </div>

  <!-- 4 Highlight Cards in 2x2 grid -->
  <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-left w-full">
    <div
      class="p-3 rounded-xl bg-[var(--bg-void)] border border-[var(--border-line)] flex items-start gap-2.5"
    >
      <div
        class="p-1.5 rounded-lg bg-[var(--surface-panel)] border border-[var(--border-faint)] text-[var(--accent-cyan)] shrink-0 mt-0.5"
      >
        <ShieldCheck size={14} />
      </div>
      <div>
        <p class="text-xs font-display font-bold text-[var(--text-primary)]">
          Private by Default
        </p>
        <p class="text-[11px] text-[var(--text-muted)] leading-tight mt-0.5">
          Zero background telemetry. Detection & OCR never leave your machine.
        </p>
      </div>
    </div>

    <div
      class="p-3 rounded-xl bg-[var(--bg-void)] border border-[var(--border-line)] flex items-start gap-2.5"
    >
      <div
        class="p-1.5 rounded-lg bg-[var(--surface-panel)] border border-[var(--border-faint)] text-[var(--accent-amber)] shrink-0 mt-0.5"
      >
        <Cpu size={14} />
      </div>
      <div>
        <p class="text-xs font-display font-bold text-[var(--text-primary)]">
          WebGPU On-Device
        </p>
        <p class="text-[11px] text-[var(--text-muted)] leading-tight mt-0.5">
          RT-DETR + PaddleOCR + Qwen3 execute locally. Fully functional offline.
        </p>
      </div>
    </div>

    <div
      class="p-3 rounded-xl bg-[var(--bg-void)] border border-[var(--border-line)] flex items-start gap-2.5"
    >
      <div
        class="p-1.5 rounded-lg bg-[var(--surface-panel)] border border-[var(--border-faint)] text-[var(--accent-emerald)] shrink-0 mt-0.5"
      >
        <Cloud size={14} />
      </div>
      <div>
        <p class="text-xs font-display font-bold text-[var(--text-primary)]">
          Gemini Cloud Direct
        </p>
        <p class="text-[11px] text-[var(--text-muted)] leading-tight mt-0.5">
          High accuracy multimodal translation directly to Google AI Studio.
        </p>
      </div>
    </div>

    <div
      class="p-3 rounded-xl bg-[var(--bg-void)] border border-[var(--border-line)] flex items-start gap-2.5"
    >
      <div
        class="p-1.5 rounded-lg bg-[var(--surface-panel)] border border-[var(--border-faint)] text-[var(--accent-cyan)] shrink-0 mt-0.5"
      >
        <Server size={14} />
      </div>
      <div>
        <p class="text-xs font-display font-bold text-[var(--text-primary)]">
          API Mode Server
        </p>
        <p class="text-[11px] text-[var(--text-muted)] leading-tight mt-0.5">
          Connect your own Ollama, LM Studio, or OpenAI-compatible endpoint.
        </p>
      </div>
    </div>
  </div>

  <button
    type="button"
    onclick={onNext}
    class="w-full btn-primary !py-3 text-xs tracking-wide uppercase font-bold flex items-center justify-center gap-2 cursor-pointer mt-1"
  >
    Get Started
    <ChevronRight size={16} />
  </button>
</div>
