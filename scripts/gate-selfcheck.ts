/**
 * Assert-based self-check for the Beta4 script gate + region build (pure TS
 * only - never imports `osd.ts`, so onnxruntime is never loaded). Run with:
 *
 *   bun scripts/gate-selfcheck.ts
 *
 * Test vectors cover the metric tables the gate depends on: the cjk_share
 * case table, the CTC best-path behavior, label doctrine,
 * vote aggregation, and the box-merge math.
 */
import {
  cjkShare,
  classShare,
  isCjkLabel,
  isTrustedLabel,
  isAbstentionLabel,
  japaneseCharCount,
  expectedClassesForSource,
} from "../src/lib/gate/charset";
import {
  ctcBestPath,
} from "../src/lib/gate/ctc";
import {
  judgeVotes,
  majorityLabel,
  decideSkip,
  gateModeFor,
  groupForLabel,
  type LineScript,
  type RegionVerdict,
} from "../src/lib/gate";
import {
  refineDetections,
  mergeCentreInBox,
  sizeVerdict,
  overlapsEnough,
} from "../src/lib/detections/boxes";

let failures = 0;
const check = (name: string, cond: boolean) => {
  if (!cond) {
    failures++;
    console.error(`FAIL ${name}`);
  } else {
    console.log(`ok   ${name}`);
  }
};
const approx = (a: number, b: number) => Math.abs(a - b) < 1e-6;

// --- cjk_share: the case table ------------------------------------------
check("share: ＡＢＣ is Latin in a wide hat", cjkShare("ＡＢＣ") === 0.0);
check("share: １２あ is 1.0 (digits neutral)", cjkShare("１２あ") === 1.0);
check("share: hiragana", cjkShare("こんにちは") === 1.0);
check("share: katakana", cjkShare("カタカナ") === 1.0);
check("share: han counts (wider than Japanese)", cjkShare("漢字") === 1.0);
check("share: brackets are a balloon too", cjkShare("「あ」！") === 1.0);
check("share: halfwidth katakana", cjkShare("ｱｲｳ") === 1.0);
check("share: HELLO", cjkShare("HELLO") === 0.0);
check("share: Hello, world!", cjkShare("Hello, world!") === 0.0);
check("share: あA = 0.5", approx(cjkShare("あA"), 0.5));
check("share: ああAB = 0.5", approx(cjkShare("ああAB"), 0.5));
check("share: はぁぁぁ... trails uncounted", cjkShare("はぁぁぁ...") === 1.0);
check("share: あ!?", cjkShare("あ!?") === 1.0);
check("share: 第3話", cjkShare("第3話") === 1.0);
check("share: ... alone is nothing", cjkShare("...") === 0.0);
check("share: 12345 alone is nothing", cjkShare("12345") === 0.0);
check("share: empty is nothing", cjkShare("") === 0.0);
check("share: spaces is nothing", cjkShare("   ") === 0.0);
check("share: あ い space is part of the text", cjkShare("あ い") === 1.0);

check("classes: cyrillic vs latin", classShare("Привет", ["cyrillic"]) === 1.0);
check("classes: latin vs cyrillic expected", classShare("Hello", ["cyrillic"]) === 0.0);
check("expected: Japanese maps to kana+han", (expectedClassesForSource("Japanese") ?? []).length === 2);
check("expected: Auto-Detect is null", expectedClassesForSource("Auto-Detect") === null);
check("japaneseCharCount counts blocks", japaneseCharCount("あAあ！") === 3); // あ,あ,！(CJK punct block FF01.. is counted by isJapaneseBlock)

// --- label doctrine ---------------------------------------------------------
check("labels: CJK set", ["Japanese", "Japanese_vert", "HanS_vert", "HanT", "Japanese-dn"].every(isCjkLabel));
check("labels: non-CJK", ["Latin", "Cyrillic", "Hangul", "Hangul_vert", "Fraktur"].every((l) => !isCjkLabel(l)));
check("labels: punctuation-only never votes", ["Common", "Joined", "NULL", "Broken"].every(isAbstentionLabel));
check("labels: trusted list", ["Latin", "Cyrillic", "Greek", "Hangul_vert", "Fraktur", "Thai", "Latin-dn"].every(isTrustedLabel));
check("labels: untrusted tail", ["Tibetan", "Syriac", "Japanese", "HanS_vert", "Devanagari", ""].every((l) => !isTrustedLabel(l)));
check("groups: Japanese→chinese, Hangul→korean", groupForLabel("Japanese_vert") === "chinese" && groupForLabel("Hangul") === "korean");

// --- CTC best path -----------------------------------------------------
{
  const BLANK = 2;
  const classes = 5;
  const blanks = new Float32Array(3 * classes);
  for (let t = 0; t < 3; t++) blanks[t * classes + BLANK] = 1.0;
  check("ctc: all blank is no verdict", ctcBestPath(blanks, classes) === null);

  const c6 = 6;
  const path = [4, 4, BLANK, 4, 3];
  const scores = new Float32Array(path.length * c6);
  path.forEach((cls, t) => {
    scores[t * c6 + cls] = 1.0;
  });
  const best = ctcBestPath(scores, c6);
  check(
    "ctc: repeats collapse, blank breaks runs, majority wins",
    !!best && best.index === 4 && best.strength === 2 && best.total === 3,
  );
}

// --- voting -----------------------------------------------------------------
const vote = (label: string, strength = 2): LineScript => ({
  label,
  strength,
  total: strength,
});
check(
  "votes: CJK majority cleans",
  judgeVotes([vote("Japanese_vert"), vote("Latin", 1), vote("HanS")]).decision === "clean",
);
check(
  "votes: weak line (strength 1) does not count",
  judgeVotes([vote("Japanese", 1)]).decision === "uncertain",
);
check(
  "votes: abstention is not a vote against",
  judgeVotes([vote("Common"), vote("Japanese")]).decision === "clean",
);
check(
  "votes: equal evidence is uncertain",
  judgeVotes([vote("Japanese", 2), vote("Latin", 2)]).decision === "uncertain",
);
const latinMaj: RegionVerdict = judgeVotes([vote("Latin"), vote("Latin", 3), vote("HanT")]);
check("votes: Latin majority is wrong-script", latinMaj.decision === "wrong-script" && latinMaj.script === "Latin");

// majorityLabel needs more than a plurality
check(
  "majority: plurality over the rest",
  majorityLabel([
    { decision: "clean", script: "Japanese", weight: 5 },
    { decision: "wrong-script", script: "Latin", weight: 3 },
  ]) === "Japanese",
);
check(
  "majority: bare plurality refused",
  majorityLabel([
    { decision: "wrong-script", script: "Latin", weight: 3 },
    { decision: "wrong-script", script: "Cyrillic", weight: 3 },
  ]) === null,
);

// --- decideSkip matrix --------------------------------------------------------
const JA = "こんにちは世界"; // real CJK text
const EN = "Hello there world";
check("skip: off mode never skips", decideSkip("off", null, EN, "Japanese", null) === null);
check("skip: empty text defers to OCR-failure path", decideSkip("cjk", null, "", "Japanese", null) === null);
check("skip: cjk no-verdict + latin text -> low-confidence", decideSkip("cjk", null, EN, "Japanese", null) === "low-confidence");
check("skip: cjk no-verdict + cjk text passes", decideSkip("cjk", null, JA, "Japanese", null) === null);
check(
  "skip: cjk uncertain + cjk text rescued",
  decideSkip("cjk", { decision: "uncertain", script: "", weight: 0 }, JA, "Japanese", null) === null,
);
check(
  "skip: cjk trusted wrong-script stands",
  decideSkip("cjk", { decision: "wrong-script", script: "Latin", weight: 4 }, EN, "Japanese", null) === "not-japanese",
);
check(
  "skip: cjk untrusted Tibetan overturned by real kana",
  decideSkip("cjk", { decision: "wrong-script", script: "Tibetan", weight: 2 }, JA, "Japanese", null) === null,
);
check(
  "skip: cjk untrusted + non-CJK text -> low-confidence (not believed)",
  decideSkip("cjk", { decision: "wrong-script", script: "Syriac", weight: 2 }, EN, "Japanese", null) === "low-confidence",
);
check("skip: other mode accepts expected text", decideSkip("other", null, EN, "English", null) === null);
check("skip: other mode refuses wrong text", decideSkip("other", null, JA, "Russian", null) === "low-confidence");
check(
  "skip: auto contradiction skipped",
  decideSkip("auto", { decision: "clean", script: "Japanese", weight: 4 }, JA, "Auto-Detect", "Latin") === "not-japanese",
);
check(
  "skip: auto agreement kept",
  decideSkip("auto", { decision: "clean", script: "Latin", weight: 4 }, EN, "Auto-Detect", "Latin") === null,
);
check("skip: auto without page label keeps everything", decideSkip("auto", null, EN, "Auto-Detect", null) === null);

check("mode: cjk source", gateModeFor("Japanese", true, false) === "cjk");
check("mode: force turns off", gateModeFor("Japanese", true, true) === "off");
check("mode: auto", gateModeFor("Auto-Detect", true, false) === "auto");
check("mode: auto-detect stays auto when gate disabled", gateModeFor("Auto-Detect", false, false) === "auto");
check("mode: disabled gate is off for explicit source", gateModeFor("Japanese", false, false) === "off");
check("mode: other", gateModeFor("Russian", true, false) === "other");

// --- region build (merge / size) ------------------------------------------
{
  const b = (x1: number, y1: number, x2: number, y2: number, confidence = 0.8): Bbox => ({ x1, y1, x2, y2, confidence });
  // overlapping pair: second's centre inside the first -> merged, reading order
  const merged = mergeCentreInBox([b(50, 50, 70, 70, 0.6), b(0, 0, 100, 100, 0.9)]);
  check("merge: centre-in-box hull keeps max confidence", merged.length === 1 && merged[0].confidence === 0.9);
  const disjoint = mergeCentreInBox([b(0, 0, 10, 10), b(50, 50, 60, 60)]);
  check("merge: disjoint boxes survive", disjoint.length === 2);
  check(
    "merge: deterministic reading order",
    JSON.stringify(mergeCentreInBox([b(40, 10, 50, 20), b(0, 10, 10, 20), b(0, 0, 10, 5)])) ===
      JSON.stringify(mergeCentreInBox([b(0, 10, 10, 20), b(0, 0, 10, 5), b(40, 10, 50, 20)])),
  );

  const big = b(0, 0, 100, 100);
  const small = b(0, 0, 60, 60);
  check("overlap: >20% of smaller merges", overlapsEnough(big, small));
  check(
    "overlap: <=20% does not",
    !overlapsEnough(b(0, 0, 100, 100), b(95, 95, 110, 110)), // 5*5=25 of 225
  );

  check("size: tiny low-conf dropped", sizeVerdict(100, 1000, 10, 1000, 0.5) === "drop");
  check("size: tiny high-conf spared", sizeVerdict(100, 1000, 10, 1000, 0.9) === "keep");
  check("size: 41x median flagged", sizeVerdict(41000, 1000, 10, 1000, 0.9) === "flag-large");
  check("size: tall box flagged", sizeVerdict(1000, 1000, 300, 1000, 0.9) === "flag-large");

  const refined = refineDetections(
    [
      b(40, 40, 60, 50, 0.9), // one text line
      b(42, 52, 62, 60, 0.8), // the next line of the same balloon (bridge-merged via extended)
      b(400, 400, 404, 404, 0.4), // speckle
    ],
    800,
    1200,
  );
  check("refine: speckle dropped", refined.dropped === 1);
  check("refine: adjacent lines of one balloon become one region", refined.boxes.length === 1);
  // extended growth: 2+5 all sides, +1 extra right
  const box = refined.boxes[0];
  check("refine: masking box grew 7px (8 right)", box.x1 === 40 - 7 && box.y1 === 40 - 7 && box.x2 === 62 + 7 + 1 && box.y2 === 60 + 7);
}

if (failures > 0) {
  console.error(`\n${failures} gate check(s) failed`);
  process.exit(1);
}
console.log("\ngate self-check: all passed");
