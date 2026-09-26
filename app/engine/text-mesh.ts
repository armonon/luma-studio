/**
 * Letter-outline extension of Form Studio's app/luma-text-bridge.ts:
 * Shape → ExtrudeGeometry, separate physical materials, XYZ transform, Y-up.
 * Unlike Form's current textured-box text proxy, these are individual glyph meshes.
 * This module is lazy-loaded only by the 3D lettering workspace.
 */
import * as THREE from "three";
import { parse } from "opentype.js/dist/opentype.mjs";
import type { Font, Path } from "opentype.js";
import type { SpatialLayerStyle, TextStyle } from "./document";
import { bundledFontFace } from "./bundled-fonts";
import { resolvedDefaultTextStyle } from "./text-model";
import { validateOutlineText, type ShapedOutlines, type OutlineCommand } from "./text-outline-model";

export const TEXT_MESH_LIMITS = { characters: 160, commands: 12000, vertices: 300000, fontBytes: 2 * 1024 * 1024, cachedFonts: 4 } as const;
const fontCache = new Map<string, Promise<Font>>();

export function validateMeshText(text: TextStyle) {
  if (!text.text.trim()) throw new Error("Enter some text first.");
  if (text.text.length > TEXT_MESH_LIMITS.characters) throw new Error("3D lettering supports up to 160 characters per object. Split longer text into layers.");
  if (text.layout && text.layout !== "point") throw new Error("3D lettering currently requires Point text. Frame, vertical and path layouts stay in the 2D editor.");
  if (text.runs?.length) throw new Error("3D lettering currently requires one character style. Use a separate text layer for mixed styles.");
  if (text.direction === "rtl" || /[\u0590-\u0dff\u200c\u200d]/u.test(text.text)) throw new Error("This mesh editor currently supports left-to-right lettering, not complex-script shaping.");
  const style = resolvedDefaultTextStyle(text);
  if (![style.fontSize, style.fontStretch, style.tracking, text.lineHeight, text.paragraphSpacing ?? 0].every(Number.isFinite)
    || style.fontSize < 1 || style.fontSize > 2000 || style.fontStretch < 50 || style.fontStretch > 200
    || style.tracking < -1000 || style.tracking > 5000 || text.lineHeight < 0.1 || text.lineHeight > 10
    || (text.paragraphSpacing ?? 0) < 0 || (text.paragraphSpacing ?? 0) > 10) throw new Error("Text dimensions exceed the supported 3D lettering limits.");
  return { style, selected: bundledFontFace(style.fontFamily, style.fontWeight, style.fontStyle !== "normal") };
}

export async function loadMeshFont(text: TextStyle) {
  const { selected } = validateMeshText(text);
  let entry = fontCache.get(selected.file);
  if (entry) { fontCache.delete(selected.file); fontCache.set(selected.file, entry); return entry; }
  entry = (async () => {
    const response = await fetch(`/fonts/${selected.file}`);
    if (!response.ok) throw new Error("Bundled font is unavailable. Reinstall the complete application.");
    if (Number(response.headers.get("content-length")) > TEXT_MESH_LIMITS.fontBytes) throw new Error("Font exceeds mesh memory budget.");
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > TEXT_MESH_LIMITS.fontBytes) throw new Error("Font exceeds mesh memory budget.");
    return parse(bytes);
  })();
  fontCache.set(selected.file, entry);
  while (fontCache.size > TEXT_MESH_LIMITS.cachedFonts) fontCache.delete(fontCache.keys().next().value!);
  try { return await entry; } catch (error) { fontCache.delete(selected.file); throw error; }
}

export function shapesFromGlyphPath(path: { commands: ReadonlyArray<OutlineCommand> }) {
  const shape = new THREE.ShapePath();
  for (const command of path.commands) {
    switch (command.type) {
      case "M": shape.moveTo(command.x, -command.y); break;
      case "L": shape.lineTo(command.x, -command.y); break;
      case "Q": shape.quadraticCurveTo(command.x1, -command.y1, command.x, -command.y); break;
      case "C": shape.bezierCurveTo(command.x1, -command.y1, command.x2, -command.y2, command.x, -command.y); break;
      case "Z": shape.currentPath?.closePath(); break;
    }
  }
  return shape.toShapes();
}

export function createTextMesh(text: TextStyle, spatial: SpatialLayerStyle, font: Font) {
  const { style } = validateMeshText(text);
  for (const character of text.text.replaceAll("\n", "")) {
    if (!font.charToGlyphIndex(character)) throw new Error(`The bundled font has no outline for “${character}”. Choose another font.`);
  }
  const size = Math.max(1, Math.min(2000, style.fontSize));
  const paths: Path[] = [];
  let commands = 0;
  text.text.split("\n").forEach((line, index) => {
    // Explicit left-to-right glyph layout avoids unsupported GSUB lookups in
    // otherwise valid bundled fonts. Contextual shaping remains a 2D feature.
    const glyphs = Array.from(line.normalize("NFC"), character => font.charToGlyph(character));
    const scale = size / font.unitsPerEm;
    const advances = glyphs.map((glyph, index) => ((glyph.advanceWidth ?? 0) + (style.features.kern !== false && glyphs[index + 1] ? font.getKerningValue(glyph, glyphs[index + 1]) : 0)) * scale + (index < glyphs.length - 1 ? style.tracking / 1000 * size : 0));
    const width = advances.reduce((sum, advance) => sum + advance, 0);
    const x = text.align === "center" ? -width / 2 : ["right", "end"].includes(text.align) ? -width : 0;
    const y = index * size * (text.lineHeight + (text.paragraphSpacing ?? 0));
    let cursor = x;
    for (const [index, glyph] of glyphs.entries()) {
      const path = glyph.getPath(cursor, y, size, {}, font);
      commands += path.commands.length;
      if (commands > TEXT_MESH_LIMITS.commands) throw new Error("Letter outlines exceed the mesh complexity budget. Use shorter text.");
      paths.push(path);
      cursor += advances[index];
    }
  });
  return meshFromPaths(text, spatial, paths);
}

/** Production lettering uses the same shaped outlines as editable vector delivery. */
export function createShapedTextMesh(text: TextStyle, spatial: SpatialLayerStyle, outlines: ShapedOutlines) {
  const { selected } = validateOutlineText(text);
  if (outlines.fontFile !== selected.file) throw new Error("Shaped font does not match the selected face.");
  return meshFromPaths(text, spatial, outlines.paths, true);
}

function meshFromPaths(text: TextStyle, spatial: SpatialLayerStyle, paths: { commands: ReadonlyArray<OutlineCommand> }[], alreadyStyled = false) {
  const { style, selected } = validateOutlineText(text);
  const size = style.fontSize;
  const shapes = paths.flatMap(shapesFromGlyphPath);
  if (!shapes.length) throw new Error("The text has no visible outlines.");
  const depth = Math.max(0, Math.min(1000, spatial.extrusion.depth));
  // Bevels are bounded relative to em/depth to prevent inverted, self-crossing walls.
  const bevel = Math.max(0, Math.min(spatial.extrusion.bevel, size * 0.08, depth / 2));
  const geometry = new THREE.ExtrudeGeometry(shapes, { depth, steps: 1, curveSegments: 5, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 2 });
  if (geometry.getAttribute("position").count > TEXT_MESH_LIMITS.vertices) { geometry.dispose(); throw new Error("The mesh exceeds the vertex budget. Reduce bevel or text length."); }
  if (!alreadyStyled && style.fontStretch !== 100) geometry.scale(style.fontStretch / 100, 1, 1);
  if (!alreadyStyled && style.fontStyle !== "normal" && !selected.italic) geometry.applyMatrix4(new THREE.Matrix4().makeShear(0, 0, 0.2, 0, 0, 0));
  geometry.center();
  geometry.computeBoundingSphere();
  const front = new THREE.MeshPhysicalMaterial();
  const side = new THREE.MeshPhysicalMaterial();
  const mesh = new THREE.Mesh(geometry, [front, side]);
  mesh.name = "Luma editable source lettering";
  mesh.userData.lumaTypography = structuredClone(text);
  mesh.userData.lumaSpatial = structuredClone(spatial);
  updateTextMesh(mesh, spatial);
  return mesh;
}

export function updateTextMesh(mesh: THREE.Mesh<THREE.ExtrudeGeometry, THREE.MeshPhysicalMaterial[]>, spatial: SpatialLayerStyle) {
  mesh.rotation.set(...[spatial.transform.rotationX, spatial.transform.rotationY, spatial.transform.rotationZ].map(THREE.MathUtils.degToRad) as [number, number, number]);
  mesh.material.forEach((material, index) => {
    material.color.set(index === 0 ? spatial.material.frontColor : spatial.material.sideColor);
    material.roughness = spatial.material.roughness;
    material.metalness = spatial.material.metalness;
    material.clearcoat = (1 - spatial.material.roughness) * 0.35;
  });
  mesh.userData.lumaSpatial = structuredClone(spatial);
}

export function disposeTextMesh(mesh: ReturnType<typeof createTextMesh>) {
  mesh.geometry.dispose(); mesh.material.forEach(material => material.dispose());
}
