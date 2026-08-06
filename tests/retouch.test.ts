import assert from "node:assert/strict";
import test from "node:test";
import { planStroke, type BrushParams } from "../app/engine/brush.ts";
import { replayRetouch } from "../app/engine/retouch.ts";

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
