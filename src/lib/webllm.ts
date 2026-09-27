import { MLCEngine } from "@mlc-ai/web-llm";
import { DefaultConfig } from "./configs";
import { buildSiteRulePrompts, buildTranslationPrompts } from "./prompts";
import { parseLlmJson, validateTranslationResult } from "./server/validator";

let globalEngine: MLCEngine | null = null;
let currentlyLoadedModel: string | null = null;

export async function translateLocal(
  ocrResults: string[],
  targetLang: string,
  sourceLang: string,
  seriesContext?: SeriesContext,
  model = DefaultConfig.llmModels[0].id,
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

  // One correction round-trip on count mismatch (usually dropped empty
  // boxes). The healed validator guarantees the count; the retry gives the
  // model a chance to place real text first.
  if (
    raw &&
    typeof raw === "object" &&
    Array.isArray((raw as Record<string, any>).translations) &&
    (raw as Record<string, any>).translations.length !== ocrResults.length
  ) {
    const received = (raw as Record<string, any>).translations.length;
    console.warn(
      `[webllm] count mismatch (received ${received}, expected ${ocrResults.length}) — requesting correction`,
    );
    const corrected = await runLLMModel(
      systemPrompt,
      `${userPrompt}\n\nCORRECTION: Your previous response contained ${received} items but EXACTLY ${ocrResults.length} are required — one per input box, same order, empty boxes as "". Return the full corrected JSON now.`,
      schema,
      model,
      temperature,
    );
    return validateTranslationResult(corrected, ocrResults.length);
  }

  return validateTranslationResult(raw, ocrResults.length);
}

export async function makeSiteRuleLocal(
  title: string,
  path: string,
  model = DefaultConfig.llmModels[0].id,
  temperature = DefaultConfig.llmTemperature,
): Promise<AIGeneratedRule> {
  const { systemPrompt, userPrompt, schema } = buildSiteRulePrompts(
    title,
    path,
  );

  return await runLLMModel(
    systemPrompt,
    userPrompt,
    schema,
    model,
    temperature,
  );
}

async function runLLMModel(
  systemPrompt: string,
  userPrompt: string,
  schema: string,
  model: string,
  temperature: number,
) {
  if (!globalEngine) {
    globalEngine = new MLCEngine();
  }

  if (currentlyLoadedModel !== model) {
    await globalEngine.reload(model);
    currentlyLoadedModel = model;
  }

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

  const content = reply.choices[0]?.message?.content;
  if (!content) {
    throw new Error("Local LLM returned empty response");
  }

  try {
    return parseLlmJson(content);
  } catch (error) {
    console.error("Failed to parse LLM output:", content);
    throw new Error(`Local LLM generated invalid JSON: ${(error as Error).message}`);
  }
}
