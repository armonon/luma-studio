export type BrushParams = {
  size: number; // px diameter
  hardness: number; // 0..1
  opacity: number; // 0..1
  color: string; // css color for raster paint
  spacing?: number; // fraction of size, default 0.15
  roundness?: number; // 0.05..1
  angle?: number; // degrees
  pressureSize?: boolean;
  pressureOpacity?: boolean;
  smoothing?: number; // 0..1 input stabilization
  mode: "paint" | "erase" | "mask-add" | "mask-remove";
};

export type Stroke = {
  layerId: string;
  params: BrushParams;
  points: Array<{ x: number; y: number; p: number }>; // pressure 0..1
};

// Stamp one brush dab at (x,y) on ctx. Alpha combines pressure and opacity.
function stamp(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  pressure: number,
  params: BrushParams,
) {
  const r = (params.size * 0.5) * (params.pressureSize === false ? 1 : 0.35 + 0.65 * pressure);
  if (r < 0.5) return;
  const a = params.opacity * (params.pressureOpacity === false ? 1 : 0.5 + 0.5 * pressure);
  const inner = Math.max(0, Math.min(1, params.hardness));
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate((params.angle ?? 0) * Math.PI / 180);
  ctx.scale(1, Math.max(0.05, Math.min(1, params.roundness ?? 1)));
  const grad = ctx.createRadialGradient(0, 0, r * inner, 0, 0, r);

  if (params.mode === "erase" || params.mode === "mask-remove") {
    grad.addColorStop(0, `rgba(0,0,0,${a})`);
    grad.addColorStop(1, `rgba(0,0,0,0)`);
  } else if (params.mode === "mask-add") {
    grad.addColorStop(0, `rgba(255,255,255,${a})`);
    grad.addColorStop(1, `rgba(255,255,255,0)`);
  } else {
    // paint: derive rgba from params.color; browser resolves hex/named colors
    const rgba = colorWithAlpha(params.color, a);
    const rgba0 = colorWithAlpha(params.color, 0);
    grad.addColorStop(0, rgba);
    grad.addColorStop(1, rgba0);
  }
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// Convert a css color to rgba(...) with the given alpha, without regex hell.
// We use a scratch canvas to normalize the color, then apply alpha.
let colorProbe: CanvasRenderingContext2D | null = null;
function normalizeColor(color: string): [number, number, number] {
  if (!colorProbe) {
    const c = document.createElement("canvas");
    c.width = 1;
    c.height = 1;
    colorProbe = c.getContext("2d")!;
  }
  colorProbe.fillStyle = "#000";
  colorProbe.fillStyle = color;
  const resolved = colorProbe.fillStyle as string;
  // resolved is "#rrggbb" or "rgba(...)"
  if (resolved.startsWith("#")) {
    const hex = resolved.slice(1);
    return [
      parseInt(hex.slice(0, 2), 16),
      parseInt(hex.slice(2, 4), 16),
      parseInt(hex.slice(4, 6), 16),
    ];
  }
  const m = resolved.match(/(\d+),\s*(\d+),\s*(\d+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [0, 0, 0];
}

function colorWithAlpha(color: string, a: number): string {
  const [r, g, b] = normalizeColor(color);
  return `rgba(${r},${g},${b},${a})`;
}

// Paint a stroke segment from `from` to `to` onto ctx. Returns the number of
// stamps drawn so the caller can decide whether to commit an undo snapshot.
export function paintSegment(
  ctx: CanvasRenderingContext2D,
  from: { x: number; y: number; p: number },
  to: { x: number; y: number; p: number },
  params: BrushParams,
): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.hypot(dx, dy);
  const spacing = Math.max(1, params.size * (params.spacing ?? 0.15));
  const steps = Math.max(1, Math.floor(dist / spacing));

  // Erase mode composites via destination-out; else default source-over.
  const composite: GlobalCompositeOperation =
    params.mode === "erase" ? "destination-out" : "source-over";
  ctx.save();
  ctx.globalCompositeOperation = composite;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    stamp(
      ctx,
      from.x + dx * t,
      from.y + dy * t,
      from.p + (to.p - from.p) * t,
      params,
    );
  }
  ctx.restore();
  return steps;
}
