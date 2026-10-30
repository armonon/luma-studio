import assert from "node:assert/strict";
import test from "node:test";
import { cubicPoint, splitCubic, bendCubic, moveAnchor, moveAnchorHandle, setAnchorMode, polarHandle, handlePolar, snapAnglePoint } from "../app/shared/path-editing.ts";

const close = (a, b, epsilon = 1e-8) => assert.ok(Math.abs(a - b) <= epsilon, `${a} != ${b}`);
const samePoint = (a, b, epsilon) => { close(a.x, b.x, epsilon); close(a.y, b.y, epsilon); };
const length = h => Math.hypot(h.dx, h.dy);
const makeAnchor = mode => ({ id: "anchor-7", x: 2, y: 3, hIn: { dx: -6, dy: 0 }, hOut: { dx: 2, dy: 0 }, mode, custom: { source: "retained" } });
let seed = 89273;
const random = () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 2 ** 32; };

test("de Casteljau subdivision preserves arbitrary planar cubic geometry and endpoints", () => {
  for (let n = 0; n < 100; n++) {
    const p = Array.from({ length: 4 }, () => ({ x: (random() - .5) * 2000, y: (random() - .5) * 2000 }));
    const t = .001 + random() * .998, split = splitCubic(...p, t);
    samePoint(split.left[0], p[0]); samePoint(split.right[3], p[3]);
    samePoint(split.left[3], split.right[0]);
    for (let i = 0; i <= 10; i++) {
      const u = i / 10;
      samePoint(cubicPoint(...split.left, u), cubicPoint(...p, u * t));
      samePoint(cubicPoint(...split.right, u), cubicPoint(...p, t + (1 - t) * u));
    }
  }
  const p = [{ x: 0, y: 0 }, { x: 4, y: 8 }, { x: -5, y: 6 }, { x: 3, y: 0 }];
  samePoint(cubicPoint(...p, 0), p[0]); samePoint(cubicPoint(...p, 1), p[3]);
  assert.deepEqual(splitCubic(...p, 0).right, p);
  assert.deepEqual(splitCubic(...p, 1).left, p);
  const split = splitCubic(...p, .5); split.left[3].x = 99;
  assert.notEqual(split.right[0].x, 99, "split halves do not alias their shared coordinate");
});

test("interior bending hits target with fixed endpoints and minimum control displacement", () => {
  const p = [{ x: -4, y: 1 }, { x: 20, y: -10 }, { x: -5, y: 30 }, { x: 5, y: 8 }], delta = { x: 3, y: -7 };
  const original = structuredClone(p);
  for (const t of [.01, .15, .5, .82, .99]) {
    const result = bendCubic(...p, t, delta), moved = [p[0], result.c1, result.c2, p[3]];
    const previous = cubicPoint(...p, t);
    samePoint(cubicPoint(...moved, t), { x: previous.x + delta.x, y: previous.y + delta.y });
    samePoint(cubicPoint(...moved, 0), p[0]); samePoint(cubicPoint(...moved, 1), p[3]);
    const a = 3 * (1 - t) ** 2 * t, b = 3 * (1 - t) * t ** 2;
    close((result.c1.x - p[1].x) * b, (result.c2.x - p[2].x) * a);
    close((result.c1.y - p[1].y) * b, (result.c2.y - p[2].y) * a);
  }
  assert.deepEqual(p, original);
  for (const t of [0, 1e-7, 1 - 1e-7, 1]) assert.throws(() => bendCubic(...p, t, delta), RangeError);
});

test("anchor moves preserve relative handles, IDs and unrelated metadata without mutation", () => {
  const a = makeAnchor("smooth"), snapshot = structuredClone(a), moved = moveAnchor(a, { x: 55, y: -40 });
  assert.equal(moved.id, a.id); assert.equal(moved.custom, a.custom);
  assert.deepEqual(moved.hIn, a.hIn); assert.deepEqual(moved.hOut, a.hOut);
  samePoint(moved, { x: 55, y: -40 }); assert.deepEqual(a, snapshot);
});

test("smooth handles retain unequal opposite length; corners and independent drags keep opposite", () => {
  const a = makeAnchor("smooth"), result = moveAnchorHandle(a, "out", { dx: 0, dy: 4 });
  assert.deepEqual(result.hOut, { dx: 0, dy: 4 }); close(result.hIn.dx, 0); close(result.hIn.dy, -6);
  for (const independent of [true, false]) {
    const corner = moveAnchorHandle(makeAnchor("corner"), "in", { dx: 4, dy: 9 }, independent);
    assert.deepEqual(corner.hOut, a.hOut);
  }
  assert.deepEqual(moveAnchorHandle(a, "out", { dx: 0, dy: 4 }, true).hIn, a.hIn);
  assert.deepEqual(moveAnchorHandle(a, "out", { dx: 0, dy: 0 }).hIn, a.hIn);
});

test("symmetric handles and mode conversions have explicit alignment and collapsed behavior", () => {
  const a = makeAnchor("symmetric"), moved = moveAnchorHandle(a, "in", { dx: 3, dy: 4 });
  assert.deepEqual(moved.hOut, { dx: -3, dy: -4 });
  assert.deepEqual(moveAnchorHandle(a, "out", { dx: 0, dy: 0 }).hIn, { dx: 0, dy: 0 });
  const unaligned = { ...makeAnchor("corner"), hIn: { dx: -6, dy: 0 }, hOut: { dx: 0, dy: 2 } };
  const smooth = setAnchorMode(unaligned, "smooth"); close(length(smooth.hIn), 6); close(length(smooth.hOut), 2); close(smooth.hIn.dy, -6);
  const symmetric = setAnchorMode(unaligned, "symmetric"); close(length(symmetric.hIn), 2); close(length(symmetric.hOut), 2);
  const incomingOnly = setAnchorMode({ ...unaligned, hOut: { dx: 0, dy: 0 } }, "symmetric"); close(incomingOnly.hOut.dx, 6);
  assert.deepEqual(setAnchorMode(unaligned, "corner").hIn, unaligned.hIn);
  assert.equal(smooth.id, unaligned.id); assert.equal(smooth.custom, unaligned.custom);
});

test("numeric polar controls and direction snapping preserve length in any drawing units", () => {
  for (const degrees of [-720, -135, -90, 0, 30, 90, 179, 450]) {
    const h = polarHandle(25.4, degrees), polar = handlePolar(h), roundTrip = polarHandle(polar.length, polar.angle);
    close(polar.length, 25.4); close(h.dx, roundTrip.dx); close(h.dy, roundTrip.dy);
  }
  const origin = { x: 10, y: -5 }, target = { x: 17, y: -3 }, snapped = snapAnglePoint(origin, target);
  close(Math.hypot(snapped.x - origin.x, snapped.y - origin.y), Math.hypot(7, 2)); close(snapped.y, origin.y);
  samePoint(snapAnglePoint(origin, origin), origin);
  assert.deepEqual(handlePolar({ dx: 0, dy: 0 }), { length: 0, angle: 0 });
  const custom = snapAnglePoint({ x: 0, y: 0 }, { x: 3, y: 4 }, 30); close(handlePolar({ dx: custom.x, dy: custom.y }).angle, 60);
});

test("invalid and excessive geometry is rejected instead of contaminating saved paths", () => {
  const p = [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 0 }, { x: 3, y: 3 }];
  for (const t of [NaN, Infinity, -.01, 1.01]) assert.throws(() => cubicPoint(...p, t), RangeError);
  assert.throws(() => cubicPoint({ x: Infinity, y: 0 }, ...p.slice(1), .5), RangeError);
  assert.throws(() => splitCubic({ x: 1e13, y: 0 }, ...p.slice(1), .5), RangeError);
  assert.throws(() => bendCubic(...p, .00001, { x: 1e12, y: 0 }), RangeError);
  assert.throws(() => moveAnchor(makeAnchor("corner"), { x: NaN, y: 1 }), RangeError);
  assert.throws(() => moveAnchorHandle(makeAnchor("smooth"), "out", { dx: Infinity, dy: 0 }), RangeError);
  assert.throws(() => polarHandle(-1, 0), RangeError);
  assert.throws(() => polarHandle(1, Infinity), RangeError);
  assert.throws(() => setAnchorMode(makeAnchor("corner"), "auto"), RangeError);
  for (const step of [0, -5, 361, Infinity]) assert.throws(() => snapAnglePoint(p[0], p[1], step), RangeError);
});
