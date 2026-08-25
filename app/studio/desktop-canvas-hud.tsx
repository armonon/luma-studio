"use client";

import type { Layer } from "@/app/engine/document";
import type { SpaceDeckCommand, SpaceDeckContext, SpaceDeckPoint } from "./space-deck-model";

export type SpaceDeckFeature =
  | {
    kind: "range";
    id: string;
    label: string;
    value: number;
    min: number;
    max: number;
    step?: number;
    output: string;
    onChange: (value: number) => void;
    onCommit?: () => void;
  }
  | {
    kind: "choice";
    id: string;
    label: string;
    value: string;
    options: ReadonlyArray<{ value: string; label: string }>;
    onChange: (value: string) => void;
  }
  | {
    kind: "toggle";
    id: string;
    label: string;
    detail: string;
    value: boolean;
    onChange: (value: boolean) => void;
  }
  | {
    kind: "color";
    id: string;
    label: string;
    value: string;
    onChange: (value: string) => void;
  }
  | {
    kind: "text";
    id: string;
    label: string;
    value: string;
    placeholder?: string;
    onChange: (value: string) => void;
    /**
     * Called once editing finishes (blur), to fold a whole typing burst into
     * a single undo step. Every other continuous control here (range's
     * onPointerUp/onKeyUp/onBlur) already draws this line between "live
     * feedback" and "committed edit"; without it, onChange alone means every
     * keystroke becomes its own history entry.
     */
    onCommit?: () => void;
  }
  | {
    kind: "action";
    id: string;
    label: string;
    detail: string;
    icon: string;
    disabled?: boolean;
    onRun: () => void;
  };

const contextName: Record<SpaceDeckContext, string> = {
  canvas: "Canvas",
  selection: "Selection",
  mask: "Mask",
  paint: "Paint",
  retouch: "Retouch",
  text: "Type & vector",
  develop: "Develop",
  transform: "Transform",
  measure: "Measure",
  layer: "Layer",
};

export default function DesktopCanvasHud({
  activeLayer,
  context,
  toolLabel,
  features,
  commands,
  position,
  size,
  pinned,
  onPinnedChange,
  onCommand,
  onClose,
}: {
  activeLayer: Layer | null;
  context: SpaceDeckContext;
  toolLabel: string;
  features: SpaceDeckFeature[];
  commands: SpaceDeckCommand[];
  position: SpaceDeckPoint;
  size: { width: number; height: number };
  pinned: boolean;
  onPinnedChange: (pinned: boolean) => void;
  onCommand: (command: SpaceDeckCommand) => void;
  onClose: () => void;
}) {
  return (
    <section
      className={`space-deck ${pinned ? "pinned" : ""}`}
      aria-label={`${toolLabel} tool features`}
      style={{ left: position.x, top: position.y, width: `min(${size.width}px, calc(100% - 28px))` }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <header className="space-deck-header">
        <span>
          <i aria-hidden="true">⌘</i>
          <strong>{toolLabel}</strong>
          <small>{contextName[context]}</small>
        </span>
        <span className="space-deck-target" title={activeLayer?.name}>{activeLayer?.name ?? "Canvas"}</span>
        <button
          type="button"
          className="space-deck-pin"
          aria-label={pinned ? "Unpin tool features" : "Keep tool features on screen"}
          aria-pressed={pinned}
          title={pinned ? "Pinned · Space to close" : "Keep on screen"}
          onClick={() => onPinnedChange(!pinned)}
        >{pinned ? "●" : "○"}</button>
        <button type="button" onClick={onClose} aria-label="Close tool features">×</button>
      </header>

      <div className="space-deck-features" aria-label={`${toolLabel} controls`}>
        {features.map((feature) => {
          if (feature.kind === "range") return (
            <label key={feature.id} className="space-feature space-feature-range">
              <span><strong>{feature.label}</strong><output>{feature.output}</output></span>
              <input
                type="range"
                min={feature.min}
                max={feature.max}
                step={feature.step}
                value={feature.value}
                aria-label={feature.label}
                onChange={(event) => feature.onChange(Number(event.target.value))}
                onPointerUp={feature.onCommit}
                onKeyUp={feature.onCommit}
                onBlur={feature.onCommit}
              />
            </label>
          );
          if (feature.kind === "choice") return (
            <label key={feature.id} className="space-feature space-feature-choice">
              <strong>{feature.label}</strong>
              <select value={feature.value} onChange={(event) => feature.onChange(event.target.value)}>
                {feature.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
          );
          if (feature.kind === "toggle") return (
            <button
              key={feature.id}
              type="button"
              className={`space-feature space-feature-toggle ${feature.value ? "active" : ""}`}
              aria-pressed={feature.value}
              onClick={() => feature.onChange(!feature.value)}
            >
              <i aria-hidden="true">{feature.value ? "✓" : "○"}</i>
              <span><strong>{feature.label}</strong><small>{feature.detail}</small></span>
            </button>
          );
          if (feature.kind === "color") return (
            <label key={feature.id} className="space-feature space-feature-color">
              <span><strong>{feature.label}</strong><small>{feature.value.toUpperCase()}</small></span>
              <input type="color" value={feature.value} aria-label={feature.label} onChange={(event) => feature.onChange(event.target.value)} />
            </label>
          );
          if (feature.kind === "text") return (
            <label key={feature.id} className="space-feature space-feature-text">
              <strong>{feature.label}</strong>
              <input
                type="text"
                value={feature.value}
                placeholder={feature.placeholder}
                onChange={(event) => feature.onChange(event.target.value)}
                onBlur={feature.onCommit}
              />
            </label>
          );
          return (
            <button
              key={feature.id}
              type="button"
              className="space-feature space-feature-action"
              disabled={feature.disabled}
              onClick={feature.onRun}
            >
              <i aria-hidden="true">{feature.icon}</i>
              <span><strong>{feature.label}</strong><small>{feature.detail}</small></span>
            </button>
          );
        })}
      </div>

      {commands.length > 0 && (
        <div className="space-deck-actions" aria-label={`${toolLabel} shortcuts`}>
          {commands.map((item) => (
            <button key={item.id} type="button" onClick={() => onCommand(item)}>
              <kbd>{item.key}</kbd>
              <i aria-hidden="true">{item.icon}</i>
              <span><strong>{item.label}</strong><small>{item.detail}</small></span>
            </button>
          ))}
        </div>
      )}
      <footer>
        <span><kbd>Space</kbd> {pinned ? "pinned · tap to close" : "tap to pin · drag to pan"}</span>
        <span><kbd>1–4</kbd> shortcuts · <kbd>Esc</kbd> close</span>
      </footer>
    </section>
  );
}
