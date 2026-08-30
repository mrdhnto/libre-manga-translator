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

<div>
  <span class="text-sm font-bold uppercase tracking-widest text-zinc-500 ml-1">
    Typography
  </span>
  <div
    class="bg-zinc-50 dark:bg-zinc-900/50 p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 mt-2 space-y-4"
  >
    <!-- Bundled font picker -->
    <div class="flex flex-col space-y-2">
      <label
        for="bundle-font"
        class="text-[10px] font-bold uppercase tracking-widest text-zinc-500"
      >
        Bubble Font
      </label>
      <div class="grid grid-cols-2 gap-2">
        {#each DefaultConfig.bundleFonts as font}
          <button
            onclick={() => (textFont = font.id)}
            class="px-3 py-2 rounded-lg border text-sm transition-all cursor-pointer text-left shadow-sm
            {textFont === font.id
              ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400'
              : 'border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-zinc-700 dark:text-zinc-300 hover:border-zinc-400'}"
            style="font-family: {font.stack}"
          >
            {font.label}
          </button>
        {/each}
      </div>
    </div>

    <!-- Custom fonts list -->
    {#if customFonts.length > 0}
      <div class="flex flex-col space-y-1.5">
        <label
          for="custom-fonts"
          class="text-[10px] font-bold uppercase tracking-widest text-zinc-500"
        >
          Custom Fonts
        </label>
        <div class="space-y-1.5">
          {#each customFonts as font}
            <div
              class="flex items-center justify-between px-3 py-2 rounded-lg border cursor-pointer transition-all shadow-sm
              {textFont === font.name
                ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400'
                : 'border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950'}"
              role="presentation"
              onclick={() => (textFont = font.name)}
            >
              <span
                class="text-sm truncate max-w-40"
                style="font-family: '{font.name}', sans-serif"
              >
                {font.name}
              </span>
              <button
                onclick={(e) => {
                  e.stopPropagation();
                  deleteCustomFont(font.name);
                }}
                class="text-zinc-400 hover:text-red-500 transition-colors ml-2 cursor-pointer p-1 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800"
                aria-label="Delete font"
              >
                <X size={14} />
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
        isDraggingOver = false;
        handleDrop(e);
      }}
      class="flex flex-col items-center justify-center gap-1.5 w-full py-4 px-3 rounded-lg border-2 border-dashed
      transition-colors cursor-pointer bg-white dark:bg-zinc-950
      {isDraggingOver
        ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 text-blue-500'
        : 'border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:border-blue-400 hover:text-blue-500'}"
    >
      {#if fontUploading}
        <LoaderCircle size={18} class="animate-spin" />
        <span class="text-sm font-medium">Uploading...</span>
      {:else}
        <Upload size={18} />
        <span class="text-sm font-medium">Drag & Drop Font Here</span>
        <span class="text-[10px] opacity-60">(.ttf, .otf, .woff)</span>
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
