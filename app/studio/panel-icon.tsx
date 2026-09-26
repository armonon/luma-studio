import { Box, Brush, Camera, ChartNoAxesColumn, ChartSpline, CircleDashed, FileImage, History, Layers, LayoutPanelTop, Move3D, Palette, PenTool, Play, Ruler, Scan, SlidersHorizontal, Sparkles, SunMedium, SwatchBook, type LucideIcon } from "lucide-react";

const icons: Record<string, LucideIcon> = {
  layers: Layers, sliders: SlidersHorizontal, sparkles: Sparkles,
  "file-image": FileImage, channels: SwatchBook, layout: LayoutPanelTop,
  package: Box, scan: Scan, "circle-dashed": CircleDashed, camera: Camera,
  "chart-spline": ChartSpline, "chart-no-axes-column": ChartNoAxesColumn,
  palette: Palette, "sliders-horizontal": SlidersHorizontal, "sun-medium": SunMedium,
  brush: Brush, "pen-tool": PenTool, "move-3d": Move3D, ruler: Ruler,
  play: Play, history: History,
};

export default function PanelIcon({ name }: { name: string }) {
  const Icon = icons[name] ?? SlidersHorizontal;
  return <Icon size={14} strokeWidth={1.6} aria-hidden="true" />;
}
