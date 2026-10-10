import assert from "node:assert/strict";
import test from "node:test";
import { DOMParser, type Element as XmlElement } from "@xmldom/xmldom";
import { loadImage } from "@napi-rs/canvas";
import "./canvas-harness.ts";
import { testCanvas } from "./canvas-harness.ts";
import { Studio } from "../app/engine/studio.ts";
import { createTextLayer, drawLayerContent, type Layer, type PathStyle } from "../app/engine/document.ts";
import {
  cssBlendFor,
  num,
  parseCanvasFont,
  serializeFigmaSvg,
  svgColor,
  SvgRecordingContext,
  type FigmaLayerNode,
} from "../app/engine/figma-svg.ts";
import { buildFigmaSvg } from "../app/engine/figma-export.ts";

const parse = (svg: string) => {
  const errors: string[] = [];
  const doc = new DOMParser({ onError: (level: string, message: string) => { if (level !== "warning") errors.push(message); } }).parseFromString(svg, "image/svg+xml");
  assert.deepEqual(errors, [], "the SVG must be well-formed XML");
  return doc;
};
const elementChildren = (node: XmlElement) => (Array.from(node.childNodes as unknown as ArrayLike<XmlElement>)).filter(child => child.nodeType === 1);
const topGroups = (svg: string) => {
  const root = parse(svg).documentElement!;
  return elementChildren(root).filter(node => node.tagName === "g");
};

/** Paint a raster layer directly and drop the tile master so bitmap is the source. */
function paint(layer: Layer, draw: (ctx: CanvasRenderingContext2D) => void) {
  draw(layer.bitmap!.getContext("2d")!);
  layer.surface = undefined;
}

test("serializer writes one group per layer, bottom layer first, with the canvas as artboard", () => {
  const layers: FigmaLayerNode[] = [
    { name: "Top & <title>", kind: "shape", opacity: 0.5, blend: "multiply", content: [{ tag: "rect", x: 1, y: 2, width: 3, height: 4, fill: { color: "#ff0000", opacity: 1 } }] },
    { name: "Middle", kind: "group", opacity: 1, blend: "normal", isolate: true, children: [
      { name: "Child top", kind: "path", opacity: 1, blend: "normal", content: [{ tag: "path", d: "M0 0 L1 1 Z", fill: { color: "#00ff00", opacity: 0.25 } }] },
      { name: "Child bottom", kind: "raster", opacity: 1, blend: "screen", content: [{ tag: "image", x: 0, y: 0, width: 2, height: 2, href: "data:image/png;base64,AAAA", matrix: { a: 2, b: 0, c: 0, d: 2, e: 5, f: 6 } }] },
    ] },
    { name: "Middle", kind: "raster", opacity: 1, blend: "normal", content: [] },
  ];
  const svg = serializeFigmaSvg({ width: 640, height: 480, title: "Poster" }, layers);
  const root = parse(svg).documentElement!;
  assert.equal(root.getAttribute("width"), "640");
  assert.equal(root.getAttribute("height"), "480");
  assert.equal(root.getAttribute("viewBox"), "0 0 640 480");
  assert.equal(root.getAttribute("xmlns:xlink"), "http://www.w3.org/1999/xlink");
  // Bottom first, names unique, and nested order also reversed.
  assert.deepEqual(topGroups(svg).map(g => g.getAttribute("id")), ["Middle 2", "Middle", "Top & <title>"]);
  const middle = topGroups(svg)[1];
  assert.equal(middle.getAttribute("style"), "isolation:isolate");
  const nested = elementChildren(middle);
  assert.deepEqual(nested.map(g => g.getAttribute("id")), ["Child bottom", "Child top"]);
  assert.equal(nested[0].getAttribute("style"), "mix-blend-mode:screen");
  const image = nested[0].getElementsByTagName("image")[0];
  assert.equal(image.getAttribute("transform"), "matrix(2 0 0 2 5 6)");
  assert.equal(image.getAttribute("xlink:href"), "data:image/png;base64,AAAA");
  const top = topGroups(svg)[2];
  assert.equal(top.getAttribute("opacity"), "0.5");
  assert.equal(top.getAttribute("style"), "mix-blend-mode:multiply");
  assert.equal(nested[1].getElementsByTagName("path")[0].getAttribute("fill-opacity"), "0.25");
});

test("numbers, colors, fonts and blend modes serialize safely", () => {
  assert.equal(num(-0.00001), "0");
  assert.equal(num(1e-7), "0");
  assert.equal(num(12.5), "12.5");
  assert.equal(num(1234567.123456), "1234567.1235");
  assert.throws(() => num(Number.NaN));
  assert.deepEqual(svgColor("#abc"), { color: "#aabbcc", opacity: 1 });
  assert.deepEqual(svgColor("rgba(0,0,0,0.9)"), { color: "#000000", opacity: 0.9 });
  assert.deepEqual(svgColor("rgb(255 128 0 / 50%)"), { color: "#ff8000", opacity: 0.5 });
  assert.equal(svgColor("transparent"), null);
  assert.deepEqual(parseCanvasFont('italic 700 96px "Lato", sans-serif'), { family: '"Lato", sans-serif', size: 96, weight: 700, style: "italic" });
  assert.deepEqual(parseCanvasFont("bold 12.5px Inter"), { family: "Inter", size: 12.5, weight: 700, style: "normal" });
  assert.deepEqual(cssBlendFor("source-over"), { blend: "normal", exact: true });
  assert.deepEqual(cssBlendFor("multiply"), { blend: "multiply", exact: true });
  assert.deepEqual(cssBlendFor("linear-dodge"), { blend: "plus-lighter", exact: true });
  assert.equal(cssBlendFor("vivid-light").exact, false);
});

test("text is recorded from Luma's own text drawing: lines, alignment, tracking and font", () => {
  const layer = createTextLayer("Hello", {
    text: "Hello\nWorld", font: "600 40px Inter, sans-serif", color: "#112233", align: "center", lineHeight: 1.5, x: 100, y: 80, tracking: 50,
  });
  layer.transform = { tx: 10, ty: 20, sx: 1, sy: 1, rotation: 0, skewX: 0 };
  const recorder = new SvgRecordingContext(testCanvas(1, 1).getContext("2d"));
  drawLayerContent(recorder.asContext(), layer);
  assert.equal(recorder.unsupported, null);
  assert.equal(recorder.elements.length, 1, "both lines share one <text> element");
  const text = recorder.elements[0];
  assert.equal(text.tag, "text");
  if (text.tag !== "text") return;
  assert.deepEqual(text.font, { family: "Inter, sans-serif", size: 40, weight: 600, style: "normal" });
  assert.deepEqual(text.fill, { color: "#112233", opacity: 1 });
  assert.equal(text.anchor, "middle");
  assert.equal(text.letterSpacing, 2); // 50/1000 em at 40px
  assert.deepEqual(text.matrix, { a: 1, b: 0, c: 0, d: 1, e: 10, f: 20 });
  // Centered tracking is nudged by half a step exactly like the canvas path.
  assert.deepEqual(text.spans, [{ text: "Hello", x: 101, y: 80 }, { text: "World", x: 101, y: 140 }]);
  const svg = serializeFigmaSvg({ width: 200, height: 200 }, [{ name: "Hello", kind: "text", opacity: 1, blend: "normal", content: recorder.elements }]);
  const node = parse(svg).getElementsByTagName("text")[0];
  assert.equal(node.getAttribute("font-family"), "Inter, sans-serif");
  assert.equal(node.getAttribute("font-weight"), "600");
  assert.equal(node.getAttribute("text-anchor"), "middle");
  assert.equal(node.getAttribute("xml:space"), "preserve");
  assert.equal(node.getElementsByTagName("tspan").length, 2);
  assert.equal(node.textContent, "HelloWorld");
});

test("the recorder refuses what plain SVG cannot hold instead of guessing", () => {
  const clip = new SvgRecordingContext(null);
  clip.rect(0, 0, 1, 1); clip.clip();
  assert.equal(clip.unsupported, "clip");
  const gradient = new SvgRecordingContext(null);
  gradient.fillStyle = gradient.createLinearGradient();
  assert.equal(gradient.unsupported, "gradient");
  const shadow = new SvgRecordingContext(null);
  shadow.shadowColor = "#000"; shadow.shadowBlur = 4; shadow.rect(0, 0, 2, 2); shadow.fill();
  assert.equal(shadow.unsupported, "shadow");
  assert.equal(shadow.elements.length, 0);
  const measureless = new SvgRecordingContext(null);
  measureless.measureText("x");
  assert.equal(measureless.unsupported, "text measurement unavailable");
});

test("recorded arcs stay on the circle and paths keep the current transform", () => {
  const recorder = new SvgRecordingContext(null);
  recorder.translate(50, 50);
  recorder.scale(2, 1);
  recorder.beginPath();
  recorder.arc(0, 0, 10, 0, Math.PI * 2);
  recorder.fillStyle = "#ff0000";
  recorder.fill();
  const path = recorder.elements[0];
  assert.equal(path.tag, "path");
  if (path.tag !== "path") return;
  assert.deepEqual(path.matrix, { a: 2, b: 0, c: 0, d: 1, e: 50, f: 50 });
  const values = path.d.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
  // 4 cubic segments; check each segment midpoint lies on r=10 within 0.03.
  const start = { x: values[0], y: values[1] };
  assert.ok(Math.abs(Math.hypot(start.x, start.y) - 10) < 1e-6);
  let previous = start;
  for (let i = 2; i + 5 < values.length; i += 6) {
    const [x1, y1, x2, y2, x, y] = values.slice(i, i + 6);
    const mx = 0.125 * previous.x + 0.375 * x1 + 0.375 * x2 + 0.125 * x;
    const my = 0.125 * previous.y + 0.375 * y1 + 0.375 * y2 + 0.125 * y;
    assert.ok(Math.abs(Math.hypot(mx, my) - 10) < 0.03, `midpoint radius ${Math.hypot(mx, my)}`);
    previous = { x, y };
  }
});

function buildSampleStudio() {
  const studio = new Studio(160, 120, testCanvas(160, 120));
  const background = studio.addBlankRaster("Background");
  paint(background, ctx => { ctx.fillStyle = "#e8e0d0"; ctx.fillRect(0, 0, 160, 120); ctx.fillStyle = "#3355aa"; ctx.fillRect(10, 70, 60, 40); });
  const card = studio.addShapeLayer({ kind: "rect", x: 20, y: 15, w: 70, h: 40, fill: "#d95f32", stroke: "#202020", strokeWidth: 3, radius: 8 });
  card.name = "Card";
  const dot = studio.addShapeLayer({ kind: "ellipse", x: 100, y: 20, w: 40, h: 30, fill: "#20a060", stroke: "none", strokeWidth: 0, radius: 0 });
  dot.name = "Dot";
  dot.blend = "multiply";
  dot.opacity = 0.8;
  const path: PathStyle = {
    anchors: [
      { x: 90, y: 100, hIn: { dx: 0, dy: 0 }, hOut: { dx: 10, dy: -30 } },
      { x: 150, y: 100, hIn: { dx: -10, dy: -30 }, hOut: { dx: 0, dy: 0 } },
    ],
    closed: true, fill: "#7744cc", stroke: "#000000", strokeWidth: 2,
  };
  const wave = studio.addPathLayer(path, "Wave");
  const shadowed = studio.addShapeLayer({ kind: "rect", x: 110, y: 60, w: 30, h: 20, fill: "#ffffff", stroke: "none", strokeWidth: 0, radius: 0 });
  shadowed.name = "Shadowed";
  studio.addDropShadow(shadowed.id);
  const group = studio.groupLayers([card.id, dot.id]);
  group.name = "Badge";
  group.opacity = 0.9;
  return { studio, background, card, dot, wave, shadowed, group };
}

test("buildFigmaSvg keeps editable layers editable and flattens effects, in stacking order", () => {
  const { studio } = buildSampleStudio();
  const { svg, report } = buildFigmaSvg(studio.doc, { title: "Sample" });
  const groups = topGroups(svg);
  assert.deepEqual(groups.map(g => g.getAttribute("id")), ["Background", "Wave", "Badge", "Shadowed"].sort((a, b) => order(a) - order(b)));
  function order(name: string) { return studio.doc.layers.length - studio.doc.layers.findIndex(l => l.name === name && !l.parentId); }
  const byId = new Map(groups.map(g => [g.getAttribute("id"), g]));
  assert.equal(byId.get("Background")!.getElementsByTagName("image").length, 1);
  assert.equal(byId.get("Wave")!.getElementsByTagName("path").length, 2, "fill and stroke are real paths");
  const badge = byId.get("Badge")!;
  assert.equal(badge.getAttribute("opacity"), "0.9");
  assert.equal(badge.getAttribute("style"), "isolation:isolate");
  const card = badge.getElementsByTagName("rect")[0];
  assert.equal(card.getAttribute("rx"), "8");
  assert.equal(card.getAttribute("fill"), "#d95f32");
  assert.equal(card.getAttribute("stroke-width"), "3");
  const dotGroup = Array.from(badge.getElementsByTagName("g") as unknown as ArrayLike<XmlElement>).find(g => g.getAttribute("id") === "Dot")!;
  assert.equal(dotGroup.getAttribute("style"), "mix-blend-mode:multiply");
  assert.equal(dotGroup.getAttribute("opacity"), "0.8");
  assert.equal(dotGroup.getElementsByTagName("ellipse").length, 1);
  const shadowed = byId.get("Shadowed")!;
  assert.equal(shadowed.getAttribute("data-luma-flattened"), "layer effects");
  assert.equal(shadowed.getElementsByTagName("image").length, 1);
  assert.deepEqual(report.flattened, [{ name: "Shadowed", reason: "layer effects" }]);
  assert.equal(report.editable, 5);
  assert.equal(report.approximated.length, 0);
  // The document itself is untouched by the subset rendering.
  assert.ok(studio.doc.layers.every(l => l.visible));
  assert.equal(studio.doc.layers.find(l => l.name === "Shadowed")!.opacity, 1);
  studio.dispose();
});

test("adjustment layers merge with what they change, hidden layers are skipped", () => {
  const studio = new Studio(40, 30, testCanvas(40, 30));
  const base = studio.addBlankRaster("Photo");
  paint(base, ctx => { ctx.fillStyle = "#808080"; ctx.fillRect(0, 0, 40, 30); });
  studio.addAdjustmentLayer("Brighten", { exposure: 1 });
  const hidden = studio.addShapeLayer({ kind: "rect", x: 0, y: 0, w: 10, h: 10, fill: "#ff0000", stroke: "none", strokeWidth: 0, radius: 0 });
  hidden.visible = false;
  const top = studio.addShapeLayer({ kind: "rect", x: 5, y: 5, w: 10, h: 10, fill: "#0000ff", stroke: "none", strokeWidth: 0, radius: 0 });
  top.name = "Blue";
  const { svg, report } = buildFigmaSvg(studio.doc);
  assert.deepEqual(topGroups(svg).map(g => g.getAttribute("id")), ["Brighten (merged with layers below)", "Blue"]);
  assert.equal(report.hiddenSkipped, 1);
  assert.match(report.flattened[0].reason, /adjustment layer merged with 1 layer below/);
  studio.dispose();
});

async function rasterizeSvg(svg: string, width: number, height: number) {
  // Skia's SVG module, independent of Luma's compositor and of this serializer.
  const image = await loadImage(Buffer.from(svg));
  const canvas = testCanvas(width, height);
  canvas.getContext("2d")!.drawImage(image as unknown as CanvasImageSource, 0, 0, width, height);
  return canvas.getContext("2d")!.getImageData(0, 0, width, height).data;
}

async function pngPixels(blob: Blob, width: number, height: number) {
  const image = await loadImage(new Uint8Array(await blob.arrayBuffer()));
  const canvas = testCanvas(width, height);
  canvas.getContext("2d")!.drawImage(image as unknown as CanvasImageSource, 0, 0);
  return canvas.getContext("2d")!.getImageData(0, 0, width, height).data;
}

test("rasterized SVG matches Luma's own PNG export within tolerance (vector layers, groups, opacity, blend)", async () => {
  // Skia's SVG module (used by @napi-rs/canvas) does not load data: URL
  // images, so the embedded-raster path is compared in headless Chrome and
  // resvg instead (scripts/verify-figma-export.mjs). Text is covered there
  // too, because Node canvas and Skia SVG resolve system fonts differently.
  // Skia SVG also ignores mix-blend-mode, so the multiply layer here sits on
  // transparency; blend over content is compared in Chrome/resvg as well.
  const { studio, background, shadowed } = buildSampleStudio();
  background.visible = false;
  shadowed.visible = false;
  const { svg } = buildFigmaSvg(studio.doc);
  const reference = await pngPixels(await studio.exportImage("image/png"), 160, 120);
  const actual = await rasterizeSvg(svg, 160, 120);
  let mismatched = 0, worst = 0;
  for (let i = 0; i < reference.length; i += 4) {
    const delta = Math.max(...[0, 1, 2, 3].map(c => Math.abs(reference[i + c] - actual[i + c])));
    worst = Math.max(worst, delta);
    if (delta > 24) mismatched += 1;
  }
  const fraction = mismatched / (160 * 120);
  // Anti-aliased edges differ between renderers; bulk pixels must agree.
  assert.ok(fraction < 0.02, `${(fraction * 100).toFixed(2)}% of pixels differ by more than 24 (worst ${worst})`);
  studio.dispose();
});

test("Studio.exportFigmaSvg outlines bundled text when asked and reports what stayed live", async () => {
  const studio = new Studio(200, 100, testCanvas(200, 100));
  const text = studio.addTextLayer("Hi", { x: 10, y: 60 });
  text.name = "Headline";
  const outline = async () => ({
    paths: [{ commands: [{ type: "M" as const, x: 0, y: 0 }, { type: "L" as const, x: 20, y: 0 }, { type: "L" as const, x: 20, y: -30 }, { type: "Z" as const }] }],
    glyphs: [1], lineWidths: [20], fontFile: "test.ttf",
  });
  const outlined = await studio.exportFigmaSvg({ outlineText: true, computeOutlines: outline });
  assert.equal(outlined.report.textOutlined, 1);
  const svg = await outlined.blob.text();
  const group = topGroups(svg)[0];
  assert.equal(group.getAttribute("id"), "Headline");
  assert.equal(group.getElementsByTagName("text").length, 0);
  assert.match(group.getElementsByTagName("path")[0].getAttribute("d")!, /^M10 60 C/);
  const live = await studio.exportFigmaSvg();
  assert.equal(live.report.textAsText, 1);
  assert.equal(topGroups(await live.blob.text())[0].getElementsByTagName("text").length, 1);
  const failing = await studio.exportFigmaSvg({ outlineText: true, computeOutlines: async () => { throw new Error("font not bundled"); } });
  assert.deepEqual(failing.report.approximated, [{ name: "Headline", reason: "kept as live text: font not bundled" }]);
  studio.dispose();
});
