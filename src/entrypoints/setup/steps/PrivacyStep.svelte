<script lang="ts">
  import { onMount } from "svelte";
  import {
    ShieldCheck,
    Check,
    LoaderCircle,
    CircleAlert,
    ChevronRight,
  } from "lucide-svelte";
  import { env } from "@/lib/env";

  let {
    onBack,
    onNext,
  }: {
    onBack: () => void;
    onNext: () => void;
  } = $props();

  let privacyMarkdown = $state("");
  let privacyLoading = $state(false);
  let privacyFetchError = $state(false);
  let acceptedPolicy = $state(false);

  async function fetchPrivacy() {
    privacyLoading = true;
    privacyFetchError = false;
    try {
      const res = await fetch(env.privacyUrl);
      if (!res.ok) throw new Error("Network error");
      privacyMarkdown = await res.text();
    } catch {
      privacyFetchError = true;
    } finally {
      privacyLoading = false;
    }
  }

  function parseMarkdown(md: string): string {
    const lines = md.split("\n");
    let html = "";
    let inList = false;

    for (const line of lines) {
      if (/^-{3,}$/.test(line.trim())) {
        if (inList) {
          html += "</ul>";
          inList = false;
        }
        html += '<hr class="border-[var(--border-faint)] my-3.5" />';
        continue;
      }
      if (line.startsWith("# ")) {
        if (inList) {
          html += "</ul>";
          inList = false;
        }
        html += `<h1 class="text-base font-display font-bold mb-2 text-[var(--text-primary)]">${fmt(line.slice(2))}</h1>`;
        continue;
      }
      if (line.startsWith("## ")) {
        if (inList) {
          html += "</ul>";
          inList = false;
        }
        html += `<h2 class="text-sm font-display font-bold mt-4 mb-1.5 text-[var(--text-primary)]">${fmt(line.slice(3))}</h2>`;
        continue;
      }
      if (line.startsWith("### ")) {
        if (inList) {
          html += "</ul>";
          inList = false;
        }
        html += `<h3 class="text-xs font-display font-semibold mt-3 mb-1 text-[var(--text-muted)]">${fmt(line.slice(4))}</h3>`;
        continue;
      }
      if (line.startsWith("> ")) {
        if (inList) {
          html += "</ul>";
          inList = false;
        }
        html += `<blockquote class="border-l-2 border-[var(--accent-cyan)] pl-3 my-2 py-1 text-xs italic text-[var(--text-dim)] bg-[var(--bg-void)] rounded-r">${fmt(line.slice(2))}</blockquote>`;
        continue;
      }
      if (line.startsWith("- ")) {
        if (!inList) {
          html += '<ul class="list-disc list-inside space-y-1 my-1.5">';
          inList = true;
        }
        html += `<li class="text-xs text-[var(--text-muted)] leading-relaxed">${fmt(line.slice(2))}</li>`;
        continue;
      }
      if (!line.trim()) {
        if (inList) {
          html += "</ul>";
          inList = false;
        }
        continue;
      }
      if (inList) {
        html += "</ul>";
        inList = false;
      }
      html += `<p class="text-xs leading-relaxed text-[var(--text-muted)] mb-2">${fmt(line)}</p>`;
    }
    if (inList) html += "</ul>";
    return html;
  }

  function fmt(text: string): string {
    return text
      .replace(
        /\*\*(.+?)\*\*/g,
        '<strong class="font-semibold text-[var(--text-primary)]">$1</strong>',
      )
      .replace(
        /`(.+?)`/g,
        '<code class="text-[11px] font-mono bg-[var(--surface-panel)] text-[var(--accent-cyan)] px-1.5 py-0.5 rounded border border-[var(--border-faint)]">$1</code>',
      )
      .replace(
        /\[(.+?)\]\((.+?)\)/g,
        '<a href="$2" target="_blank" rel="noopener noreferrer" class="text-[var(--accent-cyan)] hover:underline font-medium">$1</a>',
      );
  }

  let parsedPrivacy = $derived(
    privacyMarkdown ? parseMarkdown(privacyMarkdown) : "",
  );

  onMount(() => {
    fetchPrivacy();
  });
</script>

<div class="space-y-4">
  <div>
    <div class="flex items-center gap-2 mb-1">
      <ShieldCheck size={18} class="text-[var(--accent-cyan)]" />
      <h2 class="text-base font-display font-bold text-[var(--text-primary)]">
        Privacy Policy &amp; Terms
      </h2>
    </div>
    <p class="text-xs text-[var(--text-muted)]">
      Local-first transparency. Review data handling practices before continuing.
    </p>
  </div>

  <!-- Privacy Guarantee Highlights -->
  <div class="flex flex-wrap items-center gap-1.5">
    <span class="badge-cyber is-emerald text-[10px]">
      <Check size={10} /> Local Inference
    </span>
    <span class="badge-cyber is-cyan text-[10px]">
      <Check size={10} /> Zero Tracking
    </span>
    <span class="badge-cyber is-amber text-[10px]">
      <Check size={10} /> Direct Connections
    </span>
  </div>

  <!-- Scrollable Policy Reader -->
  <div class="relative">
    <div
      class="h-[320px] overflow-y-auto rounded-xl bg-[var(--bg-void)] border border-[var(--border-line)] p-4 custom-scrollbar scroll-smooth"
    >
      {#if privacyLoading}
        <div
          class="flex flex-col items-center justify-center h-full gap-2 text-[var(--text-muted)]"
        >
          <LoaderCircle size={20} class="animate-spin text-[var(--accent-cyan)]" />
          <span class="text-xs font-mono">Loading policy...</span>
        </div>
      {:else if privacyFetchError}
        <div
          class="flex flex-col items-center justify-center h-full gap-2.5 text-[var(--text-muted)] text-center p-4"
        >
          <CircleAlert size={22} class="text-[var(--accent-rose)]" />
          <p class="text-xs text-[var(--text-primary)] font-medium">
            Could not fetch remote policy document.
          </p>
          <p class="text-[11px] text-[var(--text-dim)]">
            LMT performs 100% on-device processing in WebGPU mode and zero analytics tracking.
          </p>
          <button
            type="button"
            onclick={fetchPrivacy}
            class="btn-ghost !py-1 !px-2.5 text-xs cursor-pointer mt-1"
          >
            Retry
          </button>
        </div>
      {:else}
        <div class="prose-clean">
          {@html parsedPrivacy}
        </div>
      {/if}
    </div>
    <!-- Fade hint at bottom -->
    <div
      class="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-[var(--bg-void)] to-transparent pointer-events-none rounded-b-xl"
    ></div>
  </div>

  <!-- Accept Checkbox -->
  <label class="flex items-center gap-3 cursor-pointer group select-none pt-0.5">
    <div class="relative flex items-center shrink-0">
      <input
        type="checkbox"
        bind:checked={acceptedPolicy}
        class="peer sr-only"
      />
      <div
        class="h-4.5 w-4.5 rounded-[4px] border border-[var(--border-line)] bg-[var(--bg-void)] peer-checked:bg-[var(--accent-cyan)] peer-checked:border-[var(--accent-cyan)] transition-all flex items-center justify-center"
      >
        <Check
          size={12}
          class="text-[#05040b] scale-0 peer-checked:scale-100 transition-transform stroke-[3]"
        />
      </div>
    </div>
    <span
      class="text-xs font-medium text-[var(--text-primary)] group-hover:text-[var(--accent-cyan)] transition-colors"
    >
      I have read and agree to the Privacy Policy
    </span>
  </label>

  <!-- Actions -->
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
      disabled={!acceptedPolicy || privacyLoading}
      class="btn-primary flex-1 text-xs !py-2.5 font-bold cursor-pointer disabled:bg-none disabled:bg-[var(--surface-panel-alt)] disabled:border-[var(--border-line)] disabled:text-[var(--text-dim)] disabled:opacity-60 disabled:shadow-none disabled:cursor-not-allowed"
    >
      Accept &amp; Continue
      <ChevronRight size={14} />
    </button>
  </div>
</div>
