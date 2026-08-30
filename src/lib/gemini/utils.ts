import { fetchAsBase64 } from "@/lib/utils";

export async function drawNumberedBboxes(
  imageSrc: string,
  bboxes: Bbox[],
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();

    img.onload = () => {
      // Set a reasonable max width for AI ingestion
      const MAX_WIDTH = 1024;
      let scale = 1;

      if (img.width > MAX_WIDTH) {
        scale = MAX_WIDTH / img.width;
      }

      const canvas = document.createElement("canvas");
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;
      const ctx = canvas.getContext("2d");

      if (!ctx) {
        return reject(new Error("Failed to get 2d canvas context"));
      }

      // Draw the image scaled down
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      bboxes.forEach((box, index) => {
        // Scale the incoming coordinates to match the new canvas size
        const x1 = box.x1 * scale;
        const y1 = box.y1 * scale;
        const width = (box.x2 - box.x1) * scale;
        const height = (box.y2 - box.y1) * scale;
        const boxNumber = (index + 1).toString();

        ctx.lineWidth = Math.max(2, 4 * scale);
        ctx.strokeStyle = "#ef4444";
        ctx.strokeRect(x1, y1, width, height);

        const fontSize = Math.max(14, Math.floor(28 * scale));
        ctx.font = `bold ${fontSize}px sans-serif`;
        const textMetrics = ctx.measureText(boxNumber);

        const labelWidth = textMetrics.width + 12 * scale;
        const labelHeight = Math.max(18, 36 * scale);

        let labelY = y1 - labelHeight;
        if (labelY < 0) {
          labelY = y1;
        }

        ctx.fillStyle = "#ef4444";
        ctx.fillRect(x1, labelY, labelWidth, labelHeight);

        ctx.fillStyle = "#ffffff";
        ctx.textBaseline = "top";
        ctx.fillText(boxNumber, x1 + 6 * scale, labelY + 4 * scale);
      });

      // Export at 75% quality
      resolve(canvas.toDataURL("image/jpeg", 0.75));
    };

    img.onerror = () =>
      reject(new Error("Failed to load image for canvas drawing"));
    fetchAsBase64(imageSrc).then((base64) => (img.src = base64));
  });
}