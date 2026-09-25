import { DefaultConfig } from "@/lib/configs";
import { getSiteRule } from "@/lib/adapters";
import { quickHash, resolveImagePageIndex } from "./utils";
import { storage } from "#imports";

/**
 * LMT-only, content-isolated translation registry.
 * Strict block: pending → any second request for same src/cacheKey returns immediately.
 * Error/crash → markIdle (delete) so pill or queue can retrigger.
 * No window.__LMT__ exposure — page world cannot see or bypass.
 */

export type TranslationStatus = "idle" | "pending" | "done";

const bySrc = new Map<string, TranslationStatus>(); // srcKey(originalSrc) → status
const byCacheKey = new Map<string, TranslationStatus>(); // local:page-cache-… → status

export function srcKeyOf(src: string): string {
  return src.startsWith("data:") ? quickHash(src) : src;
}

export async function resolveCacheKey(
  img: HTMLImageElement,
  originalSrc: string,
): Promise<string> {
  const { seriesName, chapterId, pageIndex } = await getSiteRule();
  const resolvedPage = resolveImagePageIndex(img, originalSrc, pageIndex);
  const targetLang =
    (await storage.getItem<string>("sync:target-lang")) ?? DefaultConfig.targetLang;
  const imgHash = quickHash(originalSrc);
  return `local:page-cache-${targetLang}-${seriesName}-${chapterId}-p${resolvedPage}-${imgHash}`;
}

export function isPending(src: string): boolean {
  return bySrc.get(srcKeyOf(src)) === "pending";
}

export function isDone(src: string): boolean {
  return bySrc.get(srcKeyOf(src)) === "done";
}

export function getStatus(src: string): TranslationStatus {
  return bySrc.get(srcKeyOf(src)) ?? "idle";
}

export function getStatusByCacheKey(cacheKey: string): TranslationStatus {
  return byCacheKey.get(cacheKey) ?? "idle";
}

export function markPending(src: string, cacheKey?: string): void {
  const k = srcKeyOf(src);
  bySrc.set(k, "pending");
  if (cacheKey) byCacheKey.set(cacheKey, "pending");
  document.dispatchEvent(
    new CustomEvent("lmt:translation-status", {
      detail: { src, cacheKey, status: "pending" as const },
    }),
  );
}

export function markDone(src: string, cacheKey?: string): void {
  bySrc.set(srcKeyOf(src), "done");
  if (cacheKey) {
    byCacheKey.set(cacheKey, "done");
  } else {
    // Overlay calls markDone(originalSrc) without the full page-cache key
    // (it has no img element to resolve the page index). Without this sweep
    // the byCacheKey entry stays "pending" forever and the second-run guard
    // (getStatusByCacheKey === "pending") deadlocks every retry. All keys
    // for this src share the `-${imgHash}` suffix, so settle them together.
    const suffix = `-${quickHash(src)}`;
    for (const [key, status] of byCacheKey) {
      if (status === "pending" && key.endsWith(suffix)) {
        byCacheKey.set(key, "done");
      }
    }
  }
  document.dispatchEvent(
    new CustomEvent("lmt:translation-status", {
      detail: { src, cacheKey, status: "done" as const },
    }),
  );
}

export function markIdle(src: string, cacheKey?: string): void {
  bySrc.delete(srcKeyOf(src));
  if (cacheKey) {
    byCacheKey.delete(cacheKey);
  } else {
    // Same leak as markDone: error/close paths without a key must still
    // release the pending cache-key claim, otherwise the retry guard sees
    // a stale "pending" and early-returns forever.
    const suffix = `-${quickHash(src)}`;
    for (const key of [...byCacheKey.keys()]) {
      if (key.endsWith(suffix)) byCacheKey.delete(key);
    }
  }
  document.dispatchEvent(
    new CustomEvent("lmt:translation-status", {
      detail: { src, cacheKey, status: "idle" as const },
    }),
  );
}
