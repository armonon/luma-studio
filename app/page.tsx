"use client";

import { ChangeEvent, useEffect, useRef, useState } from "react";

type Tool = {
  id: string;
  icon: string;
  label: string;
  shortcut: string;
};

const tools: Tool[] = [
  { id: "move", icon: "↖", label: "Move", shortcut: "V" },
  { id: "select", icon: "⌖", label: "Select", shortcut: "M" },
  { id: "brush", icon: "╱", label: "Brush", shortcut: "B" },
  { id: "eraser", icon: "◇", label: "Eraser", shortcut: "E" },
  { id: "crop", icon: "⌗", label: "Crop", shortcut: "C" },
  { id: "heal", icon: "✣", label: "Heal", shortcut: "J" },
  { id: "type", icon: "T", label: "Type", shortcut: "T" },
  { id: "shape", icon: "□", label: "Shape", shortcut: "U" },
  { id: "hand", icon: "✋", label: "Hand", shortcut: "H" },
  { id: "zoom", icon: "⊕", label: "Zoom", shortcut: "Z" },
];

const adjustmentDefaults = {
  exposure: 8,
  contrast: 12,
  highlights: -16,
  shadows: 18,
  saturation: 7,
  temperature: 4,
  sharpness: 22,
};

const sliderConfig = [
  ["exposure", "Exposure", -50, 50],
  ["contrast", "Contrast", -50, 50],
  ["highlights", "Highlights", -50, 50],
  ["shadows", "Shadows", -50, 50],
  ["saturation", "Saturation", -50, 50],
  ["temperature", "Temperature", -50, 50],
  ["sharpness", "Sharpness", 0, 50],
] as const;

type AdjustmentKey = (typeof sliderConfig)[number][0];

export default function Home() {
  const [activeTool, setActiveTool] = useState("move");
  const [zoom, setZoom] = useState(74);
  const [panelTab, setPanelTab] = useState<"edit" | "layers">("edit");
  const [adjustments, setAdjustments] = useState(adjustmentDefaults);
  const [imageUrl, setImageUrl] = useState("/desert.jpg");
  const [imageName, setImageName] = useState("Desert_Dreams");
  const [showImage, setShowImage] = useState(true);
  const [showColor, setShowColor] = useState(true);
  const [showBefore, setShowBefore] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const [toast, setToast] = useState("");
  const [historyStep, setHistoryStep] = useState(2);
  const fileInput = useRef<HTMLInputElement>(null);

  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2200);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement
      )
        return;
      const match = tools.find(
        (tool) => tool.shortcut.toLowerCase() === event.key.toLowerCase(),
      );
      if (match) setActiveTool(match.id);
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        setHistoryStep((value) => Math.max(0, value - 1));
        notify("Undid last edit");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const updateAdjustment = (key: AdjustmentKey, value: number) => {
    setAdjustments((current) => ({ ...current, [key]: value }));
    setHistoryStep(2);
  };

  const imageFilter = showBefore
    ? "none"
    : `brightness(${100 + adjustments.exposure + adjustments.shadows * 0.12}%) contrast(${100 + adjustments.contrast}%) saturate(${100 + adjustments.saturation}%) sepia(${Math.max(0, adjustments.temperature) * 0.3}%)`;

  const chooseFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const nextUrl = URL.createObjectURL(file);
    setImageUrl(nextUrl);
    setImageName(file.name.replace(/\.[^/.]+$/, "") || "Untitled");
    notify("Photo opened");
  };

  const runGenerativeFill = () => {
    if (!aiPrompt.trim()) {
      notify("Describe what you want to add");
      return;
    }
    setHistoryStep(2);
    notify(`Previewed “${aiPrompt.trim()}”`);
    setAiPrompt("");
  };

  const exportPreview = () => {
    const link = document.createElement("a");
    link.href = imageUrl;
    link.download = `${imageName}-luma-edit.jpg`;
    link.click();
    notify("Export prepared");
  };

  return (
    <main className="studio-shell">
      <header className="titlebar">
        <div className="window-side">
          <div className="traffic-lights" aria-label="Window controls">
            <span className="traffic red" />
            <span className="traffic yellow" />
            <span className="traffic green" />
          </div>
          <button
            className="brand-button"
            onClick={() => notify("Welcome to Luma Studio")}
            aria-label="Luma Studio home"
          >
            <span className="brand-mark">L</span>
            <span>Luma Studio</span>
          </button>
        </div>

        <div className="document-title">
          <span>{imageName}.luma</span>
          <span className="save-state">Edited</span>
        </div>

        <div className="window-actions">
          <button
            className={`top-icon ${showBefore ? "selected" : ""}`}
            onClick={() => setShowBefore((value) => !value)}
            aria-label="Toggle original preview"
            title="Compare original"
          >
            ◐
          </button>
          <button className="share-button" onClick={() => notify("Share link copied")}>
            <span>↗</span>
            Share
          </button>
          <button className="export-button" onClick={exportPreview}>
            Export
          </button>
        </div>
      </header>

      <nav className="menu-row" aria-label="Application menu">
        <div className="menu-items">
          {["File", "Edit", "Image", "Layer", "Select", "Filter", "View"].map(
            (item) => (
              <button key={item} onClick={() => notify(`${item} menu`)}>
                {item}
              </button>
            ),
          )}
        </div>
        <div className="history-actions">
          <button
            disabled={historyStep === 0}
            onClick={() => {
              setHistoryStep((value) => Math.max(0, value - 1));
              notify("Undid last edit");
            }}
            aria-label="Undo"
            title="Undo"
          >
            ↶
          </button>
          <button
            disabled={historyStep === 2}
            onClick={() => {
              setHistoryStep((value) => Math.min(2, value + 1));
              notify("Redid edit");
            }}
            aria-label="Redo"
            title="Redo"
          >
            ↷
          </button>
        </div>
      </nav>

      <section className="workspace">
        <aside className="toolbar" aria-label="Editing tools">
          <div className="tool-stack">
            {tools.slice(0, 8).map((tool) => (
              <button
                key={tool.id}
                className={`tool-button ${activeTool === tool.id ? "active" : ""}`}
                onClick={() => setActiveTool(tool.id)}
                aria-label={`${tool.label} tool`}
                title={`${tool.label} (${tool.shortcut})`}
              >
                <span className={`tool-glyph glyph-${tool.id}`}>{tool.icon}</span>
                <span className="tool-tip">
                  {tool.label}
                  <kbd>{tool.shortcut}</kbd>
                </span>
              </button>
            ))}
          </div>
          <div className="tool-stack bottom-tools">
            {tools.slice(8).map((tool) => (
              <button
                key={tool.id}
                className={`tool-button ${activeTool === tool.id ? "active" : ""}`}
                onClick={() => setActiveTool(tool.id)}
                aria-label={`${tool.label} tool`}
                title={`${tool.label} (${tool.shortcut})`}
              >
                <span className={`tool-glyph glyph-${tool.id}`}>{tool.icon}</span>
              </button>
            ))}
            <div className="color-wells" title="Foreground and background colors">
              <span className="color-back" />
              <span className="color-front" />
            </div>
          </div>
        </aside>

        <section className="canvas-area" aria-label="Image canvas">
          <div className="context-bar">
            <div className="context-group">
              <span className="context-label">
                {tools.find((tool) => tool.id === activeTool)?.label}
              </span>
              <span className="context-divider" />
              <button className="context-select">
                Auto select <span>⌄</span>
              </button>
              <label className="toggle-control">
                <input type="checkbox" defaultChecked />
                <span />
                Show transform controls
              </label>
            </div>
            <button className="quick-action" onClick={() => notify("Subject selected")}>
              Select subject
            </button>
          </div>

          <div className="stage">
            <div
              className="artboard-wrap"
              style={{ transform: `scale(${zoom / 100})` }}
            >
              <div
                className={`artboard ${activeTool === "crop" ? "cropping" : ""}`}
              >
                {showImage && (
                  <img
                    className="canvas-image"
                    src={imageUrl}
                    alt="Orange desert dunes under a deep blue sky"
                    style={{ filter: imageFilter }}
                  />
                )}
                {showColor && !showBefore && <div className="color-grade" />}
                <div className="soft-glow" />
                {activeTool === "select" && (
                  <div className="selection-marquee" aria-hidden="true" />
                )}
                {activeTool === "crop" && (
                  <div className="crop-grid" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                    <span />
                  </div>
                )}
                <div className="image-caption">
                  <span>DESERT</span>
                  <strong>DREAMS</strong>
                </div>
              </div>
            </div>

            <div className="ai-bar">
              <span className="ai-spark">✦</span>
              <input
                value={aiPrompt}
                onChange={(event) => setAiPrompt(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") runGenerativeFill();
                }}
                placeholder="Describe an edit…"
                aria-label="Describe a generative edit"
              />
              <button className="ai-reference" onClick={() => fileInput.current?.click()}>
                ＋ Reference
              </button>
              <button className="generate-button" onClick={runGenerativeFill}>
                Generate
              </button>
            </div>

            <div className="zoom-dock">
              <button
                onClick={() => setZoom((value) => Math.max(30, value - 10))}
                aria-label="Zoom out"
              >
                −
              </button>
              <input
                type="range"
                min="30"
                max="120"
                value={zoom}
                onChange={(event) => setZoom(Number(event.target.value))}
                aria-label="Canvas zoom"
              />
              <button
                onClick={() => setZoom((value) => Math.min(120, value + 10))}
                aria-label="Zoom in"
              >
                +
              </button>
              <span>{zoom}%</span>
            </div>
          </div>
        </section>

        <aside className="inspector">
          <div className="panel-tabs">
            <button
              className={panelTab === "edit" ? "active" : ""}
              onClick={() => setPanelTab("edit")}
            >
              Edit
            </button>
            <button
              className={panelTab === "layers" ? "active" : ""}
              onClick={() => setPanelTab("layers")}
            >
              Layers
            </button>
          </div>

          {panelTab === "edit" ? (
            <div className="panel-scroll">
              <section className="panel-section histogram-section">
                <div className="panel-heading">
                  <span>Histogram</span>
                  <button aria-label="More histogram options">•••</button>
                </div>
                <div className="histogram" aria-label="Image histogram">
                  {[12, 18, 24, 36, 68, 82, 62, 45, 72, 92, 74, 52, 43, 33, 18].map(
                    (height, index) => (
                      <i key={index} style={{ height: `${height}%` }} />
                    ),
                  )}
                </div>
                <div className="rgb-values">
                  <span>R 182</span>
                  <span>G 116</span>
                  <span>B 74</span>
                </div>
              </section>

              <section className="panel-section">
                <div className="panel-heading">
                  <span>Light &amp; color</span>
                  <button
                    onClick={() => {
                      setAdjustments(adjustmentDefaults);
                      notify("Adjustments reset");
                    }}
                  >
                    Reset
                  </button>
                </div>
                <button
                  className="enhance-button"
                  onClick={() => {
                    setAdjustments({
                      ...adjustmentDefaults,
                      exposure: 13,
                      contrast: 18,
                      saturation: 12,
                    });
                    notify("Auto enhanced");
                  }}
                >
                  <span>✦</span>
                  Auto enhance
                </button>

                <div className="slider-list">
                  {sliderConfig.slice(0, 6).map(([key, label, min, max]) => (
                    <label className="slider-row" key={key}>
                      <span className="slider-meta">
                        <span>{label}</span>
                        <output>{adjustments[key] > 0 ? "+" : ""}{adjustments[key]}</output>
                      </span>
                      <input
                        type="range"
                        min={min}
                        max={max}
                        value={adjustments[key]}
                        onChange={(event) =>
                          updateAdjustment(key, Number(event.target.value))
                        }
                      />
                    </label>
                  ))}
                </div>
              </section>

              <section className="panel-section compact-section">
                <div className="panel-heading">
                  <span>Details</span>
                  <span className="chevron">⌄</span>
                </div>
                {sliderConfig.slice(6).map(([key, label, min, max]) => (
                  <label className="slider-row" key={key}>
                    <span className="slider-meta">
                      <span>{label}</span>
                      <output>{adjustments[key]}</output>
                    </span>
                    <input
                      type="range"
                      min={min}
                      max={max}
                      value={adjustments[key]}
                      onChange={(event) =>
                        updateAdjustment(key, Number(event.target.value))
                      }
                    />
                  </label>
                ))}
              </section>
            </div>
          ) : (
            <div className="layers-panel">
              <div className="layers-header">
                <span>3 layers</span>
                <button onClick={() => notify("Layer options")}>•••</button>
              </div>
              <button className="layer-row active">
                <span className="visibility" onClick={() => setShowColor((v) => !v)}>
                  {showColor ? "◉" : "○"}
                </span>
                <span className="layer-thumb grade-thumb" />
                <span className="layer-copy">
                  <strong>Golden grade</strong>
                  <small>Color adjustment</small>
                </span>
              </button>
              <button className="layer-row">
                <span className="visibility">◉</span>
                <span className="layer-thumb text-thumb">T</span>
                <span className="layer-copy">
                  <strong>Desert Dreams</strong>
                  <small>Text</small>
                </span>
              </button>
              <button className="layer-row">
                <span className="visibility" onClick={() => setShowImage((v) => !v)}>
                  {showImage ? "◉" : "○"}
                </span>
                <span
                  className="layer-thumb photo-thumb"
                  style={{ backgroundImage: `url(${imageUrl})` }}
                />
                <span className="layer-copy">
                  <strong>{imageName}</strong>
                  <small>2200 × 1467</small>
                </span>
              </button>
              <div className="layer-footer">
                <button onClick={() => notify("New layer added")} aria-label="Add layer">
                  ＋
                </button>
                <button onClick={() => notify("Mask added")} aria-label="Add mask">
                  ◐
                </button>
                <button onClick={() => notify("Layer effects opened")} aria-label="Effects">
                  ƒx
                </button>
                <span />
                <button onClick={() => notify("Layer deleted")} aria-label="Delete layer">
                  ♲
                </button>
              </div>
            </div>
          )}
        </aside>
      </section>

      <footer className="statusbar">
        <button onClick={() => fileInput.current?.click()}>
          <span className="status-dot" />
          Open image
        </button>
        <div>
          <span>Display P3</span>
          <span>2200 × 1467 px</span>
          <span>28.4 MB</span>
        </div>
      </footer>

      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        onChange={chooseFile}
        className="visually-hidden"
      />

      {toast && (
        <div className="toast" role="status">
          <span>✓</span>
          {toast}
        </div>
      )}
    </main>
  );
}
