import { isAllowedImageUrl } from "../src/lib/security";

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
}

// Rejections
assert(!isAllowedImageUrl("http://localhost:8080/img.jpg"), "localhost should be rejected");
assert(!isAllowedImageUrl("http://127.0.0.1:3000/img.jpg"), "127.0.0.1 should be rejected");
assert(!isAllowedImageUrl("http://[::1]:3000/img.jpg"), "[::1] should be rejected");
assert(!isAllowedImageUrl("http://10.0.0.1/test.png"), "10.0.0.1 should be rejected");
assert(!isAllowedImageUrl("http://172.20.0.1/test.png"), "172.20.0.1 should be rejected");
assert(!isAllowedImageUrl("http://192.168.1.1/test.png"), "192.168.1.1 should be rejected");
assert(!isAllowedImageUrl("http://169.254.169.254/latest/"), "169.254.169.254 should be rejected");
assert(!isAllowedImageUrl("file:///etc/passwd"), "file:// should be rejected");
assert(!isAllowedImageUrl("chrome://settings"), "chrome:// should be rejected");
assert(!isAllowedImageUrl("chrome-extension://xyz/test.png"), "chrome-extension:// should be rejected");
assert(!isAllowedImageUrl("data:image/png;base64,abc"), "data: should be rejected from background proxy");
assert(!isAllowedImageUrl("http://user:pass@example.com/img.jpg"), "credentials should be rejected");
assert(!isAllowedImageUrl("http://2130706433/img.jpg"), "integer IP should be rejected");

// Allowances
assert(isAllowedImageUrl("https://example.com/manga.jpg"), "standard https should be allowed");
assert(isAllowedImageUrl("https://uploads.mangadex.org/data/123.jpg"), "mangadex cdn should be allowed");
assert(isAllowedImageUrl("http://images.example.com:80/pic.webp"), "standard http should be allowed");

console.log("PASS: isAllowedImageUrl security checks passed.");
