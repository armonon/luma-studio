import assert from "node:assert/strict";
import test from "node:test";
import {
  nearestPathDistance,
  pathArcTable,
  samplePathDistance,
  type PathStyle,
} from "../app/engine/document.ts";

const curvedPath: PathStyle = {
  anchors: [
    { x: 0, y: 0, hIn: { dx: 0, dy: 0 }, hOut: { dx: 0, dy: 100 } },
    { x: 100, y: 0, hIn: { dx: 0, dy: 100 }, hOut: { dx: 0, dy: 0 } },
  ],
  closed: false,
  fill: "transparent",
  stroke: "#fff",
  strokeWidth: 1,
};

test("path arc tables follow cubic Bezier handles instead of anchor chords", () => {
  const table = pathArcTable(curvedPath, 0.05);
  assert.ok(table.length > 2);
  assert.ok(table.at(-1)!.distance > 100, "curved arc must be longer than the straight chord");
  const middle = samplePathDistance(table, table.at(-1)!.distance / 2);
  assert.ok(middle);
  assert.ok(middle.y > 70, `expected the Bezier apex, got y=${middle.y}`);
});

test("path distance sampling honors click-based start offsets and open bounds", () => {
  const table = pathArcTable(curvedPath);
  const start = nearestPathDistance(table, 50, 75);
  assert.ok(start > 0 && start < table.at(-1)!.distance);
  const sample = samplePathDistance(table, start);
  assert.ok(sample && Math.abs(sample.x - 50) < 2 && Math.abs(sample.y - 75) < 2);
  assert.equal(samplePathDistance(table, table.at(-1)!.distance + 1), null);
});

test("closed paths wrap distances without stacking glyphs at the final anchor", () => {
  const closed = pathArcTable({ ...curvedPath, closed: true });
  const total = closed.at(-1)!.distance;
  const first = samplePathDistance(closed, 5, true)!;
  const wrapped = samplePathDistance(closed, total + 5, true)!;
  assert.ok(Math.abs(first.x - wrapped.x) < 1e-9);
  assert.ok(Math.abs(first.y - wrapped.y) < 1e-9);
});
