import * as ort from "onnxruntime-web/all";
import { downloadArtifactHF } from "../utils";
import { DefaultConfig } from "../configs";
import { ctcBestPath, osdPreprocess } from "./ctc";
import { judgeVotes, type LineScript, type RegionVerdict } from "./index";

/**
 * The script-identification model (LSTM, 3.72 MB) + labels, from
 * `ogkalu/image-script-identification` (Apache-2.0), fetched through the
 * existing `downloadArtifactHF` cache - same machinery as the OCR and
 * detection models, so no new permissions or hosts.
 *
 * The convention (strip height, rotation, Tesseract normalization, CTC blank
 * at class 2) is implemented in the pure `ctc.ts`; this file only owns the
 * session. Failure to load is silent-by-design: the gate degrades to text
 * verification and must never block translating.
 */

const NULL_CHAR = 0;

let session: ort.InferenceSession | null = null;
let labels: string[] = [];
let runLock: Promise<void> = Promise.resolve();
let loadPromise: Promise<ort.InferenceSession | null> | null = null;

export const gateReady = (): boolean => !!session;

/** Load once; a failure (offline, first run) is not cached so the next page
 * can retry. */
export async function ensureGate(): Promise<boolean> {
  if (session) return true;
  if (!loadPromise) {
    loadPromise = (async () => {
      try {
        const [nextSession, labelsResponse] = await Promise.all([
          downloadArtifactHF(
            DefaultConfig.gateRepo,
            DefaultConfig.gateModelPath,
          ),
          downloadArtifactHF(
            DefaultConfig.gateRepo,
            DefaultConfig.gateLabelsPath,
          ),
        ]);
        const parsed: unknown = JSON.parse(await labelsResponse.text());
        if (!Array.isArray(parsed) || parsed.length === 0)
          throw new Error("gate labels malformed");
        labels = parsed.map(String);
        session = nextSession;
      } catch (err) {
        console.warn(
          "LMT: script gate model unavailable; gate degrades to text verification:",
          err,
        );
        session = null;
      } finally {
        loadPromise = null;
      }
      return session;
    })();
  }
  return !!(await loadPromise);
}

/** Whether the gate model opened, trying if needed (text checks still run). */
export async function loadGate(): Promise<boolean> {
  await ensureGate();
  return gateReady();
}

/**
 * Identify one already-orientation-normalized line (vertical CJK arrives
 * rotated CCW from `cropBubbleFromImage`, matching the model's convention -
 * the mirrored one returns Hangul_vert/Fraktur on vertical Japanese).
 * `null` = the model said nothing usable.
 */
export async function identifyLine(line: ImageData): Promise<LineScript | null> {
  const s = session;
  if (!s) return null;
  const pre = osdPreprocess(line);
  if (!pre || pre.width < 3) return null;

  return runLock.then(async () => {
    try {
      const input = new ort.Tensor("float32", pre.data, [
        1,
        1,
        48,
        pre.width,
      ]);
      const outputs = await s.run({ [s.inputNames[0]]: input });
      const output = outputs[s.outputNames[0]];
      const dims = output.dims as number[];
      const classes = dims[dims.length - 1];
      if (classes !== labels.length) {
        console.warn(
          `LMT: gate labels do not match the model (${labels.length} labels, ${classes} classes)`,
        );
        return null;
      }
      const best = ctcBestPath(output.data as Float32Array, classes);
      if (!best || best.index === NULL_CHAR) return null;
      const label = labels[best.index];
      if (label === undefined) return null;
      return { label, strength: best.strength, total: best.total };
    } catch (err) {
      console.warn("LMT: script identification failed on a line:", err);
      return null;
    }
  });
}

/** Run the identifier over one region's lines and aggregate the votes. */
export async function judgeRegion(lines: ImageData[]): Promise<RegionVerdict> {
  const votes: LineScript[] = [];
  for (const line of lines) {
    const script = await identifyLine(line);
    if (script) votes.push(script);
  }
  return judgeVotes(votes);
}

/** Release the gate session's hardware memory (WebGPU), same discipline as
 * the OCR session switch (`ocr/main.ts`). */
export async function releaseGate(): Promise<void> {
  if (!session) return;
  try {
    await session.release();
  } catch (err) {
    console.warn("LMT: Failed to cleanly release the gate session:", err);
  }
  session = null;
  labels = [];
}
