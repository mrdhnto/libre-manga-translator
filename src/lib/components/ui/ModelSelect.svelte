<script lang="ts">
  import { onDestroy } from "svelte";
  import { Check, Download, LoaderCircle, ChevronDown, X } from "lucide-svelte";

  interface Option {
    id: string;
    label: string;
    size: string;
    desc?: string;
  }

  let {
    value = $bindable(""),
    options = [] as Option[],
    cached = {} as Record<string, boolean>,
    loadingId = null as string | null,
    progress = {} as Record<string, number>,
    onDownload,
    id,
    label,
  }: {
    value: string;
    options: Option[];
    cached?: Record<string, boolean>;
    loadingId?: string | null;
    progress?: Record<string, number>;
    onDownload?: (id: string) => void;
    id?: string;
    label?: string;
  } = $props();

  let isOpen = $state(false);
  let rootEl: HTMLDivElement | undefined = $state(undefined);
  let buttonEl: HTMLButtonElement | undefined = $state(undefined);
  let listEl: HTMLDivElement | undefined = $state(undefined);
  let listPos = $state({ top: 0, left: 0, width: 0 });

  const activeOption = $derived(options.find((o) => o.id === value) ?? null);
  const activeCached = $derived(activeOption ? (cached[activeOption.id] ?? false) : false);

  function placeList() {
    if (!buttonEl) return;
    const r = buttonEl.getBoundingClientRect();
    listPos = { top: r.bottom + 6, left: r.left, width: r.width };
  }

  // Portal the dropdown list to the top of our root tree (shadow root in the
  // sidebar, document.body in the popup). Ancestors with backdrop-filter/transform
  // or flex sizing (e.g. the sidebar's backdrop-blur-md panel, the flex-1
  // wrapper in BackendSettings) otherwise misplace or clip the list.
  function portalTarget(): ParentNode | null {
    const b = buttonEl;
    if (!b) return null;
    const root = b.getRootNode();
    if (root instanceof Document) return root.body;
    if (root instanceof ShadowRoot) return root;
    return null;
  }

  $effect(() => {
    if (!isOpen) return;
    const el = listEl;
    if (!el) return;
    const target = portalTarget();
    if (target && el.parentNode !== target) target.appendChild(el);
    return () => {
      el.remove();
    };
  });

  onDestroy(() => {
    listEl?.remove();
  });

  function toggle(e: MouseEvent) {
    e.stopPropagation();
    if (!isOpen) placeList();
    isOpen = !isOpen;
  }

  function select(optId: string) {
    if (!cached[optId]) return;
    value = optId;
    isOpen = false;
  }

  function handleDownload(e: MouseEvent, optId: string) {
    e.stopPropagation();
    if (onDownload) onDownload(optId);
  }

  function close() {
    isOpen = false;
  }

  $effect(() => {
    if (!isOpen) return;

    function onDocClick(e: MouseEvent) {
      const path = typeof e.composedPath === "function" ? e.composedPath() : [];
      if (rootEl && (path.includes(rootEl) || path.includes(buttonEl as Node))) return;
      if (listEl && (path.includes(listEl) || (e.target instanceof Node && listEl.contains(e.target)))) return;
      if (rootEl && e.target instanceof Node && rootEl.contains(e.target)) return;
      isOpen = false;
    }

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") isOpen = false;
    }
    // The list is viewport-fixed so ancestor scroll would detach it — close
    // on outside scroll, but never on scrolls originating inside the list.
    function onScroll(e: Event) {
      if (listEl && e.target instanceof Node && listEl.contains(e.target)) return;
      isOpen = false;
    }

    document.addEventListener("click", onDocClick, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);

    return () => {
      document.removeEventListener("click", onDocClick, true);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  });
</script>

<div bind:this={rootEl} class="relative w-full">
  {#if label}
    <label for={id} class="text-[11px] font-semibold text-[var(--text-muted)] mb-1 block">
      {label}
    </label>
  {/if}

  <button
    bind:this={buttonEl}
    id={id}
    type="button"
    onclick={toggle}
    aria-haspopup="listbox"
    aria-expanded={isOpen}
    class="w-full flex items-center justify-between gap-2 px-3 py-2 text-xs rounded-lg border text-left cursor-pointer transition-all
           bg-[var(--bg-void)] border-[var(--border-line)]
           hover:border-[var(--border-line)]/80 focus-visible:outline-2 focus-visible:outline-[var(--accent-cyan)] focus-visible:outline-offset-2
           {isOpen ? 'border-[var(--accent-cyan)] shadow-[0_0_8px_var(--accent-cyan-glow)]' : ''}"
  >
    <div class="flex flex-col items-start min-w-0">
      <div class="flex items-center gap-1.5 max-w-full">
        <span class="font-display font-semibold truncate text-[var(--text-primary)]">
          {activeOption ? `${activeOption.label}` : "Select model"}
        </span>
        {#if activeOption}
          <span class="font-mono text-[10px] text-[var(--text-dim)] shrink-0">
            {activeOption.size}
          </span>
        {/if}
      </div>
      {#if activeOption}
        <div class="flex items-center gap-1 mt-0.5">
          {#if activeCached}
            <span class="text-[10px] text-[var(--accent-emerald)] font-medium">Ready</span>
          {:else}
            <span class="text-[10px] text-[var(--accent-amber)] font-medium">Needs download</span>
          {/if}
          {#if activeOption.desc}
            <span class="text-[10px] text-[var(--text-dim)] truncate">· {activeOption.desc}</span>
          {/if}
        </div>
      {/if}
    </div>
    <div class="flex items-center gap-2 shrink-0">
      {#if loadingId && activeOption && loadingId === activeOption.id}
        <LoaderCircle size={14} class="animate-spin text-[var(--accent-cyan)]" />
      {/if}
      <ChevronDown size={14} class="text-[var(--text-dim)] transition-transform duration-200 {isOpen ? 'rotate-180 text-[var(--accent-cyan)]' : ''}" />
    </div>
  </button>

  <!-- Global Progress Tracker (Active Download Outside List) -->
  {#if loadingId && progress[loadingId] !== undefined && (progress[loadingId] ?? 0) > 0 && !isOpen}
    <div class="mt-1.5 px-2.5 py-2 rounded-lg border border-[var(--border-line)] bg-[var(--bg-void)]">
      <div class="flex justify-between items-center mb-1">
        <span class="text-[11px] text-[var(--text-muted)] truncate">
          Downloading {options.find((o) => o.id === loadingId)?.label ?? loadingId}
        </span>
        <span class="text-[11px] font-mono font-semibold text-[var(--accent-cyan)]">
          {Math.round((progress[loadingId] ?? 0) * 100)}%
        </span>
      </div>
      <div class="h-1 w-full bg-[var(--surface-panel)] rounded-full overflow-hidden border border-[var(--border-faint)]">
        <div
          class="h-full bg-[var(--accent-cyan)] shadow-[0_0_6px_var(--accent-cyan-glow)] transition-all duration-300"
          style="width: {(progress[loadingId] ?? 0) * 100}%"
        ></div>
      </div>
    </div>
  {/if}

  {#if isOpen}
    <!-- Viewport-fixed + portaled so it escapes overflow/clip/flex ancestors -->
    <div
      bind:this={listEl}
      role="listbox"
      class="fixed z-[100000] max-h-72 overflow-y-auto custom-scrollbar rounded-xl border shadow-2xl
             bg-[var(--surface-panel)] border-[var(--border-line)]"
      style="top: {listPos.top}px; left: {listPos.left}px; width: {Math.max(listPos.width, 220)}px;"
    >
      <div class="p-2 space-y-1.5">
        {#each options as opt}
          {@const isCached = cached[opt.id] ?? false}
          {@const isActive = value === opt.id}
          {@const isLoading = loadingId === opt.id}
          {@const currentProgress = progress[opt.id] ?? 0}

          <div
            class="relative w-full rounded-lg border transition-all overflow-hidden
              {isActive && isCached
                ? 'bg-[var(--surface-panel-alt)] border-[var(--accent-cyan)]/60 shadow-[0_0_10px_var(--accent-cyan-glow)]'
                : isCached
                  ? 'bg-[var(--bg-void)] border-[var(--border-line)] hover:border-[var(--accent-cyan)]/40 hover:bg-[var(--surface-panel-alt)]'
                  : 'bg-[var(--bg-void)] border-[var(--border-line)] hover:border-[var(--border-line)]/80'}"
          >
            <div class="p-2.5 flex items-center justify-between gap-2.5">
              <!-- Clickable Content Area -->
              <button
                type="button"
                role="option"
                aria-selected={isActive}
                aria-disabled={!isCached}
                disabled={!isCached}
                onclick={() => select(opt.id)}
                title={isCached ? `Select ${opt.label}` : `Download ${opt.label} first to select`}
                class="flex-1 min-w-0 text-left cursor-pointer disabled:cursor-not-allowed select-none bg-transparent border-none p-0 focus:outline-none"
              >
                <div class="flex items-center justify-between gap-2 mb-1">
                  <span class="text-xs font-display font-bold truncate {isActive ? 'text-[var(--accent-cyan)]' : 'text-[var(--text-primary)]'}">
                    {opt.label}
                  </span>
                </div>

                <div class="flex items-center gap-1.5 mb-1 flex-wrap">
                  <span class="font-mono text-[10px] px-1.5 py-0.2 rounded bg-[var(--surface-panel)] border border-[var(--border-faint)] text-[var(--text-dim)]">
                    {opt.size}
                  </span>
                  {#if isActive && isCached}
                    <span class="badge-cyber is-cyan">
                      Active
                    </span>
                  {:else if isCached}
                    <span class="badge-cyber is-emerald">
                      Cached
                    </span>
                  {:else if isLoading}
                    <span class="badge-cyber is-cyan">
                      Downloading {Math.round(currentProgress * 100)}%
                    </span>
                  {:else}
                    <span class="badge-cyber is-amber">
                      Needs download
                    </span>
                  {/if}
                </div>

                {#if opt.desc}
                  <p class="text-[11px] leading-tight text-[var(--text-muted)] line-clamp-2">
                    {opt.desc}
                  </p>
                {/if}
              </button>

              <!-- Unified Action Slot (Identical Width & Alignment for All Rows) -->
              <div class="shrink-0 flex items-center justify-end min-w-[56px]">
                {#if isActive && isCached}
                  <div class="p-1 text-[var(--accent-cyan)] flex items-center justify-center" title="Currently active">
                    <Check size={16} class="stroke-[2.5]" />
                  </div>
                {:else if isCached}
                  <button
                    type="button"
                    onclick={() => select(opt.id)}
                    class="btn-ghost !py-1 !px-2.5 text-[11px] font-semibold cursor-pointer"
                  >
                    Select
                  </button>
                {:else if isLoading}
                  <div class="p-1 flex items-center justify-center text-[var(--accent-cyan)]" title="Downloading…">
                    <LoaderCircle size={16} class="animate-spin" />
                  </div>
                {:else}
                  <button
                    type="button"
                    onclick={(e) => handleDownload(e, opt.id)}
                    aria-label={`Download ${opt.label}`}
                    title={`Download ${opt.label}`}
                    class="btn-ghost !py-1 !px-2.5 font-bold flex items-center gap-1 cursor-pointer"
                  >
                    <Download size={18} />
                  </button>
                {/if}
              </div>
            </div>

            <!-- Integrated Progress Bar on Downloading Card -->
            {#if isLoading && currentProgress > 0}
              <div class="h-1 w-full bg-[var(--surface-panel)] overflow-hidden border-t border-[var(--border-faint)]">
                <div
                  class="h-full bg-[var(--accent-cyan)] shadow-[0_0_8px_var(--accent-cyan-glow)] transition-all duration-300"
                  style="width: {currentProgress * 100}%"
                ></div>
              </div>
            {/if}
          </div>
        {/each}
      </div>

      <div class="px-3 py-2 border-t border-[var(--border-faint)] bg-[var(--surface-panel-alt)] flex items-center justify-end">
        <button
          type="button"
          onclick={close}
          class="text-xs text-[var(--text-dim)] hover:text-[var(--text-primary)] cursor-pointer transition-colors"
        >
          Close
        </button>
      </div>
    </div>
  {/if}
</div>
