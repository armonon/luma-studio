import { brushMirror, type MirrorSettings } from "./brush-library";

/** Document-space overlay follows the existing canvas pan/zoom plane. */
export function BrushMirrorGuides({ settings, width, height }: { settings: MirrorSettings; width: number; height: number }) {
  const symmetry = brushMirror(settings, width, height);
  if (!symmetry) return null;
  const { centerX: x, centerY: y } = symmetry;
  const lines: [number, number, number, number][] = [];
  if (symmetry.horizontal) lines.push([x, 0, x, height]);
  if (symmetry.vertical) lines.push([0, y, width, y]);
  if ((symmetry.radialSegments ?? 1) > 1) {
    const radius = Math.hypot(width, height);
    for (let i = 0; i < symmetry.radialSegments!; i++) {
      const angle = i / symmetry.radialSegments! * Math.PI * 2;
      lines.push([x, y, x + Math.cos(angle) * radius, y + Math.sin(angle) * radius]);
    }
  }
  return <svg aria-hidden="true" data-brush-mirror={settings.mode} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", overflow: "hidden" }}>
    {lines.map(([x1, y1, x2, y2], i) => <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#9bceff" strokeOpacity={0.7} strokeWidth={1} strokeDasharray="5 5" vectorEffect="non-scaling-stroke" />)}
  </svg>;
}
