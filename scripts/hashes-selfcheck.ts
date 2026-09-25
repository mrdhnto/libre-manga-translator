import {
  computeBufferSha256,
  verifyBufferSha256,
  getExpectedSha256,
} from "../src/lib/manifests/hashes";

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
}

async function run() {
  const testBytes = new TextEncoder().encode("Hello Libre Manga Translator");
  const buffer = testBytes.buffer;

  // Expected SHA-256 of "Hello Libre Manga Translator"
  // echo -n "Hello Libre Manga Translator" | sha256sum
  const computed = await computeBufferSha256(buffer);
  assert(typeof computed === "string" && computed.length === 64, "Hash length must be 64 hex chars");

  const valid = await verifyBufferSha256(buffer, computed);
  assert(valid === true, "verifyBufferSha256 should pass for matching hash");

  const invalid = await verifyBufferSha256(buffer, "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");
  assert(invalid === false, "verifyBufferSha256 should fail for mismatching hash");

  // Empty expected hash allows pass-through (unpinned model)
  const emptyAllowed = await verifyBufferSha256(buffer, "");
  assert(emptyAllowed === true, "Empty expected hash should allow pass-through");

  console.log("PASS: hashes-selfcheck passed.");
}

run();
