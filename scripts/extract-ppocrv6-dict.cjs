const fs = require("fs");
const path = require("path");

async function main() {
  const url =
    "https://huggingface.co/PaddlePaddle/PP-OCRv6_medium_rec_safetensors/raw/main/preprocessor_config.json";
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
  const data = await res.json();
  const chars = data.character_list;
  if (chars[0] !== "blank") {
    throw new Error("Unexpected character_list[0]: " + chars[0]);
  }
  const dict = chars.slice(1, -1);
  const outPath = path.join(
    __dirname,
    "..",
    "public",
    "dicts",
    "ppocrv6_dict.txt",
  );
  console.log("Dict chars:", dict.length);
  fs.writeFileSync(outPath, dict.join("\n"), "utf8");
  console.log("Written to", outPath);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});