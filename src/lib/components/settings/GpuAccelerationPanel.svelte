<script lang="ts">
  import { onMount } from "svelte";
  import { DEFAULT_GPU_STATE, normalizeGpuState, type GpuState } from "@/lib/hardware";
  import { LoaderCircle, Cpu, Zap } from "lucide-svelte";

  let gpu = $state<GpuState>({ ...DEFAULT_GPU_STATE });
  let loading = $state(true);
  let probing = $state(false);

  async function load() {
    try {
      const items = await storage.getItems([
        "local:webgpu-supported",
        "sync:webgpu-master",
        "sync:webgpu-overrides",
      ]);
      const raw: Partial<GpuState> = {
        webgpuSupported: items.find((i) => i.key === "local:webgpu-supported")?.value as boolean | null | undefined,
        webgpuMaster: items.find((i) => i.key === "sync:webgpu-master")?.value as boolean | undefined,
        webgpuOverrides: items.find((i) => i.key === "sync:webgpu-overrides")?.value as GpuState["webgpuOverrides"] | undefined,
      };
      gpu = normalizeGpuState(raw);
    } finally {
      loading = false;
    }
  }

  async function save() {
    await storage.setItems([
      { key: "sync:webgpu-master", value: gpu.webgpuMaster },
      { key: "sync:webgpu-overrides", value: $state.snapshot(gpu.webgpuOverrides) },
    ]);
    // Best-effort notify offscreen to re-evaluate providers
    try {
      await browser.runtime.sendMessage({ type: "GPU_STATE_CHANGED", data: $state.snapshot(gpu) });
    } catch {}
  }

  async function reprobe() {
    probing = true;
    try {
      const res = await browser.runtime.sendMessage({ type: "CHECK_WEBGPU_SUPPORT", data: { force: true } });
      const supported = res?.supported === true;
      gpu.webgpuSupported = supported;
      if (supported) await storage.setItem("local:webgpu-supported", true);
      else await storage.removeItem("local:webgpu-supported");
      await save();
    } catch (e) {
      console.warn("[GpuPanel] reprobe failed", e);
    } finally {
      probing = false;
    }
  }

  onMount(() => load());

  // Persist when toggles change (after initial load)
  $effect(() => {
    if (loading) return;
    gpu.webgpuMaster;
    gpu.webgpuOverrides.llm;
    gpu.webgpuOverrides.inpaint;
    gpu.webgpuOverrides.ocr;
    save();
  });
</script>

<div class="space-y-1.5">
  <span class="kicker ml-0.5">GPU acceleration</span>

  {#if loading}
    <div class="panel-card flex items-center gap-2 text-xs text-[var(--text-muted)]">
      <LoaderCircle size={14} class="animate-spin" /> Checking GPU…
    </div>
  {:else}
    <div class="panel-card space-y-3">
      <div class="flex items-center justify-between gap-2">
        <div class="flex flex-col min-w-0">
          <span class="text-[13px] font-medium text-[var(--text-primary)] flex items-center gap-1.5">
            <Zap size={13} class="text-[var(--accent-cyan)] shrink-0" />
            High-performance GPU
          </span>
          <div class="flex items-center gap-1.5 mt-1">
            {#if gpu.webgpuSupported === true}
              <span class="badge-cyber is-emerald !text-[9px] !py-0.5 !px-1.5 font-semibold">
                <span class="pulse-dot is-emerald !w-1.5 !h-1.5"></span>
                Supported
              </span>
              <span class="text-[11px] text-[var(--text-muted)] truncate">WebGPU available</span>
            {:else if gpu.webgpuSupported === false}
              <span class="badge-cyber is-rose !text-[9px] !py-0.5 !px-1.5 font-semibold">
                <span class="pulse-dot is-rose !w-1.5 !h-1.5"></span>
                CPU only
              </span>
              <span class="text-[11px] text-[var(--text-muted)] truncate">WASM fallback active</span>
            {:else}
              <span class="badge-cyber is-amber !text-[9px] !py-0.5 !px-1.5 font-semibold">
                <span class="pulse-dot is-amber !w-1.5 !h-1.5"></span>
                Unknown
              </span>
              <span class="text-[11px] text-[var(--text-muted)] truncate">Check to verify</span>
            {/if}
          </div>
        </div>
        <button
          onclick={reprobe}
          disabled={probing}
          class="btn-ghost !py-1.5 !px-2.5 !text-[11px] shrink-0"
        >
          {#if probing}
            <LoaderCircle size={12} class="animate-spin" />
          {/if}
          Re-check
        </button>
      </div>

      <div class="flex items-center justify-between gap-2 pt-2.5 border-t border-[var(--border-faint)]">
        <div class="flex flex-col">
          <span class="text-[13px] font-medium text-[var(--text-primary)]">Master enable</span>
          <span class="text-xs text-[var(--text-muted)]">Use GPU where available</span>
        </div>
        <label class="switch-cyber is-emerald">
          <input type="checkbox" bind:checked={gpu.webgpuMaster} disabled={gpu.webgpuSupported === false} />
          <span class="track"><span class="thumb"></span></span>
        </label>
      </div>

      {#if gpu.webgpuMaster && gpu.webgpuSupported !== false}
        <div class="space-y-1 pt-1">
          {#each [
            { key: "ocr" as const, label: "Text detection", hint: "PaddleOCR rec/detect · ~30 MB" },
            { key: "inpaint" as const, label: "Image cleaning", hint: "LaMa / Telea · 0–200 MB" },
            { key: "llm" as const, label: "Translation", hint: "Qwen3 · 3–6 GB VRAM" },
          ] as item}
            <div class="flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg bg-[var(--bg-void)] border border-[var(--border-faint)]">
              <span class="flex flex-col min-w-0">
                <span class="text-[13px] text-[var(--text-primary)]">{item.label}</span>
                <span class="text-xs text-[var(--text-muted)]">{item.hint}</span>
              </span>
              <label class="switch-cyber is-emerald shrink-0">
                <input
                  type="checkbox"
                  checked={gpu.webgpuOverrides[item.key]}
                  onchange={(e) => (gpu.webgpuOverrides[item.key] = (e.currentTarget as HTMLInputElement).checked)}
                />
                <span class="track"><span class="thumb"></span></span>
              </label>
            </div>
          {/each}
        </div>
      {/if}

      <p class="text-[11px] leading-relaxed text-[var(--text-dim)] flex gap-1.5 pt-1 border-t border-[var(--border-faint)]">
        <Cpu size={12} class="shrink-0 mt-0.5" />
        <span class="break-words">WASM fallback is always available. GPU is probed offscreen with high-performance preference; a transient failure is cached as unknown, not unsupported.</span>
      </p>
    </div>
  {/if}
</div>
