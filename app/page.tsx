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
  { id: "select", icon: "⌖", label: "Object select", shortcut: "W" },
  { id: "lasso", icon: "⌁", label: "Lasso", shortcut: "L" },
  { id: "brush", icon: "╱", label: "Brush", shortcut: "B" },
  { id: "heal", icon: "✣", label: "Heal", shortcut: "J" },
  { id: "clone", icon: "♟", label: "Clone stamp", shortcut: "S" },
  { id: "crop", icon: "⌗", label: "Crop", shortcut: "C" },
  { id: "gradient", icon: "◩", label: "Gradient", shortcut: "G" },
  { id: "type", icon: "T", label: "Type", shortcut: "T" },
  { id: "pen", icon: "⌃", label: "Pen", shortcut: "P" },
  { id: "hand", icon: "✋", label: "Hand", shortcut: "H" },
  { id: "zoom", icon: "⊕", label: "Zoom", shortcut: "Z" },
];

const toolGroups = [
  {
    name: "Select & mask",
    icon: "⌖",
    tools: [
      "Move",
      "Object Selection",
      "Marquee",
      "Lasso",
      "Polygonal Lasso",
      "Magic Wand",
      "Quick Selection",
      "Select Subject",
      "Focus Area",
      "Color Range",
      "Quick Mask",
    ],
  },
  {
    name: "Retouch & restore",
    icon: "✣",
    tools: [
      "Remove",
      "Spot Healing",
      "Healing Brush",
      "Patch",
      "Clone Stamp",
      "Content-Aware Move",
      "Red Eye",
      "Dodge",
      "Burn",
      "Sponge",
      "Blur",
      "Sharpen",
      "Smudge",
    ],
  },
  {
    name: "Paint & fill",
    icon: "╱",
    tools: [
      "Brush",
      "Pencil",
      "Mixer Brush",
      "Eraser",
      "Background Eraser",
      "Magic Eraser",
      "Gradient",
      "Paint Bucket",
      "Pattern Stamp",
      "History Brush",
      "Art History Brush",
    ],
  },
  {
    name: "Vector & type",
    icon: "T",
    tools: [
      "Pen",
      "Curvature Pen",
      "Freeform Pen",
      "Path Selection",
      "Direct Selection",
      "Type",
      "Type on Path",
      "Frame",
      "Rectangle",
      "Ellipse",
      "Polygon",
      "Custom Shape",
    ],
  },
  {
    name: "Transform & measure",
    icon: "⌗",
    tools: [
      "Crop",
      "Perspective Crop",
      "Slice",
      "Content-Aware Scale",
      "Puppet Warp",
      "Perspective Warp",
      "Liquify",
      "Ruler",
      "Count",
      "Eyedropper",
      "Color Sampler",
    ],
  },
] as const;

const neuralTools = [
  ["✦", "Generative fill", "Create inside any selection"],
  ["↔", "Generative expand", "Extend the canvas naturally"],
  ["⌫", "Remove anything", "Erase with scene-aware repair"],
  ["◐", "Relight scene", "Move and reshape the light"],
  ["◉", "Depth studio", "Edit by depth, not pixels"],
  ["↑", "Super resolution", "4× detail reconstruction"],
  ["♙", "Portrait lab", "Skin, gaze, hair and expression"],
  ["✧", "Restore", "Repair scratches and color loss"],
  ["▧", "Style match", "Learn a look from a reference"],
  ["◇", "Vectorize", "Turn raster forms into editable paths"],
] as const;

const effects = [
  { name: "Dune cinema", filter: "contrast(1.16) saturate(1.18) sepia(.12)" },
  { name: "Blue hour", filter: "contrast(1.08) saturate(.9) hue-rotate(12deg)" },
  { name: "Portra soft", filter: "contrast(.94) saturate(.88) sepia(.1)" },
  { name: "Chrome", filter: "contrast(1.3) saturate(.72)" },
  { name: "Dream bloom", filter: "brightness(1.08) saturate(1.1)" },
  { name: "Mono silver", filter: "grayscale(1) contrast(1.15)" },
] as const;

const filterFamilies = [
  ["Luma originals", "Atmosphere · Depth Light · Material Light · Film Bloom"],
  ["Blur", "Gaussian · Lens · Motion · Field · Radial · Surface · Tilt-shift"],
  ["Sharpen", "Smart Sharpen · Unsharp Mask · High Pass · AI Detail"],
  ["Distort", "Liquify · Displace · Wave · Ripple · Spherize · Polar"],
  ["Noise", "Add · Reduce · Dust & Scratches · Median · Despeckle"],
  ["Stylize", "Oil Paint · Emboss · Find Edges · Solarize · Wind · Diffuse"],
] as const;

const menuData: Record<string, string[]> = {
  File: ["New canvas…", "Open…", "Open recent", "Place embedded…", "Save a version", "Export…"],
  Edit: ["Undo", "Redo", "Content-aware fill…", "Generative fill…", "Free transform", "Preferences…"],
  Image: ["Adjustments", "Auto tone", "Canvas size…", "Image size…", "Rotate", "Trim"],
  Layer: ["New layer", "Duplicate", "Smart object", "Layer mask", "Clipping mask", "Merge visible"],
  Select: ["All", "Deselect", "Reselect", "Select subject", "Color range…", "Select and mask…"],
  Filter: ["Neural lab…", "Camera RAW…", "Liquify…", "Filter gallery…", "Smart sharpen…", "Other filters"],
  View: ["100%", "Fit canvas", "Split compare", "Proof colors", "Rulers", "Pixel grid"],
};

const historyItems = [
  "Opened Desert_Dreams",
  "Auto selected sky",
  "Created Golden grade",
  "Adjusted highlights",
  "Added title layer",
] as const;

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
  const [panelTab, setPanelTab] =
    useState<"edit" | "layers" | "effects" | "history">("edit");
  const [workspaceMode, setWorkspaceMode] = useState("Photo");
  const [adjustments, setAdjustments] = useState(adjustmentDefaults);
  const [imageUrl, setImageUrl] = useState("/desert.jpg");
  const [imageName, setImageName] = useState("Desert_Dreams");
  const [showImage, setShowImage] = useState(true);
  const [showColor, setShowColor] = useState(true);
  const [showBefore, setShowBefore] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const [toast, setToast] = useState("");
  const [historyStep, setHistoryStep] = useState(2);
  const [activeMenu, setActiveMenu] = useState<string | null>(null);
  const [showToolLibrary, setShowToolLibrary] = useState(false);
  const [showCommandCenter, setShowCommandCenter] = useState(false);
  const [commandSearch, setCommandSearch] = useState("");
  const [showNeuralLab, setShowNeuralLab] = useState(false);
  const [activeEffect, setActiveEffect] = useState("Dune cinema");
  const [layerOpacity, setLayerOpacity] = useState(100);
  const [blendMode, setBlendMode] = useState("Normal");
  const [sceneSelection, setSceneSelection] = useState("Whole image");
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
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setShowCommandCenter((value) => !value);
      }
      if (event.key === "Escape") {
        setShowCommandCenter(false);
        setShowToolLibrary(false);
        setShowNeuralLab(false);
        setActiveMenu(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const updateAdjustment = (key: AdjustmentKey, value: number) => {
    setAdjustments((current) => ({ ...current, [key]: value }));
    setHistoryStep(2);
  };

  const effectFilter = effects.find((effect) => effect.name === activeEffect)?.filter ?? "";
  const imageFilter = showBefore
    ? "none"
    : `brightness(${100 + adjustments.exposure + adjustments.shadows * 0.12}%) contrast(${100 + adjustments.contrast}%) saturate(${100 + adjustments.saturation}%) sepia(${Math.max(0, adjustments.temperature) * 0.3}%) ${effectFilter}`;

  const searchableCommands = [
    ...tools.map((tool) => tool.label),
    ...toolGroups.flatMap((group) => [...group.tools]),
    ...neuralTools.map((tool) => tool[1]),
    ...filterFamilies.flatMap((family) => family[1].split(" · ")),
    "Create layer mask",
    "Convert to smart object",
    "Edit channels",
    "Open paths panel",
    "Record action",
    "Create artboard",
    "Proof CMYK colors",
  ].filter(
    (command, index, list) =>
      list.indexOf(command) === index &&
      command.toLowerCase().includes(commandSearch.toLowerCase()),
  );

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
            className="command-button"
            onClick={() => setShowCommandCenter(true)}
            aria-label="Open command center"
            title="Command center (⌘K)"
          >
            <span>Search anything</span>
            <kbd>⌘ K</kbd>
          </button>
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
              <button
                key={item}
                className={activeMenu === item ? "active" : ""}
                onClick={() =>
                  setActiveMenu((current) => (current === item ? null : item))
                }
              >
                {item}
              </button>
            ),
          )}
          {activeMenu && (
            <div className="app-menu-popover">
              <div className="app-menu-title">{activeMenu}</div>
              {menuData[activeMenu].map((command, index) => (
                <button
                  key={command}
                  onClick={() => {
                    if (command.includes("Neural")) setShowNeuralLab(true);
                    if (command.includes("Open…")) fileInput.current?.click();
                    notify(command.replace("…", ""));
                    setActiveMenu(null);
                  }}
                >
                  <span>{command}</span>
                  {index < 2 && <kbd>{index === 0 ? "⌘ N" : "⌘ O"}</kbd>}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="workspace-modes" aria-label="Workspace modes">
          {["Photo", "Retouch", "Design", "AI"].map((mode) => (
            <button
              key={mode}
              className={workspaceMode === mode ? "active" : ""}
              onClick={() => {
                setWorkspaceMode(mode);
                if (mode === "AI") setShowNeuralLab(true);
                if (mode === "Photo") setPanelTab("edit");
                if (mode === "Design") setPanelTab("layers");
                notify(`${mode} workspace`);
              }}
            >
              {mode === "AI" && <span>✦</span>}
              {mode}
            </button>
          ))}
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
            {tools.slice(0, 9).map((tool) => (
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
            <button
              className={`tool-button more-tools ${showToolLibrary ? "active" : ""}`}
              onClick={() => setShowToolLibrary((value) => !value)}
              aria-label="All tools"
              title="All tools"
            >
              <span className="tool-glyph">•••</span>
            </button>
          </div>
          <div className="tool-stack bottom-tools">
            {tools.slice(9).map((tool) => (
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
          {showToolLibrary && (
            <div className="tool-library">
              <div className="tool-library-header">
                <div>
                  <strong>Every tool</strong>
                  <span>Focused when you need it</span>
                </div>
                <button onClick={() => setShowToolLibrary(false)} aria-label="Close">
                  ×
                </button>
              </div>
              <div className="tool-library-scroll">
                {toolGroups.map((group) => (
                  <section key={group.name} className="tool-family">
                    <div className="tool-family-title">
                      <span>{group.icon}</span>
                      <strong>{group.name}</strong>
                    </div>
                    <div className="tool-family-grid">
                      {group.tools.map((tool) => (
                        <button
                          key={tool}
                          onClick={() => {
                            setActiveTool(
                              tools.find((item) =>
                                tool.toLowerCase().includes(item.id),
                              )?.id ?? "move",
                            );
                            notify(`${tool} selected`);
                            setShowToolLibrary(false);
                          }}
                        >
                          {tool}
                        </button>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            </div>
          )}
        </aside>

        <section className="canvas-area" aria-label="Image canvas">
          <div className="context-bar">
            <div className="context-group">
              <span className="context-label">
                {tools.find((tool) => tool.id === activeTool)?.label}
              </span>
              <span className="context-divider" />
              <div className="scene-map" aria-label="Scene-aware selections">
                {["Whole image", "Sky", "Dunes", "Shadows"].map((part) => (
                  <button
                    key={part}
                    className={sceneSelection === part ? "active" : ""}
                    onClick={() => {
                      setSceneSelection(part);
                      if (part !== "Whole image") setActiveTool("select");
                    }}
                  >
                    {part}
                  </button>
                ))}
              </div>
              <label className="toggle-control">
                <input type="checkbox" defaultChecked />
                <span />
                Show transform controls
              </label>
            </div>
            <button className="quick-action" onClick={() => notify("Subject selected")}>
              <span>✦</span> Smart select
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
              <button
                className="ai-mode-button"
                onClick={() => setShowNeuralLab(true)}
                aria-label="Open Neural Lab"
              >
                Neural Lab
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
            <button
              className={panelTab === "effects" ? "active" : ""}
              onClick={() => setPanelTab("effects")}
            >
              Effects
            </button>
            <button
              className={panelTab === "history" ? "active" : ""}
              onClick={() => setPanelTab("history")}
            >
              History
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

                <div className="smart-actions">
                  <button onClick={() => notify("Camera RAW opened")}>
                    <span>◒</span>
                    Camera RAW
                  </button>
                  <button onClick={() => notify("Curves opened")}>
                    <span>⌁</span>
                    Curves
                  </button>
                  <button onClick={() => notify("Levels opened")}>
                    <span>▥</span>
                    Levels
                  </button>
                </div>

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
              <section className="panel-section scene-section">
                <div className="panel-heading">
                  <span>Scene intelligence</span>
                  <span className="luma-badge">LUMA</span>
                </div>
                <p>Adjust meaningful parts of the image without making masks.</p>
                <div className="scene-buttons">
                  {["Sky", "Sand", "Horizon", "Light", "Typography"].map((part) => (
                    <button
                      key={part}
                      className={sceneSelection === part ? "active" : ""}
                      onClick={() => {
                        setSceneSelection(part);
                        notify(`${part} isolated nondestructively`);
                      }}
                    >
                      {part}
                    </button>
                  ))}
                </div>
              </section>
            </div>
          ) : panelTab === "layers" ? (
            <div className="layers-panel">
              <div className="layer-controls">
                <select
                  value={blendMode}
                  onChange={(event) => setBlendMode(event.target.value)}
                  aria-label="Blend mode"
                >
                  {["Normal", "Multiply", "Screen", "Overlay", "Soft Light", "Color", "Luminosity"].map(
                    (mode) => (
                      <option key={mode}>{mode}</option>
                    ),
                  )}
                </select>
                <label>
                  <span>Opacity</span>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={layerOpacity}
                    onChange={(event) => setLayerOpacity(Number(event.target.value))}
                  />
                  <output>{layerOpacity}%</output>
                </label>
              </div>
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
          ) : panelTab === "effects" ? (
            <div className="panel-scroll effects-panel">
              <section className="panel-section">
                <div className="panel-heading">
                  <span>Live looks</span>
                  <button onClick={() => notify("Look saved as a reusable capsule")}>
                    ＋ Save look
                  </button>
                </div>
                <div className="effect-grid">
                  {effects.map((effect) => (
                    <button
                      key={effect.name}
                      className={activeEffect === effect.name ? "active" : ""}
                      onClick={() => {
                        setActiveEffect(effect.name);
                        notify(`${effect.name} applied as a live effect`);
                      }}
                    >
                      <span
                        style={{
                          backgroundImage: `url(${imageUrl})`,
                          filter: effect.filter,
                        }}
                      />
                      <strong>{effect.name}</strong>
                    </button>
                  ))}
                </div>
              </section>
              <section className="panel-section">
                <div className="panel-heading">
                  <span>Filter library</span>
                  <button onClick={() => setShowCommandCenter(true)}>Search</button>
                </div>
                <div className="filter-families">
                  {filterFamilies.map(([family, items]) => (
                    <button
                      key={family}
                      onClick={() => notify(`${family} filters opened`)}
                    >
                      <span className="filter-family-icon">◌</span>
                      <span>
                        <strong>{family}</strong>
                        <small>{items}</small>
                      </span>
                      <b>›</b>
                    </button>
                  ))}
                </div>
              </section>
              <section className="panel-section live-stack">
                <div className="panel-heading">
                  <span>Live effect stack</span>
                  <span className="luma-badge">NONDESTRUCTIVE</span>
                </div>
                {["Golden grade", activeEffect, "Smart sharpen"].map((item, index) => (
                  <button key={`${item}-${index}`}>
                    <span>⠿</span>
                    <strong>{item}</strong>
                    <i>{index === 2 ? "42%" : "100%"}</i>
                    <b>◉</b>
                  </button>
                ))}
              </section>
            </div>
          ) : (
            <div className="history-panel">
              <div className="history-hero">
                <span>∞</span>
                <div>
                  <strong>Infinite history</strong>
                  <small>Every decision stays editable.</small>
                </div>
              </div>
              <div className="version-lane">
                <div className="version-heading">
                  <span>Current version</span>
                  <button onClick={() => notify("Created a new version lane")}>
                    ＋ Branch
                  </button>
                </div>
                {historyItems.map((item, index) => (
                  <button
                    key={item}
                    className={index <= historyStep + 2 ? "complete" : ""}
                    onClick={() => {
                      setHistoryStep(Math.max(0, index - 2));
                      notify(`Returned to “${item}”`);
                    }}
                  >
                    <span />
                    <div>
                      <strong>{item}</strong>
                      <small>{index === 0 ? "11:04 AM" : `${index * 2} min ago`}</small>
                    </div>
                  </button>
                ))}
              </div>
              <div className="branch-card">
                <span className="branch-preview warm" />
                <span className="branch-preview cool" />
                <div>
                  <strong>Explore without fear</strong>
                  <small>Branch any edit, compare, then merge what you like.</small>
                </div>
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
          <button onClick={() => setShowCommandCenter(true)}>
            <span className="status-spark">✦</span>
            86 tools ready
          </button>
          <span>Display P3</span>
          <span>2200 × 1467 px</span>
          <span>28.4 MB</span>
        </div>
      </footer>

      {showCommandCenter && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setShowCommandCenter(false);
          }}
        >
          <section className="command-center" aria-label="Command center">
            <div className="command-search">
              <span>⌕</span>
              <input
                autoFocus
                value={commandSearch}
                onChange={(event) => setCommandSearch(event.target.value)}
                placeholder="Find any tool, filter, action, or setting…"
                aria-label="Search commands"
              />
              <kbd>esc</kbd>
            </div>
            <div className="command-body">
              <div className="command-rail">
                <button className="active">⌕</button>
                <button onClick={() => setShowToolLibrary(true)}>⌘</button>
                <button onClick={() => setShowNeuralLab(true)}>✦</button>
                <button onClick={() => notify("Favorites opened")}>♡</button>
              </div>
              <div className="command-results">
                <div className="command-section-title">
                  {commandSearch ? "Best matches" : "Suggested for this image"}
                  <span>{searchableCommands.length} commands</span>
                </div>
                {!commandSearch && (
                  <div className="suggestion-cards">
                    <button onClick={() => notify("Sky mask created")}>
                      <span className="suggestion-icon blue">◒</span>
                      <div>
                        <strong>Refine the sky</strong>
                        <small>Scene-aware mask + curves</small>
                      </div>
                    </button>
                    <button onClick={() => setShowNeuralLab(true)}>
                      <span className="suggestion-icon violet">✦</span>
                      <div>
                        <strong>Extend the horizon</strong>
                        <small>Generative expand</small>
                      </div>
                    </button>
                  </div>
                )}
                <div className="command-list">
                  {searchableCommands.slice(0, 11).map((command, index) => (
                    <button
                      key={command}
                      onClick={() => {
                        if (command.toLowerCase().includes("generative"))
                          setShowNeuralLab(true);
                        notify(`${command} opened`);
                        setShowCommandCenter(false);
                      }}
                    >
                      <span className="command-item-icon">
                        {index % 3 === 0 ? "✦" : index % 3 === 1 ? "⌘" : "◐"}
                      </span>
                      <span>{command}</span>
                      <kbd>↵</kbd>
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="command-footer">
              <span><kbd>↑↓</kbd> Navigate</span>
              <span><kbd>↵</kbd> Open</span>
              <span>Luma learns what you reach for.</span>
            </div>
          </section>
        </div>
      )}

      {showNeuralLab && (
        <div
          className="modal-backdrop neural-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setShowNeuralLab(false);
          }}
        >
          <section className="neural-lab" aria-label="Neural Lab">
            <header>
              <div>
                <span className="neural-logo">✦</span>
                <div>
                  <strong>Neural Lab</strong>
                  <small>Creative intelligence that stays editable</small>
                </div>
              </div>
              <button onClick={() => setShowNeuralLab(false)} aria-label="Close">
                ×
              </button>
            </header>
            <div className="neural-feature">
              <div className="neural-copy">
                <span className="beta-label">SCENE MODEL · ON DEVICE READY</span>
                <h2>Describe the result.<br />Keep every decision.</h2>
                <p>
                  Luma builds a transparent stack of masks, adjustments and generated
                  layers—never one irreversible pixel soup.
                </p>
                <button
                  onClick={() => {
                    setShowNeuralLab(false);
                    notify("Generative workspace ready");
                  }}
                >
                  Start with this image <span>→</span>
                </button>
              </div>
              <div className="neural-visual" style={{ backgroundImage: `url(${imageUrl})` }}>
                <span className="depth-plane plane-one">Sky · 0.9</span>
                <span className="depth-plane plane-two">Dunes · 0.6</span>
                <span className="depth-plane plane-three">Foreground · 0.2</span>
              </div>
            </div>
            <div className="neural-grid">
              {neuralTools.map(([icon, name, description]) => (
                <button
                  key={name}
                  onClick={() => {
                    notify(`${name} ready`);
                    setShowNeuralLab(false);
                  }}
                >
                  <span>{icon}</span>
                  <div>
                    <strong>{name}</strong>
                    <small>{description}</small>
                  </div>
                  <b>›</b>
                </button>
              ))}
            </div>
            <footer>
              <span><i /> Local-first processing</span>
              <span>Cloud only when a model needs it</span>
            </footer>
          </section>
        </div>
      )}

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
