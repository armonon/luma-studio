/**
 * Writes a .luma fixture that exercises every Figma-export path: an embedded
 * raster (transformed), shapes, a curved path, live text (point + paragraph
 * with tracking and centre alignment), a multiply blend over content, a
 * group with opacity, a layer with a drop shadow, and an adjustment layer.
 *
 *   npx tsx build/figma-export-fixture.ts artifacts/figma-export/fixture.luma
 *
 * build/verify-figma-export.mjs opens it in the real studio, exports PNG and
 * "Export for Figma", and compares the two.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import "../tests/canvas-harness.ts";
import { testCanvas } from "../tests/canvas-harness.ts";
import { Studio } from "../app/engine/studio.ts";
import { encodeLumaProject } from "../app/engine/project.ts";

const output = resolve(process.argv[2] ?? "artifacts/figma-export/fixture.luma");
const studio = new Studio(480, 320, testCanvas(480, 320));

const background = studio.addBlankRaster("Paper");
{
  const ctx = background.bitmap!.getContext("2d")!;
  const gradient = ctx.createLinearGradient(0, 0, 480, 320);
  gradient.addColorStop(0, "#f3ead8");
  gradient.addColorStop(1, "#d8c6a8");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 480, 320);
  background.surface = undefined;
}

const photo = studio.addBlankRaster("Photo");
{
  photo.bitmap!.width = 120; photo.bitmap!.height = 90;
  const ctx = photo.bitmap!.getContext("2d")!;
  for (let y = 0; y < 90; y += 10) for (let x = 0; x < 120; x += 10) {
    ctx.fillStyle = `hsl(${(x * 3 + y * 2) % 360} 70% 55%)`;
    ctx.fillRect(x, y, 10, 10);
  }
  photo.surface = undefined;
  photo.transform = { tx: 300, ty: 40, sx: 1.25, sy: 1.25, rotation: 0.2, skewX: 0 };
}

const card = studio.addShapeLayer({ kind: "rect", x: 30, y: 30, w: 200, h: 120, fill: "#1f3a5f", stroke: "#f2c14e", strokeWidth: 6, radius: 18 });
card.name = "Card";
const sun = studio.addShapeLayer({ kind: "ellipse", x: 170, y: 60, w: 110, h: 110, fill: "#e4572e", stroke: "none", strokeWidth: 0, radius: 0 });
sun.name = "Sun (multiply)";
sun.blend = "multiply";
sun.opacity = 0.85;

const wave = studio.addPathLayer({
  anchors: [
    { x: 20, y: 300, hIn: { dx: 0, dy: 0 }, hOut: { dx: 80, dy: -90 } },
    { x: 240, y: 260, hIn: { dx: -60, dy: 30 }, hOut: { dx: 60, dy: -30 } },
    { x: 460, y: 300, hIn: { dx: -80, dy: -60 }, hOut: { dx: 0, dy: 0 } },
  ],
  closed: true, fill: "#2a9d8f", stroke: "#264653", strokeWidth: 4,
}, "Wave");

const title = studio.addTextLayer("Luma to Figma", { x: 40, y: 110, font: '700 34px "Lato", sans-serif', color: "#ffffff" });
title.name = "Title";
const body = studio.addTextLayer("Layers stay layers\nText stays text", {
  x: 240, y: 205, font: '400 20px "Lato", sans-serif', color: "#1d1d1d", align: "center", lineHeight: 1.3, tracking: 40,
});
body.name = "Body copy";

const badge = studio.addShapeLayer({ kind: "rect", x: 360, y: 200, w: 90, h: 40, fill: "#ffffff", stroke: "none", strokeWidth: 0, radius: 6 });
badge.name = "Badge (shadow)";
studio.addDropShadow(badge.id);

const group = studio.groupLayers([card.id, sun.id, title.id]);
group.name = "Hero";
group.opacity = 0.95;

const encoded = await encodeLumaProject(studio.doc, [], "Figma export fixture");
await mkdir(dirname(output), { recursive: true });
await writeFile(output, new Uint8Array(await encoded.arrayBuffer()));
console.log(`wrote ${output} (${encoded.size} bytes, ${studio.doc.layers.length} layers)`);
studio.dispose();
