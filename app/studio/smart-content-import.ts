import type { Studio } from "../engine/studio";
import { newCanvas } from "../engine/document";
import { preflightRasterFile } from "../engine/input-limits";
import { assertSmartContentDimensions, SMART_CONTENT_MAX_FILE_BYTES, type SmartContentTarget } from "../engine/smart-object-content";

export async function replaceSmartContentFromFile(studio: Studio, target: SmartContentTarget, file: File) {
  if (!/\.(png|jpe?g|webp)$/i.test(file.name) || file.size > SMART_CONTENT_MAX_FILE_BYTES) {
    throw new Error("Choose a PNG, JPEG or WebP no larger than 32 MiB / 4 megapixels.");
  }
  // Inspect dimensions before asking the browser to allocate a decoded image.
  const header = await preflightRasterFile(file, (width, height) => {
    try { assertSmartContentDimensions(width, height); return false; } catch { return true; }
  });
  if (!header || !["png", "jpeg", "webp"].includes(header.format)) throw new Error("The file does not contain a supported PNG, JPEG or WebP image.");
  const image = await createImageBitmap(file);
  try {
    assertSmartContentDimensions(image.width, image.height);
    const canvas = newCanvas(image.width, image.height);
    canvas.getContext("2d")!.drawImage(image, 0, 0);
    studio.replaceSmartContent(target, canvas);
  } finally { image.close(); }
}
