#!/usr/bin/env bun
/**
 * Pin / verify SHA-256 for every model artifact LMT downloads.
 * URL rule mirrors `downloadArtifactHF` (src/lib/utils.ts:101-106):
 *   HF repo → https://huggingface.co/<repo>/resolve/main/<path>
 *   direct URL → used as-is, cacheName "direct-model-cache".
 *
 * Usage:
 *   bun scripts/pin-model-hashes.ts --list    # no network, list 31 artifacts
 *   bun scripts/pin-model-hashes.ts           # download all, write scripts/model-hashes.json + print TS snippet
 *   bun scripts/pin-model-hashes.ts --check   # re-download, compare vs KNOWN_MODEL_SHA256, exit 1 on mismatch
 *
 * Read extension CacheStorage instead of re-downloading (DevTools console on
 * extension context — caches are partitioned, see src/lib/utils.ts:179-186):
 *   const c = await caches.open("monkt/paddleocr-onnx");
 *   const r = await c.match("https://huggingface.co/monkt/paddleocr-onnx/resolve/main/languages/latin/rec.onnx");
 *   const b = await r.arrayBuffer();
 *   const d = await crypto.subtle.digest("SHA-256", b);
 *   [...new Uint8Array(d)].map(x => x.toString(16).padStart(2, "0")).join("");
 */
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { DefaultConfig, SUPPORTED_LANG_GROUPS } from "../src/lib/configs";
import { env } from "../src/lib/env";
import { KNOWN_MODEL_SHA256, getExpectedSha256 } from "../src/lib/manifests/hashes";

interface Artifact {
  key: string;
  repo: string;
  path: string;
  url: string;
  cacheName: string;
}

const hf = (repo: string, path: string): Artifact => {
  const url = `https://huggingface.co/${repo}/resolve/main/${path}`;
  return { key: path, repo, path, url, cacheName: repo };
};

const direct = (url: string): Artifact => {
  const filename = url.split("?")[0].split("/").pop() ?? url;
  return { key: filename, repo: "direct-model-cache", path: url, url, cacheName: "direct-model-cache" };
};

// ponytail: manifest built from DefaultConfig/env so repo moves can't drift; add new engine here when configs.ts gains one.
function buildArtifacts(): Artifact[] {
  const list: Artifact[] = [
    hf(DefaultConfig.rtdetrModelRepo, "detector-v4-s_int8.onnx"),
    direct(DefaultConfig.comicTextDetectorUrl),
    hf(DefaultConfig.mangaOcrRepo, "encoder_model.onnx"),
    hf(DefaultConfig.mangaOcrRepo, "decoder_model.onnx"),
    hf(DefaultConfig.mangaOcrRepo, "vocab.txt"),
    hf(env.ppocrv6MangaRepo, "ppocr-rec-v6-small-manga.onnx"),
    hf(DefaultConfig.lamaRepo, DefaultConfig.lamaModelPath),
    hf(DefaultConfig.gateRepo, DefaultConfig.gateModelPath),
    hf(DefaultConfig.gateRepo, DefaultConfig.gateLabelsPath),
  ];
  for (const g of SUPPORTED_LANG_GROUPS) {
    list.push(hf(DefaultConfig.ocrRepo, DefaultConfig.ocrModelPath(g)));
    list.push(hf(DefaultConfig.ocrRepo, DefaultConfig.ocrDictPath(g)));
  }
  return list;
}

async function sha256OfUrl(url: string): Promise<{ sha: string; bytes: number }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
  const hash = createHash("sha256");
  let bytes = 0;
  const reader = res.body!.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      hash.update(value);
      bytes += value.length;
    }
  }
  return { sha: hash.digest("hex"), bytes };
}

async function run() {
  const args = new Set(process.argv.slice(2));
  const artifacts = buildArtifacts();

  if (args.has("--list")) {
    for (const a of artifacts) console.log(`${a.cacheName} :: ${a.path}\n  ${a.url}`);
    console.log(`\n${artifacts.length} artifacts`);
    return;
  }

  if (args.has("--check")) {
    let failed = 0;
    for (const a of artifacts) {
      const expected = getExpectedSha256(a.path, a.url);
      if (!expected) {
        console.log(`SKIP ${a.key} (unpinned)`);
        continue;
      }
      const { sha } = await sha256OfUrl(a.url);
      const ok = sha.toLowerCase() === expected.trim().toLowerCase();
      console.log(`${ok ? "PASS" : "FAIL"} ${a.key}\n  expected ${expected}\n  actual   ${sha}`);
      if (!ok) failed++;
    }
    if (failed > 0) {
      console.error(`\n${failed} mismatch(es)`);
      process.exit(1);
    }
    console.log("\nAll pinned hashes match.");
    return;
  }

  // default: pin all, write JSON, print TS snippet
  const rows = [];
  for (const a of artifacts) {
    const { sha, bytes } = await sha256OfUrl(a.url);
    console.log(`${a.key} ${sha} (${bytes} bytes)`);
    rows.push({ ...a, sha256: sha, bytes });
  }
  writeFileSync(new URL("./model-hashes.json", import.meta.url), JSON.stringify(rows, null, 2) + "\n");
  console.log(`\nWrote scripts/model-hashes.json (${rows.length} rows)`);
  console.log("// paste into KNOWN_MODEL_SHA256 in src/lib/manifests/hashes.ts:");
  for (const r of rows) console.log(`"${r.key}": "${r.sha256}",`);
  void KNOWN_MODEL_SHA256;
}

run().catch((e) => {
  console.error(`FAIL: ${e?.message ?? e}`);
  process.exit(1);
});
