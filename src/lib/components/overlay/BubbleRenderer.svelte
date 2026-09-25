<script lang="ts">
  interface Props {
    translatedUrl: string;
    showOriginal: boolean;
    bboxes: Bbox[];
    scaleX: number;
    scaleY: number;
  }

  let {
    translatedUrl = "",
    showOriginal = false,
    bboxes = [],
    scaleX = 1,
    scaleY = 1,
  }: Props = $props();
</script>

{#if translatedUrl && !showOriginal}
  <img
    src={translatedUrl}
    alt="Translated Manga Scan"
    class="absolute inset-0 w-full h-full object-fill pointer-events-none z-30 select-none"
  />
{/if}

{#if showOriginal}
  <!-- In Original comparison mode, highlight gate-skipped boxes with subtle indicator -->
  {#each bboxes as box, i}
    {#if box.gateSkip}
      <div
        role="presentation"
        class="absolute border border-dashed border-amber-400/70 bg-amber-950/20 z-40 pointer-events-none"
        style:left="{box.x1 * scaleX}px"
        style:top="{box.y1 * scaleY}px"
        style:width="{(box.x2 - box.x1) * scaleX}px"
        style:height="{(box.y2 - box.y1) * scaleY}px"
      >
        <div class="absolute -top-4 -left-0.5 bg-amber-500 text-black font-mono font-bold text-[9px] px-1 py-0.2 rounded-xs">
          Declined
        </div>
      </div>
    {/if}
  {/each}
{/if}
