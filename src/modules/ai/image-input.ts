const supported = new Set(["image/png", "image/jpeg", "image/webp"]);

export async function sanitizeDiagramImage(file: File, maxDimension = 2048) {
  if (!supported.has(file.type)) throw new Error("Use PNG, JPEG or WebP");
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Image decoding is unavailable");
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return { mimeType: "image/png" as const, dataUrl: canvas.toDataURL("image/png"), width: canvas.width, height: canvas.height };
}
