export default function DesktopStatusbar({
  dimensions,
  bitDepth,
  colorSpace,
  interactiveRenderer,
  exportRenderer,
  tool,
  shortcut,
  zoom,
}: {
  dimensions: string;
  bitDepth: number;
  colorSpace: string;
  interactiveRenderer: "viewport-tiled-canvas2d" | "canvas2d-rgba8";
  exportRenderer: "webgl2-rgba16f" | "canvas2d-rgba8";
  tool: string;
  shortcut: string;
  zoom: number;
}) {
  return (
    <footer className="desktop-statusbar">
      <span className="desktop-status-brand"><i /> Luma Desktop</span>
      <span>{dimensions}</span>
      <span title={`Interactive: ${interactiveRenderer} · Export: ${exportRenderer}`}>
        {bitDepth}-bit · {colorSpace} · {interactiveRenderer === "viewport-tiled-canvas2d" ? "Tiled CPU" : "CPU"}
      </span>
      <span className="desktop-status-spacer" />
      <span>{tool} <kbd>{shortcut}</kbd></span>
      <span>{zoom}%</span>
      <span className="desktop-status-local">LOCAL</span>
    </footer>
  );
}
