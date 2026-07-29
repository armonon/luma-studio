"use client";

import { ChangeEvent, useEffect, useRef, useState } from "react";

type ToneKey =
  | "exposure"
  | "contrast"
  | "highlights"
  | "shadows"
  | "whites"
  | "blacks";

const primaryTools = [
  ["move", "↖", "Move", "V"],
  ["crop", "⌗", "Crop", "C"],
  ["magic", "✣", "Magic select", "W"],
  ["heal", "◇", "Heal", "J"],
  ["brush", "╱", "Brush", "B"],
  ["image", "▧", "Place image", "F"],
  ["type", "T", "Type", "T"],
  ["history", "◴", "History", "Y"],
] as const;

const toolFamilies = [
  {
    name: "Select & mask",
    tools: ["Object selection", "Marquee", "Lasso", "Magic wand", "Color range", "Select subject"],
  },
  {
    name: "Retouch",
    tools: ["Remove", "Spot heal", "Healing brush", "Patch", "Clone stamp", "Dodge & burn"],
  },
  {
    name: "Paint",
    tools: ["Brush", "Pencil", "Mixer brush", "Eraser", "Gradient", "Paint bucket"],
  },
  {
    name: "Design",
    tools: ["Pen", "Curvature pen", "Type", "Frame", "Shape", "Path selection"],
  },
  {
    name: "Transform",
    tools: ["Crop", "Perspective", "Puppet warp", "Liquify", "Content-aware scale", "Measure"],
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
  ["whites", "Whites", -50, 50],
  ["blacks", "Blacks", -50, 50],
];

const defaultTone: Record<ToneKey, number> = {
  exposure: 8,
  contrast: 12,
  highlights: -28,
  shadows: 24,
  whites: 10,
  blacks: -14,
};

export default function SpatialStudio() {
  const [activeTool, setActiveTool] = useState("move");
  const [activePhoto, setActivePhoto] = useState(0);
  const [customPhoto, setCustomPhoto] = useState<string | null>(null);
  const [customName, setCustomName] = useState("Imported photo");
  const [tone, setTone] = useState(defaultTone);
  const [sparkle, setSparkle] = useState(68);
  const [neuralOn, setNeuralOn] = useState(true);
  const [imageVisible, setImageVisible] = useState(true);
  const [adjustmentsVisible, setAdjustmentsVisible] = useState(true);
  const [showTools, setShowTools] = useState(false);
  const [showCommand, setShowCommand] = useState(false);
  const [showNeural, setShowNeural] = useState(false);
  const [compare, setCompare] = useState(false);
  const [toast, setToast] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  const currentPhoto = customPhoto
    ? { name: customName, src: customPhoto }
    : filmstrip[activePhoto];

  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 1900);
  };

  const updateTone = (key: ToneKey, value: number) => {
    setTone((current) => ({ ...current, [key]: value }));
  };

  const selectPhoto = (index: number) => {
    setCustomPhoto(null);
    setActivePhoto(index);
    notify(`${filmstrip[index].name} opened`);
  };

  const openFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setCustomPhoto(URL.createObjectURL(file));
    setCustomName(file.name.replace(/\.[^/.]+$/, "") || "Imported photo");
    notify("Photo added to filmstrip");
  };

  const exportImage = () => {
    const link = document.createElement("a");
    link.href = currentPhoto.src;
    link.download = `${currentPhoto.name}-luma.jpg`;
    link.click();
    notify("Export prepared");
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement) return;
      const tool = primaryTools.find(
        ([, , , shortcut]) => shortcut.toLowerCase() === event.key.toLowerCase(),
      );
      if (tool) setActiveTool(tool[0]);
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setShowCommand(true);
      }
      if (event.key === "Escape") {
        setShowTools(false);
        setShowCommand(false);
        setShowNeural(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const filter = compare
    ? "none"
    : `brightness(${100 + tone.exposure + tone.shadows * 0.12}%) contrast(${100 + tone.contrast}%) saturate(${100 + sparkle * 0.16}%)`;

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
            <button onClick={() => notify("Canvas flipped")} aria-label="Flip canvas">↔</button>
          </div>

          <div className="spatial-center-actions">
            <button onClick={() => fileInput.current?.click()} title="Open">↗</button>
            <button
              className={activeTool === "crop" ? "active" : ""}
              onClick={() => setActiveTool("crop")}
              title="Crop"
            >
              ⌗
            </button>
            <button onClick={() => notify("Layer duplicated")} title="Duplicate">▣</button>
            <button
              className={compare ? "active" : ""}
              onClick={() => setCompare((value) => !value)}
              title="Before and after"
            >
              ◐
            </button>
            <button
              className={showNeural ? "active neural-action" : "neural-action"}
              onClick={() => setShowNeural(true)}
              title="Neural Lab"
            >
              ✦
            </button>
          </div>

          <div className="spatial-share-actions">
            <button
              className="spatial-search"
              onClick={() => setShowCommand(true)}
              title="Search anything"
            >
              ⌕ <kbd>⌘K</kbd>
            </button>
            <button className="spatial-export" onClick={exportImage}>Export ↗</button>
          </div>
        </header>

        <div className="spatial-workspace">
          <aside className="spatial-toolbar" aria-label="Editing tools">
            <div>
              {primaryTools.map(([id, icon, label, shortcut]) => (
                <button
                  key={id}
                  className={activeTool === id ? "active" : ""}
                  onClick={() => {
                    if (id === "image") fileInput.current?.click();
                    else setActiveTool(id);
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
            <button
              className="layers-orb"
              onClick={() => notify("Layer stack focused")}
              aria-label="Layers"
            >
              ◫
            </button>
          </aside>

          <section className="spatial-canvas-column">
            <div className="spatial-canvas-stage">
              <div className={`spatial-canvas tool-${activeTool}`}>
                {imageVisible && (
                  <img
                    src={currentPhoto.src}
                    alt={`${currentPhoto.name} open in Luma Studio`}
                    style={{ filter }}
                  />
                )}
                {adjustmentsVisible && !compare && <div className="spatial-grade" />}
                {activeTool === "magic" && <span className="spatial-selection" />}
                {activeTool === "crop" && (
                  <div className="spatial-crop-grid">
                    <i /><i /><i /><i />
                  </div>
                )}
                {activeTool === "type" && (
                  <div className="spatial-type-layer">
                    <span>WANDER</span>
                    <strong>FARTHER</strong>
                  </div>
                )}
              </div>
            </div>

            <div className="spatial-filmstrip">
              {customPhoto && (
                <button className="active" onClick={() => setCustomPhoto(customPhoto)}>
                  <img src={customPhoto} alt="" />
                  <span>{customName}</span>
                </button>
              )}
              {filmstrip.map((photo, index) => (
                <button
                  key={photo.name}
                  className={!customPhoto && activePhoto === index ? "active" : ""}
                  onClick={() => selectPhoto(index)}
                  aria-label={`Open ${photo.name}`}
                >
                  <img src={photo.src} alt="" />
                  <span>{photo.name}</span>
                </button>
              ))}
              <button
                className="film-add"
                onClick={() => fileInput.current?.click()}
                aria-label="Add photo"
              >
                ＋
              </button>
            </div>
          </section>

          <aside className="spatial-inspector">
            <section className="glass-card layers-card">
              <header>
                <strong>Layers</strong>
                <button onClick={() => notify("New layer added")}>＋</button>
              </header>
              <button
                className="spatial-layer active"
                onClick={() => setImageVisible((value) => !value)}
              >
                <span
                  className="spatial-layer-thumb"
                  style={{ backgroundImage: `url(${currentPhoto.src})` }}
                />
                <strong>{currentPhoto.name}</strong>
                <i>{imageVisible ? "◉" : "○"}</i>
              </button>
              <button
                className="spatial-layer"
                onClick={() => setAdjustmentsVisible((value) => !value)}
              >
                <span className="adjustment-thumb">✦</span>
                <strong>Adjustments</strong>
                <i>{adjustmentsVisible ? "◉" : "○"}</i>
              </button>
              <div className="layer-mode-row">
                <button>Normal⌄</button>
                <button>100%</button>
              </div>
            </section>

            <section className="glass-card tone-card">
              <header>
                <strong>Tone</strong>
                <button
                  onClick={() => {
                    setTone(defaultTone);
                    notify("Tone reset");
                  }}
                  aria-label="Reset tone"
                >
                  ×
                </button>
              </header>
              <div className="tone-controls">
                {toneRows.map(([key, label, min, max]) => (
                  <label key={key}>
                    <span>{label}</span>
                    <input
                      type="range"
                      min={min}
                      max={max}
                      value={tone[key]}
                      onChange={(event) => updateTone(key, Number(event.target.value))}
                    />
                    <output>
                      {key === "exposure"
                        ? (tone[key] / 50).toFixed(2)
                        : tone[key]}
                    </output>
                  </label>
                ))}
              </div>
            </section>

            <section className="glass-card neural-card">
              <header>
                <strong><span>✦</span> Neural Lab</strong>
                <label className="spatial-switch">
                  <input
                    type="checkbox"
                    checked={neuralOn}
                    onChange={(event) => setNeuralOn(event.target.checked)}
                  />
                  <i />
                </label>
              </header>
              <div className="sparkle-control">
                <span>Sparkle</span>
                <output>{sparkle}</output>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={sparkle}
                  onChange={(event) => setSparkle(Number(event.target.value))}
                />
              </div>
              <div className="neural-wave" aria-hidden="true">
                {Array.from({ length: 36 }).map((_, index) => (
                  <i
                    key={index}
                    style={{
                      height: `${12 + Math.sin(index * 0.7) * 9 + (index % 7) * 2}px`,
                    }}
                  />
                ))}
                <span />
              </div>
              <button className="open-neural" onClick={() => setShowNeural(true)}>
                Open Neural Lab <span>›</span>
              </button>
            </section>

            <div className="spatial-view-dock">
              <button title="Grid view">⌘</button>
              <button title="List view">☷</button>
              <button title="Compare">◫</button>
              <span />
              <button title="Fullscreen">⛶</button>
            </div>
          </aside>
        </div>
      </section>

      {showTools && (
        <aside className="spatial-tool-drawer">
          <header>
            <div>
              <strong>Every tool</strong>
              <span>Professional depth, spatially organized.</span>
            </div>
            <button onClick={() => setShowTools(false)}>×</button>
          </header>
          <div>
            {toolFamilies.map((family) => (
              <section key={family.name}>
                <strong>{family.name}</strong>
                <div>
                  {family.tools.map((tool) => (
                    <button
                      key={tool}
                      onClick={() => {
                        notify(`${tool} selected`);
                        setShowTools(false);
                      }}
                    >
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
            <div>
              <span>⌕</span>
              <input autoFocus placeholder="Find any tool, filter or action…" />
              <kbd>esc</kbd>
            </div>
            <p>Suggested for this image</p>
            {["Select the sky", "Relight from the left", "Generative expand", "Smart sharpen", "Create depth mask"].map(
              (command, index) => (
                <button
                  key={command}
                  onClick={() => {
                    notify(command);
                    setShowCommand(false);
                  }}
                >
                  <i>{index % 2 ? "⌘" : "✦"}</i>
                  <span>{command}</span>
                  <kbd>↵</kbd>
                </button>
              ),
            )}
          </section>
        </div>
      )}

      {showNeural && (
        <div className="spatial-modal" onMouseDown={() => setShowNeural(false)}>
          <section className="spatial-neural-modal" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <span>✦</span>
              <div>
                <strong>Neural Lab</strong>
                <small>Creative intelligence that stays editable</small>
              </div>
              <button onClick={() => setShowNeural(false)}>×</button>
            </header>
            <div className="spatial-neural-preview">
              <img src={currentPhoto.src} alt="" />
              <i className="mask-sky">Sky · 0.9</i>
              <i className="mask-subject">Subject · 0.6</i>
              <i className="mask-ground">Ground · 0.2</i>
            </div>
            <div className="spatial-neural-actions">
              {[
                ["✦", "Generative fill"],
                ["↔", "Expand canvas"],
                ["⌫", "Remove anything"],
                ["◐", "Relight scene"],
                ["◉", "Depth studio"],
                ["↑", "Super resolution"],
              ].map(([icon, label]) => (
                <button
                  key={label}
                  onClick={() => {
                    notify(`${label} ready`);
                    setShowNeural(false);
                  }}
                >
                  <span>{icon}</span><strong>{label}</strong><i>›</i>
                </button>
              ))}
            </div>
          </section>
        </div>
      )}

      <input
        ref={fileInput}
        className="visually-hidden"
        type="file"
        accept="image/*"
        onChange={openFile}
      />

      {toast && (
        <div className="spatial-toast" role="status">
          <span>✓</span>{toast}
        </div>
      )}
    </main>
  );
}
