import { fetchAsImageBitmap } from "@/lib/utils";

export function sampleRegionAvg(
  data: Uint8ClampedArray,
  w: number,
  rx: number,
  ry: number,
  rw: number,
  rh: number,
): [number, number, number] {
  let r = 0,
    g = 0,
    b = 0,
    n = 0;
  for (let y = ry; y < ry + rh; y++) {
    for (let x = rx; x < rx + rw; x++) {
      const i = (y * w + x) * 4;
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
      n++;
    }
  }
  return n ? [r / n, g / n, b / n] : [255, 255, 255];
}

export function inpaintBbox(imgData: ImageData, bbox: Bbox, margin = 4): void {
  const { data, width, height } = imgData;
  const x1 = Math.max(0, Math.round(bbox.x1));
  const y1 = Math.max(0, Math.round(bbox.y1));
  const x2 = Math.min(width - 1, Math.round(bbox.x2));
  const y2 = Math.min(height - 1, Math.round(bbox.y2));

  const clamp = (v: number, lo: number, hi: number) =>
    Math.max(lo, Math.min(hi, v));

  const edgeL = (py: number) => {
    const sx = clamp(x1 - margin, 0, width - 1);
    return sampleRegionAvg(data, width, sx, py, clamp(margin, 1, x1), 1);
  };
  const edgeR = (py: number) => {
    const sx = clamp(x2 + 1, 0, width - 1);
    return sampleRegionAvg(
      data,
      width,
      sx,
      py,
      clamp(margin, 1, width - sx),
      1,
    );
  };
  const edgeT = (px: number) => {
    const sy = clamp(y1 - margin, 0, height - 1);
    return sampleRegionAvg(data, width, px, sy, 1, clamp(margin, 1, y1));
  };
  const edgeB = (px: number) => {
    const sy = clamp(y2 + 1, 0, height - 1);
    return sampleRegionAvg(
      data,
      width,
      px,
      sy,
      1,
      clamp(margin, 1, height - sy),
    );
  };

  const bw = x2 - x1 || 1;
  const bh = y2 - y1 || 1;

  for (let py = y1; py <= y2; py++) {
    const ty = (py - y1) / bh;

    for (let px = x1; px <= x2; px++) {
      const tx = (px - x1) / bw;

      const l = edgeL(py),
        r = edgeR(py);
      const t = edgeT(px),
        b = edgeB(px);

      const idx = (py * width + px) * 4;

      for (let c = 0; c < 3; c++) {
        const h = l[c] * (1 - tx) + r[c] * tx;
        const v = t[c] * (1 - ty) + b[c] * ty;
        const wx = Math.min(tx, 1 - tx) * 2;
        const wy = Math.min(ty, 1 - ty) * 2;
        data[idx + c] =
          h * (1 - wy * 0.5) * 0.5 + v * (1 - wx * 0.5) * 0.5 + (h + v) * 0.25;
      }
      data[idx + 3] = 255;
    }
  }
}

export async function inpaintLocal(
  imageSrc: string,
  bboxes: Bbox[],
): Promise<string> {
  const bitmap = await fetchAsImageBitmap(imageSrc);

  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;

  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();

  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  for (const bbox of bboxes) inpaintBbox(imgData, bbox);
  ctx.putImageData(imgData, 0, 0);

  return canvas.toDataURL("image/png");
}
