export const BUNDLED_FONT_STACKS: Record<string, string> = {
  system: "'Segoe UI', sans-serif",
  noto: "'Noto Sans', sans-serif",
  bangers: "'Bangers', cursive",
  comic: "'Comic Neue', cursive",
};

export function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxW: number,
): string[] {
  const lines: string[] = [];

  for (const paragraph of text.split("\n")) {
    const words = paragraph.split(" ");
    let line = "";

    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;

      if (ctx.measureText(candidate).width <= maxW) {
        line = candidate;
      } else {
        // Word doesn't fit - try hyphenating it
        if (ctx.measureText(word).width > maxW) {
          if (line) {
            lines.push(line);
            line = "";
          }

          let chunk = "";
          for (const char of word) {
            const trial = chunk + char + "-";
            if (ctx.measureText(trial).width > maxW && chunk) {
              lines.push(chunk + "-");
              chunk = char;
            } else {
              chunk += char;
            }
          }
          line = chunk;
        } else {
          if (line) lines.push(line);
          line = word;
        }
      }
    }

    if (line) lines.push(line);
  }

  return lines;
}

export async function drawFittedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  bbox: Bbox,
  fontStack = "'Segoe UI', sans-serif",
  maxFontSize = 40,
): Promise<void> {
  const pad = 8;
  const maxW = bbox.x2 - bbox.x1 - pad * 2;
  const maxH = bbox.y2 - bbox.y1 - pad * 2;
  if (maxW <= 0 || maxH <= 0) return;

  try {
    await document.fonts.load(`600 16px ${fontStack}`);
  } catch (error) {
    console.warn("LMT: Failed to load custom font, falling back.", error);
  }

  let fontSize = Math.min(maxFontSize, maxH);
  let lines: string[] = [];

  while (fontSize >= 4) {
    ctx.font = `600 ${fontSize}px ${fontStack}`;
    lines = wrapText(ctx, text, maxW);
    const lineH = fontSize <= 6 ? fontSize * 1.1 : fontSize * 1.25;
    if (lines.length * lineH <= maxH) break;
    fontSize--;
  }

  const lineH = fontSize * 1.25;
  const blockH = lines.length * lineH;
  const startY = bbox.y1 + pad + Math.max(0, (maxH - blockH) / 2);
  const centerX = (bbox.x1 + bbox.x2) / 2;

  ctx.textAlign = "center";
  ctx.textBaseline = "top";

  // Legibility stroke
  ctx.lineWidth = fontSize * 0.25;
  ctx.strokeStyle = "rgba(255,255,255,0.85)";
  ctx.fillStyle = "#1a1a1a";

  lines.forEach((line, i) => {
    const y = startY + i * lineH;
    ctx.strokeText(line, centerX, y);
    ctx.fillText(line, centerX, y);
  });
}
