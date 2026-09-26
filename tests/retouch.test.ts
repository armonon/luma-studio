import assert from "node:assert/strict";
import test from "node:test";
import { planStroke, type BrushParams } from "../app/engine/brush.ts";
import { replayRetouch, planRepairOffsets } from "../app/engine/retouch.ts";

const params: BrushParams = {
  size: 6,
  hardness: 1,
  opacity: 1,
  flow: 1,
  spacing: 0.2,
  pressureSize: false,
  pressureOpacity: false,
  color: "#fff",
  mode: "paint",
};

function floatSurface(width = 12, height = 12, value = 0.2) {
  const data = new Float32Array(width * height * 4);
  for (let offset = 0; offset < data.length; offset += 4) {
    data[offset] = value;
    data[offset + 1] = value;
    data[offset + 2] = value;
    data[offset + 3] = 1;
  }
  return { width, height, data };
}

test("clone replay samples in document coordinates across tile origins", () => {
  const surface = { ...floatSurface(8, 8), originX: 8, originY: 0 };
  const points = [{ x: 11.5, y: 4.5, p: 1 }];
  replayRetouch(surface, {
    mode: "clone",
    params,
    dabs: planStroke(points, params),
    sourceOffsetX: -8,
    sample: (x) => x < 8 ? [1.5, -0.1, 0.4, 1] : [0, 0, 0, 0],
  });
  const center = (4 * 8 + 3) * 4;
  assert.ok(surface.data[center] > 1);
  assert.ok(surface.data[center + 1] < 0);
});

test("heal adapts source luminance while retaining source chroma", () => {
  const surface = floatSurface();
  const points = [{ x: 6.5, y: 6.5, p: 1 }];
  replayRetouch(surface, {
    mode: "heal",
    params,
    dabs: planStroke(points, params),
    sample: () => [0.9, 0.2, 0.1, 1],
  });
  const center = (6 * 12 + 6) * 4;
  assert.ok(surface.data[center] > surface.data[center + 1]);
  assert.ok(surface.data[center + 1] > surface.data[center + 2]);
  assert.ok(surface.data[center] < 0.9);
});

test("dodge and burn are inverse exposure-style operations", () => {
  const points = [{ x: 6.5, y: 6.5, p: 1 }];
  const dabs = planStroke(points, params);
  const dodged = floatSurface();
  const burned = floatSurface();
  replayRetouch(dodged, { mode: "dodge", params, dabs, strength: 0.5 });
  replayRetouch(burned, { mode: "burn", params, dabs, strength: 0.5 });
  const center = (6 * 12 + 6) * 4;
  assert.ok(dodged.data[center] > 0.2);
  assert.ok(burned.data[center] < 0.2);
  assert.equal(dodged.data[center + 3], 1);
  assert.equal(burned.data[center + 3], 1);
});

test("blur and sharpen move local values in opposite directions", () => {
  const points = [{ x: 6.5, y: 6.5, p: 1 }];
  const dabs = planStroke(points, params);
  const blurred = floatSurface(12, 12, 0.8);
  const sharpened = floatSurface(12, 12, 0.8);
  const neighborhood = () => [0.2, 0.2, 0.2, 1] as const;
  replayRetouch(blurred, { mode: "blur", params, dabs, sample: neighborhood, strength: 0.5 });
  replayRetouch(sharpened, { mode: "sharpen", params, dabs, sample: neighborhood, strength: 0.5 });
  const center = (6 * 12 + 6) * 4;
  assert.ok(blurred.data[center] < 0.8);
  assert.ok(sharpened.data[center] > 0.8);
});

test("sampling retouch modes fall back to the local float surface safely", () => {
  const surface = floatSurface(8, 8, 0.4);
  const points = [{ x: 4.5, y: 4.5, p: 1 }];
  assert.doesNotThrow(() => replayRetouch(surface, {
    mode: "blur",
    params,
    dabs: planStroke(points, params),
  }));
  assert.doesNotThrow(() => replayRetouch(surface, {
    mode: "liquify",
    params,
    dabs: planStroke(points, params),
    sourceOffsetX: 1,
  }));
});

test("sponge and mixer brushes perform distinct color operations", () => {
  const points = [{ x: 6.5, y: 6.5, p: 1 }];
  const dabs = planStroke(points, params);
  const sponge = floatSurface();
  sponge.data.set([0.7, 0.25, 0.2, 1], (6 * 12 + 6) * 4);
  const mixed = floatSurface();
  replayRetouch(sponge, { mode: "sponge", params, dabs, strength: 0.5 });
  replayRetouch(mixed, { mode: "mixer", params: { ...params, color: "#ff0000" }, dabs });
  const center = (6 * 12 + 6) * 4;
  assert.ok(sponge.data[center] - sponge.data[center + 1] > 0.45);
  assert.ok(mixed.data[center] > 0.9);
  assert.ok(mixed.data[center + 1] < 0.05);
});

test("spot healing and remove synthesize from surrounding samples", () => {
  const points = [{ x: 6.5, y: 6.5, p: 1 }];
  const dabs = planStroke(points, params);
  const spot = floatSurface(12, 12, 0.9);
  const remove = floatSurface(12, 12, 0.9);
  const sample = () => [0.15, 0.2, 0.25, 1] as const;
  replayRetouch(spot, { mode: "spot-heal", params, dabs, sample });
  replayRetouch(remove, { mode: "remove", params, dabs, sample });
  const center = (6 * 12 + 6) * 4;
  assert.ok(spot.data[center] < 0.3);
  assert.ok(remove.data[center] < 0.3);
});

test("repair retains texture and is invariant across tile partitions", () => {
  const brush = { ...params, size: 8 };
  const dabs = planStroke([{ x: 8, y: 6, p: 1 }], brush);
  const sample = (x: number, y: number) => {
    const value = ((Math.floor(x) + Math.floor(y)) % 2 + 2) % 2 ? .8 : .2;
    return [value, value, value, 1] as const;
  };
  const offsets = planRepairOffsets(dabs, sample);
  assert.ok(offsets[0]);
  const whole = floatSurface(16, 12, .5);
  replayRetouch(whole, { mode: "remove", params: brush, dabs, sample, repairOffsets: offsets });
  assert.notEqual(whole.data[(6 * 16 + 7) * 4], whole.data[(6 * 16 + 8) * 4]);
  for (const originX of [0, 8]) {
    const tile = { ...floatSurface(8, 12, .5), originX };
    replayRetouch(tile, { mode: "remove", params: brush, dabs, sample, repairOffsets: offsets });
    for (let y = 0; y < 12; y++) for (let x = 0; x < 8; x++) for (let c = 0; c < 4; c++) {
      assert.equal(tile.data[(y * 8 + x) * 4 + c], whole.data[(y * 16 + x + originX) * 4 + c]);
    }
  }
});
