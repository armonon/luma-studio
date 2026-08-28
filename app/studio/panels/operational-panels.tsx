"use client";

export type ChannelView = "rgb" | "red" | "green" | "blue" | "alpha";

export function ChannelsPanel({ channelView, onChange }: Readonly<{
  channelView: ChannelView;
  onChange: (channel: ChannelView) => void;
}>) {
  return (
    <section className="glass-card mask-card" data-contextual-panel="channels">
      <header><strong>Channels</strong><small title="Channel previews do not change RGB export">{channelView.toUpperCase()}</small></header>
      <div className="mask-segmented channel-switcher">
        {(["rgb", "red", "green", "blue", "alpha"] as const).map((channel) => (
          <button key={channel} className={channelView === channel ? "active" : ""} onClick={() => onChange(channel)} aria-pressed={channelView === channel}>
            {channel === "rgb" ? "RGB" : channel === "alpha" ? "A" : channel[0].toUpperCase()}
          </button>
        ))}
      </div>
    </section>
  );
}

type Point = Readonly<{ x: number; y: number }>;
type Measurement = Readonly<{ start: Point; end: Point }>;
type ColorSample = Readonly<{ x: number; y: number; color: string }>;

export function MeasurePanel({ measurement, colorSamples, onClear }: Readonly<{
  measurement: Measurement | null;
  colorSamples: readonly ColorSample[];
  onClear: () => void;
}>) {
  return (
    <section className="glass-card tone-card" data-contextual-panel="measure">
      <header><strong>Measure & sample</strong><button onClick={onClear}>Clear</button></header>
      <div style={{ display: "grid", gap: 7, padding: "8px 12px 12px", fontSize: 11 }}>
        {measurement ? (() => {
          const dx = measurement.end.x - measurement.start.x;
          const dy = measurement.end.y - measurement.start.y;
          return <><div>Length <strong>{Math.hypot(dx, dy).toFixed(1)} px</strong></div><div>Angle <strong>{(Math.atan2(dy, dx) * 180 / Math.PI).toFixed(1)}°</strong></div><div>Δx {dx.toFixed(1)} · Δy {dy.toFixed(1)}</div></>;
        })() : <p style={{ margin: 0, opacity: 0.7 }}>Drag with Ruler or click with a sampler.</p>}
        {colorSamples.map((sample, index) => (
          <div key={`${sample.x}-${sample.y}-${index}`} style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <i style={{ width: 14, height: 14, borderRadius: 3, background: sample.color, border: "1px solid rgba(255,255,255,.35)" }} />
            <span>#{index + 1} · {sample.color} · {Math.round(sample.x)}, {Math.round(sample.y)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

type ActionSummary = Readonly<{ name: string; steps: readonly unknown[] }>;

export function ActionsPanel({ actions, recordingName, onStart, onStop, onPlay }: Readonly<{
  actions: readonly ActionSummary[];
  recordingName: string;
  onStart: () => void;
  onStop: () => void;
  onPlay: (index: number) => void;
}>) {
  return (
    <section className="glass-card neural-card neural-compact" data-contextual-panel="actions">
      <header>
        <strong>Actions</strong>
        {recordingName
          ? <button onClick={onStop} title="Stop">◼</button>
          : <button onClick={onStart} title="Record" aria-label="Record action">●</button>}
      </header>
      <div className="neural-quick-grid">
        {actions.map((action, index) => (
          <button key={action.name + index} onClick={() => onPlay(index)}>
            <i>▶</i><span>{action.name}<br /><small style={{ opacity: 0.6 }}>{action.steps.length} steps</small></span>
          </button>
        ))}
        {!actions.length && <div className="inspector-empty-state" style={{ padding: "8px 4px" }}>No recorded actions</div>}
      </div>
    </section>
  );
}
