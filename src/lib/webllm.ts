import type { MLCEngine } from "@mlc-ai/web-llm";
import { DefaultConfig, defaultLlmModelId } from "./configs";
import { buildSiteRulePrompts, buildTranslationPrompts } from "./prompts";
import { parseLlmJson, validateTranslationResult } from "./server/validator";

// Dynamic-only: @mlc-ai/web-llm is a multi-MB prebundled file. A static
// import would bake it into shared initial chunks and break the
// 2MB-per-.js Firefox AMO limit. It loads on the first local-LLM call
// instead (own async chunk). On Firefox builds the branch is statically
// false (import.meta.env.FIREFOX is build-time replaced), so the bundler
// drops the chunk entirely — Firefox uses wllama (GGUF).
const loadWebLlm = () =>
  import.meta.env.FIREFOX
    ? Promise.reject(
        new Error("web-llm backend excluded from Firefox builds"),
      )
    : import("@mlc-ai/web-llm");

let globalEngine: MLCEngine | null = null;
let currentlyLoadedModel: string | null = null;

export async function translateLocal(
  ocrResults: string[],
  targetLang: string,
  sourceLang: string,
  seriesContext?: SeriesContext,
  model = defaultLlmModelId(),
  temperature = DefaultConfig.llmTemperature,
): Promise<TranslateResult> {
  if (!ocrResults || ocrResults.length === 0) {
    return { translations: [] };
  }

  const { systemPrompt, userPrompt, schema } = buildTranslationPrompts(
    ocrResults,
    targetLang,
    sourceLang,
    seriesContext,
  );

  const raw = await runLLMModel(
    systemPrompt,
    userPrompt,
    schema,
    model,
    temperature,
  );
  const validated = validateTranslationResult(raw.parsed, ocrResults.length);
  if (raw.llmPerf) (validated as TranslateResult).llmPerf = raw.llmPerf;
  return validated as TranslateResult;
}

export async function makeSiteRuleLocal(
  title: string,
  path: string,
  model = defaultLlmModelId(),
  temperature = DefaultConfig.llmTemperature,
): Promise<AIGeneratedRule> {
  const { systemPrompt, userPrompt, schema } = buildSiteRulePrompts(
    title,
    path,
  );

  const raw = await runLLMModel(
    systemPrompt,
    userPrompt,
    schema,
    model,
    temperature,
  );
  return raw.parsed as AIGeneratedRule;
}

async function runLLMModel(
  systemPrompt: string,
  userPrompt: string,
  schema: string,
  model: string,
  temperature: number,
) {
  if (!globalEngine) {
    const { MLCEngine } = await loadWebLlm();
    globalEngine = new MLCEngine();
  }

  if (currentlyLoadedModel !== model) {
    await globalEngine.reload(model);
    currentlyLoadedModel = model;
  }

  const t0 = performance.now();
  const reply = await globalEngine.chatCompletion({
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature,
    response_format: {
      type: "json_object",
      schema,
    },
  });
  const totalMs = performance.now() - t0;

  const content = reply.choices[0]?.message?.content;
  if (!content) {
    throw new Error("Local LLM returned empty response");
  }

  try {
    const parsed = parseLlmJson(content);
    return { parsed, llmPerf: extractWebLlmPerf(reply, totalMs) };
  } catch (error) {
    console.error("Failed to parse LLM output:", content);
    throw new Error(`Local LLM generated invalid JSON: ${(error as Error).message}`);
  }
}

/** Token stats from WebLLM usage (prefill/decode rates live in extra). */
function extractWebLlmPerf(
  reply: { usage?: { prompt_tokens?: number; completion_tokens?: number; extra?: { prefill_tokens_per_s?: number; decode_tokens_per_s?: number } } },
  totalMs: number,
): LlmPerf | undefined {
  const usage = reply?.usage;
  if (!usage) return undefined;
  const promptTps = usage.extra?.prefill_tokens_per_s;
  const genTps = usage.extra?.decode_tokens_per_s;
  return {
    ...(usage.prompt_tokens !== undefined
      ? { promptTokens: usage.prompt_tokens }
      : {}),
    ...(usage.completion_tokens !== undefined
      ? { completionTokens: usage.completion_tokens }
      : {}),
    ...(promptTps !== undefined ? { promptTps } : {}),
    ...(genTps !== undefined ? { genTps } : {}),
    totalMs,
  };
}
