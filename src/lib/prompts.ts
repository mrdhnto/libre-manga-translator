import { DefaultConfig } from "./configs";
import { MAKE_SITE_RULE_PROMPT } from "./adapters";

export function buildTranslationPrompts(
  ocrResults: string[],
  targetLang: string,
  sourceLang: string,
  seriesContext?: SeriesContext,
) {
  const needsContext =
    !seriesContext?.summary ||
    !seriesContext?.dictionary ||
    (seriesContext?.translatedCount ?? 0) % DefaultConfig.minTranslations === 0;

  const count = ocrResults.length;

  // Quote every box so empty OCR ("") stays visible to the model.
  // Raw interpolation renders empties as `Box 5: ` (invisible) and small
  // models silently merge/drop them → count mismatch downstream.
  const boxLines = ocrResults
    .map((rawText, index) => {
      const text = typeof rawText === "string" ? rawText : String(rawText ?? "");
      const quoted = JSON.stringify(text);
      return text.trim().length === 0
        ? `Box ${index + 1}: "" (empty — return "")`
        : `Box ${index + 1}: ${quoted}`;
    })
    .join("\n");

  const emptyRuleNumber = needsContext ? 4 : 3;
  const contextRule = needsContext
    ? `3. The "summary" and "dictionary" fields MUST remain strictly in ENGLISH to act as a system memory pivot.\n`
    : "";

  const systemPrompt = `You are a professional manga translator${seriesContext?.seriesName ? ` working on "${seriesContext.seriesName}"` : ""}.
Your task is to translate extracted manga dialogue${sourceLang !== "Auto-Detect" ? ` FROM ${sourceLang.toUpperCase()}` : ""} INTO ${targetLang.toUpperCase()}.
Maintain the tone, emotion, and context of the scene.
${seriesContext?.summary ? `\nSeries context: ${seriesContext.summary}` : ""}
${seriesContext?.dictionary ? `\nTerm dictionary (always use these): ${seriesContext.dictionary}` : ""}
${seriesContext?.recentHistory?.length ? `\nPrevious pages for continuity:\n${seriesContext.recentHistory.map((h, i) => `Page -${seriesContext.recentHistory.length - i}: ${h.text}`).join("\n")}` : ""}

CRITICAL INSTRUCTIONS:
1. The dialogue inside the "translations" array MUST be strictly in ${targetLang.toUpperCase()}. DO NOT transcribe the original text. You must output the translated meaning.
2. The "translations" array MUST contain EXACTLY ${count} items, in the same order as the input boxes (Box 1 → index 0, Box 2 → index 1, …). NEVER merge, drop, split, or add items — one output string per input box, even if some boxes look alike.
${contextRule}${emptyRuleNumber}. If a box is empty (""), return "" at the same index. Empty input MUST stay empty output — do not delete the entry or borrow a neighbour's text.

Output strictly as valid JSON matching this structure exactly (EXACTLY ${count} items in "translations"):
{
  "translations": ["translation for box 1", "translation for box 2"]${
    needsContext
      ? `,\n  "context": {\n    "summary": "1-2 sentence series summary in English",\n    "dictionary": "Original Term -> English Translation"\n  }`
      : ""
  }
}`;

  const userPrompt = `--- CURRENT PAGE DIALOGUE ---
Please translate the following ${count} extracted text boxes. Return EXACTLY ${count} strings in "translations", preserving order and empties:

${boxLines}

${
  needsContext
    ? `\nAlso infer from this text:
1. A 1-2 sentence summary of the tone/genre IN ENGLISH.
2. Any character names or unique terms, formatted as "Original Term -> English Translation". If none, output "None".`
    : ""
}`;

  const schema = JSON.stringify({
    type: "object",
    properties: {
      translations: {
        type: "array",
        items: { type: "string" },
        minItems: count,
        maxItems: count,
      },
      ...(needsContext
        ? {
            context: {
              type: "object",
              properties: {
                summary: { type: "string" },
                dictionary: { type: "string" },
              },
              required: ["summary", "dictionary"],
            },
          }
        : {}),
    },
    required: ["translations", ...(needsContext ? ["context"] : [])],
  });

  return { systemPrompt, userPrompt, schema, needsContext };
}

export function buildSiteRulePrompts(title: string, path: string) {
  const prompt = MAKE_SITE_RULE_PROMPT(title, path);
  const schema = JSON.stringify({
    type: "object",
    properties: {
      seriesName: {
        type: "object",
        properties: {
          regex: { type: "string" },
          source: { type: "string" },
        },
        required: ["regex", "source"],
      },
      chapterId: {
        type: "object",
        properties: {
          regex: { type: "string" },
          source: { type: "string" },
        },
        required: ["regex", "source"],
      },
      pageIndex: {
        type: "object",
        properties: {
          regex: { type: "string" },
          source: { type: "string" },
        },
        required: ["regex", "source"],
      },
    },
    required: ["seriesName", "chapterId", "pageIndex"],
  });

  return { systemPrompt: prompt.system, userPrompt: prompt.user, schema };
}
