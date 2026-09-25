/**
 * Strict schema validator for LLM translation responses.
 * Validates translations array, types, count matching bboxes, and optional context.
 */

export interface ValidatedTranslation {
  translations: Translations;
  sourceTexts?: string[];
  context?: {
    summary: string;
    dictionary: string;
  };
}

/**
 * Robust JSON extractor and parser for LLM outputs.
 * Handles markdown codeblocks, preamble conversational text, and raw JSON.
 */
export function parseLlmJson(content: string): any {
  const trimmed = content.trim();

  // 1. Direct JSON parse
  try {
    return JSON.parse(trimmed);
  } catch {}

  // 2. Extract markdown code block ```json ... ``` or ``` ... ``` anywhere in content
  const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (codeBlockMatch?.[1]) {
    try {
      return JSON.parse(codeBlockMatch[1].trim());
    } catch {}
  }

  // 3. Extract outermost JSON object { ... }
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    try {
      return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
    } catch {}
  }

  // 4. Extract outermost JSON array [ ... ]
  const firstBracket = trimmed.indexOf("[");
  const lastBracket = trimmed.lastIndexOf("]");
  if (firstBracket !== -1 && lastBracket > firstBracket) {
    try {
      return JSON.parse(trimmed.slice(firstBracket, lastBracket + 1));
    } catch {}
  }

  throw new Error(
    `Failed to parse server JSON: Unexpected format\nRaw: ${content.substring(0, 500)}`,
  );
}

export function validateTranslationResult(
  raw: unknown,
  expectedCount: number,
): ValidatedTranslation {
  if (!raw || typeof raw !== "object") {
    throw new Error("API Schema Error: Response is not an object.");
  }

  const obj = raw as Record<string, any>;

  if (!Array.isArray(obj.translations)) {
    throw new Error("API Schema Error: 'translations' must be an array.");
  }

  const translations: string[] = obj.translations.map((item, idx) => {
    if (typeof item !== "string") {
      throw new Error(
        `API Schema Error: Translation at index ${idx} is not a string (${typeof item}).`,
      );
    }
    return item;
  });

  if (translations.length !== expectedCount) {
    throw new Error(
      `API Schema Error: Translation count mismatch. Expected ${expectedCount} items to match bubbles, received ${translations.length}.`,
    );
  }

  let sourceTexts: string[] | undefined = undefined;
  if (obj.sourceTexts !== undefined) {
    if (!Array.isArray(obj.sourceTexts)) {
      throw new Error("API Schema Error: 'sourceTexts' must be an array.");
    }
    sourceTexts = obj.sourceTexts.map((s) => (typeof s === "string" ? s : String(s)));
  }

  let context: { summary: string; dictionary: string } | undefined = undefined;
  if (obj.context && typeof obj.context === "object") {
    context = {
      summary: typeof obj.context.summary === "string" ? obj.context.summary : "",
      dictionary: typeof obj.context.dictionary === "string" ? obj.context.dictionary : "",
    };
  }

  return { translations, sourceTexts, context };
}
