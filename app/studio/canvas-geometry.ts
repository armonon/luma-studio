import { Layer, Transform, layerCorners, rotateLayerTransformAround } from "../engine/document";
import { vectorPathBounds } from "../engine/vector-path";
import { textLayoutBounds } from "../engine/text-layout-bounds";
export { isValidTransformQuad } from "../engine/advanced-tools";

export type TransformMode = "scale" | "skew" | "distort";

/** Editing geometry, in pre-transform local coordinates; never scan a raster. */
export function transformContentBounds(layer: Layer, width: number, height: number) {
  if (layer.shape) return { x: layer.shape.x, y: layer.shape.y, width: Math.max(1, layer.shape.w), height: Math.max(1, layer.shape.h) };
  if (layer.path) return vectorPathBounds(layer.path);
  if (layer.text) {
    try {
      const bounds = textLayoutBounds({ ...layer, transform: { tx: 0, ty: 0, sx: 1, sy: 1, rotation: 0 } });
      return { ...bounds, width: Math.max(1, bounds.width), height: Math.max(1, bounds.height) };
    } catch { /* Unmeasurable/over-budget text retains the bounded document box. */ }
  }
  return { x: 0, y: 0, width: layer.surface?.grid.width ?? layer.bitmap?.width ?? width, height: layer.surface?.grid.height ?? layer.bitmap?.height ?? height };
}

/** Shift constrains the dominant axis without introducing an easing lag. */
export function constrainedTranslation(dx: number, dy: number, constrain: boolean) {
  return constrain ? (Math.abs(dx) >= Math.abs(dy) ? { dx, dy: 0 } : { dx: 0, dy }) : { dx, dy };
}

export function rotationDragTransform(start: Transform, delta: number, cx: number, cy: number, snap: boolean) {
  const angle = snap ? Math.round((start.rotation + delta) / (Math.PI / 12)) * Math.PI / 12 : start.rotation + delta;
  return rotateLayerTransformAround(start, angle - start.rotation, cx, cy);
}

/** Shear the grabbed horizontal edge along its own axis; opposite edge stays fixed. */
export function skewDragTransform(start: Transform, top: boolean, height: number, dx: number, dy: number, originY = 0): Transform {
  const amount = dx * Math.cos(start.rotation) + dy * Math.sin(start.rotation);
  const extent = start.sy * height;
  if (Math.abs(extent) < 1e-6) return start;
  const skewX = Math.max(-20, Math.min(20, (start.skewX ?? 0) + amount / (top ? -extent : extent)));
  const shift = -start.sy * (originY + (top ? height : 0)) * (skewX - (start.skewX ?? 0));
  return { ...start, skewX, tx: start.tx + shift * Math.cos(start.rotation), ty: start.ty + shift * Math.sin(start.rotation) };
}

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
  const bounds = transformContentBounds(layer, doc.width, doc.height);
  const corners = layerCorners(candidate, bounds.width, bounds.height, bounds.x, bounds.y);
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

  const threshold = SNAP_SLACK_PX / Math.max(zoom, 0.001);
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
  constrain = false,
  originX = 0,
  originY = 0,
): { sx: number; sy: number; tx: number; ty: number } {
  const localOpposite = {
    tl: [docWidth, docHeight], tr: [0, docHeight],
    br: [0, 0], bl: [docWidth, 0],
  }[corner] as [number, number];
  const localGrabbed = {
    tl: [0, 0], tr: [docWidth, 0],
    br: [docWidth, docHeight], bl: [0, docHeight],
  }[corner] as [number, number];
  localOpposite[0] += originX; localOpposite[1] += originY;
  localGrabbed[0] += originX; localGrabbed[1] += originY;

  const cosine = Math.cos(start.rotation), sine = Math.sin(start.rotation);
  const shear = start.skewX ?? 0;
  const R = [cosine, cosine * shear - sine, sine, sine * shear + cosine];
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

  const localY = dx * ey.x + dy * ey.y;
  let rawSx = (dx * ex.x + dy * ex.y - shear * localY) / signX;
  let rawSy = localY / signY;
  if (constrain) {
    const ratioX = rawSx / start.sx, ratioY = rawSy / start.sy;
    const ratio = Math.abs(ratioX - 1) >= Math.abs(ratioY - 1) ? ratioX : ratioY;
    rawSx = start.sx * ratio;
    rawSy = start.sy * ratio;
  }
  const sx = Math.abs(rawSx) < MIN_SCALE ? Math.sign(rawSx || 1) * MIN_SCALE : rawSx;
  const sy = Math.abs(rawSy) < MIN_SCALE ? Math.sign(rawSy || 1) * MIN_SCALE : rawSy;

  return {
    sx,
    sy,
    tx: pinX - (R[0] * sx * localOpposite[0] + R[1] * sy * localOpposite[1]),
    ty: pinY - (R[2] * sx * localOpposite[0] + R[3] * sy * localOpposite[1]),
  };
}
