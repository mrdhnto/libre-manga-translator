export interface ServerConfig {
  serverHost: string;
  serverSchema: "openai" | "lmstudio";
  serverModel: string;
  useServerApiKey: boolean;
  serverApiKey: string;
  temperature: number;
}

export function buildOpenAITextRequest(
  model: string,
  systemPrompt: string,
  userPrompt: string,
  temperature: number,
) {
  return {
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature,
    max_tokens: 4096,
    response_format: { type: "json_object" },
    stream: false,
  };
}

export function buildLmStudioTextRequest(
  model: string,
  systemPrompt: string,
  userPrompt: string,
  temperature: number,
) {
  return {
    model,
    input: [{ type: "text", content: userPrompt }],
    system_prompt: systemPrompt,
    temperature,
    max_output_tokens: 4096,
    stream: false,
  };
}
