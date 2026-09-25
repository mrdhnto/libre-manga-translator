import { parseLlmJson, validateTranslationResult } from "../src/lib/server/validator";

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
}

// Valid response
const valid = validateTranslationResult(
  {
    translations: ["Hello", "World"],
    sourceTexts: ["こんにちは", "世界"],
    context: { summary: "Manga chapter 1", dictionary: "term=def" },
  },
  2,
);
assert(valid.translations.length === 2, "translations length should be 2");
assert(valid.translations[0] === "Hello", "translation[0] should be Hello");
assert(valid.context?.summary === "Manga chapter 1", "summary should match");

// Count mismatch should throw
let countMismatchThrown = false;
try {
  validateTranslationResult({ translations: ["One"] }, 2);
} catch {
  countMismatchThrown = true;
}
assert(countMismatchThrown, "Count mismatch must throw error");

// Non-string in translations should throw
let typeMismatchThrown = false;
try {
  validateTranslationResult({ translations: [123, "Two"] }, 2);
} catch {
  typeMismatchThrown = true;
}
assert(typeMismatchThrown, "Non-string translation must throw error");

// Non-object should throw
let nonObjectThrown = false;
try {
  validateTranslationResult("not an object", 0);
} catch {
  nonObjectThrown = true;
}
assert(nonObjectThrown, "Non-object must throw error");

// parseLlmJson: chatty LLM preamble + code fence + trailing explanation
const chatty = parseLlmJson(
  "Here’s the translation and analysis based on the provided dialogue:\n\n```json\n" +
    '{"translations": ["One", "None", "None"], "context": {"summary": "s", "dictionary": "None"}}\n' +
    "```\n\n### Explanation:\n1. **Summary**: polite request.",
);
assert(
  Array.isArray(chatty.translations) && chatty.translations.length === 3,
  "parseLlmJson must extract 3 translations from chatty markdown",
);

// parseLlmJson: raw object without fences
const raw = parseLlmJson('{"translations": ["A", "B"]}');
assert(raw.translations[0] === "A", "parseLlmJson must parse raw JSON");

// parseLlmJson: bare JSON array
const arr = parseLlmJson('["X", "Y"]');
assert(Array.isArray(arr) && arr[1] === "Y", "parseLlmJson must parse bare array");

// parseLlmJson: garbage must throw
let garbageThrown = false;
try {
  parseLlmJson("no json here at all");
} catch {
  garbageThrown = true;
}
assert(garbageThrown, "parseLlmJson must throw on unparseable content");

console.log("PASS: validateTranslationResult self-check passed.");
