import {
  baseLabel,
  cjkShare,
  classShare,
  expectedClassesForSource,
  isCjkLabel,
  isCjkSource,
  isAbstentionLabel,
  isTrustedLabel,
  japaneseCharCount,
  LANGGROUP_BY_LABEL,
  type ScriptClass,
} from "./charset";

/**
 * The script gate decision logic (session code lives in `osd.ts`), doctrine:
 *
 * > Low confidence → drop the box and flag it, because leaving [the selected
 * > language] is recoverable and painting over something else is not.
 *
 * The rescue reading is LMT's own rec output: `cjkShare ≥ 0.6` over ≥2
 * Japanese characters overturns a verdict the identifier was not entitled to
 * reach alone (the TRUSTED doctrine - measured: a tall kana column reads
 * `Tibetan`, confidently). No OSD model? The text checks still run.
 */

export type GateMode = "off" | "cjk" | "other" | "auto";
export type GateReason = "not-japanese" | "low-confidence";
export type Decision = "clean" | "wrong-script" | "uncertain";

/** One collapsed timestep is one glyph's
 * worth of opinion; the measured misreads were all at that level. */
export const MIN_LINE_STRENGTH = 2;
/** A floor, not a tuned number: a reader that
 * invents nothing outside its vocabulary lands near 1.0 on real text. */
export const MIN_CJK_SHARE = 0.6;
/** One character is guessing at the paper. */
export const MIN_RESCUE_CHARS = 2;
/** Post-OCR confirmation for an explicitly-selected non-CJK source. */
export const MIN_EXPECTED_SHARE = 0.4;

export interface LineScript {
  label: string;
  strength: number;
  total: number;
}

export interface RegionVerdict {
  decision: Decision;
  /** winning label, "" when nothing voted */
  script: string;
  /** summed strength behind the winning side - the majority weight */
  weight: number;
}

export interface GateSummary {
  mode: GateMode;
  checked: number;
  skipped: number;
  /** language group the gate resolved (auto) or the explicit source used */
  group?: string;
  /** the OSD model could not load; text-only verification still ran */
  unavailable?: boolean;
}

export function gateModeFor(
  sourceLang: string,
  enabled: boolean,
  force: boolean,
): GateMode {
  if (force) return "off";
  if (sourceLang === "Auto-Detect") return "auto";
  if (!enabled) return "off";
  return isCjkSource(sourceLang) ? "cjk" : "other";
}

/** Pure vote aggregation: CJK strength vs the rest. */
export function judgeVotes(votes: LineScript[]): RegionVerdict {
  let cjk = 0;
  let bestCjk = "";
  const other: Map<string, number> = new Map();
  for (const v of votes) {
    if (v.strength < MIN_LINE_STRENGTH || isAbstentionLabel(v.label)) continue;
    if (isCjkLabel(v.label)) {
      cjk += v.strength;
      if (!bestCjk) bestCjk = v.label;
    } else {
      other.set(v.label, (other.get(v.label) ?? 0) + v.strength);
    }
  }
  const nonCjk = [...other.values()].reduce((a, b) => a + b, 0);
  if (cjk === 0 && nonCjk === 0)
    return { decision: "uncertain", script: "", weight: 0 };
  if (cjk > nonCjk)
    return { decision: "clean", script: bestCjk, weight: cjk };
  if (nonCjk > cjk) {
    // ties break on the lower label so two runs agree
    const top = [...other.entries()].sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
    )[0];
    return { decision: "wrong-script", script: top[0], weight: top[1] };
  }
  return { decision: "uncertain", script: "", weight: cjk };
}

/** Page majority label for Auto-Detect: strongest weighted non-uncertain
 * verdict group, and it must OUTVOTE the rest (a bare plurality is not a
 * page script); null when the page said nothing. */
export function majorityLabel(verdicts: RegionVerdict[]): string | null {
  const byLabel = new Map<string, number>();
  for (const v of verdicts) {
    if (v.decision === "uncertain" || !v.script) continue;
    const base = baseLabel(v.script);
    byLabel.set(base, (byLabel.get(base) ?? 0) + v.weight);
  }
  if (byLabel.size === 0) return null;
  const top = [...byLabel.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  )[0];
  const rest = [...byLabel.entries()]
    .filter(([label]) => label !== top[0])
    .reduce((a, b) => a + b[1], 0);
  return top[1] > rest ? top[0] : null;
}

const rescueHolds = (text: string): boolean =>
  cjkShare(text) >= MIN_CJK_SHARE && japaneseCharCount(text) >= MIN_RESCUE_CHARS;

/**
 * Shared rescue check: the rec text itself overturns a verdict the OSD model
 * was not entitled to reach alone (tall kana columns misread as Tibetan, …).
 * `clean` verdicts never need rescuing — callers check that first.
 */
function shouldRescue(text: string, verdict: RegionVerdict | null): boolean {
  return rescueHolds(text) && (!verdict || verdict.decision !== "clean");
}

/** Does an OSD label name the script the user explicitly selected? */
function verdictMatchesExpected(
  verdictScript: string,
  expected: ScriptClass[] | null,
): boolean {
  if (!expected) return false;
  if (expected.some((cls) => cls === "hangul"))
    return verdictScript.startsWith("Hangul");
  if (expected.some((cls) => cls === "latin"))
    return verdictScript === "Latin" || verdictScript === "Fraktur";
  if (expected.some((cls) => cls === "cyrillic"))
    return verdictScript === "Cyrillic";
  if (expected.some((cls) => cls === "arabic"))
    return verdictScript === "Arabic";
  if (expected.some((cls) => cls === "greek"))
    return verdictScript === "Greek";
  if (expected.some((cls) => cls === "thai"))
    return verdictScript === "Thai";
  if (expected.some((cls) => cls === "hebrew"))
    return verdictScript === "Hebrew";
  return false;
}

function decideSkipCjk(
  verdict: RegionVerdict | null,
  text: string,
): GateReason | null {
  if (!verdict || verdict.decision === "uncertain") {
    // No OSD opinion (or none that counted): text-only verification.
    if (!verdict)
      return cjkShare(text) >= MIN_CJK_SHARE ? null : "low-confidence";
    return shouldRescue(text, verdict) ? null : "low-confidence";
  }
  if (verdict.decision === "clean") return null;
  // wrong-script: trusted stands alone; untrusted needs the text rescue.
  if (shouldRescue(text, verdict)) return null;
  return isTrustedLabel(verdict.script) ? "not-japanese" : "low-confidence";
}

function decideSkipOther(
  verdict: RegionVerdict | null,
  text: string,
  expected: ScriptClass[] | null,
): GateReason | null {
  if (expected && classShare(text, expected) >= MIN_EXPECTED_SHARE)
    return null;
  if (verdict?.decision === "wrong-script" && isTrustedLabel(verdict.script)) {
    // A verdict naming the selected script is not a contradiction.
    return verdictMatchesExpected(verdict.script, expected)
      ? null
      : "not-japanese";
  }
  return "low-confidence";
}

function decideSkipAuto(
  verdict: RegionVerdict | null,
  pageLabel: string | null,
): GateReason | null {
  if (!pageLabel || !verdict || verdict.decision === "uncertain") return null;
  const sameSide =
    isCjkLabel(pageLabel) === isCjkLabel(verdict.script) ||
    baseLabel(pageLabel) === baseLabel(verdict.script);
  if (sameSide) return null;
  // A verdict the model is not entitled to reach alone never contradicts
  // the page majority. No text rescue here: the rescue exists for
  // untrusted pixel misreads, not for disagreeing with the page majority.
  if (!isTrustedLabel(verdict.script) && !isCjkLabel(verdict.script))
    return null;
  return "not-japanese";
}

/**
 * Final per-region skip decision, run AFTER recognition (the rescue reads the
 * rec text; pre-OCR only the trusted wrong-script refusal can pre-filter, in
 * `textRecognise`). `null` = translate.
 */
export function decideSkip(
  mode: GateMode,
  verdict: RegionVerdict | null,
  text: string,
  sourceLang: string,
  pageLabel: string | null,
): GateReason | null {
  if (mode === "off" || !text) return null;

  if (mode === "cjk") return decideSkipCjk(verdict, text);

  if (mode === "other")
    return decideSkipOther(verdict, text, expectedClassesForSource(sourceLang));

  // auto: additive — only a confident contradiction of the page majority skips.
  if (mode === "auto") return decideSkipAuto(verdict, pageLabel);
  return null;
}

/** Language group for OCR model selection under Auto-Detect. */
export const groupForLabel = (label: string | null): string | null =>
  label ? LANGGROUP_BY_LABEL[label] ?? null : null;

export type { ScriptClass };
