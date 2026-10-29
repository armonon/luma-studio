import assert from "node:assert/strict";
import test from "node:test";
import "./canvas-harness.ts";
import { testCanvas } from "./canvas-harness.ts";
import { Studio } from "../app/engine/studio.ts";
import { BrushStrokePlanner, brushPointerPressure, smoothBrushPoint, replayStroke, replayStrokeFloat, type BrushParams, type BrushCoverageCache } from "../app/engine/brush.ts";

const params: BrushParams = { size: 12, hardness: 0.6, opacity: 0.45, flow: 0.2, color: "#ff0000", spacing: 0.12, mode: "paint", pressureSize: true, pressureOpacity: true };
const points = Array.from({ length: 80 }, (_, i) => ({ x: 5 + i * 0.6, y: 16 + Math.sin(i * 0.12) * 6, p: 0.2 + i / 100, tiltX: 20, azimuth: i * 0.02 }));

test("brush blend modes deposit source color on transparency, not a black fringe", () => {
  for (const blendMode of ["normal", "multiply", "screen", "overlay"] as const) {
    const brush = { ...params, size: 8, opacity: 1, flow: 1, hardness: 1, blendMode, pressureSize: false, pressureOpacity: false };
    const stroke = { layerId: "x", params: brush, points: [{ x: 4.5, y: 4.5, p: 1 }] };
    const bytes = new Uint8ClampedArray(8 * 8 * 4), floats = new Float32Array(bytes.length);
    replayStroke({ width: 8, height: 8, data: bytes }, stroke);
    replayStrokeFloat({ width: 8, height: 8, data: floats }, stroke, [1, 0, 0]);
    assert.deepEqual([...bytes.slice(144, 148)], [255, 0, 0, 255]);
    assert.deepEqual([...floats.slice(144, 148)], [1, 0, 0, 1]);
  }
});

test("incremental coverage equals complete replay for pressure, flow, image tips, erasing and blend modes", () => {
  for (const mode of ["paint", "erase"] as const) for (const buildUp of [true, false]) for (const image of [false, true]) for (const blendMode of ["normal", "multiply", "screen", "overlay"] as const) {
    const brush: BrushParams = { ...params, mode, buildUp, blendMode, scatter: 0.2, seed: 91, texture: { strength: 0.4, scale: 0.3 },
      imageTip: image ? { id: "test", name: "test", width: 2, height: 2, mode: "color", data: new Uint8ClampedArray([255,0,0,255, 0,255,0,128, 0,0,255,255, 255,255,255,0]) } : undefined };
    const base = new Float32Array(64 * 32 * 4);
    for (let i = 0; i < base.length; i += 4) base.set([1.5, 0.3, -0.1, 0.8], i);
    const expected = base.slice();
    replayStrokeFloat({ width: 64, height: 32, data: expected }, { layerId: "x", params: brush, points }, [1, 0, 0]);
    const actual = base.slice(), cache: BrushCoverageCache = {};
    const planner = new BrushStrokePlanner(brush);
    for (const point of points) {
      actual.set(base);
      replayStrokeFloat({ width: 64, height: 32, data: actual }, { layerId: "x", params: brush, points: [] }, [1, 0, 0], { dabs: planner.add(point), cache });
    }
    assert.deepEqual(actual, expected, `${mode}/${buildUp}/${image}/${blendMode}`);
  }
});

test("pen zero and half pressure survive; mouse paints at full force; smoothing preserves pressure", () => {
  assert.equal(brushPointerPressure({ pointerType: "pen", pressure: 0 }), 0);
  assert.equal(brushPointerPressure({ pointerType: "pen", pressure: 0.5 }), 0.5);
  assert.equal(brushPointerPressure({ pointerType: "mouse", pressure: 0.5 }), 1);
  assert.equal(brushPointerPressure({ pointerType: "pen", pressure: NaN }), 1);
  const start = { x: 0, y: 0, p: 1, time: 0 };
  const one = smoothBrushPoint(start, { x: 10, y: 0, p: 0, time: 16 }, 0.8);
  const half = smoothBrushPoint(start, { x: 10, y: 0, p: 0.5, time: 8 }, 0.8);
  const two = smoothBrushPoint(half, { x: 10, y: 0, p: 0, time: 16 }, 0.8);
  assert.ok(Math.abs(one.x - two.x) < 1e-10);
  assert.equal(one.p, 0);
});

test("planner rejects malformed or excessive samples instead of allocating an unbounded dab list", () => {
  const planner = new BrushStrokePlanner({ ...params, size: 1, spacing: 0.01 });
  assert.throws(() => planner.add({ x: NaN, y: 0, p: 1 }), /Invalid brush/);
  planner.start({ x: 0, y: 0, p: 1 });
  assert.throws(() => planner.add({ x: 1e12, y: 0, p: 1 }), /dab limit/);
});

test("live precision strokes read each original tile once, preserve parameters and undo in one step", () => {
  const studio = new Studio(64, 32, testCanvas(64, 32));
  try {
    const layer = studio.addBlankRaster("brush");
    const store = layer.surface!.store;
    const originalRead = store.read.bind(store);
    let reads = 0;
    store.read = key => { reads++; return originalRead(key); };
    studio.beginStroke(layer.id, params, points[0]);
    for (const point of points.slice(1)) studio.paintTo(layer.id, { ...params, color: "#0000ff", opacity: 1 }, point);
    assert.equal(reads, 1, "one original capture, not one full replay per sample");
    const key = layer.surface!.grid.tilesIntersecting({ x: 0, y: 0, width: 64, height: 32 })[0].key;
    const expected = new Float32Array(64 * 32 * 4);
    replayStrokeFloat({ width: 64, height: 32, data: expected }, { layerId: layer.id, params, points }, [1, 0, 0]);
    // Quantize expected through the same document storage format.
    const result = layer.surface!.tileToWorkingFloat32(key);
    layer.surface!.writeWorkingFloat32Tile(key, expected);
    assert.deepEqual(result, layer.surface!.tileToWorkingFloat32(key));
    studio.endStroke(layer.id, params);
    studio.undo();
    assert.equal(layer.surface!.store.read(key), null);
    studio.redo();
    assert.deepEqual(layer.surface!.tileToWorkingFloat32(key), result);
  } finally { studio.dispose(); }
});

test("cancel, wrong-layer samples and document switching cannot leak a stroke into another target", () => {
  const studio = new Studio(32, 32, testCanvas(32, 32));
  try {
    const first = studio.addBlankRaster("first"), second = studio.addBlankRaster("second");
    const before = first.surface!.stats().residentTiles;
    studio.beginStroke(first.id, params, { x: 8, y: 8, p: 1 });
    studio.paintTo(second.id, params, { x: 20, y: 20, p: 1 });
    assert.equal(second.surface!.stats().residentTiles, 0);
    studio.cancelStroke();
    assert.equal(first.surface!.stats().residentTiles, before);
    studio.beginStroke(first.id, params, { x: 8, y: 8, p: 1 });
    const previous = studio.activeDocumentState().id;
    studio.resetDocument(16, 16, "new");
    studio.endStroke(first.id, params);
    studio.switchDocument(previous);
    assert.equal(first.surface!.stats().residentTiles, before);
  } finally { studio.dispose(); }
});

test("oversized stroke admission rolls back earlier paint and leaves the document usable", () => {
  const studio = new Studio(50000, 50000, testCanvas(16, 16));
  try {
    const layer = studio.addBlankRaster("large");
    const brush = { ...params, size: 4096, pressureSize: false, pressureOpacity: false };
    assert.throws(() => studio.beginStroke(layer.id, brush, { x: 8000, y: 8000, p: 1 }), /working-set limit/);
    assert.equal(layer.surface!.stats().residentTiles, 0);
    studio.beginStroke(layer.id, params, { x: 8, y: 8, p: 1 });
    assert.throws(() => studio.paintTo(layer.id, params, { x: Infinity, y: 10, p: 1 }), /Invalid brush/);
    assert.equal(layer.surface!.stats().residentTiles, 0);
    studio.beginStroke(layer.id, params, { x: 10, y: 10, p: 1 });
    studio.endStroke(layer.id, params);
    assert.ok(layer.surface!.stats().residentTiles > 0);
  } finally { studio.dispose(); }
});

test("continuing a long stroke does not rewrite tiles already left behind", () => {
  const studio = new Studio(2048, 32, testCanvas(64, 32));
  try {
    const layer = studio.addBlankRaster("long stroke");
    const surface = layer.surface!;
    const write = surface.writeWorkingFloat32Tile.bind(surface);
    const written: string[] = [];
    surface.writeWorkingFloat32Tile = (key, values) => { written.push(key); write(key, values); };
    studio.beginStroke(layer.id, params, { x: 16, y: 16, p: 1 });
    studio.paintTo(layer.id, params, { x: 1900, y: 16, p: 1 });
    written.length = 0;
    studio.paintTo(layer.id, params, { x: 1910, y: 16, p: 1 });
    assert.ok(written.length > 0);
    assert.ok(written.every(key => surface.grid.parseKey(key).x > 1500));
    studio.endStroke(layer.id, params);
  } finally { studio.dispose(); }
});

test("mask flow is capped across the whole stroke and cancellation restores mask absence", () => {
  const studio = new Studio(64, 32, testCanvas(64, 32));
  try {
    const layer = studio.addBlankRaster("mask");
    const brush: BrushParams = { ...params, mode: "mask-remove", pressureSize: false, pressureOpacity: false };
    studio.beginStroke(layer.id, brush, points[0]);
    for (const point of points.slice(1)) studio.paintTo(layer.id, brush, point);
    const key = layer.maskSurface!.grid.tilesIntersecting({ x: 0, y: 0, width: 64, height: 32 })[0].key;
    const result = layer.maskSurface!.readTile(key);
    assert.ok(result.some(alpha => alpha < 255));
    assert.ok(result.every(alpha => alpha >= 140), "45% opacity must not erase beyond its cap");
    studio.cancelStroke();
    assert.equal(layer.maskSurface, undefined);
    studio.beginStroke(layer.id, brush, points[0]);
    for (const point of points.slice(1)) studio.paintTo(layer.id, brush, point);
    studio.endStroke(layer.id, brush);
    studio.undo();
    assert.ok(layer.maskSurface!.readTile(key).every(alpha => alpha === 255));
    studio.redo();
    assert.deepEqual(layer.maskSurface!.readTile(key), result);
  } finally { studio.dispose(); }
});

test("pointer-up completes the smoothed tail and masks stay sparse at extreme dimensions", () => {
  const studio = new Studio(50000, 50000, testCanvas(16, 16));
  try {
    const layer = studio.addBlankRaster("sparse");
    const brush: BrushParams = { ...params, mode: "mask-remove", smoothing: 0.9 };
    studio.beginStroke(layer.id, brush, { x: 25000, y: 25000, p: 1, time: 1 });
    studio.paintTo(layer.id, brush, { x: 25100, y: 25000, p: 1, time: 17 });
    studio.endStroke(layer.id, brush, { x: 25120, y: 25000, p: 1, time: 25 });
    assert.ok(layer.maskSurface!.stats().residentBytes < 1_000_000);
    assert.ok(layer.maskSurface!.readRegion({ x: 25118, y: 24999, width: 2, height: 2 }).some(value => value < 255));
  } finally { studio.dispose(); }
});

test('idle quality recovery waits for brush completion and cancellation', () => {
  const g=globalThis as unknown as Record<string,unknown>,oldWindow=g.window,oldRaf=g.requestAnimationFrame;
  const timers=new Map<number,{run:()=>void;delay:number}>();let id=0;
  g.window={setTimeout:(run:()=>void,delay:number)=>{timers.set(++id,{run,delay});return id;},clearTimeout:(key:number)=>timers.delete(key)};
  g.requestAnimationFrame=()=>1;
  const studio=new Studio(32,32,testCanvas(32,32));
  type PreviewInternals={renderGovernor:{record:(time:number,workload:string)=>boolean;scale:number};scheduleFullQualityPreview:()=>void};
  const preview=studio as unknown as PreviewInternals;
  const idle=()=>{const entries=[...timers].filter(([,t])=>t.delay===180);assert.ok(entries.length);for(const [key,t]of entries){timers.delete(key);t.run();}};
  try{
    const layer=studio.addBlankRaster("Timed gesture");studio.beginStroke(layer.id,params,{x:5,y:5,p:.5});preview.renderGovernor.record(100,'interactive');preview.renderGovernor.record(100,'interactive');assert.equal(preview.renderGovernor.scale,.85);preview.scheduleFullQualityPreview();idle();assert.equal(preview.renderGovernor.scale,.85,'pause with pointer held retains responsive preview');
    studio.endStroke(layer.id,params,{x:10,y:10,p:.5});idle();assert.equal(preview.renderGovernor.scale,1,'finished stroke restores full quality');
    studio.beginStroke(layer.id,params,{x:6,y:6,p:.5});preview.renderGovernor.record(100,'interactive');preview.renderGovernor.record(100,'interactive');studio.cancelStroke();idle();assert.equal(preview.renderGovernor.scale,1,'cancel also restores full preview');
  }finally{studio.dispose();g.window=oldWindow;g.requestAnimationFrame=oldRaf;}
});
