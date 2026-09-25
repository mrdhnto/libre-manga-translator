export function imageToBase64(img: HTMLImageElement): string | null {
  try {
    const width = img.naturalWidth;
    const height = img.naturalHeight;
    if (!width || !height) return null;

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, width, height);

    return canvas.toDataURL("image/jpeg", 0.95);
  } catch {
    return null;
  }
}

export function exportCanvasToJpeg(
  canvas: HTMLCanvasElement,
  quality = 0.85,
): void {
  const link = document.createElement("a");
  link.download = `lmt-export-${Date.now()}.jpg`;
  link.href = canvas.toDataURL("image/jpeg", quality);
  link.click();
}
