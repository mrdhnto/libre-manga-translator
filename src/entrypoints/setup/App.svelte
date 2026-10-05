<script lang="ts">
  import { onMount } from "svelte";
  import { fly } from "svelte/transition";
  import { DefaultConfig, defaultLlmModelId } from "@/lib/configs";

  import WelcomeStep from "./steps/WelcomeStep.svelte";
  import PrivacyStep from "./steps/PrivacyStep.svelte";
  import DetectionStep from "./steps/DetectionStep.svelte";
  import ModeStep from "./steps/ModeStep.svelte";
  import GeminiStep from "./steps/GeminiStep.svelte";
  import ApiStep from "./steps/ApiStep.svelte";
  import LlmStep from "./steps/LlmStep.svelte";
  import OcrStep from "./steps/OcrStep.svelte";
  import InpaintStep from "./steps/InpaintStep.svelte";
  import ModelOnlyView from "./steps/ModelOnlyView.svelte";

  type Step =
    | "welcome"
    | "privacy"
    | "detection"
    | "mode"
    | "llm"
    | "gemini"
    | "api"
    | "ocr"
    | "inpaint";

  let step = $state<Step>("welcome");
  let isModelOnlyMode = $state(false);

  // Configuration state across wizard steps
  let detectionModel = $state(DefaultConfig.detectionModels[0].id);
  let selectedMode = $state<"webgpu" | "gemini" | "api">("webgpu");
  let geminiKey = $state("");
  let serverHost = $state(DefaultConfig.serverHost);
  let serverSchema = $state(DefaultConfig.serverSchema);
  let serverModel = $state(DefaultConfig.serverModel);
  let useServerApiKey = $state(DefaultConfig.useServerApiKey);
  let serverApiKey = $state(DefaultConfig.serverApiKey);
  let selectedLlmModel = $state(defaultLlmModelId());
  let selectedOcrEngine = $state(DefaultConfig.ocrEngine);
  let selectedInpaintMethod = $state<"fast" | "quality">("fast");

  onMount(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("model")) {
      isModelOnlyMode = true;
    }
  });

  function goTo(next: Step) {
    step = next;
  }

  function handleModeNext() {
    goTo(
      selectedMode === "gemini"
        ? "gemini"
        : selectedMode === "api"
          ? "api"
          : "llm",
    );
  }

  async function finishSetup() {
    await storage.setItems([
      { key: "local:is-first-run", value: false },
      { key: "sync:detection-model", value: detectionModel },
      { key: "sync:current-mode", value: selectedMode },
      { key: "sync:ocr-engine", value: selectedOcrEngine },
      { key: "sync:inpaint-method", value: selectedInpaintMethod },
      ...(selectedMode === "gemini" && geminiKey.trim()
        ? ([{ key: "local:gemini-key", value: geminiKey.trim() }] as any)
        : []),
      ...(selectedMode === "api"
        ? ([
            { key: "local:server-host", value: serverHost.trim() },
            { key: "local:server-schema", value: serverSchema },
            { key: "local:server-model", value: serverModel.trim() },
            { key: "local:use-server-api-key", value: useServerApiKey },
            ...(useServerApiKey && serverApiKey.trim()
              ? [
                  {
                    key: "local:server-api-key",
                    value: serverApiKey.trim(),
                  },
                ]
              : []),
          ] as any)
        : []),
    ]);
    window.close();
  }

  let activeWizardSteps = $derived<Step[]>(
    selectedMode === "gemini"
      ? ["privacy", "detection", "mode", "gemini"]
      : selectedMode === "api"
        ? ["privacy", "detection", "mode", "api", "ocr", "inpaint"]
        : ["privacy", "detection", "mode", "llm", "ocr", "inpaint"],
  );
  let wizardStepIndex = $derived(activeWizardSteps.indexOf(step));
  let progressPct = $derived(
    step === "welcome"
      ? 0
      : Math.min(
          100,
          Math.round(((wizardStepIndex + 1) / activeWizardSteps.length) * 100),
        ),
  );
</script>

<main
  class="min-h-screen bg-[var(--bg-void-0)] text-[var(--text-primary)] flex items-center justify-center p-4 sm:p-6 font-body transition-colors"
>
  <div class="w-full max-w-[540px]">
    {#if isModelOnlyMode}
      <ModelOnlyView />
    {:else}
      <!-- Main Setup Wizard Card -->
      <div
        class="bg-[var(--surface-panel)] rounded-2xl border border-[var(--border-line)] shadow-[var(--shadow-panel)] overflow-hidden transition-all duration-200"
      >
        <!-- Card Header with Stepper Info & Integrated Progress Bar -->
        {#if step !== "welcome"}
          <div
            class="px-6 pt-5 pb-3 border-b border-[var(--border-faint)] flex items-center justify-between"
          >
            <div class="flex items-center gap-2">
              <img
                src="/icon/48.png"
                alt="LMT"
                class="w-5 h-5 rounded object-contain"
              />
              <span
                class="font-display font-semibold text-xs tracking-tight text-[var(--text-muted)]"
              >
                Setup Wizard
              </span>
            </div>
            <div class="flex items-center gap-2">
              <span class="badge-cyber is-cyan">
                STEP {wizardStepIndex + 1}/{activeWizardSteps.length}
              </span>
            </div>
          </div>

          <!-- Integrated progress bar -->
          <div class="h-[2px] bg-[var(--border-faint)] w-full overflow-hidden">
            <div
              class="h-full bg-[var(--accent-cyan)] shadow-[0_0_8px_var(--accent-cyan-glow)] transition-all duration-300"
              style="width: {progressPct}%"
            ></div>
          </div>
        {/if}

        {#key step}
          <div in:fly={{ y: 8, duration: 240 }} class="p-6 sm:p-7">
            {#if step === "welcome"}
              <WelcomeStep onNext={() => goTo("privacy")} />
            {:else if step === "privacy"}
              <PrivacyStep
                onBack={() => goTo("welcome")}
                onNext={() => goTo("detection")}
              />
            {:else if step === "detection"}
              <DetectionStep
                bind:detectionModel
                onBack={() => goTo("privacy")}
                onNext={() => goTo("mode")}
              />
            {:else if step === "mode"}
              <ModeStep
                bind:selectedMode
                onBack={() => goTo("detection")}
                onNext={handleModeNext}
              />
            {:else if step === "gemini"}
              <GeminiStep
                bind:geminiKey
                onBack={() => goTo("mode")}
                onComplete={finishSetup}
              />
            {:else if step === "api"}
              <ApiStep
                bind:serverHost
                bind:serverSchema
                bind:serverModel
                bind:useServerApiKey
                bind:serverApiKey
                onBack={() => goTo("mode")}
                onNext={() => goTo("ocr")}
              />
            {:else if step === "llm"}
              <LlmStep
                bind:selectedLlmModel
                onBack={() => goTo("mode")}
                onNext={() => goTo("ocr")}
              />
            {:else if step === "ocr"}
              <OcrStep
                bind:selectedOcrEngine
                onBack={() => goTo(selectedMode === "api" ? "api" : "llm")}
                onNext={() => goTo("inpaint")}
              />
            {:else if step === "inpaint"}
              <InpaintStep
                bind:selectedInpaintMethod
                onBack={() => goTo("ocr")}
                onComplete={finishSetup}
              />
            {/if}
          </div>
        {/key}
      </div>
    {/if}
  </div>
</main>
