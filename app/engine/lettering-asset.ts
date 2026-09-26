import type { Layer, SpatialLayerStyle, TextStyle } from "./document";
import { cloneTextStyle } from "./text-model";
import { cloneSpatialStyle } from "./text-3d";
import { validateOutlineText, type ShapedOutlines } from "./text-outline-model";

/** Source + positioned geometry + reproducible camera recipe. Pixels live in Layer.bitmap. */
export type LetteringAsset = {
  version: 1;
  renderer: "luma-lettering-v1";
  text: TextStyle;
  spatial: SpatialLayerStyle;
  outlines: ShapedOutlines;
  width: number;
  height: number;
};
export const LETTERING_ASSET_LIMITS = { bytes: 2 * 1024 * 1024, width: 1600, height: 1200 } as const;

export function validateLetteringAsset(asset: LetteringAsset): void {
  if (!asset || asset.version !== 1 || asset.renderer !== "luma-lettering-v1" ||
      asset.width !== 1600 || asset.height !== 1200) throw new Error("Unsupported 3D lettering asset or render dimensions.");
  if (JSON.stringify(asset).length * 2 > LETTERING_ASSET_LIMITS.bytes) throw new Error("3D lettering source exceeds its 2 MiB budget.");
  const { selected } = validateOutlineText(asset.text);
  const s = asset.spatial;
  if (!s || s.schemaVersion !== 1 || !s.enabled || !s.transform || !s.extrusion || !s.material) throw new Error("Invalid 3D material or camera settings.");
  const inRange = (n: number, min: number, max: number) => Number.isFinite(n) && n >= min && n <= max;
  if (![s.transform.rotationX, s.transform.rotationY, s.transform.rotationZ].every(n => inRange(n, -180, 180)) ||
      !inRange(s.transform.perspective, 0, 100) || !inRange(s.extrusion.depth, 0, 1000) || !inRange(s.extrusion.bevel, 0, 100) ||
      !inRange(s.material.roughness, 0, 1) || !inRange(s.material.metalness, 0, 1) ||
      !/^#[0-9a-f]{6}$/i.test(s.material.frontColor) || !/^#[0-9a-f]{6}$/i.test(s.material.sideColor)) throw new Error("Invalid 3D material or camera settings.");
  const o = asset.outlines;
  if (!o || o.fontFile !== selected.file || !Array.isArray(o.paths) || o.paths.length > 1280 ||
      !Array.isArray(o.glyphs) || o.glyphs.length > 1280 || !o.glyphs.every(n => Number.isSafeInteger(n) && n > 0) ||
      !Array.isArray(o.lineWidths) || o.lineWidths.length > 160 || !o.lineWidths.every(Number.isFinite)) throw new Error("Invalid saved 3D glyph geometry.");
  let count = 0;
  for (const path of o.paths) {
    if (!path || !Array.isArray(path.commands)) throw new Error("Invalid saved 3D outline.");
    count += path.commands.length;
    if (count > 12000) throw new Error("3D outline complexity exceeds the geometry budget.");
    for (const command of path.commands) {
      if (!command || !["M", "L", "Q", "C", "Z"].includes(command.type)) throw new Error("Invalid saved 3D outline command.");
      const fields = command.type === "Z" ? [] : command.type === "C" ? ["x", "y", "x1", "y1", "x2", "y2"] : command.type === "Q" ? ["x", "y", "x1", "y1"] : ["x", "y"];
      for (const field of fields) if (!inRange((command as unknown as Record<string, number>)[field], -10_000_000, 10_000_000)) throw new Error("Invalid saved 3D outline coordinate.");
    }
  }
  if (!count) throw new Error("3D lettering contains no geometry.");
}

export function cloneLetteringAsset(asset: LetteringAsset): LetteringAsset {
  return { ...asset, text: cloneTextStyle(asset.text), spatial: cloneSpatialStyle(asset.spatial)!, outlines: structuredClone(asset.outlines) };
}

export function validateLetteringLayer(layer: Layer) {
  validateLetteringAsset(layer.lettering3d!);
  if (layer.kind !== "smart-object" || !layer.bitmap || layer.bitmap.width !== layer.lettering3d!.width || layer.bitmap.height !== layer.lettering3d!.height || layer.text || layer.path || layer.raw || layer.spatial?.enabled) throw new Error("3D object is missing its committed render or has conflicting content.");
}

/** Conservative object/array overhead as well as serialized source size. */
export function letteringAssetBytes(asset: LetteringAsset | undefined) {
  return asset ? JSON.stringify(asset).length * 4 + asset.outlines.paths.reduce((n, path) => n + 128 + path.commands.length * 128, 0) : 0;
}

export function letteringSourceKey(text: TextStyle) {
  return JSON.stringify({ ...text, x: 0, y: 0, spatial: undefined });
}
