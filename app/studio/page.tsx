"use client";

import {
  ChangeEvent,
  PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { LumaAPI, Studio } from "@/app/engine/studio";
import {
  AiProvenance,
  BLEND_LABELS,
  BlendMode,
  Curves,
  HslParams,
  Layer,
  LevelsParams,
  NEUTRAL_CURVES,
  NEUTRAL_HSL,
  NEUTRAL_LEVELS,
  NEUTRAL_TONE,
  PathAnchor,
  PathStyle,
  ToneParams,
  Transform,
  cloneCurves,
  curveToLut,
  layerCorners,
} from "@/app/engine/document";
import { BrushParams } from "@/app/engine/brush";
import { readRecovery, writeRecovery } from "@/app/engine/autosave";

type ToneKey = keyof ToneParams;
type WorkspaceMode = "edit" | "select" | "mask" | "develop" | "vector";
type Tool =
  | "move"
  | "brush"
  | "erase"
  | "fill"
  | "text"
  | "rect"
  | "ellipse"
  | "pen"
  | "mask-add"
  | "mask-remove"
  | "sel-rect"
  | "sel-ellipse"
  | "sel-lasso"
  | "sel-wand"
  | "sel-sam";

const workspaces: ReadonlyArray<readonly [WorkspaceMode, string, string]> = [
  ["edit", "Edit", "Pixel + vector"],
  ["select", "Select", "Marquee, lasso, wand"],
  ["mask", "Mask", "Selection intelligence"],
  ["develop", "Develop", "Nondestructive color"],
  ["vector", "Type", "Text + shapes"],
];

const modeTools: Record<WorkspaceMode, ReadonlyArray<readonly [Tool, string, string, string]>> = {
  edit: [
    ["move", "↖", "Move", "V"],
    ["brush", "╱", "Brush", "B"],
    ["erase", "⌫", "Erase", "E"],
    ["fill", "▣", "Fill", "F"],
  ],
  select: [
    ["sel-rect", "▭", "Rect marquee", "M"],
    ["sel-ellipse", "◯", "Ellipse marquee", "N"],
    ["sel-lasso", "⌁", "Lasso", "L"],
    ["sel-wand", "✣", "Magic wand", "W"],
    ["sel-sam", "✦", "SAM click-select", "K"],
  ],
  mask: [
    ["mask-add", "＋", "Reveal", "B"],
    ["mask-remove", "−", "Hide", "E"],
  ],
  develop: [
    ["move", "◐", "Tone", "T"],
  ],
  vector: [
    ["text", "T", "Text", "T"],
    ["rect", "▭", "Rect", "R"],
    ["ellipse", "◯", "Ellipse", "O"],
    ["pen", "✎", "Pen", "P"],
  ],
};

const toneRows: Array<[ToneKey, string, number, number, number]> = [
  ["exposure", "Exposure", -2, 2, 0.01],
  ["contrast", "Contrast", -100, 100, 1],
  ["highlights", "Highlights", -100, 100, 1],
  ["shadows", "Shadows", -100, 100, 1],
  ["temperature", "Temperature", -100, 100, 1],
  ["vibrance", "Vibrance", -100, 100, 1],
];

const filmstrip = [
  { name: "Dunes", src: "/desert.jpg" },
  { name: "Canyon", src: "/film-desert.jpg" },
  { name: "Wave", src: "/film-wave.jpg" },
  { name: "Sunrise", src: "/film-sun.jpg" },
  { name: "Peaks", src: "/film-mountain.jpg" },
  { name: "Lake", src: "/film-lake.jpg" },
] as const;

const blendModes: BlendMode[] = [
  "source-over", "multiply", "screen", "overlay", "soft-light", "color-dodge",
  "color-burn", "hard-light", "darken", "lighten", "difference", "exclusion",
  "hue", "saturation", "color", "luminosity",
];

type CurveChannel = "rgb" | "r" | "g" | "b";

function CurvesEditor({
  curves,
  onLive,
  onCommit,
  onReset,
}: {
  curves: Curves;
  onLive: (c: Curves) => void;
  onCommit: (c: Curves) => void;
  onReset: () => void;
}) {
  const [channel, setChannel] = useState<CurveChannel>("rgb");
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<number | null>(null);

  const size = 220;
  const pts = curves[channel];
  const lut = useMemo(() => curveToLut(pts), [pts]);

  const toSvg = (p: { x: number; y: number }) => ({ x: p.x * size, y: (1 - p.y) * size });
  const fromSvg = (x: number, y: number) => ({
    x: Math.max(0, Math.min(1, x / size)),
    y: Math.max(0, Math.min(1, 1 - y / size)),
  });

  const updateChannel = (nextPts: typeof pts, commit: boolean) => {
    const next = cloneCurves(curves);
    next[channel] = nextPts;
    if (commit) onCommit(next);
    else onLive(next);
  };

  const evToSvg = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = svgRef.current!.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * size;
    const y = ((e.clientY - rect.top) / rect.height) * size;
    return { x, y };
  };

  const onDown = (e: React.PointerEvent<SVGSVGElement>) => {
    const p = evToSvg(e);
    // Hit test existing points
    let hit = -1;
    for (let i = 0; i < pts.length; i++) {
      const sp = toSvg(pts[i]);
      if (Math.hypot(sp.x - p.x, sp.y - p.y) < 8) { hit = i; break; }
    }
    if (hit === -1) {
      // Add a new point at pointer
      const np = fromSvg(p.x, p.y);
      const next = [...pts, np].sort((a, b) => a.x - b.x);
      updateChannel(next, false);
      setDrag(next.findIndex((q) => q.x === np.x && q.y === np.y));
    } else {
      setDrag(hit);
    }
    (e.target as Element).setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (drag == null) return;
    const p = evToSvg(e);
    const np = fromSvg(p.x, p.y);
    const next = pts.map((q, i) => (i === drag ? np : q));
    // Keep first/last fixed on x edges to avoid ambiguity, but allow y to move.
    if (drag === 0) next[0].x = 0;
    if (drag === next.length - 1) next[next.length - 1].x = 1;
    updateChannel(next, false);
  };
  const onUp = () => {
    if (drag == null) return;
    setDrag(null);
    onCommit(curves);
  };

  const rmPoint = (i: number) => {
    if (pts.length <= 2 || i === 0 || i === pts.length - 1) return;
    updateChannel(pts.filter((_, k) => k !== i), true);
  };

  const linePath = pts.map((p, i) => {
    const s = toSvg(p);
    return `${i === 0 ? "M" : "L"}${s.x} ${s.y}`;
  }).join(" ");
  const lutPath = Array.from({ length: 256 }, (_, i) => {
    const x = (i / 255) * size;
    const y = (1 - lut[i] / 255) * size;
    return `${i === 0 ? "M" : "L"}${x} ${y}`;
  }).join(" ");

  return (
    <section className="glass-card tone-card">
      <header>
        <strong>Curves</strong>
        <button onClick={onReset} aria-label="Reset curves">↺</button>
      </header>
      <div style={{ display: "flex", gap: 4, padding: "4px 12px" }}>
        {(["rgb", "r", "g", "b"] as CurveChannel[]).map((c) => (
          <button
            key={c}
            onClick={() => setChannel(c)}
            style={{
              flex: 1, padding: "4px 6px", fontSize: 11, borderRadius: 6,
              background: channel === c ? "rgba(255,255,255,0.16)" : "rgba(255,255,255,0.04)",
              color: c === "r" ? "#ff6b6b" : c === "g" ? "#7bff8f" : c === "b" ? "#6ba6ff" : "#fff",
              border: "1px solid rgba(255,255,255,0.14)",
              textTransform: "uppercase",
            }}
          >
            {c}
          </button>
        ))}
      </div>
      <div style={{ padding: 8 }}>
        <svg
          ref={svgRef}
          viewBox={`0 0 ${size} ${size}`}
          width="100%"
          style={{ background: "rgba(0,0,0,0.3)", borderRadius: 8, aspectRatio: "1", touchAction: "none" }}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
        >
          {/* grid */}
          {Array.from({ length: 5 }).map((_, i) => {
            const t = (i / 4) * size;
            return (
              <g key={i}>
                <line x1={t} y1={0} x2={t} y2={size} stroke="rgba(255,255,255,.08)" />
                <line x1={0} y1={t} x2={size} y2={t} stroke="rgba(255,255,255,.08)" />
              </g>
            );
          })}
          {/* baseline */}
          <line x1={0} y1={size} x2={size} y2={0} stroke="rgba(255,255,255,.15)" strokeDasharray="4 4" />
          <path d={lutPath} stroke={channel === "r" ? "#ff6b6b" : channel === "g" ? "#7bff8f" : channel === "b" ? "#6ba6ff" : "#fff"} strokeWidth={1.5} fill="none" />
          {pts.map((p, i) => {
            const s = toSvg(p);
            return (
              <circle
                key={i}
                cx={s.x} cy={s.y} r={5}
                fill="#fff" stroke="rgba(0,0,0,.4)"
                onDoubleClick={(e) => { e.stopPropagation(); rmPoint(i); }}
                style={{ cursor: "pointer" }}
              />
            );
          })}
          {/* invisible baseline path */}
          <path d={linePath} stroke="none" fill="none" />
        </svg>
      </div>
      <p style={{ padding: "0 12px 8px", fontSize: 11, opacity: 0.65 }}>
        Click to add a point · drag to move · double-click a point to delete
      </p>
    </section>
  );
}

function LevelsEditor({
  levels, onLive, onCommit, onReset,
}: {
  levels: LevelsParams;
  onLive: (l: LevelsParams) => void;
  onCommit: (l: LevelsParams) => void;
  onReset: () => void;
}) {
  const set = (patch: Partial<LevelsParams>) => onLive({ ...levels, ...patch });
  const rows: Array<[keyof LevelsParams, string, number, number, number]> = [
    ["inBlack", "In black", 0, 1, 0.001],
    ["inWhite", "In white", 0, 1, 0.001],
    ["gamma", "Gamma", 0.1, 9.99, 0.01],
    ["outBlack", "Out black", 0, 1, 0.001],
    ["outWhite", "Out white", 0, 1, 0.001],
  ];
  return (
    <section className="glass-card tone-card">
      <header><strong>Levels</strong><button onClick={onReset}>↺</button></header>
      <div className="tone-controls">
        {rows.map(([k, label, min, max, step]) => (
          <label key={k}>
            <span>{label}</span>
            <input type="range" min={min} max={max} step={step} value={levels[k]}
              onChange={(e) => set({ [k]: Number(e.target.value) })}
              onPointerUp={() => onCommit(levels)} />
            <output>{k === "gamma" ? levels[k].toFixed(2) : levels[k].toFixed(3)}</output>
          </label>
        ))}
      </div>
    </section>
  );
}

function HslEditor({
  hsl, onLive, onCommit, onReset,
}: {
  hsl: HslParams;
  onLive: (h: HslParams) => void;
  onCommit: (h: HslParams) => void;
  onReset: () => void;
}) {
  const set = (patch: Partial<HslParams>) => onLive({ ...hsl, ...patch });
  const rows: Array<[keyof HslParams, string, number, number]> = [
    ["hue", "Hue", -180, 180],
    ["saturation", "Saturation", -100, 100],
    ["lightness", "Lightness", -100, 100],
  ];
  return (
    <section className="glass-card tone-card">
      <header><strong>Hue / Saturation</strong><button onClick={onReset}>↺</button></header>
      <div className="tone-controls">
        {rows.map(([k, label, min, max]) => (
          <label key={k}>
            <span>{label}</span>
            <input type="range" min={min} max={max} step={1} value={hsl[k]}
              onChange={(e) => set({ [k]: Number(e.target.value) })}
              onPointerUp={() => onCommit(hsl)} />
            <output>{Math.round(hsl[k])}</output>
          </label>
        ))}
      </div>
    </section>
  );
}

function rotMat(theta: number): [number, number, number, number] {
  // Returns the 2x2 rotation matrix in row-major: [r00, r01, r10, r11].
  const c = Math.cos(theta), s = Math.sin(theta);
  return [c, -s, s, c];
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

export default function SpatialStudio() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const psdInput = useRef<HTMLInputElement>(null);
  const projectInput = useRef<HTMLInputElement>(null);
  const [studio, setStudio] = useState<Studio | null>(null);
  const [, setVersion] = useState(0);
  const forceUpdate = useCallback(() => setVersion((n) => n + 1), []);

  const [workspace, setWorkspace] = useState<WorkspaceMode>("edit");
  const [activeTool, setActiveTool] = useState<Tool>("brush");
  const [activeLayerId, setActiveLayerIdState] = useState<string | null>(null);
  const activeLayerIdRef = useRef<string | null>(null);
  const setActiveLayerId = useCallback((id: string | null) => {
    activeLayerIdRef.current = id;
    setActiveLayerIdState(id);
  }, []);
  const [activeAdjustmentId, setActiveAdjustmentId] = useState<string | null>(null);
  const [tone, setTone] = useState<ToneParams>({ ...NEUTRAL_TONE });
  const [brushSize, setBrushSize] = useState(48);
  const [hardness, setHardness] = useState(0.7);
  const [brushOpacity, setBrushOpacity] = useState(0.9);
  const [brushColor, setBrushColor] = useState("#ffffff");
  const [feather, setFeather] = useState(0);
  const [wandTolerance, setWandTolerance] = useState(24);
  const [toast, setToast] = useState("");
  const [activePreset, setActivePreset] = useState(0);
  const [customName, setCustomName] = useState<string | null>(null);
  const [textDraft, setTextDraft] = useState("WANDER FARTHER");
  const [recordingName, setRecordingName] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [blurRadius, setBlurRadius] = useState(8);
  const [sharpAmount, setSharpAmount] = useState(0.6);
  const [neural, setNeural] = useState<{ msg: string; pct: number } | null>(null);
  const [aiPrompt, setAiPrompt] = useState("Replace the selected area naturally while preserving the rest of the photograph");
  const [aiOperation, setAiOperation] = useState<AiProvenance["operation"]>("fill");
  const [aiRunning, setAiRunning] = useState(false);
  const [showBatch, setShowBatch] = useState(false);
  const [batchFiles, setBatchFiles] = useState<File[]>([]);
  const [batchProgress, setBatchProgress] = useState<{ i: number; total: number; name: string } | null>(null);
  const batchInput = useRef<HTMLInputElement>(null);
  const [selectedActionIdx, setSelectedActionIdx] = useState<number | null>(null);
  const [useGL, setUseGL] = useState(false);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved");
  const [exportFormat, setExportFormat] = useState<"png" | "jpeg" | "webp">("png");
  const [snapGuides, setSnapGuides] = useState(true);
  const [showGuides, setShowGuides] = useState(true);
  const resizeWidthRef = useRef<HTMLInputElement>(null);
  const resizeHeightRef = useRef<HTMLInputElement>(null);
  const glSupported = !!studio && Studio.canUseGL();

  // View transform (zoom + pan). 1.0 = fit-to-stage size. Pan is in stage pixels.
  const [view, setView] = useState({ zoom: 1, panX: 0, panY: 0 });
  const spaceHeld = useRef(false);
  const panDragRef = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null);

  // Draft state for pending vector/marquee shapes.
  type Drag = {
    x0: number; y0: number; x1: number; y1: number;
    kind: "sel-rect" | "sel-ellipse" | "rect" | "ellipse" | "sel-lasso" | "move-layer";
    path?: Array<{ x: number; y: number }>;
    moveStart?: { tx: number; ty: number };
  };
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const setDragBoth = (d: Drag | null) => { dragRef.current = d; setDrag(d); };

  // Free-transform drag state (handles overlay).
  type FTDrag =
    | { kind: "corner"; corner: "tl" | "tr" | "br" | "bl"; startTransform: Transform }
    | { kind: "rotate"; startTransform: Transform; centerX: number; centerY: number; startAngle: number };
  const [, setFtDrag] = useState<FTDrag | null>(null);
  const ftDragRef = useRef<FTDrag | null>(null);
  const setFt = useCallback((d: FTDrag | null) => { ftDragRef.current = d; setFtDrag(d); }, []);

  // Pen tool draft. Anchors accumulate; tangent handles are dragged from the
  // current anchor while the mouse is down.
  const [penDraft, setPenDraft] = useState<PathAnchor[]>([]);
  const [penDragging, setPenDragging] = useState<{ index: number } | null>(null);

  const notify = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(""), 1900);
  }, []);

  useEffect(() => {
    if (!canvasRef.current) return;
    const target = canvasRef.current;
    const s = new Studio(1600, 1067, target);
    const unsub = s.subscribe(forceUpdate);
    const api: LumaAPI = {
      version: "0.2",
      studio: s,
      layers: () => s.doc.layers,
      active: () => (activeLayerIdRef.current ? s.findLayer(activeLayerIdRef.current) ?? null : null),
      select: (id: string | null) => setActiveLayerId(id),
      documents: () => s.listDocuments(),
      registerPlugin: (plugin) => s.registerPlugin(plugin),
      plugins: () => s.listPlugins(),
      export: (type, quality) => s.exportImage(type, quality),
    };
    (window as unknown as { luma?: LumaAPI }).luma = api;
    setStudio(s);
    (async () => {
      try {
        const recovery = await readRecovery();
        if (recovery) {
          const project = await s.importProject(recovery);
          setActiveLayerId(project.doc.layers[0]?.id ?? null);
          setCustomName(project.name);
          notify(`Recovered ${project.name}`);
        } else {
          const img = await loadImage(filmstrip[0].src);
          const layer = s.openImage(filmstrip[0].name, img);
          setActiveLayerId(layer.id);
        }
      } catch {
        const img = await loadImage(filmstrip[0].src);
        const layer = s.openImage(filmstrip[0].name, img);
        setActiveLayerId(layer.id);
      }
    })();
    return () => {
      unsub();
      s.dispose();
      const host = window as unknown as { luma?: LumaAPI };
      if (host.luma === api) delete host.luma;
    };
  }, [forceUpdate, notify, setActiveLayerId]);

  const doc = studio?.doc;
  const layers: Layer[] = doc?.layers ?? [];
  const openDocuments = studio?.listDocuments() ?? [];
  const activeLayer = layers.find((l) => l.id === activeLayerId) ?? layers[0] ?? null;

  const eventToDoc = useCallback((e: { clientX: number; clientY: number; pressure?: number }) => {
    const canvas = canvasRef.current;
    if (!canvas || !doc) return { x: 0, y: 0, p: 0.5 };
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * doc.width;
    const y = ((e.clientY - rect.top) / rect.height) * doc.height;
    const p = e.pressure !== undefined && e.pressure > 0 && e.pressure !== 0.5 ? e.pressure : 0.5;
    return { x, y, p };
  }, [doc]);

  const currentBrushMode = (): BrushParams["mode"] => {
    if (activeTool === "erase") return "erase";
    if (activeTool === "mask-add") return "mask-add";
    if (activeTool === "mask-remove") return "mask-remove";
    return "paint";
  };

  const brushParams = (): BrushParams => ({
    size: brushSize,
    hardness,
    opacity: brushOpacity,
    color: brushColor,
    mode: currentBrushMode(),
  });

  const paintingTool = activeTool === "brush" || activeTool === "erase" || activeTool === "mask-add" || activeTool === "mask-remove";
  const marqueeTool = activeTool === "sel-rect" || activeTool === "sel-ellipse";
  const lassoTool = activeTool === "sel-lasso";
  const wandTool = activeTool === "sel-wand";
  const vectorDragTool = activeTool === "rect" || activeTool === "ellipse";
  const moveTool = activeTool === "move";

  const snapLayerTranslation = (layer: Layer, tx: number, ty: number) => {
    if (!doc || !snapGuides) return { tx, ty };
    const candidate: Layer = { ...layer, transform: { ...layer.transform, tx, ty } };
    const corners = layerCorners(doc, candidate);
    const xs = [corners.tl[0], corners.tr[0], corners.br[0], corners.bl[0]];
    const ys = [corners.tl[1], corners.tr[1], corners.br[1], corners.bl[1]];
    const anchorsX = [Math.min(...xs), (Math.min(...xs) + Math.max(...xs)) / 2, Math.max(...xs)];
    const anchorsY = [Math.min(...ys), (Math.min(...ys) + Math.max(...ys)) / 2, Math.max(...ys)];
    const targetsX = [0, doc.width / 2, doc.width, ...doc.guides.filter((guide) => guide.orientation === "vertical").map((guide) => guide.position)];
    const targetsY = [0, doc.height / 2, doc.height, ...doc.guides.filter((guide) => guide.orientation === "horizontal").map((guide) => guide.position)];
    const threshold = 8 / Math.max(view.zoom, 0.05);
    let dx = 0;
    let dy = 0;
    let bestX = threshold + 1;
    let bestY = threshold + 1;
    for (const anchor of anchorsX) for (const target of targetsX) {
      const delta = target - anchor;
      if (Math.abs(delta) < bestX) { bestX = Math.abs(delta); dx = delta; }
    }
    for (const anchor of anchorsY) for (const target of targetsY) {
      const delta = target - anchor;
      if (Math.abs(delta) < bestY) { bestY = Math.abs(delta); dy = delta; }
    }
    return { tx: tx + (bestX <= threshold ? dx : 0), ty: ty + (bestY <= threshold ? dy : 0) };
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!studio) return;
    // Middle mouse or space+left = pan.
    if (e.button === 1 || (spaceHeld.current && e.button === 0)) {
      (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
      panDragRef.current = { startX: e.clientX, startY: e.clientY, panX: view.panX, panY: view.panY };
      return;
    }
    (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
    const p = eventToDoc(e);

    if (paintingTool) {
      if (!activeLayer) { notify("Select a layer"); return; }
      const params = brushParams();
      if ((params.mode === "mask-add" || params.mode === "mask-remove") && activeLayer.kind !== "raster") {
        notify("Mask brush needs a raster layer"); return;
      }
      if ((params.mode === "paint" || params.mode === "erase") && activeLayer.kind !== "raster") {
        notify("Brush needs a raster layer"); return;
      }
      studio.beginStroke(activeLayer.id, params, p);
      return;
    }

    if (marqueeTool || vectorDragTool) {
      setDragBoth({ x0: p.x, y0: p.y, x1: p.x, y1: p.y, kind: activeTool as Drag["kind"] });
      return;
    }
    if (lassoTool) {
      setDragBoth({ x0: p.x, y0: p.y, x1: p.x, y1: p.y, kind: "sel-lasso", path: [{ x: p.x, y: p.y }] });
      return;
    }
    if (wandTool) {
      if (!activeLayer || activeLayer.kind !== "raster") { notify("Wand needs a raster layer"); return; }
      studio.selectByColor(activeLayer.id, p.x, p.y, wandTolerance, e.shiftKey ? "add" : e.altKey ? "subtract" : "replace", !e.metaKey);
      notify("Selection updated");
      return;
    }
    if (activeTool === "sel-sam") {
      if (!activeLayer || activeLayer.kind !== "raster") { notify("SAM needs a raster layer"); return; }
      const mode = e.shiftKey ? "add" : e.altKey ? "subtract" : "replace";
      setNeural({ msg: "SAM click", pct: 0 });
      (async () => {
        try {
          const res = await studio.samClickSelect(activeLayer.id, p.x, p.y, mode, (msg, pct) => setNeural({ msg, pct }));
          setNeural(null);
          notify(res.used === "sam" ? "SAM select" : "Fell back to wand");
        } catch {
          setNeural(null);
          notify("SAM failed");
        }
      })();
      return;
    }
    if (activeTool === "pen") {
      // Check for close-path (click near first anchor)
      if (penDraft.length >= 2) {
        const first = penDraft[0];
        const dx = p.x - first.x;
        const dy = p.y - first.y;
        if (Math.hypot(dx, dy) < Math.max(8, (doc?.width ?? 1000) * 0.008)) {
          commitPenPath(true);
          return;
        }
      }
      const anchor: PathAnchor = { x: p.x, y: p.y, hIn: { dx: 0, dy: 0 }, hOut: { dx: 0, dy: 0 } };
      setPenDraft((d) => [...d, anchor]);
      setPenDragging({ index: penDraft.length });
      return;
    }
    if (activeTool === "text") {
      studio.addTextLayer(textDraft, { x: p.x, y: p.y });
      notify("Text added");
      return;
    }
    if (moveTool && activeLayer) {
      setDragBoth({ x0: p.x, y0: p.y, x1: p.x, y1: p.y, kind: "move-layer", moveStart: { tx: activeLayer.transform.tx, ty: activeLayer.transform.ty } });
      return;
    }
  };

  const commitPenPath = useCallback((closeIt: boolean) => {
    if (!studio || penDraft.length < 2) { setPenDraft([]); setPenDragging(null); return; }
    const path: PathStyle = {
      anchors: penDraft.map((a) => ({ ...a, hIn: { ...a.hIn }, hOut: { ...a.hOut } })),
      closed: closeIt,
      fill: brushColor,
      stroke: "#000000",
      strokeWidth: 0,
    };
    studio.addPathLayer(path);
    setPenDraft([]);
    setPenDragging(null);
    notify(closeIt ? "Path closed" : "Path added");
  }, [studio, penDraft, brushColor, notify]);

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!studio) return;
    if (panDragRef.current) {
      const dx = e.clientX - panDragRef.current.startX;
      const dy = e.clientY - panDragRef.current.startY;
      setView((v) => ({ ...v, panX: panDragRef.current!.panX + dx, panY: panDragRef.current!.panY + dy }));
      return;
    }
    if (activeTool === "pen" && penDragging) {
      const p = eventToDoc(e);
      setPenDraft((d) => {
        const next = d.map((a) => ({ ...a, hIn: { ...a.hIn }, hOut: { ...a.hOut } }));
        const a = next[penDragging.index];
        if (a) {
          a.hOut = { dx: p.x - a.x, dy: p.y - a.y };
          a.hIn = { dx: -(p.x - a.x), dy: -(p.y - a.y) };
        }
        return next;
      });
      return;
    }
    const d = dragRef.current;
    if (paintingTool && e.buttons !== 0 && activeLayer) {
      // Coalesced events for smoother strokes on high-frequency devices.
      type WithCoalesced = { getCoalescedEvents?: () => Array<{ clientX: number; clientY: number; pressure?: number }> };
      const src = e.nativeEvent as WithCoalesced;
      const events = src.getCoalescedEvents ? src.getCoalescedEvents() : [];
      const points = events.length ? events : [e.nativeEvent];
      for (const ev of points) studio.paintTo(activeLayer.id, brushParams(), eventToDoc(ev));
      return;
    }
    if (!d) return;
    const p = eventToDoc(e);
    const nextPath = d.kind === "sel-lasso" && d.path ? [...d.path, { x: p.x, y: p.y }] : d.path;
    const next: Drag = { ...d, x1: p.x, y1: p.y, path: nextPath };
    if (d.kind === "move-layer" && activeLayer && d.moveStart) {
      const dx = p.x - d.x0;
      const dy = p.y - d.y0;
      studio.liveUpdateTransform(activeLayer.id, snapLayerTranslation(activeLayer, d.moveStart.tx + dx, d.moveStart.ty + dy));
    }
    setDragBoth(next);
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!studio) return;
    if (panDragRef.current) { panDragRef.current = null; return; }
    if (activeTool === "pen" && penDragging) {
      setPenDragging(null);
      return;
    }
    if (paintingTool && activeLayer) {
      studio.endStroke(activeLayer.id, brushParams());
      return;
    }
    const d = dragRef.current;
    if (!d) return;
    const x = Math.min(d.x0, d.x1);
    const y = Math.min(d.y0, d.y1);
    const w = Math.abs(d.x1 - d.x0);
    const h = Math.abs(d.y1 - d.y0);
    const mode = e.shiftKey ? "add" : e.altKey ? "subtract" : "replace";
    if (d.kind === "sel-rect" && w > 2 && h > 2) studio.selectRect(x, y, w, h, mode, feather);
    else if (d.kind === "sel-ellipse" && w > 2 && h > 2) studio.selectEllipse(x, y, w, h, mode, feather);
    else if (d.kind === "sel-lasso" && d.path && d.path.length > 4) studio.selectLasso(d.path, mode, feather);
    else if (d.kind === "rect" && w > 2 && h > 2) studio.addShapeLayer({ kind: "rect", x, y, w, h, fill: brushColor, stroke: "#000", strokeWidth: 0, radius: 0 });
    else if (d.kind === "ellipse" && w > 2 && h > 2) studio.addShapeLayer({ kind: "ellipse", x, y, w, h, fill: brushColor, stroke: "#000", strokeWidth: 0, radius: 0 });
    else if (d.kind === "move-layer" && activeLayer) {
      studio.updateTransform(activeLayer.id, { tx: activeLayer.transform.tx, ty: activeLayer.transform.ty });
    }
    setDragBoth(null);
  };

  const ensureAdjustmentLayer = (): string => {
    if (!studio) return "";
    if (activeAdjustmentId && studio.findLayer(activeAdjustmentId)) return activeAdjustmentId;
    const layer = studio.addAdjustmentLayer("Tone", NEUTRAL_TONE);
    setActiveAdjustmentId(layer.id);
    setActiveLayerId(layer.id);
    return layer.id;
  };

  const onToneChange = (key: ToneKey, value: number) => {
    if (!studio) return;
    const id = ensureAdjustmentLayer();
    const next = { ...tone, [key]: value };
    setTone(next);
    studio.liveUpdateTone(id, next);
  };
  const onToneCommit = () => {
    if (!studio || !activeAdjustmentId) return;
    studio.updateTone(activeAdjustmentId, tone);
  };
  const resetTone = () => {
    if (!studio || !activeAdjustmentId) { setTone({ ...NEUTRAL_TONE }); return; }
    setTone({ ...NEUTRAL_TONE });
    studio.updateTone(activeAdjustmentId, { ...NEUTRAL_TONE });
    notify("Tone reset");
  };

  const switchWorkspace = (next: WorkspaceMode) => {
    setWorkspace(next);
    setActiveTool(modeTools[next][0][0]);
  };

  const openPreset = async (index: number) => {
    if (!studio) return;
    setActivePreset(index);
    setCustomName(null);
    try {
      const img = await loadImage(filmstrip[index].src);
      const layer = studio.openImage(filmstrip[index].name, img);
      setActiveLayerId(layer.id);
      setActiveAdjustmentId(null);
      setTone({ ...NEUTRAL_TONE });
      notify(`${filmstrip[index].name} opened`);
    } catch {
      notify("Failed to load");
    }
  };

  const onFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !studio) return;
    const url = URL.createObjectURL(file);
    const name = file.name.replace(/\.[^/.]+$/, "") || "Imported";
    try {
      const img = await loadImage(url);
      const layer = studio.openImage(name, img);
      setActiveLayerId(layer.id);
      setCustomName(name);
      setActiveAdjustmentId(null);
      setTone({ ...NEUTRAL_TONE });
      notify(`${name} imported`);
    } catch {
      notify("Failed to import");
    } finally {
      URL.revokeObjectURL(url);
      e.target.value = "";
    }
  };

  const onPsdImport = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !studio) return;
    try {
      const buf = await file.arrayBuffer();
      const d = await studio.importPsd(buf);
      setActiveLayerId(d.layers[0]?.id ?? null);
      setActiveAdjustmentId(null);
      setTone({ ...NEUTRAL_TONE });
      notify(`${file.name} · ${d.layers.length} layers`);
    } catch {
      notify("PSD import failed");
    } finally {
      e.target.value = "";
    }
  };

  const projectName = customName || filmstrip[activePreset].name || "Untitled";

  const saveProject = async () => {
    if (!studio) return;
    setSaveState("saving");
    try {
      const blob = await studio.exportProject(projectName);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${projectName.replace(/[^a-z0-9_-]+/gi, "-")}.luma`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      await writeRecovery(blob);
      setSaveState("saved");
      notify("Luma project saved");
    } catch {
      setSaveState("error");
      notify("Project save failed");
    }
  };

  const onProjectImport = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !studio) return;
    try {
      const project = await studio.importProject(file);
      setActiveLayerId(project.doc.layers[0]?.id ?? null);
      setActiveAdjustmentId(null);
      setCustomName(project.name || file.name.replace(/\.luma$/i, ""));
      await writeRecovery(file);
      setSaveState("saved");
      notify(`${project.name} opened`);
    } catch {
      notify("Luma project could not be opened");
    } finally {
      e.target.value = "";
    }
  };

  useEffect(() => {
    if (!studio) return;
    let timer = 0;
    let cancelled = false;
    const persist = async () => {
      if (cancelled) return;
      setSaveState("saving");
      try {
        const blob = await studio.exportProject(projectName);
        if (!cancelled) {
          await writeRecovery(blob);
          setSaveState("saved");
        }
      } catch {
        if (!cancelled) setSaveState("error");
      }
    };
    const unsubscribe = studio.subscribe(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(persist, 1600);
    });
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      unsubscribe();
    };
  }, [studio, projectName]);

  const setLayerVisible = (id: string, v: boolean) => studio?.setLayerProp(id, "visible", v, v ? "Layer shown" : "Layer hidden");
  const setLayerOpacity = (id: string, o: number) => studio?.setLayerProp(id, "opacity", o, "Opacity");
  const setLayerBlend = (id: string, b: BlendMode) => studio?.setLayerProp(id, "blend", b, "Blend");
  const addAdjust = () => {
    if (!studio) return;
    const layer = studio.addAdjustmentLayer("Tone", NEUTRAL_TONE);
    setActiveAdjustmentId(layer.id);
    setActiveLayerId(layer.id);
    setTone({ ...NEUTRAL_TONE });
    switchWorkspace("develop");
  };
  const addBlank = () => {
    if (!studio) return;
    const layer = studio.addBlankRaster("Paint");
    setActiveLayerId(layer.id);
  };
  const removeActive = () => {
    if (!studio || !activeLayerId) return;
    studio.removeLayer(activeLayerId);
    setActiveLayerId(studio.doc.layers[0]?.id ?? null);
  };

  const runSubject = () => {
    if (!studio || !activeLayer || activeLayer.kind !== "raster") { notify("Select a raster layer"); return; }
    studio.autoLumaMask(activeLayer.id);
    notify("Auto subject mask");
  };

  const runNeuralSubject = async () => {
    if (!studio || !activeLayer || activeLayer.kind !== "raster") { notify("Select a raster layer"); return; }
    if (neural) return;
    setNeural({ msg: "Starting", pct: 0 });
    try {
      const result = await studio.neuralSubject(activeLayer.id, (msg, pct) => {
        setNeural({ msg, pct });
      });
      setNeural(null);
      notify(result.used === "neural" ? "Neural subject mask" : "Fell back to luma mask");
    } catch {
      setNeural(null);
      notify("Neural subject failed");
    }
  };

  const runGenerativeEdit = async () => {
    if (!studio || !activeLayer || activeLayer.kind === "group") { notify("Select a content layer"); return; }
    if (!aiPrompt.trim() || aiRunning) return;
    setAiRunning(true);
    setNeural({ msg: `GPT Image 2 · ${aiOperation}`, pct: 18 });
    try {
      const layer = await studio.generativeEdit(activeLayer.id, aiPrompt.trim(), aiOperation);
      setActiveLayerId(layer.id);
      setNeural(null);
      notify(`AI ${aiOperation} added as a new layer`);
    } catch (error) {
      setNeural(null);
      notify(error instanceof Error ? error.message : "Generative edit failed");
    } finally {
      setAiRunning(false);
    }
  };

  const runFilter = (kind: "blur" | "sharpen" | "invert" | "desaturate" | "hue", opts: Record<string, number> = {}) => {
    if (!studio || !activeLayer || activeLayer.kind === "group") { notify("Select a content layer"); return; }
    studio.addSmartFilter(activeLayer.id, kind, opts);
    notify(`${kind[0].toUpperCase() + kind.slice(1)} added as a Smart Filter`);
  };

  const exportPNG = async () => {
    if (!studio) return;
    try {
      const mime = exportFormat === "jpeg" ? "image/jpeg" : exportFormat === "webp" ? "image/webp" : "image/png";
      const blob = await studio.exportImage(mime, 0.92);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${customName || filmstrip[activePreset].name}-luma.${exportFormat === "jpeg" ? "jpg" : exportFormat}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      notify(`Exported ${exportFormat.toUpperCase()}`);
    } catch { notify("Export failed"); }
  };

  const runBatchNow = async () => {
    if (!studio || !batchFiles.length) return;
    const { runBatch } = await import("@/app/engine/batch");
    const action = selectedActionIdx != null ? studio.actions.get(selectedActionIdx) : null;
    setBatchProgress({ i: 0, total: batchFiles.length, name: "" });
    try {
      const zip = await runBatch(studio, batchFiles, action ?? null, (i, total, name) => {
        setBatchProgress({ i, total, name });
      });
      const url = URL.createObjectURL(zip);
      const a = document.createElement("a");
      a.href = url;
      a.download = `luma-batch-${Date.now()}.zip`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      notify(`Batch complete · ${batchFiles.length} images`);
    } catch (err) {
      console.warn(err);
      notify("Batch failed");
    } finally {
      setBatchProgress(null);
    }
  };

  const exportPsd = () => {
    if (!studio) return;
    try {
      const buf = studio.exportPsd();
      const blob = new Blob([buf], { type: "image/vnd.adobe.photoshop" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${customName || filmstrip[activePreset].name}-luma.psd`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      notify("Exported PSD");
    } catch { notify("PSD export failed"); }
  };

  const startRecording = () => {
    if (!studio) return;
    const name = window.prompt("Action name?", `Action ${studio.actions.list().length + 1}`);
    if (!name) return;
    studio.startRecording(name);
    setRecordingName(name);
    notify(`Recording: ${name}`);
  };
  const stopRecording = () => {
    if (!studio) return;
    const a = studio.stopRecording();
    setRecordingName("");
    if (a) notify(`Saved ${a.name} · ${a.steps.length} steps`);
  };
  const playAction = (i: number) => {
    if (!studio) return;
    const a = studio.actions.get(i);
    if (!a) return;
    studio.replay(a, activeLayerId);
    notify(`Played ${a.name}`);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) studio?.redo(); else studio?.undo();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a") { e.preventDefault(); studio?.selectAll(); return; }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "d") { e.preventDefault(); studio?.deselect(); return; }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "i") { e.preventDefault(); studio?.invertSelectionArea(); return; }
      if (e.key === "Enter" && activeTool === "pen") { e.preventDefault(); commitPenPath(false); return; }
      if (e.key === "Escape" && activeTool === "pen") { setPenDraft([]); setPenDragging(null); return; }
      if (e.code === "Space" && !e.repeat) { spaceHeld.current = true; document.body.style.cursor = "grab"; }
      if (e.key === "0" && !e.metaKey && !e.ctrlKey) { setView({ zoom: 1, panX: 0, panY: 0 }); return; }
      if (e.key === "1" && !e.metaKey && !e.ctrlKey) { setView((v) => ({ ...v, zoom: 1 })); return; }
      if ((e.key === "+" || e.key === "=") && !e.metaKey) { setView((v) => ({ ...v, zoom: Math.min(32, v.zoom * 1.2) })); return; }
      if (e.key === "-" && !e.metaKey) { setView((v) => ({ ...v, zoom: Math.max(0.05, v.zoom / 1.2) })); return; }
      if (e.key === "Delete" || e.key === "Backspace") {
        if (activeLayerId && studio) { studio.clearPixels(activeLayerId); return; }
      }
      const t = modeTools[workspace].find(([, , , k]) => k.toLowerCase() === e.key.toLowerCase());
      if (t) setActiveTool(t[0]);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") { spaceHeld.current = false; document.body.style.cursor = ""; }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [workspace, studio, activeLayerId, activeTool, commitPenPath]);

  const currentTools = modeTools[workspace];
  const canvasCursor = useMemo(() => {
    if (paintingTool || marqueeTool || lassoTool || wandTool || vectorDragTool) return "crosshair";
    if (activeTool === "pen" || activeTool === "sel-sam") return "crosshair";
    if (moveTool) return "move";
    return "default";
  }, [paintingTool, marqueeTool, lassoTool, wandTool, vectorDragTool, moveTool, activeTool]);

  const activeIsAdjustment = activeLayer?.kind === "adjustment-tone";

  // Overlay for pending selection/shape drag
  const dragOverlay = useMemo(() => {
    if (!drag || !doc) return null;
    const x = Math.min(drag.x0, drag.x1);
    const y = Math.min(drag.y0, drag.y1);
    const w = Math.abs(drag.x1 - drag.x0);
    const h = Math.abs(drag.y1 - drag.y0);
    const left = (x / doc.width) * 100;
    const top = (y / doc.height) * 100;
    const wp = (w / doc.width) * 100;
    const hp = (h / doc.height) * 100;
    const style: React.CSSProperties = {
      position: "absolute",
      left: `${left}%`,
      top: `${top}%`,
      width: `${wp}%`,
      height: `${hp}%`,
      border: "1px dashed rgba(255,255,255,0.9)",
      pointerEvents: "none",
      borderRadius: drag.kind === "sel-ellipse" || drag.kind === "ellipse" ? "50%" : 0,
      background: drag.kind === "rect" || drag.kind === "ellipse" ? `${brushColor}22` : "transparent",
    };
    return <div style={style} />;
  }, [drag, doc, brushColor]);

  // Pen draft overlay
  const penOverlay = useMemo(() => {
    if (!doc || activeTool !== "pen" || penDraft.length === 0) return null;
    const toPct = (p: { x: number; y: number }) => ({
      left: `${(p.x / doc.width) * 100}%`,
      top: `${(p.y / doc.height) * 100}%`,
    });
    const path = penDraft.map((a, i) => {
      if (i === 0) return `M${a.x} ${a.y}`;
      const prev = penDraft[i - 1];
      return `C${prev.x + prev.hOut.dx} ${prev.y + prev.hOut.dy} ${a.x + a.hIn.dx} ${a.y + a.hIn.dy} ${a.x} ${a.y}`;
    }).join(" ");
    return (
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
        <svg viewBox={`0 0 ${doc.width} ${doc.height}`} preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "visible" }}>
          <path d={path} stroke="rgba(255,255,255,0.9)" strokeWidth={Math.max(1, doc.width * 0.001)} fill="none" vectorEffect="non-scaling-stroke" />
          {penDraft.map((a, i) => (
            <g key={i}>
              <line x1={a.x + a.hIn.dx} y1={a.y + a.hIn.dy} x2={a.x + a.hOut.dx} y2={a.y + a.hOut.dy} stroke="rgba(124,92,231,0.7)" strokeWidth={Math.max(0.5, doc.width * 0.0006)} vectorEffect="non-scaling-stroke" />
              <circle cx={a.x + a.hIn.dx} cy={a.y + a.hIn.dy} r={doc.width * 0.003} fill="#7c5ce7" />
              <circle cx={a.x + a.hOut.dx} cy={a.y + a.hOut.dy} r={doc.width * 0.003} fill="#7c5ce7" />
            </g>
          ))}
        </svg>
        {penDraft.map((a, i) => (
          <div key={i} style={{
            ...toPct(a),
            position: "absolute" as const,
            width: 10, height: 10, marginLeft: -5, marginTop: -5,
            background: i === 0 ? "#f06d3b" : "#fff",
            border: "1px solid rgba(0,0,0,.4)", borderRadius: 2,
          }} />
        ))}
      </div>
    );
  }, [doc, activeTool, penDraft]);

  // Free-transform overlay: handles for the active non-adjustment layer when
  // the Move tool is active. Handles live in the same coordinate space as the
  // canvas via percentage positioning, so they follow zoom/resize.
  const transformOverlay = useMemo(() => {
    if (!doc || !activeLayer || !moveTool) return null;
    if (activeLayer.kind === "adjustment-tone") return null;
    const [tl, tr, br, bl] = layerCorners(activeLayer, doc.width, doc.height);
    const toPct = (p: [number, number]) => ({
      left: `${(p[0] / doc.width) * 100}%`,
      top: `${(p[1] / doc.height) * 100}%`,
    });
    // Rotate handle 32 px (in doc units, roughly) above top-center.
    const topCenter: [number, number] = [(tl[0] + tr[0]) / 2, (tl[1] + tr[1]) / 2];
    const angle = activeLayer.transform.rotation;
    const rotOffset = doc.height * 0.04;
    const rotHandle: [number, number] = [
      topCenter[0] - Math.sin(angle) * rotOffset,
      topCenter[1] - Math.cos(angle) * rotOffset,
    ];
    const handleStyle = {
      position: "absolute" as const,
      width: 12,
      height: 12,
      marginLeft: -6,
      marginTop: -6,
      background: "#fff",
      border: "1px solid rgba(0,0,0,.4)",
      borderRadius: 2,
      cursor: "nwse-resize",
      pointerEvents: "auto" as const,
      boxShadow: "0 2px 6px rgba(0,0,0,.4)",
    };
    const svgLine = (p: [number, number], q: [number, number]) => (
      <line
        x1={(p[0] / doc.width) * 100}
        y1={(p[1] / doc.height) * 100}
        x2={(q[0] / doc.width) * 100}
        y2={(q[1] / doc.height) * 100}
        stroke="rgba(255,255,255,0.7)"
        strokeWidth={0.15}
        strokeDasharray="0.4 0.4"
        vectorEffect="non-scaling-stroke"
      />
    );

    const onCornerDown = (corner: "tl" | "tr" | "br" | "bl") => (e: ReactPointerEvent<HTMLDivElement>) => {
      e.stopPropagation();
      (e.target as Element).setPointerCapture(e.pointerId);
      setFt({ kind: "corner", corner, startTransform: { ...activeLayer.transform } });
    };
    const onRotateDown = (e: ReactPointerEvent<HTMLDivElement>) => {
      e.stopPropagation();
      (e.target as Element).setPointerCapture(e.pointerId);
      // Center in canvas doc-space
      const cx = (tl[0] + br[0]) / 2;
      const cy = (tl[1] + br[1]) / 2;
      const p = eventToDoc(e);
      const startAngle = Math.atan2(p.y - cy, p.x - cx);
      setFt({ kind: "rotate", startTransform: { ...activeLayer.transform }, centerX: cx, centerY: cy, startAngle });
    };
    const onHandleMove = (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!studio) return;
      const f = ftDragRef.current;
      if (!f) return;
      const p = eventToDoc(e);
      if (f.kind === "corner") {
        applyCornerDrag(activeLayer, f.corner, f.startTransform, p.x, p.y);
      } else if (f.kind === "rotate") {
        const now = Math.atan2(p.y - f.centerY, p.x - f.centerX);
        const delta = now - f.startAngle;
        const newRot = f.startTransform.rotation + delta;
        // Rotate around visual center: adjust translation so center stays put.
        const R0 = rotMat(f.startTransform.rotation);
        const cLocal = { x: doc.width / 2 * f.startTransform.sx, y: doc.height / 2 * f.startTransform.sy };
        const cCanvas = {
          x: R0[0] * cLocal.x + R0[1] * cLocal.y + f.startTransform.tx,
          y: R0[2] * cLocal.x + R0[3] * cLocal.y + f.startTransform.ty,
        };
        const Rn = rotMat(newRot);
        const newTx = cCanvas.x - (Rn[0] * cLocal.x + Rn[1] * cLocal.y);
        const newTy = cCanvas.y - (Rn[2] * cLocal.x + Rn[3] * cLocal.y);
        studio.liveUpdateTransform(activeLayer.id, { rotation: newRot, tx: newTx, ty: newTy });
      }
    };
    const applyCornerDrag = (layer: Layer, corner: "tl" | "tr" | "br" | "bl", start: Transform, px: number, py: number) => {
      // Opposite corner in local space stays pinned.
      const localOpposite = {
        tl: [doc.width, doc.height], tr: [0, doc.height],
        br: [0, 0], bl: [doc.width, 0],
      }[corner] as [number, number];
      const localGrabbed = {
        tl: [0, 0], tr: [doc.width, 0],
        br: [doc.width, doc.height], bl: [0, doc.height],
      }[corner] as [number, number];
      // Pinned canvas position (from start transform).
      const R = rotMat(start.rotation);
      const Qc = {
        x: R[0] * start.sx * localOpposite[0] + R[1] * start.sy * localOpposite[1] + start.tx,
        y: R[2] * start.sx * localOpposite[0] + R[3] * start.sy * localOpposite[1] + start.ty,
      };
      // Diagonal in canvas from pinned to pointer.
      const dx = px - Qc.x;
      const dy = py - Qc.y;
      // Local axes at rotation.
      const ex = { x: Math.cos(start.rotation), y: Math.sin(start.rotation) };
      const ey = { x: -Math.sin(start.rotation), y: Math.cos(start.rotation) };
      // Component of D along local axes, in the direction from opposite to grabbed.
      const signX = localGrabbed[0] - localOpposite[0]; // ±docW
      const signY = localGrabbed[1] - localOpposite[1]; // ±docH
      const alongX = dx * ex.x + dy * ex.y;
      const alongY = dx * ey.x + dy * ey.y;
      const newSx = alongX / signX;
      const newSy = alongY / signY;
      // Guard against collapse
      const sxSafe = Math.abs(newSx) < 0.02 ? Math.sign(newSx || 1) * 0.02 : newSx;
      const sySafe = Math.abs(newSy) < 0.02 ? Math.sign(newSy || 1) * 0.02 : newSy;
      // New translation so pinned corner maps back to Qc.
      const newTx = Qc.x - (R[0] * sxSafe * localOpposite[0] + R[1] * sySafe * localOpposite[1]);
      const newTy = Qc.y - (R[2] * sxSafe * localOpposite[0] + R[3] * sySafe * localOpposite[1]);
      studio!.liveUpdateTransform(layer.id, { sx: sxSafe, sy: sySafe, tx: newTx, ty: newTy });
    };
    const onHandleUp = () => {
      if (!studio) return;
      if (ftDragRef.current && activeLayer) {
        studio.updateTransform(activeLayer.id, { ...activeLayer.transform });
      }
      setFt(null);
    };

    return (
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
        <svg viewBox={`0 0 100 100`} preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}>
          {svgLine(tl, tr)}
          {svgLine(tr, br)}
          {svgLine(br, bl)}
          {svgLine(bl, tl)}
        </svg>
        {([["tl", tl], ["tr", tr], ["br", br], ["bl", bl]] as const).map(([c, pt]) => (
          <div
            key={c}
            style={{ ...handleStyle, ...toPct(pt), cursor: c === "tl" || c === "br" ? "nwse-resize" : "nesw-resize" }}
            onPointerDown={onCornerDown(c)}
            onPointerMove={onHandleMove}
            onPointerUp={onHandleUp}
            onPointerCancel={onHandleUp}
          />
        ))}
        <div
          style={{
            ...handleStyle,
            ...toPct(rotHandle),
            borderRadius: "50%",
            width: 14, height: 14, marginLeft: -7, marginTop: -7,
            background: "#7c5ce7",
            cursor: "grab",
          }}
          onPointerDown={onRotateDown}
          onPointerMove={onHandleMove}
          onPointerUp={onHandleUp}
          onPointerCancel={onHandleUp}
          title="Rotate"
        />
      </div>
    );
  }, [doc, activeLayer, moveTool, studio, eventToDoc, setFt]);

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
            <button onClick={() => psdInput.current?.click()} aria-label="Import PSD" title="Import PSD">PSD</button>
            <button onClick={() => projectInput.current?.click()} aria-label="Open Luma project" title="Open .luma project">LUMA</button>
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
            <button className="spatial-search" onClick={saveProject} title="Save Luma project">
              {saveState === "saving" ? "•••" : saveState === "error" ? "!" : "✓"}
            </button>
            <button className="spatial-search" onClick={() => studio?.undo()} title="Undo (⌘Z)" disabled={!studio?.canUndo()}>↶</button>
            <button className="spatial-search" onClick={() => studio?.redo()} title="Redo (⇧⌘Z)" disabled={!studio?.canRedo()}>↷</button>
            <button className="batch-top-button" onClick={() => setShowFilters((v) => !v)}>
              <span>◐</span> Filters
            </button>
            <button className="batch-top-button" onClick={() => setShowBatch(true)}>
              <span>▦</span> Batch
            </button>
            <button
              className="batch-top-button"
              onClick={() => {
                if (!glSupported) return;
                const next = !useGL;
                setUseGL(next);
                studio?.setUseGL(next);
                notify(next ? "GPU 16F compositing on" : "CPU compositing on");
              }}
              title={glSupported ? "Toggle GPU (RGBA16F) compositing" : "WebGL2 float not supported"}
              disabled={!glSupported}
              style={{ opacity: glSupported ? 1 : 0.4, background: useGL ? "linear-gradient(135deg,#2385f4,#7c5ce7)" : undefined, color: useGL ? "#fff" : undefined }}
            >
              <span>◈</span> {useGL ? "GPU · 16F" : "GPU off"}
            </button>
            <select value={exportFormat} onChange={(event) => setExportFormat(event.target.value as "png" | "jpeg" | "webp")} aria-label="Raster export format" style={{ width: 72 }}>
              <option value="png">PNG</option>
              <option value="jpeg">JPEG</option>
              <option value="webp">WebP</option>
            </select>
            <button className="spatial-export" onClick={exportPNG}>Export {exportFormat.toUpperCase()} ↗</button>
            <button className="spatial-export" onClick={exportPsd}>Export PSD ↗</button>
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
                    if (id === "fill" && activeLayerId) studio?.fillLayer(activeLayerId, brushColor);
                    else setActiveTool(id);
                  }}
                  aria-label={label}
                  title={`${label} (${shortcut})`}
                >
                  <span>{icon}</span>
                  <i>{label}<kbd>{shortcut}</kbd></i>
                </button>
              ))}
            </div>
            <button className="layers-orb" onClick={runSubject} aria-label="Auto subject">✦</button>
          </aside>

          <section className="spatial-canvas-column">
            <div className="spatial-document-tabs" style={{ display: "flex", gap: 4, padding: "5px 8px", overflowX: "auto", background: "rgba(12,12,16,.76)", borderBottom: "1px solid rgba(255,255,255,.08)" }}>
              {openDocuments.map((documentTab) => (
                <button
                  key={documentTab.id}
                  onClick={() => {
                    studio?.switchDocument(documentTab.id);
                    setActiveLayerId(studio?.doc.layers[0]?.id ?? null);
                    setCustomName(documentTab.name);
                  }}
                  style={{ display: "flex", gap: 8, alignItems: "center", minWidth: 112, justifyContent: "space-between", padding: "5px 8px", borderRadius: 7, border: "1px solid rgba(255,255,255,.1)", background: documentTab.active ? "rgba(124,92,231,.24)" : "rgba(255,255,255,.04)", color: "inherit" }}
                >
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{documentTab.name}</span>
                  {openDocuments.length > 1 && (
                    <i onClick={(event) => { event.stopPropagation(); studio?.closeDocument(documentTab.id); setActiveLayerId(studio?.doc.layers[0]?.id ?? null); }}>×</i>
                  )}
                </button>
              ))}
            </div>
            <div
              className="spatial-canvas-stage"
              onWheel={(e) => {
                if (!e.ctrlKey && !e.metaKey && Math.abs(e.deltaY) < 50 && !e.altKey) return;
                e.preventDefault();
                const factor = Math.exp(-e.deltaY * 0.002);
                setView((v) => {
                  const nz = Math.max(0.05, Math.min(32, v.zoom * factor));
                  // Zoom around cursor: shift pan so the point under the cursor stays fixed.
                  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  const cx = e.clientX - rect.left - rect.width / 2;
                  const cy = e.clientY - rect.top - rect.height / 2;
                  const k = nz / v.zoom;
                  return { zoom: nz, panX: cx - k * (cx - v.panX), panY: cy - k * (cy - v.panY) };
                });
              }}
            >
              <div
                className={`spatial-canvas tool-${activeTool} workspace-${workspace}`}
                style={{
                  position: "relative",
                  transform: `translate(${view.panX}px, ${view.panY}px) scale(${view.zoom})`,
                  transformOrigin: "center center",
                }}
              >
                <canvas
                  ref={canvasRef}
                  onPointerDown={onPointerDown}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onPointerCancel={onPointerUp}
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "contain",
                    cursor: canvasCursor,
                    touchAction: "none",
                    display: "block",
                  }}
                />
                {dragOverlay}
                {transformOverlay}
                {penOverlay}
                {showGuides && doc?.guides.map((guide) => (
                  <i
                    key={guide.id}
                    aria-hidden="true"
                    style={guide.orientation === "vertical" ? {
                      position: "absolute", top: 0, bottom: 0, left: `${(guide.position / doc.width) * 100}%`, width: 1,
                      background: "#36d7ff", boxShadow: "0 0 0 1px rgba(0,0,0,.25)", pointerEvents: "none", zIndex: 8,
                    } : {
                      position: "absolute", left: 0, right: 0, top: `${(guide.position / doc.height) * 100}%`, height: 1,
                      background: "#36d7ff", boxShadow: "0 0 0 1px rgba(0,0,0,.25)", pointerEvents: "none", zIndex: 8,
                    }}
                  />
                ))}
                <div className="canvas-status">
                  <span>{doc ? `${doc.width}×${doc.height} · sRGB · ${useGL ? "GPU RGBA16F" : "CPU 8-bit"}` : "Loading…"}</span>
                  <span>{Math.round(view.zoom * 100)}% · {layers.length} layer{layers.length === 1 ? "" : "s"}{doc?.selection ? " · sel" : ""}</span>
                </div>
                {recordingName && (
                  <div style={{ position: "absolute", top: 12, left: 12, background: "rgba(200,30,30,.9)", color: "#fff", padding: "4px 8px", borderRadius: 999, fontSize: 11 }}>
                    ● Recording · {recordingName}
                  </div>
                )}
              </div>
            </div>

            <div className="spatial-filmstrip">
              <div className="filmstrip-mode">
                <strong>{workspaces.find(([id]) => id === workspace)?.[1]}</strong>
                <span>{layers.length} layers</span>
              </div>
              {filmstrip.map((photo, index) => (
                <button
                  key={photo.name}
                  className={activePreset === index && !customName ? "active" : ""}
                  onClick={() => openPreset(index)}
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
                  <button onClick={addBlank} title="Add paint layer">＋</button>
                  <button onClick={addAdjust} title="Add tone adjustment">◐</button>
                  <button onClick={() => { if (studio) { const l = studio.addCurvesLayer(); setActiveLayerId(l.id); } }} title="Add curves">∿</button>
                  <button onClick={() => { if (studio) { const l = studio.addLevelsLayer(); setActiveLayerId(l.id); } }} title="Add levels">▦</button>
                  <button onClick={() => { if (studio) { const l = studio.addHslLayer(); setActiveLayerId(l.id); } }} title="Add HSL">◉</button>
                  <button onClick={() => {
                    if (!studio || !activeLayerId) return;
                    if (activeLayer?.kind === "group") studio.ungroupLayer(activeLayer.id);
                    else {
                      const group = studio.groupLayer(activeLayerId);
                      if (group) setActiveLayerId(group.id);
                    }
                  }} title={activeLayer?.kind === "group" ? "Ungroup" : "Group active layer"}>⌘</button>
                  <button onClick={() => { if (studio && activeLayerId) studio.reorderLayer(activeLayerId, -1); }} title="Move up">↑</button>
                  <button onClick={() => { if (studio && activeLayerId) studio.reorderLayer(activeLayerId, 1); }} title="Move down">↓</button>
                  <button onClick={removeActive} title="Delete active">×</button>
                </div>
              </header>
              <div className="layer-stack">
                {layers.map((layer) => (
                  <button
                    key={layer.id}
                    className={`spatial-layer ${activeLayerId === layer.id ? "active" : ""}`}
                    style={{ marginLeft: layer.parentId ? 14 : 0 }}
                    onClick={() => {
                      setActiveLayerId(layer.id);
                      if (layer.kind === "adjustment-tone") {
                        setActiveAdjustmentId(layer.id);
                        if (layer.tone) setTone({ ...layer.tone });
                      }
                    }}
                  >
                    <span className={`spatial-layer-thumb kind-${layer.kind}`}>
                      {layer.kind === "group" ? "▾" :
                       layer.kind === "smart-object" ? "◇" :
                       layer.kind === "adjustment-tone" ? "◐" :
                       layer.kind === "adjustment-curves" ? "∿" :
                       layer.kind === "adjustment-levels" ? "▦" :
                       layer.kind === "adjustment-hsl" ? "◉" :
                       layer.kind === "text" ? "T" :
                       layer.kind === "shape" ? "▭" :
                       layer.kind === "path" ? "✎" : "▨"}
                    </span>
                    <span className="layer-name">
                      <strong>{layer.name}</strong>
                      <small>{layer.kind}{layer.mask ? " · mask" : ""}{(layer.filters?.length || layer.effects?.length) ? ` · fx ${(layer.filters?.length ?? 0) + (layer.effects?.length ?? 0)}` : ""}{layer.clipping ? " · clip" : ""}{layer.ai ? ` · ${layer.ai.model}` : ""}</small>
                    </span>
                    <i onClick={(e) => { e.stopPropagation(); setLayerVisible(layer.id, !layer.visible); }}>
                      {layer.visible ? "◉" : "○"}
                    </i>
                  </button>
                ))}
              </div>
              {activeLayer && (
                <div className="layer-controls">
                  <select value={activeLayer.blend} onChange={(e) => setLayerBlend(activeLayer.id, e.target.value as BlendMode)}>
                    {blendModes.map((mode) => (<option key={mode} value={mode}>{BLEND_LABELS[mode]}</option>))}
                  </select>
                  <label>
                    <span>Opacity</span>
                    <input type="range" min="0" max="100" value={Math.round(activeLayer.opacity * 100)} onChange={(e) => setLayerOpacity(activeLayer.id, Number(e.target.value) / 100)} />
                    <output>{Math.round(activeLayer.opacity * 100)}%</output>
                  </label>
                  <div style={{ display: "flex", gap: 6, paddingTop: 6 }}>
                    <button onClick={() => studio?.setLayerProp(activeLayer.id, "locked", !activeLayer.locked, activeLayer.locked ? "Layer unlocked" : "Layer locked")} style={{ flex: 1 }}>
                      {activeLayer.locked ? "🔒 Locked" : "◇ Lock"}
                    </button>
                    {activeLayer.kind !== "group" && (
                      <button onClick={() => studio?.setLayerProp(activeLayer.id, "clipping", !activeLayer.clipping, "Clipping mask")} style={{ flex: 1 }}>
                        {activeLayer.clipping ? "✓ Clipped" : "Clip below"}
                      </button>
                    )}
                  </div>
                  {activeLayer.kind !== "group" && (
                    <div style={{ display: "flex", gap: 6, paddingTop: 6 }}>
                      {activeLayer.kind === "raster" && (
                        <button onClick={() => studio?.convertToSmartObject(activeLayer.id)} style={{ flex: 1 }}>
                          ◇ Smart object
                        </button>
                      )}
                      <button onClick={() => studio?.addDropShadow(activeLayer.id)} style={{ flex: 1 }}>
                        fx Drop shadow
                      </button>
                    </div>
                  )}
                  {!!activeLayer.filters?.length && (
                    <div style={{ display: "grid", gap: 4, paddingTop: 6 }}>
                      {activeLayer.filters.map((filter) => (
                        <button key={filter.id} onClick={() => studio?.removeSmartFilter(activeLayer.id, filter.id)} title="Remove Smart Filter" style={{ display: "flex", justifyContent: "space-between" }}>
                          <span>fx · {filter.kind}</span><span>×</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {!!activeLayer.effects?.length && (
                    <div style={{ display: "grid", gap: 4, paddingTop: 6 }}>
                      {activeLayer.effects.map((effect) => (
                        <button key={effect.id} onClick={() => studio?.removeLayerEffect(activeLayer.id, effect.id)} title="Remove layer effect" style={{ display: "flex", justifyContent: "space-between" }}>
                          <span>fx · drop shadow</span><span>×</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </section>

            <section className="glass-card mask-card">
              <header><strong>Document</strong><small>{doc?.resolution.x ?? 72} ppi · {doc?.colorSpace ?? "sRGB"}</small></header>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 5, padding: "8px 10px" }}>
                <label style={{ display: "grid", gap: 3, fontSize: 10 }}>
                  <span>Width px</span>
                  <input key={`width-${doc?.width}`} ref={resizeWidthRef} type="number" min="1" max="32768" defaultValue={doc?.width ?? 1600} style={{ width: "100%" }} />
                </label>
                <label style={{ display: "grid", gap: 3, fontSize: 10 }}>
                  <span>Height px</span>
                  <input key={`height-${doc?.height}`} ref={resizeHeightRef} type="number" min="1" max="32768" defaultValue={doc?.height ?? 1067} style={{ width: "100%" }} />
                </label>
                <button onClick={() => {
                  const width = Number(resizeWidthRef.current?.value);
                  const height = Number(resizeHeightRef.current?.value);
                  if (studio?.resizeDocument(width, height)) notify(`Resized to ${Math.round(width)}×${Math.round(height)}`);
                }} style={{ alignSelf: "end" }}>Resize</button>
              </div>
            </section>

            <section className="glass-card mask-card">
              <header><strong>Guides & snapping</strong><button onClick={() => setShowGuides((visible) => !visible)}>{showGuides ? "Hide" : "Show"}</button></header>
              <div className="mask-actions" style={{ paddingBottom: 6 }}>
                <button onClick={() => doc && studio?.addGuide("vertical", doc.width / 2)}>＋ Vertical</button>
                <button onClick={() => doc && studio?.addGuide("horizontal", doc.height / 2)}>＋ Horizontal</button>
                <button onClick={() => setSnapGuides((enabled) => !enabled)}>{snapGuides ? "✓ Snap" : "Snap off"}</button>
                <button onClick={() => studio?.clearGuides()}>Clear</button>
              </div>
              {!!doc?.guides.length && (
                <div style={{ display: "grid", gap: 4, padding: "0 10px 8px" }}>
                  {doc.guides.map((guide) => (
                    <button key={guide.id} onClick={() => studio?.removeGuide(guide.id)} style={{ display: "flex", justifyContent: "space-between" }} title="Remove guide">
                      <span>{guide.orientation === "vertical" ? "V" : "H"} · {Math.round(guide.position)} px</span><span>×</span>
                    </button>
                  ))}
                </div>
              )}
            </section>

            {workspace === "select" && (
              <section className="glass-card mask-card">
                <header><strong>Selection</strong>
                  <button onClick={() => studio?.deselect()}>×</button>
                </header>
                <div className="mask-controls">
                  <label>
                    <span>Feather</span>
                    <input type="range" min="0" max="64" value={feather} onChange={(e) => setFeather(Number(e.target.value))} />
                    <output>{feather}px</output>
                  </label>
                  {activeTool === "sel-wand" && (
                    <label>
                      <span>Tolerance</span>
                      <input type="range" min="0" max="128" value={wandTolerance} onChange={(e) => setWandTolerance(Number(e.target.value))} />
                      <output>{wandTolerance}</output>
                    </label>
                  )}
                </div>
                <div className="mask-actions">
                  <button onClick={() => studio?.selectAll()}>All</button>
                  <button onClick={() => studio?.deselect()}>None</button>
                  <button onClick={() => {
                    if (studio?.cropToSelection()) notify("Cropped to selection");
                    else notify("Make a selection first");
                  }}>Crop</button>
                  <button onClick={() => studio?.invertSelectionArea()}>Invert</button>
                  <button onClick={() => studio?.featherSelection(feather || 4)}>Feather</button>
                </div>
                <p style={{ padding: "0 12px", fontSize: 11, opacity: 0.65 }}>
                  Hold ⇧ to add · ⌥ to subtract · ⌘ (with wand) for non-contiguous
                </p>
              </section>
            )}

            {workspace === "mask" && (
              <section className="glass-card mask-card">
                <header><strong>Mask brush</strong>
                  <button onClick={() => activeLayerId && studio?.invertMask(activeLayerId)}>◑</button>
                </header>
                <div className="mask-segmented">
                  <button className={activeTool === "mask-add" ? "active" : ""} onClick={() => setActiveTool("mask-add")}>Reveal</button>
                  <button className={activeTool === "mask-remove" ? "active" : ""} onClick={() => setActiveTool("mask-remove")}>Hide</button>
                </div>
                <div className="mask-controls">
                  <label><span>Brush</span><input type="range" min="4" max="400" value={brushSize} onChange={(e) => setBrushSize(Number(e.target.value))} /><output>{brushSize}</output></label>
                  <label><span>Hardness</span><input type="range" min="0" max="100" value={Math.round(hardness * 100)} onChange={(e) => setHardness(Number(e.target.value) / 100)} /><output>{Math.round(hardness * 100)}%</output></label>
                  <label><span>Flow</span><input type="range" min="0" max="100" value={Math.round(brushOpacity * 100)} onChange={(e) => setBrushOpacity(Number(e.target.value) / 100)} /><output>{Math.round(brushOpacity * 100)}%</output></label>
                </div>
                <div className="mask-actions">
                  <button onClick={runNeuralSubject} disabled={!!neural}>
                    {neural ? `Neural ${Math.round(neural.pct)}%` : "Neural subject"}
                  </button>
                  <button onClick={runSubject}>Luma</button>
                  <button onClick={() => activeLayerId && studio?.invertMask(activeLayerId)}>Invert</button>
                  <button onClick={() => activeLayerId && studio?.clearMask(activeLayerId)}>Reveal all</button>
                </div>
              </section>
            )}

            {workspace === "develop" && activeLayer?.kind === "adjustment-curves" && activeLayer.curves && (
              <CurvesEditor
                curves={activeLayer.curves}
                onLive={(c) => studio?.liveUpdateCurves(activeLayer.id, c)}
                onCommit={(c) => studio?.updateCurves(activeLayer.id, c)}
                onReset={() => studio?.updateCurves(activeLayer.id, cloneCurves(NEUTRAL_CURVES))}
              />
            )}
            {workspace === "develop" && activeLayer?.kind === "adjustment-levels" && activeLayer.levels && (
              <LevelsEditor
                levels={activeLayer.levels}
                onLive={(l) => studio?.liveUpdateLevels(activeLayer.id, l)}
                onCommit={(l) => studio?.updateLevels(activeLayer.id, l)}
                onReset={() => studio?.updateLevels(activeLayer.id, { ...NEUTRAL_LEVELS })}
              />
            )}
            {workspace === "develop" && activeLayer?.kind === "adjustment-hsl" && activeLayer.hsl && (
              <HslEditor
                hsl={activeLayer.hsl}
                onLive={(h) => studio?.liveUpdateHsl(activeLayer.id, h)}
                onCommit={(h) => studio?.updateHsl(activeLayer.id, h)}
                onReset={() => studio?.updateHsl(activeLayer.id, { ...NEUTRAL_HSL })}
              />
            )}
            {workspace === "develop" && activeLayer?.kind !== "adjustment-curves" && activeLayer?.kind !== "adjustment-levels" && activeLayer?.kind !== "adjustment-hsl" && (
              <section className="glass-card tone-card">
                <header>
                  <strong>{activeIsAdjustment ? "Develop stack" : "Add Tone"}</strong>
                  <button onClick={resetTone} aria-label="Reset tone">↺</button>
                </header>
                {!activeIsAdjustment && (
                  <div style={{ padding: "8px 12px", fontSize: 12, opacity: 0.75 }}>
                    Nondestructive adjustment. Adjusting creates one.
                  </div>
                )}
                <div className="tone-controls">
                  {toneRows.map(([key, label, min, max, step]) => (
                    <label key={key}>
                      <span>{label}</span>
                      <input type="range" min={min} max={max} step={step} value={tone[key]}
                        onChange={(e) => onToneChange(key, Number(e.target.value))}
                        onPointerUp={onToneCommit} />
                      <output>{key === "exposure" ? tone[key].toFixed(2) : Math.round(tone[key])}</output>
                    </label>
                  ))}
                </div>
                <div style={{ padding: "6px 12px" }}>
                  <button onClick={() => {
                    if (!studio) return;
                    const l = studio.addCurvesLayer();
                    setActiveLayerId(l.id);
                  }} style={{ width: "100%", padding: 6, fontSize: 12, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.14)", color: "inherit", borderRadius: 8 }}>
                    ＋ Add Curves layer
                  </button>
                </div>
              </section>
            )}

            {workspace === "edit" && (
              <section className="glass-card tone-card">
                <header>
                  <strong>Brush</strong>
                  <input type="color" value={brushColor} onChange={(e) => setBrushColor(e.target.value)} aria-label="Brush color" style={{ width: 28, height: 22, border: "none", background: "transparent" }} />
                </header>
                <div className="tone-controls">
                  <label><span>Size</span><input type="range" min="1" max="400" value={brushSize} onChange={(e) => setBrushSize(Number(e.target.value))} /><output>{brushSize}px</output></label>
                  <label><span>Hardness</span><input type="range" min="0" max="100" value={Math.round(hardness * 100)} onChange={(e) => setHardness(Number(e.target.value) / 100)} /><output>{Math.round(hardness * 100)}%</output></label>
                  <label><span>Opacity</span><input type="range" min="0" max="100" value={Math.round(brushOpacity * 100)} onChange={(e) => setBrushOpacity(Number(e.target.value) / 100)} /><output>{Math.round(brushOpacity * 100)}%</output></label>
                </div>
              </section>
            )}

            {workspace === "vector" && (
              <section className="glass-card tone-card">
                <header>
                  <strong>Type & shape</strong>
                  <input type="color" value={brushColor} onChange={(e) => setBrushColor(e.target.value)} aria-label="Fill color" style={{ width: 28, height: 22, border: "none", background: "transparent" }} />
                </header>
                <div style={{ padding: "0 12px 8px" }}>
                  <textarea
                    value={textDraft}
                    onChange={(e) => setTextDraft(e.target.value)}
                    style={{ width: "100%", height: 56, background: "rgba(255,255,255,.06)", border: "1px solid rgba(255,255,255,.14)", borderRadius: 8, color: "inherit", padding: 8, fontSize: 12 }}
                    placeholder="Text to add on click"
                  />
                  {activeLayer?.kind === "text" && activeLayer.text && (
                    <>
                      <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6, fontSize: 11 }}>
                        <span>Font size</span>
                        <input type="range" min="16" max="400" value={parseInt(activeLayer.text.font.match(/(\d+)px/)?.[1] || "96", 10)}
                          onChange={(e) => {
                            const size = Number(e.target.value);
                            const font = activeLayer.text!.font.replace(/\d+px/, `${size}px`);
                            studio?.updateText(activeLayer.id, { font });
                          }} />
                      </label>
                      <button onClick={() => activeLayer?.text && studio?.updateText(activeLayer.id, { text: textDraft })} style={{ marginTop: 4, fontSize: 11 }}>Update active text</button>
                    </>
                  )}
                </div>
              </section>
            )}

            <section className="glass-card neural-card neural-compact">
              <header>
                <strong><span>✦</span> Neural Lab</strong>
                <small>LOCAL + GPT IMAGE</small>
              </header>
              <div style={{ display: "grid", gap: 6, padding: "8px 10px 4px" }}>
                <textarea
                  value={aiPrompt}
                  onChange={(event) => setAiPrompt(event.target.value)}
                  aria-label="Generative edit prompt"
                  style={{ minHeight: 58, resize: "vertical", borderRadius: 8, padding: 8, background: "rgba(255,255,255,.06)", color: "inherit", border: "1px solid rgba(255,255,255,.14)" }}
                />
                <div style={{ display: "flex", gap: 6 }}>
                  <select value={aiOperation} onChange={(event) => setAiOperation(event.target.value as AiProvenance["operation"])} style={{ flex: 1 }}>
                    <option value="fill">Generative fill</option>
                    <option value="remove">Remove</option>
                    <option value="relight">Relight</option>
                    <option value="harmonize">Harmonize</option>
                    <option value="upscale">Upscale detail</option>
                    <option value="expand">Expand</option>
                  </select>
                  <button onClick={runGenerativeEdit} disabled={aiRunning || !aiPrompt.trim()} style={{ flex: 1 }}>
                    {aiRunning ? "Creating…" : "Generate layer ✦"}
                  </button>
                </div>
                <small style={{ opacity: 0.58 }}>Uses the active selection as guidance. Sign-in and hosted API configuration are required.</small>
              </div>
              <div className="neural-quick-grid">
                <button onClick={runNeuralSubject} disabled={!!neural}>
                  <i>✦</i>
                  <span>{neural ? `${Math.round(neural.pct)}%` : "Neural subject"}</span>
                </button>
                <button onClick={runSubject}><i>◐</i><span>Luma mask</span></button>
                <button onClick={() => activeLayerId && studio?.invertMask(activeLayerId)}><i>◑</i><span>Invert mask</span></button>
                <button onClick={() => activeLayerId && studio?.clearMask(activeLayerId)}><i>◯</i><span>Reveal all</span></button>
              </div>
            </section>

            <section className="glass-card neural-card neural-compact">
              <header>
                <strong>Actions</strong>
                {recordingName ? (
                  <button onClick={stopRecording} title="Stop">◼</button>
                ) : (
                  <button onClick={startRecording} title="Record">●</button>
                )}
              </header>
              <div className="neural-quick-grid">
                {studio?.actions.list().map((a, i) => (
                  <button key={a.name + i} onClick={() => playAction(i)}>
                    <i>▶</i><span>{a.name}<br /><small style={{ opacity: 0.6 }}>{a.steps.length} steps</small></span>
                  </button>
                ))}
                {(!studio?.actions.list().length) && (
                  <div style={{ padding: "8px 4px", fontSize: 11, opacity: 0.6 }}>
                    Hit ● to record a series of edits.
                  </div>
                )}
              </div>
            </section>

            <div className="spatial-view-dock">
              <button onClick={() => studio?.undo()} title="Undo" disabled={!studio?.canUndo()}>↶</button>
              <button onClick={() => studio?.redo()} title="Redo" disabled={!studio?.canRedo()}>↷</button>
              <button onClick={() => studio?.selectAll()} title="Select all">▭</button>
              <span />
              <button onClick={() => notify(`${studio?.historyLabels().length ?? 0} states`)} title="History">◴</button>
            </div>
          </aside>
        </div>
      </section>

      {showFilters && (
        <div className="spatial-modal" onMouseDown={() => setShowFilters(false)}>
          <section className="spatial-command" onMouseDown={(e) => e.stopPropagation()}>
            <div><span>◐</span><strong style={{ padding: "0 8px" }}>Filters</strong><kbd>esc</kbd></div>
            <p>Adds editable, nondestructive Smart Filters to the active layer.</p>
            <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", fontSize: 12 }}>
              <span style={{ width: 90 }}>Blur radius</span>
              <input type="range" min="1" max="64" value={blurRadius} onChange={(e) => setBlurRadius(Number(e.target.value))} style={{ flex: 1 }} />
              <output>{blurRadius}px</output>
            </label>
            <button onClick={() => { runFilter("blur", { radius: blurRadius }); }}><i>◌</i><span>Gaussian blur</span><kbd>↵</kbd></button>
            <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", fontSize: 12 }}>
              <span style={{ width: 90 }}>Sharpen</span>
              <input type="range" min="0" max="200" value={Math.round(sharpAmount * 100)} onChange={(e) => setSharpAmount(Number(e.target.value) / 100)} style={{ flex: 1 }} />
              <output>{sharpAmount.toFixed(2)}</output>
            </label>
            <button onClick={() => runFilter("sharpen", { radius: 2, amount: sharpAmount })}><i>✧</i><span>Unsharp mask</span><kbd>↵</kbd></button>
            <button onClick={() => runFilter("invert")}><i>◑</i><span>Invert colors</span><kbd>↵</kbd></button>
            <button onClick={() => runFilter("desaturate", { amount: 1 })}><i>◐</i><span>Desaturate</span><kbd>↵</kbd></button>
            <button onClick={() => runFilter("hue", { degrees: 45 })}><i>✦</i><span>Hue rotate +45°</span><kbd>↵</kbd></button>
          </section>
        </div>
      )}

      {showBatch && (
        <div className="spatial-modal" onMouseDown={() => !batchProgress && setShowBatch(false)}>
          <section className="batch-modal" onMouseDown={(e) => e.stopPropagation()}>
            <header>
              <div>
                <span>▦</span>
                <div>
                  <strong>Batch Studio</strong>
                  <small>Apply a recorded action to a set of images, download as a ZIP</small>
                </div>
              </div>
              <button onClick={() => !batchProgress && setShowBatch(false)}>×</button>
            </header>
            <div className="batch-toolbar">
              <div>
                <span style={{ fontSize: 12, opacity: 0.7, marginRight: 8 }}>Action:</span>
                <select
                  value={selectedActionIdx ?? ""}
                  onChange={(e) => setSelectedActionIdx(e.target.value === "" ? null : Number(e.target.value))}
                  style={{ padding: "4px 8px", fontSize: 12, borderRadius: 6, background: "rgba(255,255,255,.06)", color: "inherit", border: "1px solid rgba(255,255,255,.14)" }}
                >
                  <option value="">(none — export unchanged)</option>
                  {studio?.actions.list().map((a, i) => (
                    <option key={i} value={i}>{a.name} · {a.steps.length} steps</option>
                  ))}
                </select>
              </div>
              <button onClick={() => batchInput.current?.click()}>＋ Add images</button>
            </div>
            <div className={`batch-grid ${batchFiles.length ? "" : "empty"}`}>
              {!batchFiles.length ? (
                <button onClick={() => batchInput.current?.click()}>
                  <i>＋</i><strong>Drop images to process</strong><span>PNG, JPG, WebP · local processing</span>
                </button>
              ) : batchFiles.map((f, i) => (
                <article key={i}>
                  <div>
                    <span>
                      {batchProgress && batchProgress.i > i ? "✓" : batchProgress?.i === i ? "•" : `${i + 1}`}
                    </span>
                  </div>
                  <strong>{f.name}</strong>
                  <small>{(f.size / 1024).toFixed(0)} KB</small>
                </article>
              ))}
            </div>
            <footer>
              <span>
                {batchProgress
                  ? `${batchProgress.i} / ${batchProgress.total} · ${batchProgress.name}`
                  : `${batchFiles.length} image${batchFiles.length === 1 ? "" : "s"}${selectedActionIdx != null ? " · action selected" : ""}`}
              </span>
              <div style={{ display: "flex", gap: 8 }}>
                {batchFiles.length > 0 && !batchProgress && (
                  <button onClick={() => setBatchFiles([])} style={{ background: "rgba(255,255,255,.06)" }}>Clear</button>
                )}
                <button onClick={runBatchNow} disabled={!batchFiles.length || !!batchProgress}>
                  {batchProgress ? "Running…" : "Run & download ZIP ✦"}
                </button>
              </div>
            </footer>
          </section>
        </div>
      )}
      <input
        ref={batchInput}
        className="visually-hidden"
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length) setBatchFiles((existing) => [...existing, ...files]);
          e.target.value = "";
        }}
      />
      {neural && (
        <div
          style={{
            position: "fixed",
            bottom: 32,
            left: "50%",
            transform: "translateX(-50%)",
            padding: "12px 20px",
            background: "rgba(18,18,22,0.94)",
            border: "1px solid rgba(255,255,255,0.14)",
            borderRadius: 14,
            color: "#fff",
            display: "flex",
            gap: 12,
            alignItems: "center",
            minWidth: 320,
            zIndex: 40,
            boxShadow: "0 20px 60px rgba(0,0,0,.5)",
          }}
        >
          <span style={{ fontSize: 18 }}>✦</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 4 }}>Neural subject</div>
            <div style={{ height: 4, borderRadius: 2, background: "rgba(255,255,255,0.14)", overflow: "hidden" }}>
              <div
                style={{
                  height: "100%",
                  width: `${Math.min(100, Math.max(2, neural.pct))}%`,
                  background: "linear-gradient(90deg,#7c5ce7,#2385f4)",
                  transition: "width 200ms ease",
                }}
              />
            </div>
            <div style={{ fontSize: 11, opacity: 0.6, marginTop: 4 }}>{neural.msg}</div>
          </div>
        </div>
      )}
      <input ref={fileInput} className="visually-hidden" type="file" accept="image/*" onChange={onFileChange} />
      <input ref={psdInput} className="visually-hidden" type="file" accept=".psd,image/vnd.adobe.photoshop" onChange={onPsdImport} />
      <input ref={projectInput} className="visually-hidden" type="file" accept=".luma,application/x-luma-project" onChange={onProjectImport} />
      {toast && <div className="spatial-toast" role="status"><span>✓</span>{toast}</div>}
    </main>
  );
}
