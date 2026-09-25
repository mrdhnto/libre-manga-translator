import { getExpectedSha256, verifyBufferSha256 } from "../manifests/hashes";

function versionHeader(h: Headers): string | null {
  return h.get("x-repo-commit") || h.get("etag");
}

/**
 * HEAD-compare a cached artifact against remote.
 * Same protocol the old per-model autoUpdate used: `x-repo-commit || etag`.
 * Missing headers on either side -> false. HEAD failure -> skipped:true (offline-safe).
 */
export async function checkArtifactUpdate(
  cacheName: string,
  url: string,
): Promise<{ hasUpdate: boolean; skipped?: boolean }> {
  try {
    const cache = await caches.open(cacheName);
    const local = await cache.match(url);
    if (!local) return { hasUpdate: false };
    let head: Response;
    try {
      head = await fetch(url, { method: "HEAD" });
    } catch {
      return { hasUpdate: false, skipped: true };
    }
    if (!head.ok) return { hasUpdate: false, skipped: true };
    const current = versionHeader(head.headers);
    const stored = versionHeader(local.headers);
    if (!current || !stored) return { hasUpdate: false };
    return { hasUpdate: current !== stored };
  } catch {
    return { hasUpdate: false, skipped: true };
  }
}

/**
 * Unconditional re-download + CacheStorage replace, with SHA-256 gate.
 * Extracted from downloadArtifactHF's refresh branch (utils.ts).
 */
export async function forceRefreshArtifact(
  cacheName: string,
  url: string,
): Promise<void> {
  const fetched = await fetch(url);
  if (!fetched.ok)
    throw new Error(`Failed to download model from ${url} (${fetched.status} ${fetched.statusText})`);
  const buffer = await fetched.arrayBuffer();

  const path = url.split("?")[0];
  const expectedSha256 = getExpectedSha256(path, url);
  if (expectedSha256) {
    const isValid = await verifyBufferSha256(buffer, expectedSha256);
    if (!isValid) throw new Error(`Integrity check failed: SHA-256 mismatch for ${url}`);
  }

  const cache = await caches.open(cacheName);
  const response = new Response(buffer, {
    headers: fetched.headers,
    status: fetched.status,
    statusText: fetched.statusText,
  });
  await cache.put(url, response.clone());
}
