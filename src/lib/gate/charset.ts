/**
 * Script classes and the `cjk_share` metric for the script gate, plus the
 * OSD label lists (CJK / abstention / trusted).
 *
 * LMT uses two of the gate's instruments: this file (pure char math, no model)
 * verifies recognized text, and `osd.ts` identifies the script of the pixels.
 * The rescue reading is LMT's own PaddleOCR rec output - a reader whose
 * vocabulary is the selected language is exactly as good an answer to "is
 * this the text we think it is" as a second model would be.
 */

export type ScriptClass =
  | "han"
  | "kana"
  | "hangul"
  | "latin"
  | "cyrillic"
  | "greek"
  | "arabic"
  | "hebrew"
  | "thai"
  | "devanagari"
  | "tamil"
  | "telugu"
  | "other";

/**
 * A character that belongs to no script: whitespace, and the ASCII digits and
 * punctuation any language sets in the same glyphs.
 * Counting them against a reading is what made `はぁぁぁ...` score 0.57 and
 * refuse an obvious balloon; it is 1.0 without them.
 */
function isNeutral(cp: number): boolean {
  // whitespace
  if (cp === 0x20 || (cp >= 0x09 && cp <= 0x0d) || cp === 0x85 || cp === 0xa0)
    return true;
  // ASCII digits
  if (cp >= 0x30 && cp <= 0x39) return true;
  // ASCII punctuation
  if (
    (cp >= 0x21 && cp <= 0x2f) ||
    (cp >= 0x3a && cp <= 0x40) ||
    (cp >= 0x5b && cp <= 0x60) ||
    (cp >= 0x7b && cp <= 0x7e)
  )
    return true;
  // Fullwidth digits, which Japanese typesetting uses in vertical text.
  if (cp >= 0xff10 && cp <= 0xff19) return true;
  return false;
}

/**
 * Written in a block Japanese is written in: kana carry the language on their
 * own; Han is included for
 * the same reason CJK_LABELS is wider than "Japanese" - the question is
 * *"is this the Latin typesetting a localiser added?"* and against that every
 * CJK block is the same answer.
 */
export function isJapaneseBlock(cp: number): boolean {
  return (
    // CJK symbols and punctuation: 、。「」〜…
    (cp >= 0x3000 && cp <= 0x303f) ||
    // Hiragana, Katakana, and the phonetic extensions after them.
    (cp >= 0x3040 && cp <= 0x309f) ||
    (cp >= 0x30a0 && cp <= 0x30ff) ||
    (cp >= 0x31f0 && cp <= 0x31ff) ||
    // CJK Unified Ideographs, and Extension A, which manga does reach.
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0x4e00 && cp <= 0x9fff) ||
    // Compatibility ideographs.
    (cp >= 0xf900 && cp <= 0xfaff) ||
    // Of the fullwidth forms only the punctuation a balloon ends on and
    // halfwidth katakana. ＡＢＣ and halfwidth Hangul live in the same block
    // and are NOT Japanese.
    (cp >= 0xff01 && cp <= 0xff0f) ||
    (cp >= 0xff1a && cp <= 0xff20) ||
    (cp >= 0xff3b && cp <= 0xff40) ||
    (cp >= 0xff5b && cp <= 0xff65) ||
    (cp >= 0xff66 && cp <= 0xff9f)
  );
}

const CLASS_RANGES: Record<Exclude<ScriptClass, "other">, [number, number][]> = {
  han: [
    [0x3400, 0x4dbf],
    [0x4e00, 0x9fff],
    [0xf900, 0xfaff],
  ],
  kana: [
    [0x3040, 0x309f],
    [0x30a0, 0x30ff],
    [0x31f0, 0x31ff],
    [0xff66, 0xff9f],
  ],
  hangul: [
    [0x1100, 0x11ff],
    [0x3130, 0x318f],
    [0xac00, 0xd7af],
  ],
  latin: [
    [0x41, 0x5a],
    [0x61, 0x7a],
    [0xc0, 0x24f],
    [0x250, 0x2af],
  ],
  cyrillic: [
    [0x400, 0x4ff],
    [0x500, 0x52f],
  ],
  greek: [
    [0x370, 0x3ff],
    [0x1f00, 0x1fff],
  ],
  arabic: [
    [0x600, 0x6ff],
    [0x750, 0x77f],
    [0xfb50, 0xfdff],
    [0xfe70, 0xfeff],
  ],
  hebrew: [[0x590, 0x5ff]],
  thai: [[0xe00, 0xe7f]],
  devanagari: [[0x900, 0x97f]],
  tamil: [[0xb80, 0xbff]],
  telugu: [[0xc00, 0xc7f]],
};

export function classOf(cp: number): ScriptClass {
  for (const [name, ranges] of Object.entries(CLASS_RANGES) as [
    Exclude<ScriptClass, "other">,
    [number, number][],
  ][]) {
    for (const [lo, hi] of ranges) if (cp >= lo && cp <= hi) return name;
  }
  return "other";
}

/**
 * The share of a reading's non-whitespace, non-neutral characters that are
 * Japanese-block. 0 when nothing was countable: "" ,
 * "   ", "..." and "12345" are not evidence of anything.
 */
export function cjkShare(text: string): number {
  let counted = 0;
  let cjk = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (isNeutral(cp)) continue;
    counted++;
    if (isJapaneseBlock(cp)) cjk++;
  }
  return counted === 0 ? 0 : cjk / counted;
}

/** Count of Japanese-block characters (the rescue's evidence floor). */
export function japaneseCharCount(text: string): number {
  let n = 0;
  for (const ch of text) if (isJapaneseBlock(ch.codePointAt(0)!)) n++;
  return n;
}

/** Share of a reading's countable characters in the given classes. */
export function classShare(text: string, classes: ScriptClass[]): number {
  const wanted = new Set(classes);
  let counted = 0;
  let hit = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (isNeutral(cp)) continue;
    // CJK punctuation belongs to the CJK classes' evidence, like cjk_share.
    if (cp >= 0x3000 && cp <= 0x303f && (wanted.has("han") || wanted.has("kana"))) {
      counted++;
      hit++;
      continue;
    }
    counted++;
    if (wanted.has(classOf(cp))) hit++;
  }
  return counted === 0 ? 0 : hit / counted;
}

// --- OSD label lists --------------------------------------------------------

/** Labels treated as "this is the language we are looking for" - wider than
 * "Japanese" deliberately; the model's
 * confusion mass is Chinese<->Japanese and every CJK label is the same answer
 * to the question the gate is actually asked. Hangul is NOT here. */
const CJK_LABELS = new Set([
  "Japanese",
  "Japanese_vert",
  "HanS",
  "HanS_vert",
  "HanT",
  "HanT_vert",
]);

/** The scripts a NotJapanese may name and be BELIEVED without a second
 * opinion (TRUSTED_SCRIPTS). Anything else - Tibetan and Syriac were the
 * measured ones on tall kana columns - is a verdict this model is not
 * entitled to reach alone. The -dn suffix is its "dotted normalised" variant. */
const TRUSTED = new Set([
  "Latin",
  "Cyrillic",
  "Greek",
  "Hangul",
  "Hangul_vert",
  "Fraktur",
  "Arabic",
  "Hebrew",
  "Thai",
]);

/** Labels that mean "I read something, but not a script": they must not be
 * counted as a vote against one (is_abstention). */
const ABSTENTION = new Set(["Common", "Joined", "NULL", "Broken"]);

export const baseLabel = (label: string): string =>
  label.endsWith("-dn") ? label.slice(0, -3) : label;

export const isCjkLabel = (label: string): boolean =>
  CJK_LABELS.has(baseLabel(label));
export const isTrustedLabel = (label: string): boolean =>
  TRUSTED.has(baseLabel(label));
export const isAbstentionLabel = (label: string): boolean =>
  ABSTENTION.has(baseLabel(label));

/** OSD label -> LMT rec language group (keys of `ocrLangGroupMap`; Japanese
 * and Han groups both use "chinese", the existing precedent in configs.ts). */
export const LANGGROUP_BY_LABEL: Record<string, string> = {
  Japanese: "chinese",
  Japanese_vert: "chinese",
  HanS: "chinese",
  HanS_vert: "chinese",
  HanT: "chinese",
  HanT_vert: "chinese",
  Latin: "latin",
  Fraktur: "latin",
  Cyrillic: "eslav",
  Greek: "greek",
  Hangul: "korean",
  Hangul_vert: "korean",
  Arabic: "arabic",
  Thai: "thai",
  Devanagari: "hindi",
};

/** Expected script classes for an explicit source language (null = no
 * meaningful verification: Auto-Detect or unmapped). */
export function expectedClassesForSource(sourceLang: string): ScriptClass[] | null {
  switch (sourceLang) {
    case "Japanese":
      return ["kana", "han"];
    case "Chinese (Simplified)":
    case "Chinese (Traditional)":
      return ["han"];
    case "Korean":
      return ["hangul"];
    case "Russian":
    case "Bulgarian":
    case "Ukrainian":
    case "Belarusian":
      return ["cyrillic"];
    case "Greek":
      return ["greek"];
    case "Arabic":
    case "Urdu":
    case "Persian/Farsi":
      return ["arabic"];
    case "Hindi":
    case "Marathi":
    case "Nepali":
    case "Sanskrit":
      return ["devanagari"];
    case "Tamil":
      return ["tamil"];
    case "Telugu":
      return ["telugu"];
    case "Thai":
      return ["thai"];
    default: {
      // The long tail of Latin-based languages in configs.availableLanguages.
      const latinSet = new Set([
        "English",
        "Indonesian",
        "Spanish",
        "Portuguese",
        "French",
        "Vietnamese",
        "Tagalog",
        "Malay",
        "German",
        "Italian",
        "Dutch",
        "Polish",
        "Czech",
        "Slovak",
        "Croatian",
        "Bosnian",
        "Serbian",
        "Slovenian",
        "Danish",
        "Norwegian",
        "Swedish",
        "Icelandic",
        "Estonian",
        "Lithuanian",
        "Hungarian",
        "Albanian",
        "Welsh",
        "Irish",
        "Turkish",
        "Afrikaans",
        "Swahili",
        "Uzbek",
        "Latin",
      ]);
      return latinSet.has(sourceLang) ? ["latin"] : null;
    }
  }
}

export const isCjkSource = (sourceLang: string): boolean =>
  ["Japanese", "Chinese (Simplified)", "Chinese (Traditional)", "Korean"].includes(
    sourceLang,
  );
