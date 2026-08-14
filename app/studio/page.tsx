"use client";

import {
  ChangeEvent,
  PointerEvent as ReactPointerEvent,
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { LUMA_API_VERSION, LumaAPI, Studio } from "@/app/engine/studio";
import {
  AiProvenance,
  CapturedBrushAsset,
  Layer,
  NEUTRAL_CURVES,
  EFFECT_LABELS,
  NEUTRAL_HSL,
  NEUTRAL_LEVELS,
  NEUTRAL_TONE,
  PathAnchor,
  PathStyle,
  ProofProfile,
  ProofSettings,
  ToneParams,
  Transform,
  cloneCurves,
  documentPointToLayer,
  layerCorners,
  resolvedBlendPasses,
  resolvedBlendIf,
  resolvedFillOpacity,
} from "@/app/engine/document";
import { isNeutralBlendIf } from "@/app/engine/blend";
import { BrushParams, type ImageBrushMode } from "@/app/engine/brush";
import { readRecoveryWorkspace, writeRecoveryWorkspace } from "@/app/engine/autosave";
import { CoalescedSaveQueue } from "@/app/engine/save-queue";
import { RAW_EXTENSIONS, ingestRaw, rawExtension } from "@/app/engine/raw";
import type { RawDevelopSettings } from "@/app/engine/raw-develop";
import { extractAndParseEmbeddedColorProfile } from "@/app/engine/embedded-color-profile";
import { defaultColorProfileRegistry } from "@/app/engine/color-management";
import {
  AiEditAuthenticationError,
  resolveAiEditEndpoint,
  type AiEditQuality,
  type AiOperationControls,
} from "@/app/engine/ai-edit";
import type { RetouchMode } from "@/app/engine/retouch";
import {
  snapPointToEdge,
  type PatternKind,
  type Point,
  type Quad,
} from "@/app/engine/advanced-tools";
import {
  calculateDisplayViewport,
  viewportPointToDocument,
  type DisplayViewport,
} from "@/app/engine/viewport";
import {
  isNativeFilesystemAvailable,
  openNativeAiSignIn,
  openNativeFile,
  readNativePath,
  saveNativeFile,
} from "@/app/engine/native-files";
import {
  defaultWorkflowPreferences,
  normalizeShortcut,
  normalizeWorkflowPreferences,
  reservedShortcutReason,
  resolveShortcut,
  shortcutConflict,
  type WorkflowPreferences,
} from "@/app/engine/workflow-preferences";
import {
  EMPTY_LAYER_FOCUS_STATE,
  enterLayerFocus,
  fitViewToLayer,
  focusBreadcrumbLayers,
  focusItems,
  hitTestEditableLayer,
  leaveLayerFocus,
  normalizeLayerFocusPreferences,
  reconcileLayerFocus,
  supportsIsolatedFocus,
  type FocusContextMode,
  type FocusEditTarget,
  type LayerFocusState,
} from "./layer-focus-model";
import type { FocusCreateAction } from "./layer-focus-panel";
import { listenForMenuCommands, listenForOpenFile, publishRecentFiles } from "../desktop/native-menu";
import { loadRecentFiles, saveRecentFiles, withRecentFile } from "../desktop/recent-files";
import type { StudioCommand } from "../desktop/menu-model";
import { cornerDragTransform, rotMat, snapTranslation } from "./canvas-geometry";
import type { TransformCorner } from "./canvas-geometry";

const ExportPopover = lazy(() => import("./export-popover"));
const ToolDock = lazy(() => import("./tool-dock"));
const DesktopStatusbar = lazy(() => import("./desktop-statusbar"));
const StudioTitlebar = lazy(() => import("./studio-titlebar"));
const ContextToolbar = lazy(() => import("./context-toolbar"));
const LayerFocusPanel = lazy(() => import("./layer-focus-panel"));
const BlendStackEditor = lazy(() => import("./blend-stack-editor"));
const LayerStyleDialog = lazy(() => import("./layer-style-dialog"));
const SmartFilterEditor = lazy(() => import("./layer-editors").then((module) => ({ default: module.SmartFilterEditor })));
const CurvesEditor = lazy(() => import("./layer-editors").then((module) => ({ default: module.CurvesEditor })));
const LevelsEditor = lazy(() => import("./layer-editors").then((module) => ({ default: module.LevelsEditor })));
const HslEditor = lazy(() => import("./layer-editors").then((module) => ({ default: module.HslEditor })));

type ToneKey = keyof ToneParams;
type WorkspaceMode = "edit" | "retouch" | "select" | "mask" | "develop" | "vector" | "transform" | "measure";
type SelectionCombineMode = "replace" | "add" | "subtract" | "intersect";
type Tool =
  | "move"
  | "brush"
  | "capture-brush"
  | "pencil"
  | "mixer"
  | "erase"
  | "gradient"
  | "pattern"
  | "clone"
  | "heal"
  | "spot-heal"
  | "patch"
  | "remove"
  | "dodge"
  | "burn"
  | "blur-brush"
  | "sharpen-brush"
  | "smudge"
  | "sponge"
  | "liquify"
  | "fill"
  | "text"
  | "paragraph-text"
  | "vertical-text"
  | "path-text"
  | "type-mask"
  | "rect"
  | "ellipse"
  | "triangle"
  | "polygon"
  | "line"
  | "custom-shape"
  | "frame"
  | "pen"
  | "path-select"
  | "direct-select"
  | "mask-add"
  | "mask-remove"
  | "sel-rect"
  | "sel-ellipse"
  | "sel-lasso"
  | "sel-polygon"
  | "sel-magnetic"
  | "sel-quick"
  | "sel-wand"
  | "sel-sam"
  | "tone"
  | "crop"
  | "perspective-crop"
  | "straighten"
  | "content-move"
  | "perspective-warp"
  | "puppet-warp"
  | "eyedropper"
  | "color-sampler"
  | "ruler";

const workspaces: ReadonlyArray<readonly [WorkspaceMode, string, string]> = [
  ["edit", "Edit", "Pixel + vector"],
  ["retouch", "Retouch", "Repair + paint"],
  ["select", "Select", "Marquee, lasso, wand"],
  ["mask", "Mask", "Selection intelligence"],
  ["develop", "Develop", "Nondestructive color"],
  ["vector", "Type", "Text + shapes"],
  ["transform", "Transform", "Crop + deform"],
  ["measure", "Measure", "Color + dimensions"],
];

const modeTools: Record<WorkspaceMode, ReadonlyArray<readonly [Tool, string, string, string]>> = {
  edit: [
    ["move", "↖", "Move", "V"],
    ["brush", "╱", "Brush", "B"],
    ["capture-brush", "◉", "Capture Brush", "C"],
    ["pencil", "✎", "Pencil", "N"],
    ["mixer", "≈", "Mixer brush", "X"],
    ["erase", "⌫", "Erase", "E"],
    ["gradient", "◩", "Gradient", "G"],
    ["pattern", "▦", "Pattern", "P"],
    ["fill", "▣", "Fill", "F"],
  ],
  retouch: [
    ["clone", "◎", "Clone stamp", "S"],
    ["heal", "✚", "Healing brush", "J"],
    ["spot-heal", "✣", "Spot healing", "Q"],
    ["patch", "⬡", "Patch", "A"],
    ["remove", "◇", "Remove", "R"],
    ["dodge", "◌", "Dodge", "O"],
    ["burn", "●", "Burn", "U"],
    ["blur-brush", "◍", "Blur", "L"],
    ["sharpen-brush", "◆", "Sharpen", "H"],
    ["smudge", "〰", "Smudge", "M"],
    ["sponge", "◉", "Sponge", "D"],
    ["liquify", "≋", "Liquify", "Y"],
  ],
  select: [
    ["sel-rect", "▭", "Rect marquee", "M"],
    ["sel-ellipse", "◯", "Ellipse marquee", "N"],
    ["sel-lasso", "◜", "Lasso", "L"],
    ["sel-polygon", "⬠", "Polygonal lasso", "P"],
    ["sel-magnetic", "↯", "Magnetic lasso", "G"],
    ["sel-quick", "◒", "Quick selection", "Q"],
    ["sel-wand", "✣", "Magic wand", "W"],
    ["sel-sam", "✦", "SAM click-select", "K"],
  ],
  mask: [
    ["mask-add", "＋", "Reveal", "B"],
    ["mask-remove", "−", "Hide", "E"],
  ],
  develop: [
    ["tone", "◐", "Tone", "T"],
  ],
  vector: [
    ["text", "T", "Text", "T"],
    ["paragraph-text", "¶", "Paragraph text", "A"],
    ["vertical-text", "↧", "Vertical text", "V"],
    ["path-text", "⌒", "Type on path", "Y"],
    ["type-mask", "T⃞", "Type mask", "M"],
    ["rect", "▭", "Rect", "R"],
    ["ellipse", "◯", "Ellipse", "O"],
    ["triangle", "△", "Triangle", "I"],
    ["polygon", "⬡", "Polygon", "G"],
    ["line", "╱", "Line", "L"],
    ["custom-shape", "★", "Custom shape", "C"],
    ["frame", "▣", "Frame", "F"],
    ["pen", "✎", "Pen", "P"],
    ["path-select", "↖", "Path selection", "S"],
    ["direct-select", "△", "Direct selection", "D"],
  ],
  transform: [
    ["crop", "⌗", "Crop", "C"],
    ["perspective-crop", "▱", "Perspective crop", "K"],
    ["straighten", "／", "Straighten", "S"],
    ["content-move", "⇥", "Content-aware move", "M"],
    ["perspective-warp", "◇", "Perspective warp", "W"],
    ["puppet-warp", "⌘", "Puppet warp", "P"],
  ],
  measure: [
    ["eyedropper", "⌁", "Eyedropper", "I"],
    ["color-sampler", "⊕", "Color sampler", "S"],
    ["ruler", "╱", "Ruler", "R"],
  ],
};

const workspaceIds = workspaces.map(([id]) => id);
const allToolIds = [...new Set(Object.values(modeTools).flat().map(([tool]) => tool))];
const WORKFLOW_PREFERENCES_KEY = "luma.workflow-preferences.v1";
const LAYER_FOCUS_PREFERENCES_KEY = "luma.layer-focus.v1";
const initialWorkflowPreferences = defaultWorkflowPreferences<WorkspaceMode, Tool>(workspaceIds);

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

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function CapturedBrushThumbnail({ asset }: { asset: CapturedBrushAsset }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(asset.bitmap, 0, 0, canvas.width, canvas.height);
  }, [asset]);
  return <canvas ref={ref} width={48} height={48} aria-hidden="true" />;
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

export default function SpatialStudio({ desktop = false }: { desktop?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const psdInput = useRef<HTMLInputElement>(null);
  const projectInput = useRef<HTMLInputElement>(null);
  const captureInput = useRef<HTMLInputElement>(null);
  const focusImportInput = useRef<HTMLInputElement>(null);
  const inspectorRef = useRef<HTMLElement>(null);
  const [studio, setStudio] = useState<Studio | null>(null);
  const [, setVersion] = useState(0);
  const forceUpdate = useCallback(() => setVersion((n) => n + 1), []);

  const [workspace, setWorkspace] = useState<WorkspaceMode>("edit");
  const [activeTool, setActiveTool] = useState<Tool>("brush");
  const [inspectorTab, setInspectorTab] = useState<"layers" | "properties" | "ai">("layers");
  const [assetsOpen, setAssetsOpen] = useState(true);
  const [dropActive, setDropActive] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [showWorkspaceSettings, setShowWorkspaceSettings] = useState(false);
  const [workflowPreferences, setWorkflowPreferences] = useState<WorkflowPreferences<WorkspaceMode, Tool>>(initialWorkflowPreferences);
  const [workflowPreferencesLoaded, setWorkflowPreferencesLoaded] = useState(false);
  const [recentLayerIds, setRecentLayerIds] = useState<string[]>([]);
  const [pinnedLayerIds, setPinnedLayerIds] = useState<string[]>([]);
  const [focusPreferencesLoaded, setFocusPreferencesLoaded] = useState(false);
  const [focusState, setFocusState] = useState<LayerFocusState>(EMPTY_LAYER_FOCUS_STATE);
  const [activeLayerId, setActiveLayerIdState] = useState<string | null>(null);
  const [draggedLayerId, setDraggedLayerId] = useState<string | null>(null);
  const [styleLayerId, setStyleLayerId] = useState<string | null>(null);
  /**
   * Open Recent. A ref rather than state: nothing in the React tree renders it
   * — the native menu is the only consumer — so making it state would trigger
   * a re-render of the whole studio every time a document opened.
   */
  const recentFilesRef = useRef<string[]>([]);
  const activeLayerIdRef = useRef<string | null>(null);
  const setActiveLayerId = useCallback((id: string | null) => {
    activeLayerIdRef.current = id;
    setActiveLayerIdState(id);
    if (id) setRecentLayerIds((current) => [id, ...current.filter((candidate) => candidate !== id)].slice(0, 24));
  }, []);
  const [activeAdjustmentId, setActiveAdjustmentId] = useState<string | null>(null);
  const [tone, setTone] = useState<ToneParams>({ ...NEUTRAL_TONE });
  const [rawDevelopDraft, setRawDevelopDraft] = useState<{
    layerId: string;
    settings: RawDevelopSettings;
  } | null>(null);
  const [brushSize, setBrushSize] = useState(48);
  const [hardness, setHardness] = useState(0.7);
  const [brushOpacity, setBrushOpacity] = useState(0.9);
  const [brushFlow, setBrushFlow] = useState(0.32);
  const [brushSpacing, setBrushSpacing] = useState(0.12);
  const [brushRoundness, setBrushRoundness] = useState(1);
  const [brushAngle, setBrushAngle] = useState(0);
  const [pressureSize, setPressureSize] = useState(true);
  const [pressureOpacity, setPressureOpacity] = useState(true);
  const [brushSmoothing, setBrushSmoothing] = useState(0.18);
  const [brushScatter, setBrushScatter] = useState(0);
  const [brushTilt, setBrushTilt] = useState(0.55);
  const [brushTexture, setBrushTexture] = useState(0);
  const [brushBuildUp, setBrushBuildUp] = useState(true);
  const [brushBlendMode, setBrushBlendMode] = useState<NonNullable<BrushParams["blendMode"]>>("normal");
  const [brushSymmetry, setBrushSymmetry] = useState<"none" | "horizontal" | "vertical" | "radial">("none");
  const [brushColor, setBrushColor] = useState("#ffffff");
  const [activeCapturedBrushId, setActiveCapturedBrushId] = useState<string | null>(null);
  const [capturedBrushMode, setCapturedBrushMode] = useState<ImageBrushMode>("color");
  const [captureSampling, setCaptureSampling] = useState(false);
  const [captureSampleMerged, setCaptureSampleMerged] = useState(true);
  const [captureRadius, setCaptureRadius] = useState(64);
  const [captureHover, setCaptureHover] = useState<Point | null>(null);
  const [captureSource, setCaptureSource] = useState<{
    name: string;
    canvas: HTMLCanvasElement;
    previewUrl: string;
    centerX: number;
    centerY: number;
    radius: number;
  } | null>(null);
  const [secondaryColor, setSecondaryColor] = useState("#10131d");
  const [gradientType, setGradientType] = useState<"linear" | "radial">("linear");
  const [patternKind, setPatternKind] = useState<PatternKind>("checker");
  const [patternScale, setPatternScale] = useState(24);
  const [warpRadius, setWarpRadius] = useState(180);
  const [colorSamples, setColorSamples] = useState<Array<Point & { color: string }>>([]);
  const [measurement, setMeasurement] = useState<{ start: Point; end: Point } | null>(null);
  const [retouchSample, setRetouchSample] = useState<{ x: number; y: number } | null>(null);
  const retouchActive = useRef(false);
  const [feather, setFeather] = useState(0);
  const [wandTolerance, setWandTolerance] = useState(24);
  const [selectionSmooth, setSelectionSmooth] = useState(2);
  const [selectionContrast, setSelectionContrast] = useState(12);
  const [selectionShift, setSelectionShift] = useState(0);
  const [selectionMode, setSelectionMode] = useState<SelectionCombineMode>("replace");
  const [toast, setToast] = useState("");
  const activePreset = 0;
  const [customName, setCustomName] = useState<string | null>(null);
  const [layerCompName, setLayerCompName] = useState("Layer Comp");
  const [artboardName, setArtboardName] = useState("Artboard");
  const [textDraft, setTextDraft] = useState("WANDER FARTHER");
  const [textSize, setTextSize] = useState(96);
  const [recordingName, setRecordingName] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [blurRadius, setBlurRadius] = useState(8);
  const [sharpAmount, setSharpAmount] = useState(0.6);
  const [neural, setNeural] = useState<{ msg: string; pct: number } | null>(null);
  const [aiPrompt, setAiPrompt] = useState("Replace the selected area naturally while preserving the rest of the photograph");
  const [aiOperation, setAiOperation] = useState<AiProvenance["operation"]>("fill");
  const [aiRunning, setAiRunning] = useState(false);
  const [aiQuality, setAiQuality] = useState<AiEditQuality>("medium");
  const [aiVariations, setAiVariations] = useState(1);
  const [aiStrength, setAiStrength] = useState(0.8);
  const [aiPreserve, setAiPreserve] = useState(0.95);
  const [aiTemperature, setAiTemperature] = useState(0);
  const aiAbort = useRef<AbortController | null>(null);
  const [showBatch, setShowBatch] = useState(false);
  const [batchFiles, setBatchFiles] = useState<File[]>([]);
  const [batchProgress, setBatchProgress] = useState<{ i: number; total: number; name: string } | null>(null);
  const batchInput = useRef<HTMLInputElement>(null);
  const [selectedActionIdx, setSelectedActionIdx] = useState<number | null>(null);
  const [useGL, setUseGL] = useState(false);
  const [saveState, setSaveState] = useState<"saved" | "unsaved" | "saving" | "error">("saved");
  const [exportFormat, setExportFormat] = useState<"png" | "jpeg" | "webp">("png");
  const [photoshopFormat, setPhotoshopFormat] = useState<"auto" | "source" | "psd" | "psb">("auto");
  const [snapGuides, setSnapGuides] = useState(true);
  const [showGuides, setShowGuides] = useState(true);
  const resizeWidthRef = useRef<HTMLInputElement>(null);
  const resizeHeightRef = useRef<HTMLInputElement>(null);
  const resolutionRef = useRef<HTMLInputElement>(null);
  const glSupported = !!studio && Studio.canUseGL();

  // View transform (zoom + pan). 1.0 = fit-to-stage size. Pan is in stage pixels.
  const [view, setView] = useState({ zoom: 1, panX: 0, panY: 0 });
  const viewAnimationRef = useRef<number | null>(null);
  const [displayViewport, setDisplayViewport] = useState<DisplayViewport | null>(null);
  const spaceHeld = useRef(false);
  const panDragRef = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null);

  // Draft state for pending vector/marquee shapes.
  type Drag = {
    x0: number; y0: number; x1: number; y1: number;
    kind: "sel-rect" | "sel-ellipse" | "rect" | "ellipse" | "triangle" | "polygon" | "line" | "custom-shape" | "frame" | "paragraph-text" | "sel-lasso" | "move-layer" | "gradient" | "crop" | "straighten" | "content-move" | "puppet-warp" | "ruler";
    path?: Array<{ x: number; y: number }>;
    moveStart?: { tx: number; ty: number };
  };
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const setDragBoth = (d: Drag | null) => { dragRef.current = d; setDrag(d); };
  const resolvedSelectionMode = useCallback((event: { shiftKey: boolean; altKey: boolean }): SelectionCombineMode => (
    event.shiftKey ? "add" : event.altKey ? "subtract" : selectionMode
  ), [selectionMode]);

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
  const [pointDraft, setPointDraft] = useState<Point[]>([]);
  const directAnchorRef = useRef<{ layerId: string; index: number; original: PathStyle; next: PathStyle } | null>(null);

  const notify = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(""), 1900);
  }, []);

  useEffect(() => {
    const hydration = window.setTimeout(() => {
      try {
        const stored = window.localStorage.getItem(WORKFLOW_PREFERENCES_KEY);
        setWorkflowPreferences(normalizeWorkflowPreferences(
          stored ? JSON.parse(stored) : null,
          workspaceIds,
          allToolIds,
        ));
      } catch {
        setWorkflowPreferences(initialWorkflowPreferences);
      }
      setWorkflowPreferencesLoaded(true);
    }, 0);
    return () => window.clearTimeout(hydration);
  }, []);

  useEffect(() => {
    if (!workflowPreferencesLoaded) return;
    try {
      window.localStorage.setItem(WORKFLOW_PREFERENCES_KEY, JSON.stringify(workflowPreferences));
    } catch {
      // The editor remains fully usable when storage is blocked.
    }
  }, [workflowPreferences, workflowPreferencesLoaded]);

  useEffect(() => {
    const hydration = window.setTimeout(() => {
      try {
        const stored = window.localStorage.getItem(LAYER_FOCUS_PREFERENCES_KEY);
        const preferences = normalizeLayerFocusPreferences(stored ? JSON.parse(stored) : null);
        setPinnedLayerIds(preferences.pinnedLayerIds);
        setRecentLayerIds(preferences.recentLayerIds);
      } catch {
        setPinnedLayerIds([]);
        setRecentLayerIds([]);
      }
      setFocusPreferencesLoaded(true);
    }, 0);
    return () => window.clearTimeout(hydration);
  }, []);

  useEffect(() => {
    if (!focusPreferencesLoaded) return;
    try {
      window.localStorage.setItem(LAYER_FOCUS_PREFERENCES_KEY, JSON.stringify({
        version: 1,
        pinnedLayerIds,
        recentLayerIds,
      }));
    } catch {
      // Focus remains available when device storage is blocked.
    }
  }, [focusPreferencesLoaded, pinnedLayerIds, recentLayerIds]);

  useEffect(() => {
    if (!canvasRef.current) return;
    const target = canvasRef.current;
    const s = new Studio(1600, 1067, target);
    const unsub = s.subscribe(() => {
      forceUpdate();
      const selected = activeLayerIdRef.current;
      if (!selected || !s.findLayer(selected)) setActiveLayerId(s.doc.layers[0]?.id ?? null);
      setActiveAdjustmentId((current) => current && !s.findLayer(current) ? null : current);
    });
    const api: LumaAPI = {
      version: LUMA_API_VERSION,
      studio: s,
      layers: () => s.doc.layers,
      active: () => (activeLayerIdRef.current ? s.findLayer(activeLayerIdRef.current) ?? null : null),
      select: (id: string | null) => setActiveLayerId(id),
      documents: () => s.listDocuments(),
      history: () => s.historyState(),
      engine: () => s.engineState(),
      checkoutHistory: (nodeId) => s.checkoutHistory(nodeId),
      registerPlugin: (plugin) => s.registerPlugin(plugin),
      plugins: () => s.listPlugins(),
      export: (type, quality) => s.exportImage(type, quality),
    };
    // The scripting surface hands out full document access plus export(), so
    // it is a development tool by default. Ship it in production only when the
    // user has explicitly opted in — see README "Scripting surface".
    const devBuild = (import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV === true;
    let optedIn = false;
    try {
      optedIn = window.localStorage?.getItem("luma.scripting") === "on";
    } catch {
      optedIn = false; // storage can throw under strict privacy settings
    }
    const scriptingEnabled = devBuild || optedIn;
    if (scriptingEnabled) (window as unknown as { luma?: LumaAPI }).luma = api;
    setStudio(s);
    (async () => {
      try {
        const recovery = await readRecoveryWorkspace();
        if (recovery.length) {
          const ordered = [...recovery.filter((entry) => !entry.active), ...recovery.filter((entry) => entry.active)];
          let project: Awaited<ReturnType<Studio["importProject"]>> | null = null;
          for (const entry of ordered) project = await s.importProject(entry.blob);
          if (!project) throw new Error("Recovery workspace was empty");
          setActiveLayerId(project.doc.layers[0]?.id ?? null);
          setCustomName(project.name);
          notify(recovery.length === 1 ? `Recovered ${project.name}` : `Recovered ${recovery.length} open documents`);
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
  const activeDocumentId = openDocuments.find((documentTab) => documentTab.active)?.id ?? null;
  const resolvedFocusState = reconcileLayerFocus(focusState, doc, activeDocumentId);
  const activeLayer = layers.find((l) => l.id === activeLayerId) ?? layers[0] ?? null;
  // The dialog closes itself if the layer it was opened for is deleted.
  const styleLayer = layers.find((layer) => layer.id === styleLayerId) ?? null;
  const focusedLayer = resolvedFocusState.scope
    ? layers.find((layer) => layer.id === resolvedFocusState.scope?.layerId) ?? null
    : null;
  const focusPanelItems = doc
    ? focusItems(doc, resolvedFocusState, activeLayerId, pinnedLayerIds, recentLayerIds)
    : [];
  const focusBreadcrumbs = doc ? focusBreadcrumbLayers(doc, resolvedFocusState) : [];
  const capturedBrushes = doc?.capturedBrushes ?? [];
  const capturedBrushRevision = doc?.capturedBrushes;
  const capturedBrushColorSpace = doc?.colorSpace;
  const capturedBrushTip = useMemo(
    () => studio && activeCapturedBrushId && capturedBrushRevision && capturedBrushColorSpace
      ? studio.capturedBrushTip(activeCapturedBrushId, capturedBrushMode)
      : null,
    [studio, activeCapturedBrushId, capturedBrushMode, capturedBrushRevision, capturedBrushColorSpace],
  );
  const rawDevelop = activeLayer?.raw
    ? rawDevelopDraft?.layerId === activeLayer.id
      ? rawDevelopDraft.settings
      : activeLayer.raw.settings
    : null;
  const setRawDevelop = (settings: RawDevelopSettings | null) => {
    setRawDevelopDraft(settings && activeLayer ? { layerId: activeLayer.id, settings } : null);
  };

  useEffect(() => {
    const scope = resolvedFocusState.scope;
    studio?.setFocusPreview(scope ? {
      layerId: scope.layerId,
      target: scope.target,
      context: resolvedFocusState.context,
    } : null);
  }, [studio, resolvedFocusState.scope, resolvedFocusState.context]);

  const animateCanvasView = useCallback((destination: typeof view) => {
    if (viewAnimationRef.current !== null) cancelAnimationFrame(viewAnimationRef.current);
    const source = { ...view };
    const started = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - started) / 190);
      const eased = 1 - Math.pow(1 - progress, 3);
      setView({
        zoom: source.zoom + (destination.zoom - source.zoom) * eased,
        panX: source.panX + (destination.panX - source.panX) * eased,
        panY: source.panY + (destination.panY - source.panY) * eased,
      });
      viewAnimationRef.current = progress < 1 ? requestAnimationFrame(tick) : null;
    };
    viewAnimationRef.current = requestAnimationFrame(tick);
  }, [view]);

  useEffect(() => () => {
    if (viewAnimationRef.current !== null) cancelAnimationFrame(viewAnimationRef.current);
  }, []);

  const enterFocusMode = (layerId: string, target: FocusEditTarget = "pixels") => {
    if (!doc || !activeDocumentId) return;
    const layer = doc.layers.find((candidate) => candidate.id === layerId);
    if (!layer) return;
    const stage = stageRef.current?.getBoundingClientRect();
    const next = enterLayerFocus(resolvedFocusState, doc, activeDocumentId, layerId, view, target);
    setFocusState(next);
    setActiveLayerId(layerId);
    setAssetsOpen(true);
    if (target === "mask" && layer.mask) {
      setWorkspace("mask");
      setActiveTool("mask-add");
    }
    if (stage) animateCanvasView(fitViewToLayer(doc, layerId, stage.width, stage.height));
  };

  const exitFocusMode = () => {
    if (!resolvedFocusState.scope) return;
    const destination = resolvedFocusState.projectView;
    setFocusState(leaveLayerFocus(resolvedFocusState));
    studio?.setFocusPreview(null);
    if (destination) animateCanvasView(destination);
  };

  const setFocusContext = (context: FocusContextMode) => {
    if (!resolvedFocusState.scope || !focusedLayer) return;
    if (!supportsIsolatedFocus(focusedLayer) && context !== "full") {
      return;
    }
    setFocusState({ ...resolvedFocusState, context });
  };

  useEffect(() => () => {
    if (captureSource?.previewUrl) URL.revokeObjectURL(captureSource.previewUrl);
  }, [captureSource?.previewUrl]);

  useEffect(() => {
    if (!studio || !doc || !canvasRef.current || !stageRef.current) return;
    const updatePlan = () => {
      const canvasRect = canvasRef.current!.getBoundingClientRect();
      if (canvasRect.width <= 0 || canvasRect.height <= 0) return;
      const next = calculateDisplayViewport(
        doc.width,
        doc.height,
        canvasRect.width,
        canvasRect.height,
        view,
        window.devicePixelRatio,
      );
      setDisplayViewport(next);
      studio.setVirtualViewport(next);
    };
    updatePlan();
    const observer = new ResizeObserver(updatePlan);
    observer.observe(stageRef.current);
    return () => observer.disconnect();
  }, [studio, doc, view]);

  const eventToDoc = useCallback((e: {
    clientX: number;
    clientY: number;
    pressure?: number;
    tiltX?: number;
    tiltY?: number;
    azimuthAngle?: number;
  }) => {
    const canvas = canvasRef.current;
    if (!canvas || !doc) return { x: 0, y: 0, p: 0.5 };
    const rect = canvas.getBoundingClientRect();
    const viewport = displayViewport ?? calculateDisplayViewport(
      doc.width,
      doc.height,
      rect.width,
      rect.height,
      view,
      window.devicePixelRatio,
    );
    const point = viewportPointToDocument(
      viewport,
      rect.width,
      rect.height,
      e.clientX - rect.left,
      e.clientY - rect.top,
    );
    const x = point.x;
    const y = point.y;
    const p = e.pressure !== undefined && e.pressure > 0 && e.pressure !== 0.5 ? e.pressure : 0.5;
    const tiltX = e.tiltX ?? 0;
    const tiltY = e.tiltY ?? 0;
    const azimuth = Number.isFinite(e.azimuthAngle)
      ? e.azimuthAngle
      : (tiltX || tiltY ? Math.atan2(tiltY, tiltX) : 0);
    return { x, y, p, tiltX, tiltY, azimuth };
  }, [doc, displayViewport, view]);

  const currentBrushMode = (): BrushParams["mode"] => {
    if (activeTool === "erase") return "erase";
    if (activeTool === "mask-add") return "mask-add";
    if (activeTool === "mask-remove") return "mask-remove";
    return "paint";
  };

  const brushParams = (): BrushParams => ({
    size: brushSize,
    hardness: activeTool === "pencil" ? 1 : hardness,
    opacity: brushOpacity,
    flow: brushFlow,
    spacing: activeTool === "pencil" ? Math.min(0.08, brushSpacing) : brushSpacing,
    roundness: activeTool === "pencil" ? 1 : brushRoundness,
    angle: brushAngle,
    pressureSize,
    pressureOpacity,
    smoothing: activeTool === "pencil" ? 0 : brushSmoothing,
    tiltInfluence: brushTilt,
    scatter: brushScatter,
    texture: activeTool !== "pencil" && brushTexture > 0 ? { strength: brushTexture, scale: 0.35, seed: 917 } : undefined,
    buildUp: brushBuildUp,
    blendMode: brushBlendMode,
    pressureCurve: 1.15,
    minimumPressureSize: 0.08,
    seed: 1731,
    symmetry: brushSymmetry === "none" || !doc ? undefined : {
      centerX: doc.width / 2,
      centerY: doc.height / 2,
      horizontal: brushSymmetry === "horizontal",
      vertical: brushSymmetry === "vertical",
      radialSegments: brushSymmetry === "radial" ? 6 : 1,
    },
    color: brushColor,
    mode: currentBrushMode(),
    imageTip: activeTool === "capture-brush" ? capturedBrushTip ?? undefined : undefined,
  });

  const paintingTool = activeTool === "brush" || activeTool === "capture-brush" || activeTool === "pencil" || activeTool === "erase" || activeTool === "mask-add" || activeTool === "mask-remove";
  const retouchMode: RetouchMode | null = ({
    mixer: "mixer", clone: "clone", heal: "heal", "spot-heal": "spot-heal", patch: "patch", remove: "remove",
    dodge: "dodge", burn: "burn", "blur-brush": "blur", "sharpen-brush": "sharpen", smudge: "smudge",
    sponge: "sponge", liquify: "liquify",
  } as Partial<Record<Tool, RetouchMode>>)[activeTool] ?? null;
  const retouchTool = retouchMode !== null;
  const marqueeTool = activeTool === "sel-rect" || activeTool === "sel-ellipse";
  const lassoTool = activeTool === "sel-lasso";
  const wandTool = activeTool === "sel-wand" || activeTool === "sel-quick";
  const pointSelectionTool = activeTool === "sel-polygon" || activeTool === "sel-magnetic";
  const vectorDragTool = ["rect", "ellipse", "triangle", "polygon", "line", "custom-shape", "frame", "paragraph-text"].includes(activeTool);
  const transformDragTool = ["gradient", "crop", "straighten", "content-move", "puppet-warp", "ruler"].includes(activeTool);
  const quadTool = activeTool === "perspective-crop" || activeTool === "perspective-warp";
  const moveTool = activeTool === "move" || activeTool === "path-select";

  const snapLayerTranslation = (layer: Layer, tx: number, ty: number) => (
    doc && snapGuides ? snapTranslation(layer, doc, view.zoom, tx, ty) : { tx, ty }
  );

  const activateCapturedBrush = (asset: CapturedBrushAsset, mode: ImageBrushMode = capturedBrushMode) => {
    if (!studio) return;
    const tip = studio.capturedBrushTip(asset.id, mode);
    if (!tip) return;
    setActiveCapturedBrushId(asset.id);
    setBrushSize(Math.min(1200, Math.max(1, Math.round(asset.sourceDiameter))));
    setCaptureSampling(false);
    setCaptureHover(null);
  };

  const onCaptureUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const previewUrl = URL.createObjectURL(file);
    try {
      const image = await loadImage(previewUrl);
      const scale = Math.min(1, 4096 / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      canvas.getContext("2d")!.drawImage(image, 0, 0, canvas.width, canvas.height);
      const radius = Math.max(2, Math.min(128, Math.floor(Math.min(canvas.width, canvas.height) / 2)));
      setCaptureSource({
        name: file.name.replace(/\.[^.]+$/, "") || "Image capture",
        canvas,
        previewUrl,
        centerX: canvas.width / 2,
        centerY: canvas.height / 2,
        radius,
      });
      setCaptureSampling(false);
    } catch {
      URL.revokeObjectURL(previewUrl);
      notify("That image could not be opened");
    }
  };

  const createUploadedCapture = () => {
    if (!studio || !captureSource) return;
    const asset = studio.addCapturedBrush(
      captureSource.name,
      captureSource.canvas,
      captureSource.centerX,
      captureSource.centerY,
      captureSource.radius,
    );
    if (!asset) { notify("Choose a valid sample area"); return; }
    activateCapturedBrush(asset);
    setCaptureSource(null);
    notify(`Created ${asset.name}`);
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

    if (activeTool === "capture-brush" && captureSampling) {
      const asset = studio.captureBrushFromDocument(p.x, p.y, captureRadius, {
        name: captureSampleMerged ? "Merged canvas capture" : `${activeLayer?.name ?? "Layer"} capture`,
        sourceLayerId: captureSampleMerged ? undefined : activeLayer?.id,
      });
      if (!asset) { notify("Choose a paintable layer or sample the merged canvas"); return; }
      activateCapturedBrush(asset);
      notify(`Captured ${Math.round(asset.sourceDiameter)}px brush · paint to use it`);
      return;
    }

    if (activeTool === "capture-brush" && !capturedBrushTip) {
      setCaptureSampling(true);
      setCaptureHover(p);
      notify("Click the canvas again to capture a brush tip");
      return;
    }

    if (retouchTool) {
      if (!activeLayer || activeLayer.kind !== "raster" || !activeLayer.surface) {
        notify("Retouching needs a raster precision layer");
        return;
      }
      const sourceTool = retouchMode === "clone" || retouchMode === "heal" || retouchMode === "patch";
      if (sourceTool && e.altKey) {
        setRetouchSample({ x: p.x, y: p.y });
        notify(`${retouchMode === "clone" ? "Clone" : retouchMode === "patch" ? "Patch" : "Healing"} source sampled`);
        return;
      }
      if (sourceTool && !retouchSample) {
        notify("Alt-click to choose a source");
        return;
      }
      retouchActive.current = studio.beginRetouchStroke(
        activeLayer.id,
        retouchMode!,
        retouchSample,
        p,
        { ...brushParams(), mode: "paint" },
      );
      return;
    }

    if (paintingTool) {
      if (!activeLayer) { notify("Select a layer"); return; }
      const params = brushParams();
      if ((params.mode === "mask-add" || params.mode === "mask-remove") && activeLayer.locked) {
        notify("Unlock the layer before editing its mask"); return;
      }
      if ((params.mode === "paint" || params.mode === "erase") && activeLayer.kind !== "raster") {
        notify("Brush needs a raster layer"); return;
      }
      studio.beginStroke(activeLayer.id, params, p);
      return;
    }

    if (activeTool === "pattern" || activeTool === "fill") {
      if (!activeLayer || activeLayer.kind !== "raster") { notify("Fill needs a raster layer"); return; }
      const changed = activeTool === "pattern"
        ? studio.patternFill(activeLayer.id, patternKind, brushColor, secondaryColor, patternScale)
        : !activeLayer.locked;
      if (activeTool === "fill" && changed) studio.fillLayer(activeLayer.id, brushColor);
      notify(changed ? (activeTool === "pattern" ? "Pattern applied" : "Selection filled") : "Layer is locked");
      return;
    }
    if (marqueeTool || vectorDragTool || transformDragTool) {
      setDragBoth({ x0: p.x, y0: p.y, x1: p.x, y1: p.y, kind: activeTool as Drag["kind"] });
      return;
    }
    if (lassoTool) {
      setDragBoth({ x0: p.x, y0: p.y, x1: p.x, y1: p.y, kind: "sel-lasso", path: [{ x: p.x, y: p.y }] });
      return;
    }
    if (wandTool) {
      if (!activeLayer || activeLayer.kind !== "raster") { notify("Wand needs a raster layer"); return; }
      studio.selectByColor(activeLayer.id, p.x, p.y, activeTool === "sel-quick" ? Math.max(6, wandTolerance / 2) : wandTolerance, resolvedSelectionMode(e), activeTool === "sel-quick" ? true : !e.metaKey);
      notify(activeTool === "sel-quick" ? "Quick selection painted" : "Selection updated");
      return;
    }
    if (pointSelectionTool) {
      if (!activeLayer || activeLayer.kind !== "raster" || !activeLayer.bitmap) { notify("Lasso needs a raster layer"); return; }
      let nextPoint: Point = p;
      if (activeTool === "sel-magnetic") {
        const image = activeLayer.bitmap.getContext("2d")!.getImageData(0, 0, activeLayer.bitmap.width, activeLayer.bitmap.height);
        nextPoint = snapPointToEdge({ width: image.width, height: image.height, data: image.data }, p, Math.max(6, brushSize / 4));
      }
      if (pointDraft.length >= 2 && Math.hypot(nextPoint.x - pointDraft[0].x, nextPoint.y - pointDraft[0].y) < Math.max(8, (doc?.width ?? 1000) * 0.008)) {
        studio.selectLasso(pointDraft, resolvedSelectionMode(e), feather);
        setPointDraft([]);
        notify("Polygon selection committed");
      } else setPointDraft((points) => [...points, nextPoint]);
      return;
    }
    if (quadTool) {
      if (activeTool === "perspective-warp" && (!activeLayer || activeLayer.kind !== "raster")) { notify("Perspective warp needs a raster layer"); return; }
      const next = [...pointDraft, p];
      if (next.length === 4) {
        if (activeTool === "perspective-crop") studio.perspectiveCrop(next as unknown as Quad);
        else studio.perspectiveWarpLayer(activeLayer!.id, next as unknown as Quad);
        setPointDraft([]);
        notify(activeTool === "perspective-crop" ? "Perspective crop applied" : "Perspective warp applied");
      } else {
        setPointDraft(next);
        notify(`Corner ${next.length}/4 placed`);
      }
      return;
    }
    if (activeTool === "sel-sam") {
      if (!activeLayer || activeLayer.kind !== "raster") { notify("SAM needs a raster layer"); return; }
      const mode = resolvedSelectionMode(e);
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
    if (["text", "vertical-text", "path-text", "type-mask"].includes(activeTool)) {
      if (activeTool === "type-mask") studio.selectTextMask(textDraft, p.x, p.y, `700 ${textSize}px 'Inter', system-ui, sans-serif`, false);
      else if (activeTool === "path-text") {
        if (!activeLayer?.path) { notify("Select a path layer first"); return; }
        const local = documentPointToLayer(activeLayer.transform, p.x, p.y);
        if (!local) return;
        studio.addTextLayer(
          textDraft,
          { x: local.x, y: local.y, layout: "path", path: activeLayer.path, color: brushColor, font: `700 ${textSize}px 'Inter', system-ui, sans-serif` },
          activeLayer.transform,
        );
      } else studio.addTextLayer(textDraft, { x: p.x, y: p.y, layout: activeTool === "vertical-text" ? "vertical" : "point", color: brushColor, font: `700 ${textSize}px 'Inter', system-ui, sans-serif` });
      notify(activeTool === "type-mask" ? "Type selection created" : "Text added");
      return;
    }
    if (activeTool === "eyedropper" || activeTool === "color-sampler") {
      if (!activeLayer || activeLayer.kind !== "raster") { notify("Choose a raster layer"); return; }
      const color = studio.sampleLayerColor(activeLayer.id, p.x, p.y);
      if (!color) return;
      if (activeTool === "eyedropper") { setBrushColor(color); notify(`Foreground ${color}`); }
      else { setColorSamples((samples) => [...samples.slice(-7), { x: p.x, y: p.y, color }]); notify(`Sampled ${color}`); }
      return;
    }
    if (activeTool === "direct-select") {
      if (!activeLayer?.path) { notify("Select a path layer"); return; }
      const local = documentPointToLayer(activeLayer.transform, p.x, p.y);
      if (!local) return;
      let index = 0;
      let distance = Infinity;
      activeLayer.path.anchors.forEach((anchor, candidate) => {
        const d = Math.hypot(anchor.x - local.x, anchor.y - local.y);
        if (d < distance) { distance = d; index = candidate; }
      });
      const original = structuredClone(activeLayer.path);
      directAnchorRef.current = { layerId: activeLayer.id, index, original, next: structuredClone(original) };
      return;
    }
    if (moveTool && doc) {
      const hit = hitTestEditableLayer(doc, p.x, p.y, resolvedFocusState.scope?.layerId);
      const interactionLayer = hit ?? activeLayer;
      if (!interactionLayer) return;
      if (hit && hit.id !== activeLayerId) setActiveLayerId(hit.id);
      setDragBoth({
        x0: p.x,
        y0: p.y,
        x1: p.x,
        y1: p.y,
        kind: "move-layer",
        moveStart: { tx: interactionLayer.transform.tx, ty: interactionLayer.transform.ty },
      });
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
    if (activeTool === "capture-brush" && captureSampling) {
      setCaptureHover(eventToDoc(e));
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
    if (activeTool === "direct-select" && directAnchorRef.current && e.buttons !== 0) {
      const p = eventToDoc(e);
      const edit = directAnchorRef.current;
      const pathLayer = studio.doc.layers.find((layer) => layer.id === edit.layerId);
      if (!pathLayer) return;
      const local = documentPointToLayer(pathLayer.transform, p.x, p.y);
      if (!local) return;
      const next = structuredClone(edit.next);
      next.anchors[edit.index] = { ...next.anchors[edit.index], x: local.x, y: local.y };
      edit.next = next;
      studio.liveUpdatePath(edit.layerId, next);
      return;
    }
    if (activeTool === "sel-quick" && e.buttons !== 0 && activeLayer?.kind === "raster") {
      const p = eventToDoc(e);
      studio.selectByColor(activeLayer.id, p.x, p.y, Math.max(6, wandTolerance / 2), "add", true);
      return;
    }
    const d = dragRef.current;
    if (paintingTool && e.buttons !== 0 && activeLayer) {
      // Coalesced events for smoother strokes on high-frequency devices.
      type WithCoalesced = { getCoalescedEvents?: () => Array<{
        clientX: number;
        clientY: number;
        pressure?: number;
        tiltX?: number;
        tiltY?: number;
        azimuthAngle?: number;
      }> };
      const src = e.nativeEvent as WithCoalesced;
      const events = src.getCoalescedEvents ? src.getCoalescedEvents() : [];
      const points = events.length ? events : [e.nativeEvent];
      for (const ev of points) studio.paintTo(activeLayer.id, brushParams(), eventToDoc(ev));
      return;
    }
    if (retouchTool && retouchActive.current && e.buttons !== 0 && activeLayer) {
      type WithCoalesced = { getCoalescedEvents?: () => Array<{
        clientX: number; clientY: number; pressure?: number; tiltX?: number; tiltY?: number; azimuthAngle?: number;
      }> };
      const src = e.nativeEvent as WithCoalesced;
      const events = src.getCoalescedEvents ? src.getCoalescedEvents() : [];
      for (const event of events.length ? events : [e.nativeEvent]) studio.retouchTo(activeLayer.id, eventToDoc(event));
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
    if (d.kind === "ruler") setMeasurement({ start: { x: d.x0, y: d.y0 }, end: { x: p.x, y: p.y } });
    setDragBoth(next);
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!studio) return;
    if (panDragRef.current) { panDragRef.current = null; return; }
    if (activeTool === "pen" && penDragging) {
      setPenDragging(null);
      return;
    }
    if (activeTool === "direct-select" && directAnchorRef.current) {
      const edit = directAnchorRef.current;
      studio.liveUpdatePath(edit.layerId, edit.original);
      studio.updatePath(edit.layerId, edit.next);
      directAnchorRef.current = null;
      notify("Anchor moved");
      return;
    }
    if (paintingTool && activeLayer) {
      studio.endStroke(activeLayer.id, brushParams());
      return;
    }
    if (retouchTool && retouchActive.current) {
      studio.endRetouchStroke();
      retouchActive.current = false;
      return;
    }
    const d = dragRef.current;
    if (!d) return;
    const x = Math.min(d.x0, d.x1);
    const y = Math.min(d.y0, d.y1);
    const w = Math.abs(d.x1 - d.x0);
    const h = Math.abs(d.y1 - d.y0);
    const mode = resolvedSelectionMode(e);
    if (d.kind === "sel-rect" && w > 2 && h > 2) studio.selectRect(x, y, w, h, mode, feather);
    else if (d.kind === "sel-ellipse" && w > 2 && h > 2) studio.selectEllipse(x, y, w, h, mode, feather);
    else if (d.kind === "sel-lasso" && d.path && d.path.length > 4) studio.selectLasso(d.path, mode, feather);
    else if (d.kind === "rect" && w > 2 && h > 2) studio.addShapeLayer({ kind: "rect", x, y, w, h, fill: brushColor, stroke: "#000", strokeWidth: 0, radius: 0 });
    else if (d.kind === "ellipse" && w > 2 && h > 2) studio.addShapeLayer({ kind: "ellipse", x, y, w, h, fill: brushColor, stroke: "#000", strokeWidth: 0, radius: 0 });
    else if (["triangle", "polygon", "line", "custom-shape"].includes(d.kind) && w > 2 && h > 2) {
      void import("./focus-import").then(({ geometricPath }) => studio.addPathLayer(geometricPath(d.kind as "triangle" | "polygon" | "line" | "custom-shape", x, y, w, h, brushColor)));
    }
    else if (d.kind === "frame" && w > 2 && h > 2) studio.addFrame(x, y, w, h, e.shiftKey);
    else if (d.kind === "paragraph-text" && w > 8 && h > 8) studio.addTextLayer(textDraft, { x, y, layout: "paragraph", boxWidth: w, boxHeight: h, color: brushColor, font: `700 ${textSize}px 'Inter', system-ui, sans-serif` });
    else if (d.kind === "gradient" && activeLayer?.kind === "raster") studio.gradientFill(activeLayer.id, { x: d.x0, y: d.y0 }, { x: d.x1, y: d.y1 }, brushColor, secondaryColor, gradientType);
    else if (d.kind === "crop" && w > 2 && h > 2) studio.cropRect(x, y, w, h);
    else if (d.kind === "straighten") studio.straightenDocument(-Math.atan2(d.y1 - d.y0, d.x1 - d.x0));
    else if (d.kind === "content-move" && activeLayer?.kind === "raster") studio.moveSelectionContent(activeLayer.id, d.x1 - d.x0, d.y1 - d.y0);
    else if (d.kind === "puppet-warp" && activeLayer?.kind === "raster") studio.radialWarpLayer(activeLayer.id, { x: d.x0, y: d.y0 }, { x: d.x1, y: d.y1 }, warpRadius);
    else if (d.kind === "ruler") setMeasurement({ start: { x: d.x0, y: d.y0 }, end: { x: d.x1, y: d.y1 } });
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

  const commitRawDevelop = (settings: RawDevelopSettings | null) => {
    if (!studio || !activeLayer?.raw || !settings) return;
    if (studio.redevelopRaw(activeLayer.id, settings)) {
      notify("RAW develop updated from sensor data");
    }
  };
  const resetTone = () => {
    if (!studio || !activeAdjustmentId) { setTone({ ...NEUTRAL_TONE }); return; }
    setTone({ ...NEUTRAL_TONE });
    studio.updateTone(activeAdjustmentId, { ...NEUTRAL_TONE });
    notify("Tone reset");
  };

  const switchWorkspace = (next: WorkspaceMode) => {
    setPointDraft([]);
    directAnchorRef.current = null;
    setWorkspace(next);
    setInspectorTab("properties");
    const firstVisible = modeTools[next].find(([tool]) => !workflowPreferences.hiddenTools.includes(tool));
    setActiveTool(firstVisible?.[0] ?? modeTools[next][0][0]);
  };

  const activateTool = (tool: Tool, nextWorkspace: WorkspaceMode = workspace) => {
    setPointDraft([]);
    directAnchorRef.current = null;
    if (resolvedFocusState.scope?.target === "mask" && tool !== "mask-add" && tool !== "mask-remove") {
      setFocusState({
        ...resolvedFocusState,
        scope: { ...resolvedFocusState.scope, target: "pixels" },
      });
    }
    if (nextWorkspace !== workspace) setWorkspace(nextWorkspace);
    setActiveTool(tool);
    setInspectorTab("properties");
    if (tool === "capture-brush" && !capturedBrushTip) setCaptureSampling(true);
  };

  const importDocumentFile = async (file: File) => {
    if (!file || !studio) return;
    if (/\.luma$/i.test(file.name)) {
      const project = await studio.importProject(file);
      setActiveLayerId(project.doc.layers[0]?.id ?? null);
      setActiveAdjustmentId(null);
      setCustomName(project.name || file.name.replace(/\.luma$/i, ""));
      await writeRecoveryWorkspace(await studio.exportRecoveryWorkspace());
      setSaveState("saved");
      const restoredOperations = project.history?.summary().operations ?? 0;
      notify(`${project.name} opened · ${restoredOperations} versions restored`);
      return;
    }
    if (/\.ps[db]$/i.test(file.name)) {
      const d = await studio.importPsd(await file.arrayBuffer());
      setPhotoshopFormat("source");
      setActiveLayerId(d.layers[0]?.id ?? null);
      setActiveAdjustmentId(null);
      setCustomName(file.name.replace(/\.ps[db]$/i, ""));
      setTone({ ...NEUTRAL_TONE });
      const report = studio.photoshopCompatibility({ format: "source" });
      const previewOnly = report.issues.filter((issue) => issue.severity === "warning").length;
      notify(`${file.name} · ${d.layers.length} layers · ${report.container.toUpperCase()}${previewOnly ? ` · ${previewOnly} review note${previewOnly === 1 ? "" : "s"}` : " · preservation ready"}`);
      return;
    }
    let url = URL.createObjectURL(file);
    const name = file.name.replace(/\.[^/.]+$/, "") || "Imported";
    try {
      const raw = rawExtension(file.name);
      let source: Parameters<Studio["openImage"]>[2];
      let profileLabel = "";
      if (raw) {
        const bytes = await file.arrayBuffer();
        const ingested = ingestRaw(bytes, file.name, {
          workingSpace: studio.doc.colorSpace,
        });
        if (ingested.kind === "developed-dng") {
          const layer = studio.openDevelopedDng(name, bytes, ingested.developed);
          setActiveLayerId(layer.id);
          setCustomName(name);
          setActiveAdjustmentId(null);
          setTone({ ...NEUTRAL_TONE });
          notify(`DNG developed · ${ingested.developed.metadata.bitsPerSample}-bit Bayer · 32-bit float master`);
          return;
        }
        URL.revokeObjectURL(url);
        url = URL.createObjectURL(ingested.preview.blob);
        source = {
          originalName: file.name,
          format: ingested.preview.format,
          mode: "embedded-raw-preview",
          originalBytes: file.size,
        };
      } else {
        source = { originalName: file.name, format: file.type || "image", mode: "decoded", originalBytes: file.size };
        const embedded = await extractAndParseEmbeddedColorProfile(await file.arrayBuffer());
        if (embedded.profile) {
          defaultColorProfileRegistry.register(embedded.profile, { replace: true });
          source.colorProfile = {
            id: embedded.profile.id,
            name: embedded.profile.name,
            version: embedded.profile.version,
            colorSpace: embedded.profile.colorSpace,
            model: embedded.profile.capabilities.model,
            canTransform: embedded.profile.capabilities.canTransform,
            browserDecoded: true,
            warnings: [...embedded.profile.warnings],
          };
          profileLabel = ` · ${embedded.profile.name}${embedded.profile.capabilities.canTransform ? "" : " · metadata only"}`;
        }
      }
      const img = await loadImage(url);
      const layer = studio.openImage(name, img, source);
      setActiveLayerId(layer.id);
      setCustomName(name);
      setActiveAdjustmentId(null);
      setTone({ ...NEUTRAL_TONE });
      notify(
        raw
          // Only DNG gets a sensor decode; everything else is the camera's own
          // embedded JPEG, so say so plainly rather than implying RAW develop.
          ? `${raw.toUpperCase()}: embedded JPEG preview — sensor decode is DNG-only`
          : `${name} imported${profileLabel}`,
      );
    } catch (error) {
      notify(error instanceof Error ? error.message : "Failed to import");
    } finally {
      URL.revokeObjectURL(url);
    }
  };

  const onFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    try {
      if (file) await importDocumentFile(file);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Failed to import");
    } finally {
      e.target.value = "";
    }
  };

  const importOpenedFile = async (opened: { name: string; data: Uint8Array }) => {
    const bytes = opened.data.buffer.slice(
      opened.data.byteOffset,
      opened.data.byteOffset + opened.data.byteLength,
    ) as ArrayBuffer;
    const { mimeForFileName } = await import("./focus-import");
    await importDocumentFile(new File([bytes], opened.name, { type: mimeForFileName(opened.name) }));
  };

  const openNativeDocument = async () => {
    try {
      const opened = await openNativeFile();
      if (!opened) return;
      await importOpenedFile(opened);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Native open failed");
    }
  };

  /**
   * Open a document the OS handed us: a double-clicked file, one from the
   * command line, or an Open Recent pick. Only a successful open joins the
   * recent list — a path that failed to parse must not persist as a suggestion.
   */
  const safeLocalStorage = () => {
    try {
      return typeof window === "undefined" ? null : window.localStorage;
    } catch {
      // Storage can be disabled outright; recents are a convenience, not a
      // reason to fail an open.
      return null;
    }
  };

  const openDocumentPath = async (path: string) => {
    try {
      const opened = await readNativePath(path);
      if (!opened) return;
      await importOpenedFile(opened);
      const next = withRecentFile(recentFilesRef.current, path);
      recentFilesRef.current = next;
      saveRecentFiles(safeLocalStorage(), next);
      publishRecentFiles(next);
    } catch (error) {
      notify(error instanceof Error ? error.message : `${path} could not be opened`);
    }
  };

  const requestDocumentOpen = () => {
    if (isNativeFilesystemAvailable()) void openNativeDocument();
    else fileInput.current?.click();
  };

  const importLayerFile = async (file: File) => {
    if (!studio) return;
    try {
      const { addImageFileAsLayer } = await import("./focus-import");
      const { layer, name } = await addImageFileAsLayer(studio, file);
      setActiveLayerId(layer.id);
      setAssetsOpen(true);
      notify(`${name} added as a layer`);
    } catch (error) {
      notify(error instanceof Error ? error.message : `${file.name} could not be added`);
    }
  };

  const importLayerFiles = async (files: File[]) => {
    for (const file of files) await importLayerFile(file);
  };

  /**
   * Files can arrive by drop anywhere in the studio, so route them the same way
   * the open dialog does: project/document formats replace the document, plain
   * images become fitted layers on the current canvas.
   */
  const DOCUMENT_DROP_PATTERN = new RegExp(
    `\\.(luma|psd|psb|${RAW_EXTENSIONS.join("|")})$`,
    "i",
  );

  const importDroppedFiles = async (files: File[]) => {
    if (!files.length) return;
    const documents = files.filter((file) => DOCUMENT_DROP_PATTERN.test(file.name));
    const images = files.filter((file) => !DOCUMENT_DROP_PATTERN.test(file.name));
    // Only one document can be open at a time; the rest would clobber it.
    if (documents.length) {
      if (documents.length > 1) notify(`Opening ${documents[0].name}; drop one project at a time`);
      try {
        await importDocumentFile(documents[0]);
      } catch (error) {
        notify(error instanceof Error ? error.message : `${documents[0].name} could not be opened`);
      }
    }
    if (images.length) await importLayerFiles(images);
  };

  const onFocusImportChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.target.files ?? [])];
    event.target.value = "";
    await importLayerFiles(files);
  };

  const pasteImageAsLayer = async () => {
    try {
      const { clipboardImageFile } = await import("./focus-import");
      const file = await clipboardImageFile();
      if (file) await importLayerFile(file);
      else notify("The clipboard does not contain an image");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Clipboard access was not granted");
    }
  };

  const onPsdImport = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    try {
      if (file) await importDocumentFile(file);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Photoshop import failed");
    } finally {
      e.target.value = "";
    }
  };

  // Drag-and-drop import, window-wide. Previously only the assets filmstrip
  // accepted drops, so dropping onto the canvas — the obvious target — did
  // nothing but navigate the browser away from the app.
  useEffect(() => {
    if (!studio) return;
    // dragenter/dragleave fire for every child element, so track depth rather
    // than toggling on each event or the overlay flickers while moving.
    let depth = 0;
    const hasFiles = (event: DragEvent) =>
      Array.from(event.dataTransfer?.types ?? []).includes("Files");

    const onDragEnter = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      depth += 1;
      setDropActive(true);
    };
    const onDragOver = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      // Without preventDefault the browser opens the file and discards the app.
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    };
    const onDragLeave = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDropActive(false);
    };
    const onDrop = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      depth = 0;
      setDropActive(false);
      const files = Array.from(event.dataTransfer?.files ?? []);
      if (files.length) void importDroppedFiles(files);
    };

    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studio]);

  const projectName = customName || filmstrip[activePreset].name || "Untitled";

  const downloadOrSave = async (blob: Blob, fileName: string) => {
    if (isNativeFilesystemAvailable()) return saveNativeFile(blob, fileName);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    return true;
  };

  const saveProject = async () => {
    if (!studio) return;
    setSaveState("saving");
    try {
      const blob = await studio.exportProject(projectName);
      const saved = await downloadOrSave(blob, `${projectName.replace(/[^a-z0-9_-]+/gi, "-")}.luma`);
      if (!saved) { setSaveState("unsaved"); return; }
      await writeRecoveryWorkspace(await studio.exportRecoveryWorkspace());
      setSaveState("saved");
      notify("Project + version history saved");
    } catch {
      setSaveState("error");
      notify("Project save failed");
    }
  };

  const onProjectImport = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    try {
      if (file) await importDocumentFile(file);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Luma project could not be opened");
    } finally {
      e.target.value = "";
    }
  };

  useEffect(() => {
    if (!studio) return;
    let timer = 0;
    let active = true;
    const queue = new CoalescedSaveQueue<Awaited<ReturnType<Studio["exportRecoveryWorkspace"]>>>({
      produce: () => studio.exportRecoveryWorkspace(),
      commit: (workspace) => writeRecoveryWorkspace(workspace),
      onState: (state) => {
        if (!active) return;
        if (state === "producing" || state === "committing") setSaveState("saving");
        else if (state === "idle") setSaveState("saved");
        else if (state === "error") setSaveState("error");
      },
    });
    const flush = () => {
      window.clearTimeout(timer);
      timer = 0;
      queue.request();
    };
    const unsubscribe = studio.subscribe(() => {
      window.clearTimeout(timer);
      setSaveState("unsaved");
      timer = window.setTimeout(flush, 1600);
    });
    const onVisibility = () => { if (document.visibilityState === "hidden") flush(); };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      unsubscribe();
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibility);
      if (timer) flush();
      active = false;
      void queue.waitForIdle();
    };
  }, [studio, projectName]);

  const setLayerVisible = (id: string, v: boolean) => studio?.setLayerProp(id, "visible", v, v ? "Layer shown" : "Layer hidden");
  const setLayerOpacity = (id: string, o: number) => studio?.setLayerProp(id, "opacity", o, "Opacity");
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

  const toggleFocusPin = (layerId: string) => {
    setPinnedLayerIds((current) => current.includes(layerId)
      ? current.filter((id) => id !== layerId)
      : [...current, layerId]);
  };

  const reorderFocusItems = (sourceId: string, targetId: string) => {
    setPinnedLayerIds((current) => {
      const ordered = current.includes(sourceId) ? [...current] : [...current, sourceId];
      if (!ordered.includes(targetId)) ordered.push(targetId);
      const sourceIndex = ordered.indexOf(sourceId);
      const targetIndex = ordered.indexOf(targetId);
      ordered.splice(sourceIndex, 1);
      ordered.splice(targetIndex, 0, sourceId);
      return ordered;
    });
  };

  const handleFocusCreate = (action: FocusCreateAction) => {
    if (!studio) return;
    if (action === "new") { addBlank(); return; }
    if (action === "import") { focusImportInput.current?.click(); return; }
    if (action === "adjustment") { addAdjust(); return; }
    if (action === "text") {
      const layer = studio.addTextLayer("Text", { x: studio.doc.width * 0.25, y: studio.doc.height * 0.5, color: brushColor });
      setActiveLayerId(layer.id);
      return;
    }
    if (action === "shape") {
      const layer = studio.addShapeLayer({ kind: "rect", fill: brushColor });
      setActiveLayerId(layer.id);
      return;
    }
    if (action === "group") {
      if (!activeLayerId) { notify("Select a layer to group"); return; }
      const group = studio.groupLayer(activeLayerId);
      if (group) setActiveLayerId(group.id);
      else notify("Select a content layer to group");
      return;
    }
    if (action === "generate") { focusInspector("ai"); return; }
    if (action === "paste") void pasteImageAsLayer();
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

  const currentAiControls = (): AiOperationControls => {
    switch (aiOperation) {
      case "remove": return { operation: "remove", removeShadows: true, backgroundContinuity: aiStrength };
      case "relight": return { operation: "relight", direction: "auto", temperature: aiTemperature, intensity: aiStrength, preserveIdentity: aiPreserve };
      case "harmonize": return { operation: "harmonize", color: aiStrength, lighting: aiStrength, perspective: 0.6, preserveComposition: aiPreserve };
      case "upscale": return { operation: "upscale", detail: aiStrength, denoise: 0.25, sharpening: 0.35, preserveGeometry: aiPreserve };
      case "expand": return { operation: "expand", continuity: aiStrength, preserveComposition: aiPreserve, edgeContext: "natural" };
      default: return { operation: "fill", edgeBlend: "seamless", preserveStructure: aiPreserve };
    }
  };

  const runGenerativeEdit = async () => {
    if (!studio || !activeLayer || activeLayer.kind === "group") { notify("Select a content layer"); return; }
    if (!aiPrompt.trim() || aiRunning) return;
    const controller = new AbortController();
    aiAbort.current = controller;
    setAiRunning(true);
    setNeural({ msg: `GPT Image 2 · ${aiOperation} · starting`, pct: 8 });
    try {
      const layers = await studio.generativeEditVariations(activeLayer.id, aiPrompt.trim(), aiOperation, {
        endpoint: resolveAiEditEndpoint(desktop),
        controls: currentAiControls(),
        quality: aiQuality,
        variations: aiVariations,
        signal: controller.signal,
        onVariation: (completed, total) => setNeural({
          msg: `GPT Image 2 · variation ${completed}/${total}`,
          pct: 10 + completed / total * 88,
        }),
      });
      setActiveLayerId(layers[0].id);
      setNeural(null);
      notify(`AI ${aiOperation} added ${layers.length} variation${layers.length === 1 ? "" : "s"} as layers`);
    } catch (error) {
      setNeural(null);
      if (desktop && error instanceof AiEditAuthenticationError) {
        try {
          await openNativeAiSignIn();
          notify("Sign in with ChatGPT in the new window, then run the edit again");
        } catch {
          notify("Could not open ChatGPT sign-in. Check your connection and try again");
        }
      } else {
        notify(error instanceof Error ? error.message : "Generative edit failed");
      }
    } finally {
      aiAbort.current = null;
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
      const saved = await downloadOrSave(blob, `${customName || filmstrip[activePreset].name}-luma.${exportFormat === "jpeg" ? "jpg" : exportFormat}`);
      if (saved) notify(`Exported ${exportFormat.toUpperCase()}`);
    } catch { notify("Export failed"); }
  };

  const runBatchNow = async () => {
    if (!studio || !batchFiles.length) return;
    const { runBatch } = await import("@/app/engine/batch");
    const action = selectedActionIdx != null ? studio.actions.get(selectedActionIdx) : null;
    setBatchProgress({ i: 0, total: batchFiles.length, name: "" });
    try {
      const result = await runBatch(batchFiles, action ?? null, (i, total, name) => {
        setBatchProgress({ i, total, name });
      });
      const saved = await downloadOrSave(result.archive, `luma-batch-${Date.now()}.zip`);
      if (saved) notify(result.failed.length
        ? `Batch complete · ${result.succeeded} exported · ${result.failed.length} failed (see report)`
        : `Batch complete · ${result.succeeded} images`);
    } catch (err) {
      console.warn(err);
      notify("Batch failed");
    } finally {
      setBatchProgress(null);
    }
  };

  const exportPsd = async () => {
    if (!studio) return;
    try {
      const { buffer: buf, report } = studio.exportPhotoshop({ format: photoshopFormat });
      const blob = new Blob([buf], { type: "image/vnd.adobe.photoshop" });
      const saved = await downloadOrSave(blob, `${customName || filmstrip[activePreset].name}-luma.${report.container}`);
      if (!saved) return;
      const warnings = report.issues.filter((issue) => issue.severity === "warning").length;
      notify(`Exported ${report.container.toUpperCase()}${warnings ? ` · ${warnings} compatibility warning${warnings === 1 ? "" : "s"}` : " · editable fidelity preserved"}`);
    } catch (error) { notify(error instanceof Error ? error.message : "Photoshop export failed"); }
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
    const target = studio.replay(a, activeLayerId);
    if (target) setActiveLayerId(target);
    notify(`Played ${a.name}`);
  };

  const focusInspector = (tab: "layers" | "properties" | "ai") => {
    setInspectorTab(tab);
    requestAnimationFrame(() => {
      const selector = tab === "layers" ? ".layers-card" : tab === "ai" ? ".neural-card" : ".glass-card:not(.layers-card):not(.neural-card)";
      inspectorRef.current?.querySelector(selector)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  /**
   * One implementation behind both the tool palette and the desktop menu bar.
   *
   * The switch is exhaustive over StudioCommand on purpose: adding an entry to
   * app/desktop/menu-model.ts without handling it here is a type error rather
   * than a menu item that quietly does nothing.
   */
  const runStudioCommand = (command: StudioCommand) => {
    switch (command) {
      case "open": requestDocumentOpen(); return;
      case "save": void saveProject(); return;
      case "export": setShowExportMenu(true); return;

      case "undo": studio?.undo(); forceUpdate(); return;
      case "redo": studio?.redo(); forceUpdate(); return;
      case "history": setShowHistory(true); return;

      case "select-all": studio?.selectAll(); return;
      case "deselect": studio?.deselect(); return;
      case "invert-selection": studio?.invertSelectionArea(); return;
      case "select-subject":
        activateTool("sel-sam", "select");
        focusInspector("ai");
        void runNeuralSubject();
        return;

      case "new-layer": addBlank(); return;
      case "group-layer":
        if (studio && activeLayerId) studio.groupLayer(activeLayerId);
        forceUpdate();
        return;
      case "delete-layer": removeActive(); return;
      case "bring-forward":
        if (studio && activeLayerId) studio.reorderLayer(activeLayerId, -1);
        forceUpdate();
        return;
      case "send-backward":
        if (studio && activeLayerId) studio.reorderLayer(activeLayerId, 1);
        forceUpdate();
        return;
      case "layer-style":
        if (activeLayerId) setStyleLayerId(activeLayerId);
        return;
      case "curves":
        if (studio) {
          const layer = studio.addCurvesLayer();
          setActiveLayerId(layer.id);
          focusInspector("properties");
        }
        return;
      case "levels":
        if (studio) {
          const layer = studio.addLevelsLayer();
          setActiveLayerId(layer.id);
          focusInspector("properties");
        }
        return;

      case "zoom-in": setView((v) => ({ ...v, zoom: Math.min(32, v.zoom * 1.2) })); return;
      case "zoom-out": setView((v) => ({ ...v, zoom: Math.max(0.05, v.zoom / 1.2) })); return;
      case "zoom-fit": setView({ zoom: 1, panX: 0, panY: 0 }); return;
      case "zoom-actual": setView((v) => ({ ...v, zoom: 1 })); return;
    }
  };

  // Restore Open Recent and hand it to the native menu, once.
  useEffect(() => {
    if (!desktop) return;
    const stored = loadRecentFiles(safeLocalStorage());
    recentFilesRef.current = stored;
    publishRecentFiles(stored);
  }, [desktop]);

  // A double-clicked document, one from the command line, and an Open Recent
  // pick all arrive on the same event.
  useEffect(() => {
    if (!desktop) return;
    return listenForOpenFile((path) => { void openDocumentPath(path); });
  });

  // The native menu bar lives in the Tauri process, so its clicks arrive as an
  // event rather than a DOM interaction. Web builds never see one.
  useEffect(() => {
    if (!desktop) return;
    return listenForMenuCommands(runStudioCommand);
    // runStudioCommand closes over studio and the active layer, so the
    // listener is re-bound when those change rather than firing on stale ones.
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) studio?.redo(); else studio?.undo();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") { e.preventDefault(); void saveProject(); return; }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "o") { e.preventDefault(); requestDocumentOpen(); return; }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "e") { e.preventDefault(); setShowExportMenu(true); return; }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a") { e.preventDefault(); studio?.selectAll(); return; }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "d") { e.preventDefault(); studio?.deselect(); return; }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "i") { e.preventDefault(); studio?.invertSelectionArea(); return; }
      if (e.key === "Escape" && showWorkspaceSettings) { setShowWorkspaceSettings(false); return; }
      if (e.key === "Escape" && showHistory) { setShowHistory(false); return; }
      if (e.key === "Escape" && showExportMenu) { setShowExportMenu(false); return; }
      if (e.key === "Enter" && activeTool === "pen") { e.preventDefault(); commitPenPath(false); return; }
      if (e.key === "Escape" && activeTool === "pen") { setPenDraft([]); setPenDragging(null); return; }
      if (e.key === "Enter" && pointSelectionTool && pointDraft.length >= 3) {
        e.preventDefault();
        studio?.selectLasso(pointDraft, resolvedSelectionMode(e), feather);
        setPointDraft([]);
        notify("Polygon selection committed");
        return;
      }
      if (e.key === "Escape" && pointDraft.length) { setPointDraft([]); notify("Draft cancelled"); return; }
      if (e.key === "Escape" && resolvedFocusState.scope) { e.preventDefault(); exitFocusMode(); return; }
      if ((e.key === "Enter" || e.key === "Return") && activeLayerId && !resolvedFocusState.scope) {
        e.preventDefault();
        enterFocusMode(activeLayerId);
        return;
      }
      if (e.code === "Space" && !e.repeat) { spaceHeld.current = true; document.body.style.cursor = "grab"; }
      if (e.key === "0" && !e.metaKey && !e.ctrlKey) { setView({ zoom: 1, panX: 0, panY: 0 }); return; }
      if (e.key === "1" && !e.metaKey && !e.ctrlKey) { setView((v) => ({ ...v, zoom: 1 })); return; }
      if ((e.key === "+" || e.key === "=") && !e.metaKey) { setView((v) => ({ ...v, zoom: Math.min(32, v.zoom * 1.2) })); return; }
      if (e.key === "-" && !e.metaKey) { setView((v) => ({ ...v, zoom: Math.max(0.05, v.zoom / 1.2) })); return; }
      if (e.key === "[" || e.key === "]") {
        e.preventDefault();
        const direction = e.key === "]" ? 1 : -1;
        if (activeTool === "capture-brush" && captureSampling) {
          setCaptureRadius((value) => Math.max(2, Math.min(512, Math.round(value * (direction > 0 ? 1.12 : 0.89)))));
        } else {
          setBrushSize((value) => Math.max(1, Math.min(activeTool === "capture-brush" ? 1200 : 400, Math.round(value * (direction > 0 ? 1.12 : 0.89)))));
        }
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        if (activeLayerId && studio) { studio.clearPixels(activeLayerId); return; }
      }
      const t = modeTools[workspace].find(([tool, , , fallback]) => (
        !workflowPreferences.hiddenTools.includes(tool)
        && resolveShortcut(tool, fallback, workflowPreferences).toLowerCase() === e.key.toLowerCase()
      ));
      if (t) {
        setPointDraft([]);
        directAnchorRef.current = null;
        setActiveTool(t[0]);
        if (t[0] === "capture-brush" && !capturedBrushTip) setCaptureSampling(true);
      }
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
    // The open/save closures are fully represented by studio, projectName and notify.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace, studio, projectName, activeLayerId, activeTool, commitPenPath, showHistory, showWorkspaceSettings, showExportMenu, pointDraft, pointSelectionTool, feather, notify, captureSampling, capturedBrushTip, workflowPreferences, resolvedSelectionMode, resolvedFocusState.scope, exitFocusMode, enterFocusMode]);

  const currentTools = modeTools[workspace].filter(([tool]) => !workflowPreferences.hiddenTools.includes(tool));
  const activeToolMeta = Object.values(modeTools).flat().find(([tool]) => tool === activeTool) ?? currentTools[0];
  const activeWorkspaceMeta = workspaces.find(([id]) => id === workspace) ?? workspaces[0];
  const orderedWorkspaces = workflowPreferences.workspaceOrder
    .map((id) => workspaces.find(([workspaceId]) => workspaceId === id))
    .filter((entry): entry is (typeof workspaces)[number] => Boolean(entry));
  const toolPaletteGroups = orderedWorkspaces.map(([id, label, description]) => ({
    id,
    label,
    description,
    tools: modeTools[id]
      .filter(([tool]) => !workflowPreferences.hiddenTools.includes(tool))
      .map(([tool, icon, toolLabel, shortcut]) => ({
        id: tool,
        icon,
        label: toolLabel,
        shortcut: resolveShortcut(tool, shortcut, workflowPreferences),
      })),
  }));
  const historyState = studio?.historyState();
  const engineState = studio?.engineState();
  const photoshopReport = studio?.photoshopCompatibility({ format: photoshopFormat });
  const canvasCursor = useMemo(() => {
    if (paintingTool || retouchTool || marqueeTool || lassoTool || wandTool || vectorDragTool || transformDragTool || pointSelectionTool || quadTool) return "crosshair";
    if (activeTool === "pen" || activeTool === "sel-sam" || activeTool === "eyedropper" || activeTool === "color-sampler" || activeTool === "direct-select") return "crosshair";
    if (moveTool) return "move";
    return "default";
  }, [paintingTool, retouchTool, marqueeTool, lassoTool, wandTool, vectorDragTool, transformDragTool, pointSelectionTool, quadTool, moveTool, activeTool]);

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

  const pointOverlay = useMemo(() => {
    if (!doc || pointDraft.length === 0) return null;
    const closedPreview = pointDraft.length === 4 && quadTool;
    const path = `${pointDraft.map((point, index) => `${index ? "L" : "M"}${point.x} ${point.y}`).join(" ")}${closedPreview ? " Z" : ""}`;
    return (
      <svg viewBox={`0 0 ${doc.width} ${doc.height}`} preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", overflow: "visible", zIndex: 9 }}>
        <path d={path} stroke="#f6a85f" strokeWidth={2} strokeDasharray="6 4" fill={closedPreview ? "rgba(246,168,95,.12)" : "none"} vectorEffect="non-scaling-stroke" />
        {pointDraft.map((point, index) => <circle key={index} cx={point.x} cy={point.y} r={Math.max(4, doc.width * 0.003)} fill="#fff" stroke="#f06d3b" strokeWidth={2} vectorEffect="non-scaling-stroke" />)}
      </svg>
    );
  }, [doc, pointDraft, quadTool]);

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
    const applyCornerDrag = (layer: Layer, corner: TransformCorner, start: Transform, px: number, py: number) => {
      studio!.liveUpdateTransform(layer.id, cornerDragTransform(corner, start, doc.width, doc.height, px, py));
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
      <a className="studio-skip-link" href="#studio-canvas">Skip to canvas</a>
      <div className="spatial-aura aura-blue" />
      <div className="spatial-aura aura-violet" />

      <section className="spatial-window">
        <Suspense fallback={<header className="spatial-topbar studio-titlebar" />}>
          <StudioTitlebar
            desktop={desktop}
            projectName={projectName}
            saveState={saveState}
            zoom={Math.round(view.zoom * 100)}
            canUndo={studio?.canUndo() ?? false}
            canRedo={studio?.canRedo() ?? false}
            exportOpen={showExportMenu}
            filtersOpen={showFilters}
            onBack={() => history.back()}
            onOpen={requestDocumentOpen}
            onUndo={() => studio?.undo()}
            onRedo={() => studio?.redo()}
            onFit={() => setView({ zoom: 1, panX: 0, panY: 0 })}
            onSave={saveProject}
            onFilters={() => setShowFilters((value) => !value)}
            onBatch={() => setShowBatch(true)}
            onHistory={() => setShowHistory(true)}
            onSettings={() => setShowWorkspaceSettings(true)}
            onExport={() => setShowExportMenu((value) => !value)}
          />
        </Suspense>

        <div className="spatial-workspace">
          <Suspense fallback={<aside className="spatial-toolbar" aria-label="Loading tools" />}>
            <ToolDock
              groups={toolPaletteGroups}
              activeWorkspace={workspace}
              activeTool={activeTool}
              onSelect={(tool, nextWorkspace) => activateTool(tool as Tool, nextWorkspace as WorkspaceMode)}
              onAiSelect={() => { activateTool("sel-sam", "select"); focusInspector("ai"); }}
              onCommand={runStudioCommand}
            />
          </Suspense>

          <section className="spatial-canvas-column" data-assets-open={assetsOpen}>
            <Suspense fallback={<div className="studio-contextbar" />}>
              <ContextToolbar
                tool={activeTool}
                label={activeToolMeta?.[2] ?? "Tool"}
                description={activeWorkspaceMeta[2]}
                layerName={activeLayer?.name ?? "No active layer"}
                layerKind={activeLayer?.kind.replaceAll("-", " ") ?? "Open an image to begin"}
                mode={(paintingTool || retouchTool || workspace === "mask") ? "paint" : (marqueeTool || lassoTool || wandTool || pointSelectionTool) ? "selection" : workspace === "vector" && ["text", "paragraph-text", "vertical-text", "path-text", "type-mask"].includes(activeTool) ? "type" : ["crop", "perspective-crop"].includes(activeTool) ? "crop" : "general"}
                selectionMode={selectionMode}
                values={{
                  color: brushColor,
                  size: brushSize,
                  hardness: Math.round(hardness * 100),
                  flow: Math.round(brushFlow * 100),
                  opacity: Math.round(brushOpacity * 100),
                  smoothing: Math.round(brushSmoothing * 100),
                  symmetry: brushSymmetry,
                  feather,
                  smooth: selectionSmooth,
                  contrast: selectionContrast,
                  shiftEdge: selectionShift,
                  tolerance: wandTolerance,
                  textSize,
                }}
                showGuides={showGuides}
                assetsOpen={assetsOpen}
                onValue={(key, value) => {
                  if (key === "color") setBrushColor(String(value));
                  else if (key === "size") setBrushSize(Number(value));
                  else if (key === "hardness") setHardness(Number(value) / 100);
                  else if (key === "flow") setBrushFlow(Number(value) / 100);
                  else if (key === "opacity") setBrushOpacity(Number(value) / 100);
                  else if (key === "smoothing") setBrushSmoothing(Number(value) / 100);
                  else if (key === "symmetry") setBrushSymmetry(value as typeof brushSymmetry);
                  else if (key === "feather") setFeather(Number(value));
                  else if (key === "smooth") setSelectionSmooth(Number(value));
                  else if (key === "contrast") setSelectionContrast(Number(value));
                  else if (key === "shiftEdge") setSelectionShift(Number(value));
                  else if (key === "tolerance") setWandTolerance(Number(value));
                  else if (key === "textSize") {
                    const size = Number(value);
                    setTextSize(size);
                    if (activeLayer?.kind === "text" && activeLayer.text) studio?.updateText(activeLayer.id, { font: activeLayer.text.font.replace(/\d+px/, `${size}px`) });
                  }
                }}
                onSelectionMode={setSelectionMode}
                onFit={() => setView({ zoom: 1, panX: 0, panY: 0 })}
                onToggleGuides={() => setShowGuides((value) => !value)}
                onToggleAssets={() => setAssetsOpen((value) => !value)}
              />
            </Suspense>

            <div className="spatial-document-tabs">
              {openDocuments.map((documentTab) => (
                <div
                  key={documentTab.id}
                  className={documentTab.active ? "active" : ""}
                >
                  <button
                    onClick={() => {
                      setFocusState(leaveLayerFocus(resolvedFocusState));
                      studio?.switchDocument(documentTab.id);
                      setActiveLayerId(studio?.doc.layers[0]?.id ?? null);
                      setCustomName(documentTab.name);
                    }}
                    aria-current={documentTab.active ? "page" : undefined}
                  >
                    <span>{documentTab.name}</span>
                  </button>
                  {openDocuments.length > 1 && (
                    <button
                      onClick={() => {
                        setFocusState(leaveLayerFocus(resolvedFocusState));
                        studio?.closeDocument(documentTab.id);
                        setActiveLayerId(studio?.doc.layers[0]?.id ?? null);
                      }}
                      aria-label={`Close ${documentTab.name}`}
                    >×</button>
                  )}
                </div>
              ))}
            </div>
            <div
              ref={stageRef}
              id="studio-canvas"
              className="spatial-canvas-stage"
              tabIndex={0}
              role="application"
              aria-label={`${projectName} image canvas. Active tool: ${activeTool}.`}
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
              {resolvedFocusState.scope && focusedLayer && (
                <nav className="focus-canvas-controls" aria-label="Focus navigation">
                  <div className="focus-breadcrumbs">
                    <button onClick={exitFocusMode}>Project</button>
                    {focusBreadcrumbs.map((layer) => (
                      <span key={layer.id}>
                        <i aria-hidden="true">›</i>
                        <button
                          className={layer.id === resolvedFocusState.scope?.layerId ? "current" : ""}
                          onClick={() => enterFocusMode(layer.id)}
                          aria-current={layer.id === resolvedFocusState.scope?.layerId ? "page" : undefined}
                        >{layer.name}</button>
                      </span>
                    ))}
                    {resolvedFocusState.scope.target === "mask" && <span><i aria-hidden="true">›</i><button className="current">Mask</button></span>}
                  </div>
                  <div className="focus-target-switch" aria-label="Editing target">
                    <button className={resolvedFocusState.scope.target === "pixels" ? "active" : ""} onClick={() => enterFocusMode(focusedLayer.id, "pixels")}>Pixels</button>
                    <button disabled={!focusedLayer.mask} className={resolvedFocusState.scope.target === "mask" ? "active" : ""} onClick={() => enterFocusMode(focusedLayer.id, "mask")}>Mask</button>
                  </div>
                  <div className="focus-context-switch" aria-label="Context visibility">
                    <span>Context</span>
                    {(["off", "ghost", "full"] as FocusContextMode[]).map((mode) => (
                      <button key={mode} disabled={!supportsIsolatedFocus(focusedLayer) && mode !== "full"} className={resolvedFocusState.context === mode ? "active" : ""} onClick={() => setFocusContext(mode)}>{mode[0].toUpperCase() + mode.slice(1)}</button>
                    ))}
                  </div>
                  {(focusedLayer.locked || !focusedLayer.visible) && <span className="focus-edit-state">{focusedLayer.locked ? "Locked · view only" : "Hidden layer"}</span>}
                  <button className="focus-exit" onClick={exitFocusMode} title="Exit Focus (Esc)">Exit Focus</button>
                </nav>
              )}
              <div
                className={`spatial-canvas tool-${activeTool} workspace-${workspace}`}
              >
                <canvas
                  ref={canvasRef}
                  onPointerDown={onPointerDown}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onPointerCancel={onPointerUp}
                  style={{
                    position: "absolute",
                    inset: 0,
                    width: "100%",
                    height: "100%",
                    cursor: canvasCursor,
                    touchAction: "none",
                    display: "block",
                  }}
                />
                {doc && displayViewport && (
                  <div
                    className="document-overlay-plane"
                    style={{
                      position: "absolute",
                      left: `${(-displayViewport.x / displayViewport.width) * 100}%`,
                      top: `${(-displayViewport.y / displayViewport.height) * 100}%`,
                      width: `${(doc.width / displayViewport.width) * 100}%`,
                      height: `${(doc.height / displayViewport.height) * 100}%`,
                      pointerEvents: "none",
                    }}
                  >
                    {dragOverlay}
                    {doc.artboards?.map((artboard) => (
                      <div
                        key={artboard.id}
                        aria-label={`Artboard ${artboard.name}`}
                        style={{
                          position: "absolute",
                          left: `${(artboard.x / doc.width) * 100}%`,
                          top: `${(artboard.y / doc.height) * 100}%`,
                          width: `${(artboard.width / doc.width) * 100}%`,
                          height: `${(artboard.height / doc.height) * 100}%`,
                          border: "1px solid rgba(126,231,255,.82)",
                          boxShadow: "0 0 0 1px rgba(0,0,0,.35) inset",
                          pointerEvents: "none",
                        }}
                      >
                        <span style={{ position: "absolute", left: -1, top: -20, padding: "2px 5px", background: "rgba(12,16,24,.82)", color: "#9cecff", fontSize: 9, whiteSpace: "nowrap" }}>{artboard.name}</span>
                      </div>
                    ))}
                    {transformOverlay}
                    {penOverlay}
                    {pointOverlay}
                    {activeTool === "capture-brush" && captureSampling && captureHover && (
                      <i
                        aria-hidden="true"
                        style={{
                          position: "absolute",
                          left: `${((captureHover.x - captureRadius) / doc.width) * 100}%`,
                          top: `${((captureHover.y - captureRadius) / doc.height) * 100}%`,
                          width: `${(captureRadius * 2 / doc.width) * 100}%`,
                          height: `${(captureRadius * 2 / doc.height) * 100}%`,
                          border: "1.5px solid white",
                          borderRadius: "50%",
                          boxShadow: "0 0 0 1px rgba(0,0,0,.8), 0 0 22px rgba(54,215,255,.45)",
                          pointerEvents: "none",
                          zIndex: 12,
                        }}
                      />
                    )}
                    {showGuides && doc.guides.map((guide) => (
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
                  </div>
                )}
                <div className="canvas-status">
                  <span title={engineState ? `${engineState.surfaces} canvas mirrors · ${engineState.precisionTiles} resident precision tiles · ${engineState.previewCache.hits} tile-cache hits · ${formatBytes(engineState.workingSetBytes)} current working set` : undefined}>
                    {doc
                      ? `${doc.width}×${doc.height} · ${doc.colorSpace.toUpperCase()} · ${doc.bitDepth}-bit master${doc.proofing.profile !== "none" ? ` · PROOF ${doc.proofing.profile.toUpperCase()}` : ""} · CPU tiled preview · ${useGL && glSupported ? "GPU 16F export" : "CPU export"} · ${engineState?.blendPasses ?? 0} blend passes · ${formatBytes(engineState?.workingSetBytes ?? 0)}${engineState?.historyOverBudget ? " · history over budget" : ""}`
                      : "Loading…"}
                  </span>
                  <span>{Math.round(view.zoom * 100)}% · {layers.length} layer{layers.length === 1 ? "" : "s"}{doc?.selection ? " · sel" : ""}</span>
                </div>
                {recordingName && (
                  <div style={{ position: "absolute", top: 12, left: 12, background: "rgba(200,30,30,.9)", color: "#fff", padding: "4px 8px", borderRadius: 999, fontSize: 11 }}>
                    ● Recording · {recordingName}
                  </div>
                )}
              </div>
            </div>

            <Suspense fallback={<section className="layer-focus-panel" aria-label="Loading Layer Focus" />}>
              <LayerFocusPanel
                items={focusPanelItems}
                selectedLayerId={activeLayerId}
                focus={resolvedFocusState}
                focusedLayerName={focusedLayer?.name}
                projectName={projectName}
                onSelect={(layerId) => {
                  const layer = studio?.findLayer(layerId);
                  setActiveLayerId(layerId);
                  if (layer?.kind === "adjustment-tone") {
                    setActiveAdjustmentId(layer.id);
                    if (layer.tone) setTone({ ...layer.tone });
                  }
                }}
                onFocus={enterFocusMode}
                onExit={exitFocusMode}
                onPin={toggleFocusPin}
                onReorder={reorderFocusItems}
                onCreate={handleFocusCreate}
                onDropFiles={(files) => void importLayerFiles(files)}
                onCollapse={() => setAssetsOpen(false)}
              />
            </Suspense>
          </section>

          <aside ref={inspectorRef} className="spatial-inspector" data-tab={inspectorTab}>
            <nav className="inspector-tabs" aria-label="Inspector panels">
              <button className={inspectorTab === "properties" ? "active" : ""} onClick={() => focusInspector("properties")} aria-pressed={inspectorTab === "properties"}>Inspector</button>
              <button className={inspectorTab === "layers" ? "active" : ""} onClick={() => focusInspector("layers")} aria-pressed={inspectorTab === "layers"}>Layers</button>
              <button className={inspectorTab === "ai" ? "active" : ""} onClick={() => focusInspector("ai")} aria-pressed={inspectorTab === "ai"}><span>✦</span> Neural</button>
            </nav>
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
                {layers.map((layer, targetIndex) => (
                  <button
                    key={layer.id}
                    className={`spatial-layer ${activeLayerId === layer.id ? "active" : ""}`}
                    style={{ marginLeft: layer.parentId ? 14 : 0 }}
                    title={layer.ai
                      ? `${layer.ai.operation} · ${layer.ai.model}${layer.ai.requestId ? ` · request ${layer.ai.requestId}` : ""}${layer.ai.inputSha256 ? ` · input ${layer.ai.inputSha256.slice(0, 12)}…` : ""}`
                      : undefined}
                    draggable
                    onDragStart={() => setDraggedLayerId(layer.id)}
                    onDragEnd={() => setDraggedLayerId(null)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={() => {
                      if (!studio || !draggedLayerId || draggedLayerId === layer.id) return;
                      const sourceIndex = layers.findIndex((candidate) => candidate.id === draggedLayerId);
                      studio.reorderLayer(draggedLayerId, targetIndex - sourceIndex);
                      setDraggedLayerId(null);
                    }}
                    onClick={() => {
                      setActiveLayerId(layer.id);
                      setInspectorTab("layers");
                      if (layer.kind === "adjustment-tone") {
                        setActiveAdjustmentId(layer.id);
                        if (layer.tone) setTone({ ...layer.tone });
                      }
                    }}
                    onDoubleClick={() => {
                      // Photoshop's split: the row opens Layer Style, the name renames.
                      setActiveLayerId(layer.id);
                      setStyleLayerId(layer.id);
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
                      <strong
                        title="Double-click to rename"
                        onDoubleClick={(event) => {
                          event.stopPropagation();
                          const name = window.prompt("Layer name", layer.name)?.trim();
                          if (name) studio?.setLayerProp(layer.id, "name", name, "Layer renamed");
                        }}
                      >{layer.name}</strong>
                      <small>{layer.kind}{layer.source?.mode === "embedded-raw-preview" ? ` · ${layer.source.format} proxy` : layer.source?.mode === "dng-cfa-developed" ? " · DNG sensor · editable" : ""}{layer.source?.colorProfile ? ` · ICC ${layer.source.colorProfile.name}${layer.source.colorProfile.canTransform ? "" : " (metadata)"}` : ""}{layer.mask ? " · mask" : ""}{(layer.filters?.length || layer.effects?.length) ? ` · fx ${(layer.filters?.length ?? 0) + (layer.effects?.length ?? 0)}` : ""}{resolvedBlendPasses(layer).length > 1 ? ` · blend ${resolvedBlendPasses(layer).length}` : ""}{(!isNeutralBlendIf(resolvedBlendIf(layer)) || resolvedFillOpacity(layer) < 1) ? " · advanced" : ""}{layer.clipping ? " · clip" : ""}{layer.ai ? ` · ${layer.ai.model}` : ""}</small>
                    </span>
                    <i onClick={(e) => { e.stopPropagation(); setLayerVisible(layer.id, !layer.visible); }}>
                      {layer.visible ? "◉" : "○"}
                    </i>
                  </button>
                ))}
              </div>
              {activeLayer && (
                <div className="layer-controls">
                  <label>
                    <span>Master</span>
                    <input type="range" min="0" max="100" value={Math.round(activeLayer.opacity * 100)} onChange={(e) => setLayerOpacity(activeLayer.id, Number(e.target.value) / 100)} />
                    <output>{Math.round(activeLayer.opacity * 100)}%</output>
                  </label>
                  {activeLayer.kind === "group"
                    ? <div className="blend-group-note">Group opacity · children pass through</div>
                    : studio && (
                      <Suspense fallback={<div className="blend-stack-editor" aria-label="Loading blending controls" />}>
                        <BlendStackEditor key={activeLayer.id} layer={activeLayer} studio={studio} />
                      </Suspense>
                    )}
                  <div style={{ display: "flex", gap: 6, paddingTop: 6 }}>
                    <button onClick={() => studio?.setLayerProp(activeLayer.id, "locked", !activeLayer.locked, activeLayer.locked ? "Layer unlocked" : "Layer locked")} style={{ flex: 1 }}>
                      {activeLayer.locked ? "Locked" : "Lock layer"}
                    </button>
                    {activeLayer.kind !== "group" && (
                      <button onClick={() => studio?.setLayerProp(activeLayer.id, "clipping", !activeLayer.clipping, "Clipping mask")} style={{ flex: 1 }}>
                        {activeLayer.clipping ? "✓ Clipped" : "Clip below"}
                      </button>
                    )}
                  </div>
                  {(
                    <div style={{ display: "flex", gap: 6, paddingTop: 6 }}>
                      {activeLayer.kind === "raster" && (
                        <button onClick={() => studio?.convertToSmartObject(activeLayer.id)} style={{ flex: 1 }}>
                          ◇ Smart object
                        </button>
                      )}
                      <button onClick={() => setStyleLayerId(activeLayer.id)} style={{ flex: 1 }} title="Blending options, Blend If and layer effects">
                        fx Layer style…
                      </button>
                    </div>
                  )}
                  {!!activeLayer.filters?.length && (
                    <div style={{ display: "grid", gap: 4, paddingTop: 6 }}>
                      <Suspense fallback={<div aria-label="Loading smart filters" />}>
                        {activeLayer.filters.map((filter, index) => studio && (
                          <SmartFilterEditor key={filter.id} layer={activeLayer} filter={filter} index={index} count={activeLayer.filters!.length} studio={studio} />
                        ))}
                      </Suspense>
                    </div>
                  )}
                  {!!activeLayer.effects?.length && (
                    <div style={{ display: "grid", gap: 4, paddingTop: 6 }}>
                      {activeLayer.effects.map((effect) => (
                        <div key={effect.id} className="layer-effect-row">
                          <button onClick={() => setStyleLayerId(activeLayer.id)} title="Edit in Layer Style">
                            <i aria-hidden="true">{effect.enabled ? "◉" : "○"}</i>
                            <span>fx · {EFFECT_LABELS[effect.kind]}</span>
                          </button>
                          <button onClick={() => studio?.removeLayerEffect(activeLayer.id, effect.id)} aria-label={`Remove ${EFFECT_LABELS[effect.kind]}`} title="Remove layer effect">×</button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </section>

            <section className="glass-card mask-card">
              <header><strong>Channels</strong><small title="Channel previews do not change RGB export">{(engineState?.channelView ?? "rgb").toUpperCase()}</small></header>
              <div className="mask-segmented channel-switcher">
                {(["rgb", "red", "green", "blue", "alpha"] as const).map((channel) => (
                  <button
                    key={channel}
                    className={(engineState?.channelView ?? "rgb") === channel ? "active" : ""}
                    onClick={() => studio?.setChannelView(channel)}
                    aria-pressed={(engineState?.channelView ?? "rgb") === channel}
                  >{channel === "rgb" ? "RGB" : channel === "alpha" ? "A" : channel[0].toUpperCase()}</button>
                ))}
              </div>
            </section>

            <section className="glass-card mask-card">
              <header><strong>Layer comps</strong><small>{doc?.layerComps?.length ?? 0}</small></header>
              <div className="inspector-create-row">
                <input value={layerCompName} maxLength={80} onChange={(event) => setLayerCompName(event.target.value)} aria-label="New layer comp name" />
                <button onClick={() => {
                  const comp = studio?.captureLayerComp(layerCompName);
                  if (comp) notify(`Captured ${comp.name}`);
                }} aria-label="Capture layer comp" title="Capture current layer state">＋</button>
              </div>
              {!!doc?.layerComps?.length && (
                <div style={{ display: "grid", gap: 4, padding: "0 10px 9px" }}>
                  {doc.layerComps.map((comp) => (
                    <div key={comp.id} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto auto auto", gap: 4, alignItems: "center" }}>
                      <button onClick={() => studio?.applyLayerComp(comp.id)} style={{ textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={`Apply ${comp.name}`}>{comp.name}</button>
                      <button onClick={() => { studio?.recaptureLayerComp(comp.id); notify(`Updated ${comp.name}`); }} title="Recapture from current layers">↻</button>
                      <button onClick={() => studio?.applyLayerComp(comp.id)} title="Apply layer comp">▶</button>
                      <button onClick={() => studio?.removeLayerComp(comp.id)} title="Remove layer comp">×</button>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="glass-card mask-card">
              <header><strong>Artboards</strong><small>{doc?.artboards?.length ?? 0}</small></header>
              <div className="inspector-create-row">
                <input value={artboardName} maxLength={80} onChange={(event) => setArtboardName(event.target.value)} aria-label="New artboard name" />
                <button onClick={() => {
                  const bounds = doc?.selection?.bounds;
                  const artboard = studio?.createArtboard(artboardName, bounds ? { x: bounds.x, y: bounds.y, width: bounds.w, height: bounds.h } : undefined);
                  if (artboard) notify(`Created ${artboard.name}${bounds ? " from selection" : ""}`);
                }} aria-label={`Create artboard from ${doc?.selection ? "selection" : "canvas"}`} title={`Create from ${doc?.selection ? "selection" : "canvas"}`}>＋</button>
              </div>
              {!!doc?.artboards?.length && (
                <div style={{ display: "grid", gap: 4, padding: "0 10px 9px" }}>
                  {doc.artboards.map((artboard) => (
                    <div key={artboard.id} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto auto", gap: 4, alignItems: "center" }}>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 10 }} title={artboard.name}>{artboard.name} · {artboard.width}×{artboard.height}</span>
                      <button onClick={async () => {
                        if (!studio) return;
                        try {
                          const blob = await studio.exportArtboard(artboard.id);
                          await downloadOrSave(blob, `${artboard.name.replace(/[^a-z0-9_-]+/gi, "-") || "artboard"}.png`);
                          notify(`${artboard.name} exported`);
                        } catch (error) {
                          notify(error instanceof Error ? error.message : "Artboard export failed");
                        }
                      }} title="Export artboard as PNG">↗</button>
                      <button onClick={() => studio?.removeArtboard(artboard.id)} title="Remove artboard">×</button>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="glass-card mask-card">
              <header><strong>Assets</strong><small>{(studio?.listPlugins().length ?? 0) + capturedBrushes.length}</small></header>
              <div style={{ display: "grid", gap: 4, padding: "8px 10px" }}>
                {studio?.listPlugins().length ? studio.listPlugins().map((plugin) => (
                  <div key={plugin.id} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", alignItems: "center", gap: 5 }}>
                    <span style={{ fontSize: 10, overflow: "hidden", textOverflow: "ellipsis" }}>{plugin.name ?? plugin.id}{plugin.version ? ` · ${plugin.version}` : ""}</span>
                    <button onClick={() => studio.unregisterPlugin(plugin.id)} title={`Unload ${plugin.name ?? plugin.id}`}>Unload</button>
                  </div>
                )) : <small className="inspector-empty-state">No plug-ins or saved brushes</small>}
              </div>
            </section>

            <section className="glass-card mask-card">
              <header><strong>Document</strong><small>{doc?.width ?? 0} × {doc?.height ?? 0}</small></header>
              <div className="document-size-row">
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
                }} aria-label="Apply document size" title="Resize document" style={{ alignSelf: "end" }}>✓</button>
              </div>
              <div style={{ display: "grid", gap: 7, padding: "0 10px 10px" }}>
                <label style={{ display: "grid", gridTemplateColumns: "74px 1fr auto", alignItems: "center", gap: 6, fontSize: 10 }}>
                  <span>Resolution</span>
                  <input
                    key={`resolution-${doc?.resolution.x}`}
                    ref={resolutionRef}
                    type="number"
                    min="1"
                    max="12000"
                    step="1"
                    defaultValue={doc?.resolution.x ?? 72}
                    aria-label="Document print resolution in pixels per inch"
                  />
                  <button onClick={() => {
                    const ppi = Number(resolutionRef.current?.value);
                    if (studio?.setDocumentResolution(ppi)) notify(`Resolution set to ${ppi} ppi without resampling`);
                  }} aria-label="Apply print resolution">Set</button>
                </label>
                <label style={{ display: "grid", gridTemplateColumns: "74px 1fr", alignItems: "center", gap: 6, fontSize: 10 }}>
                  <span>Color space</span>
                  <select
                    value={doc?.colorSpace ?? "srgb"}
                    onChange={(event) => {
                      if (!studio || !doc) return;
                      const colorSpace = event.target.value as typeof doc.colorSpace;
                      if (studio.setDocumentPrecision(doc.bitDepth, colorSpace)) notify(`Converted to ${colorSpace.toUpperCase()}`);
                    }}
                    aria-label="Document color space"
                  >
                    <option value="srgb">sRGB</option>
                    <option value="display-p3">Display P3</option>
                    <option value="linear-srgb">Linear sRGB</option>
                  </select>
                </label>
                <div style={{ display: "grid", gridTemplateColumns: "74px repeat(3, 1fr)", gap: 5, alignItems: "center", fontSize: 10 }}>
                  <span>Bit depth</span>
                  {([8, 16, 32] as const).map((depth) => (
                    <button
                      key={depth}
                      type="button"
                      className={doc?.bitDepth === depth ? "active" : ""}
                      onClick={() => {
                        if (!studio || !doc) return;
                        if (studio.setDocumentPrecision(depth, doc.colorSpace)) notify(`Converted to ${depth}-bit ${depth === 8 ? "integer" : "float"}`);
                      }}
                      aria-pressed={doc?.bitDepth === depth}
                    >{depth}</button>
                  ))}
                </div>
                <details className="document-diagnostics">
                  <summary>
                    <span>Engine details</span>
                    <small>{engineState?.precisionTiles ?? 0} tiles · {formatBytes(engineState?.precisionBytes ?? 0)}</small>
                  </summary>
                  <div className="document-diagnostics-body">
                    <div><span>Precision</span><b>Linear · {doc?.bitDepth ?? 8}-bit</b></div>
                    <div><span>Color</span><b>{engineState?.colorManagement.profiles ?? 0} ICC profiles</b></div>
                    <div><span>Canvas</span><b>{engineState?.virtualCanvas.levels ?? 1} mip · {engineState?.virtualCanvas.plannedTiles ?? 0} ready</b></div>
                    <div><span>Renderer</span><b>{Math.round((engineState?.viewportPerformance.p95Ms ?? 0) * 10) / 10} ms p95 · {Math.round((engineState?.adaptivePreview.scale ?? 1) * 100)}%</b></div>
                    <div><span>GPU cache</span><b>{formatBytes(engineState?.gpuTextureCache.residentBytes ?? 0)} / {formatBytes(engineState?.gpuTextureCache.budgetBytes ?? 0)}</b></div>
                    <div><span>Photoshop</span><b>{engineState?.photoshop.container.toUpperCase() ?? "PSD"} · {engineState?.photoshop.warnings ?? 0} notes</b></div>
                  </div>
                </details>
                {photoshopReport && (
                  <details className="advanced-blending">
                    <summary>
                      <span>Photoshop preflight</span>
                      <small>{photoshopReport.canExport ? `${photoshopReport.container.toUpperCase()} ready` : "Action required"}</small>
                    </summary>
                    <div className="advanced-blending-body" style={{ gap: 5 }}>
                      {photoshopReport.issues.length === 0 ? (
                        <small>No compatibility issues detected.</small>
                      ) : photoshopReport.issues.map((issue, index) => (
                        <small key={`${issue.code}-${issue.layerId ?? "document"}-${index}`} style={{ lineHeight: 1.35 }}>
                          {issue.severity === "error" ? "●" : issue.severity === "warning" ? "▲" : "ℹ"} {issue.message}
                        </small>
                      ))}
                    </div>
                  </details>
                )}
                <label style={{ display: "grid", gridTemplateColumns: "74px 1fr", alignItems: "center", gap: 6, fontSize: 10 }}>
                  <span>Soft proof</span>
                  <select
                    value={doc?.proofing.profile ?? "none"}
                    onChange={(event) => studio?.setDocumentProofing({ profile: event.target.value as ProofProfile })}
                    aria-label="Soft proof profile"
                  >
                    <option value="none">Off</option>
                    <option value="srgb">sRGB output</option>
                    <option value="display-p3">Display P3 output</option>
                    <option value="cmyk-generic">CMYK · coated proof</option>
                  </select>
                </label>
                {doc?.proofing.profile !== "none" && (
                  <>
                    <label style={{ display: "grid", gridTemplateColumns: "74px 1fr", alignItems: "center", gap: 6, fontSize: 10 }}>
                      <span>Intent</span>
                      <select
                        value={doc?.proofing.intent ?? "relative-colorimetric"}
                        onChange={(event) => studio?.setDocumentProofing({ intent: event.target.value as ProofSettings["intent"] })}
                        aria-label="Proof rendering intent"
                      >
                        <option value="relative-colorimetric">Relative colorimetric</option>
                        <option value="perceptual">Perceptual</option>
                        <option value="absolute-colorimetric">Absolute colorimetric</option>
                        <option value="saturation">Saturation</option>
                      </select>
                    </label>
                    <div className="mask-segmented">
                      <button
                        type="button"
                        className={doc?.proofing.blackPointCompensation ? "active" : ""}
                        onClick={() => studio?.setDocumentProofing({ blackPointCompensation: !doc?.proofing.blackPointCompensation })}
                      >Black point</button>
                      <button
                        type="button"
                        className={doc?.proofing.gamutWarning ? "active" : ""}
                        onClick={() => studio?.setDocumentProofing({ gamutWarning: !doc?.proofing.gamutWarning })}
                      >Gamut warning</button>
                    </div>
                  </>
                )}
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
                  <label>
                    <span>Smooth edge</span>
                    <input type="range" min="0" max="24" value={selectionSmooth} onChange={(e) => setSelectionSmooth(Number(e.target.value))} />
                    <output>{selectionSmooth}px</output>
                  </label>
                  <label>
                    <span>Edge contrast</span>
                    <input type="range" min="0" max="100" value={selectionContrast} onChange={(e) => setSelectionContrast(Number(e.target.value))} />
                    <output>{selectionContrast}%</output>
                  </label>
                  <label>
                    <span>Shift edge</span>
                    <input type="range" min="-100" max="100" value={selectionShift} onChange={(e) => setSelectionShift(Number(e.target.value))} />
                    <output>{selectionShift > 0 ? "+" : ""}{selectionShift}%</output>
                  </label>
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
                  <button onClick={() => studio?.refineSelection({ smooth: selectionSmooth, contrast: selectionContrast, shiftEdge: selectionShift })}>Refine edge</button>
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
                  <label><span>Opacity</span><input type="range" min="0" max="100" value={Math.round(brushOpacity * 100)} onChange={(e) => setBrushOpacity(Number(e.target.value) / 100)} /><output>{Math.round(brushOpacity * 100)}%</output></label>
                  <label><span>Flow</span><input type="range" min="1" max="100" value={Math.round(brushFlow * 100)} onChange={(e) => setBrushFlow(Number(e.target.value) / 100)} /><output>{Math.round(brushFlow * 100)}%</output></label>
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

            {workspace === "develop" && activeLayer?.raw && rawDevelop && (
              <section className="glass-card tone-card">
                <header>
                  <strong>RAW Develop</strong>
                  <small>{activeLayer.raw.sensor.bitsPerSample}-bit CFA · FLOAT</small>
                </header>
                <div className="tone-controls">
                  <label>
                    <span>White balance</span>
                    <select
                      value={rawDevelop.whiteBalance}
                      onChange={(event) => {
                        const next = { ...rawDevelop, whiteBalance: event.target.value as RawDevelopSettings["whiteBalance"] };
                        setRawDevelop(next);
                        commitRawDevelop(next);
                      }}
                    >
                      <option value="as-shot">As shot</option>
                      <option value="daylight">Daylight</option>
                      <option value="custom">Custom</option>
                    </select>
                    <output>{rawDevelop.whiteBalance}</output>
                  </label>
                  <label>
                    <span>Sensor exposure</span>
                    <input
                      type="range"
                      min="-5"
                      max="5"
                      step="0.1"
                      value={rawDevelop.exposureEV}
                      onChange={(event) => setRawDevelop({ ...rawDevelop, exposureEV: Number(event.target.value) })}
                      onPointerUp={() => commitRawDevelop(rawDevelop)}
                      onBlur={() => commitRawDevelop(rawDevelop)}
                    />
                    <output>{rawDevelop.exposureEV.toFixed(1)} EV</output>
                  </label>
                  <label>
                    <span>Highlight recovery</span>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={Math.round(rawDevelop.highlightRecovery * 100)}
                      onChange={(event) => setRawDevelop({ ...rawDevelop, highlightRecovery: Number(event.target.value) / 100 })}
                      onPointerUp={() => commitRawDevelop(rawDevelop)}
                      onBlur={() => commitRawDevelop(rawDevelop)}
                    />
                    <output>{Math.round(rawDevelop.highlightRecovery * 100)}%</output>
                  </label>
                  {rawDevelop.whiteBalance === "custom" && (["R", "G", "B"] as const).map((channel, index) => (
                    <label key={channel}>
                      <span>WB {channel}</span>
                      <input
                        type="number"
                        min="0.05"
                        max="16"
                        step="0.05"
                        value={rawDevelop.customWhiteBalance[index]}
                        onChange={(event) => {
                          const custom = [...rawDevelop.customWhiteBalance] as [number, number, number];
                          custom[index] = Number(event.target.value);
                          setRawDevelop({ ...rawDevelop, customWhiteBalance: custom });
                        }}
                        onBlur={() => commitRawDevelop(rawDevelop)}
                      />
                      <output>{rawDevelop.customWhiteBalance[index].toFixed(2)}</output>
                    </label>
                  ))}
                </div>
                <p style={{ padding: "0 12px 10px", fontSize: 11, opacity: 0.65 }}>
                  Re-developed from the original embedded DNG sensor asset · {activeLayer.raw.matrixSource.replaceAll("-", " ")}
                  {activeLayer.raw.sensor.warnings.length ? ` · ${activeLayer.raw.sensor.warnings.join(" · ")}` : ""}
                </p>
              </section>
            )}

            {workspace === "develop" && activeLayer?.kind === "adjustment-curves" && activeLayer.curves && (
              <Suspense fallback={<section className="glass-card tone-card" aria-label="Loading curves" />}>
                <CurvesEditor curves={activeLayer.curves} onLive={(c) => studio?.liveUpdateCurves(activeLayer.id, c)} onCommit={(c) => studio?.updateCurves(activeLayer.id, c)} onReset={() => studio?.updateCurves(activeLayer.id, cloneCurves(NEUTRAL_CURVES))} />
              </Suspense>
            )}
            {workspace === "develop" && activeLayer?.kind === "adjustment-levels" && activeLayer.levels && (
              <Suspense fallback={<section className="glass-card tone-card" aria-label="Loading levels" />}>
                <LevelsEditor levels={activeLayer.levels} onLive={(l) => studio?.liveUpdateLevels(activeLayer.id, l)} onCommit={(l) => studio?.updateLevels(activeLayer.id, l)} onReset={() => studio?.updateLevels(activeLayer.id, { ...NEUTRAL_LEVELS })} />
              </Suspense>
            )}
            {workspace === "develop" && activeLayer?.kind === "adjustment-hsl" && activeLayer.hsl && (
              <Suspense fallback={<section className="glass-card tone-card" aria-label="Loading HSL" />}>
                <HslEditor hsl={activeLayer.hsl} onLive={(h) => studio?.liveUpdateHsl(activeLayer.id, h)} onCommit={(h) => studio?.updateHsl(activeLayer.id, h)} onReset={() => studio?.updateHsl(activeLayer.id, { ...NEUTRAL_HSL })} />
              </Suspense>
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

            {(workspace === "edit" || workspace === "retouch") && (
              <section className="glass-card tone-card">
                <header>
                  <strong>{modeTools[workspace].find(([tool]) => tool === activeTool)?.[2] ?? "Brush"}</strong>
                  <input type="color" value={brushColor} onChange={(e) => setBrushColor(e.target.value)} aria-label="Brush color" style={{ width: 28, height: 22, border: "none", background: "transparent" }} />
                </header>
                {retouchTool && (
                  <p style={{ padding: "0 12px 7px", fontSize: 10, opacity: 0.72 }}>
                    {activeTool === "clone" || activeTool === "heal" || activeTool === "patch"
                      ? `${retouchSample ? `Source ${Math.round(retouchSample.x)}, ${Math.round(retouchSample.y)}` : "Alt-click to sample a source"} · float-tile replay`
                      : "Precision float-tile brush · nondestructive history replay"}
                  </p>
                )}
                {(activeTool === "gradient" || activeTool === "pattern" || activeTool === "fill") && (
                  <div style={{ display: "grid", gap: 7, padding: "0 12px 9px" }}>
                    <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 11 }}>
                      <span>Second color</span><input type="color" value={secondaryColor} onChange={(event) => setSecondaryColor(event.target.value)} />
                    </label>
                    {activeTool === "gradient" && <select value={gradientType} onChange={(event) => setGradientType(event.target.value as typeof gradientType)}><option value="linear">Linear gradient</option><option value="radial">Radial gradient</option></select>}
                    {activeTool === "pattern" && <><select value={patternKind} onChange={(event) => setPatternKind(event.target.value as PatternKind)}><option value="checker">Checker</option><option value="stripes">Stripes</option><option value="dots">Dots</option></select><label style={{ display: "flex", gap: 8, fontSize: 11 }}><span>Scale</span><input type="range" min="2" max="160" value={patternScale} onChange={(event) => setPatternScale(Number(event.target.value))} /><output>{patternScale}px</output></label></>}
                  </div>
                )}
                {activeTool === "capture-brush" && (
                  <div style={{ display: "grid", gap: 9, padding: "0 12px 10px" }}>
                    <p style={{ margin: 0, fontSize: 10, lineHeight: 1.45, opacity: 0.72 }}>
                      Turn any part of this document—or an uploaded image—into a full-color brush. Paint size uses [ and ].
                    </p>
                    <div className="mask-segmented" style={{ padding: 0 }}>
                      <button
                        className={captureSampling ? "active" : ""}
                        onClick={() => { setCaptureSampling(true); setCaptureSource(null); }}
                      >Sample canvas</button>
                      <button onClick={() => captureInput.current?.click()}>Upload image</button>
                    </div>
                    <div className="mask-segmented" style={{ padding: 0 }}>
                      <button className={captureSampleMerged ? "active" : ""} onClick={() => setCaptureSampleMerged(true)}>Merged</button>
                      <button className={!captureSampleMerged ? "active" : ""} onClick={() => setCaptureSampleMerged(false)}>Active layer</button>
                    </div>
                    <label style={{ display: "grid", gridTemplateColumns: "72px 1fr", alignItems: "center", gap: 8, fontSize: 10 }}>
                      <span>Color mode</span>
                      <select value={capturedBrushMode} onChange={(event) => setCapturedBrushMode(event.target.value as ImageBrushMode)}>
                        <option value="color">Full color</option>
                        <option value="tint">Tint with paint color</option>
                        <option value="stencil">Dark pixels as stencil</option>
                      </select>
                    </label>
                    {captureSampling && (
                      <label style={{ display: "grid", gridTemplateColumns: "72px 1fr 44px", alignItems: "center", gap: 7, fontSize: 10 }}>
                        <span>Sample radius</span>
                        <input type="range" min="2" max="512" value={captureRadius} onChange={(event) => setCaptureRadius(Number(event.target.value))} />
                        <output>{captureRadius}px</output>
                      </label>
                    )}
                    {captureSampling && (
                      <p style={{ margin: 0, fontSize: 10, color: "#7ee7ff" }}>
                        Click the canvas to capture · [ ] changes the radius
                      </p>
                    )}
                    {captureSource && (
                      <div style={{ display: "grid", gap: 7, padding: 8, border: "1px solid rgba(255,255,255,.12)", borderRadius: 10, background: "rgba(255,255,255,.035)" }}>
                        <div
                          role="button"
                          tabIndex={0}
                          aria-label="Choose the center of the uploaded brush sample"
                          onPointerDown={(event) => {
                            const rect = event.currentTarget.getBoundingClientRect();
                            const centerX = Math.max(0, Math.min(captureSource.canvas.width, (event.clientX - rect.left) / rect.width * captureSource.canvas.width));
                            const centerY = Math.max(0, Math.min(captureSource.canvas.height, (event.clientY - rect.top) / rect.height * captureSource.canvas.height));
                            setCaptureSource({ ...captureSource, centerX, centerY });
                          }}
                          style={{ position: "relative", overflow: "hidden", borderRadius: 8, cursor: "crosshair", background: "#111" }}
                        >
                          {/* Blob URLs are local sampler inputs and cannot use the Next image optimizer. */}
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={captureSource.previewUrl} alt={`Sample source: ${captureSource.name}`} style={{ width: "100%", display: "block" }} />
                          <i
                            aria-hidden="true"
                            style={{
                              position: "absolute",
                              left: `${((captureSource.centerX - captureSource.radius) / captureSource.canvas.width) * 100}%`,
                              top: `${((captureSource.centerY - captureSource.radius) / captureSource.canvas.height) * 100}%`,
                              width: `${(captureSource.radius * 2 / captureSource.canvas.width) * 100}%`,
                              aspectRatio: "1",
                              border: "1.5px solid white",
                              borderRadius: "50%",
                              boxShadow: "0 0 0 1px rgba(0,0,0,.75)",
                            }}
                          />
                        </div>
                        <label style={{ display: "grid", gridTemplateColumns: "54px 1fr 44px", alignItems: "center", gap: 7, fontSize: 10 }}>
                          <span>Radius</span>
                          <input
                            type="range"
                            min="2"
                            max={Math.max(2, Math.floor(Math.min(captureSource.canvas.width, captureSource.canvas.height) / 2))}
                            value={captureSource.radius}
                            onChange={(event) => setCaptureSource({ ...captureSource, radius: Number(event.target.value) })}
                          />
                          <output>{captureSource.radius}px</output>
                        </label>
                        <button onClick={createUploadedCapture} style={{ padding: 7 }}>Create brush from selection</button>
                      </div>
                    )}
                    <div>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, fontSize: 10, opacity: 0.7 }}>
                        <span>Document brush library</span><span>{capturedBrushes.length}/32</span>
                      </div>
                      {capturedBrushes.length ? (
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 6 }}>
                          {[...capturedBrushes].reverse().map((asset) => (
                            <div key={asset.id} style={{ position: "relative", minWidth: 0 }}>
                              <button
                                className={activeCapturedBrushId === asset.id ? "active" : ""}
                                onClick={() => activateCapturedBrush(asset)}
                                title={`${asset.name} · ${Math.round(asset.sourceDiameter)}px source`}
                                style={{ width: "100%", display: "grid", justifyItems: "center", gap: 3, padding: "5px 3px", overflow: "hidden" }}
                              >
                                <CapturedBrushThumbnail asset={asset} />
                                <span style={{ width: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 9 }}>{asset.name}</span>
                              </button>
                              <button
                                aria-label={`Remove ${asset.name}`}
                                title="Remove brush"
                                onClick={() => {
                                  studio?.removeCapturedBrush(asset.id);
                                  if (activeCapturedBrushId === asset.id) {
                                    setActiveCapturedBrushId(null);
                                    setCaptureSampling(true);
                                  }
                                }}
                                style={{ position: "absolute", top: 2, right: 2, width: 18, height: 18, padding: 0, borderRadius: 9, fontSize: 11 }}
                              >×</button>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p style={{ margin: 0, padding: "8px 0", fontSize: 10, opacity: 0.55 }}>No captured brushes yet.</p>
                      )}
                    </div>
                  </div>
                )}
                {(!workflowPreferences.contextualInspector || paintingTool || retouchTool) && (<>
                <div className="tone-controls">
                  <label><span>Size</span><input type="range" min="1" max={activeTool === "capture-brush" ? 1200 : 400} value={brushSize} onChange={(e) => setBrushSize(Number(e.target.value))} /><output>{brushSize}px</output></label>
                  <label><span>Hardness</span><input type="range" min="0" max="100" value={Math.round(hardness * 100)} onChange={(e) => setHardness(Number(e.target.value) / 100)} /><output>{Math.round(hardness * 100)}%</output></label>
                  <label><span>Opacity</span><input type="range" min="0" max="100" value={Math.round(brushOpacity * 100)} onChange={(e) => setBrushOpacity(Number(e.target.value) / 100)} /><output>{Math.round(brushOpacity * 100)}%</output></label>
                  <label><span>Flow</span><input type="range" min="1" max="100" value={Math.round(brushFlow * 100)} onChange={(e) => setBrushFlow(Number(e.target.value) / 100)} /><output>{Math.round(brushFlow * 100)}%</output></label>
                  <label><span>Stabilizer</span><input type="range" min="0" max="95" value={Math.round(brushSmoothing * 100)} onChange={(e) => setBrushSmoothing(Number(e.target.value) / 100)} /><output>{Math.round(brushSmoothing * 100)}%</output></label>
                  <label><span>Spacing</span><input type="range" min="1" max="100" value={Math.round(brushSpacing * 100)} onChange={(e) => setBrushSpacing(Number(e.target.value) / 100)} /><output>{Math.round(brushSpacing * 100)}%</output></label>
                  <label><span>Roundness</span><input type="range" min="5" max="100" value={Math.round(brushRoundness * 100)} onChange={(e) => setBrushRoundness(Number(e.target.value) / 100)} /><output>{Math.round(brushRoundness * 100)}%</output></label>
                  <label><span>Angle</span><input type="range" min="-180" max="180" value={brushAngle} onChange={(e) => setBrushAngle(Number(e.target.value))} /><output>{brushAngle}°</output></label>
                  <label><span>Tilt shape</span><input type="range" min="0" max="100" value={Math.round(brushTilt * 100)} onChange={(e) => setBrushTilt(Number(e.target.value) / 100)} /><output>{Math.round(brushTilt * 100)}%</output></label>
                  <label><span>Scatter</span><input type="range" min="0" max="200" value={Math.round(brushScatter * 100)} onChange={(e) => setBrushScatter(Number(e.target.value) / 100)} /><output>{Math.round(brushScatter * 100)}%</output></label>
                  <label><span>Texture</span><input type="range" min="0" max="100" value={Math.round(brushTexture * 100)} onChange={(e) => setBrushTexture(Number(e.target.value) / 100)} /><output>{Math.round(brushTexture * 100)}%</output></label>
                  <label><span>Blend</span><select value={brushBlendMode} onChange={(e) => setBrushBlendMode(e.target.value as NonNullable<BrushParams["blendMode"]>)}><option value="normal">Normal</option><option value="multiply">Multiply</option><option value="screen">Screen</option><option value="overlay">Overlay</option></select><output>{brushBlendMode}</output></label>
                  <label><span>Symmetry</span><select value={brushSymmetry} onChange={(e) => setBrushSymmetry(e.target.value as typeof brushSymmetry)}><option value="none">Off</option><option value="horizontal">Horizontal</option><option value="vertical">Vertical</option><option value="radial">Radial · 6</option></select><output>{brushSymmetry}</output></label>
                </div>
                <div className="mask-segmented" style={{ paddingBottom: 9 }}>
                  <button className={pressureSize ? "active" : ""} onClick={() => setPressureSize((value) => !value)}>Pressure size</button>
                  <button className={pressureOpacity ? "active" : ""} onClick={() => setPressureOpacity((value) => !value)}>Pressure opacity</button>
                  <button className={brushBuildUp ? "active" : ""} onClick={() => setBrushBuildUp((value) => !value)}>Airbrush buildup</button>
                </div>
                </>)}
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
                      <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6, fontSize: 11 }}>
                        <span>Tracking</span>
                        <input type="range" min="-100" max="600" step="10" value={activeLayer.text.tracking ?? 0}
                          onChange={(e) => studio?.updateText(activeLayer.id, { tracking: Number(e.target.value) })} />
                        <small style={{ opacity: 0.65, minWidth: 30, textAlign: "right" }}>{activeLayer.text.tracking ?? 0}</small>
                      </label>
                      <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4, fontSize: 11 }}>
                        <span>Para space</span>
                        <input type="range" min="0" max="3" step="0.1" value={activeLayer.text.paragraphSpacing ?? 0}
                          onChange={(e) => studio?.updateText(activeLayer.id, { paragraphSpacing: Number(e.target.value) })} />
                        <small style={{ opacity: 0.65, minWidth: 30, textAlign: "right" }}>{(activeLayer.text.paragraphSpacing ?? 0).toFixed(1)}</small>
                      </label>
                      {activeLayer.text.layout === "paragraph" && (
                        <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4, fontSize: 11 }}>
                          <input type="checkbox" checked={activeLayer.text.justify ?? false}
                            onChange={(e) => studio?.updateText(activeLayer.id, { justify: e.target.checked })} />
                          <span>Justify</span>
                        </label>
                      )}
                      <button onClick={() => activeLayer?.text && studio?.updateText(activeLayer.id, { text: textDraft })} style={{ marginTop: 4, fontSize: 11 }}>Update active text</button>
                    </>
                  )}
                  {activeLayer?.kind === "shape" && activeLayer.shape && (
                    <div style={{ display: "grid", gap: 7, marginTop: 8, paddingTop: 8, borderTop: "1px solid rgba(255,255,255,.1)", fontSize: 10 }}>
                      <label style={{ display: "grid", gridTemplateColumns: "72px 1fr", alignItems: "center", gap: 6 }}>
                        <span>Geometry</span>
                        <select value={activeLayer.shape.kind} onChange={(event) => studio?.updateShape(activeLayer.id, { kind: event.target.value as "rect" | "ellipse" })}>
                          <option value="rect">Rectangle</option><option value="ellipse">Ellipse</option>
                        </select>
                      </label>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                        <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 5 }}><span>Fill</span><input type="color" value={/^#[0-9a-f]{6}$/i.test(activeLayer.shape.fill) ? activeLayer.shape.fill : "#ffffff"} onChange={(event) => studio?.updateShape(activeLayer.id, { fill: event.target.value })} /></label>
                        <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 5 }}><span>Stroke</span><input type="color" value={/^#[0-9a-f]{6}$/i.test(activeLayer.shape.stroke) ? activeLayer.shape.stroke : "#000000"} onChange={(event) => studio?.updateShape(activeLayer.id, { stroke: event.target.value })} /></label>
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 6 }}>
                        {([[
                          "Stroke px", "strokeWidth", activeLayer.shape.strokeWidth, 0,
                        ], ["Radius px", "radius", activeLayer.shape.radius, 0], ["Width px", "w", activeLayer.shape.w, 1], ["Height px", "h", activeLayer.shape.h, 1]] as const).map(([label, key, value, minimum]) => (
                          <label key={key} style={{ display: "grid", gap: 3 }}><span>{label}</span><input key={`${activeLayer.id}-${key}-${value}`} type="number" min={minimum} defaultValue={Math.round(value * 100) / 100} onBlur={(event) => {
                            const next = Math.max(minimum, Number(event.target.value));
                            if (Number.isFinite(next)) studio?.updateShape(activeLayer.id, { [key]: next });
                          }} /></label>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </section>
            )}

            {workspace === "transform" && (
              <section className="glass-card tone-card">
                <header><strong>Transform & geometry</strong><small>PRECISION</small></header>
                <div style={{ display: "grid", gap: 8, padding: "8px 12px 12px", fontSize: 11 }}>
                  <p style={{ margin: 0, opacity: 0.72 }}>
                    {quadTool ? `Place four corners in order · ${pointDraft.length}/4` : activeTool === "content-move" ? "Make a selection, then drag it to a new position." : activeTool === "crop" ? "Drag the retained crop rectangle." : "Drag directly on the document."}
                  </p>
                  {(activeTool === "puppet-warp" || activeTool === "liquify") && <label style={{ display: "flex", gap: 8, alignItems: "center" }}><span>Influence</span><input type="range" min="16" max="600" value={warpRadius} onChange={(event) => setWarpRadius(Number(event.target.value))} /><output>{warpRadius}px</output></label>}
                  {pointDraft.length > 0 && <button onClick={() => setPointDraft([])}>Clear points</button>}
                  {activeLayer && (
                    <>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 6 }}>
                        {([[
                          "X", "tx", activeLayer.transform.tx, 1,
                        ], ["Y", "ty", activeLayer.transform.ty, 1], ["Scale X", "sx", activeLayer.transform.sx, 0.01], ["Scale Y", "sy", activeLayer.transform.sy, 0.01]] as const).map(([label, key, value, step]) => (
                          <label key={key} style={{ display: "grid", gap: 3 }}><span>{label}</span><input key={`${activeLayer.id}-${key}-${value}`} type="number" step={step} defaultValue={Math.round(value * 100) / 100} onBlur={(event) => {
                            const next = Number(event.target.value);
                            if (Number.isFinite(next)) studio?.updateTransform(activeLayer.id, { [key]: next });
                          }} /></label>
                        ))}
                        <label style={{ display: "grid", gap: 3 }}><span>Rotation °</span><input key={`${activeLayer.id}-rotation-${activeLayer.transform.rotation}`} type="number" step="0.1" defaultValue={Math.round(activeLayer.transform.rotation * 180 / Math.PI * 10) / 10} onBlur={(event) => {
                          const degrees = Number(event.target.value);
                          if (Number.isFinite(degrees)) studio?.updateTransform(activeLayer.id, { rotation: degrees * Math.PI / 180 });
                        }} /></label>
                      </div>
                      <button onClick={() => studio?.resetTransform(activeLayer.id)}>Reset transform</button>
                    </>
                  )}
                </div>
              </section>
            )}

            {workspace === "measure" && (
              <section className="glass-card tone-card">
                <header><strong>Measure & sample</strong><button onClick={() => { setColorSamples([]); setMeasurement(null); }}>Clear</button></header>
                <div style={{ display: "grid", gap: 7, padding: "8px 12px 12px", fontSize: 11 }}>
                  {measurement ? (() => {
                    const dx = measurement.end.x - measurement.start.x;
                    const dy = measurement.end.y - measurement.start.y;
                    return <><div>Length <strong>{Math.hypot(dx, dy).toFixed(1)} px</strong></div><div>Angle <strong>{(Math.atan2(dy, dx) * 180 / Math.PI).toFixed(1)}°</strong></div><div>Δx {dx.toFixed(1)} · Δy {dy.toFixed(1)}</div></>;
                  })() : <p style={{ margin: 0, opacity: 0.7 }}>Drag with Ruler or click with a sampler.</p>}
                  {colorSamples.map((sample, index) => <div key={`${sample.x}-${sample.y}-${index}`} style={{ display: "flex", alignItems: "center", gap: 7 }}><i style={{ width: 14, height: 14, borderRadius: 3, background: sample.color, border: "1px solid rgba(255,255,255,.35)" }} /><span>#{index + 1} · {sample.color} · {Math.round(sample.x)}, {Math.round(sample.y)}</span></div>)}
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
                  {aiRunning && <button onClick={() => aiAbort.current?.abort()} title="Cancel all pending variations">Cancel</button>}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                  <label style={{ display: "grid", gap: 3, fontSize: 10 }}>
                    <span>Quality</span>
                    <select value={aiQuality} onChange={(event) => setAiQuality(event.target.value as AiEditQuality)}>
                      <option value="auto">Auto</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option>
                    </select>
                  </label>
                  <label style={{ display: "grid", gap: 3, fontSize: 10 }}>
                    <span>Variations</span>
                    <select value={aiVariations} onChange={(event) => setAiVariations(Number(event.target.value))}>
                      {[1, 2, 3, 4].map((count) => <option key={count} value={count}>{count}</option>)}
                    </select>
                  </label>
                </div>
                <label style={{ display: "grid", gridTemplateColumns: "72px 1fr 34px", gap: 5, alignItems: "center", fontSize: 10 }}>
                  <span>Strength</span><input type="range" min="0" max="100" value={Math.round(aiStrength * 100)} onChange={(event) => setAiStrength(Number(event.target.value) / 100)} /><output>{Math.round(aiStrength * 100)}%</output>
                </label>
                <label style={{ display: "grid", gridTemplateColumns: "72px 1fr 34px", gap: 5, alignItems: "center", fontSize: 10 }}>
                  <span>Preserve</span><input type="range" min="0" max="100" value={Math.round(aiPreserve * 100)} onChange={(event) => setAiPreserve(Number(event.target.value) / 100)} /><output>{Math.round(aiPreserve * 100)}%</output>
                </label>
                {aiOperation === "relight" && (
                  <label style={{ display: "grid", gridTemplateColumns: "72px 1fr 34px", gap: 5, alignItems: "center", fontSize: 10 }}>
                    <span>Temperature</span><input type="range" min="-100" max="100" value={Math.round(aiTemperature * 100)} onChange={(event) => setAiTemperature(Number(event.target.value) / 100)} /><output>{Math.round(aiTemperature * 100)}</output>
                  </label>
                )}
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
                  <div className="inspector-empty-state" style={{ padding: "8px 4px" }}>
                    No recorded actions
                  </div>
                )}
              </div>
            </section>

            <div className="spatial-view-dock">
              <button onClick={() => studio?.undo()} title="Undo" disabled={!studio?.canUndo()}>↶</button>
              <button onClick={() => studio?.redo()} title="Redo" disabled={!studio?.canRedo()}>↷</button>
              <button onClick={() => studio?.selectAll()} title="Select all">▭</button>
              <span />
              <button
                onClick={() => setShowHistory(true)}
                title={`${historyState?.operations ?? 0} operations · ${historyState?.branchPoints ?? 0} branch points`}
                aria-label="Open version history"
              >
                ◴{historyState?.branchPoints ? <sup>{historyState.branchPoints + 1}</sup> : null}
              </button>
            </div>
          </aside>
        </div>
        {desktop && (
          <Suspense fallback={null}>
            <DesktopStatusbar
              dimensions={doc ? `${doc.width.toLocaleString()} × ${doc.height.toLocaleString()} px` : "No document open"}
              bitDepth={engineState?.bitDepth ?? 8}
              colorSpace={engineState?.colorSpace ?? "sRGB"}
              accelerated={useGL}
              tool={activeToolMeta?.[2] ?? "Tool"}
              shortcut={activeToolMeta ? resolveShortcut(activeToolMeta[0], activeToolMeta[3], workflowPreferences) : ""}
              zoom={Math.round(view.zoom * 100)}
            />
          </Suspense>
        )}
      </section>

      {showExportMenu && (
        <Suspense fallback={null}>
          <ExportPopover
            rasterFormat={exportFormat}
            photoshopFormat={photoshopFormat}
            compatibilityWarnings={photoshopReport?.issues.filter((issue) => issue.severity === "warning").length ?? 0}
            glSupported={glSupported}
            useGL={useGL}
            onRasterFormatChange={setExportFormat}
            onPhotoshopFormatChange={setPhotoshopFormat}
            onClose={() => setShowExportMenu(false)}
            onExportRaster={() => { setShowExportMenu(false); void exportPNG(); }}
            onExportPhotoshop={() => { setShowExportMenu(false); void exportPsd(); }}
            onToggleGL={() => {
              if (!glSupported) return;
              const next = !useGL;
              setUseGL(next);
              studio?.setUseGL(next);
            }}
          />
        </Suspense>
      )}
      {showWorkspaceSettings && (
        <div className="spatial-modal" onMouseDown={() => setShowWorkspaceSettings(false)}>
          <section
            className="spatial-command"
            onMouseDown={(event) => event.stopPropagation()}
            aria-label="Workspace and shortcut settings"
            style={{ width: "min(680px, calc(100vw - 32px))", maxHeight: "min(760px, 82vh)", overflowY: "auto" }}
          >
            <div>
              <span>⚙</span>
              <strong style={{ padding: "0 8px", flex: 1 }}>Workspace & shortcuts</strong>
              <button onClick={() => setShowWorkspaceSettings(false)} aria-label="Close workspace settings">×</button>
            </div>
            <p>Reorder workspace tabs, keep only the tools you use, and assign a conflict-free single-key shortcut.</p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr", alignItems: "stretch", gap: 6, padding: "8px 12px", height: "auto" }}>
              <strong style={{ fontSize: 11 }}>Workspace order</strong>
              {orderedWorkspaces.map(([id, label], index) => (
                <div key={id} style={{ display: "grid", gridTemplateColumns: "1fr auto auto", alignItems: "center", gap: 5, height: "auto", padding: 0, border: 0 }}>
                  <button onClick={() => switchWorkspace(id)} className={workspace === id ? "active" : ""} style={{ textAlign: "left" }}>{label}</button>
                  <button
                    disabled={index === 0}
                    aria-label={`Move ${label} earlier`}
                    onClick={() => setWorkflowPreferences((current) => {
                      const order = [...current.workspaceOrder];
                      [order[index - 1], order[index]] = [order[index], order[index - 1]];
                      return { ...current, workspaceOrder: order };
                    })}
                  >↑</button>
                  <button
                    disabled={index === orderedWorkspaces.length - 1}
                    aria-label={`Move ${label} later`}
                    onClick={() => setWorkflowPreferences((current) => {
                      const order = [...current.workspaceOrder];
                      [order[index], order[index + 1]] = [order[index + 1], order[index]];
                      return { ...current, workspaceOrder: order };
                    })}
                  >↓</button>
                </div>
              ))}
              <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 6, fontSize: 11 }}>
                <span><strong>Contextual properties</strong><br /><small style={{ opacity: 0.62 }}>Hide brush controls when the active tool does not use them.</small></span>
                <input
                  type="checkbox"
                  checked={workflowPreferences.contextualInspector}
                  onChange={(event) => setWorkflowPreferences((current) => ({ ...current, contextualInspector: event.target.checked }))}
                />
              </label>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr", alignItems: "stretch", gap: 5, padding: "10px 12px", height: "auto", borderTop: "1px solid rgba(255,255,255,.1)" }}>
              <strong style={{ fontSize: 11 }}>{workspaces.find(([id]) => id === workspace)?.[1]} tools</strong>
              <small style={{ opacity: 0.62 }}>Visibility and shortcuts are saved on this device.</small>
              {modeTools[workspace].map(([tool, icon, label, fallback]) => {
                const hidden = workflowPreferences.hiddenTools.includes(tool);
                const visibleCount = modeTools[workspace].filter(([candidate]) => !workflowPreferences.hiddenTools.includes(candidate)).length;
                return (
                  <label key={tool} style={{ display: "grid", gridTemplateColumns: "24px minmax(0,1fr) 58px 58px", alignItems: "center", gap: 8, fontSize: 11 }}>
                    <span aria-hidden="true" style={{ textAlign: "center" }}>{icon}</span>
                    <span>{label}</span>
                    <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <input
                        type="checkbox"
                        checked={!hidden}
                        disabled={!hidden && visibleCount <= 1}
                        aria-label={`Show ${label}`}
                        onChange={(event) => {
                          const showing = event.target.checked;
                          setWorkflowPreferences((current) => ({
                            ...current,
                            hiddenTools: showing
                              ? current.hiddenTools.filter((candidate) => candidate !== tool)
                              : [...current.hiddenTools, tool],
                          }));
                          if (!showing && activeTool === tool) {
                            const replacement = modeTools[workspace].find(([candidate]) => candidate !== tool && !workflowPreferences.hiddenTools.includes(candidate));
                            if (replacement) setActiveTool(replacement[0]);
                          }
                        }}
                      />
                      Show
                    </span>
                    <input
                      value={resolveShortcut(tool, fallback, workflowPreferences)}
                      maxLength={1}
                      aria-label={`${label} shortcut`}
                      style={{ width: 42, textAlign: "center", textTransform: "uppercase" }}
                      onChange={(event) => {
                        const shortcut = normalizeShortcut(event.target.value);
                        if (!shortcut) return;
                        const reserved = reservedShortcutReason(shortcut);
                        if (reserved) { notify(reserved); return; }
                        const conflict = shortcutConflict(
                          modeTools[workspace].map(([candidate, , , defaultShortcut]) => [candidate, defaultShortcut] as const),
                          tool,
                          shortcut,
                          workflowPreferences,
                        );
                        if (conflict) {
                          const conflictLabel = modeTools[workspace].find(([candidate]) => candidate === conflict)?.[2] ?? conflict;
                          notify(`${shortcut} is already assigned to ${conflictLabel}`);
                          return;
                        }
                        setWorkflowPreferences((current) => ({
                          ...current,
                          shortcutOverrides: { ...current.shortcutOverrides, [tool]: shortcut },
                        }));
                      }}
                    />
                  </label>
                );
              })}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "10px 12px", height: "auto", borderTop: "1px solid rgba(255,255,255,.1)" }}>
              <button onClick={() => {
                setWorkflowPreferences(initialWorkflowPreferences);
                setWorkspace("edit");
                setActiveTool("brush");
                notify("Workspace defaults restored");
              }}>Restore defaults</button>
              <button onClick={() => setShowWorkspaceSettings(false)}>Done</button>
            </div>
          </section>
        </div>
      )}

      {styleLayer && studio && (
        <Suspense fallback={null}>
          <LayerStyleDialog layer={styleLayer} studio={studio} onClose={() => setStyleLayerId(null)} />
        </Suspense>
      )}

      {showHistory && (
        <div className="spatial-modal" onMouseDown={() => setShowHistory(false)}>
          <section
            className="spatial-command"
            onMouseDown={(event) => event.stopPropagation()}
            aria-label="Version history"
            style={{ width: "min(560px, calc(100vw - 32px))" }}
          >
            <div>
              <span>⑂</span>
              <strong style={{ padding: "0 8px", flex: 1 }}>Version history</strong>
              <small style={{ opacity: 0.6 }}>
                {historyState?.operations ?? 0} operations · {historyState?.branchPoints ?? 0} branch points
              </small>
              <button onClick={() => setShowHistory(false)} aria-label="Close version history">×</button>
            </div>
            <p>Undo, explore another direction, and return to either version. Alternate work is retained as a branch.</p>
            <div role="tree" style={{ maxHeight: "min(56vh, 520px)", overflowY: "auto", padding: "2px 0" }}>
              {historyState?.nodes.map((node) => (
                <button
                  key={node.id}
                  role="treeitem"
                  aria-current={node.isCurrent ? "step" : undefined}
                  aria-selected={node.isCurrent}
                  onClick={() => {
                    if (!studio || node.isCurrent) return;
                    studio.checkoutHistory(node.id);
                    notify(`Restored ${node.label}`);
                  }}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "20px minmax(0,1fr) auto",
                    alignItems: "center",
                    width: "100%",
                    paddingLeft: 10 + node.depth * 16,
                    background: node.isCurrent
                      ? "linear-gradient(90deg,rgba(124,92,231,.3),rgba(35,133,244,.16))"
                      : node.isOnCurrentPath ? "rgba(255,255,255,.055)" : "rgba(255,255,255,.025)",
                    borderColor: node.isCurrent ? "rgba(154,126,255,.55)" : "rgba(255,255,255,.08)",
                    opacity: node.isOnCurrentPath || node.isCurrent ? 1 : 0.72,
                  }}
                >
                  <i aria-hidden="true">{node.isCurrent ? "●" : node.childCount > 1 ? "⑂" : "○"}</i>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "left" }}>
                    {node.label}
                  </span>
                  <small style={{ opacity: 0.58 }}>
                    {node.childCount > 1 ? `${node.childCount} branches` : new Date(node.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </small>
                </button>
              ))}
            </div>
          </section>
        </div>
      )}

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
          role="status"
          aria-live="polite"
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
      <input ref={fileInput} className="visually-hidden" type="file" accept={`.luma,.psd,.psb,image/*,${RAW_EXTENSIONS.map((extension) => `.${extension}`).join(",")}`} onChange={onFileChange} />
      <input ref={psdInput} className="visually-hidden" type="file" accept=".psd,.psb,image/vnd.adobe.photoshop" onChange={onPsdImport} />
      <input ref={projectInput} className="visually-hidden" type="file" accept=".luma,application/x-luma-project" onChange={onProjectImport} />
      <input ref={captureInput} className="visually-hidden" type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/bmp,image/tiff" onChange={onCaptureUpload} />
      <input ref={focusImportInput} className="visually-hidden" type="file" multiple accept="image/png,image/jpeg,image/webp,image/gif,image/bmp,image/tiff" onChange={onFocusImportChange} />
      {dropActive && (
        <div className="studio-drop-overlay" aria-hidden="true">
          <div className="studio-drop-card">
            <strong>Drop to import</strong>
            <span>Images become layers fitted to the canvas · PSD and .luma open as documents</span>
          </div>
        </div>
      )}
      {toast && <div className="spatial-toast" role="status"><span>✓</span>{toast}</div>}
    </main>
  );
}
