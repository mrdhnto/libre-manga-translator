import { DefaultConfig } from "../configs";
import { buildSiteRulePrompts, buildTranslationPrompts } from "../prompts";
import {
  buildLmStudioTextRequest,
  buildOpenAITextRequest,
  ServerConfig,
} from "./schemas";
import { parseLlmJson, validateTranslationResult } from "./validator";

export type { ServerConfig } from "./schemas";
export { parseLlmJson };

async function callServer(
  systemPrompt: string,
  userPrompt: string,
  config: ServerConfig,
  retryCount = 0,
): Promise<any> {
  const endpoint =
    config.serverSchema === "lmstudio"
      ? DefaultConfig.serverEndpoints.lmstudio
      : DefaultConfig.serverEndpoints.openai;

  const baseUrl = config.serverHost.endsWith("/")
    ? config.serverHost
    : config.serverHost + "/";
  const url = `${baseUrl}${endpoint}`;

  const body =
    config.serverSchema === "lmstudio"
      ? buildLmStudioTextRequest(
          config.serverModel,
          systemPrompt,
          userPrompt,
          config.temperature,
        )
      : buildOpenAITextRequest(
          config.serverModel,
          systemPrompt,
          userPrompt,
          config.temperature,
        );

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (config.useServerApiKey && config.serverApiKey) {
    headers["Authorization"] = `Bearer ${config.serverApiKey}`;
  }

  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const err = new Error(
        `API ${response.status}: ${(await response.text()).substring(0, 500)}`,
      ) as Error & { status?: number };
      err.status = response.status;
      throw err;
    }

    const data = await response.json();
    const content =
      config.serverSchema === "lmstudio"
        ? data?.output?.[0]?.content
        : data?.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error("Empty response from server");
    }

    return parseLlmJson(content);
  } catch (err) {
    const status = (err as Error & { status?: number }).status;
    const isClientError = status !== undefined && status >= 400 && status < 500;

    if (!isClientError && retryCount < DefaultConfig.serverMaxRetries) {
      await new Promise((r) =>
        setTimeout(r, DefaultConfig.serverRetryDelayMs * (retryCount + 1)),
      );
      return callServer(systemPrompt, userPrompt, config, retryCount + 1);
    }

    throw new Error(typeof err === "string" ? err : (err as Error).message);
  }
}

export async function translateWithServer(
  ocrResults: string[],
  targetLang: string,
  sourceLang: string,
  seriesContext: SeriesContext | undefined,
  config: ServerConfig,
): Promise<TranslateResult> {
  if (!ocrResults || ocrResults.length === 0) {
    return { translations: [] };
  }

  const { systemPrompt, userPrompt } = buildTranslationPrompts(
    ocrResults,
    targetLang,
    sourceLang,
    seriesContext,
  );

  const raw = await callServer(systemPrompt, userPrompt, config);
  return validateTranslationResult(raw, ocrResults.length);
}

export async function makeSiteRuleWithServer(
  title: string,
  path: string,
  config: ServerConfig,
): Promise<AIGeneratedRule> {
  const { systemPrompt, userPrompt } = buildSiteRulePrompts(title, path);
  return callServer(systemPrompt, userPrompt, config);
}

export async function testServerConnection(config: ServerConfig) {
  const baseUrl = config.serverHost.endsWith("/")
    ? config.serverHost
    : config.serverHost + "/";
  const url = `${baseUrl}models`;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (config.useServerApiKey && config.serverApiKey) {
    headers["Authorization"] = `Bearer ${config.serverApiKey}`;
  }

  try {
    const response = await fetch(url, { method: "GET", headers });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const data = await response.json();
    const models: string[] =
      data?.data?.map((m: { id?: string }) => m?.id).filter(Boolean) ??
      (Array.isArray(data?.models) ? data.models : []);
    return { success: true, models };
  } catch (error) {
    return {
      success: false,
      error: (error as Error).message,
    };
  }
}
