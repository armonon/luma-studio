export default function DesktopStatusbar({
  dimensions,
  bitDepth,
  colorSpace,
  accelerated,
  tool,
  shortcut,
  zoom,
}: {
  dimensions: string;
  bitDepth: number;
  colorSpace: string;
  accelerated: boolean;
  tool: string;
  shortcut: string;
  zoom: number;
}) {
  return (
    <footer className="desktop-statusbar">
      <span className="desktop-status-brand"><i /> Luma Desktop</span>
      <span>{dimensions}</span>
      <span>{bitDepth}-bit · {colorSpace} · {accelerated ? "GPU" : "CPU"}</span>
      <span className="desktop-status-spacer" />
      <span>{tool} <kbd>{shortcut}</kbd></span>
      <span>{zoom}%</span>
      <span className="desktop-status-local">LOCAL</span>
    </footer>
  );
}
