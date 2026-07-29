"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";

type ToneKey =
  | "exposure"
  | "contrast"
  | "highlights"
  | "shadows"
  | "temperature"
  | "vibrance";
type WorkspaceMode = "edit" | "mask" | "develop" | "depth";
type LayerKind = "image" | "adjustment" | "mask" | "text" | "mesh";

type StudioLayer = {
  id: string;
  name: string;
  kind: LayerKind;
  visible: boolean;
  opacity: number;
  blend: string;
};

type BatchItem = {
  id: string;
  name: string;
  url: string;
  status: "queued" | "processing" | "ready";
};

const modeTools: Record<
  WorkspaceMode,
  ReadonlyArray<readonly [string, string, string, string]>
> = {
  edit: [
    ["move", "↖", "Move", "V"],
    ["crop", "⌗", "Crop", "C"],
    ["heal", "◇", "Heal", "J"],
    ["brush", "╱", "Brush", "B"],
    ["gradient", "◩", "Gradient", "G"],
    ["type", "T", "Type", "T"],
    ["shape", "○", "Shape", "U"],
    ["history", "◴", "History", "Y"],
  ],
  mask: [
    ["subject", "✦", "Select subject", "S"],
    ["smart", "◉", "Smart select", "Q"],
    ["wand", "✣", "Magic wand", "W"],
    ["lasso", "⌁", "Lasso", "L"],
    ["maskbrush", "╱", "Mask brush", "B"],
    ["grow", "⊕", "Grow mask", "]"],
    ["shrink", "⊖", "Shrink mask", "["],
    ["feather", "◌", "Feather", "F"],
  ],
  develop: [
    ["tone", "◐", "Tone", "T"],
    ["curves", "⌁", "Curves", "C"],
    ["color", "◉", "Color", "H"],
    ["detail", "✣", "Detail", "D"],
    ["blur", "◌", "Blur", "R"],
    ["gradientmap", "◩", "Gradient map", "G"],
    ["blackwhite", "◑", "Black & white", "M"],
    ["compare", "◧", "Compare", "Y"],
  ],
  depth: [
    ["orbit", "◎", "Orbit", "O"],
    ["move3d", "↗", "Translate", "V"],
    ["mesh", "◇", "Add mesh", "M"],
    ["paint3d", "╱", "Paint mesh", "B"],
    ["sculpt", "◒", "Sculpt", "S"],
    ["light", "☼", "Light", "L"],
    ["material", "◈", "Material", "A"],
    ["keyframe", "◆", "Keyframe", "K"],
  ],
};

const workspaces: ReadonlyArray<readonly [WorkspaceMode, string, string]> = [
  ["edit", "Edit", "Pixel + vector"],
  ["mask", "Mask", "Selection intelligence"],
  ["develop", "Develop", "Nondestructive color"],
  ["depth", "3D", "Unified canvas"],
];

const toolFamilies = [
  {
    name: "Select & mask",
    tools: ["Select subject", "Smart select", "Marquee", "Lasso", "Magic wand", "Color range"],
  },
  {
    name: "Retouch & paint",
    tools: ["Remove", "Spot heal", "Clone stamp", "Brush", "Smudge", "Dodge & burn"],
  },
  {
    name: "Design",
    tools: ["Type", "Shape", "Gradient", "Image plane", "Path selection", "Free transform"],
  },
  {
    name: "3D & motion",
    tools: ["Add mesh", "Paint mesh", "Sculpt", "Boolean", "Auto rig", "Keyframe"],
  },
] as const;

const filmstrip = [
  { name: "Dunes", src: "/desert.jpg" },
  { name: "Canyon", src: "/film-desert.jpg" },
  { name: "Wave", src: "/film-wave.jpg" },
  { name: "Sunrise", src: "/film-sun.jpg" },
  { name: "Peaks", src: "/film-mountain.jpg" },
  { name: "Lake", src: "/film-lake.jpg" },
] as const;

const toneRows: Array<[ToneKey, string, number, number]> = [
  ["exposure", "Exposure", -50, 50],
  ["contrast", "Contrast", -50, 50],
  ["highlights", "Highlights", -50, 50],
  ["shadows", "Shadows", -50, 50],
  ["temperature", "Temperature", -50, 50],
  ["vibrance", "Vibrance", -50, 50],
];

const defaultTone: Record<ToneKey, number> = {
  exposure: 8,
  contrast: 12,
  highlights: -28,
  shadows: 24,
  temperature: 7,
  vibrance: 18,
};

const initialLayers: StudioLayer[] = [
  { id: "grade", name: "Desert grade", kind: "adjustment", visible: true, opacity: 82, blend: "Soft Light" },
  { id: "mask", name: "Subject mask", kind: "mask", visible: false, opacity: 100, blend: "Normal" },
  { id: "image", name: "Dunes", kind: "image", visible: true, opacity: 100, blend: "Normal" },
];

const neuralActions = [
  ["✦", "Select subject", "Build an editable subject mask"],
  ["⌫", "Remove background", "Keep transparency and edges"],
  ["◐", "Auto enhance", "Balance tone, color and detail"],
  ["◉", "Relight", "Move the key light through depth"],
  ["↑", "Super resolution", "Upscale with texture protection"],
  ["▦", "Batch studio", "Process a complete photo set"],
] as const;

export default function SpatialStudio() {
  const [workspace, setWorkspace] = useState<WorkspaceMode>("edit");
  const [activeTool, setActiveTool] = useState("move");
  const [activePhoto, setActivePhoto] = useState(0);
  const [customPhoto, setCustomPhoto] = useState<string | null>(null);
  const [customName, setCustomName] = useState("Imported photo");
  const [tone, setTone] = useState(defaultTone);
  const [layers, setLayers] = useState(initialLayers);
  const [activeLayerId, setActiveLayerId] = useState("image");
  const [brushSize, setBrushSize] = useState(48);
  const [hardness, setHardness] = useState(72);
  const [feather, setFeather] = useState(12);
  const [maskVisible, setMaskVisible] = useState(false);
  const [cutout, setCutout] = useState(false);
  const [compare, setCompare] = useState(false);
  const [aiWorking, setAiWorking] = useState("");
  const [showTools, setShowTools] = useState(false);
  const [showCommand, setShowCommand] = useState(false);
  const [showNeural, setShowNeural] = useState(false);
  const [showBatch, setShowBatch] = useState(false);
  const [batchItems, setBatchItems] = useState<BatchItem[]>([]);
  const [historyItems, setHistoryItems] = useState([
    "Opened Dunes",
    "Added Desert grade",
    "Raised shadows",
  ]);
  const [toast, setToast] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const batchInput = useRef<HTMLInputElement>(null);

  const currentPhoto = customPhoto
    ? { name: customName, src: customPhoto }
    : filmstrip[activePhoto];
  const activeLayer = layers.find((layer) => layer.id === activeLayerId) ?? layers[0];
  const currentTools = modeTools[workspace];

  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 1900);
  };

  const commit = (message: string) => {
    setHistoryItems((items) => [...items.slice(-7), message]);
    notify(message);
  };

  const switchWorkspace = (next: WorkspaceMode) => {
    setWorkspace(next);
    setActiveTool(modeTools[next][0][0]);
    if (next === "mask") setMaskVisible(true);
    if (next === "depth") setMaskVisible(false);
  };

  const updateTone = (key: ToneKey, value: number) => {
    setTone((current) => ({ ...current, [key]: value }));
  };

  const selectPhoto = (index: number) => {
    setCustomPhoto(null);
    setActivePhoto(index);
    setLayers((items) =>
      items.map((layer) =>
        layer.kind === "image" ? { ...layer, name: filmstrip[index].name } : layer,
      ),
    );
    commit(`${filmstrip[index].name} opened`);
  };

  const openFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    const name = file.name.replace(/\.[^/.]+$/, "") || "Imported photo";
    setCustomPhoto(url);
    setCustomName(name);
    setLayers((items) =>
      items.map((layer) => (layer.kind === "image" ? { ...layer, name } : layer)),
    );
    commit(`${name} imported as a layer`);
    event.target.value = "";
  };

  const openBatchFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (!files.length) return;
    setBatchItems(
      files.map((file) => ({
        id: crypto.randomUUID(),
        name: file.name,
        url: URL.createObjectURL(file),
        status: "queued",
      })),
    );
    setShowBatch(true);
    event.target.value = "";
  };

  const runBatch = () => {
    if (!batchItems.length) {
      batchInput.current?.click();
      return;
    }
    setBatchItems((items) => items.map((item) => ({ ...item, status: "processing" })));
    setAiWorking("Batch studio");
    window.setTimeout(() => {
      setBatchItems((items) => items.map((item) => ({ ...item, status: "ready" })));
      setAiWorking("");
      commit(`${batchItems.length} photos finished locally`);
    }, 1200);
  };

  const updateLayer = (id: string, patch: Partial<StudioLayer>) => {
    setLayers((items) => items.map((layer) => (layer.id === id ? { ...layer, ...patch } : layer)));
  };

  const addLayer = (kind: LayerKind) => {
    const labels: Record<LayerKind, string> = {
      image: "New image",
      adjustment: "Curves",
      mask: "Layer mask",
      text: "WANDER FARTHER",
      mesh: "Painted mesh",
    };
    const layer: StudioLayer = {
      id: `${kind}-${Date.now()}`,
      name: labels[kind],
      kind,
      visible: true,
      opacity: 100,
      blend: kind === "adjustment" ? "Soft Light" : "Normal",
    };
    setLayers((items) => [layer, ...items]);
    setActiveLayerId(layer.id);
    if (kind === "text") setActiveTool("type");
    if (kind === "mesh") switchWorkspace("depth");
    commit(`${labels[kind]} added`);
  };

  const runNeural = (action: string) => {
    if (action === "Batch studio") {
      setShowNeural(false);
      setShowBatch(true);
      return;
    }
    setAiWorking(action);
    setShowNeural(false);
    if (action === "Select subject" || action === "Remove background") {
      switchWorkspace("mask");
      setMaskVisible(true);
    }
    window.setTimeout(() => {
      if (action === "Remove background") setCutout(true);
      if (action === "Auto enhance") {
        setTone({ exposure: 6, contrast: 18, highlights: -22, shadows: 30, temperature: 4, vibrance: 26 });
      }
      if (action === "Relight") switchWorkspace("depth");
      setAiWorking("");
      commit(`${action} completed as an editable ${action === "Super resolution" ? "image layer" : "mask"}`);
    }, 900);
  };

  const exportImage = () => {
    const link = document.createElement("a");
    link.href = currentPhoto.src;
    link.download = `${currentPhoto.name}-luma.jpg`;
    link.click();
    commit("Flattened preview exported");
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      const tool = currentTools.find(
        ([, , , shortcut]) => shortcut.toLowerCase() === event.key.toLowerCase(),
      );
      if (tool) setActiveTool(tool[0]);
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setShowCommand(true);
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        commit(event.shiftKey ? "Redo" : "Undo");
      }
      if (event.key === "Escape") {
        setShowTools(false);
        setShowCommand(false);
        setShowNeural(false);
        setShowBatch(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [currentTools]);

  const imageFilter = useMemo(() => {
    if (compare) return "none";
    const warmth = tone.temperature * 0.12;
    return `brightness(${100 + tone.exposure + tone.shadows * 0.12}%) contrast(${100 + tone.contrast}%) saturate(${100 + tone.vibrance * 0.55}%) sepia(${Math.max(0, warmth)}%)`;
  }, [compare, tone]);

  const imageLayerVisible = layers.some((layer) => layer.kind === "image" && layer.visible);
  const gradeVisible = layers.some((layer) => layer.kind === "adjustment" && layer.visible);
  const textVisible = layers.some((layer) => layer.kind === "text" && layer.visible);
  const meshVisible = workspace === "depth" || layers.some((layer) => layer.kind === "mesh" && layer.visible);

  return (
    <main className="spatial-studio">
      <div className="spatial-aura aura-blue" />
      <div className="spatial-aura aura-violet" />

      <section className="spatial-window">
        <header className="spatial-topbar">
          <div className="spatial-window-controls">
            <span className="dot-red" />
            <span className="dot-yellow" />
            <span className="dot-green" />
            <button onClick={() => history.back()} aria-label="Back">‹</button>
            <button onClick={() => fileInput.current?.click()} aria-label="Import image">↗</button>
          </div>

          <nav className="workspace-switcher" aria-label="Studio workspace">
            {workspaces.map(([id, label, description]) => (
              <button
                key={id}
                className={workspace === id ? "active" : ""}
                onClick={() => switchWorkspace(id)}
                title={description}
              >
                {label}
              </button>
            ))}
          </nav>

          <div className="spatial-share-actions">
            <button className="batch-top-button" onClick={() => setShowBatch(true)}>
              <span>▦</span> Batch
            </button>
            <button className="spatial-search" onClick={() => setShowCommand(true)} title="Search anything">
              ⌕ <kbd>⌘K</kbd>
            </button>
            <button className="spatial-export" onClick={exportImage}>Export ↗</button>
          </div>
        </header>

        <div className="spatial-workspace">
          <aside className="spatial-toolbar" aria-label={`${workspace} tools`}>
            <div>
              {currentTools.map(([id, icon, label, shortcut]) => (
                <button
                  key={id}
                  className={activeTool === id ? "active" : ""}
                  onClick={() => {
                    setActiveTool(id);
                    if (id === "subject") runNeural("Select subject");
                    if (id === "compare") setCompare((value) => !value);
                    if (id === "keyframe") commit("Transform keyframe added");
                    if (id === "mesh") addLayer("mesh");
                    if (["wand", "lasso", "smart", "maskbrush", "subject"].includes(id)) setMaskVisible(true);
                  }}
                  aria-label={label}
                  title={`${label} (${shortcut})`}
                >
                  <span>{icon}</span>
                  <i>{label}<kbd>{shortcut}</kbd></i>
                </button>
              ))}
              <button
                className={showTools ? "active tool-more" : "tool-more"}
                onClick={() => setShowTools((value) => !value)}
                aria-label="All tools"
              >
                •••
              </button>
            </div>
            <button className="layers-orb" onClick={() => setShowNeural(true)} aria-label="Neural Lab">✦</button>
          </aside>

          <section className="spatial-canvas-column">
            <div className="spatial-canvas-stage">
              <div className={`spatial-canvas tool-${activeTool} workspace-${workspace} ${cutout ? "cutout-active" : ""}`}>
                {imageLayerVisible && (
                  <img src={currentPhoto.src} alt={`${currentPhoto.name} open in Luma Studio`} style={{ filter: imageFilter }} />
                )}
                {gradeVisible && !compare && <div className="spatial-grade" />}
                {cutout && <div className="cutout-vignette" />}
                {maskVisible && workspace === "mask" && (
                  <div className="live-mask">
                    <span>SUBJECT · LIVE MASK</span>
                    <i className="mask-point keep">+</i>
                    <i className="mask-point remove">−</i>
                  </div>
                )}
                {activeTool === "crop" && (
                  <div className="spatial-crop-grid"><i /><i /><i /><i /></div>
                )}
                {(activeTool === "type" || textVisible) && (
                  <div className="spatial-type-layer"><span>WANDER</span><strong>FARTHER</strong></div>
                )}
                {activeTool === "gradient" && <div className="gradient-guide"><i /><span /><i /></div>}
                {meshVisible && (
                  <div className="depth-scene" aria-label="3D mesh preview">
                    <div className="depth-grid" />
                    <div className="mesh-object">
                      <i /><i /><i /><i /><i /><i />
                    </div>
                    <span className="depth-label">Painted mesh · P3 material</span>
                    <div className="axis-gizmo"><b>X</b><b>Y</b><b>Z</b></div>
                  </div>
                )}
                {aiWorking && (
                  <div className="ai-processing">
                    <i>✦</i><strong>{aiWorking}</strong><span>Running locally</span>
                  </div>
                )}
                <div className="canvas-status">
                  <span>{workspace === "depth" ? "Perspective · 3D + raster" : "Display P3 · 32-bit preview"}</span>
                  <span>100%</span>
                </div>
              </div>
            </div>

            <div className="spatial-filmstrip">
              <div className="filmstrip-mode">
                <strong>{workspaces.find(([id]) => id === workspace)?.[1]}</strong>
                <span>{layers.length} layers</span>
              </div>
              {customPhoto && (
                <button className="active" onClick={() => setCustomPhoto(customPhoto)}>
                  <img src={customPhoto} alt="" /><span>{customName}</span>
                </button>
              )}
              {filmstrip.map((photo, index) => (
                <button
                  key={photo.name}
                  className={!customPhoto && activePhoto === index ? "active" : ""}
                  onClick={() => selectPhoto(index)}
                  aria-label={`Open ${photo.name}`}
                >
                  <img src={photo.src} alt="" /><span>{photo.name}</span>
                </button>
              ))}
              <button className="film-add" onClick={() => fileInput.current?.click()} aria-label="Add photo">＋</button>
            </div>
          </section>

          <aside className="spatial-inspector">
            <section className="glass-card layers-card">
              <header>
                <strong>Layers</strong>
                <div className="layer-add-menu">
                  <button onClick={() => addLayer(workspace === "depth" ? "mesh" : "adjustment")}>＋</button>
                </div>
              </header>
              <div className="layer-stack">
                {layers.map((layer) => (
                  <button
                    key={layer.id}
                    className={`spatial-layer ${activeLayerId === layer.id ? "active" : ""}`}
                    onClick={() => setActiveLayerId(layer.id)}
                  >
                    <span
                      className={`spatial-layer-thumb kind-${layer.kind}`}
                      style={layer.kind === "image" ? { backgroundImage: `url(${currentPhoto.src})` } : undefined}
                    >
                      {layer.kind === "adjustment" ? "◐" : layer.kind === "mask" ? "◩" : layer.kind === "text" ? "T" : layer.kind === "mesh" ? "◇" : ""}
                    </span>
                    <span className="layer-name"><strong>{layer.name}</strong><small>{layer.kind}</small></span>
                    <i
                      onClick={(event) => {
                        event.stopPropagation();
                        updateLayer(layer.id, { visible: !layer.visible });
                      }}
                    >
                      {layer.visible ? "◉" : "○"}
                    </i>
                  </button>
                ))}
              </div>
              {activeLayer && (
                <div className="layer-controls">
                  <select
                    aria-label="Blend mode"
                    value={activeLayer.blend}
                    onChange={(event) => updateLayer(activeLayer.id, { blend: event.target.value })}
                  >
                    {["Normal", "Multiply", "Screen", "Overlay", "Soft Light", "Color Dodge", "Difference"].map((mode) => (
                      <option key={mode}>{mode}</option>
                    ))}
                  </select>
                  <label>
                    <span>Opacity</span>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={activeLayer.opacity}
                      onChange={(event) => updateLayer(activeLayer.id, { opacity: Number(event.target.value) })}
                    />
                    <output>{activeLayer.opacity}%</output>
                  </label>
                </div>
              )}
            </section>

            {workspace === "mask" ? (
              <section className="glass-card mask-card">
                <header><strong>Mask refinement</strong><button onClick={() => setMaskVisible(false)}>×</button></header>
                <div className="mask-segmented">
                  <button className="active">Keep</button><button>Remove</button>
                </div>
                <div className="mask-controls">
                  <label><span>Brush</span><input type="range" min="4" max="200" value={brushSize} onChange={(event) => setBrushSize(Number(event.target.value))} /><output>{brushSize}</output></label>
                  <label><span>Hardness</span><input type="range" min="0" max="100" value={hardness} onChange={(event) => setHardness(Number(event.target.value))} /><output>{hardness}%</output></label>
                  <label><span>Feather</span><input type="range" min="0" max="64" value={feather} onChange={(event) => setFeather(Number(event.target.value))} /><output>{feather}px</output></label>
                </div>
                <div className="mask-actions">
                  <button onClick={() => commit("Mask grown 2 px")}>Grow</button>
                  <button onClick={() => commit("Mask shrunk 2 px")}>Shrink</button>
                  <button onClick={() => commit("Mask edge smoothed")}>Smooth</button>
                  <button onClick={() => setCutout((value) => !value)}>{cutout ? "Show background" : "Remove background"}</button>
                </div>
              </section>
            ) : workspace === "depth" ? (
              <section className="glass-card depth-card">
                <header><strong>Scene & material</strong><button onClick={() => commit("Viewport rendered to layer")}>↧</button></header>
                <div className="scene-list">
                  <button className="active"><i className="scene-dot violet" /><span>Painted mesh</span><small>Mesh</small></button>
                  <button><i className="scene-dot amber" /><span>Key light</span><small>62%</small></button>
                  <button><i className="scene-dot blue" /><span>Camera</span><small>35mm</small></button>
                </div>
                <div className="material-sliders">
                  <label><span>Roughness</span><input type="range" defaultValue="36" /></label>
                  <label><span>Metallic</span><input type="range" defaultValue="12" /></label>
                  <label><span>Depth</span><input type="range" defaultValue="58" /></label>
                </div>
                <div className="timeline-mini">
                  <header><span>Timeline</span><button onClick={() => commit("Animation playing")}>▶</button><strong>03:12</strong></header>
                  <div><i style={{ left: "12%" }} /><i style={{ left: "48%" }} /><i style={{ left: "82%" }} /><span /></div>
                </div>
              </section>
            ) : (
              <section className="glass-card tone-card">
                <header>
                  <strong>{workspace === "develop" ? "Develop stack" : "Tone"}</strong>
                  <button onClick={() => { setTone(defaultTone); commit("Tone reset"); }} aria-label="Reset tone">↺</button>
                </header>
                <div className="adjustment-chips">
                  {workspace === "develop" && ["Curves", "Levels", "Gradient map", "B&W"].map((item) => <button key={item}>{item}</button>)}
                </div>
                <div className="tone-controls">
                  {toneRows.map(([key, label, min, max]) => (
                    <label key={key}>
                      <span>{label}</span>
                      <input type="range" min={min} max={max} value={tone[key]} onChange={(event) => updateTone(key, Number(event.target.value))} />
                      <output>{key === "exposure" ? (tone[key] / 50).toFixed(2) : tone[key]}</output>
                    </label>
                  ))}
                </div>
                {workspace === "develop" && <div className="curve-graph"><i /><i /><i /><i /><span /></div>}
              </section>
            )}

            <section className="glass-card neural-card neural-compact">
              <header>
                <strong><span>✦</span> Neural Lab</strong>
                <small>ON DEVICE</small>
              </header>
              <div className="neural-quick-grid">
                <button onClick={() => runNeural("Select subject")}><i>✦</i><span>Select</span></button>
                <button onClick={() => runNeural("Remove background")}><i>⌫</i><span>Remove</span></button>
                <button onClick={() => runNeural("Auto enhance")}><i>◐</i><span>Enhance</span></button>
                <button onClick={() => setShowNeural(true)}><i>•••</i><span>More</span></button>
              </div>
            </section>

            <div className="spatial-view-dock">
              <button onClick={() => commit("Undo")} title="Undo">↶</button>
              <button onClick={() => commit("Redo")} title="Redo">↷</button>
              <button onClick={() => setCompare((value) => !value)} title="Compare">◫</button>
              <span />
              <button onClick={() => notify(`${historyItems.length} history states`)} title="History">◴</button>
            </div>
          </aside>
        </div>
      </section>

      {showTools && (
        <aside className="spatial-tool-drawer">
          <header>
            <div><strong>Everything in one studio</strong><span>Raster, AI, design, 3D and motion.</span></div>
            <button onClick={() => setShowTools(false)}>×</button>
          </header>
          <div>
            {toolFamilies.map((family) => (
              <section key={family.name}>
                <strong>{family.name}</strong>
                <div>
                  {family.tools.map((tool) => (
                    <button key={tool} onClick={() => { commit(`${tool} selected`); setShowTools(false); }}>
                      {tool}<span>›</span>
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </aside>
      )}

      {showCommand && (
        <div className="spatial-modal" onMouseDown={() => setShowCommand(false)}>
          <section className="spatial-command" onMouseDown={(event) => event.stopPropagation()}>
            <div><span>⌕</span><input autoFocus placeholder="Tool, adjustment, effect or action…" /><kbd>esc</kbd></div>
            <p>Suggested for this image</p>
            {["Select the dunes with AI", "Open batch background removal", "Add nondestructive Curves", "Paint this image onto a 3D mesh", "Create a transparent cutout"].map((command, index) => (
              <button key={command} onClick={() => {
                if (index === 0 || index === 4) switchWorkspace("mask");
                if (index === 1) setShowBatch(true);
                if (index === 2) addLayer("adjustment");
                if (index === 3) switchWorkspace("depth");
                commit(command);
                setShowCommand(false);
              }}>
                <i>{index < 2 ? "✦" : "⌘"}</i><span>{command}</span><kbd>↵</kbd>
              </button>
            ))}
          </section>
        </div>
      )}

      {showNeural && (
        <div className="spatial-modal" onMouseDown={() => setShowNeural(false)}>
          <section className="spatial-neural-modal neural-suite" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <span>✦</span>
              <div><strong>Neural Lab</strong><small>Local intelligence. Every result remains editable.</small></div>
              <button onClick={() => setShowNeural(false)}>×</button>
            </header>
            <div className="spatial-neural-preview">
              <img src={currentPhoto.src} alt="" />
              <i className="mask-sky">Sky · 0.98</i>
              <i className="mask-subject">Dunes · 0.94</i>
              <i className="mask-ground">Foreground · 0.91</i>
            </div>
            <div className="spatial-neural-actions">
              {neuralActions.map(([icon, label, description]) => (
                <button key={label} onClick={() => runNeural(label)}>
                  <span>{icon}</span><span><strong>{label}</strong><small>{description}</small></span><i>›</i>
                </button>
              ))}
            </div>
          </section>
        </div>
      )}

      {showBatch && (
        <div className="spatial-modal" onMouseDown={() => setShowBatch(false)}>
          <section className="batch-modal" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div><span>▦</span><div><strong>Batch Studio</strong><small>Private, local processing for complete photo sets</small></div></div>
              <button onClick={() => setShowBatch(false)}>×</button>
            </header>
            <div className="batch-toolbar">
              <div><button className="active">Remove background</button><button>Auto enhance</button><button>Square framing</button><button>Contact shadow</button></div>
              <button onClick={() => batchInput.current?.click()}>＋ Add photos</button>
            </div>
            <div className={`batch-grid ${batchItems.length ? "" : "empty"}`}>
              {!batchItems.length ? (
                <button onClick={() => batchInput.current?.click()}>
                  <i>＋</i><strong>Drop an entire shoot here</strong><span>PNG, JPG or WebP · nothing is uploaded</span>
                </button>
              ) : batchItems.map((item, index) => (
                <article key={item.id}>
                  <div><img src={item.url} alt="" /><span>{item.status === "ready" ? "✓ Ready" : item.status === "processing" ? "✦ Processing" : `${index + 1}`}</span></div>
                  <strong>{item.name}</strong>
                  <small>{item.status === "ready" ? "Transparent + studio PNG" : item.status}</small>
                </article>
              ))}
            </div>
            <footer>
              <span>{batchItems.length ? `${batchItems.length} photos · local models ready` : "ISNet + Smart Select ready"}</span>
              <button onClick={runBatch}>{batchItems.some((item) => item.status === "ready") ? "Download ZIP ↗" : "Run batch ✦"}</button>
            </footer>
          </section>
        </div>
      )}

      <input ref={fileInput} className="visually-hidden" type="file" accept="image/*" onChange={openFile} />
      <input ref={batchInput} className="visually-hidden" type="file" accept="image/png,image/jpeg,image/webp" multiple onChange={openBatchFiles} />

      {toast && <div className="spatial-toast" role="status"><span>✓</span>{toast}</div>}
    </main>
  );
}
