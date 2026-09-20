// Bundle-size guard: every emitted .js must stay under the Firefox AMO
// ~2MB validation limit. Run after a build:
//   bun scripts/check-bundle-size.ts [.output/firefox-mv2] [--probe]
// --probe additionally counts heavy-lib markers per file so regressions
// (e.g. onnxruntime leaking into background.js) are easy to attribute.
import fs from "node:fs";
import path from "node:path";

const LIMIT_BYTES = 1_900_000;
const PROBE_MARKERS = [
  "wllama",
  "MLCEngine",
  "InferenceSession",
  "createChatCompletion",
  "detectTextBubble",
  "textRecognise",
  "inpaintImageAuto",
  "sourceMappingURL",
];

const dir = process.argv[2] ?? ".output/firefox-mv2";
const probe = process.argv.includes("--probe");

function collectJsFiles(root: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(root)) {
    console.error(`missing output dir: ${root}`);
    process.exit(2);
  }
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && p.endsWith(".js")) out.push(p);
    }
  };
  walk(root);
  return out.sort();
}

let violations = 0;
for (const f of collectJsFiles(dir)) {
  const st = fs.statSync(f);
  const mb = (st.size / 1_048_576).toFixed(2);
  const flag = st.size > LIMIT_BYTES ? "  <-- OVER LIMIT" : "";
  if (st.size > LIMIT_BYTES) violations++;
  console.log(`${mb.padStart(7)} MB  ${path.relative(dir, f)}${flag}`);
  if (probe) {
    const s = fs.readFileSync(f, "utf8");
    for (const m of PROBE_MARKERS) {
      const n = s.split(m).length - 1;
      if (n > 0) console.log(`           ${m}: ${n}`);
    }
  }
}
console.log(violations === 0 ? "OK: all .js under limit" : `${violations} file(s) OVER LIMIT`);
process.exit(violations === 0 ? 0 : 1);
