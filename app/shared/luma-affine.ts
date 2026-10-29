/** Extracted without algorithm changes from Luma af6f089 app/engine/document.ts. */
export type AffineLayerTransform = { tx: number; ty: number; sx: number; sy: number; rotation: number; skewX?: number };
export type AffineTransform = {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
};

export function affineForLayerTransform(transform: AffineLayerTransform): AffineTransform {
  const cosine = Math.cos(transform.rotation);
  const sine = Math.sin(transform.rotation);
  return {
    a: cosine * transform.sx,
    b: sine * transform.sx,
    c: (cosine * (transform.skewX ?? 0) - sine) * transform.sy,
    d: (sine * (transform.skewX ?? 0) + cosine) * transform.sy,
    e: transform.tx,
    f: transform.ty,
  };
}

export function inverseAffineForLayerTransform(transform: AffineLayerTransform): AffineTransform | null {
  const forward = affineForLayerTransform(transform);
  const determinant = forward.a * forward.d - forward.b * forward.c;
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12) return null;
  const a = forward.d / determinant;
  const b = -forward.b / determinant;
  const c = -forward.c / determinant;
  const d = forward.a / determinant;
  return {
    a,
    b,
    c,
    d,
    e: -(a * forward.e + c * forward.f),
    f: -(b * forward.e + d * forward.f),
  };
}

export function transformPoint(matrix: AffineTransform, x: number, y: number) {
  return {
    x: matrix.a * x + matrix.c * y + matrix.e,
    y: matrix.b * x + matrix.d * y + matrix.f,
  };
}

export function documentPointToLayer(transform: AffineLayerTransform, x: number, y: number) {
  const inverse = inverseAffineForLayerTransform(transform);
  return inverse ? transformPoint(inverse, x, y) : null;
}
