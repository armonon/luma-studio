import { Layer, Transform, layerCorners } from "../engine/document";

/**
 * The pointer geometry the canvas needs, lifted out of the studio component.
 *
 * Both of these ran only inside `SpatialStudio`, so a sign error in the
 * corner-drag algebra or an off-by-one in the snap threshold could only be
 * found by dragging something and looking at it. They are pure functions of
 * their inputs, so they belong out here where a test can reach them.
 */

/** Row-major 2x2 rotation matrix: [r00, r01, r10, r11]. */
export function rotMat(theta: number): [number, number, number, number] {
  const c = Math.cos(theta), s = Math.sin(theta);
  return [c, -s, s, c];
}

export type SnapTargets = {
  width: number;
  height: number;
  guides: ReadonlyArray<{ orientation: "vertical" | "horizontal"; position: number }>;
};

/** Screen pixels of slack around a snap target, before the view zoom. */
export const SNAP_SLACK_PX = 8;

/**
 * Nudge a translation so the layer's edges or centre land on a guide.
 *
 * The candidate anchors are the layer's own bounding box: both edges and the
 * middle, on each axis. The targets are the canvas edges, the canvas centre,
 * and every guide. Each axis snaps independently — a layer can catch the left
 * margin without also being dragged onto a horizontal guide.
 *
 * The threshold is in *screen* pixels, so it divides by zoom: snapping must
 * feel like the same distance under the pointer at every magnification, which
 * a document-space threshold would not.
 */
export function snapTranslation(
  layer: Layer,
  doc: SnapTargets,
  zoom: number,
  tx: number,
  ty: number,
): { tx: number; ty: number } {
  const candidate: Layer = { ...layer, transform: { ...layer.transform, tx, ty } };
  const corners = layerCorners(candidate, doc.width, doc.height);
  const xs = corners.map((corner) => corner[0]);
  const ys = corners.map((corner) => corner[1]);
  const spanX: [number, number] = [Math.min(...xs), Math.max(...xs)];
  const spanY: [number, number] = [Math.min(...ys), Math.max(...ys)];
  const anchorsX = [spanX[0], (spanX[0] + spanX[1]) / 2, spanX[1]];
  const anchorsY = [spanY[0], (spanY[0] + spanY[1]) / 2, spanY[1]];

  const targetsX = [
    0, doc.width / 2, doc.width,
    ...doc.guides.filter((guide) => guide.orientation === "vertical").map((guide) => guide.position),
  ];
  const targetsY = [
    0, doc.height / 2, doc.height,
    ...doc.guides.filter((guide) => guide.orientation === "horizontal").map((guide) => guide.position),
  ];

  const threshold = SNAP_SLACK_PX / Math.max(zoom, 0.05);
  return {
    tx: tx + nearestPull(anchorsX, targetsX, threshold),
    ty: ty + nearestPull(anchorsY, targetsY, threshold),
  };
}

function nearestPull(anchors: number[], targets: number[], threshold: number): number {
  let best = Infinity;
  let pull = 0;
  for (const anchor of anchors) {
    for (const target of targets) {
      const delta = target - anchor;
      if (Math.abs(delta) < best) { best = Math.abs(delta); pull = delta; }
    }
  }
  return best <= threshold ? pull : 0;
}

export type TransformCorner = "tl" | "tr" | "br" | "bl";

/** Below this the layer would be a degenerate sliver with no way back. */
const MIN_SCALE = 0.02;

/**
 * Resolve a corner drag into a new scale and translation.
 *
 * The corner opposite the one being dragged stays pinned, which is what makes
 * the gesture feel like pulling on a sheet rather than moving it. The pointer
 * offset from that pinned point is resolved onto the layer's own rotated axes,
 * so a rotated layer scales along its own edges instead of the screen's.
 */
export function cornerDragTransform(
  corner: TransformCorner,
  start: Transform,
  docWidth: number,
  docHeight: number,
  pointerX: number,
  pointerY: number,
): { sx: number; sy: number; tx: number; ty: number } {
  const localOpposite = {
    tl: [docWidth, docHeight], tr: [0, docHeight],
    br: [0, 0], bl: [docWidth, 0],
  }[corner] as [number, number];
  const localGrabbed = {
    tl: [0, 0], tr: [docWidth, 0],
    br: [docWidth, docHeight], bl: [0, docHeight],
  }[corner] as [number, number];

  const R = rotMat(start.rotation);
  // Where the pinned corner sits on the canvas under the starting transform.
  const pinX = R[0] * start.sx * localOpposite[0] + R[1] * start.sy * localOpposite[1] + start.tx;
  const pinY = R[2] * start.sx * localOpposite[0] + R[3] * start.sy * localOpposite[1] + start.ty;

  const dx = pointerX - pinX;
  const dy = pointerY - pinY;
  const ex = { x: Math.cos(start.rotation), y: Math.sin(start.rotation) };
  const ey = { x: -Math.sin(start.rotation), y: Math.cos(start.rotation) };
  // Signed local extent from the pinned corner to the grabbed one: +-docW/H.
  const signX = localGrabbed[0] - localOpposite[0];
  const signY = localGrabbed[1] - localOpposite[1];

  const rawSx = (dx * ex.x + dy * ex.y) / signX;
  const rawSy = (dx * ey.x + dy * ey.y) / signY;
  const sx = Math.abs(rawSx) < MIN_SCALE ? Math.sign(rawSx || 1) * MIN_SCALE : rawSx;
  const sy = Math.abs(rawSy) < MIN_SCALE ? Math.sign(rawSy || 1) * MIN_SCALE : rawSy;

  return {
    sx,
    sy,
    tx: pinX - (R[0] * sx * localOpposite[0] + R[1] * sy * localOpposite[1]),
    ty: pinY - (R[2] * sx * localOpposite[0] + R[3] * sy * localOpposite[1]),
  };
}
