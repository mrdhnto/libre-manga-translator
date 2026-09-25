/**
 * Security & URL hardening utilities to protect background service worker
 * from SSRF, local port scanning, and internal protocol manipulation.
 */

/**
 * Validates whether an image URL is safe for background proxy fetching.
 * Strictly enforces HTTPS/HTTP and rejects loopback, RFC1918 private IPs,
 * link-local/cloud metadata, internal browser schemes, and credentials.
 */
export function isAllowedImageUrl(rawUrl: string, pageOrigin?: string): boolean {
  if (!rawUrl || typeof rawUrl !== "string") return false;

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }

  // 1. Strict protocol allowlist: HTTPS or HTTP only
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return false;
  }

  // 2. Reject credentials embedded in URL (user:pass@host)
  if (parsed.username || parsed.password) {
    return false;
  }

  // Normalize host (lowercase, remove brackets for IPv6)
  let host = parsed.hostname.toLowerCase().trim();
  if (host.startsWith("[") && host.endsWith("]")) {
    host = host.slice(1, -1);
  }

  if (!host) return false;

  // 3. Reject localhost, local domain suffixes, and mDNS
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".lan")
  ) {
    return false;
  }

  // 4. Reject integer or hex representations of IP addresses (common SSRF bypasses)
  if (/^\d+$/.test(host) || /^0x[0-9a-f]+$/i.test(host)) {
    return false;
  }

  // 5. IPv4 numeric validation
  const ipv4Parts = host.split(".");
  if (ipv4Parts.length === 4 && ipv4Parts.every((p) => /^\d+$/.test(p))) {
    const octets = ipv4Parts.map((p) => parseInt(p, 10));
    if (octets.some((o) => o < 0 || o > 255)) return false;

    const [b0, b1] = octets;

    // 0.0.0.0/8 (Current network)
    if (b0 === 0) return false;

    // 127.0.0.0/8 (Loopback)
    if (b0 === 127) return false;

    // 10.0.0.0/8 (RFC1918 Private)
    if (b0 === 10) return false;

    // 172.16.0.0/12 (RFC1918 Private)
    if (b0 === 172 && b1 >= 16 && b1 <= 31) return false;

    // 192.168.0.0/16 (RFC1918 Private)
    if (b0 === 192 && b1 === 168) return false;

    // 169.254.0.0/16 (Link-Local & Cloud Metadata e.g. AWS/GCP 169.254.169.254)
    if (b0 === 169 && b1 === 254) return false;

    // 100.64.0.0/10 (Shared address / CGNAT)
    if (b0 === 100 && b1 >= 64 && b1 <= 127) return false;

    // 192.0.0.0/24 (IETF Protocol Assignments)
    if (b0 === 192 && b1 === 0) return false;

    // 198.18.0.0/15 (Network benchmark tests)
    if (b0 === 198 && (b1 === 18 || b1 === 19)) return false;

    // 224.0.0.0/4 (Multicast) & 240.0.0.0/4 (Reserved)
    if (b0 >= 224) return false;
  }

  // 6. IPv6 validation
  if (
    host === "::1" ||
    host === "::" ||
    host.startsWith("fe80:") || // Link-local
    host.startsWith("fe8") ||
    host.startsWith("fe9") ||
    host.startsWith("fea") ||
    host.startsWith("feb") ||
    host.startsWith("fc") || // Unique local address (ULA)
    host.startsWith("fd") ||
    host.includes("::ffff:127.") || // IPv4-mapped loopback
    host.includes("::ffff:10.") || // IPv4-mapped private
    host.includes("::ffff:192.168.") ||
    host.includes("::ffff:172.") ||
    host.includes("::ffff:169.254.")
  ) {
    return false;
  }

  return true;
}
