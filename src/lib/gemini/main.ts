import { MAKE_SITE_RULE_PROMPT } from "../adapters";
import { DefaultConfig } from "../configs";
import { drawNumberedBboxes } from "./utils";
import { validateTranslationResult } from "../server/validator";

export async function translateWithGemini(
  imageSrc: string,
  bboxes: Bbox[],
  apiKey: string,
  targetLang: string,
  sourceLang: string,
  seriesContext?: SeriesContext,
  model = DefaultConfig.geminiModels[0].id,
  temperature = DefaultConfig.llmTemperature,
): Promise<TranslateResult> {
  const cleanBase64 = (await drawNumberedBboxes(imageSrc, bboxes)).replace(
    /^data:image\/(png|jpeg|webp);base64,/,
    "",
  );
  const needsContext =
    !seriesContext?.summary ||
    !seriesContext?.dictionary ||
    (seriesContext?.translatedCount ?? 0) % DefaultConfig.minTranslations === 0;

  const systemPrompt = `You are a professional manga translator${seriesContext?.seriesName ? ` working on "${seriesContext.seriesName}"` : ""}.
Translate the text in the numbered bounding boxes in the provided image${sourceLang !== "Auto-Detect" ? ` FROM ${sourceLang.toUpperCase()}` : ""} INTO ${targetLang.toUpperCase()}.
Maintain the tone and context of the scene.
${seriesContext?.summary ? `\nSeries context: ${seriesContext.summary}` : ""}
${seriesContext?.dictionary ? `\nTerm dictionary (always use these): ${seriesContext.dictionary}` : ""}
${seriesContext?.recentHistory?.length ? `\nPrevious pages for continuity:\n${seriesContext.recentHistory.map((h, i) => `Page -${seriesContext.recentHistory.length - i}: ${h.text}`).join("\n")}` : ""}

CRITICAL LANGUAGE INSTRUCTIONS:
1. The dialogue inside the "translations" array MUST be strictly in ${targetLang.toUpperCase()}. DO NOT transcribe or copy the original text from the image. You must output the translated meaning.
2. The "sourceTexts" array MUST contain the ORIGINAL text exactly as it appears in each numbered box, transcribed verbatim (not translated). If a box's text is illegible or empty, use an empty string.
${needsContext ? `3. The "summary" and "dictionary" fields MUST remain strictly in ENGLISH to act as a system memory pivot.` : ""}

Output strictly as valid JSON matching this structure without markdown formatting:
{
  "translations": ["translation for box 1", "translation for box 2"],
  "sourceTexts": ["original text in box 1", "original text in box 2"]${
    needsContext
      ? `,\n  "context": {\n    "summary": "...",\n    "dictionary": "..."\n  }`
      : ""
  }
}`;

  const userPrompt = `Please process the dialogue boxes found in the provided image.
${
  needsContext
    ? `\nAlso infer from this page:
1. A 1-2 sentence summary of the series tone, setting, and genre IN ENGLISH.
2. Any character names, places, or unique terms visible, formatted as "Original Term -> English Translation". If no specific terms are visible, output strictly "None". Do not explain or write sentences.`
    : ""
}`;

  const raw = await sendRequestToGemini(
    systemPrompt,
    userPrompt,
    apiKey,
    model,
    temperature,
    {
      mimeType: "image/jpeg",
      data: cleanBase64,
    },
  );

  return validateTranslationResult(raw, bboxes.length);
}

export async function makeSiteRuleWithGemini(
  title: string,
  path: string,
  apiKey: string,
  model = DefaultConfig.geminiModels[0].id,
  temperature = DefaultConfig.llmTemperature,
) {
  const prompt = MAKE_SITE_RULE_PROMPT(title, path);

  return sendRequestToGemini(
    prompt.system,
    prompt.user,
    apiKey,
    model,
    temperature,
  );
}

export async function sendRequestToGemini(
  systemPrompt: string,
  userPrompt: string,
  apiKey: string,
  model: string,
  temperature: number,
  data?: {
    mimeType: string;
    data: string;
  },
): Promise<any> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: systemPrompt }],
      },
      contents: [
        {
          role: "user",
          parts: [
            { text: userPrompt },
            ...(data ? [{ inlineData: data }] : []),
          ],
        },
      ],
      generationConfig: {
        temperature,
        responseMimeType: "application/json",
      },
    }),
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(
      `Gemini API Error: ${errorData.error?.message || response.statusText}`,
    );
  }

  const result = await response.json();
  const resultText = result.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!resultText) {
    throw new Error("Gemini API returned empty response parts");
  }

  return JSON.parse(resultText);
}
