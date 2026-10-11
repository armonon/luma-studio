export const CUTOUT_MAX_EDGE = 2048;
export type CutoutPoint = { x: number; y: number };
export function cutoutSize(width: number, height: number) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) throw Error("Invalid image dimensions.");
  const scale = Math.min(1, CUTOUT_MAX_EDGE / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}
export function paintCutoutMask(mask: Uint8ClampedArray, width: number, height: number, from: CutoutPoint, to: CutoutPoint, radius: number, restore: boolean) {
  if (mask.length !== width * height || ![from.x, from.y, to.x, to.y, radius].every(Number.isFinite) || radius <= 0) throw Error("Invalid mask stroke.");
  const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / Math.max(1, radius / 3)));
  for (let step = 0; step <= steps; step++) {
    const x = from.x + (to.x - from.x) * step / steps, y = from.y + (to.y - from.y) * step / steps;
    for (let py = Math.max(0, Math.floor(y - radius)); py < Math.min(height, Math.ceil(y + radius)); py++) {
      for (let px = Math.max(0, Math.floor(x - radius)); px < Math.min(width, Math.ceil(x + radius)); px++) {
        const coverage = Math.max(0, Math.min(1, radius - Math.hypot(px + .5 - x, py + .5 - y)));
        const i = py * width + px;
        mask[i] = Math.round(mask[i] * (1 - coverage) + (restore ? 255 : 0) * coverage);
      }
    }
  }
}
export function composeCutout(source: HTMLCanvasElement, alpha: Uint8ClampedArray, feather = 0) {
  if (alpha.length !== source.width * source.height) throw Error("Mask dimensions do not match the image.");
  const mask = document.createElement("canvas"); mask.width = source.width; mask.height = source.height;
  const ctx = mask.getContext("2d")!, pixels = ctx.createImageData(mask.width, mask.height);
  for (let i = 0; i < alpha.length; i++) { pixels.data[i * 4] = pixels.data[i * 4 + 1] = pixels.data[i * 4 + 2] = 255; pixels.data[i * 4 + 3] = alpha[i]; }
  ctx.putImageData(pixels, 0, 0);
  const result = document.createElement("canvas"); result.width = source.width; result.height = source.height;
  const output = result.getContext("2d")!; output.drawImage(source, 0, 0); output.globalCompositeOperation = "destination-in";
  output.filter = `blur(${Math.max(0, Math.min(8, feather))}px)`; output.drawImage(mask, 0, 0); output.filter = "none"; output.globalCompositeOperation = "source-over";
  return result;
}
