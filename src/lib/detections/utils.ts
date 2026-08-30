import { fetchAsImageBitmap } from "../utils";

export async function scalingImage(imageSrc: string, modelSize: number = 1280) {
  const bitmap = await fetchAsImageBitmap(imageSrc);

  const canvas = new OffscreenCanvas(modelSize, modelSize);
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;

  // Fill the background with YOLO's standard padding color (gray)
  ctx.fillStyle = "rgb(114, 114, 114)";
  ctx.fillRect(0, 0, modelSize, modelSize);

  // Calculate the scaling factor using the bitmap dimensions
  const scale = Math.min(modelSize / bitmap.width, modelSize / bitmap.height);

  const newWidth = bitmap.width * scale;
  const newHeight = bitmap.height * scale;

  // Calculate the coordinates needed to center the image
  const offsetX = (modelSize - newWidth) / 2;
  const offsetY = (modelSize - newHeight) / 2;

  // Draw the scaled image and extract the raw pixels
  ctx.drawImage(bitmap, offsetX, offsetY, newWidth, newHeight);

  return {
    imageData: ctx.getImageData(0, 0, modelSize, modelSize),
    origWidth: bitmap.width,
    origHeight: bitmap.height,
  };
}

export function restoreBoundingBox(
  bbox: Bbox,
  origWidth: number,
  origHeight: number,
  modelSize: number = 1280,
) {
  const gain = Math.min(modelSize / origWidth, modelSize / origHeight);
  const padX = (modelSize - origWidth * gain) / 2;
  const padY = (modelSize - origHeight * gain) / 2;

  return {
    ...bbox,
    x1: (bbox.x1 - padX) / gain,
    y1: (bbox.y1 - padY) / gain,
    x2: (bbox.x2 - padX) / gain,
    y2: (bbox.y2 - padY) / gain,
  };
}

export function containmentNMS(detections: Bbox[], threshold = 0.85): Bbox[] {
  // Sort by confidence descending so we keep the stronger box
  const sorted = [...detections].sort(
    (a, b) =>
      (a.confidence && b.confidence && b.confidence - a.confidence) || 0,
  );
  const keep: Bbox[] = [];

  for (const box of sorted) {
    const boxArea = (box.x2 - box.x1) * (box.y2 - box.y1);

    const suppressed = keep.some((kept) => {
      const ix1 = Math.max(box.x1, kept.x1);
      const iy1 = Math.max(box.y1, kept.y1);
      const ix2 = Math.min(box.x2, kept.x2);
      const iy2 = Math.min(box.y2, kept.y2);

      if (ix2 <= ix1 || iy2 <= iy1) return false;

      const interArea = (ix2 - ix1) * (iy2 - iy1);
      // What fraction of THIS box is covered by the kept box
      return interArea / boxArea > threshold;
    });

    if (!suppressed) keep.push(box);
  }

  return keep;
}