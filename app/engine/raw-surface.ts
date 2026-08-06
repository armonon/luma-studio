import { DevelopedDng } from "./raw-dng";
import { PixelFormat, PrecisionTileSurface, float32ToFloat16 } from "./tile-store";

/**
 * Promote a developed scene-linear RAW buffer directly into Luma's precision
 * tile master. This deliberately bypasses 8-bit canvas round-tripping.
 */
export function developedDngToSurface(
  developed: DevelopedDng,
  format: PixelFormat = "rgba32f",
  tileSize = 256,
) {
  const surface = new PrecisionTileSurface(
    developed.width,
    developed.height,
    format,
    developed.settings.workingSpace,
    tileSize,
  );
  for (let row = 0; row < surface.grid.rows; row += 1) {
    for (let column = 0; column < surface.grid.columns; column += 1) {
      const address = surface.grid.address(column, row);
      const bytes = new Uint8Array(surface.grid.byteLength(address, format));
      const view = new DataView(bytes.buffer);
      let target = 0;
      for (let y = 0; y < address.height; y += 1) {
        for (let x = 0; x < address.width; x += 1) {
          const source = ((address.y + y) * developed.width + address.x + x) * 4;
          for (let channel = 0; channel < 4; channel += 1) {
            const value = developed.pixels[source + channel];
            if (format === "rgba8") bytes[target] = Math.round(Math.max(0, Math.min(1, value)) * 255);
            else if (format === "rgba16f") view.setUint16(target * 2, float32ToFloat16(value), true);
            else view.setFloat32(target * 4, value, true);
            target += 1;
          }
        }
      }
      surface.store.write(address.key, bytes);
    }
  }
  return surface;
}
