export const BUNDLED_FONT_STACKS: Record<string, string> = {
  system: "'Segoe UI', sans-serif",
  noto: "'Noto Sans', sans-serif",
  bangers: "'Bangers', cursive",
  comic: "'Comic Neue', cursive",
};

export async function resolveFontStack(): Promise<string> {
  const selectedFont =
    (await storage.getItem<string>("sync:text-font")) ?? "Segoe UI";
  const customFonts =
    (await storage.getItem<{ name: string; dataUrl: string }[]>(
      "local:custom-fonts",
    )) ?? [];

  let fontStack = BUNDLED_FONT_STACKS[selectedFont];

  if (!fontStack) {
    const custom = customFonts.find(
      (f: { name: string; dataUrl: string }) => f.name === selectedFont,
    );
    if (custom) {
      try {
        const face = new FontFace(custom.name, `url(${custom.dataUrl})`);
        await face.load();
        document.fonts.add(face);
        fontStack = `'${custom.name}', sans-serif`;
      } catch {
        fontStack = "'Segoe UI', sans-serif";
      }
    } else {
      fontStack = "'Segoe UI', sans-serif";
    }
  }
  return fontStack;
}

let measureCtx: CanvasRenderingContext2D | null = null;
function getMeasureCtx(): CanvasRenderingContext2D | null {
  if (!measureCtx && typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    measureCtx = canvas.getContext("2d");
  }
  return measureCtx;
}

export interface FittedTextLayout {
  fontSize: number;
  lines: string[];
  lineH: number;
  blockH: number;
  pad: number;
  maxW: number;
  maxH: number;
}

export function calculateFittedTextLayout(
  text: string,
  width: number,
  height: number,
  fontStack = "'Segoe UI', sans-serif",
  customFontSize?: number,
  bold = true,
  italic = false,
  maxFontSize = 40,
): FittedTextLayout {
  const pad = 8;
  const maxW = width - pad * 2;
  const maxH = height - pad * 2;
  if (maxW <= 0 || maxH <= 0 || !text) {
    const baseSize = customFontSize || 14;
    return {
      fontSize: baseSize,
      lines: text ? [text] : [],
      lineH: baseSize * 1.25,
      blockH: baseSize * 1.25,
      pad,
      maxW,
      maxH,
    };
  }

  const ctx = getMeasureCtx();
  const fontWeight = bold ? "700" : "600";
  const fontStyle = italic ? "italic" : "normal";
  const buildFont = (size: number) =>
    `${fontStyle === "italic" ? "italic " : ""}${fontWeight} ${size}px ${fontStack}`;

  let fontSize = customFontSize
    ? Math.min(customFontSize, maxH)
    : Math.min(maxFontSize, maxH);
  let lines: string[] = [];

  if (ctx) {
    if (customFontSize) {
      ctx.font = buildFont(fontSize);
      lines = wrapText(ctx, text, maxW);
    } else {
      while (fontSize >= 4) {
        ctx.font = buildFont(fontSize);
        lines = wrapText(ctx, text, maxW);
        const lineH = fontSize <= 6 ? fontSize * 1.1 : fontSize * 1.25;
        if (lines.length * lineH <= maxH) break;
        fontSize--;
      }
    }
  } else {
    lines = text.split("\n");
  }

  const lineH = fontSize <= 6 ? fontSize * 1.1 : fontSize * 1.25;
  const blockH = lines.length * lineH;

  return {
    fontSize,
    lines,
    lineH,
    blockH,
    pad,
    maxW,
    maxH,
  };
}

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
  if (maxW <= 0 || maxH <= 0 || !text) return;

  const style = bbox.style;
  const bold = style?.bold ?? true;
  const italic = style?.italic ?? false;
  const fontWeight = bold ? "700" : "600";
  const fontStyle = italic ? "italic" : "normal";

  try {
    await document.fonts.load(`${fontStyle} ${fontWeight} 16px ${fontStack}`);
  } catch (error) {
    console.warn("LMT: Failed to load custom font, falling back.", error);
  }

  const layout = calculateFittedTextLayout(
    text,
    bbox.x2 - bbox.x1,
    bbox.y2 - bbox.y1,
    fontStack,
    style?.fontSize,
    bold,
    italic,
    maxFontSize,
  );

  const { fontSize, lines, lineH, blockH } = layout;
  const startY = bbox.y1 + pad + Math.max(0, (maxH - blockH) / 2);
  const centerX = (bbox.x1 + bbox.x2) / 2;

  ctx.font = `${fontStyle === "italic" ? "italic " : ""}${fontWeight} ${fontSize}px ${fontStack}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";

  const strokeColor = style?.strokeColor ?? "rgba(255,255,255,0.85)";
  const hasStroke = strokeColor !== "none" && strokeColor !== "transparent";
  const strokeWidth = style?.strokeWidth ?? fontSize * 0.25;
  const fillColor = style?.color ?? "#1a1a1a";

  lines.forEach((line, i) => {
    const y = startY + i * lineH;

    if (hasStroke) {
      ctx.lineWidth = strokeWidth;
      ctx.strokeStyle = strokeColor;
      ctx.strokeText(line, centerX, y);
    }

    ctx.fillStyle = fillColor;
    ctx.fillText(line, centerX, y);

    if (style?.underline) {
      const metrics = ctx.measureText(line);
      const textW = metrics.width;
      const underlineY = y + fontSize * 1.05;
      ctx.beginPath();
      ctx.strokeStyle = fillColor;
      ctx.lineWidth = Math.max(1, Math.round(fontSize * 0.08));
      ctx.moveTo(centerX - textW / 2, underlineY);
      ctx.lineTo(centerX + textW / 2, underlineY);
      ctx.stroke();
    }
  });
}
