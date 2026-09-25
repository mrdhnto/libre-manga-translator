<script lang="ts">
  import { DefaultConfig } from "@/lib/configs";
  import { LoaderCircle, Upload, X } from "lucide-svelte";

  let {
    textFont = $bindable(DefaultConfig.bundleFonts[0].id),
    customFonts = $bindable([]),
  }: {
    textFont: string;
    customFonts: { name: string; dataUrl: string }[];
  } = $props();

  let fontUploading = $state(false);
  let isDraggingOver = $state(false);

  function processFontFile(file: File) {
    if (!file.name.match(/\.(ttf|otf|woff|woff2)$/i)) {
      alert("Please upload a .ttf, .otf, .woff, or .woff2 file");
      return;
    }

    fontUploading = true;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const name = file.name.replace(/\.[^.]+$/, "");
      customFonts = [...customFonts, { name, dataUrl }];
      textFont = name;
      fontUploading = false;
    };
    reader.readAsDataURL(file);
  }

  function handleFontUpload(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) processFontFile(file);
    input.value = "";
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0];
    if (file) processFontFile(file);
  }

  function deleteCustomFont(name: string) {
    customFonts = customFonts.filter((f) => f.name !== name);
    if (textFont === name) textFont = "system";
  }
</script>

<div class="space-y-1.5">
  <span class="kicker ml-0.5">
    Typography & fonts
  </span>
  <div class="panel-card !p-2.5 space-y-3">
    <!-- Bundled font picker -->
    <div class="space-y-1.5">
      <span class="text-[10px] font-bold uppercase tracking-widest text-[var(--text-dim)]">
        Bubble Font Stack
      </span>
      <div class="grid grid-cols-2 gap-1.5">
        {#each DefaultConfig.bundleFonts as font}
          <button
            type="button"
            onclick={() => (textFont = font.id)}
            class="px-2.5 py-1.5 rounded-lg border text-xs transition-colors cursor-pointer text-left
            {textFont === font.id
              ? 'border-[var(--accent-emerald)]/50 bg-[var(--accent-emerald-soft)] text-[var(--accent-emerald)] font-medium'
              : 'border-[var(--border-line)] bg-[var(--bg-void)] text-[var(--text-muted)] hover:border-[var(--accent-emerald)]/50 hover:text-[var(--text-primary)]'}"
            style="font-family: {font.stack}"
          >
            {font.label}
          </button>
        {/each}
      </div>
    </div>

    <!-- Custom fonts list -->
    {#if customFonts.length > 0}
      <div class="space-y-1.5">
        <span class="text-[10px] font-bold uppercase tracking-widest text-[var(--text-dim)]">
          User Fonts
        </span>
        <div class="space-y-1">
          {#each customFonts as font}
            <div
              class="flex items-center justify-between px-2 py-1.5 rounded-lg border cursor-pointer transition-colors
              {textFont === font.name
                ? 'border-[var(--accent-emerald)]/50 bg-[var(--accent-emerald-soft)] text-[var(--accent-emerald)] font-medium'
                : 'border-[var(--border-line)] bg-[var(--bg-void)] text-[var(--text-muted)] hover:border-[var(--accent-emerald)]/50 hover:text-[var(--text-primary)]'}"
              role="presentation"
              onclick={() => (textFont = font.name)}
            >
              <span class="text-xs truncate max-w-44" style="font-family: '{font.name}', sans-serif">
                {font.name}
              </span>
              <button
                type="button"
                onclick={(e) => {
                  e.stopPropagation();
                  deleteCustomFont(font.name);
                }}
                class="text-[var(--text-dim)] hover:text-[var(--accent-rose)] transition-colors cursor-pointer p-0.5"
                aria-label="Delete font"
              >
                <X size={13} />
              </button>
            </div>
          {/each}
        </div>
      </div>
    {/if}

    <!-- Upload Drop Area -->
    <label
      ondragover={(e) => {
        e.preventDefault();
        isDraggingOver = true;
      }}
      ondragleave={() => (isDraggingOver = false)}
      ondrop={(e) => {
        e.preventDefault();
        isDraggingOver = false;
        handleDrop(e);
      }}
      class="flex flex-col items-center justify-center gap-1 w-full py-3 px-2 rounded-lg border border-dashed
      transition-colors cursor-pointer bg-[var(--bg-void)]
      {isDraggingOver
        ? 'border-[var(--accent-emerald)] text-[var(--accent-emerald)] bg-[var(--accent-emerald-soft)]'
        : 'border-[var(--border-line)] text-[var(--text-dim)] hover:text-[var(--text-primary)] hover:border-[var(--accent-emerald)]/50'}"
    >
      {#if fontUploading}
        <LoaderCircle size={15} class="animate-spin" />
        <span class="text-xs">Uploading…</span>
      {:else}
        <Upload size={15} />
        <span class="text-xs font-medium">Drop custom font</span>
        <span class="text-[11px] text-[var(--text-dim)]">.ttf · .otf · .woff · .woff2</span>
      {/if}

      <input
        type="file"
        accept=".ttf,.otf,.woff,.woff2"
        class="sr-only"
        onchange={handleFontUpload}
      />
    </label>
  </div>
</div>
