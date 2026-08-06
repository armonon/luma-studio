import assert from "node:assert/strict";
import test from "node:test";
import {
  BrushStrokePlanner,
  evaluatePressureCurve,
  planStroke,
  replayStroke,
  type BrushParams,
  type RgbaSurface,
} from "../app/engine/brush.ts";

const base: BrushParams = {
  size: 10,
  hardness: 1,
  opacity: 1,
  flow: 1,
  color: "#804020",
  spacing: 0.25,
  pressureSize: false,
  pressureOpacity: false,
  mode: "paint",
};

function surface(width = 24, height = 24, fill?: [number, number, number, number]): RgbaSurface {
  const data = new Uint8ClampedArray(width * height * 4);
  if (fill) {
    for (let offset = 0; offset < data.length; offset += 4) data.set(fill, offset);
  }
  return { width, height, data };
}

function pixel(target: RgbaSurface, x: number, y: number) {
  return [...target.data.slice((y * target.width + x) * 4, (y * target.width + x) * 4 + 4)];
}

test("spacing carry makes pointer packetization irrelevant on a linear stroke", () => {
  const direct = planStroke([{ x: 0, y: 0, p: 1 }, { x: 10, y: 0, p: 1 }], base);
  const packetized = planStroke([
    { x: 0, y: 0, p: 1 },
    { x: 4, y: 0, p: 1 },
    { x: 7, y: 0, p: 1 },
    { x: 10, y: 0, p: 1 },
  ], base);
  assert.deepEqual(direct.map((dab) => dab.x), [0, 2.5, 5, 7.5, 10]);
  assert.deepEqual(packetized.map((dab) => dab.x), direct.map((dab) => dab.x));

  const planner = new BrushStrokePlanner(base);
  planner.start({ x: 0, y: 0, p: 1 });
  planner.add({ x: 4, y: 0, p: 1 });
  assert.equal(planner.snapshot().distanceToNext, 1);
});

test("pressure curves, tilt, and azimuth deterministically shape dabs", () => {
  assert.equal(evaluatePressureCurve(0.5, 2), 0.25);
  assert.equal(evaluatePressureCurve(0.5, [
    { input: 0, output: 0 },
    { input: 0.5, output: 0.8 },
    { input: 1, output: 1 },
  ]), 0.8);
  const [dab] = planStroke([{ x: 10, y: 10, p: 0.5, tiltX: 90, azimuth: Math.PI / 2 }], {
    ...base,
    size: 100,
    pressureSize: true,
    pressureOpacity: true,
    pressureCurve: 2,
    minimumPressureSize: 0.2,
    tiltInfluence: 1,
    roundness: 1,
    flow: 0.8,
  });
  assert.equal(dab.size, 40);
  assert.equal(dab.opacity, 0.2);
  assert.ok(Math.abs(dab.rotation - Math.PI / 2) < 1e-9);
  assert.ok(Math.abs(dab.roundness - 0.15) < 1e-9);
});

test("seeded scatter, texture identity, and replay are deterministic", () => {
  const params: BrushParams = {
    ...base,
    seed: 42,
    scatter: 0.8,
    texture: { strength: 0.7, scale: 0.4, seed: 9 },
  };
  const points = [{ x: 3, y: 3, p: 1 }, { x: 20, y: 20, p: 1 }];
  assert.deepEqual(planStroke(points, params), planStroke(points, params));
  assert.notDeepEqual(planStroke(points, params), planStroke(points, { ...params, seed: 43 }));

  const first = surface();
  const second = surface();
  const stroke = { layerId: "layer", params, points, seed: 101 };
  replayStroke(first, stroke);
  replayStroke(second, stroke);
  assert.deepEqual(first.data, second.data);
});

test("horizontal and radial symmetry emits unique transformed dabs", () => {
  const dabs = planStroke([{ x: 14, y: 10, p: 1 }], {
    ...base,
    symmetry: { centerX: 10, centerY: 10, horizontal: true, radialSegments: 2 },
  });
  const positions = dabs.map((dab) => `${dab.x.toFixed(1)},${dab.y.toFixed(1)}`).sort();
  assert.deepEqual(positions, ["14.0,10.0", "6.0,10.0"]);
});

test("flow accumulates per dab while stroke opacity remains a final cap", () => {
  const one = surface();
  replayStroke(one, {
    layerId: "layer",
    params: { ...base, size: 8, opacity: 0.5, flow: 0.2 },
    points: [{ x: 10.5, y: 10.5, p: 1 }],
  });
  assert.ok(Math.abs(pixel(one, 10, 10)[3] - 26) <= 1);

  const buildup = surface();
  replayStroke(buildup, {
    layerId: "layer",
    params: { ...base, size: 8, spacing: 0.02, opacity: 0.5, flow: 0.2 },
    points: [{ x: 10, y: 10.5, p: 1 }, { x: 11, y: 10.5, p: 1 }],
  });
  assert.ok(pixel(buildup, 10, 10)[3] > pixel(one, 10, 10)[3]);
  assert.ok(pixel(buildup, 10, 10)[3] <= 128);

  const noBuildup = surface();
  replayStroke(noBuildup, {
    layerId: "layer",
    params: { ...base, size: 8, spacing: 0.02, opacity: 0.5, flow: 0.2, buildUp: false },
    points: [{ x: 10, y: 10.5, p: 1 }, { x: 11, y: 10.5, p: 1 }],
  });
  assert.ok(Math.abs(pixel(noBuildup, 10, 10)[3] - 26) <= 1);
});

test("replay supports erase and blend behavior without a canvas", () => {
  const erased = surface(20, 20, [100, 150, 200, 255]);
  replayStroke(erased, {
    layerId: "layer",
    params: { ...base, size: 12, mode: "erase" },
    points: [{ x: 10.5, y: 10.5, p: 1 }],
  });
  assert.equal(pixel(erased, 10, 10)[3], 0);

  const multiplied = surface(20, 20, [200, 200, 200, 255]);
  replayStroke(multiplied, {
    layerId: "layer",
    params: { ...base, size: 12, color: "#808080", blendMode: "multiply" },
    points: [{ x: 10.5, y: 10.5, p: 1 }],
  });
  assert.ok(Math.abs(pixel(multiplied, 10, 10)[0] - 100) <= 1);
});

test("tile-local replay matches the corresponding full-document pixels", () => {
  const params: BrushParams = {
    ...base,
    size: 14,
    scatter: 0.3,
    texture: { strength: 0.4, scale: 0.75, seed: 8 },
    seed: 73,
  };
  const stroke = {
    layerId: "layer",
    params,
    points: [{ x: 12, y: 8, p: 1 }, { x: 26, y: 8, p: 1 }],
  };
  const full = surface(32, 16);
  const tile = { ...surface(16, 16), originX: 16, originY: 0 };
  replayStroke(full, stroke);
  replayStroke(tile, stroke);
  for (let y = 0; y < 16; y += 1) {
    for (let x = 0; x < 16; x += 1) {
      assert.deepEqual(pixel(tile, x, y), pixel(full, x + 16, y));
    }
  }
});
