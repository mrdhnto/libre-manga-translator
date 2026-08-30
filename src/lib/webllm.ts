import { MLCEngine } from "@mlc-ai/web-llm";
import { DefaultConfig } from "./configs";
import { buildSiteRulePrompts, buildTranslationPrompts } from "./prompts";

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

  return await runLLMModel(
    systemPrompt,
    userPrompt,
    schema,
    model,
    temperature,
  );
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

  const resultText = reply.choices[0].message.content as string;

  try {
    const cleanJsonString = resultText
      .replace(/^```(?:json)?/im, "")
      .replace(/```$/im, "")
      .trim();

    return JSON.parse(cleanJsonString);
  } catch (error) {
    console.error("Failed to parse LLM output:", resultText);
    throw new Error("Local LLM generated invalid JSON");
  }
}
