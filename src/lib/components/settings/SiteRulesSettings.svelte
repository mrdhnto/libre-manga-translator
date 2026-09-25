<script lang="ts">
  import { COMMUNITY_RULES } from "@/lib/adapters";
  import { env } from "@/lib/env";
  import { FileCode, Play, Plus, Trash2 } from "lucide-svelte";

  let {
    customRules = $bindable([]),
    hostname = "",
    title = "",
    path = "",
    currentMode = "webgpu",
    geminiKey = "",
    geminiModel = "",
    llmModel = "",
    llmTemperature = 0.7,
    serverHost = "",
    serverSchema = "openai",
    serverModel = "",
    useServerApiKey = false,
    serverApiKey = "",
  }: {
    customRules: SiteRule[];
    hostname?: string;
    title?: string;
    path?: string;
    currentMode?: string;
    geminiKey?: string;
    geminiModel?: string;
    llmModel?: string;
    llmTemperature?: number;
    serverHost?: string;
    serverSchema?: string;
    serverModel?: string;
    useServerApiKey?: boolean;
    serverApiKey?: string;
  } = $props();

  let editingRule = $state<SiteRule | null>(null);
  let testResult = $state<any>(null);
  let isTesting = $state(false);
  let isGeneratingAI = $state(false);

  function addRule() {
    editingRule = {
      id: crypto.randomUUID(),
      domain: hostname || window.location.hostname,
      seriesName: {
        regex: "",
        source: "title",
      },
      chapterId: {
        regex: "",
        source: "path",
      },
      pageIndex: {
        regex: "",
        source: "path",
      },
    };
  }

  function saveRule() {
    const idx = customRules.findIndex((r) => r.id === editingRule!.id);
    if (idx >= 0) customRules[idx] = editingRule!;
    else customRules.push(editingRule!);
    editingRule = null;
    testResult = null;
  }

  async function testRule() {
    isTesting = true;
    testResult = null;
    try {
      testResult = await browser.runtime.sendMessage({
        type: "TEST_SITE_RULE",
        data: { rule: editingRule },
      });
    } catch {
      testResult = { error: "Failed to test rule on active tab." };
    }
    isTesting = false;
  }

  function shareRuleToGitHub(rule: SiteRule) {
    if (!env.githubRepo) {
      alert("GitHub repo not configured in this build.");
      return;
    }

    const ruleSnippet = JSON.stringify(
      {
        ...rule,
        id: rule.domain.replace(/[^a-zA-Z0-9]/g, ""),
      },
      null,
      2,
    );

    const ghTitle = encodeURIComponent(`[Site Rule] Support for ${rule.domain}`);
    const ghBody = encodeURIComponent(
      `Please add this custom rule to \`COMMUNITY_RULES\`:\n\n\`\`\`json\n${ruleSnippet}\n\`\`\``,
    );

    window.open(
      `${env.githubRepo}/issues/new?title=${ghTitle}&body=${ghBody}&labels=enhancement`,
      "_blank",
    );
  }

  function generateRegexWithAI() {
    isGeneratingAI = true;
    browser.runtime
      .sendMessage({
        type: "MAKE_SITE_RULE_AI",
        data: {
          title: title || document.title,
          path: path || window.location.pathname,
        },
        config: {
          currentMode,
          geminiKey,
          geminiModel,
          llmModel,
          llmTemperature,
          serverHost,
          serverSchema,
          serverModel,
          useServerApiKey,
          serverApiKey,
        },
      })
      .then((res: AIGeneratedRule | { error: string }) => {
        if ("error" in res) {
          alert(res.error);
        } else {
          editingRule = {
            ...(editingRule || {
              id: crypto.randomUUID(),
              domain: hostname || window.location.hostname,
            }),
            ...res,
          };
        }
        isGeneratingAI = false;
      });
  }
</script>

<div>
  <span class="kicker ml-0.5">
    Site parsing rules
  </span>
  <div
    class="panel-card !p-2.5 space-y-3"
  >
    {#if editingRule}
      <div class="space-y-1">
        <label
          for="domain"
          class="text-[10px] font-bold uppercase tracking-widest text-zinc-400"
        >
          Domain
        </label>
        <input
          id="domain"
          type="text"
          bind:value={editingRule.domain}
          placeholder="e.g. mangadex.org"
          class="w-full bg-[var(--bg-void)] border border-[var(--border-faint)] rounded-lg p-2 text-xs outline-none focus:border-[var(--border-line)]"
        />
      </div>

      <button
        onclick={generateRegexWithAI}
        disabled={isGeneratingAI}
        class="btn-primary w-full justify-center py-2 my-2 text-xs font-bold uppercase tracking-wider"
      >
        {#if isGeneratingAI}
          <span class="animate-spin text-xs">🌀</span> Generating…
        {:else}
          ✨ Auto-Generate Rules with Active AI
        {/if}
      </button>

      <div class="space-y-3">
        <div class="flex justify-between items-center mb-2">
          <span
            class="text-xs font-bold uppercase tracking-widest text-zinc-500"
          >
            Edit Rule
          </span>
          <button
            onclick={() => {
              editingRule = null;
              testResult = null;
            }}
            class="text-xs text-zinc-500 hover:text-red-500 cursor-pointer"
          >
            Cancel
          </button>
        </div>

        <div class="space-y-1.5">
          <label
            for="series-name-rule"
            class="text-[10px] font-bold uppercase tracking-widest text-zinc-500"
          >
            Series Name
          </label>
          <div class="flex gap-2">
            <select
              id="series-name-rule"
              bind:value={editingRule.seriesName.source}
              class="bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg p-2 text-xs outline-none cursor-pointer"
            >
              <option value="title">Title</option>
              <option value="path">Path</option>
              <option value="hash">Hash</option>
            </select>
            <input
              type="text"
              bind:value={editingRule.seriesName.regex}
              placeholder="Regex..."
              class="flex-1 bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-700 rounded-lg p-2 text-xs outline-none font-mono shadow-sm"
            />
          </div>
        </div>

        <div class="space-y-1.5">
          <label
            for="chapter-id-rule"
            class="text-[10px] font-bold uppercase tracking-widest text-zinc-500"
          >
            Chapter ID
          </label>
          <div class="flex gap-2">
            <select
              bind:value={editingRule.chapterId.source}
              class="bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg p-2 text-xs outline-none cursor-pointer"
            >
              <option value="title">Title</option>
              <option value="path">Path</option>
              <option value="hash">Hash</option>
            </select>
            <input
              id="chapter-id-rule"
              type="text"
              bind:value={editingRule.chapterId.regex}
              placeholder="Regex..."
              class="flex-1 bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-700 rounded-lg p-2 text-xs outline-none font-mono shadow-sm"
            />
          </div>
        </div>

        <div class="space-y-1.5">
          <label
            for="page-index-rule"
            class="text-[10px] font-bold uppercase tracking-widest text-zinc-500"
          >
            Page Index
          </label>
          <div class="flex gap-2">
            <select
              bind:value={editingRule.pageIndex.source}
              class="bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg p-2 text-xs outline-none cursor-pointer"
            >
              <option value="title">Title</option>
              <option value="path">Path</option>
              <option value="hash">Hash</option>
            </select>
            <input
              id="page-index-rule"
              type="text"
              bind:value={editingRule.pageIndex.regex}
              placeholder="Regex..."
              class="flex-1 bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-700 rounded-lg p-2 text-xs outline-none font-mono shadow-sm"
            />
          </div>
        </div>

        <div
          class="mt-4 p-3 bg-blue-50 dark:bg-blue-900/10 border border-blue-200 dark:border-blue-800/30 rounded-lg"
        >
          <div class="flex justify-between items-center mb-2">
            <span class="text-xs font-bold text-blue-700 dark:text-blue-400">
              Live Test on Current Tab
            </span>
            <button
              onclick={testRule}
              disabled={isTesting}
              class="flex items-center gap-1 px-2 py-1 bg-blue-500 hover:bg-blue-600 text-white rounded text-[10px] font-bold uppercase tracking-wider cursor-pointer disabled:opacity-50"
            >
              <Play size={10} /> Test
            </button>
          </div>

          {#if testResult}
            <div
              class="space-y-2 mt-2 pt-2 border-t border-blue-200 dark:border-blue-800/50"
            >
              {#if testResult.error}
                <p class="text-xs text-red-500">{testResult.error}</p>
              {:else}
                <div
                  class="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-[10px]"
                >
                  <span class="text-zinc-500 font-bold uppercase">Series:</span>
                  <span class="font-mono text-zinc-800 dark:text-zinc-200 truncate">
                    {testResult.context.seriesName}
                  </span>
                  <span class="text-zinc-500 font-bold uppercase">Chapter:</span>
                  <span class="font-mono text-zinc-800 dark:text-zinc-200 truncate">
                    {testResult.context.chapterId}
                  </span>
                  <span class="text-zinc-500 font-bold uppercase">Page:</span>
                  <span class="font-mono text-zinc-800 dark:text-zinc-200 truncate">
                    {testResult.context.pageIndex}
                  </span>
                </div>
              {/if}
            </div>
          {/if}
        </div>

        <button
          onclick={saveRule}
          class="w-full py-2 bg-zinc-800 hover:bg-zinc-700 dark:bg-zinc-200 dark:hover:bg-zinc-300 text-white dark:text-zinc-900 rounded-lg text-xs font-bold transition-colors cursor-pointer mt-2"
        >
          Save Rule
        </button>

        {#if COMMUNITY_RULES.some((r) => r.domain === editingRule?.domain) && editingRule.seriesName.regex && editingRule.chapterId.regex && editingRule.pageIndex.regex}
          <button
            onclick={() => shareRuleToGitHub(editingRule!)}
            class="px-3 py-2 bg-blue-100 hover:bg-blue-200 dark:bg-blue-900/30 dark:hover:bg-blue-900/50 text-blue-600 dark:text-blue-400 rounded-lg text-xs font-bold transition-colors cursor-pointer flex items-center gap-1.5"
            title="Submit this rule to the official repository"
          >
            Share Rule
          </button>
        {/if}
      </div>
    {:else}
      <div class="space-y-2">
        {#each customRules as rule}
          <div
            class="overflow-y-scroll max-h-75 flex items-center justify-between p-2 bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg shadow-sm"
          >
            <div class="flex items-center gap-2 overflow-hidden">
              <FileCode size={14} class="text-blue-500 shrink-0" />
              <span class="text-xs font-mono truncate">{rule.domain}</span>
            </div>
            <div class="flex gap-1 shrink-0">
              <button
                onclick={() => (editingRule = { ...rule })}
                class="text-[10px] px-2 py-1 rounded bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 cursor-pointer transition-colors"
              >
                Edit
              </button>
              <button
                onclick={() =>
                  (customRules = customRules.filter((r) => r.id !== rule.id))}
                class="p-1 text-zinc-400 hover:text-red-500 cursor-pointer transition-colors"
              >
                <Trash2 size={12} />
              </button>
            </div>
          </div>
        {/each}

        {#if customRules.length === 0}
          <div class="text-center py-3 text-xs text-zinc-500 italic">
            No custom rules added.
          </div>
        {/if}

        <button
          onclick={addRule}
          class="w-full flex justify-center items-center gap-1 py-2 border-2 border-dashed border-zinc-300 dark:border-zinc-700 hover:border-blue-400 dark:hover:border-blue-500 text-zinc-500 hover:text-blue-500 rounded-lg text-xs font-bold transition-colors cursor-pointer mt-2"
        >
          <Plus size={14} /> Add Custom Rule
        </button>
      </div>
    {/if}
  </div>
</div>
