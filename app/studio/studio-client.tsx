"use client";
import {mountDrawingDiagnostics} from "../shared/drawing-diagnostics";
import { openCollaboration, previewImage } from "@momentium/live-review";
import { lumaSharedFields, applyLumaSharedFields } from "./collaboration";
import { useTabletWorkspace } from "./use-tablet-workspace";
import { useTabletCanvas } from "./use-tablet-canvas";
import { PwaToast, useInstallPrompt, usePwaUpdate } from "./pwa";
import { isFontFile, saveToLocker, useLockerAvailable, useLockerOpen, useSuiteKit, type LockerFile } from "./suite";
import DownloadConfirmation from "./download-confirmation";
import { canvasPointerIntent } from "./pointer-intent";
import { pointerSamples,wheelZoomFactor } from "../shared/drawing-input";
import { TABLET_VIEWPORT_LIMITS } from "./tablet-input";
import { PHONE_VIEWPORT_LIMITS } from "./phone-workspace";
import BrushToolbox, { type PaintSection } from "./brush-toolbox";
import { BrushMirrorGuides } from "./brush-mirror-guides";
import { brushMirror, type BrushRecipe, type MirrorMode } from "./brush-library";
import { FONT_CHOICES, fontFamilyValue } from "./font-catalog";
import { ShellErrorBoundary } from "./shell-error-boundary";
import { WorkspaceRulers, useWorkspaceRulers } from "./workspace-rulers";
import { captureCustomShape, decodeShapeLibrary, encodeShapeLibrary, DEFAULT_SHAPE_SETTINGS, SHAPE_LIBRARY_KEY, SHAPE_LIBRARY_LIMIT, SHAPE_PRESETS, type CustomShape, type ShapeSettings } from "../engine/shape-library";
import { commitShapeDrag, shapeDragGeometry, shapePresetForTool, SHAPE_TOOLS } from "./shape-tool";
import { vectorPathData } from "../engine/vector-path";
import { DEFAULT_PEN_SNAP, PEN_SNAP_KEY, createPenPath, normalizePenSnap, penMeasurementLabel, resolvePenSnap, type PenSnapSettings, type PenSnapResult } from "./pen-snap";
import { loadBundledFont } from "@/app/engine/bundled-fonts";
import { subscribeTextFontFailures } from "@/app/engine/text-font-resources";

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
import { formTextAssetFromLayer, formTextAssetWithOutlines, serializeFormTextAsset } from "@/app/engine/form-studio-bridge";
import { formSpatialAssetFromLayer, serializeFormSpatialAsset } from "@/app/engine/form-spatial-bridge";
import { DEFAULT_TEXT_SPATIAL } from "@/app/engine/text-3d";
import {
  AiProvenance,
  CapturedBrushAsset,
  type BlendMode,
  Layer,
  NEUTRAL_CURVES,
  NEUTRAL_HSL,
  NEUTRAL_LEVELS,
  NEUTRAL_TONE,
  PathAnchor,
  PathStyle,
  type SmartFilterKind,
  ToneParams,
  Transform,
  cloneCurves,
  documentPointToLayer,
  rotateLayerTransformAround,
  layerCorners,
} from "@/app/engine/document";
import { SMART_FILTER_SPECS } from "@/app/engine/filters";
import type { VectorDeliveryReport } from "@/app/engine/vector-delivery-plan";
import {
  PRO_ADJUSTMENT_LABELS,
  defaultProAdjustment,
  type ProAdjustmentKind,
} from "@/app/engine/pro-adjustments";
import { BrushParams, brushPointerPressure, type ImageBrushMode } from "@/app/engine/brush";
import {
  readRecoveryWorkspace,
  recoveryReadFailure,
  removeRecoveryDocument,
  discardRecoveryDocuments,
  finalizePreviousDiscard,
  writeRecoveryDocument,
  writeRecoveryWorkspace,
} from "@/app/engine/autosave";
import { CoalescedSaveQueue, recoveryCheckpointDelayMs } from "@/app/engine/save-queue";
import { installGlobalDiagnostics, localDiagnostics } from "@/app/engine/diagnostics";
import { createCrashReporterFromEnv } from "@/app/engine/crash-reporting";
import { assertFileSize, assertSafePhotoshopHeader, assertSafeRasterHeader } from "@/app/engine/input-limits";
import { smartContentUnavailableReason, type SmartContentTarget } from "@/app/engine/smart-object-content";
import { exceedsBrowserCanvas } from "@/app/engine/large-documents";
import { RAW_EXTENSIONS, ingestRaw, rawExtension } from "@/app/engine/raw";
import type { RawDevelopSettings } from "@/app/engine/raw-develop";
import { extractAndParseEmbeddedColorProfile } from "@/app/engine/embedded-color-profile";
import { defaultColorProfileRegistry } from "@/app/engine/color-management";
import {
  createDeclarativePlugin,
  parseLumaPluginPackage,
  type LumaPluginPackage,
} from "@/app/engine/plugin-package";
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
  sameDisplayViewport,
  viewportFitScale,
  zoomViewToScale,
  viewportPointToDocument,
  type DisplayViewport,
} from "@/app/engine/viewport";
import {
  developNativeRaw,
  isNativeFilesystemAvailable,
  openNativeAiSignIn,
  openNativeFile,
  readNativePath,
  saveNativeFile,
  saveNativeProject,
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
import { resolveToolKey } from "./tool-shortcuts";
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
import { spatialOperationIdsForTool } from "./spatial-capability-registry";
import { useDocumentView } from "./use-document-view";
import { BATCH_MAX_FILES } from "@/app/engine/batch-limits";
import type { BatchOptions } from "@/app/engine/batch";
import type { ActionPlaybackReport } from "@/app/engine/action-playback";
import {
  cancelNativeClose,
  confirmNativeClose,
  listenForMenuCommands,
  listenForNativeCloseRequest,
  listenForOpenFile,
  publishRecentFiles,
} from "../desktop/native-menu";
import { loadRecentFiles, saveRecentFiles, withRecentFile } from "../desktop/recent-files";
import type { StudioCommand } from "../desktop/menu-model";
import { runDesktopUpdateFlow } from "../desktop/desktop-updater";
import { NativeOpenQueue } from "./native-open-queue";
import { cornerDragTransform, rotationDragTransform, skewDragTransform, constrainedTranslation, isValidTransformQuad, snapTranslation, transformContentBounds } from "./canvas-geometry";
import type { TransformCorner, TransformMode } from "./canvas-geometry";
import {
  planCanvasGesture,
  resolveSelectionMode,
  type CanvasDragDraft,
  type SelectionCombineMode,
} from "./canvas-gesture";
import {
  resolveContextualPanel,
  workspaceForLayer,
  type ContextualPanelId,
} from "./contextual-panel-registry";
import DesktopCanvasHud, { type SpaceDeckFeature } from "./desktop-canvas-hud";
import { hasNativeImageClipboard, readNativeImageClipboard, pixelPasteSource, SELECTION_CLIPBOARD_TYPE, writePixelClipboard } from "./selection-clipboard-events";
import {
  DESKTOP_DEMO_LAYERS,
  desktopRadialOverlayPosition,
  initialStudioPresentation,
  shouldMountLegacyInspector,
  shouldRevealDesktopPassDeck,
  studioUiWorkPolicy,
} from "./desktop-presentation";
import { FrameCoalescer, browserFrameCoalescer } from "./frame-coalescer";
import {
  clampSpaceDeckPosition,
  isEditableTextTarget,
  resolveSpaceDeckContext,
  spaceDeckDimensions,
  spaceDeckCommands,
  togglePinnedSpaceDeck,
  type SpaceDeckCommand,
  type SpaceDeckPoint,
} from "./space-deck-model";
import type { PhotoshopCompatibilityReport } from "@/app/engine/psd";
import {
  ALL_TOOL_IDS as allToolIds,
  MODE_TOOLS as modeTools,
  WORKSPACE_IDS as workspaceIds,
  WORKSPACE_REGISTRY,
  TOOL_REGISTRY,
  type Tool,
  type WorkspaceMode,
} from "./tool-registry";
import {
  cursorRingGeometry,
  dynamicCursorPresentation,
} from "./dynamic-cursor";
import { createCommandRegistry } from "./command-registry";
import { commandForShortcut } from "../desktop/command-shortcuts";
import { createMenuStatePublisher, publishNativeMenuState } from "../desktop/native-menu";
import {
  AppShell,
  AppWindow,
  AppWorkspace,
  ContextualTaskBarRegion,
  DockRegion,
  DocumentAreaRegion,
  MenuBarRegion,
  StatusBarRegion,
  ToolRailRegion,
} from "./app-shell";
import DockManager, { DockPanelContent } from "./dock-manager";
import LayersPanel from "./panels/layers-panel";
import PropertiesPanel from "./panels/properties-panel";
import { ActionsPanel, ChannelsPanel, MeasurePanel, EMPTY_ALPHA_DRAFT, type AlphaChannelDraft } from "./panels/operational-panels";
import { AssetsPanel, StructurePanel } from "./panels/project-panels";
import DocumentPanel from "./panels/document-panel";
import NeuralPanel from "./panels/neural-panel";
import {
  BUILT_IN_WORKSPACES,
  DOCK_LAYOUT_STORAGE_KEY,
  defaultDockLayout,
  openDockPanel,
  sanitizeDockLayout,
  type DockLayout,
} from "./dock-model";
import { STUDIO_PANEL_REGISTRY, type PanelId, type PrimaryPanelId } from "./panel-registry";
import type { TextSelection } from "./panels/type-panel";
import { resolvedDefaultTextStyle, withDefaultTextStyle } from "@/app/engine/text-model";

declare const __LUMA_NATIVE_DESKTOP__: boolean;
const NATIVE_DESKTOP_BUILD = typeof __LUMA_NATIVE_DESKTOP__ !== "undefined" && __LUMA_NATIVE_DESKTOP__;

const ExportPopover = lazy(() => import("./export-popover"));
const PrintExportDialog = lazy(() => import("./print-export-dialog"));
const ToolDock = lazy(() => import("./tool-dock"));
const DesktopStatusbar = lazy(() => import("./desktop-statusbar"));
const StudioTitlebar = lazy(() => import("./studio-titlebar"));
const ContextToolbar = lazy(() => import("./context-toolbar"));
const NewDocumentDialog = lazy(() => import("./new-document-dialog"));
const ExportWarningDialog = lazy(() => import("./export-warning-dialog"));
const VectorPreflightDialog = lazy(() => import("./vector-preflight-dialog"));
const RenameLayerDialog = lazy(() => import("./rename-layer-dialog"));
const PdfImportDialog = lazy(() => import("./pdf-import-dialog"));
const LayerFocusPanel = lazy(() => import("./layer-focus-panel"));
const LayerStyleDialog = lazy(() => import("./layer-style-dialog"));
const RecolorDialog = lazy(() => import("./recolor-dialog"));
const MockupDialog = lazy(() => import("./mockup-dialog"));
const GlyphDialog = lazy(() => import("./glyph-dialog"));
const UpscaleDialog = lazy(() => import("./upscale-dialog"));
const ThumbDialog = lazy(() => import("./thumb-dialog"));
const CampaignPanel = lazy(() => import("./panels/campaign-panel"));
const CurvesEditor = lazy(() => import("./layer-editors").then((module) => ({ default: module.CurvesEditor })));
const LevelsEditor = lazy(() => import("./layer-editors").then((module) => ({ default: module.LevelsEditor })));
const HslEditor = lazy(() => import("./layer-editors").then((module) => ({ default: module.HslEditor })));
const ProAdjustmentEditor = lazy(() => import("./pro-adjustment-editor"));
const TypePanel = lazy(() => import("./panels/type-panel"));
const LetteringObjectPanel = lazy(() => import("./panels/lettering-object-panel"));
const FormMeshPanel = lazy(() => import("./panels/form-mesh-panel"));
import { TEXT_OUTLINE_COMMAND } from "./text-outline-command";
const VectorConstructionPanel = lazy(() => import("./panels/vector-construction-panel"));

type ToneKey = keyof ToneParams;
const workspaces: ReadonlyArray<readonly [WorkspaceMode, string, string]> = WORKSPACE_REGISTRY.map(
  ({ id, label, description }) => [id, label, description] as const,
);
const WORKFLOW_PREFERENCES_KEY = "luma.workflow-preferences.v1";
const LAYER_FOCUS_PREFERENCES_KEY = "luma.layer-focus.v1";
const INSTALLED_PLUGINS_KEY = "luma.installed-plugins.v1";
const CUSTOM_DOCK_WORKSPACES_KEY = "luma.custom-dock-workspaces.v1";
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


export default function SpatialStudio({ desktop = false, tabletMode = false, phoneMode = false }: { desktop?: boolean; tabletMode?: boolean; phoneMode?: boolean }) {
  const { tablet: detectedTablet, phone, drawWithTouch, toggleFingerDrawing } = useTabletWorkspace(phoneMode);
  const tablet = tabletMode || detectedTablet;
  useEffect(()=>{if(window.location.hostname!=="127.0.0.1"||!new URLSearchParams(window.location.search).has("drawingDiagnostics"))return;return mountDrawingDiagnostics(document,'canvas');},[]);
  const [tabletPanel, setTabletPanel] = useState<PanelId | null>(null);
  const [phoneFocus, setPhoneFocus] = useState(false);
  const [downloadConfirmation, setDownloadConfirmation] = useState<{ name: string; resolve: (saved: boolean) => void } | null>(null);
  const initialPresentation = initialStudioPresentation(desktop);
  const pwaUpdate = usePwaUpdate();
  const installPrompt = useInstallPrompt();
  useSuiteKit(!desktop);
  const lockerAvailable = useLockerAvailable();
  const [lockerOffer, setLockerOffer] = useState<{ blob: Blob; name: string; state: "idle" | "saving" | "saved" } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const dynamicCursorRef = useRef<HTMLDivElement>(null);
  const dynamicCursorGlyphRef = useRef<HTMLElement>(null);
  const dynamicCursorReadoutRef = useRef<HTMLOutputElement>(null);
  const lastCursorPointerRef = useRef<{
    clientX: number;
    clientY: number;
    pointerType: string;
    pressure: number;
    shiftKey: boolean;
    altKey: boolean;
    buttons: number;
  } | null>(null);
  const canvasCursorOverrideRef = useRef<"hand" | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const psdInput = useRef<HTMLInputElement>(null);
  const projectInput = useRef<HTMLInputElement>(null);
  const smartContentInput = useRef<HTMLInputElement>(null);
  const smartContentTarget = useRef<SmartContentTarget | null>(null);
  const captureInput = useRef<HTMLInputElement>(null);
  const focusImportInput = useRef<HTMLInputElement>(null);
  const pluginInput = useRef<HTMLInputElement>(null);
  const [studio, setStudio] = useState<Studio | null>(null);
  const [projectSaving, setProjectSaving] = useState(false);
  const projectSavingRef = useRef(false);
  const [showNewDocument, setShowNewDocument] = useState(false);
  const [layerRenameTarget, setLayerRenameTarget] = useState<{ documentId: string; layerId: string; name: string } | null>(null);
  const [startupReady, setStartupReady] = useState(false);
  const startupReadyRef = useRef(false);
  const nativeOpenQueue = useRef<NativeOpenQueue | null>(null);
  const nativeOpeningRef = useRef(false);
  const [nativeOpening, setNativeOpening] = useState(false);
  useEffect(() => {
    // Native panels can leave focus in the webview. Consult synchronous refs,
    // not a render-delayed listener, before allowing tool or edit shortcuts.
    const block = (event: KeyboardEvent) => {
      if (startupReadyRef.current && !projectSavingRef.current && !nativeOpeningRef.current) return;
      // Browser saves await this dialog. It stops key propagation itself;
      // allow its focus/activation keys without reopening editor shortcuts.
      if (startupReadyRef.current && projectSavingRef.current && !nativeOpeningRef.current &&
          event.target instanceof Element && event.target.closest('.download-confirmation[role="dialog"]')) return;
      event.preventDefault(); event.stopImmediatePropagation();
    };
    window.addEventListener("keydown", block, true);
    return () => window.removeEventListener("keydown", block, true);
  }, []);
  const [version, setVersion] = useState(0);
  const forceUpdate = useCallback(() => setVersion((n) => n + 1), []);
  const [loadedPhotoshopReport, setLoadedPhotoshopReport] = useState<PhotoshopCompatibilityReport | null>(null);

  const [workspace, setWorkspace] = useState<WorkspaceMode>(initialPresentation.workspace);
  const [activeTool, setActiveTool] = useState<Tool>(initialPresentation.tool);
  const [inspectorTab, setInspectorTab] = useState<"layers" | "properties" | "ai">("layers");
  const [dockLayout, setDockLayout] = useState<DockLayout>(() => defaultDockLayout());
  const [dockLayoutLoaded, setDockLayoutLoaded] = useState(false);
  const [customDockWorkspaces, setCustomDockWorkspaces] = useState<Record<string, DockLayout>>({});
  const selectInspectorTab = useCallback((tab: "layers" | "properties" | "ai") => {
    const panelId: PrimaryPanelId = tab === "ai" ? "neural" : tab;
    setTabletPanel(panelId);
    if (!tablet) setDockLayout((current) => openDockPanel(current, panelId, STUDIO_PANEL_REGISTRY));
    setInspectorTab(tab);
  }, [tablet]);
  const [nativePanelOverride, setNativePanelOverride] = useState<ContextualPanelId | null>(null);
  const [assetsOpen, setAssetsOpen] = useState(initialPresentation.assetsOpen);
  const [dropActive, setDropActive] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [printTarget, setPrintTarget] = useState<{ id: string; name: string } | null>(null);
  const [vectorTarget, setVectorTarget] = useState<{ report: VectorDeliveryReport; name: string; assertCurrent: () => void } | null>(null);
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
  const [recolorSession, setRecolorSession] = useState<import("../engine/recolor-target").RecolorSession | null>(null);
  useEffect(() => () => { recolorSession?.release(); }, [recolorSession]);
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
  const [brushSymmetry, setBrushSymmetry] = useState<MirrorMode>("none");
  const [brushSymmetrySegments, setBrushSymmetrySegments] = useState(6);
  const [brushSymmetryCenter, setBrushSymmetryCenter] = useState({ x: 0.5, y: 0.5 });
  const [brushColor, setBrushColor] = useState("#ffffff");
  const [activeCapturedBrushId, setActiveCapturedBrushId] = useState<string | null>(null);
  const [capturedBrushMode, setCapturedBrushMode] = useState<ImageBrushMode>("color");
  const [captureSampling, setCaptureSampling] = useState(false);
  const [captureSampleMerged, setCaptureSampleMerged] = useState(true);
  const [captureLive, setCaptureLive] = useState(true);
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
  const [warpRadius, setWarpRadius] = useState(desktop ? 360 : 180);
  const warpHoverRef = useRef<Point | null>(null);
  const warpOverlayRef = useRef<HTMLDivElement>(null);
  const [showRadialOverlay, setShowRadialOverlay] = useState(initialPresentation.showRadialOverlay);
  const [colorSamples, setColorSamples] = useState<Array<Point & { color: string }>>([]);
  const [measurement, setMeasurement] = useState<{ start: Point; end: Point } | null>(null);
  const [retouchSample, setRetouchSample] = useState<{ x: number; y: number } | null>(null);
  const retouchActive = useRef(false);
  const brushGestureRef = useRef<{ pointerId: number; layerId: string; documentId: string; params: BrushParams } | null>(null);
  const quickSelectionRef = useRef<{ pointerId: number; layerId: string; documentId: string; mode: SelectionCombineMode; x: number; y: number } | null>(null);
  const clipboardEventRef = useRef<ClipboardEvent | null>(null);
  const clipboardMarkerRef = useRef("");
  const [feather, setFeather] = useState(0);
  const [wandTolerance, setWandTolerance] = useState(24);
  const [selectionSmooth, setSelectionSmooth] = useState(2);
  const [selectionContrast, setSelectionContrast] = useState(12);
  const [selectionShift, setSelectionShift] = useState(0);
  const [selectionMode, setSelectionMode] = useState<SelectionCombineMode>("replace");
  const [toast, setToast] = useState("");
  const [projectSaveError, setProjectSaveError] = useState<string | null>(null);
  const [layerCompName, setLayerCompName] = useState("Layer Comp");
  const [artboardName, setArtboardName] = useState("Artboard");
  const [textDraft, setTextDraft] = useState("WANDER FARTHER");
  const [textSize, setTextSize] = useState(96);
  const [textSelection, setTextSelection] = useState<TextSelection>({ start: 0, end: 0 });
  const [recordingName, setRecordingName] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [branchMixOpacity, setBranchMixOpacity] = useState(0.5);
  const [branchMixBlend, setBranchMixBlend] = useState<BlendMode>("source-over");
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
  const [showMockups, setShowMockups] = useState(false);
  const [showGlyph, setShowGlyph] = useState(false);
  const [showUpscale, setShowUpscale] = useState(false);
  const [showThumb, setShowThumb] = useState(false);
  const [cutoutProgress, setCutoutProgress] = useState<{ msg: string; pct: number } | null>(null);
  const [batchFiles, setBatchFiles] = useState<File[]>([]);
  const [batchProgress, setBatchProgress] = useState<{ i: number; total: number; name: string } | null>(null);
  const batchAbortRef = useRef<AbortController | null>(null);
  const [batchItems, setBatchItems] = useState<Record<number, { status: "running" | "succeeded" | "failed" | "skipped"; message?: string }>>({});
  useEffect(() => () => { batchAbortRef.current?.abort(); batchAbortRef.current = null; }, []);
  const batchInput = useRef<HTMLInputElement>(null);
  const [selectedActionIdx, setSelectedActionIdx] = useState<number | null>(null);
  const [actionReport, setActionReport] = useState<ActionPlaybackReport | null>(null);
  const [useGL, setUseGL] = useState(false);
  const [saveState, setSaveState] = useState<"saved" | "unsaved" | "saving" | "error">("saved");
  const [pendingCloseDocumentId, setPendingCloseDocumentId] = useState<string | null>(null);
  const [pendingNativeClose, setPendingNativeClose] = useState(false);
  const [nativeCloseBusy, setNativeCloseBusy] = useState(false);
  const nativeCloseBusyRef = useRef(false);
  const unsavedDialogRef = useRef<HTMLElement>(null);
  const [photoshopApproval, setPhotoshopApproval] = useState<{ report: PhotoshopCompatibilityReport; documentId: string; resolve: (proceed: boolean) => void } | null>(null);
  const exportApprovalResolver = useRef<((proceed: boolean) => void) | null>(null);
  useEffect(() => () => { exportApprovalResolver.current?.(false); }, []);
  const [pdfChoice, setPdfChoice] = useState<{ name: string; resolve: (page: import("../engine/pdf-import").PdfImportChoice | null) => void } | null>(null);
  const pdfChoiceResolver = useRef<((page: import("../engine/pdf-import").PdfImportChoice | null) => void) | null>(null);
  useEffect(() => () => { pdfChoiceResolver.current?.(null); pdfChoiceResolver.current = null; }, []);
  const [desktopUpdateInstalling, setDesktopUpdateInstalling] = useState(false);
  const desktopUpdateInstallingRef = useRef(false);
  const [desktopUpdatePhase, setDesktopUpdatePhase] = useState("Preparing update…");
  const [exportFormat, setExportFormat] = useState<"png" | "jpeg" | "webp">("png");
  const [photoshopFormat, setPhotoshopFormat] = useState<"auto" | "source" | "psd" | "psb">("auto");
  const [snapGuides, setSnapGuides] = useState(true);
  const [showGuides, setShowGuides] = useState(true);
  const [showRulers, toggleRulers] = useWorkspaceRulers();
  const glSupported = !!studio && Studio.canUseGL();

  // View transform (zoom + pan). 1.0 = fit-to-stage size. Pan is in stage pixels.
  const openDocuments = studio?.listDocuments() ?? [];
  const activeDocumentId = openDocuments.find(document => document.active)?.id ?? null;
  const reviewSession = useRef<(() => void) | null>(null);
  const reviewDocument = useRef(activeDocumentId);
  useEffect(() => { reviewDocument.current = activeDocumentId; }, [activeDocumentId]);
  useEffect(() => () => { reviewSession.current?.(); }, []);
  const [alphaDraftState, setAlphaDraftState] = useState<{ documentId: string | null; draft: AlphaChannelDraft }>({ documentId: null, draft: EMPTY_ALPHA_DRAFT });
  const alphaDraft = alphaDraftState.documentId === activeDocumentId ? alphaDraftState.draft : EMPTY_ALPHA_DRAFT;
  const updateAlphaDraft = (draft: AlphaChannelDraft) => setAlphaDraftState({ documentId: activeDocumentId, draft });
  const [view, setView] = useDocumentView(activeDocumentId, openDocuments.map(document => document.id), { zoom: initialPresentation.zoom, panX: 0, panY: 0 });
  const viewAnimationRef = useRef<number | null>(null);
  const [displayViewport, setDisplayViewport] = useState<DisplayViewport | null>(null);
  const [touchPaintSection, setTouchPaintSection] = useState<PaintSection>("library");
  const spaceHeld = useRef(false);
  const [passDeckOpen, setPassDeckOpen] = useState(false);
  const [passDeckPinned, setPassDeckPinned] = useState(false);
  const [passDeckPosition, setPassDeckPosition] = useState<SpaceDeckPoint>({ x: 20, y: 20 });
  const spacePointerRef = useRef<SpaceDeckPoint | null>(null);
  const spaceOpenTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const spaceGestureRef = useRef<"idle" | "pending" | "deck" | "panning" | "dismissed">("idle");
  const panDragRef = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null);
  const panFrameRef = useRef<FrameCoalescer<{ panX: number; panY: number }> | null>(null);

  useEffect(() => {
    const coalescer = browserFrameCoalescer<{ panX: number; panY: number }>(
      ({ panX, panY }) => setView((current) => ({ ...current, panX, panY })),
    );
    panFrameRef.current = coalescer;
    return () => {
      coalescer.cancel();
      panFrameRef.current = null;
    };
  }, [setView]);

  // Draft state for pending vector/marquee shapes.
  const [drag, setDrag] = useState<CanvasDragDraft | null>(null);
  const dragRef = useRef<CanvasDragDraft | null>(null);
  const setDragBoth = (d: CanvasDragDraft | null) => { dragRef.current = d; setDrag(d); };
  const [shapeSettings, setShapeSettings] = useState<ShapeSettings>(DEFAULT_SHAPE_SETTINGS);
  const [customShapes, setCustomShapes] = useState<CustomShape[]>([]);
  const [shapeLibraryReady, setShapeLibraryReady] = useState(false);
  useEffect(() => {
    // Restore after hydration; a corrupt library is retained for recovery, not overwritten.
    try {
      const shapes = decodeShapeLibrary(localStorage.getItem(SHAPE_LIBRARY_KEY));
      /* eslint-disable react-hooks/set-state-in-effect */
      setCustomShapes(shapes);
      setShapeLibraryReady(true);
      /* eslint-enable react-hooks/set-state-in-effect */
    } catch (error) { console.warn("Custom shape library could not be restored", error); }
  }, []);
  const currentShapeSettings = { ...shapeSettings, preset: shapePresetForTool(activeTool, shapeSettings.preset) };
  const chooseShapePreset = (preset: string) => {
    setShapeSettings(settings => ({ ...settings, preset }));
    setWorkspace("vector");
    setActiveTool((["rect", "ellipse", "triangle", "polygon", "line"].includes(preset) ? preset : "custom-shape") as Tool);
  };
  const resolvedSelectionMode = useCallback((event: { shiftKey: boolean; altKey: boolean }): SelectionCombineMode => (
    resolveSelectionMode(selectionMode, event)
  ), [selectionMode]);

  // Free-transform drag state (handles overlay).
  const [transformMode, setTransformMode] = useState<TransformMode>("scale");
  const [autoSelectMove, setAutoSelectMove] = useState(true);
  const [showTransformHandles, setShowTransformHandles] = useState(true);
  const [distortDraft, setDistortDraft] = useState<{ layerId: string; documentId: string; quad: Quad } | null>(null);
  const transformFrameRef = useRef<FrameCoalescer<() => void> | null>(null);
  useEffect(() => {
    const frame = browserFrameCoalescer<() => void>((apply) => { apply(); forceUpdate(); });
    transformFrameRef.current = frame;
    return () => { frame.cancel(); transformFrameRef.current = null; };
  }, [studio, forceUpdate]);
  type FTDrag =
    ({ layerId: string; pointerId: number; documentId: string; startTransform: Transform; moved?: boolean } & (
    | { kind: "corner"; corner: TransformCorner; mode: TransformMode; startX: number; startY: number; quad: Quad; hadDraft: boolean }
    | { kind: "rotate"; centerX: number; centerY: number; startAngle: number }));
  const ftDragRef = useRef<FTDrag | null>(null);
  const setFt = useCallback((d: FTDrag | null) => { ftDragRef.current = d; }, []);

  // Pen tool draft. Anchors accumulate; tangent handles are dragged from the
  // current anchor while the mouse is down.
  const [penDraft, setPenDraft] = useState<PathAnchor[]>([]);
  const [penDragging, setPenDragging] = useState<{ index: number } | null>(null);
  const [penSettings, setPenSettings] = useState<PenSnapSettings>(DEFAULT_PEN_SNAP);
  const [penPreview, setPenPreview] = useState<PenSnapResult | null>(null);
  const [penDocumentId, setPenDocumentId] = useState(activeDocumentId);
  if (penDocumentId !== activeDocumentId) {
    setPenDocumentId(activeDocumentId); setPenDraft([]); setPenDragging(null); setPenPreview(null);
  }
  const penFrameRef = useRef<FrameCoalescer<{ result: PenSnapResult; index?: number; documentId: string }> | null>(null);
  useEffect(() => {
    const frame = browserFrameCoalescer<{ result: PenSnapResult; index?: number; documentId: string }>(({ result, index, documentId }) => {
      if (!studio || studio.activeDocumentState().id !== documentId) return;
      setPenPreview(result);
      if (index !== undefined) setPenDraft(draft => draft.map((a, i) => i !== index ? a : {
        ...a, hOut: { dx: result.point.x - a.x, dy: result.point.y - a.y }, hIn: { dx: a.x - result.point.x, dy: a.y - result.point.y },
      }));
    });
    penFrameRef.current = frame;
    return () => { frame.cancel(); penFrameRef.current = null; };
  }, [studio, activeDocumentId, activeTool]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      try { setPenSettings(normalizePenSnap(JSON.parse(localStorage.getItem(PEN_SNAP_KEY) ?? "null"))); } catch { /* Keep safe defaults. */ }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  const updatePenSettings = (patch: Partial<PenSnapSettings>) => {
    const next = normalizePenSnap({ ...penSettings, ...patch });
    setPenSettings(next); setPenPreview(null);
    try { localStorage.setItem(PEN_SNAP_KEY, JSON.stringify(next)); } catch { /* Session controls still work with unavailable storage. */ }
  };
  const [pointDraft, setPointDraft] = useState<Point[]>([]);
  const directAnchorRef = useRef<{ layerId: string; index: number; contour: number; original: PathStyle; next: PathStyle } | null>(null);

  const notify = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(""), 1900);
  }, []);
  useEffect(() => subscribeTextFontFailures((layer, error) => {
    if (studio?.doc.layers.includes(layer)) notify(`${layer.name}: ${error instanceof Error ? error.message : "Font unavailable; preview may use a substitute. Choose an available font before export."}`);
  }), [studio, notify]);
  const persistCustomShapes = (next: CustomShape[]) => {
    if (!shapeLibraryReady) throw new Error("Custom shape storage is unavailable; existing presets were not overwritten");
    localStorage.setItem(SHAPE_LIBRARY_KEY, encodeShapeLibrary(next));
    setCustomShapes(next);
  };
  const removeCustomShape = (id: string) => {
    try {
      persistCustomShapes(customShapes.filter(s => s.id !== id));
      if (shapeSettings.preset === id) setShapeSettings(s => ({ ...s, preset: "star" }));
      notify("Preset removed; shapes already in your documents are unchanged");
    } catch (error) { notify(error instanceof Error ? error.message : "Preset could not be removed"); }
  };

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
        const stored = window.localStorage.getItem(DOCK_LAYOUT_STORAGE_KEY);
        const next = sanitizeDockLayout(stored ? JSON.parse(stored) : null, STUDIO_PANEL_REGISTRY);
        setDockLayout(next);
        const active = next.groups[0]?.activePanelId;
        if (active === "layers" || active === "properties" || active === "neural") {
          setInspectorTab(active === "neural" ? "ai" : active);
        }
      } catch {
        setDockLayout(defaultDockLayout());
      }
      try {
        const storedCustom = JSON.parse(window.localStorage.getItem(CUSTOM_DOCK_WORKSPACES_KEY) ?? "{}") as unknown;
        if (storedCustom && typeof storedCustom === "object" && !Array.isArray(storedCustom)) {
          setCustomDockWorkspaces(Object.fromEntries(Object.entries(storedCustom).flatMap(([name, value]) => {
            if (!name.trim()) return [];
            return [[name, sanitizeDockLayout(value, STUDIO_PANEL_REGISTRY)]];
          })));
        }
      } catch { setCustomDockWorkspaces({}); }
      setDockLayoutLoaded(true);
    }, 0);
    return () => window.clearTimeout(hydration);
  }, []);

  useEffect(() => {
    if (!dockLayoutLoaded) return;
    try {
      window.localStorage.setItem(DOCK_LAYOUT_STORAGE_KEY, JSON.stringify(dockLayout));
    } catch {
      // Docking remains functional when persistence is unavailable.
    }
  }, [dockLayout, dockLayoutLoaded]);

  useEffect(() => {
    if (!dockLayoutLoaded) return;
    try {
      window.localStorage.setItem(CUSTOM_DOCK_WORKSPACES_KEY, JSON.stringify(customDockWorkspaces));
    } catch {
      // Custom layouts are optional; the active layout is still retained.
    }
  }, [customDockWorkspaces, dockLayoutLoaded]);

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
    startupReadyRef.current = false;
    setStartupReady(false);
    let cancelled = false;
    const target = canvasRef.current;
    const s = new Studio(1600, 1067, target);
    const uiFrame = browserFrameCoalescer<boolean>(forceUpdate);
    const unsub = s.subscribe(() => {
      uiFrame.push(true);
      // Target repair remains synchronous; only the expensive React refresh is
      // coalesced. Save, dirty-state and recovery subscribers are unchanged.
      const selected = activeLayerIdRef.current;
      if (!selected || !s.findLayer(selected)) setActiveLayerId(s.doc.layers[0]?.id ?? null);
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
    if (desktop) {
      try {
        const stored = JSON.parse(window.localStorage.getItem(INSTALLED_PLUGINS_KEY) ?? "[]") as unknown;
        if (Array.isArray(stored)) for (const candidate of stored) {
          try {
            const pkg = parseLumaPluginPackage(JSON.stringify(candidate));
            s.registerPlugin(createDeclarativePlugin(pkg));
          } catch (error) {
            console.warn("Skipped an invalid installed plugin", error);
          }
        }
      } catch {
        // A corrupt preference must never prevent the editor from starting.
      }
    }
    setStudio(s);
    (async () => {
      try {
        const recovery = await readRecoveryWorkspace();
        if (cancelled) return;
        if (recovery.length) {
          const ordered = [...recovery.filter((entry) => !entry.active), ...recovery.filter((entry) => entry.active)];
          let project: Awaited<ReturnType<Studio["importProject"]>> | null = null;
          // Recovery checkpoints restore the current document state only.
          // Older checkpoints may still contain a large undo graph; leaving
          // those assets compressed prevents a memory spike before the first
          // frame. Opening a user-selected .luma file below still restores its
          // complete version history.
          for (const entry of ordered) {
            if (cancelled) return;
            project = await s.importProject(entry.blob, { restoreHistory: false, recoveryId: entry.id });
            if (cancelled) return;
            s.restoreDocumentSessionState(s.activeDocumentState().id, {
              nativePath: entry.nativePath,
              dirty: entry.dirty,
            });
          }
          if (!project) throw new Error("Recovery workspace was empty");
          setActiveLayerId(project.doc.layers[0]?.id ?? null);
          notify(recovery.length === 1 ? `Recovered ${project.name}` : `Recovered ${recovery.length} open documents`);
        } else {
          const img = await loadImage(filmstrip[0].src);
          if (cancelled) return;
          const layer = s.openImage(filmstrip[0].name, img);
          if (desktop) {
            s.setLayerProp(layer.id, "name", "Base Layer", "Starter layer named");
            for (const demoLayer of DESKTOP_DEMO_LAYERS) {
              s.addAdjustmentLayer(demoLayer.name, demoLayer.tone);
            }
          }
          setActiveLayerId(layer.id);
        }
        // Consume restored Blob payloads before rewriting their source index.
        await finalizePreviousDiscard().catch(error => console.warn("Discard cleanup deferred", error));
      } catch (error) {
        if (cancelled) return;
        setSaveState("error");
        notify(error instanceof Error ? `Recovery needs attention: ${error.message}` : "Recovery needs attention");
        if (s.doc.layers.length) return;
        const img = await loadImage(filmstrip[0].src);
        if (cancelled) return;
        const layer = s.openImage(filmstrip[0].name, img);
        if (desktop) {
          s.setLayerProp(layer.id, "name", "Base Layer", "Starter layer named");
          for (const demoLayer of DESKTOP_DEMO_LAYERS) {
            s.addAdjustmentLayer(demoLayer.name, demoLayer.tone);
          }
        }
        setActiveLayerId(layer.id);
      } finally {
        if (!cancelled) { startupReadyRef.current = true; setStartupReady(true); }
      }
    })();
    return () => {
      cancelled = true;
      unsub();
      uiFrame.cancel();
      s.dispose();
      const host = window as unknown as { luma?: LumaAPI };
      if (host.luma === api) delete host.luma;
    };
  }, [desktop, forceUpdate, notify, setActiveLayerId]);

  const doc = studio?.doc;
  const bindDisplayCanvas = useCallback((canvas: HTMLCanvasElement | null) => {
    canvasRef.current = canvas;
    if (canvas) studio?.attachDisplayTarget(canvas);
  }, [studio]);
  const fitScale = doc && displayViewport ? viewportFitScale(doc.width, doc.height, displayViewport.width * displayViewport.cssScale, displayViewport.height * displayViewport.cssScale) : 1;
  const zoomPercent = Number((view.zoom * fitScale * 100).toFixed(2));
  const setZoomPercent = (percent: number) => setView(current => zoomViewToScale(current, fitScale, percent / 100));
  const layers: Layer[] = doc?.layers ?? [];
  const selectedLayerIds = studio?.layerSelection(activeLayerId).ids ?? [];
  const resolvedFocusState = reconcileLayerFocus(focusState, doc, activeDocumentId);
  const activeLayer = layers.find((l) => l.id === activeLayerId) ?? layers[0] ?? null;
  const changeTransformMode = (mode: TransformMode) => {
    if (distortDraft || ftDragRef.current) return;
    setTransformMode(mode);
    setShowTransformHandles(true);
  };
  const applyDistortion = () => {
    if (!studio || !distortDraft || studio.activeDocumentState().id !== distortDraft.documentId) return;
    transformFrameRef.current?.flush();
    try {
      if (!studio.distortLayer(distortDraft.layerId, distortDraft.quad)) {
        notify(studio.distortionUnavailableReason(distortDraft.layerId) ?? "This distortion cannot be applied safely");
        return;
      }
      setDistortDraft(null);
      notify("Distortion applied · Undo restores the original");
    } catch (error) { notify(error instanceof Error ? error.message : "Distortion failed"); }
  };
  const cancelTransformGesture = () => {
    transformFrameRef.current?.cancel();
    const f = ftDragRef.current;
    if (f && studio?.activeDocumentState().id === f.documentId) studio.cancelLiveTransform(f.layerId);
    const move = dragRef.current;
    if (move?.kind === "move-layer" && move.layerId) studio?.cancelLiveTransform(move.layerId);
    setFt(null);
    setDragBoth(null);
    setDistortDraft(null);
  };
  const transformContext = `${activeDocumentId}:${activeLayerId}:${activeTool}`;
  const [previousTransformContext, setPreviousTransformContext] = useState(transformContext);
  if (previousTransformContext !== transformContext) {
    setPreviousTransformContext(transformContext);
    setDistortDraft(null);
  }
  useEffect(() => {
    transformFrameRef.current?.cancel();
    const f = ftDragRef.current;
    if (f && studio?.activeDocumentState().id === f.documentId) studio.cancelLiveTransform(f.layerId);
    setFt(null);
  }, [activeDocumentId, activeLayerId, activeTool, setFt, studio]);
  const activeTextDefaults = activeLayer?.kind === "text" && activeLayer.text
    ? resolvedDefaultTextStyle(activeLayer.text)
    : null;
  const contextualPanel = resolveContextualPanel({
    override: nativePanelOverride,
    inspector: "properties",
    layer: activeLayer,
    workspace,
    hasSelection: Boolean(doc?.selection),
    maskFocused: resolvedFocusState.scope?.target === "mask",
  });
  const identityReference = layers.find((layer) => layer.identityReference) ?? null;

  // Selecting an existing text layer has to load its real content into the
  // editable field — without this, the field kept showing whatever was last
  // typed (or the placeholder default) instead of the layer you just clicked,
  // which is what made an existing layer's text look uneditable.
  //
  // Adjusted during render rather than in an effect (React's own recipe for
  // "reset state when a prop changes"): an effect would paint one frame of
  // stale text before firing, and would need this same layer-id tracking to
  // avoid re-syncing away every keystroke anyway, since liveUpdateText below
  // writes into this same layer on every keystroke.
  const [textDraftLayerId, setTextDraftLayerId] = useState<string | null>(null);
  // Normalized to the same null-or-string shape on both sides: comparing the
  // raw `string | undefined` from activeLayer?.id against this `string | null`
  // state meant "no active layer" (undefined) never equalled its own stored
  // value (null), so the branch re-ran and called setState every render —
  // React caught it as an infinite loop before this was ever seen live.
  const activeLayerIdOrNull = activeLayer?.id ?? null;
  if (activeLayerIdOrNull !== textDraftLayerId) {
    setTextDraftLayerId(activeLayerIdOrNull);
    setTextSelection({ start: 0, end: 0 });
    if (activeLayer?.kind === "text" && activeLayer.text) setTextDraft(activeLayer.text.text);
  }
  const positionWarpOverlay = (point: Point | null) => {
    warpHoverRef.current = point;
    if (!doc || !warpOverlayRef.current) return;
    const position = desktopRadialOverlayPosition({
      point,
      documentWidth: doc.width,
      documentHeight: doc.height,
      radius: warpRadius,
    });
    warpOverlayRef.current.style.left = position.left;
    warpOverlayRef.current.style.top = position.top;
  };
  const documentWidth = doc?.width;
  const documentHeight = doc?.height;
  useEffect(() => {
    if (!documentWidth || !documentHeight || !warpOverlayRef.current) return;
    const position = desktopRadialOverlayPosition({
      point: warpHoverRef.current,
      documentWidth,
      documentHeight,
      radius: warpRadius,
    });
    warpOverlayRef.current.style.left = position.left;
    warpOverlayRef.current.style.top = position.top;
  }, [documentWidth, documentHeight, warpRadius]);
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
  }, [view, setView]);

  useEffect(() => () => {
    if (viewAnimationRef.current !== null) cancelAnimationFrame(viewAnimationRef.current);
  }, [activeDocumentId]);

  const enterFocusMode = (layerId: string, target: FocusEditTarget = "pixels") => {
    if (!doc || !activeDocumentId) return;
    const layer = doc.layers.find((candidate) => candidate.id === layerId);
    if (!layer) return;
    const stage = stageRef.current?.getBoundingClientRect();
    const next = enterLayerFocus(resolvedFocusState, doc, activeDocumentId, layerId, view, target);
    setFocusState(next);
    setActiveLayerId(layerId);
    setAssetsOpen(true);
    if (target === "mask" && (layer.maskSurface || layer.mask)) {
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
      // Re-checked on every call, not just at effect setup: ResizeObserver
      // fires asynchronously, so a workspace/tool switch that swaps out the
      // canvas element can leave a stale callback queued. Without this guard
      // it dereferenced a null ref and crashed the whole React tree.
      const canvas = canvasRef.current;
      if (!canvas) return;
      studio.attachDisplayTarget(canvas);
      const canvasRect = canvas.getBoundingClientRect();
      if (canvasRect.width <= 0 || canvasRect.height <= 0) return;
      const next = calculateDisplayViewport(
        doc.width,
        doc.height,
        canvasRect.width,
        canvasRect.height,
        view,
        window.devicePixelRatio,
        phone ? PHONE_VIEWPORT_LIMITS : tablet ? TABLET_VIEWPORT_LIMITS : undefined,
      );
      setDisplayViewport(current => sameDisplayViewport(current, next) ? current : next);
      studio.setVirtualViewport(next);
    };
    updatePlan();
    const observer = new ResizeObserver(updatePlan);
    observer.observe(stageRef.current);
    return () => observer.disconnect();
  }, [studio, doc, view, tablet, phone]);

  const eventToDoc = useCallback((e: {
    clientX: number;
    clientY: number;
    pressure?: number;
    pointerType?: string;
    timeStamp?: number;
    tiltX?: number;
    tiltY?: number;
    azimuthAngle?: number;
  }, rectOverride?: DOMRect) => {
    const canvas = canvasRef.current;
    if (!canvas || !doc) return { x: 0, y: 0, p: 0.5 };
    const rect = rectOverride ?? canvas.getBoundingClientRect();
    const viewport = displayViewport ?? calculateDisplayViewport(
      doc.width,
      doc.height,
      rect.width,
      rect.height,
      view,
      window.devicePixelRatio,
      phone ? PHONE_VIEWPORT_LIMITS : tablet ? TABLET_VIEWPORT_LIMITS : undefined,
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
    const p = brushPointerPressure(e);
    const tiltX = e.tiltX ?? 0;
    const tiltY = e.tiltY ?? 0;
    const azimuth = Number.isFinite(e.azimuthAngle)
      ? e.azimuthAngle
      : (tiltX || tiltY ? Math.atan2(tiltY, tiltX) : 0);
    return { x, y, p, tiltX, tiltY, azimuth, time: e.timeStamp };
  }, [doc, displayViewport, view, tablet, phone]);

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
    symmetry: doc ? brushMirror({ mode: brushSymmetry, segments: brushSymmetrySegments, ...brushSymmetryCenter }, doc.width, doc.height) : undefined,
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
  const transformDragTool = ["gradient", "crop", "straighten", "content-move", "radial-warp", "ruler"].includes(activeTool);
  const quadTool = activeTool === "perspective-crop" || activeTool === "perspective-warp";
  const moveTool = activeTool === "move" || activeTool === "path-select";

  const cursorUnavailableReason = (() => {
    if (paintingTool) {
      if (!activeLayer) return "No layer";
      if (activeLayer.locked) return "Layer locked";
      if (activeTool !== "mask-add" && activeTool !== "mask-remove" && activeLayer.kind !== "raster") return "Select raster";
    }
    if (retouchTool) {
      if (!activeLayer) return "No layer";
      if (activeLayer.locked) return "Layer locked";
      if (activeLayer.kind !== "raster" || !activeLayer.surface) return "Select raster";
    }
    if ((wandTool || activeTool === "sel-sam") && activeLayer?.kind !== "raster") return "Select raster";
    if ((activeTool === "pattern" || activeTool === "fill" || activeTool === "perspective-warp") && activeLayer?.kind !== "raster") return "Select raster";
    if (activeTool === "direct-select" && !activeLayer?.path) return "Select path";
    if (activeTool === "capture-brush" && captureSampling && !captureSampleMerged && !activeLayer) return "No source";
    return null;
  })();
  const cursorNeedsSourceSample = retouchTool
    && (retouchMode === "clone" || retouchMode === "heal" || retouchMode === "patch")
    && !retouchSample
    && !cursorUnavailableReason;
  const cursorDocumentSize = activeTool === "capture-brush" && captureSampling ? captureRadius * 2 : brushSize;
  const cursorBasePresentation = dynamicCursorPresentation(activeTool, {
    selectionMode,
    cue: activeTool === "pen" && penPreview?.label ? "snap" : undefined,
    captureSampling: activeTool === "capture-brush" && captureSampling,
    unavailableReason: cursorUnavailableReason,
    needsSourceSample: cursorNeedsSourceSample,
    size: cursorDocumentSize,
    hardness: activeTool === "pencil" ? 1 : hardness,
    roundness: activeTool === "pencil" ? 1 : brushRoundness,
    angle: brushAngle,
    color: activeTool === "erase" || activeTool === "mask-remove" ? "#ff6b7a" : brushColor,
  });

  const updateDynamicCursor = (pointer: {
    clientX: number;
    clientY: number;
    pointerType: string;
    pressure: number;
    shiftKey: boolean;
    altKey: boolean;
    buttons: number;
  }) => {
    lastCursorPointerRef.current = pointer;
    const element = dynamicCursorRef.current;
    const canvas = canvasRef.current;
    if (!element || !canvas) return;
    // Fingers have no hover cursor. Avoid layout reads and a dozen style writes
    // for every touch sample; pen and mouse keep their precise feedback.
    if (pointer.pointerType === "touch") {
      element.dataset.visible = "false";
      lastCursorPointerRef.current = null;
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const presentation = dynamicCursorPresentation(activeTool, {
      selectionMode,
      cue: activeTool === "pen" && penPreview?.label ? "snap" : undefined,
      shiftKey: pointer.shiftKey,
      altKey: pointer.altKey,
      captureSampling: activeTool === "capture-brush" && captureSampling,
      unavailableReason: cursorUnavailableReason,
      needsSourceSample: cursorNeedsSourceSample,
      size: cursorDocumentSize,
      hardness: activeTool === "pencil" ? 1 : hardness,
      roundness: activeTool === "pencil" ? 1 : brushRoundness,
      angle: brushAngle,
      color: activeTool === "erase" || activeTool === "mask-remove" ? "#ff6b7a" : brushColor,
    });
    const pressure = pointer.pointerType === "pen" ? pointer.pressure : undefined;
    const geometry = cursorRingGeometry({
      documentSize: presentation.size,
      viewportDocumentWidth: displayViewport?.width ?? doc?.width ?? 1,
      canvasCssWidth: rect.width,
      pressure,
      pressureSize: pressureSize && presentation.kind === "brush",
    });
    const override = canvasCursorOverrideRef.current;
    element.dataset.visible = "true";
    element.dataset.kind = override ?? presentation.kind;
    element.dataset.status = presentation.status;
    element.dataset.pressed = pointer.buttons ? "true" : "false";
    element.dataset.clipped = geometry.clipped ? "true" : "false";
    element.style.transform = `translate3d(${pointer.clientX - rect.left}px, ${pointer.clientY - rect.top}px, 0)`;
    element.style.setProperty("--cursor-size", `${geometry.displayDiameter}px`);
    element.style.setProperty("--cursor-hardness", `${Math.max(4, geometry.displayDiameter * presentation.hardness)}px`);
    element.style.setProperty("--cursor-roundness", String(presentation.roundness));
    element.style.setProperty("--cursor-angle", `${presentation.angle}deg`);
    element.style.setProperty("--cursor-color", presentation.color);
    const glyph = dynamicCursorGlyphRef.current;
    const readout = dynamicCursorReadoutRef.current;
    if (glyph) glyph.textContent = override === "hand" ? "✋" : presentation.glyph;
    if (readout) readout.textContent = override === "hand" ? "Pan canvas" : presentation.readout;
  };

  const updateDynamicCursorFromEvent = (event: ReactPointerEvent<HTMLCanvasElement>) => updateDynamicCursor({
    clientX: event.clientX,
    clientY: event.clientY,
    pointerType: event.pointerType,
    pressure: event.pressure,
    shiftKey: event.shiftKey,
    altKey: event.altKey,
    buttons: event.buttons,
  });

  const setCanvasCursorOverride = (override: "hand" | null, pressed = false) => {
    canvasCursorOverrideRef.current = override;
    const pointer = lastCursorPointerRef.current;
    if (pointer) updateDynamicCursor({ ...pointer, buttons: pressed ? Math.max(1, pointer.buttons) : pointer.buttons });
  };

  const hideDynamicCursor = () => {
    lastCursorPointerRef.current = null;
    if (dynamicCursorRef.current) dynamicCursorRef.current.dataset.visible = "false";
  };

  // Settings, zoom, layer validity, and tool changes should update the cursor
  // even when the pointer itself has not moved. This is a direct DOM refresh,
  // not a React state update, so it cannot turn pointer motion into app renders.
  useEffect(() => {
    const pointer = lastCursorPointerRef.current;
    if (pointer) updateDynamicCursor(pointer);
  });

  const snapLayerTranslation = (layer: Layer, tx: number, ty: number) => (
    doc && snapGuides ? snapTranslation(layer, doc, (canvasRef.current?.getBoundingClientRect().width ?? doc.width) / doc.width, tx, ty) : { tx, ty }
  );
  const snapPenPoint = (point: Point, modifiers: { shiftKey: boolean; altKey: boolean }, handleOrigin?: Point) => resolvePenSnap({
    point, anchors: penDraft, width: studio!.doc.width, height: studio!.doc.height, guides: studio!.doc.guides,
    zoom: (canvasRef.current?.getBoundingClientRect().width || studio!.doc.width) / studio!.doc.width,
    settings: penSettings, shiftKey: modifiers.shiftKey, altKey: modifiers.altKey, handleOrigin,
  });

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
    if (brushGestureRef.current) return;
    if (!studio) return;
    const intent = canvasPointerIntent(e.button, e.pointerType, spaceHeld.current);
    if (intent === "ignore") return;
    updateDynamicCursorFromEvent(e);
    if (passDeckOpen && !passDeckPinned && !spaceHeld.current) {
      setPassDeckOpen(false);
      spaceGestureRef.current = "idle";
    }
    // Middle mouse or space+left = pan.
    if (intent === "pan") {
      if (spaceOpenTimerRef.current) clearTimeout(spaceOpenTimerRef.current);
      spaceOpenTimerRef.current = null;
      spaceGestureRef.current = "panning";
      if (!passDeckPinned) setPassDeckOpen(false);
      (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
      panDragRef.current = { startX: e.clientX, startY: e.clientY, panX: view.panX, panY: view.panY };
      setCanvasCursorOverride("hand", true);
      return;
    }
    (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
    const p = eventToDoc(e);

    if (activeTool === "capture-brush" && captureSampling) {
      const asset = studio.captureBrushFromDocument(p.x, p.y, captureRadius, {
        name: captureSampleMerged ? "Merged canvas capture" : `${activeLayer?.name ?? "Layer"} capture`,
        sourceLayerId: captureSampleMerged ? undefined : activeLayer?.id,
        live: captureLive,
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
      if (activeTool === "capture-brush" && activeCapturedBrushId && studio.refreshCapturedBrush(activeCapturedBrushId)) {
        params.imageTip = studio.capturedBrushTip(activeCapturedBrushId, capturedBrushMode) ?? params.imageTip;
      }
      if ((params.mode === "mask-add" || params.mode === "mask-remove") && activeLayer.locked) {
        notify("Unlock the layer before editing its mask"); return;
      }
      if ((params.mode === "paint" || params.mode === "erase") && activeLayer.kind !== "raster") {
        notify("Brush needs a raster layer"); return;
      }
      try {
        if (studio.beginStroke(activeLayer.id, params, p)) {
          brushGestureRef.current = { pointerId: e.pointerId, layerId: activeLayer.id, documentId: studio.activeDocumentState().id, params };
        } else notify("Select an unlocked paintable layer");
      } catch (error) { notify(error instanceof Error ? error.message : "Brush stroke could not start"); }
      return;
    }

    if (activeTool === "pattern" || activeTool === "fill") {
      if (!activeLayer || activeLayer.kind !== "raster") { notify("Fill needs a raster layer"); return; }
      // The engine owns the reason: patternFill returns one false for a document
      // past the canvas ceiling, a locked layer, a 3D layer and a layer with no
      // bitmap, and guessing here produced "Layer is locked" for all four.
      if (activeTool === "pattern") {
        const refusal = studio.generatedFillRefusal(activeLayer.id);
        if (refusal) { notify(refusal); return; }
        notify(studio.patternFill(activeLayer.id, patternKind, brushColor, secondaryColor, patternScale) ? "Pattern applied" : "Pattern could not be applied");
        return;
      }
      if (activeLayer.locked) { notify("Layer is locked"); return; }
      studio.fillLayer(activeLayer.id, brushColor, brushOpacity);
      notify("Selection filled");
      return;
    }
    if (marqueeTool || vectorDragTool || transformDragTool) {
      setDragBoth({ x0: p.x, y0: p.y, x1: p.x, y1: p.y, kind: activeTool as CanvasDragDraft["kind"], shiftKey: e.shiftKey, altKey: e.altKey,
        ...(SHAPE_TOOLS.has(activeTool) ? { shapeGesture: { documentId: studio.activeDocumentState().id, settings: { ...currentShapeSettings }, fill: brushColor, custom: customShapes.find(s => s.id === currentShapeSettings.preset) } } : {}),
      });
      return;
    }
    if (lassoTool) {
      setDragBoth({ x0: p.x, y0: p.y, x1: p.x, y1: p.y, kind: "sel-lasso", path: [{ x: p.x, y: p.y }] });
      return;
    }
    if (wandTool) {
      if (!activeLayer || activeLayer.kind !== "raster") { notify("Wand needs a raster layer"); return; }
      try {
        const mode = resolvedSelectionMode(e);
        if (activeTool === "sel-quick") studio.beginSelectionGesture(mode);
        studio.selectByColor(activeLayer.id, p.x, p.y, activeTool === "sel-quick" ? Math.max(6, wandTolerance / 2) : wandTolerance, mode, activeTool === "sel-quick" ? true : !e.metaKey);
        if (activeTool === "sel-quick") quickSelectionRef.current = { pointerId: e.pointerId, layerId: activeLayer.id, documentId: studio.activeDocumentState().id, mode: mode === "replace" ? "add" : mode, x: p.x, y: p.y };
      } catch (error) { studio.cancelSelectionGesture(); quickSelectionRef.current = null; notify(error instanceof Error ? error.message : "Selection failed safely"); return; }
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
        // Both refuse silently — past the canvas ceiling, on a locked or 3D
        // layer, or for a self-intersecting quad — and the success message used
        // to be printed regardless, so a refusal read as a completed edit. The
        // engine names the reason so this cannot drift from what it enforces.
        const quad = next as unknown as Quad;
        const crop = activeTool === "perspective-crop";
        const label = crop ? "Perspective crop" : "Perspective warp";
        const refusal = crop
          ? studio.perspectiveCropRefusal(quad)
          : studio.perspectiveWarpRefusal(activeLayer!.id, quad);
        setPointDraft([]);
        if (refusal) { notify(refusal); return; }
        const applied = crop
          ? studio.perspectiveCrop(quad) !== null
          : studio.perspectiveWarpLayer(activeLayer!.id, quad);
        notify(applied ? `${label} applied` : `${label} could not be applied`);
      } else {
        setPointDraft(next);
        notify(`Corner ${next.length}/4 placed`);
      }
      return;
    }
    if (activeTool === "sel-sam") {
      if (neural) return;
      if (!activeLayer || activeLayer.kind !== "raster") { notify("SAM needs a raster layer"); return; }
      const mode = resolvedSelectionMode(e);
      setNeural({ msg: "SAM click", pct: 0 });
      (async () => {
        try {
          const res = await studio.samClickSelect(activeLayer.id, p.x, p.y, mode, (msg, pct) => setNeural({ msg, pct }));
          setNeural(null);
          notify(res.used === "sam" ? "SAM select" : `Smart Select unavailable; used Magic Wand. ${res.reason ?? ""}`);
        } catch (error) {
          setNeural(null);
          notify(error instanceof Error ? error.message : "SAM failed");
        }
      })();
      return;
    }
    if (activeTool === "pen") {
      penFrameRef.current?.cancel();
      const snapped = snapPenPoint(p, e);
      if (snapped.closes) { commitPenPath(true); return; }
      if (penDraft.length >= 4096) { notify("Path anchor limit reached; finish this path first"); return; }
      const anchor: PathAnchor = { ...snapped.point, hIn: { dx: 0, dy: 0 }, hOut: { dx: 0, dy: 0 } };
      setPenDraft((d) => [...d, anchor]);
      setPenPreview(snapped);
      setPenDragging({ index: penDraft.length });
      return;
    }
    if (["text", "vertical-text", "path-text", "type-mask"].includes(activeTool)) {
      if (activeTool === "type-mask") {
        const sourceDocument = studio.doc;
        void loadBundledFont("Lato", 700).then(() => {
          if (studio.doc !== sourceDocument) return;
          studio.selectTextMask(textDraft, p.x, p.y, `700 ${textSize}px "Lato", sans-serif`, false);
          notify("Type selection created");
        }).catch(() => notify("Bundled font could not load; selection was not changed"));
        return;
      }
      else if (activeTool === "path-text") {
        if (!activeLayer?.path) { notify("Select a path layer first"); return; }
        const local = documentPointToLayer(activeLayer.transform, p.x, p.y);
        if (!local) return;
        const layer = studio.addTextLayer(
          textDraft,
          { x: local.x, y: local.y, layout: "path", path: activeLayer.path, color: brushColor, font: `700 ${textSize}px "Lato", sans-serif` },
          activeLayer.transform,
        );
        setActiveLayerId(layer.id);
      } else {
        const layer = studio.addTextLayer(textDraft, { x: p.x, y: p.y, layout: activeTool === "vertical-text" ? "vertical" : "point", color: brushColor, font: `700 ${textSize}px "Lato", sans-serif` });
        setActiveLayerId(layer.id);
      }
      notify("Text added");
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
      if (activeLayer.locked) { notify("Unlock this layer before editing its anchors"); return; }
      if (activeLayer.path.booleanSource || activeLayer.path.offsetSource) { notify("Expand the generated shape to editable contours first"); return; }
      const local = documentPointToLayer(activeLayer.transform, p.x, p.y);
      if (!local) return;
      let index = 0;
      let contour = 0;
      let distance = Infinity;
      [activeLayer.path, ...(activeLayer.path.contours ?? [])].forEach((part, partIndex) => part.anchors.forEach((anchor, candidate) => {
        const d = Math.hypot(anchor.x - local.x, anchor.y - local.y);
        if (d < distance) { distance = d; index = candidate; contour = partIndex; }
      }));
      if (!Number.isFinite(distance)) return;
      const original = structuredClone(activeLayer.path);
      directAnchorRef.current = { layerId: activeLayer.id, index, contour, original, next: structuredClone(original) };
      return;
    }
    if (moveTool && doc) {
      if (distortDraft) { notify("Apply or cancel the Distort draft first"); return; }
      const hit = autoSelectMove ? hitTestEditableLayer(doc, p.x, p.y, resolvedFocusState.scope?.layerId) : null;
      const interactionLayer = hit ?? activeLayer;
      if (!interactionLayer) return;
      if (hit && hit.id !== activeLayerId) setActiveLayerId(hit.id);
      setDragBoth({
        x0: p.x,
        y0: p.y,
        x1: p.x,
        y1: p.y,
        kind: "move-layer",
        layerId: interactionLayer.id,
        moveStart: { tx: interactionLayer.transform.tx, ty: interactionLayer.transform.ty },
      });
      return;
    }
  };

  const commitPenPath = useCallback((closeIt: boolean) => {
    penFrameRef.current?.cancel();
    setPenPreview(null);
    if (studio && studio.activeDocumentState().id !== penDocumentId) { setPenDraft([]); setPenDragging(null); return; }
    if (!studio || penDraft.length < 2) { setPenDraft([]); setPenDragging(null); return; }
    const path = createPenPath(penDraft, closeIt, brushColor);
    try { setActiveLayerId(studio.addPathLayer(path).id); }
    catch (error) { notify(error instanceof Error ? error.message : "Path could not be created; draft retained"); return; }
    setPenDraft([]);
    setPenDragging(null);
    notify(closeIt ? "Path closed" : "Path added");
  }, [studio, penDraft, brushColor, notify, setActiveLayerId, penDocumentId]);

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!studio) return;
    updateDynamicCursorFromEvent(e);
    // A captured paint gesture wins over tool/layer changes until release.
    if (brushGestureRef.current) {
      const gesture = brushGestureRef.current;
      if (gesture.pointerId !== e.pointerId) return;
      if (gesture.documentId !== studio.activeDocumentState().id) { studio.cancelStroke(); brushGestureRef.current = null; return; }
      if (e.buttons === 0) return;
      const source = e.nativeEvent;
      const points = pointerSamples(source);
      const rect = canvasRef.current?.getBoundingClientRect();
      try {
        for (const point of points) studio.paintTo(gesture.layerId, gesture.params, eventToDoc({
          clientX: point.clientX, clientY: point.clientY, pressure: point.pressure,
          tiltX: point.tiltX, tiltY: point.tiltY, azimuthAngle: point.azimuthAngle,
          timeStamp: point.timeStamp, pointerType: point.pointerType || e.pointerType,
        }, rect));
      } catch (error) { brushGestureRef.current = null; notify(error instanceof Error ? error.message : "Stroke cancelled safely"); }
      return;
    }
    const stageRect = stageRef.current?.getBoundingClientRect();
    if (stageRect) spacePointerRef.current = { x: e.clientX - stageRect.left, y: e.clientY - stageRect.top };
    if (activeTool === "radial-warp") positionWarpOverlay(eventToDoc(e));
    if (panDragRef.current) {
      const dx = e.clientX - panDragRef.current.startX;
      const dy = e.clientY - panDragRef.current.startY;
      const next = { panX: panDragRef.current.panX + dx, panY: panDragRef.current.panY + dy };
      if (panFrameRef.current) panFrameRef.current.push(next);
      else setView((current) => ({ ...current, ...next }));
      return;
    }
    if (activeTool === "capture-brush" && captureSampling) {
      setCaptureHover(eventToDoc(e));
      return;
    }
    if (activeTool === "pen") {
      const p = eventToDoc(e);
      const index = penDragging?.index;
      const origin = index !== undefined ? penDraft[index] : undefined;
      const result = snapPenPoint(p, e, origin);
      penFrameRef.current?.push({ result, index, documentId: studio.activeDocumentState().id });
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
      const part = edit.contour === 0 ? next : next.contours?.[edit.contour - 1];
      if (!part?.anchors[edit.index]) return;
      part.anchors[edit.index] = { ...part.anchors[edit.index], x: local.x, y: local.y };
      edit.next = next;
      studio.liveUpdatePath(edit.layerId, next);
      return;
    }
    if (quickSelectionRef.current && e.buttons !== 0) {
      const gesture = quickSelectionRef.current;
      if (gesture.pointerId !== e.pointerId) return;
      if (gesture.documentId !== studio.activeDocumentState().id || activeTool !== "sel-quick") { studio.cancelSelectionGesture(); quickSelectionRef.current = null; return; }
      const p = eventToDoc(e);
      if (Math.hypot(p.x - gesture.x, p.y - gesture.y) < 4) return;
      try {
        studio.selectByColor(gesture.layerId, p.x, p.y, Math.max(6, wandTolerance / 2), gesture.mode, true);
        gesture.x = p.x; gesture.y = p.y;
      } catch (error) { studio.cancelSelectionGesture(); quickSelectionRef.current = null; notify(error instanceof Error ? error.message : "Selection cancelled"); }
      return;
    }
    const d = dragRef.current;
    if (retouchTool && retouchActive.current && e.buttons !== 0 && activeLayer) {
      const rect=canvasRef.current?.getBoundingClientRect();
      for (const event of pointerSamples(e.nativeEvent)) studio.retouchTo(activeLayer.id, eventToDoc(event,rect));
      return;
    }
    if (!d) return;
    const p = eventToDoc(e);
    const nextPath = d.kind === "sel-lasso" && d.path ? [...d.path, { x: p.x, y: p.y }] : d.path;
    const next: CanvasDragDraft = { ...d, x1: p.x, y1: p.y, path: nextPath, shiftKey: e.shiftKey, altKey: e.altKey };
    const draggedLayer = d.layerId ? studio.findLayer(d.layerId) : null;
    if (d.kind === "move-layer" && draggedLayer && d.moveStart) {
      if (d.x1 === d.x0 && d.y1 === d.y0 && p.x === d.x0 && p.y === d.y0) return;
      const { dx, dy } = constrainedTranslation(p.x - d.x0, p.y - d.y0, e.shiftKey);
      const raw = { tx: d.moveStart.tx + dx, ty: d.moveStart.ty + dy };
      const patch = e.altKey ? raw : snapLayerTranslation(draggedLayer, raw.tx, raw.ty);
      // Snapping must not displace the constrained axis.
      if (e.shiftKey) { if (dx === 0) patch.tx = raw.tx; else patch.ty = raw.ty; }
      const documentId = studio.activeDocumentState().id;
      transformFrameRef.current?.push(() => {
        if (studio.activeDocumentState().id === documentId) studio.liveUpdateTransform(draggedLayer.id, patch);
      });
      dragRef.current = next;
      return;
    }
    if (d.kind === "ruler") setMeasurement({ start: { x: d.x0, y: d.y0 }, end: { x: p.x, y: p.y } });
    setDragBoth(next);
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!studio) return;
    if (quickSelectionRef.current) {
      const gesture = quickSelectionRef.current;
      if (gesture.pointerId !== e.pointerId) return;
      quickSelectionRef.current = null;
      if (e.type === "pointercancel" || gesture.documentId !== studio.activeDocumentState().id) studio.cancelSelectionGesture();
      else try { studio.endSelectionGesture(); } catch (error) { notify(error instanceof Error ? error.message : "Selection cancelled safely"); }
      return;
    }
    if (brushGestureRef.current) {
      const gesture = brushGestureRef.current;
      if (gesture.pointerId !== e.pointerId) return;
      brushGestureRef.current = null;
      try {
        if (e.type === "pointercancel" || gesture.documentId !== studio.activeDocumentState().id) studio.cancelStroke();
        else studio.endStroke(gesture.layerId, gesture.params, eventToDoc(e));
      } catch (error) { notify(error instanceof Error ? error.message : "Stroke cancelled safely"); }
      updateDynamicCursorFromEvent(e);
      return;
    }
    if (dragRef.current?.kind === "move-layer") onPointerMove(e);
    transformFrameRef.current?.flush();
    updateDynamicCursorFromEvent(e);
    if (panDragRef.current) {
      panFrameRef.current?.flush();
      panDragRef.current = null;
      setCanvasCursorOverride(spaceHeld.current ? "hand" : null);
      if (!spaceHeld.current) spaceGestureRef.current = "idle";
      return;
    }
    if (activeTool === "pen" && penDragging) {
      penFrameRef.current?.flush();
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
    if (retouchTool && retouchActive.current) {
      studio.endRetouchStroke();
      retouchActive.current = false;
      return;
    }
    const d = dragRef.current;
    if (!d) return;
    if (d.shapeGesture) {
      setDragBoth(null);
      if (e.type === "pointercancel") return;
      try {
        const end = eventToDoc(e);
        const layer = commitShapeDrag(studio, { ...d, x1: end.x, y1: end.y, shiftKey: e.shiftKey, altKey: e.altKey });
        if (layer) { setActiveLayerId(layer.id); notify(`${layer.name} added · editable vector`); }
      } catch (error) { notify(error instanceof Error ? error.message : "Shape creation failed"); }
      return;
    }
    const draggedLayer = d.layerId ? studio.findLayer(d.layerId) : null;
    if (d.kind === "move-layer" && draggedLayer) {
      studio.updateTransform(draggedLayer.id, { tx: draggedLayer.transform.tx, ty: draggedLayer.transform.ty });
    } else {
      const intent = planCanvasGesture(d, {
        preferredSelectionMode: selectionMode,
        modifiers: e,
        feather,
        activeRasterLayerId: activeLayer?.kind === "raster" ? activeLayer.id : null,
        brushColor,
        secondaryColor,
        gradientType,
        text: textDraft,
        textSize,
        warpRadius,
      });
      if (intent?.kind === "select-rect") {
        studio.selectRect(intent.bounds.x, intent.bounds.y, intent.bounds.width, intent.bounds.height, intent.mode, intent.feather);
      } else if (intent?.kind === "select-ellipse") {
        studio.selectEllipse(intent.bounds.x, intent.bounds.y, intent.bounds.width, intent.bounds.height, intent.mode, intent.feather);
      } else if (intent?.kind === "select-lasso") {
        studio.selectLasso(intent.path, intent.mode, intent.feather);
      } else if (intent?.kind === "shape") {
        studio.addShapeLayer({
          kind: intent.shape,
          x: intent.bounds.x,
          y: intent.bounds.y,
          w: intent.bounds.width,
          h: intent.bounds.height,
          fill: intent.fill,
          stroke: "#000",
          strokeWidth: 0,
          radius: 0,
        });
      } else if (intent?.kind === "path-shape") {
        void import("./focus-import").then(({ geometricPath }) => studio.addPathLayer(geometricPath(
          intent.shape,
          intent.bounds.x,
          intent.bounds.y,
          intent.bounds.width,
          intent.bounds.height,
          intent.fill,
        )));
      } else if (intent?.kind === "frame") {
        const refusal = studio.addFrameRefusal();
        if (refusal) notify(refusal);
        else studio.addFrame(intent.bounds.x, intent.bounds.y, intent.bounds.width, intent.bounds.height, intent.shifted);
      } else if (intent?.kind === "paragraph-text") {
        const layer = studio.addTextLayer(intent.text, {
          x: intent.bounds.x,
          y: intent.bounds.y,
          layout: "paragraph",
          boxWidth: intent.bounds.width,
          boxHeight: intent.bounds.height,
          color: intent.color,
          font: intent.font,
        });
        setActiveLayerId(layer.id);
      } else if (intent?.kind === "gradient") {
        const refusal = studio.gradientFillRefusal(intent.layerId);
        if (refusal) notify(refusal);
        else studio.gradientFill(intent.layerId, intent.from, intent.to, intent.startColor, intent.endColor, intent.gradientType);
      } else if (intent?.kind === "crop") {
        studio.cropRect(intent.bounds.x, intent.bounds.y, intent.bounds.width, intent.bounds.height);
      } else if (intent?.kind === "straighten") {
        studio.straightenDocument(intent.radians);
      } else if (intent?.kind === "content-move") {
        const refusal = studio.moveSelectionContentRefusal(intent.layerId);
        if (refusal) notify(refusal);
        else studio.moveSelectionContent(intent.layerId, intent.deltaX, intent.deltaY);
      } else if (intent?.kind === "radial-warp") {
        const refusal = studio.radialWarpRefusal(intent.layerId);
        if (refusal) notify(refusal);
        else studio.radialWarpLayer(intent.layerId, intent.from, intent.to, intent.radius);
      } else if (intent?.kind === "measurement") {
        setMeasurement({ start: intent.start, end: intent.end });
      }
    }
    setDragBoth(null);
  };

  const ensureAdjustmentLayer = (): string => {
    if (!studio) return "";
    if (activeLayer?.kind === "adjustment-tone") return activeLayer.id;
    const layer = studio.addAdjustmentLayer("Tone", NEUTRAL_TONE);
    setActiveLayerId(layer.id);
    return layer.id;
  };

  const onToneChange = (key: ToneKey, value: number) => {
    if (!studio) return;
    const id = ensureAdjustmentLayer();
    const next = { ...(studio.findLayer(id)?.tone ?? NEUTRAL_TONE), [key]: value };
    setTone(next);
    studio.liveUpdateTone(id, next);
  };
  const onToneCommit = () => {
    if (!studio || activeLayer?.kind !== "adjustment-tone" || !activeLayer.tone) return;
    studio.updateTone(activeLayer.id, activeLayer.tone);
  };

  const commitRawDevelop = (settings: RawDevelopSettings | null) => {
    if (!studio || !activeLayer?.raw || !settings) return;
    if (studio.redevelopRaw(activeLayer.id, settings)) {
      notify("RAW develop updated from sensor data");
    }
  };
  const resetTone = () => {
    if (!studio || activeLayer?.kind !== "adjustment-tone") { setTone({ ...NEUTRAL_TONE }); return; }
    setTone({ ...NEUTRAL_TONE });
    studio.updateTone(activeLayer.id, { ...NEUTRAL_TONE });
    notify("Tone reset");
  };

  const switchWorkspace = (next: WorkspaceMode) => {
    setPointDraft([]);
    directAnchorRef.current = null;
    setWorkspace(next);
    selectInspectorTab("properties");
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
    selectInspectorTab("properties");
    if (tool === "capture-brush" && !capturedBrushTip) setCaptureSampling(true);
  };

  const applyBrushRecipe = (recipe: BrushRecipe) => {
    setBrushSize(recipe.size); setHardness(recipe.hardness); setBrushOpacity(recipe.opacity);
    setBrushFlow(recipe.flow); setBrushSpacing(recipe.spacing); setBrushRoundness(recipe.roundness);
    setBrushAngle(recipe.angle); setBrushSmoothing(recipe.smoothing); setBrushScatter(recipe.scatter);
    setBrushTilt(recipe.tilt); setBrushTexture(recipe.texture); setPressureSize(recipe.pressureSize);
    setPressureOpacity(recipe.pressureOpacity); setBrushBuildUp(recipe.buildUp); setBrushBlendMode(recipe.blendMode);
    activateTool("brush", "edit");
    // Tool activation updates Properties, but choosing a recipe stays in Brushes.
    if (tablet) setTabletPanel("paint");
  };

  const importDocumentFile = async (file: File, nativePath?: string) => {
    if (!file || !studio) return;
    if (/\.lumaformmesh$/i.test(file.name)) {
      if (file.size > 8 * 1024 * 1024) throw new Error("Form mesh import is limited to 8 MiB");
      const imported = await studio.importFormMesh(await file.text());
      setActiveLayerId(imported.layers[0].id); setTone({ ...NEUTRAL_TONE });
      notify("Form mesh opened with retained geometry and materials. Select the layer for its mesh controls."); return;
    }
    if (/\.lumaformtext$/i.test(file.name)) {
      if (file.size > 4 * 1024 * 1024) throw new Error("Form text import is limited to 4 MiB");
      const imported = await studio.importFormText(await file.text());
      setActiveLayerId(imported.layers[0]?.id ?? null); setTone({ ...NEUTRAL_TONE });
      notify("Form source opened in a new document · editable text and spatial settings · scene geometry is not imported");
      return;
    }
    if (/\.pdf$/i.test(file.name)) {
      if (file.size > 8 * 1024 * 1024) throw new Error("Editable PDF import is limited to 8 MiB");
      if (pdfChoiceResolver.current) throw new Error("Finish the current PDF import first");
      const choice = await new Promise<import("../engine/pdf-import").PdfImportChoice | null>(resolve => { pdfChoiceResolver.current = resolve; setPdfChoice({ name: file.name, resolve }); });
      pdfChoiceResolver.current = null;
      if (choice === null) return;
      const { page, mode, ppi } = choice;
      const name = `${file.name.replace(/\.pdf$/i, "")} · Page ${page}`;
      const bytes = await file.arrayBuffer();
      const imported = mode === "editable" ? await studio.importPdf(bytes, page, name) : mode === "objects" ? await studio.importPdfObjects(bytes, page, choice.fontFamily ?? "Lato", name) : await studio.importRenderedPdf(bytes, page, ppi, name);
      setActiveLayerId(imported.layers[0]?.id ?? null); setTone({ ...NEUTRAL_TONE });
      notify(mode === "editable" ? `${imported.layers.length} editable PDF paths · RGB · save as .luma` : mode === "objects" ? `${imported.layers.length} editable PDF objects · fonts mapped to ${choice.fontFamily ?? "Lato"} · review text spacing before delivery` : `PDF page rendered at ${ppi} ppi · flattened RGB layer · save as .luma`);
      return;
    }
    if (/\.svg$/i.test(file.name)) {
      if (file.size > 2 * 1024 * 1024) throw new Error("Editable SVG import is limited to 2 MiB");
      const name = file.name.replace(/\.svg$/i, "");
      const imported = await studio.importSvg(await file.text(), name);
      setActiveLayerId(imported.layers[0]?.id ?? null);
      setTone({ ...NEUTRAL_TONE });
      notify(`${file.name} · ${imported.layers.length} editable vector paths · save as .luma to preserve editing`);
      return;
    }
    if (/\.luma$/i.test(file.name)) {
      const project = await studio.importProject(file);
      setActiveLayerId(project.doc.layers[0]?.id ?? null);
      studio.markDocumentSaved(undefined, nativePath);
      await writeRecoveryDocument(await studio.exportRecoveryDocument());
      setSaveState("saved");
      const restoredOperations = project.history?.summary().operations ?? 0;
      notify(`${project.name} opened · ${restoredOperations} versions restored`);
      return;
    }
    if (/\.ps[db]$/i.test(file.name)) {
      assertFileSize(file, "photoshopBytes");
      const photoshopBytes = await file.arrayBuffer();
      assertSafePhotoshopHeader(photoshopBytes, file.name, exceedsBrowserCanvas, { allowFlattenedFallback: true });
      const d = await studio.importPsd(photoshopBytes, file.name.replace(/\.ps[db]$/i, ""));
      setPhotoshopFormat("source");
      setActiveLayerId(d.layers[0]?.id ?? null);
      setTone({ ...NEUTRAL_TONE });
      const report = await studio.photoshopCompatibility({ format: "source" });
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
      let rawImportLabel = "";
      if (raw) {
        assertFileSize(file, "rawBytes");
        const bytes = await file.arrayBuffer();
        let ingested: ReturnType<typeof ingestRaw> | null = null;
        let localDecodeError: unknown;
        try {
          ingested = ingestRaw(bytes, file.name, { workingSpace: studio.doc.colorSpace });
        } catch (error) {
          localDecodeError = error;
        }
        if (ingested?.kind === "developed-raw") {
          const layer = studio.openDevelopedDng(name, bytes, ingested.developed);
          setActiveLayerId(layer.id);
          setTone({ ...NEUTRAL_TONE });
          notify(`${ingested.developed.provenance.format} developed · ${ingested.developed.metadata.bitsPerSample}-bit Bayer · 32-bit float master`);
          return;
        }
        // The desktop build gets a second, genuinely decoded path through the
        // operating system's camera codecs. Unsupported cameras still fall
        // back to the explicitly tagged embedded JPEG below.
        let nativeDevelopment: Blob | null = null;
        try {
          nativeDevelopment = await developNativeRaw(file, bytes);
        } catch (error) {
          console.info("Native RAW developer unavailable for this file", error);
        }
        URL.revokeObjectURL(url);
        if (nativeDevelopment) {
          url = URL.createObjectURL(nativeDevelopment);
          source = {
            originalName: file.name,
            format: raw.toUpperCase(),
            mode: "camera-raw-developed",
            originalBytes: file.size,
          };
          rawImportLabel = `${raw.toUpperCase()} developed with macOS camera RAW · full-resolution pixels`;
        } else if (ingested?.kind === "embedded-preview") {
          url = URL.createObjectURL(ingested.preview.blob);
          source = {
            originalName: file.name,
            format: ingested.preview.format,
            mode: "embedded-raw-preview",
            originalBytes: file.size,
          };
          rawImportLabel = `${raw.toUpperCase()}: embedded JPEG preview · sensor decoder unavailable`;
        } else {
          throw localDecodeError instanceof Error ? localDecodeError : new Error(`${raw.toUpperCase()} could not be decoded`);
        }
      } else {
        assertFileSize(file, "imageBytes");
        source = { originalName: file.name, format: file.type || "image", mode: "decoded", originalBytes: file.size };
        const imageBytes = await file.arrayBuffer();
        assertSafeRasterHeader(imageBytes, file.name, exceedsBrowserCanvas);
        const embedded = await extractAndParseEmbeddedColorProfile(imageBytes);
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
      if (exceedsBrowserCanvas(img.naturalWidth, img.naturalHeight)) {
        throw new Error(`${file.name} is too large to decode as one bitmap; use a tiled Luma or PSB project`);
      }
      const layer = studio.openImage(name, img, source);
      setActiveLayerId(layer.id);
      setTone({ ...NEUTRAL_TONE });
      notify(
        raw
          ? rawImportLabel
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

  const installedPluginPackages = () => {
    try {
      const stored = JSON.parse(window.localStorage.getItem(INSTALLED_PLUGINS_KEY) ?? "[]") as unknown;
      if (!Array.isArray(stored)) return [];
      return stored.flatMap((candidate) => {
        try { return [parseLumaPluginPackage(JSON.stringify(candidate))]; } catch { return []; }
      });
    } catch {
      return [];
    }
  };

  const persistPluginPackages = (packages: LumaPluginPackage[]) => {
    window.localStorage.setItem(INSTALLED_PLUGINS_KEY, JSON.stringify(packages));
  };

  const onPluginInstall = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !studio) return;
    try {
      assertFileSize(file, "pluginBytes");
      const pkg = parseLumaPluginPackage(await file.text());
      if (studio.listPlugins().some((plugin) => plugin.id === pkg.manifest.id)) {
        studio.unregisterPlugin(pkg.manifest.id);
      }
      studio.registerPlugin(createDeclarativePlugin(pkg));
      const next = installedPluginPackages().filter((candidate) => candidate.manifest.id !== pkg.manifest.id);
      persistPluginPackages([...next, pkg]);
      notify(`${pkg.manifest.name} installed · ${pkg.actions.length} action${pkg.actions.length === 1 ? "" : "s"}`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Plugin install failed");
    }
  };

  const uninstallPlugin = (id: string) => {
    if (!studio) return;
    const plugin = studio.listPlugins().find((candidate) => candidate.id === id);
    studio.unregisterPlugin(id);
    try { persistPluginPackages(installedPluginPackages().filter((candidate) => candidate.manifest.id !== id)); } catch { /* storage may be blocked */ }
    notify(`${plugin?.name ?? id} unloaded`);
  };

  const importOpenedFile = async (opened: { name: string; path?: string; data: Uint8Array }) => {
    const { mimeForFileName } = await import("./focus-import");
    const data = opened.data as Uint8Array<ArrayBuffer>;
    await importDocumentFile(new File([data], opened.name, { type: mimeForFileName(opened.name) }), opened.path);
  };

  const openNativeDocument = async (isActive: () => boolean) => {
    try {
      const opened = await openNativeFile();
      if (!opened || !isActive()) return;
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

  const openDocumentPath = async (readyPath: string, isActive: () => boolean) => {
    try {
      const opened = await readNativePath(readyPath);
      if (!opened || !isActive()) return;
      await importOpenedFile(opened);
      const next = withRecentFile(recentFilesRef.current, readyPath);
      recentFilesRef.current = next;
      saveRecentFiles(safeLocalStorage(), next);
      publishRecentFiles(next);
    } catch (error) {
      notify(error instanceof Error ? error.message : `${readyPath} could not be opened`);
    }
  };

  const requestDocumentOpen = () => {
    if (isNativeFilesystemAvailable()) nativeOpenQueue.current?.enqueue("picker");
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
    `\\.(luma|svg|pdf|lumaformtext|lumaformmesh|psd|psb|${RAW_EXTENSIONS.join("|")})$`,
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

  const queueBatchFiles = (files: File[]) => {
    if (batchAbortRef.current) return;
    const images = files.filter((file) => /\.(png|jpe?g|webp)$/i.test(file.name));
    if (images.length + batchFiles.length > BATCH_MAX_FILES) { notify(`Batch accepts at most ${BATCH_MAX_FILES} images. Split this into smaller runs.`); return; }
    if (images.length) { setBatchFiles((current) => [...current, ...images]); setBatchItems({}); }
    if (images.length !== files.length) notify("Batch accepts PNG, JPEG, and WebP images only");
  };

  const onFocusImportChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.target.files ?? [])];
    event.target.value = "";
    await importLayerFiles(files);
  };

  const pasteImageAsLayer = async () => {
    const targetId = studio?.activeDocumentState().id;
    try {
      const { clipboardImageFile } = await import("./focus-import");
      const file = await clipboardImageFile();
      if (studio?.activeDocumentState().id !== targetId) throw new Error("Document changed while reading the clipboard; paste again");
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
      if (projectSavingRef.current || nativeOpeningRef.current || pendingCloseDocumentId || pendingNativeClose || showNewDocument || recolorSession || showMockups || showGlyph || showUpscale || showThumb || pdfChoiceResolver.current) {
        notify("Finish the current dialog or file operation before dropping files");
        return;
      }
      const files = Array.from(event.dataTransfer?.files ?? []);
      if (files.length) {
        if (showBatch) queueBatchFiles(files);
        else void importDroppedFiles(files);
      }
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
  }, [studio, showBatch, pendingCloseDocumentId, pendingNativeClose, showNewDocument, recolorSession, showMockups, showGlyph, showUpscale, showThumb]);

  // The engine owns document identity. UI-only copies drift after close,
  // recovery, scripting and AI branches and can save a tab under another name.
  const projectName = openDocuments.find(document => document.active)?.name ?? "Untitled";

  const downloadOrSave = async (blob: Blob, fileName: string, options: { locker?: boolean } = {}) => {
    if (isNativeFilesystemAvailable()) return saveNativeFile(blob, fileName);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    // Offer the same file to the thecreateco Locker (browser-local library).
    if (options.locker) setLockerOffer({ blob, name: fileName, state: "idle" });
    return true;
  };

  const saveOfferToLocker = () => {
    const offer = lockerOffer;
    if (!offer || offer.state !== "idle") return;
    setLockerOffer({ ...offer, state: "saving" });
    // Called synchronously from the click so the kit may open its popup.
    saveToLocker(offer.blob, offer.name, { project: projectName })
      .then(() => { setLockerOffer(current => current?.blob === offer.blob ? { ...offer, state: "saved" } : current); })
      .catch((error: unknown) => {
        setLockerOffer(current => current?.blob === offer.blob ? { ...offer, state: "idle" } : current);
        notify(error instanceof Error ? error.message : "Locker save failed");
      });
  };

  const openFromLocker = async (file: LockerFile) => {
    try {
      if (isFontFile(file)) {
        const [{ installUserFont }, { notifyTextFontsChanged }, { parse }] = await Promise.all([
          import("../engine/user-fonts"), import("../engine/text-font-resources"), import("opentype.js/dist/opentype.mjs"),
        ]);
        const bytes = await file.blob.arrayBuffer();
        let family = file.name.replace(/\.(otf|ttf)$/i, "");
        try {
          // opentype.js 2 keeps names per platform (windows / macintosh / unicode).
          type NameTable = Record<string, Record<string, string> | undefined>;
          const tables = parse(bytes.slice(0)).names as unknown as Record<string, NameTable | undefined>;
          for (const table of [tables.windows, tables.macintosh, tables.unicode, tables as NameTable]) {
            const name = table?.preferredFamily?.en || table?.typographicFamily?.en || table?.fontFamily?.en;
            if (typeof name === "string" && name.trim()) { family = name.trim(); break; }
          }
        } catch { /* keep the file name */ }
        await installUserFont(family, bytes);
        notifyTextFontsChanged();
        notify(`“${family}” from Locker is installed. Pick it in Type & Vector → Typeface (under “Yours · Glyph”).`);
        return;
      }
      const type = file.type || "";
      if (!/^image\//.test(type) && !/\.(luma|png|jpe?g|webp|gif|svg|psd|psb)$/i.test(file.name)) {
        notify(`Luma can't open ${file.name} (${type || "unknown type"}).`);
        return;
      }
      await importDocumentFile(new File([file.blob], file.name, { type }));
    } catch (error) {
      notify(error instanceof Error ? error.message : `Could not open ${file.name} from Locker`);
    }
  };
  useLockerOpen(Boolean(studio) && startupReady && !desktop, openFromLocker);

  const sendLayerToForm = async (layer: Layer) => {
    try {
      const asset = formSpatialAssetFromLayer(layer, spatialOperationIdsForTool(activeTool));
      const fileName = `${layer.name.replace(/[^a-z0-9_-]+/gi, "-") || "Luma-Layer"}.lumaform`;
      const saved = await downloadOrSave(
        new Blob([serializeFormSpatialAsset(asset)], { type: "application/vnd.luma-form.spatial+json" }),
        fileName,
      );
      if (saved) notify("Spatial layer ready for Form Studio");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Spatial export failed");
    }
  };

  const saveProject = async (saveAs = false, nameOverride?: string) => {
    if (!studio || projectSavingRef.current || nativeOpeningRef.current) return false;
    projectSavingRef.current = true;
    setProjectSaveError(null);
    setProjectSaving(true);
    transformFrameRef.current?.flush();
    setSaveState("saving");
    try {
      const saveName = nameOverride ?? studio.activeDocumentState().name;
      const ticket = await studio.prepareProjectSave(saveName);
      const blob = ticket.blob;
      const fileName = `${saveName.replace(/[^a-z0-9_-]+/gi, "-")}.luma`;
      let savedPath: string | undefined;
      if (isNativeFilesystemAvailable()) {
        const currentPath = saveAs ? undefined : ticket.nativePath;
        const result = await saveNativeProject(blob, fileName, currentPath);
        if (!result) { setSaveState("unsaved"); return false; }
        savedPath = result;
      } else {
        const saved = await downloadOrSave(blob, fileName, { locker: true });
        if (!saved) { setSaveState("unsaved"); return false; }
        const verified = await new Promise<boolean>(resolve => setDownloadConfirmation({ name: fileName, resolve }));
        if (!verified) { setSaveState("unsaved"); notify("Download not confirmed. Your document remains open and unsaved."); return false; }
      }
      const settled = studio.completeProjectSave(ticket, savedPath);
      if (!settled) { setSaveState("unsaved"); notify("Saved the earlier version. Newer changes still need saving."); return false; }
      let checkpointUpdated = false;
      if (!recoveryReadFailure()) {
        try { await writeRecoveryDocument(await studio.exportRecoveryDocument(ticket.documentId)); checkpointUpdated = true; }
        catch { /* Explicit file save succeeded; report recovery separately below. */ }
      }
      if (studio.listDocuments().find(document => document.id === ticket.documentId)?.dirty) {
        setSaveState("unsaved"); notify("New changes arrived after saving. Save again before closing."); return false;
      }
      setSaveState(checkpointUpdated ? "saved" : "error");
      notify(checkpointUpdated ? "Project + version history saved" : "Project file saved. Automatic recovery is unavailable; keep saving .luma backups.");
      return true;
    } catch (error) {
      setSaveState("error");
      setProjectSaveError(error instanceof Error ? error.message : "Project save failed");
      return false;
    } finally {
      projectSavingRef.current = false;
      setProjectSaving(false);
    }
  };

  const requestCloseDocument = (id: string) => {
    const documentState = studio?.listDocuments().find((candidate) => candidate.id === id);
    if (!studio || !documentState) return;
    if (documentState.dirty) {
      setPendingCloseDocumentId(id);
      return;
    }
    studio.closeDocument(id);
    void removeRecoveryDocument(id).catch(() => notify("Document closed; its recovery checkpoint could not be removed"));
    setActiveLayerId(studio.doc.layers[0]?.id ?? null);
  };

  const saveAndClosePendingDocument = async () => {
    if (!studio || !pendingCloseDocumentId) return;
    studio.switchDocument(pendingCloseDocumentId);
    setActiveLayerId(studio.doc.layers[0]?.id ?? null);
    const saved = await saveProject(false, studio.activeDocumentState().name);
    if (!saved) return;
    const id = pendingCloseDocumentId;
    setPendingCloseDocumentId(null);
    studio.closeDocument(id);
    void removeRecoveryDocument(id).catch(() => notify("Document closed; its recovery checkpoint could not be removed"));
    setActiveLayerId(studio.doc.layers[0]?.id ?? null);
  };

  const discardPendingDocument = () => {
    if (!studio || !pendingCloseDocumentId) return;
    const id = pendingCloseDocumentId;
    setPendingCloseDocumentId(null);
    studio.closeDocument(id);
    void removeRecoveryDocument(id).catch(() => notify("Document closed; its recovery checkpoint could not be removed"));
    setActiveLayerId(studio.doc.layers[0]?.id ?? null);
  };

  useEffect(() => {
    if (!studio) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!studio.dirtyDocuments().length) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [studio]);

  useEffect(() => {
    if (!studio || !desktop) return;
    return listenForNativeCloseRequest(() => {
      if (!startupReadyRef.current) { void cancelNativeClose(); notify("Wait for document recovery to finish"); return; }
      if (nativeCloseBusyRef.current) return;
      if (projectSavingRef.current || nativeOpeningRef.current) { void cancelNativeClose(); notify("Wait for the file operation to finish"); return; }
      if (studio.dirtyDocuments().length) setPendingNativeClose(true);
      else void confirmNativeClose();
    });
  }, [studio, desktop, notify]);

  useEffect(() => {
    if (!pendingCloseDocumentId && !pendingNativeClose) return;
    const dialog = unsavedDialogRef.current;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusableButtons = () => Array.from(
      dialog?.querySelectorAll<HTMLButtonElement>("button:not([disabled])") ?? [],
    );
    focusableButtons()[0]?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        if (nativeCloseBusyRef.current) return;
        if (pendingNativeClose) {
          setPendingNativeClose(false);
          void cancelNativeClose();
        } else {
          setPendingCloseDocumentId(null);
        }
        return;
      }
      if (event.key !== "Tab") return;
      const buttons = focusableButtons();
      if (!buttons.length) return;
      const first = buttons[0];
      const last = buttons[buttons.length - 1];
      if (!dialog?.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      previousFocus?.focus();
    };
  }, [pendingCloseDocumentId, pendingNativeClose]);

  const saveAllAndCloseNative = async () => {
    if (!studio || nativeCloseBusyRef.current) return;
    nativeCloseBusyRef.current = true;
    setNativeCloseBusy(true);
    try {
      for (const dirty of studio.dirtyDocuments()) {
        studio.switchDocument(dirty.id);
        setActiveLayerId(studio.doc.layers[0]?.id ?? null);
        if (!await saveProject(false, dirty.name)) return;
      }
      if (studio.dirtyDocuments().length) { notify("Some documents changed while saving. Review them before quitting."); return; }
      await confirmNativeClose();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Luma could not quit safely. Your documents remain open.");
    } finally {
      nativeCloseBusyRef.current = false;
      setNativeCloseBusy(false);
    }
  };

  const discardAllAndCloseNative = async () => {
    if (!studio || nativeCloseBusyRef.current) return;
    nativeCloseBusyRef.current = true;
    setNativeCloseBusy(true);
    let restoreRecovery: (() => Promise<void>) | undefined;
    try {
      restoreRecovery = await discardRecoveryDocuments(studio.dirtyDocuments().map(document => document.id));
      await confirmNativeClose();
    } catch (error) {
      try { await restoreRecovery?.(); }
      catch { notify("Quit was canceled, but recovery restoration failed. Keep these documents open and save them."); return; }
      notify(error instanceof Error ? error.message : "Discard could not be committed. Your documents remain open.");
    } finally {
      nativeCloseBusyRef.current = false;
      setNativeCloseBusy(false);
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
    if (!studio || !startupReady) return;
    // No repeated ZIP encoding while storage is blocked. Existing checkpoints
    // are protected by the engine guard; explicit file Save remains available.
    if (recoveryReadFailure()) return; // Startup's asynchronous catch owns the error status.
    let timer = 0;
    let active = true;
    const queue = new CoalescedSaveQueue<Awaited<ReturnType<Studio["exportRecoveryDocument"]>>>({
      produce: () => studio.exportRecoveryDocument(),
      commit: (checkpoint) => writeRecoveryDocument(checkpoint, () => studio.listDocuments().some(doc => doc.id === checkpoint.id)),
      onState: (state) => {
        if (!active) return;
        if (state === "producing" || state === "committing") setSaveState("saving");
        else if (state === "idle") setSaveState(studio.activeDocumentState().dirty ? "unsaved" : "saved");
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
      setSaveState(studio.activeDocumentState().dirty ? "unsaved" : "saved");
      timer = window.setTimeout(flush, recoveryCheckpointDelayMs({
        documentPixels: studio.doc.width * studio.doc.height,
        // Dimensions/layer count are O(1); never add an engine-wide scan to
        // the hot edit notification path merely to schedule background I/O.
        estimatedResidentBytes: 0,
        layers: studio.doc.layers.length,
      }));
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
  }, [studio, startupReady]);

  useEffect(() => {
    if (!studio) return;
    const crashReporter = createCrashReporterFromEnv(desktop ? "pro" : "web");
    if (crashReporter.enabled) void crashReporter.flush(localDiagnostics.list());
    return installGlobalDiagnostics({
      context: () => ({
        edition: desktop ? "pro" : "web",
        documentWidth: studio.doc.width,
        documentHeight: studio.doc.height,
        layers: studio.doc.layers.length,
        bitDepth: studio.doc.bitDepth,
        colorSpace: studio.doc.colorSpace,
      }),
      onFatal: async () => {
        await writeRecoveryWorkspace(await studio.exportRecoveryWorkspace());
        localDiagnostics.record("recovery", "Emergency workspace checkpoint completed", {
          layers: studio.doc.layers.length,
        });
      },
      onRecord: crashReporter.enabled ? async (event) => { await crashReporter.report(event); } : undefined,
    });
  }, [studio, desktop]);

  const setLayerVisible = (id: string, v: boolean) => studio?.setLayerProp(id, "visible", v, v ? "Layer shown" : "Layer hidden");
  const setLayerOpacity = (id: string, o: number) => studio?.setLayerProp(id, "opacity", o, "Opacity");
  const previewLayerOpacity = (id: string, o: number) => studio?.liveUpdateLayerProp(id, "opacity", o);
  const addAdjust = () => {
    if (!studio) return;
    const layer = studio.addAdjustmentLayer("Tone", NEUTRAL_TONE);
    setActiveLayerId(layer.id);
    setTone({ ...NEUTRAL_TONE });
    switchWorkspace("develop");
  };
  const addProfessionalAdjustment = (kind: ProAdjustmentKind) => {
    if (!studio) return;
    const layer = studio.addProAdjustmentLayer(kind);
    selectLayerForEditing(layer);
    notify(`${PRO_ADJUSTMENT_LABELS[kind]} adjustment added`);
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
      executeStudioCommand("group-layer");
      return;
    }
    if (action === "generate") { focusInspector("ai"); return; }
    if (action === "paste") executeStudioCommand("paste-pixels");
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

  const runCutout = async () => {
    if (!studio || !activeLayer || activeLayer.kind !== "raster") { notify("Select a raster layer for Cutout"); return; }
    if (cutoutProgress) return;
    setCutoutProgress({ msg: "Starting", pct: 0 });
    try {
      const result = await studio.cutoutSubject(activeLayer.id, (msg, pct) => setCutoutProgress({ msg, pct }));
      setCutoutProgress(null);
      setActiveLayerId(result.layerId);
      executeStudioCommand("panel-mask");
      forceUpdate();
      notify(result.used === "neural"
        ? "Cutout added as a new layer · refine the mask with the Mask brush"
        : "Cutout model unavailable, used the luma fallback · refine the mask with the Mask brush");
    } catch (error) {
      setCutoutProgress(null);
      notify(error instanceof Error ? error.message : "Cutout failed. It needs a connection the first time to download the model.");
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
        ...(aiOperation === "upscale" || aiOperation === "expand" ? { geometryCopy: { mode: aiOperation, factor: aiOperation === "upscale" ? 2 : 1.5 } } : {}),
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

  const runFilter = (kind: SmartFilterKind, opts: Record<string, number> = {}) => {
    if (!studio || !activeLayer) { notify("Select a content layer"); return; }
    // The group check was here but the lock check was not, so a locked layer
    // was told its filter had been added when addSmartFilter had returned null.
    const refusal = studio.smartFilterRefusal(activeLayer.id);
    if (refusal) { notify(refusal); return; }
    studio.addSmartFilter(activeLayer.id, kind, { ...SMART_FILTER_SPECS[kind].defaults, ...opts });
    notify(`${SMART_FILTER_SPECS[kind].label} added as a Smart Filter`);
  };

  const exportPNG = async () => {
    if (!studio) return;
    try {
      const mime = exportFormat === "jpeg" ? "image/jpeg" : exportFormat === "webp" ? "image/webp" : "image/png";
      const blob = await studio.exportImage(mime, 0.92);
      const saved = await downloadOrSave(blob, `${projectName}-luma.${exportFormat === "jpeg" ? "jpg" : exportFormat}`, { locker: true });
      if (saved) notify(`Exported ${exportFormat.toUpperCase()}`);
    } catch { notify("Export failed"); }
  };

  const exportFigma = async ({ outlineText }: { outlineText: boolean }) => {
    if (!studio) return;
    try {
      const { blob, report } = await studio.exportFigmaSvg({ outlineText });
      const saved = await downloadOrSave(blob, `${projectName}-figma.svg`, { locker: true });
      if (!saved) return;
      const notes = [
        `${report.editable} editable layer${report.editable === 1 ? "" : "s"}`,
        report.flattened.length ? `${report.flattened.length} flattened (${[...new Set(report.flattened.map(item => item.reason))].slice(0, 2).join(", ")})` : "",
        report.approximated.length ? `${report.approximated.length} approximated` : "",
      ].filter(Boolean).join(" · ");
      notify(`Exported for Figma · ${notes}`);
      if (report.flattened.length || report.approximated.length) console.info("Figma export report", report);
    } catch (error) { notify(error instanceof Error ? error.message : "Figma export failed"); }
  };

  const runBatchNow = async () => {
    if (!studio || !batchFiles.length || batchAbortRef.current) return;
    const action = selectedActionIdx != null ? studio.actions.get(selectedActionIdx) : null;
    if (selectedActionIdx != null && !action) { notify("The selected action is no longer available. Choose another action."); return; }
    const controller = new AbortController();
    batchAbortRef.current = controller;
    setBatchItems({});
    setBatchProgress({ i: 0, total: batchFiles.length, name: "" });
    try {
      const { runBatch } = await import("@/app/engine/batch");
      const onItem: BatchOptions["onItem"] = (index, status, message) => setBatchItems(current => ({ ...current, [index]: { status, message } }));
      const result = await runBatch(batchFiles, action ?? null, (i, total, name) => {
        setBatchProgress({ i, total, name });
      }, undefined, { signal: controller.signal, onItem });
      if (batchAbortRef.current !== controller) return;
      const saved = await downloadOrSave(result.archive, `luma-batch-${Date.now()}.zip`);
      if (saved) notify(`${result.cancelled ? "Batch stopped" : "Batch finished"} · ${result.succeeded} exported · ${result.failed.length} failed · ${result.skipped} skipped (see report)`);
      else notify("Batch output was not saved. You can run the queue again.");
    } catch (err) {
      console.warn(err);
      notify(err instanceof Error ? err.message : "Batch failed");
    } finally {
      batchAbortRef.current = null;
      setBatchProgress(null);
    }
  };

  const exportPsd = async () => {
    if (!studio) return;
    try {
      const { buffer: buf, report } = await studio.exportPhotoshop({ format: photoshopFormat }, report => new Promise<boolean>(resolve => {
        exportApprovalResolver.current?.(false);
        exportApprovalResolver.current = resolve;
        setPhotoshopApproval({ report, documentId: studio.activeDocumentState().id, resolve });
      }));
      const blob = new Blob([buf], { type: "image/vnd.adobe.photoshop" });
      const saved = await downloadOrSave(blob, `${projectName}-luma.${report.container}`, { locker: true });
      if (!saved) return;
      const warnings = report.issues.filter((issue) => issue.severity === "warning").length;
      notify(`Exported ${report.container.toUpperCase()}${warnings ? ` · ${warnings} acknowledged compatibility warning${warnings === 1 ? "" : "s"}` : " · no detected compatibility warnings"}`);
    } catch (error) { notify(error instanceof Error ? error.message : "Photoshop export failed"); }
  };

  const startRecording = (name: string) => {
    if (!studio) return;
    if (!name.trim()) return;
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
    try {
      const report = studio.replayWithReport(a, activeLayerId);
      if (report.targetId && studio.findLayer(report.targetId)) setActiveLayerId(report.targetId);
      const failure = report.steps.find(step => step.status === "failed");
      setActionReport(report);
      notify(failure ? `Stopped at step ${failure.index + 1}: ${failure.message}` : `Played ${a.name} · ${report.steps.filter(step => step.status === "applied").length} changes`);
    } catch (error) { notify(error instanceof Error ? error.message : "Action failed"); }
  };

  const focusInspector = (tab: "layers" | "properties" | "ai") => {
    selectInspectorTab(tab);
    if (tab === "properties") setNativePanelOverride(null);
  };

  const openStudioPanel = (panelId: PanelId) => {
    setTabletPanel(panelId);
    if (!tablet) setDockLayout((current) => openDockPanel(current, panelId, STUDIO_PANEL_REGISTRY));
    if (panelId === "layers" || panelId === "properties" || panelId === "neural") {
      setInspectorTab(panelId === "neural" ? "ai" : panelId);
    }
  };

  const applyDockWorkspace = (next: DockLayout) => {
    setDockLayout(next);
    const active = next.groups[0]?.activePanelId;
    if (active === "layers" || active === "properties" || active === "neural") {
      setInspectorTab(active === "neural" ? "ai" : active);
    }
  };

  const selectLayerForEditing = (layer: Layer) => {
    setActiveLayerId(layer.id);
    setNativePanelOverride(null);
    const nextWorkspace = workspaceForLayer(layer);
    if (nextWorkspace) setWorkspace(nextWorkspace);
    selectInspectorTab("properties");
    if (layer.kind === "adjustment-tone") {
      if (layer.tone) setTone({ ...layer.tone });
    }
  };

  /**
   * One implementation behind both the tool palette and the desktop menu bar.
   *
   * The switch is exhaustive over StudioCommand on purpose: adding an entry to
   * app/desktop/menu-model.ts without handling it here is a type error rather
   * than a menu item that quietly does nothing.
   */
  const runStudioCommand = (command: StudioCommand) => {
    if (desktopUpdateInstallingRef.current) {
      notify("A signed update is being installed");
      return;
    }
    switch (command) {
      case "check-for-updates":
        if (studio?.dirtyDocuments().length) {
          notify("Save all open documents before installing an update");
          return;
        }
        void runDesktopUpdateFlow({
          onStatus: notify,
          onPhase: (phase) => {
            const locked = phase !== "idle" && phase !== "checking";
            desktopUpdateInstallingRef.current = locked;
            setDesktopUpdateInstalling(locked);
            setDesktopUpdatePhase(phase === "downloading" ? "Downloading and verifying update…"
              : phase === "checkpointing" ? "Protecting your workspace…" : "Installing verified update…");
          },
          confirmInstall: (update) => {
            if (studio?.dirtyDocuments().length) {
              notify("Documents changed during the update check. Save them before installing");
              return false;
            }
            return window.confirm(`Luma Studio ${update.version} is available. Download, verify, install, and restart now?`);
          },
          beforeInstall: async () => {
            if (!studio) throw new Error("No workspace is available to checkpoint");
            return studio.checkpointForRestart(writeRecoveryWorkspace);
          },
        }).then((result) => {
          if (result.status === "busy") notify("An update check is already running");
          else if (result.status === "unavailable") notify("Automatic updates are available in signed release builds");
          else if (result.status === "current") notify("Luma Studio is up to date");
          else if (result.status === "cancelled" && !studio?.dirtyDocuments().length) notify("Update cancelled");
        }).catch((error) => {
          notify(error instanceof Error ? error.message : "Update check failed");
        });
        return;
      case "new-document": setShowNewDocument(true); return;
      case "close-document": if (studio) requestCloseDocument(studio.activeDocumentState().id); return;
      case "open": requestDocumentOpen(); return;
      case "save": void saveProject(); return;
      case "save-as": void saveProject(true); return;
      case "export": setShowExportMenu(true); return;
      case "export-print": if (studio && isNativeFilesystemAvailable()) { const state = studio.activeDocumentState(); setPrintTarget({ id: state.id, name: state.name }); } return;
      case "batch": setShowBatch(true); return;
      case "mockups": setShowMockups(true); return;
      case "glyph-font-maker": setShowGlyph(true); return;
      case "cutout": void runCutout(); return;
      case "upscale": setShowUpscale(true); return;
      case "thumb": setShowThumb(true); return;

      case "undo":
        if (distortDraft || ftDragRef.current || dragRef.current?.kind === "move-layer") cancelTransformGesture();
        else studio?.undo();
        forceUpdate(); return;
      case "redo":
        if (distortDraft || ftDragRef.current || dragRef.current?.kind === "move-layer") cancelTransformGesture();
        else studio?.redo();
        forceUpdate(); return;
      case "history": setShowHistory(true); return;
      case "copy-pixels": case "copy-merged": case "cut-pixels": {
        if (!studio) return;
        try {
          const pendingCut = command === "cut-pixels" && hasNativeImageClipboard() ? studio.preparePixelCut(activeLayerId!) : undefined;
          const canvas = pendingCut?.canvas ?? (command === "cut-pixels" ? studio.cutPixels(activeLayerId!) : studio.copyPixels(activeLayerId ?? undefined, command === "copy-merged"));
          const marker = `Luma pixels ${crypto.randomUUID()}`;
          clipboardMarkerRef.current = marker;
          if (!hasNativeImageClipboard()) {
            clipboardEventRef.current?.clipboardData?.setData(SELECTION_CLIPBOARD_TYPE, marker);
            clipboardEventRef.current?.clipboardData?.setData("text/plain", marker);
          }
          void writePixelClipboard(canvas, marker).then(shared => {
            if (pendingCut) {
              if (!shared) throw new Error("Clipboard publication was superseded");
              pendingCut.complete();
            }
            notify(shared ? `${pendingCut ? "Pixels cut" : "Pixels copied"} · 8-bit RGBA` : "Pixels ready to paste in Luma · system clipboard unavailable");
          }).catch(error => notify(`${pendingCut ? "Cut not completed; original pixels kept. " : ""}${error instanceof Error ? error.message : String(error)}`));
        } catch (error) { notify(error instanceof Error ? error.message : "Copy failed; no pixels changed"); }
        return;
      }
      case "paste-pixels": case "paste-in-place": case "selection-to-layer": {
        if (!studio) return;
        if (command !== "selection-to-layer" && hasNativeImageClipboard()) {
          const targetId = studio.activeDocumentState().id;
          let transfer: ReturnType<Studio["beginClipboardImport"]> | undefined;
          void readNativeImageClipboard(clipboardMarkerRef.current, studio.hasPixelClipboard(), () => {
            if (studio.activeDocumentState().id !== targetId) throw new Error("Document changed while reading the clipboard; paste again");
            transfer = studio.beginClipboardImport();
          }).then(async result => {
            if (studio.activeDocumentState().id !== targetId) throw new Error("Document changed while reading the clipboard; paste again");
            transfer?.assertCurrent();
            if (result === "internal") {
              const layer = studio.pastePixels(command === "paste-in-place");
              setActiveLayerId(layer.id); notify("Pixels pasted · original transparency preserved");
            } else await importLayerFile(result);
          }).catch(error => notify(error instanceof Error ? error.message : String(error))).finally(() => transfer?.release());
          return;
        }
        if (!studio.hasPixelClipboard() && command === "paste-pixels") { void pasteImageAsLayer(); return; }
        try {
          const layer = command === "selection-to-layer" ? studio.selectionToLayer(activeLayerId!) : studio.pastePixels(command === "paste-in-place");
          setActiveLayerId(layer.id); notify("Pixels added as an editable raster layer");
        } catch (error) { notify(error instanceof Error ? error.message : "Paste failed safely"); }
        return;
      }
      case "delete-pixels":
        try { if (studio && activeLayerId) studio.clearPixels(activeLayerId); }
        catch (error) { notify(error instanceof Error ? error.message : "Delete failed safely"); }
        return;
      case "copy-layer-style":
        if (!studio || !activeLayerId || !studio.copyLayerStyle(activeLayerId)) notify("Select a layer to copy its style");
        else notify("Layer style copied");
        return;
      case "define-custom-shape":
        try {
          if (!activeLayer) throw new Error("Select a closed vector layer first");
          const preset = captureCustomShape(activeLayer, `custom-${crypto.randomUUID()}`);
          persistCustomShapes([...customShapes, preset]);
          chooseShapePreset(preset.id);
          notify("Outline saved locally · drag to draw a new copy");
        } catch (error) { notify(error instanceof Error ? error.message : "Custom shape could not be saved"); }
        return;
      case "paste-layer-style":
        if (!studio || !activeLayerId || !studio.pasteLayerStyle(activeLayerId)) notify("Copy a style, then select an unlocked layer");
        else { forceUpdate(); notify("Layer style pasted"); }
        return;

      case "document-properties":
        selectInspectorTab("properties");
        setNativePanelOverride("document");
        return;
      case "crop-selection":
        if (!studio?.cropToSelection()) notify("Create a selection before cropping");
        else forceUpdate();
        return;

      case "select-all": studio?.selectAll(); return;
      case "deselect": studio?.deselect(); return;
      case "invert-selection": studio?.invertSelectionArea(); return;
      case "select-channel":
        try { studio?.selectCompositeChannel(); notify("Channel loaded as selection · refine, copy, cut or create a mask"); }
        catch (error) { notify(error instanceof Error ? error.message : "Channel extraction failed"); }
        return;
      case "channel-save": case "channel-update": case "channel-rename": case "channel-delete": case "channel-invert": case "channel-calculate": case "channel-load":
        if (!studio) return;
        try {
          if (command === "channel-load") studio.loadAlphaChannel(alphaDraft.id, alphaDraft.loadMode);
          else {
            const operation = command.slice("channel-".length) as "save" | "update" | "rename" | "delete" | "invert" | "calculate";
            const id = studio.editAlphaChannel(operation, alphaDraft);
            updateAlphaDraft({ ...alphaDraft, id: operation === "delete" ? "" : id });
          }
          forceUpdate();
        } catch (error) { notify(error instanceof Error ? error.message : "Alpha channel operation failed"); }
        return;
      case "select-subject":
        activateTool("sel-sam", "select");
        executeStudioCommand("panel-selection");
        if (studio && activeLayerId && !neural) {
          setNeural({ msg: "Selecting subject", pct: 0 });
          void studio.selectSubject(activeLayerId, selectionMode, (msg, pct) => setNeural({ msg, pct }))
            .then(() => notify("Subject selected · refine edges or copy/cut pixels"))
            .catch(error => notify(error instanceof Error ? error.message : "Select Subject unavailable; try Quick Selection"))
            .finally(() => setNeural(null));
        }
        return;

      case "new-layer": addBlank(); return;
      case "duplicate-layer":
        if (studio && activeLayerId) {
          const copies = studio.duplicateLayers(selectedLayerIds);
          setActiveLayerId(studio.setSelectedLayers(copies.map(layer => layer.id)));
          forceUpdate();
        } else notify("Select a layer to duplicate");
        return;
      case "group-layer":
        if (studio && selectedLayerIds.length) setActiveLayerId(studio.setSelectedLayers([studio.groupLayers(selectedLayerIds).id]));
        forceUpdate();
        return;
      case "ungroup-layers":
        if (studio) setActiveLayerId(studio.setSelectedLayers(studio.ungroupLayers(selectedLayerIds)));
        forceUpdate(); return;
      case "merge-layers":
        if (studio) setActiveLayerId(studio.setSelectedLayers([studio.mergeLayers(selectedLayerIds).id]));
        forceUpdate(); return;
      case "delete-layer":
        if (studio) { studio.removeLayers(selectedLayerIds); setActiveLayerId(studio.setSelectedLayers([studio.doc.layers[0]?.id].filter((id): id is string => Boolean(id)))); }
        forceUpdate(); return;
      case "rename-layer": {
        if (studio && activeLayer) setLayerRenameTarget({ documentId: studio.activeDocumentState().id, layerId: activeLayer.id, name: activeLayer.name });
        return;
      }
      case "toggle-layer-lock": case "toggle-layer-visibility": {
        if (studio) {
          const key = command === "toggle-layer-lock" ? "locked" : "visible";
          const targets = layers.filter(layer => selectedLayerIds.includes(layer.id));
          studio.setLayersFlag(selectedLayerIds, key, !targets.every(layer => layer[key]));
        }
        forceUpdate(); return;
      }
      case "convert-smart-object":
        if (studio && activeLayerId) {
          studio.convertToSmartObject(activeLayerId);
          forceUpdate();
        } else notify("Select a layer to convert");
        return;
      case "replace-smart-content":
        if (studio && activeLayerId) {
          try {
            smartContentTarget.current = studio.prepareSmartContentReplacement(activeLayerId);
            smartContentInput.current?.click();
          } catch (error) { notify(error instanceof Error ? error.message : "Content replacement unavailable"); }
        }
        return;
      case "edit-smart-content":
        if (studio && activeLayerId) void studio.editSmartContents(activeLayerId).then(() => { forceUpdate(); notify("Edit this contents tab, then choose Layer → Apply Contents to Parent"); }).catch(error => notify(error instanceof Error ? error.message : "Unable to open contents"));
        return;
      case "apply-smart-content":
        if (studio) void studio.applySmartContents().then(id => { setActiveLayerId(id); forceUpdate(); notify("Contents applied · editable source saved inside the parent .luma project"); }).catch(error => notify(error instanceof Error ? error.message : "Unable to apply contents"));
        return;
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
      case "recolor":
        if (studio && activeLayerId && !recolorSession) {
          try { setRecolorSession(studio.prepareRecolor(activeLayerId)); }
          catch (error) { notify(error instanceof Error ? error.message : "Unable to open Recolor"); }
        }
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
      case "hsl":
        if (studio) {
          const layer = studio.addHslLayer();
          setActiveLayerId(layer.id);
          focusInspector("properties");
        }
        return;

      case "filter-gallery": setShowFilters(true); return;
      case "filter-invert":
      case "filter-blur":
      case "filter-sharpen":
      case "filter-desaturate": {
        if (!studio || !activeLayerId || activeLayer?.kind !== "raster" || !activeLayer.bitmap || activeLayer.locked) {
          notify("Select an unlocked raster layer to apply this filter");
          return;
        }
        if (command === "filter-invert") studio.filter(activeLayerId, "invert");
        else if (command === "filter-blur") studio.filter(activeLayerId, "blur", { radius: blurRadius });
        else if (command === "filter-sharpen") studio.filter(activeLayerId, "sharpen", { radius: 2, amount: sharpAmount });
        else studio.filter(activeLayerId, "desaturate", { amount: 1 });
        forceUpdate();
        return;
      }

      case "zoom-in": setView(v => zoomViewToScale(v, fitScale, v.zoom * fitScale * 1.2)); return;
      case "zoom-out": setView(v => zoomViewToScale(v, fitScale, v.zoom * fitScale / 1.2)); return;
      case "zoom-fit": setView({ zoom: 1, panX: 0, panY: 0 }); return;
      case "zoom-actual": setZoomPercent(100); return;
      case "toggle-guides": setShowGuides((visible) => !visible); return;
      case "toggle-rulers": toggleRulers(); return;

      case "panel-layers": focusInspector("layers"); setNativePanelOverride(null); return;
      case "panel-properties": focusInspector("properties"); return;
      case "panel-selection": openStudioPanel("selection"); return;
      case "panel-mask": openStudioPanel("mask"); return;
      case "panel-raw": openStudioPanel("raw"); return;
      case "panel-paint": openStudioPanel("paint"); return;
      case "panel-vector": openStudioPanel("vector"); return;
      case "panel-transform": openStudioPanel("transform"); return;
      case "panel-measure": openStudioPanel("measure"); return;
      case "panel-document": openStudioPanel("document"); setNativePanelOverride(null); return;
      case "panel-channels": openStudioPanel("channels"); setNativePanelOverride(null); return;
      case "panel-comps": openStudioPanel("structure"); setNativePanelOverride(null); return;
      case "panel-campaign": openStudioPanel("campaign"); setNativePanelOverride(null); return;
      case "panel-assets": openStudioPanel("assets"); setNativePanelOverride(null); return;
      case "panel-neural": focusInspector("ai"); return;
      case "panel-actions": openStudioPanel("actions"); setNativePanelOverride(null); return;
      case "workspace-settings": setShowWorkspaceSettings(true); return;
    }
    const exhaustive: never = command;
    return exhaustive;
  };

  const commandRegistry = createCommandRegistry({
    enabled: (command) => {
      if (!startupReady) return false;
      if (desktopUpdateInstalling || projectSaving || nativeOpening || pendingCloseDocumentId || pendingNativeClose || layerRenameTarget || showExportMenu || printTarget || vectorTarget || recolorSession) return false;
      if (showMockups || showGlyph || showUpscale || showThumb) return false;
      if (command === "mockups") return Boolean(studio);
      if (command === "cutout") return Boolean(studio && activeLayer?.kind === "raster" && activeLayer.bitmap && !cutoutProgress);
      if (command === "upscale") return Boolean(studio && activeLayer?.kind === "raster" && activeLayer.bitmap);
      if (command === "thumb") return Boolean(studio);
      if (command === "export-print") return Boolean(studio && isNativeFilesystemAvailable() && studio.doc.bitDepth === 8 && studio.doc.colorSpace === "srgb" && studio.doc.width * studio.doc.height <= 4_000_000);
      if (command === "new-document" || command === "close-document") return Boolean(studio && startupReady);
      if (command === "undo") return studio?.canUndo() ?? false;
      if (command === "redo") return studio?.canRedo() ?? false;
      if (command === "group-layer") return Boolean(studio && !studio.layerBatchReason(selectedLayerIds, "group"));
      if (command === "ungroup-layers") return Boolean(studio && !studio.layerBatchReason(selectedLayerIds, "ungroup"));
      if (command === "merge-layers") return Boolean(studio && !studio.layerBatchReason(selectedLayerIds, "merge"));
      if (command === "delete-layer") return Boolean(studio && !studio.layerBatchReason(selectedLayerIds, "delete"));
      if (command === "rename-layer") return Boolean(studio && selectedLayerIds.length === 1);
      if (["layer-style", "copy-layer-style", "paste-layer-style", "bring-forward", "send-backward"].includes(command) && selectedLayerIds.length !== 1) return false;
      if (command === "bring-forward" || command === "send-backward") return Boolean(studio && activeLayerId && !studio.layerBatchReason([activeLayerId], "group"));
      if (["toggle-layer-lock", "toggle-layer-visibility"].includes(command)) return Boolean(studio && selectedLayerIds.length);
      const pixelTarget = resolvedFocusState.scope?.target !== "mask";
      if (command === "select-subject") return Boolean(studio && activeLayer?.kind === "raster" && activeLayer.bitmap && !neural);
      if (command === "copy-merged") return Boolean(studio && doc?.layers.length);
      if (command === "copy-pixels" || command === "selection-to-layer") return Boolean(studio && pixelTarget && activeLayer && activeLayer.kind !== "group" && !activeLayer.kind.startsWith("adjustment-"));
      if (command === "cut-pixels" || command === "delete-pixels") return Boolean(studio && pixelTarget && activeLayer?.kind === "raster" && !activeLayer.locked && (activeLayer.bitmap || activeLayer.surface) && (command !== "cut-pixels" || doc?.bitDepth === 8));
      if (command === "paste-pixels") return Boolean(studio);
      if (command === "paste-in-place") return Boolean(studio?.hasPixelClipboard());
      if (["save", "save-as", "export", "document-properties", "select-all", "select-channel", "deselect", "invert-selection", "crop-selection"].includes(command)) return Boolean(studio);
      if (command === "replace-smart-content") return Boolean(studio && !smartContentUnavailableReason(studio.doc, activeLayer ?? undefined));
      if (command === "edit-smart-content") return Boolean(studio && !smartContentUnavailableReason(studio.doc, activeLayer ?? undefined, "edit"));
      if (command === "apply-smart-content") return !!studio?.canApplySmartContents();
      if (command.startsWith("channel-")) {
        const channels = studio?.doc.alphaChannels ?? [];
        const selected = channels.some(channel => channel.id === alphaDraft.id);
        if (command === "channel-save") return !!studio?.doc.selection && channels.length < 64;
        if (command === "channel-update") return selected && !!studio?.doc.selection;
        if (command === "channel-calculate") return selected && channels.length < 64 && channels.some(channel => channel.id === alphaDraft.otherId);
        return selected;
      }
      if (command === "convert-smart-object") return Boolean(studio && activeLayer?.kind === "raster" && activeLayer.bitmap && !activeLayer.locked);
      if (["duplicate-layer", "group-layer", "delete-layer", "bring-forward", "send-backward", "layer-style", "copy-layer-style"].includes(command)) return Boolean(studio && activeLayerId);
      if (command === "paste-layer-style") return Boolean(studio && activeLayerId && !activeLayer?.locked);
      if (command === "recolor") return Boolean(studio && selectedLayerIds.length === 1 && activeLayer && !activeLayer.locked && !recolorSession);
      if (command === "define-custom-shape") return Boolean(studio && (activeLayer?.path || activeLayer?.shape) && !activeLayer?.parentId && shapeLibraryReady && customShapes.length < SHAPE_LIBRARY_LIMIT);
      if (["filter-invert", "filter-blur", "filter-sharpen", "filter-desaturate"].includes(command)) {
        return Boolean(studio && activeLayer?.kind === "raster" && activeLayer.bitmap && !activeLayer.locked);
      }
      return true;
    },
    checked: (command) => {
      if (command === "toggle-guides") return showGuides;
      if (command === "toggle-rulers") return showRulers;
      const panelId: PanelId | null = command === "panel-properties" ? "properties"
        : command === "panel-selection" ? "selection" : command === "panel-mask" ? "mask"
        : command === "panel-raw" ? "raw" : command === "panel-paint" ? "paint"
        : command === "panel-vector" ? "vector" : command === "panel-transform" ? "transform"
        : command === "panel-measure" ? "measure" : command === "panel-layers" ? "layers"
        : command === "panel-document" ? "document"
          : command === "panel-channels" ? "channels"
            : command === "panel-comps" ? "structure"
            : command === "panel-campaign" ? "campaign"
              : command === "panel-assets" ? "assets"
                : command === "panel-neural" ? "neural"
                  : command === "panel-actions" ? "actions"
                    : null;
      return panelId !== null && (
        dockLayout.groups.some((group) => group.panelIds.includes(panelId))
        || dockLayout.floating.some((panel) => panel.panelId === panelId)
      );
    },
  });
  const executeStudioCommand = (command: StudioCommand) => {
    if (projectSavingRef.current || nativeOpeningRef.current || pendingCloseDocumentId || pendingNativeClose || desktopUpdateInstalling) return;
    if (isEditableTextTarget(document.activeElement) && ["undo", "redo", "select-all"].includes(command)) {
      document.execCommand(command === "select-all" ? "selectAll" : command);
      return;
    }
    if (isEditableTextTarget(document.activeElement) && ["copy-pixels", "copy-merged", "cut-pixels", "paste-pixels", "paste-in-place", "delete-pixels", "selection-to-layer"].includes(command)) return;
    if (showNewDocument || pdfChoiceResolver.current || printTarget || vectorTarget) return;
    try { commandRegistry.execute(command, runStudioCommand); }
    catch (error) { notify(error instanceof Error ? error.message : "Layer operation failed"); }
  };
  const menuPublisherRef = useRef<ReturnType<typeof createMenuStatePublisher> | null>(null);
  const menuStateRef = useRef<Record<string, boolean>>({});
  const menuStateJson = JSON.stringify(Object.fromEntries(commandRegistry.all().map(command => [command.id, startupReady && !showNewDocument && !pdfChoice && command.enabled()])));
  useEffect(() => {
    if (!desktop) return;
    const publisher = createMenuStatePublisher(publishNativeMenuState);
    menuPublisherRef.current = publisher;
    const refresh = () => {
      const states = { ...menuStateRef.current };
      if (!projectSavingRef.current && isEditableTextTarget(document.activeElement)) {
        states.undo = true; states.redo = true; states["select-all"] = true;
      }
      publisher.publish(states);
    };
    const afterFocus = () => queueMicrotask(refresh);
    document.addEventListener("focusin", afterFocus);
    document.addEventListener("focusout", afterFocus);
    refresh();
    return () => { publisher.dispose(); menuPublisherRef.current = null; document.removeEventListener("focusin", afterFocus); document.removeEventListener("focusout", afterFocus); };
  }, [desktop]);
  useEffect(() => {
    menuStateRef.current = JSON.parse(menuStateJson);
    menuPublisherRef.current?.publish(menuStateRef.current);
  }, [menuStateJson]);

  const spaceDeckContext = resolveSpaceDeckContext({
    layer: activeLayer,
    tool: activeTool,
    hasSelection: Boolean(doc?.selection),
  });
  const contextualSpaceCommands = spaceDeckCommands({
    layer: activeLayer,
    tool: activeTool,
    hasSelection: Boolean(doc?.selection),
  });
  const spaceToolLabel = Object.values(modeTools).flat().find(([tool]) => tool === activeTool)?.[2] ?? "Canvas";
  /* eslint-disable react-hooks/refs -- These callbacks are data handed to the HUD's event handlers; the feature builder never invokes them during render. */
  const baseSpaceToolFeatures: SpaceDeckFeature[] = (() => {
    const range = (
      id: string,
      label: string,
      value: number,
      min: number,
      max: number,
      step: number,
      output: string,
      onChange: (next: number) => void,
      onCommit?: () => void,
    ): SpaceDeckFeature => ({ kind: "range", id, label, value, min, max, step, output, onChange, onCommit });
    const choice = (
      id: string,
      label: string,
      value: string,
      options: ReadonlyArray<{ value: string; label: string }>,
      onChange: (next: string) => void,
    ): SpaceDeckFeature => ({ kind: "choice", id, label, value, options, onChange });
    const toggle = (
      id: string,
      label: string,
      detail: string,
      value: boolean,
      onChange: (next: boolean) => void,
    ): SpaceDeckFeature => ({ kind: "toggle", id, label, detail, value, onChange });
    const color = (id: string, label: string, value: string, onChange: (next: string) => void): SpaceDeckFeature => (
      { kind: "color", id, label, value, onChange }
    );
    const action = (
      id: string,
      label: string,
      detail: string,
      icon: string,
      onRun: () => void,
      disabled = false,
    ): SpaceDeckFeature => ({ kind: "action", id, label, detail, icon, onRun, disabled });

    const brushCore = (maximum = activeTool === "capture-brush" ? 1200 : 400): SpaceDeckFeature[] => [
      range("size", "Size", brushSize, 1, maximum, 1, `${Math.round(brushSize)} px`, setBrushSize),
      ...(activeTool === "pencil" ? [] : [range("hardness", "Hardness", hardness * 100, 0, 100, 1, `${Math.round(hardness * 100)}%`, (value) => setHardness(value / 100))]),
      range("opacity", "Opacity", brushOpacity * 100, 1, 100, 1, `${Math.round(brushOpacity * 100)}%`, (value) => setBrushOpacity(value / 100)),
      range("flow", "Flow", brushFlow * 100, 1, 100, 1, `${Math.round(brushFlow * 100)}%`, (value) => setBrushFlow(value / 100)),
    ];

    if (activeTool === "capture-brush") return [
      ...brushCore(1200),
      range("sample-radius", "Sample radius", captureRadius, 2, 512, 1, `${captureRadius} px`, setCaptureRadius),
      choice("capture-mode", "Color mode", capturedBrushMode, [
        { value: "color", label: "Full color" },
        { value: "tint", label: "Tint with paint" },
        { value: "stencil", label: "Dark-pixel stencil" },
        { value: "material", label: "Material transfer" },
      ], (value) => setCapturedBrushMode(value as ImageBrushMode)),
      toggle("sample-merged", "Merged source", "Sample the visible composite", captureSampleMerged, setCaptureSampleMerged),
      toggle("living-source", "Living source", "Refresh the sampled pixels at every stroke", captureLive, setCaptureLive),
      action("sample-canvas", "Sample canvas", "Click the image to capture", "◎", () => { setCaptureSampling(true); setCaptureSource(null); }),
      action("upload-tip", "Upload image", "Build a brush from a file", "↗", () => captureInput.current?.click()),
    ];

    if (activeTool === "gradient") return [
      color("start-color", "Start color", brushColor, setBrushColor),
      color("end-color", "End color", secondaryColor, setSecondaryColor),
      choice("gradient-type", "Gradient", gradientType, [
        { value: "linear", label: "Linear" }, { value: "radial", label: "Radial" },
      ], (value) => setGradientType(value as typeof gradientType)),
    ];

    if (activeTool === "pattern") return [
      color("pattern-primary", "Primary", brushColor, setBrushColor),
      color("pattern-secondary", "Secondary", secondaryColor, setSecondaryColor),
      choice("pattern-kind", "Pattern", patternKind, [
        { value: "checker", label: "Checker" }, { value: "stripes", label: "Stripes" }, { value: "dots", label: "Dots" },
      ], (value) => setPatternKind(value as PatternKind)),
      range("pattern-scale", "Scale", patternScale, 2, 160, 1, `${patternScale} px`, setPatternScale),
    ];

    if (activeTool === "fill") return [
      color("fill-color", "Fill color", brushColor, setBrushColor),
      color("fill-secondary", "Pattern accent", secondaryColor, setSecondaryColor),
      range("fill-opacity", "Opacity", brushOpacity * 100, 1, 100, 1, `${Math.round(brushOpacity * 100)}%`, (value) => setBrushOpacity(value / 100)),
    ];

    if (activeTool === "mask-add" || activeTool === "mask-remove") return [
      ...brushCore(),
      toggle("pressure-size", "Pressure size", "Pen pressure changes radius", pressureSize, setPressureSize),
      toggle("pressure-opacity", "Pressure opacity", "Pen pressure changes strength", pressureOpacity, setPressureOpacity),
    ];

    if (paintingTool || retouchTool) {
      const sampleTool = activeTool === "clone" || activeTool === "heal" || activeTool === "patch";
      return [
        ...brushCore(),
        ...(activeTool === "pencil" ? [] : [
          range("smoothing", "Smoothing", brushSmoothing * 100, 0, 100, 1, `${Math.round(brushSmoothing * 100)}%`, (value) => setBrushSmoothing(value / 100)),
          range("spacing", "Spacing", brushSpacing * 100, 1, 100, 1, `${Math.round(brushSpacing * 100)}%`, (value) => setBrushSpacing(value / 100)),
        ]),
        ...(activeTool === "brush" || activeTool === "mixer" ? [
          range("roundness", "Roundness", brushRoundness * 100, 10, 100, 1, `${Math.round(brushRoundness * 100)}%`, (value) => setBrushRoundness(value / 100)),
          range("scatter", "Scatter", brushScatter * 100, 0, 100, 1, `${Math.round(brushScatter * 100)}%`, (value) => setBrushScatter(value / 100)),
        ] : []),
        ...(sampleTool ? [action(
          "sample-source",
          retouchSample ? "Clear source" : "Set source",
          retouchSample ? `${Math.round(retouchSample.x)}, ${Math.round(retouchSample.y)}` : "Alt-click on the canvas",
          "◎",
          () => setRetouchSample(null),
        )] : []),
      ];
    }

    if (marqueeTool || lassoTool || wandTool || pointSelectionTool || activeTool === "sel-sam") return [
      choice("selection-mode", "Combine", selectionMode, [
        { value: "replace", label: "New selection" }, { value: "add", label: "Add" },
        { value: "subtract", label: "Subtract" }, { value: "intersect", label: "Intersect" },
      ], (value) => setSelectionMode(value as SelectionCombineMode)),
      range("feather", "Feather", feather, 0, 200, 1, `${feather} px`, setFeather),
      range("selection-smooth", "Smooth", selectionSmooth, 0, 100, 1, `${selectionSmooth}`, setSelectionSmooth),
      range("selection-contrast", "Contrast", selectionContrast, 0, 100, 1, `${selectionContrast}%`, setSelectionContrast),
      range("selection-shift", "Edge shift", selectionShift, -100, 100, 1, `${selectionShift}%`, setSelectionShift),
      ...(wandTool || activeTool === "sel-magnetic" ? [
        range("tolerance", "Tolerance", wandTolerance, 0, 255, 1, `${wandTolerance}`, setWandTolerance),
      ] : []),
      ...([ ["copy-pixels", "Copy", "Copy selected pixels", "⧉"], ["cut-pixels", "Cut", "Copy and remove selected pixels", "✂"], ["paste-pixels", "Paste", "Paste pixels as a new layer", "+"], ["delete-pixels", "Delete", "Clear selected pixels", "⌫"] ] as const).map(([id, label, detail, icon]) => action(id, label, detail, icon, () => executeStudioCommand(id), !commandRegistry.enabled(id))),
    ];

    if (activeTool === "tone" && activeLayer?.kind.startsWith("adjustment-") && activeLayer.kind !== "adjustment-tone") return [action(
      "open-adjustment-editor",
      "Open adjustment editor",
      `${activeLayer.name} has dedicated controls`,
      "↗",
      () => {
        setNativePanelOverride(null);
        setWorkspace("develop");
        selectInspectorTab("properties");
      },
    )];

    if (activeTool === "tone") return toneRows.map(([key, label, min, max, step]) => range(
      `tone-${key}`,
      label,
      tone[key],
      min,
      max,
      step,
      `${tone[key] > 0 ? "+" : ""}${tone[key].toFixed(step < 1 ? 2 : 0)}`,
      (value) => onToneChange(key, value),
      onToneCommit,
    ));

    const typeTool = ["text", "paragraph-text", "vertical-text", "path-text", "type-mask"].includes(activeTool);
    if (typeTool) {
      const textLayer = activeLayer?.kind === "text" ? activeLayer : null;
      const activeTypeStyle = textLayer?.text ? resolvedDefaultTextStyle(textLayer.text) : null;
      const activeSize = activeTypeStyle?.fontSize ?? textSize;
      const updateDefaultType = (patch: Parameters<typeof withDefaultTextStyle>[1], live = false) => {
        if (!textLayer?.text) return;
        const update = withDefaultTextStyle(textLayer.text, patch);
        if (live) studio?.liveUpdateText(textLayer.id, update);
        else studio?.updateText(textLayer.id, update);
      };
      return [
        {
          kind: "text", id: "text-content", label: "Text", value: textLayer?.text?.text ?? textDraft,
          placeholder: "Type…",
          // Live per keystroke, matching every range control in this same
          // panel (onChange for feedback, onCommit to fold the burst into one
          // undo step). Calling updateText directly here — as this used to —
          // meant every character typed created its own history entry, so
          // undoing one word of typing took one Cmd+Z per letter.
          onChange: (value) => {
            setTextDraft(value);
            if (textLayer?.text) studio?.liveUpdateText(textLayer.id, { text: value });
          },
          onCommit: () => { if (textLayer?.text) studio?.updateText(textLayer.id, { text: textDraft }); },
        },
        range("text-size", "Font size", activeSize, 8, 500, 1, `${activeSize} px`, (value) => {
          setTextSize(value);
          updateDefaultType({ fontSize: value, axes: { ...(activeTypeStyle?.axes ?? {}), opsz: value } }, true);
        }, () => { if (textLayer?.text) studio?.updateText(textLayer.id, {}); }),
        color("text-color", "Color", activeTypeStyle?.color ?? brushColor, (value) => {
          setBrushColor(value);
          updateDefaultType({ color: value });
        }),
        ...(textLayer?.text ? [
          choice("font-family", "Typeface", activeTypeStyle!.fontFamily, FONT_CHOICES.some(font => font.value === activeTypeStyle!.fontFamily) ? FONT_CHOICES : [{ label: `${activeTypeStyle!.fontFamily.split(",")[0]} · current`, value: activeTypeStyle!.fontFamily }, ...FONT_CHOICES], (value) => updateDefaultType({ fontFamily: value })),
          choice("font-weight", "Weight", `${Math.round(activeTypeStyle!.fontWeight / 100) * 100}`, [100, 200, 300, 400, 500, 600, 700, 800, 900].map((value) => ({ value: `${value}`, label: `${value}` })), (value) => updateDefaultType({ fontWeight: Number(value), axes: { ...activeTypeStyle!.axes, wght: Number(value) } })),
          range("tracking", "Tracking", activeTypeStyle!.tracking, -100, 600, 10, `${activeTypeStyle!.tracking}`, (value) => updateDefaultType({ tracking: value }, true), () => studio?.updateText(textLayer.id, {})),
          range("line-height", "Leading", textLayer.text.lineHeight, 0.5, 3, 0.05, `${textLayer.text.lineHeight.toFixed(2)}×`, (value) => studio?.liveUpdateText(textLayer.id, { lineHeight: value }), () => studio?.updateText(textLayer.id, {})),
          range("paragraph-spacing", "Paragraph gap", textLayer.text.paragraphSpacing ?? 0, 0, 3, 0.1, `${(textLayer.text.paragraphSpacing ?? 0).toFixed(1)}×`, (value) => studio?.liveUpdateText(textLayer.id, { paragraphSpacing: value }), () => studio?.updateText(textLayer.id, {})),
          choice("text-align", "Alignment", textLayer.text.align, [
            { value: "left", label: "Left" }, { value: "center", label: "Center" }, { value: "right", label: "Right" },
          ], (value) => studio?.updateText(textLayer.id, { align: value as "left" | "center" | "right" })),
          choice("text-direction", "Direction", textLayer.text.direction ?? "auto", [
            { value: "auto", label: "Automatic" }, { value: "ltr", label: "Left to right" }, { value: "rtl", label: "Right to left" },
          ], (value) => studio?.updateText(textLayer.id, { direction: value as "auto" | "ltr" | "rtl" })),
          ...(textLayer.text.layout === "paragraph" ? [toggle("justify", "Justify", "Stretch paragraph lines", textLayer.text.justify ?? false, (value) => studio?.updateText(textLayer.id, { justify: value }))] : []),
        ] : []),
      ];
    }

    if (SHAPE_TOOLS.has(activeTool)) return [
      choice("shape-preset", "New shape", currentShapeSettings.preset, [...SHAPE_PRESETS.map(s => ({ value: s.id, label: s.label })), ...customShapes.map(s => ({ value: s.id, label: s.name }))], chooseShapePreset),
      color("new-shape-fill", "New fill", brushColor, setBrushColor),
      toggle("new-shape-filled", "Fill", "Fill new shapes", shapeSettings.filled, value => setShapeSettings(s => ({ ...s, filled: value }))),
      color("new-shape-stroke", "New stroke", shapeSettings.stroke, value => setShapeSettings(s => ({ ...s, stroke: value }))),
      range("new-shape-width", "Stroke width", shapeSettings.strokeWidth, currentShapeSettings.preset === "line" ? 1 : 0, 100, 1, `${shapeSettings.strokeWidth} px`, value => setShapeSettings(s => ({ ...s, strokeWidth: value }))),
      ...(["polygon", "star"].includes(currentShapeSettings.preset) ? [range("shape-sides", "Sides / points", shapeSettings.sides, 3, 64, 1, `${shapeSettings.sides}`, value => setShapeSettings(s => ({ ...s, sides: value })))] : []),
      ...(currentShapeSettings.preset === "star" ? [range("shape-inner", "Inner radius", shapeSettings.innerRatio * 100, 5, 95, 1, `${Math.round(shapeSettings.innerRatio * 100)}%`, value => setShapeSettings(s => ({ ...s, innerRatio: value / 100 })))] : []),
      ...(currentShapeSettings.preset === "rect" ? [range("shape-radius", "Corner radius", shapeSettings.radius, 0, 200, 1, `${shapeSettings.radius} px`, value => setShapeSettings(s => ({ ...s, radius: value })))] : []),
      action("save-shape", "Save selected outline", "Reuse selected vector geometry", "◇", () => executeStudioCommand("define-custom-shape"), !commandRegistry.enabled("define-custom-shape")),
    ];
    const shapeTool = activeTool === "frame";
    if (shapeTool) {
      const shapeLayer = activeLayer?.kind === "shape" ? activeLayer : null;
      return [
        color("shape-fill", "Fill", shapeLayer?.shape?.fill ?? brushColor, (value) => {
          setBrushColor(value);
          if (shapeLayer?.shape) studio?.updateShape(shapeLayer.id, { fill: value });
        }),
        ...(shapeLayer?.shape ? [
          color("shape-stroke", "Stroke", shapeLayer.shape.stroke, (value) => studio?.updateShape(shapeLayer.id, { stroke: value })),
          range("stroke-width", "Stroke width", shapeLayer.shape.strokeWidth, 0, 100, 1, `${shapeLayer.shape.strokeWidth} px`, (value) => studio?.liveUpdateShape(shapeLayer.id, { strokeWidth: value }), () => studio?.updateShape(shapeLayer.id, {})),
          range("corner-radius", "Corner radius", shapeLayer.shape.radius, 0, 200, 1, `${shapeLayer.shape.radius} px`, (value) => studio?.liveUpdateShape(shapeLayer.id, { radius: value }), () => studio?.updateShape(shapeLayer.id, {})),
          choice("shape-geometry", "Geometry", shapeLayer.shape.kind, [
            { value: "rect", label: "Rectangle" }, { value: "ellipse", label: "Ellipse" },
          ], (value) => studio?.updateShape(shapeLayer.id, { kind: value as "rect" | "ellipse" })),
        ] : []),
      ];
    }

    if (activeTool === "pen") return [
      toggle("pen-snap", "Snap", "Anchors, guides and canvas edges · Option bypasses", penSettings.snap, value => updatePenSettings({ snap: value })),
      toggle("pen-grid", "Grid snap", "Snap near grid intersections", penSettings.grid, value => updatePenSettings({ grid: value })),
      range("pen-grid-spacing", "Grid spacing", penSettings.gridSize, 1, 1000, 1, `${penSettings.gridSize} px`, value => updatePenSettings({ gridSize: value })),
      choice("pen-angle", "Shift angle", String(penSettings.angleStep), [15, 30, 45, 90].map(a => ({ value: String(a), label: `${a}°` })), value => updatePenSettings({ angleStep: Number(value) })),
      toggle("pen-measure", "Measurements", "Chord / handle length, angle and deltas", penSettings.measurements, value => updatePenSettings({ measurements: value })),
      color("pen-fill", "Path color", brushColor, setBrushColor),
      action("finish-path", "Finish open path", "Commit current anchors · Enter", "↗", () => commitPenPath(false), penDraft.length < 2),
      action("close-path", "Close path", "Join first and last anchor", "◇", () => commitPenPath(true), penDraft.length < 2),
    ];
    if (activeTool === "path-select" || activeTool === "direct-select") return [
      color("path-fill", "Path fill", activeLayer?.path?.fill ?? brushColor, (value) => {
        setBrushColor(value);
        if (activeLayer?.path) studio?.updatePath(activeLayer.id, { ...activeLayer.path, fill: value });
      }),
      action("finish-path", "Finish open path", "Commit current anchors", "↗", () => commitPenPath(false), penDraft.length < 2),
      action("close-path", "Close path", "Join first and last anchor", "◇", () => commitPenPath(true), penDraft.length < 2),
    ];

    if (activeTool === "radial-warp") return [
      range("warp-radius", "Influence", warpRadius, 20, 1200, 1, `${warpRadius} px`, setWarpRadius),
      toggle("warp-overlay", "Overlay", "Show the influence ring", showRadialOverlay, setShowRadialOverlay),
      toggle("show-guides", "Guides", "Show alignment guides", showGuides, setShowGuides),
      action("fit-warp", "Fit canvas", "See the full warp area", "⌗", () => setView({ zoom: 1, panX: 0, panY: 0 })),
    ];

    if (["crop", "perspective-crop", "straighten", "content-move", "perspective-warp"].includes(activeTool)) return [
      range("view-zoom", "View zoom", zoomPercent, 0.01, 3200, 0.01, `${zoomPercent}%`, setZoomPercent),
      toggle("show-guides", "Guides", "Show alignment guides", showGuides, setShowGuides),
      toggle("snap-guides", "Snap", "Snap transforms to guides", snapGuides, setSnapGuides),
      ...(activeTool === "content-move" ? [range("move-feather", "Selection feather", feather, 0, 200, 1, `${feather} px`, setFeather)] : []),
      action("fit-transform", "Fit canvas", "Reset framing", "⌗", () => setView({ zoom: 1, panX: 0, panY: 0 })),
    ];

    if (activeTool === "eyedropper" || activeTool === "color-sampler" || activeTool === "ruler") return [
      color("sample-color", "Current color", brushColor, setBrushColor),
      ...(activeTool === "color-sampler" ? [action("clear-samples", "Clear samples", `${colorSamples.length} saved`, "×", () => setColorSamples([]), colorSamples.length === 0)] : []),
      ...(activeTool === "ruler" ? [action("clear-ruler", "Clear ruler", measurement ? "Remove measurement" : "No measurement", "×", () => setMeasurement(null), !measurement)] : []),
      range("measure-zoom", "View zoom", zoomPercent, 0.01, 3200, 0.01, `${zoomPercent}%`, setZoomPercent),
    ];

    if (moveTool && activeLayer) return [
      choice("transform-mode", "Transform mode", transformMode, [
        { value: "scale", label: "Transform" }, { value: "skew", label: "Skew" },
        ...(!studio?.distortionUnavailableReason(activeLayer.id) ? [{ value: "distort", label: "Distort" }] : []),
      ], (value) => changeTransformMode(value as TransformMode)),
      toggle("move-auto-select", "Auto-select", "Select the layer under the pointer", autoSelectMove, setAutoSelectMove),
      toggle("move-handles", "Handles", "Show transform handles", showTransformHandles, setShowTransformHandles),
      toggle("move-snap", "Snap", "Option/Alt bypasses snapping", snapGuides, setSnapGuides),
      ...(distortDraft ? [action("apply-distort", "Apply distortion", "Rasterizes the draft · undoable", "✓", applyDistortion), action("cancel-distort", "Cancel", "Discard the draft", "×", cancelTransformGesture)] : []),
    ];

    if (activeLayer) return [
      range("layer-opacity", "Layer opacity", activeLayer.opacity * 100, 0, 100, 1, `${Math.round(activeLayer.opacity * 100)}%`, (value) => setLayerOpacity(activeLayer.id, value / 100)),
      toggle("layer-visible", "Visible", "Show this layer", activeLayer.visible, (value) => setLayerVisible(activeLayer.id, value)),
      toggle("layer-lock", "Locked", "Protect layer pixels", Boolean(activeLayer.locked), (value) => studio?.setLayerProp(activeLayer.id, "locked", value, "Layer lock")),
      toggle("snap-move", "Snap", "Snap movement to guides", snapGuides, setSnapGuides),
      action("focus-active", "Focus layer", "Isolate the active layer", "◎", () => enterFocusMode(activeLayer.id)),
    ];

    return [
      range("canvas-zoom", "View zoom", zoomPercent, 0.01, 3200, 0.01, `${zoomPercent}%`, setZoomPercent),
      toggle("canvas-guides", "Guides", "Show alignment guides", showGuides, setShowGuides),
      toggle("canvas-snap", "Snap", "Snap tools to guides", snapGuides, setSnapGuides),
    ];
  })();
  const activeSpatial = activeLayer?.spatial ?? activeLayer?.text?.spatial ?? DEFAULT_TEXT_SPATIAL;
  const supportsSpatialPreview = Boolean(
    activeLayer
    && activeLayer.kind !== "group"
    && !activeLayer.kind.startsWith("adjustment-"),
  );
  const spatialSpaceFeatures: SpaceDeckFeature[] = activeLayer && !activeLayer.lettering3d && !activeLayer.mesh3d ? [
    ...(supportsSpatialPreview ? [{
      kind: "toggle" as const,
      id: "spatial-enabled",
      label: "3D workspace",
      detail: "Tilt and depth for this layer",
      value: activeSpatial.enabled,
      onChange: (enabled: boolean) => studio?.updateLayerSpatial(activeLayer.id, { enabled }),
    }] : []),
    ...(supportsSpatialPreview && activeSpatial.enabled ? [
      {
        kind: "range" as const,
        id: "spatial-tilt-x",
        label: "3D tilt X",
        value: activeSpatial.transform.rotationX,
        min: -180,
        max: 180,
        step: 1,
        output: `${Math.round(activeSpatial.transform.rotationX)}°`,
        onChange: (rotationX: number) => studio?.liveUpdateLayerSpatial(activeLayer.id, { transform: { rotationX } }),
        onCommit: () => studio?.updateLayerSpatial(activeLayer.id, {}),
      },
      {
        kind: "range" as const,
        id: "spatial-tilt-y",
        label: "3D tilt Y",
        value: activeSpatial.transform.rotationY,
        min: -180,
        max: 180,
        step: 1,
        output: `${Math.round(activeSpatial.transform.rotationY)}°`,
        onChange: (rotationY: number) => studio?.liveUpdateLayerSpatial(activeLayer.id, { transform: { rotationY } }),
        onCommit: () => studio?.updateLayerSpatial(activeLayer.id, {}),
      },
      {
        kind: "range" as const,
        id: "spatial-depth",
        label: "3D depth",
        value: activeSpatial.extrusion.depth,
        min: 0,
        max: 1000,
        step: 1,
        output: `${Math.round(activeSpatial.extrusion.depth)} px`,
        onChange: (depth: number) => studio?.liveUpdateLayerSpatial(activeLayer.id, { extrusion: { depth } }),
        onCommit: () => studio?.updateLayerSpatial(activeLayer.id, {}),
      },
    ] : []),
    {
      kind: "action" as const,
      id: "send-layer-to-form",
      label: "Send to Form Studio",
      detail: "Export the selected layer",
      icon: "↗",
      onRun: () => { void sendLayerToForm(activeLayer); },
    },
  ] : [];
  const spaceToolFeatures: SpaceDeckFeature[] = [...baseSpaceToolFeatures, ...spatialSpaceFeatures,
    ...(activeLayer && ["text","shape","path"].includes(activeLayer.kind) ? [{kind:"action" as const,id:"campaign-workspace",label:"Campaign",detail:"Linked styles, formats & delivery",icon:"▦",onRun:()=>executeStudioCommand("panel-campaign")}] : [])];
  /* eslint-enable react-hooks/refs */
  const spaceToolFeatureCount = spaceToolFeatures.length;
  const { width: spaceDeckWidth, height: spaceDeckHeight } = spaceDeckDimensions(spaceToolFeatureCount);
  const latestSpaceCommands = useRef(contextualSpaceCommands);
  useEffect(() => {
    latestSpaceCommands.current = contextualSpaceCommands;
  }, [contextualSpaceCommands]);

  const openSpaceDeck = useCallback((pinned = false) => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return;
    const anchor = spacePointerRef.current ?? { x: rect.width / 2, y: rect.height / 2 };
    setPassDeckPosition(clampSpaceDeckPosition(
      anchor,
      { width: rect.width, height: rect.height },
      { width: spaceDeckWidth, height: spaceDeckHeight },
    ));
    spaceGestureRef.current = "deck";
    setPassDeckPinned(pinned);
    setPassDeckOpen(true);
  }, [spaceDeckHeight, spaceDeckWidth]);

  useEffect(() => {
    if (!passDeckOpen) return;
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPassDeckPosition((current) => clampSpaceDeckPosition(
      { x: current.x + spaceDeckWidth / 2, y: current.y + spaceDeckHeight / 2 },
      { width: rect.width, height: rect.height },
      { width: spaceDeckWidth, height: spaceDeckHeight },
    ));
  }, [passDeckOpen, spaceDeckHeight, spaceDeckWidth]);

  const runSpaceDeckCommand = (command: SpaceDeckCommand) => {
    switch (command.id) {
      case "fit-canvas": setView({ zoom: 1, panX: 0, panY: 0 }); break;
      case "new-layer": addBlank(); break;
      case "open-document": requestDocumentOpen(); break;
      case "show-history": setShowHistory(true); break;
      case "deselect": studio?.deselect(); break;
      case "invert-selection": studio?.invertSelectionArea(); break;
      case "feather-selection": studio?.featherSelection(feather || 4); break;
      case "selection-ai": activateTool("sel-sam", "select"); focusInspector("ai"); break;
      case "mask-reveal": activateTool("mask-add", "mask"); break;
      case "mask-hide": activateTool("mask-remove", "mask"); break;
      case "invert-mask": if (activeLayerId) studio?.invertMask(activeLayerId); break;
      case "focus-mask": if (activeLayerId) enterFocusMode(activeLayerId, "mask"); break;
      case "brush-smaller": setBrushSize((value) => Math.max(1, Math.round(value * 0.8))); break;
      case "brush-larger": setBrushSize((value) => Math.min(activeTool === "capture-brush" ? 1200 : 400, Math.round(value * 1.25))); break;
      case "brush-softer": setHardness((value) => Math.max(0, Math.round((value - 0.1) * 10) / 10)); break;
      case "brush-harder": setHardness((value) => Math.min(1, Math.round((value + 0.1) * 10) / 10)); break;
      case "focus-layer": if (activeLayerId) enterFocusMode(activeLayerId); break;
      case "layer-style": if (activeLayerId) setStyleLayerId(activeLayerId); break;
      case "toggle-visibility": if (activeLayer) setLayerVisible(activeLayer.id, !activeLayer.visible); break;
      case "toggle-lock": if (activeLayer) studio?.setLayerProp(activeLayer.id, "locked", !activeLayer.locked, activeLayer.locked ? "Layer unlocked" : "Layer locked"); break;
    }
    if (!passDeckPinned) {
      setPassDeckOpen(false);
      spaceGestureRef.current = "idle";
    }
  };

  // Restore Open Recent and hand it to the native menu, once.
  useEffect(() => {
    if (!desktop) return;
    const stored = loadRecentFiles(safeLocalStorage());
    recentFilesRef.current = stored;
    publishRecentFiles(stored);
  }, [desktop]);

  // Both desktop handlers close over the studio and the active layer, so they
  // are new functions on every render. Held in refs rather than in the
  // subscription's dependencies: Tauri's `listen` is an async IPC round trip,
  // and re-subscribing per render meant one of those per pointer move during a
  // brush stroke — with a window between teardown and re-attach where a menu
  // click would land on nothing at all.
  const latestCommand = useRef<(command: StudioCommand) => void>(runStudioCommand);
  const latestOpenPath = useRef(openDocumentPath);
  const latestNativePicker = useRef(openNativeDocument);
  const latestClipboard = useRef({ studio, importLayerFile, blocked: false });
  useEffect(() => {
    latestCommand.current = executeStudioCommand;
    latestOpenPath.current = openDocumentPath;
    latestNativePicker.current = openNativeDocument;
    latestClipboard.current = { studio, importLayerFile, blocked: !startupReady || projectSaving || nativeOpening || Boolean(pendingCloseDocumentId) || pendingNativeClose || showNewDocument || Boolean(pdfChoice) || desktopUpdateInstalling };
  });

  useEffect(() => {
    const handleClipboard = (event: ClipboardEvent) => {
      if (event.defaultPrevented || isEditableTextTarget(event.target) || isEditableTextTarget(document.activeElement)) return;
      const state = latestClipboard.current;
      if (!state.studio || state.blocked || projectSavingRef.current || nativeOpeningRef.current) return;
      if (event.type === "copy" || event.type === "cut") {
        event.preventDefault();
        clipboardEventRef.current = event;
        try { latestCommand.current(event.type === "cut" ? "cut-pixels" : "copy-pixels"); }
        finally { clipboardEventRef.current = null; }
        return;
      }
      const data = event.clipboardData;
      if (hasNativeImageClipboard()) {
        event.preventDefault();
        latestCommand.current("paste-pixels");
        return;
      }
      if (!data) return;
      const file = Array.from(data.files).find(file => file.type.startsWith("image/"));
      const marker = data.getData(SELECTION_CLIPBOARD_TYPE) || data.getData("text/plain");
      const source = pixelPasteSource(Array.from(data.types), marker, clipboardMarkerRef.current, state.studio.hasPixelClipboard(), Boolean(file));
      if (source === "none") return;
      event.preventDefault();
      if (source === "internal") latestCommand.current("paste-pixels");
      else if (file) void state.importLayerFile(file);
    };
    document.addEventListener("copy", handleClipboard);
    document.addEventListener("cut", handleClipboard);
    document.addEventListener("paste", handleClipboard);
    return () => {
      document.removeEventListener("copy", handleClipboard);
      document.removeEventListener("cut", handleClipboard);
      document.removeEventListener("paste", handleClipboard);
    };
  }, []);

  // The native menu bar lives in the Tauri process, so its clicks arrive as an
  // event rather than a DOM interaction — as does a double-clicked document,
  // one from the command line, and an Open Recent pick. Web builds see none.
  useEffect(() => {
    if (!desktop) return;
    const queue = new NativeOpenQueue(async (request, isActive) => {
      nativeOpeningRef.current = true;
      setNativeOpening(true);
      try {
        if (request === "picker") await latestNativePicker.current(isActive);
        else await latestOpenPath.current(request.slice(5), isActive);
      } finally {
        nativeOpeningRef.current = false;
        if (isActive()) setNativeOpening(false);
      }
    }, error => console.error("Native open queue failed", error));
    nativeOpenQueue.current = queue;
    const stopMenu = listenForMenuCommands((command) => latestCommand.current(command));
    const stopOpen = listenForOpenFile(path => {
      // The ref closes the synchronous gap before React publishes save state.
      if (projectSavingRef.current) queue.setPaused(true);
      if (queue.enqueue(`path:${path}`) === "full") notify("Open queue is full (32 files). Please open the remaining files after it finishes.");
    });
    return () => { queue.dispose(); nativeOpenQueue.current = null; stopMenu(); stopOpen(); };
  }, [desktop, notify]);

  useEffect(() => {
    nativeOpenQueue.current?.setPaused(!studio || !startupReady || projectSaving || Boolean(pendingCloseDocumentId) || pendingNativeClose || showNewDocument || Boolean(pdfChoice) || Boolean(vectorTarget) || desktopUpdateInstalling);
  }, [desktop, studio, startupReady, projectSaving, pendingCloseDocumentId, pendingNativeClose, showNewDocument, pdfChoice, vectorTarget, desktopUpdateInstalling]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (!startupReadyRef.current || projectSavingRef.current || nativeOpeningRef.current) return;
      if (pendingCloseDocumentId || pendingNativeClose || showNewDocument || pdfChoiceResolver.current) return;
      // Full-screen creative tools own the keyboard while open.
      if (showMockups || showGlyph || showUpscale || showThumb) return;
      if (desktopUpdateInstalling) {
        e.preventDefault();
        return;
      }
      const editingText = isEditableTextTarget(e.target);
      const controlTarget = e.target instanceof Element ? e.target : null;
      if (["Enter", "Return", " "].includes(e.key) && controlTarget?.closest('button, summary, [role="tab"], [role="option"]')) return;
      if (!editingText && passDeckOpen && /^[1-4]$/.test(e.key)) {
        e.preventDefault();
        const index = Number(e.key) - 1;
        const command = latestSpaceCommands.current[index];
        if (command) runSpaceDeckCommand(command);
        return;
      }
      if (!editingText && e.key === "Escape" && passDeckOpen) {
        e.preventDefault();
        setPassDeckOpen(false);
        setPassDeckPinned(false);
        spaceGestureRef.current = "idle";
        return;
      }
      if (shouldRevealDesktopPassDeck({
        desktop,
        code: e.code,
        repeat: e.repeat,
        hasSelectedLayer: Boolean(activeLayerId),
        editingText,
      })) {
        e.preventDefault();
        spaceHeld.current = true;
        document.documentElement.dataset.spaceHeld = "true";
        document.body.style.cursor = "grab";
        setCanvasCursorOverride("hand");
        spaceGestureRef.current = "pending";
        if (!passDeckOpen) {
          if (spaceOpenTimerRef.current) clearTimeout(spaceOpenTimerRef.current);
          spaceOpenTimerRef.current = setTimeout(() => {
            spaceOpenTimerRef.current = null;
            if (spaceGestureRef.current === "pending") openSpaceDeck(false);
          }, 170);
        }
        return;
      }
      if (desktop && e.code === "Space" && !editingText) {
        e.preventDefault();
        return;
      }
      const shortcutCommand = commandForShortcut(e);
      if (shortcutCommand) {
        if (editingText && ["copy-merged", "paste-in-place", "selection-to-layer"].includes(shortcutCommand)) return;
        // Tauri owns native accelerators. Running both paths performs edits twice.
        if (!isNativeFilesystemAvailable()) { e.preventDefault(); latestCommand.current(shortcutCommand); }
        return;
      }
      if (editingText) return;
      if (e.key === "Escape" && quickSelectionRef.current) {
        e.preventDefault(); studio?.cancelSelectionGesture(); quickSelectionRef.current = null; return;
      }
      if (e.key === "Escape" && (ftDragRef.current || distortDraft || dragRef.current?.kind === "move-layer")) {
        e.preventDefault(); cancelTransformGesture(); return;
      }
      if (e.key === "Enter" && distortDraft) { e.preventDefault(); applyDistortion(); return; }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (distortDraft || ftDragRef.current || dragRef.current?.kind === "move-layer") { cancelTransformGesture(); return; }
        if (e.shiftKey) studio?.redo(); else studio?.undo();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") { e.preventDefault(); void saveProject(e.shiftKey); return; }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "o") { e.preventDefault(); requestDocumentOpen(); return; }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "e") { e.preventDefault(); setShowExportMenu(true); return; }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a") { e.preventDefault(); studio?.selectAll(); return; }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "d") { e.preventDefault(); studio?.deselect(); return; }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "i") { e.preventDefault(); studio?.invertSelectionArea(); return; }
      if (e.key === "Escape" && showWorkspaceSettings) { setShowWorkspaceSettings(false); return; }
      if (e.key === "Escape" && showHistory) { setShowHistory(false); return; }
      if (e.key === "Escape" && showExportMenu) { setShowExportMenu(false); return; }
      if (e.key === "Escape" && showFilters) { setShowFilters(false); return; }
      if (e.key === "Escape" && showBatch && !batchProgress) { setShowBatch(false); return; }
      if (e.key === "Enter" && activeTool === "pen") { e.preventDefault(); commitPenPath(false); return; }
      if (e.key === "Escape" && activeTool === "pen") { penFrameRef.current?.cancel(); setPenDraft([]); setPenDragging(null); setPenPreview(null); return; }
      if (e.key === "Escape" && dragRef.current?.shapeGesture) { e.preventDefault(); setDragBoth(null); notify("Shape cancelled"); return; }
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
      if (e.code === "Space" && !e.repeat) {
        spaceHeld.current = true;
        document.body.style.cursor = "grab";
        setCanvasCursorOverride("hand");
      }
      if (e.key === "0" && !e.metaKey && !e.ctrlKey) { latestCommand.current("zoom-fit"); return; }
      if (e.key === "1" && !e.metaKey && !e.ctrlKey) { latestCommand.current("zoom-actual"); return; }
      if ((e.key === "+" || e.key === "=") && !e.metaKey) { latestCommand.current("zoom-in"); return; }
      if (e.key === "-" && !e.metaKey) { latestCommand.current("zoom-out"); return; }
      if ((e.key === "[" || e.key === "]") && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        const direction = e.key === "]" ? 1 : -1;
        if (activeTool === "capture-brush" && captureSampling) {
          setCaptureRadius((value) => Math.max(2, Math.min(512, Math.round(value * (direction > 0 ? 1.12 : 0.89)))));
        } else {
          setBrushSize((value) => Math.max(1, Math.min(activeTool === "capture-brush" ? 1200 : 400, Math.round(value * (direction > 0 ? 1.12 : 0.89)))));
        }
        return;
      }
      // Native menu accelerators such as Cmd+G, Cmd+Shift+N, Cmd+[ and Cmd+]
      // are dispatched by Tauri. They must not also fall through to the
      // workspace's single-letter tool shortcuts (or brush-size brackets).
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault(); latestCommand.current("delete-pixels"); return;
      }
      const t = resolveToolKey(e.key, workspace, workflowPreferences, desktop);
      if (t) {
        activateTool(t.id, t.workspace);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        if (spaceOpenTimerRef.current) clearTimeout(spaceOpenTimerRef.current);
        spaceOpenTimerRef.current = null;
        spaceHeld.current = false;
        delete document.documentElement.dataset.spaceHeld;
        document.body.style.cursor = "";
        setCanvasCursorOverride(panDragRef.current ? "hand" : null);
        if (spaceGestureRef.current === "pending") {
          const next = togglePinnedSpaceDeck({ open: passDeckOpen, pinned: passDeckPinned });
          if (!next.open) {
            setPassDeckOpen(next.open);
            setPassDeckPinned(next.pinned);
            spaceGestureRef.current = "idle";
          } else if (passDeckOpen) {
            setPassDeckPinned(next.pinned);
            spaceGestureRef.current = "deck";
          } else {
            openSpaceDeck(next.pinned);
          }
        } else if (spaceGestureRef.current === "deck") {
          setPassDeckPinned(true);
        } else if (spaceGestureRef.current === "panning" || spaceGestureRef.current === "dismissed") {
          if (!passDeckPinned) setPassDeckOpen(false);
          spaceGestureRef.current = passDeckPinned ? "deck" : "idle";
        }
      }
    };
    const onBlur = () => {
      if (ftDragRef.current || dragRef.current?.kind === "move-layer") cancelTransformGesture();
      if (spaceOpenTimerRef.current) clearTimeout(spaceOpenTimerRef.current);
      spaceOpenTimerRef.current = null;
      spaceHeld.current = false;
      delete document.documentElement.dataset.spaceHeld;
      document.body.style.cursor = "";
      setCanvasCursorOverride(null);
      hideDynamicCursor();
      if (!passDeckPinned) setPassDeckOpen(false);
      spaceGestureRef.current = passDeckPinned ? "deck" : "idle";
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      if (spaceOpenTimerRef.current) clearTimeout(spaceOpenTimerRef.current);
      spaceOpenTimerRef.current = null;
      delete document.documentElement.dataset.spaceHeld;
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
    // The open/save closures are fully represented by studio, projectName and notify.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desktop, desktopUpdateInstalling, pendingCloseDocumentId, pendingNativeClose, showNewDocument, workspace, studio, projectName, activeLayerId, activeLayer, activeTool, commitPenPath, showHistory, showWorkspaceSettings, showExportMenu, showFilters, showBatch, showMockups, showGlyph, showUpscale, showThumb, batchProgress, pointDraft, pointSelectionTool, feather, notify, captureSampling, capturedBrushTip, workflowPreferences, resolvedSelectionMode, resolvedFocusState.scope, exitFocusMode, enterFocusMode, passDeckOpen, passDeckPinned, openSpaceDeck, distortDraft]);

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
  const uiWork = studioUiWorkPolicy({
    desktop,
    nativeBuild: NATIVE_DESKTOP_BUILD,
    inspector: inspectorTab,
    exportOpen: showExportMenu,
    historyOpen: showHistory,
  });
  const historyState = uiWork.historyTree ? studio?.historyState() : undefined;
  const engineState = uiWork.engineDiagnostics ? studio?.engineState() : undefined;
  useEffect(() => {
    let cancelled = false;
    if (!studio || !uiWork.photoshopPreflight) return;
    void studio.photoshopCompatibility({ format: photoshopFormat }).then((report) => {
      if (!cancelled) setLoadedPhotoshopReport(report);
    }).catch(() => {
      if (!cancelled) setLoadedPhotoshopReport(null);
    });
    return () => { cancelled = true; };
  }, [studio, uiWork.photoshopPreflight, photoshopFormat, version]);
  const photoshopReport = uiWork.photoshopPreflight ? loadedPhotoshopReport : null;
  const canvasCursor = useMemo(() => {
    if (paintingTool || retouchTool || marqueeTool || lassoTool || wandTool || vectorDragTool || transformDragTool || pointSelectionTool || quadTool) return "crosshair";
    return TOOL_REGISTRY[activeTool].cursor;
  }, [paintingTool, retouchTool, marqueeTool, lassoTool, wandTool, vectorDragTool, transformDragTool, pointSelectionTool, quadTool, activeTool]);

  const activeIsAdjustment = activeLayer?.kind === "adjustment-tone";

  // Overlay for pending selection/shape drag
  const dragOverlay = useMemo(() => {
    if (!drag || !doc) return null;
    if (drag.shapeGesture) {
      let geometry: ReturnType<typeof shapeDragGeometry>;
      let pathData = "";
      try {
        geometry = shapeDragGeometry(drag);
        if (geometry?.kind === "path") pathData = vectorPathData(geometry.path);
      } catch { return null; }
      if (!geometry) return null;
      return <svg viewBox={`0 0 ${doc.width} ${doc.height}`} preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "visible", pointerEvents: "none" }} aria-hidden="true">
          {geometry.kind === "path" ? <path d={pathData} fill={geometry.path.fill} fillRule={geometry.path.fillRule} fillOpacity={.65} stroke={geometry.path.stroke} strokeWidth={geometry.path.strokeWidth} /> : geometry.style.kind === "ellipse" ? <ellipse cx={geometry.style.x + geometry.style.w / 2} cy={geometry.style.y + geometry.style.h / 2} rx={geometry.style.w / 2} ry={geometry.style.h / 2} fill={geometry.style.fill} fillOpacity={.65} stroke={geometry.style.stroke} strokeWidth={geometry.style.strokeWidth} /> : <rect x={geometry.style.x} y={geometry.style.y} width={geometry.style.w} height={geometry.style.h} rx={geometry.style.radius} fill={geometry.style.fill} fillOpacity={.65} stroke={geometry.style.stroke} strokeWidth={geometry.style.strokeWidth} />}
        </svg>;
    }
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
    if (!doc || activeTool !== "pen" || (!penDraft.length && !penPreview)) return null;
    const scale = penPreview?.zoom ?? 1;
    const last = penDraft.at(-1);
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
          <path d={path} stroke="rgba(255,255,255,0.9)" strokeWidth={1.5} fill="none" vectorEffect="non-scaling-stroke" />
          {penPreview && <>
            {penPreview.guides.map(g => <line key={g.axis} x1={g.axis === "x" ? g.position : 0} y1={g.axis === "y" ? g.position : 0} x2={g.axis === "x" ? g.position : doc.width} y2={g.axis === "y" ? g.position : doc.height} stroke="#60d8fa" strokeWidth={1} strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />)}
            {!penPreview.handle && last && <path d={`M${last.x} ${last.y} C${last.x + last.hOut.dx} ${last.y + last.hOut.dy} ${penPreview.point.x} ${penPreview.point.y} ${penPreview.point.x} ${penPreview.point.y}`} stroke="#87c7ff" strokeWidth={1.5} strokeDasharray="4 3" vectorEffect="non-scaling-stroke" fill="none" />}
            <circle cx={penPreview.point.x} cy={penPreview.point.y} r={(penPreview.closes ? 7 : 4) / scale} fill="none" stroke={penPreview.closes ? "#ffbe74" : "#60d8fa"} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
          </>}
          {penDraft.map((a, i) => (
            <g key={i}>
              <line x1={a.x + a.hIn.dx} y1={a.y + a.hIn.dy} x2={a.x + a.hOut.dx} y2={a.y + a.hOut.dy} stroke="rgba(124,92,231,0.7)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
              <circle cx={a.x + a.hIn.dx} cy={a.y + a.hIn.dy} r={3 / scale} fill="#7c5ce7" />
              <circle cx={a.x + a.hOut.dx} cy={a.y + a.hOut.dy} r={3 / scale} fill="#7c5ce7" />
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
        {penPreview && (penSettings.measurements || penPreview.label) && <div className="pen-measurement" style={{ left: `${Math.max(1, Math.min(70, penPreview.point.x / doc.width * 100))}%`, top: `${Math.max(1, Math.min(88, penPreview.point.y / doc.height * 100))}%` }}>
          {penPreview.label && <strong>{penPreview.label}</strong>}
          {penSettings.measurements && <span>{penMeasurementLabel(penPreview)}</span>}
        </div>}
      </div>
    );
  }, [doc, activeTool, penDraft, penPreview, penSettings.measurements]);

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
  const transformOverlay = (() => {
    if (!doc || !activeLayer || !moveTool || !showTransformHandles) return null;
    if (activeLayer.kind.startsWith("adjustment-") || activeLayer.kind === "group" || activeLayer.locked) return null;
    const bounds = transformContentBounds(activeLayer, doc.width, doc.height);
    const { width, height } = bounds;
    const draft = distortDraft?.layerId === activeLayer.id && distortDraft.documentId === activeDocumentId ? distortDraft : null;
    const corners = draft ? draft.quad.map(p => [p.x, p.y] as [number, number]) : layerCorners(activeLayer, width, height, bounds.x, bounds.y);
    const [tl, tr, br, bl] = corners;
    const toPct = (p: [number, number]) => ({
      left: `${(p[0] / doc.width) * 100}%`,
      top: `${(p[1] / doc.height) * 100}%`,
    });
    // Rotate handle 32 px (in doc units, roughly) above top-center.
    const topCenter: [number, number] = [(tl[0] + tr[0]) / 2, (tl[1] + tr[1]) / 2];
    const angle = activeLayer.transform.rotation;
    const screenScale = Math.max(0.000001, fitScale * view.zoom);
    const handleSize = 10 / Math.max(view.zoom, 0.05);
    const rotOffset = 30 / screenScale;
    const rotHandle: [number, number] = [
      topCenter[0] + Math.sin(angle) * rotOffset,
      topCenter[1] - Math.cos(angle) * rotOffset,
    ];
    const handleStyle = {
      position: "absolute" as const,
      width: handleSize,
      height: handleSize,
      marginLeft: -handleSize / 2,
      marginTop: -handleSize / 2,
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
        strokeWidth={1}
        strokeDasharray="0.4 0.4"
        vectorEffect="non-scaling-stroke"
      />
    );

    const onCornerDown = (corner: "tl" | "tr" | "br" | "bl") => (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.button !== 0 || ftDragRef.current) return;
      if (transformMode === "distort") {
        const reason = studio?.distortionUnavailableReason(activeLayer.id);
        if (reason) { notify(reason); return; }
      }
      e.stopPropagation();
      e.preventDefault();
      (e.target as Element).setPointerCapture(e.pointerId);
      const p = eventToDoc(e);
      setFt({ kind: "corner", corner, mode: transformMode, layerId: activeLayer.id, pointerId: e.pointerId, documentId: studio!.activeDocumentState().id,
        startX: p.x, startY: p.y, hadDraft: !!draft, quad: corners.map(([x, y]) => ({ x, y })) as unknown as Quad, startTransform: { ...activeLayer.transform } });
    };
    const onRotateDown = (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.button !== 0 || draft || ftDragRef.current) return;
      e.stopPropagation();
      e.preventDefault();
      (e.target as Element).setPointerCapture(e.pointerId);
      // Center in canvas doc-space
      const cx = (tl[0] + br[0]) / 2;
      const cy = (tl[1] + br[1]) / 2;
      const p = eventToDoc(e);
      const startAngle = Math.atan2(p.y - cy, p.x - cx);
      setFt({ kind: "rotate", layerId: activeLayer.id, pointerId: e.pointerId, documentId: studio!.activeDocumentState().id, startTransform: { ...activeLayer.transform }, centerX: cx, centerY: cy, startAngle });
    };
    const onHandleMove = (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!studio) return;
      const f = ftDragRef.current;
      if (!f || f.pointerId !== e.pointerId || f.documentId !== studio.activeDocumentState().id) return;
      const p = eventToDoc(e);
      if (f.kind === "corner") {
        if (!f.moved && Math.hypot(p.x - f.startX, p.y - f.startY) < 0.001) return;
        f.moved = true;
        const index = (["tl", "tr", "br", "bl"] as const).indexOf(f.corner);
        if (f.mode === "distort") {
          const quad = f.quad.map((point, i) => i === index ? { x: point.x + p.x - f.startX, y: point.y + p.y - f.startY } : { ...point }) as unknown as Quad;
          if (isValidTransformQuad(quad)) transformFrameRef.current?.push(() => {
            if (studio.activeDocumentState().id === f.documentId) setDistortDraft({ layerId: f.layerId, documentId: f.documentId, quad });
          });
        } else {
          const patch = f.mode === "skew"
            ? skewDragTransform(f.startTransform, f.corner === "tl" || f.corner === "tr", height, p.x - f.startX, p.y - f.startY, bounds.y)
            : cornerDragTransform(f.corner, f.startTransform, width, height, f.quad[index].x + p.x - f.startX, f.quad[index].y + p.y - f.startY, e.shiftKey, bounds.x, bounds.y);
          transformFrameRef.current?.push(() => {
            if (studio.activeDocumentState().id === f.documentId) studio.liveUpdateTransform(f.layerId, patch);
          });
        }
      } else if (f.kind === "rotate") {
        const now = Math.atan2(p.y - f.centerY, p.x - f.centerX);
        const delta = now - f.startAngle;
        if (!f.moved && Math.abs(delta) < 1e-6) return;
        f.moved = true;
        const patch = rotationDragTransform(f.startTransform, delta, f.centerX, f.centerY, e.shiftKey);
        transformFrameRef.current?.push(() => {
          if (studio.activeDocumentState().id === f.documentId) studio.liveUpdateTransform(f.layerId, patch);
        });
      }
    };
    const onHandleUp = (e: ReactPointerEvent<HTMLDivElement>) => {
      const f = ftDragRef.current;
      if (!studio || !f || f.pointerId !== e.pointerId) return;
      if (e.type === "pointercancel") {
        transformFrameRef.current?.cancel();
        studio.cancelLiveTransform(f.layerId);
        if (f.kind === "corner" && f.mode === "distort") setDistortDraft(f.hadDraft ? { layerId: f.layerId, documentId: f.documentId, quad: f.quad } : null);
      } else if (f.documentId === studio.activeDocumentState().id) {
        onHandleMove(e);
        transformFrameRef.current?.flush();
        if (f.kind !== "corner" || f.mode !== "distort") studio.updateTransform(f.layerId, {});
      }
      setFt(null);
    };

    return (
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
        {draft && <div style={{ position: "absolute", left: 16 / view.zoom, top: 16 / view.zoom, transform: `scale(${1 / view.zoom})`, transformOrigin: "top left", padding: "6px 10px", background: "#202328", color: "#e1e5eb", border: "1px solid #85b8ff", borderRadius: 4, fontSize: 11, whiteSpace: "nowrap" }}>Distort wireframe · Enter to apply · Esc to cancel</div>}
        <svg viewBox={`0 0 100 100`} preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}>
          {draft && <polygon points={corners.map(([x, y]) => `${x / doc.width * 100},${y / doc.height * 100}`).join(" ")} fill="rgba(100,170,255,.13)" />}
          {svgLine(tl, tr)}
          {svgLine(tr, br)}
          {svgLine(br, bl)}
          {svgLine(bl, tl)}
        </svg>
        {([["tl", tl], ["tr", tr], ["br", br], ["bl", bl]] as const).map(([c, pt]) => (
          <div
            key={c}
            title={`${transformMode === "scale" ? "Scale · Shift constrains proportions" : transformMode === "skew" ? "Skew edge" : "Distort corner"} (${c})`}
            style={{ ...handleStyle, ...toPct(pt), touchAction: "none", cursor: transformMode === "skew" ? "ew-resize" : transformMode === "distort" ? "crosshair" : c === "tl" || c === "br" ? "nwse-resize" : "nesw-resize" }}
            onPointerDown={onCornerDown(c)}
            onPointerMove={onHandleMove}
            onPointerUp={onHandleUp}
            onPointerCancel={onHandleUp}
          />
        ))}
        {!draft && <div
          style={{
            ...handleStyle,
            ...toPct(rotHandle),
            borderRadius: "50%",
            background: "#85b8ff", touchAction: "none",
            cursor: "grab",
          }}
          onPointerDown={onRotateDown}
          onPointerMove={onHandleMove}
          onPointerUp={onHandleUp}
          onPointerCancel={onHandleUp}
          title="Rotate · Shift snaps to 15°"
        />}
      </div>
    );
  })();

  const tabletCanvas = useTabletCanvas({
    enabled: tablet, drawWithTouch, documentId: activeDocumentId, view, fitScale, stage: stageRef, setView,
    down: onPointerDown, move: onPointerMove, up: onPointerUp,
    // Only interrupt transactions with a proven rollback path. Never undo an
    // unrelated operation or cancel an already-committed one-shot tool.
    canCancelTouch: () => Boolean(brushGestureRef.current || quickSelectionRef.current || dragRef.current?.shapeGesture || dragRef.current?.kind === "move-layer"),
    cancel: event => { if (dragRef.current?.kind === "move-layer") cancelTransformGesture(); else onPointerUp(event); },
  });

  return (
    <AppShell tablet={tablet} phone={phone} focus={phone && phoneFocus}>
      {phone && phoneFocus && <button className="phone-focus-exit" onClick={() => setPhoneFocus(false)}>Show controls</button>}
      <a className="studio-skip-link" href="#studio-canvas">Skip to canvas</a>
      <div className="spatial-aura aura-blue" />
      <div className="spatial-aura aura-violet" />

      <AppWindow inert={nativeOpening || projectSaving || Boolean(pendingCloseDocumentId) || pendingNativeClose || undefined}>
        <MenuBarRegion>
        <ShellErrorBoundary title="Application controls" onSave={() => { void saveProject(); }}>
        <Suspense fallback={<header className="spatial-topbar studio-titlebar" />}>
          <StudioTitlebar
            desktop={desktop}
            phone={phone}
            onFocusCanvas={() => { setPhoneFocus(true); setTabletPanel(null); }}
            recoveryUnavailable={Boolean(recoveryReadFailure())}
            tabletControls={tablet ? <>
              <button className="tablet-touch-mode" aria-pressed={drawWithTouch} onClick={toggleFingerDrawing} title={drawWithTouch ? "Finger edits with the active tool. Turn off to pan and pinch." : "Fingers pan and pinch. Pencil edits with the active tool."}>{drawWithTouch ? "Touch: draw" : "Touch: navigate"}</button>
              <button aria-label="Toggle layers panel" aria-pressed={tabletPanel === "layers"} onClick={() => setTabletPanel(current => current === "layers" ? null : "layers")}>Layers</button>
              <button aria-label="Toggle properties panel" aria-pressed={tabletPanel === "properties"} onClick={() => setTabletPanel(current => current === "properties" ? null : "properties")}>Properties</button>
            </> : undefined}
            projectName={projectName}
            saveState={saveState}
            dirty={openDocuments.find(document => document.active)?.dirty ?? true}
            projectSaving={projectSaving}
            zoom={zoomPercent}
            canUndo={studio?.canUndo() ?? false}
            canRedo={studio?.canRedo() ?? false}
            exportOpen={showExportMenu}
            filtersOpen={showFilters}
            onBack={() => history.back()}
            onCommand={executeStudioCommand}
            commandEnabled={commandRegistry.enabled}
            onInstall={!desktop && installPrompt.canInstall ? () => { void installPrompt.install(); } : undefined}
            suiteMenu={!desktop}
            onReview={studio && activeDocumentId ? () => {
              try {
                reviewSession.current?.();
                reviewSession.current = openCollaboration({
                  product: "Luma Studio", title: projectName,
                  isCurrent: () => reviewDocument.current === activeDocumentId && studio.activeDocumentState().id === activeDocumentId,
                  read: () => lumaSharedFields(studio),
                  apply: values => applyLumaSharedFields(studio, values),
                  capture: async () => {
                    if (!canvasRef.current) throw new Error("Open a document before publishing a preview.");
                    return previewImage(canvasRef.current);
                  },
                });
              } catch (error) { window.alert(error instanceof Error ? error.message : "Could not open live review."); }
            } : undefined}
          />
        </Suspense>
        </ShellErrorBoundary>
        </MenuBarRegion>

        <AppWorkspace>
          <ToolRailRegion>
          <ShellErrorBoundary title="Tools" region="rail" onSave={() => { void saveProject(); }}>
          <Suspense fallback={<aside className="spatial-toolbar" aria-label="Loading tools" />}>
            <ToolDock
              groups={toolPaletteGroups}
              activeWorkspace={workspace}
              activeTool={activeTool}
              compactDesktop={!tablet}
              touchWorkspace={tablet}
              foreground={brushColor}
              background={secondaryColor}
              onForegroundChange={setBrushColor}
              onSwapColors={() => { setBrushColor(secondaryColor); setSecondaryColor(brushColor); }}
              onSelect={(tool, nextWorkspace) => { activateTool(tool as Tool, nextWorkspace as WorkspaceMode); if (phone) setTabletPanel(null); }}
              onAiSelect={() => { activateTool("sel-sam", "select"); focusInspector("ai"); }}
              onCommand={executeStudioCommand}
              commandEnabled={commandRegistry.enabled}
            />
          </Suspense>
          </ShellErrorBoundary>
          </ToolRailRegion>

          <DocumentAreaRegion data-assets-open={phone ? false : assetsOpen}>
            <ContextualTaskBarRegion>
            <ShellErrorBoundary title="Tool options" onSave={() => { void saveProject(); }}>
            <Suspense fallback={<div className="studio-contextbar" />}>
              <ContextToolbar
                onOpenBrushes={() => executeStudioCommand("panel-paint")}
                tool={activeTool}
                label={activeToolMeta?.[2] ?? "Tool"}
                description={activeWorkspaceMeta[2]}
                layerName={activeLayer?.name ?? "No active layer"}
                layerKind={activeLayer?.kind.replaceAll("-", " ") ?? "Open an image to begin"}
                mode={TOOL_REGISTRY[activeTool].options}
                shapeControls={{
                  settings: currentShapeSettings, fill: brushColor, custom: customShapes, enabled: !!doc,
                  canSave: commandRegistry.enabled("define-custom-shape"),
                  onChange: patch => setShapeSettings(s => ({ ...s, ...patch })), onPreset: chooseShapePreset, onFill: setBrushColor,
                  onSave: () => executeStudioCommand("define-custom-shape"), onRemove: removeCustomShape,
                }}
                penControls={{ settings: penSettings, enabled: !!doc, count: penDraft.length, onChange: updatePenSettings, onFinish: () => commitPenPath(false), onClose: () => commitPenPath(true) }}
                transformControls={{
                  mode: transformMode, enabled: !!activeLayer && !activeLayer.locked && !activeLayer.kind.startsWith("adjustment-") && activeLayer.kind !== "group",
                  autoSelect: autoSelectMove, handles: showTransformHandles, snap: snapGuides, draft: !!distortDraft,
                  distortionReason: activeLayer ? studio?.distortionUnavailableReason(activeLayer.id) ?? null : "Select a raster layer",
                  onMode: changeTransformMode, onAutoSelect: () => setAutoSelectMove(value => !value),
                  onHandles: () => setShowTransformHandles(value => !value), onSnap: () => setSnapGuides(value => !value),
                  onApply: applyDistortion, onCancel: cancelTransformGesture,
                }}
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
                  textSize: activeTextDefaults?.fontSize ?? textSize,
                  fontFamily: activeTextDefaults?.fontFamily ?? '"Lato", sans-serif',
                  fontWeight: Math.round((activeTextDefaults?.fontWeight ?? 700) / 100) * 100,
                  textAlign: activeLayer?.kind === "text" && activeLayer.text ? activeLayer.text.align : "left",
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
                    if (activeLayer?.kind === "text" && activeLayer.text) studio?.updateText(activeLayer.id, withDefaultTextStyle(activeLayer.text, { fontSize: size, axes: { ...(activeTextDefaults?.axes ?? {}), opsz: size } }));
                  }
                  else if (key === "fontFamily" && activeLayer?.kind === "text" && activeLayer.text) studio?.updateText(activeLayer.id, withDefaultTextStyle(activeLayer.text, { fontFamily: String(value) }));
                  else if (key === "fontWeight" && activeLayer?.kind === "text" && activeLayer.text) studio?.updateText(activeLayer.id, withDefaultTextStyle(activeLayer.text, { fontWeight: Number(value), axes: { ...(activeTextDefaults?.axes ?? {}), wght: Number(value) } }));
                  else if (key === "textAlign" && activeLayer?.kind === "text" && activeLayer.text) studio?.updateText(activeLayer.id, { align: value as "left" | "center" | "right" });
                }}
                onSelectionMode={setSelectionMode}
                onFit={() => setView({ zoom: 1, panX: 0, panY: 0 })}
                onToggleGuides={() => setShowGuides((value) => !value)}
                onToggleAssets={() => setAssetsOpen((value) => !value)}
              />
            </Suspense>
            </ShellErrorBoundary>
            </ContextualTaskBarRegion>

            <div className="spatial-document-tabs" aria-label="Open documents" data-single={openDocuments.length === 1}>
              {openDocuments.map((documentTab) => (
                <div
                  key={documentTab.id}
                  className={documentTab.active ? "active" : ""}
                >
                  <button
                    onClick={() => {
                      setFocusState(leaveLayerFocus(resolvedFocusState));
                      studio?.switchDocument(documentTab.id);
                      setActiveLayerId(studio?.rememberedLayerSelectionPrimary() ?? null);
                    }}
                    aria-current={documentTab.active ? "page" : undefined}
                  >
                    <span>{documentTab.name}</span>{documentTab.dirty && <i className="document-dirty-dot" aria-label="Unsaved changes" />}
                  </button>
                    <button
                      onClick={() => {
                        setFocusState(leaveLayerFocus(resolvedFocusState));
                        requestCloseDocument(documentTab.id);
                      }}
                      aria-label={`Close ${documentTab.name}`}
                    >×</button>
                </div>
              ))}
              <button className="document-new-button" onClick={() => executeStudioCommand("new-document")} disabled={!commandRegistry.enabled("new-document")} aria-label="New document" title="New document (⌘N)">＋</button>
            </div>
            <div
              ref={stageRef}
              id="studio-canvas"
              className="spatial-canvas-stage"
              tabIndex={0}
              role="application"
              aria-label={`${projectName} image canvas. Active tool: ${activeTool}.`}
              onWheel={(e) => {
                if (!e.ctrlKey && !e.metaKey && Math.abs(e.deltaY) < 50 && !e.altKey && e.deltaMode===0) return;
                e.preventDefault();
                const factor = wheelZoomFactor(e.deltaY,e.deltaMode,e.currentTarget.getBoundingClientRect().height);
                // Read everything off the synthetic event synchronously, before
                // it reaches the setView updater. React's setState updater can
                // run outside the event's own dispatch (batched, or on a later
                // render if wheel events arrive faster than React processes
                // them), and by then e.currentTarget is no longer valid — this
                // crashed the whole app on a fast/trackpad pinch-zoom.
                const rect = e.currentTarget.getBoundingClientRect();
                const clientX = e.clientX;
                const clientY = e.clientY;
                setView((v) => {
                  // Zoom around cursor: shift pan so the point under the cursor stays fixed.
                  const cx = clientX - rect.left - rect.width / 2;
                  const cy = clientY - rect.top - rect.height / 2;
                  return zoomViewToScale(v, fitScale, v.zoom * fitScale * factor, cx, cy);
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
                    <button disabled={!focusedLayer.mask && !focusedLayer.maskSurface} className={resolvedFocusState.scope.target === "mask" ? "active" : ""} onClick={() => enterFocusMode(focusedLayer.id, "mask")}>Mask</button>
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
                className={`spatial-canvas dynamic-cursor-enabled tool-${activeTool} workspace-${workspace}`}
              >
                {showRulers && doc && displayViewport && <WorkspaceRulers key={`rulers-${activeDocumentId}`} viewport={displayViewport} width={doc.width} height={doc.height} onGuide={(orientation, position) => {
                  if (!studio || studio.activeDocumentState().id !== activeDocumentId) return;
                  try { studio.addGuide(orientation, position); setShowGuides(true); forceUpdate(); }
                  catch (error) { notify(error instanceof Error ? error.message : "Could not add guide"); }
                }} />}
                <canvas
                  key={activeDocumentId}
                  ref={bindDisplayCanvas}
                  onPointerEnter={updateDynamicCursorFromEvent}
                  onPointerDown={tabletCanvas.onPointerDown}
                  onPointerMove={tabletCanvas.onPointerMove}
                  onPointerUp={tabletCanvas.onPointerUp}
                  onPointerCancel={tabletCanvas.onPointerCancel}
                  onLostPointerCapture={(event) => {
                    const wasEditor = tabletCanvas.onLostPointerCapture(event);
                    if (tablet && !wasEditor) return;
                    if (brushGestureRef.current) { studio?.cancelStroke(); brushGestureRef.current = null; }
                    if (quickSelectionRef.current) { studio?.cancelSelectionGesture(); quickSelectionRef.current = null; }
                  }}
                  onPointerLeave={() => {
                    if (!penDragging) { penFrameRef.current?.cancel(); setPenPreview(null); }
                    positionWarpOverlay(null);
                    hideDynamicCursor();
                  }}
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
                <div
                  ref={dynamicCursorRef}
                  className="dynamic-canvas-cursor"
                  data-kind={cursorBasePresentation.kind}
                  data-status={cursorBasePresentation.status}
                  data-visible="false"
                  data-pressed="false"
                  aria-hidden="true"
                >
                  <i className="dynamic-cursor-ring" />
                  <i className="dynamic-cursor-hardness" />
                  <i className="dynamic-cursor-reticle" />
                  <b className="dynamic-cursor-color" />
                  <span ref={dynamicCursorGlyphRef} className="dynamic-cursor-glyph">{cursorBasePresentation.glyph}</span>
                  <output ref={dynamicCursorReadoutRef}>{cursorBasePresentation.readout}</output>
                </div>
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
                    {paintingTool && brushSymmetry !== "none" && <BrushMirrorGuides width={doc.width} height={doc.height} settings={{ mode: brushSymmetry, segments: brushSymmetrySegments, ...brushSymmetryCenter }} />}
                    {desktop && activeTool === "radial-warp" && showRadialOverlay && (
                      <div
                        ref={warpOverlayRef}
                        className="desktop-radial-overlay"
                        aria-hidden="true"
                        style={{
                          ...desktopRadialOverlayPosition({
                            point: null,
                            documentWidth: doc.width,
                            documentHeight: doc.height,
                            radius: warpRadius,
                          }),
                          width: `${(warpRadius * 2 / doc.width) * 100}%`,
                          height: `${(warpRadius * 2 / doc.height) * 100}%`,
                        }}
                      >
                        <i className="radial-handle radial-handle-top" />
                        <i className="radial-handle radial-handle-right" />
                        <i className="radial-handle radial-handle-bottom" />
                        <i className="radial-handle radial-handle-left" />
                        <b />
                      </div>
                    )}
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
                {(desktop || tablet) && passDeckOpen && (
                  <DesktopCanvasHud
                    activeLayer={activeLayer}
                    context={spaceDeckContext}
                    toolLabel={spaceToolLabel}
                    features={spaceToolFeatures}
                    commands={contextualSpaceCommands}
                    position={passDeckPosition}
                    size={{ width: spaceDeckWidth, height: spaceDeckHeight }}
                    pinned={passDeckPinned}
                    onPinnedChange={(pinned) => {
                      setPassDeckPinned(pinned);
                      spaceGestureRef.current = pinned ? "deck" : "idle";
                    }}
                    onCommand={runSpaceDeckCommand}
                    onClose={() => {
                      setPassDeckOpen(false);
                      setPassDeckPinned(false);
                      spaceGestureRef.current = "idle";
                    }}
                  />
                )}
                <div className="canvas-status">
                  <span title={engineState ? `${engineState.surfaces} canvas mirrors · ${engineState.precisionTiles} resident precision tiles · ${engineState.previewCache.hits} tile-cache hits · ${formatBytes(engineState.workingSetBytes)} current working set` : undefined}>
                    {doc
                      ? `${doc.width}×${doc.height} · ${doc.colorSpace.toUpperCase()} · ${doc.bitDepth}-bit master${doc.proofing.profile !== "none" ? ` · PROOF ${doc.proofing.profile.toUpperCase()}` : ""} · CPU tiled preview · ${useGL && glSupported ? "GPU 16F export" : "CPU export"} · ${engineState?.blendPasses ?? 0} blend passes · ${formatBytes(engineState?.workingSetBytes ?? 0)}${engineState?.historyOverBudget ? " · history over budget" : ""}`
                      : "Loading…"}
                  </span>
                  <span>{zoomPercent}% · {layers.length} layer{layers.length === 1 ? "" : "s"}{doc?.selection ? " · sel" : ""}</span>
                </div>
                {recordingName && (
                  <div style={{ position: "absolute", top: 12, left: 12, background: "rgba(200,30,30,.9)", color: "#fff", padding: "4px 8px", borderRadius: 999, fontSize: 11 }}>
                    ● Recording · {recordingName}
                  </div>
                )}
              </div>
            </div>

            <ShellErrorBoundary title="Layer Focus" onSave={() => { void saveProject(); }}>
            <Suspense fallback={<section className="layer-focus-panel" aria-label="Loading Layer Focus" />}>
              <LayerFocusPanel
                items={focusPanelItems}
                selectedLayerId={activeLayerId}
                focus={resolvedFocusState}
                focusedLayerName={focusedLayer?.name}
                projectName={projectName}
                onSelect={(layerId) => {
                  const layer = studio?.findLayer(layerId);
                  if (layer) selectLayerForEditing(layer);
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
            </ShellErrorBoundary>
          </DocumentAreaRegion>

          <DockRegion>
          <DockManager
            tablet={tablet ? { panel: tabletPanel, select: setTabletPanel, close: () => setTabletPanel(null) } : undefined}
            layout={dockLayout}
            onLayoutChange={setDockLayout}
            onActivePanelChange={(panel) => {
              if (panel === "layers" || panel === "properties" || panel === "neural") {
                setInspectorTab(panel === "neural" ? "ai" : panel);
              }
            }}
            contextualPanel={contextualPanel}
          >
            <DockPanelContent panelId="layers">
              <LayersPanel
                touch={tablet}
                key={activeDocumentId}
                studio={studio}
                layers={layers}
                activeLayerId={activeLayerId}
                selectedLayerIds={selectedLayerIds}
                onSelectLayers={(layer, modifiers) => {
                  if (!studio) return;
                  const selection = studio.selectLayers(layer.id, modifiers, activeLayerId);
                  setActiveLayerId(selection.primary);
                  setNativePanelOverride(null);
                  forceUpdate();
                }}
                onCommand={executeStudioCommand}
                commandEnabled={commandRegistry.enabled}
                activeLayer={activeLayer}
                draggedLayerId={draggedLayerId}
                onDragStart={setDraggedLayerId}
                onDragEnd={() => setDraggedLayerId(null)}
                onSelectLayer={selectLayerForEditing}
                onSetActiveLayerId={setActiveLayerId}
                onOpenLayerStyle={setStyleLayerId}
                onSetLayerVisible={setLayerVisible}
                onPreviewOpacity={previewLayerOpacity}
                onCommitOpacity={setLayerOpacity}
                onAddBlank={addBlank}
                onAddTone={addAdjust}
                onAddProfessionalAdjustment={addProfessionalAdjustment}
                onRemoveActive={removeActive}
                onRenameLayer={(layer) => { if (studio) setLayerRenameTarget({ documentId: studio.activeDocumentState().id, layerId: layer.id, name: layer.name }); }}
              />
            </DockPanelContent>

            {(desktop || tablet) && (
              <DockPanelContent panelId="properties">
                {selectedLayerIds.length > 1 ? <section className="layer-selection-summary" aria-label="Multiple layer properties">
                  <strong>{selectedLayerIds.length} layers selected</strong>
                  <span>Group to keep layers editable, or merge compatible layers into one raster. Select one layer for its properties.</span>
                  {(["group-layer", "ungroup-layers", "merge-layers", "duplicate-layer", "toggle-layer-lock", "toggle-layer-visibility"] as const).map(id => <button key={id} disabled={!commandRegistry.enabled(id)} onClick={() => executeStudioCommand(id)}>{commandRegistry.get(id).label}</button>)}
                </section> : <PropertiesPanel
                  showPanelPicker={NATIVE_DESKTOP_BUILD}
                  toolLabel={activeToolMeta?.[2] ?? "Properties"}
                  hasSelection={Boolean(doc?.selection)}
                  workspace={workspace}
                  contextualOverride={nativePanelOverride}
                  activeLayer={activeLayer}
                  documentWidth={doc?.width ?? 0}
                  documentHeight={doc?.height ?? 0}
                  activeTool={activeTool}
                  paintingTool={paintingTool}
                  warpRadius={warpRadius}
                  showRadialOverlay={showRadialOverlay}
                  brushSize={brushSize}
                  hardness={hardness}
                  brushOpacity={brushOpacity}
                  spaceToolLabel={spaceToolLabel}
                  studio={studio}
                  onContextPanelChange={(panel) => {
                    setNativePanelOverride(null);
                    if (panel) openStudioPanel(panel);
                    else selectInspectorTab("properties");
                  }}
                  onFocusLayer={enterFocusMode}
                  onDisableRadialWarp={() => activateTool("move", "edit")}
                  onWarpRadiusChange={setWarpRadius}
                  onToggleRadialOverlay={() => setShowRadialOverlay((visible) => !visible)}
                  onBrushSizeChange={setBrushSize}
                  onHardnessChange={setHardness}
                  onBrushOpacityChange={setBrushOpacity}
                  onPreviewOpacity={previewLayerOpacity}
                  onCommitOpacity={setLayerOpacity}
                  onSetLayerVisible={setLayerVisible}
                  onOpenSpaceDeck={() => openSpaceDeck(true)}
                  onAddBlank={addBlank}
                  onSendToForm={() => { if (activeLayer) void sendLayerToForm(activeLayer); }}
                />}
              </DockPanelContent>
            )}

            <DockPanelContent panelId="campaign">
              {studio && <Suspense fallback={<p>Loading Campaign…</p>}><CampaignPanel key={studio.activeDocumentState().id} studio={studio} selectedIds={selectedLayerIds} onChange={forceUpdate} onNotify={notify} onSave={downloadOrSave} onOpenType={()=>openStudioPanel("vector")} onRecolor={()=>executeStudioCommand("recolor")} onPrint={isNativeFilesystemAvailable()?()=>executeStudioCommand("export-print"):undefined} /></Suspense>}
            </DockPanelContent>
            {(NATIVE_DESKTOP_BUILD || shouldMountLegacyInspector(desktop)) && <>
            <DockPanelContent panelId="channels">
              <ChannelsPanel channelView={engineState?.channelView ?? "rgb"} onChange={(channel) => studio?.setChannelView(channel)} onLoad={() => executeStudioCommand("select-channel")} canLoad={!!studio && !!doc?.layers.length}
                channels={doc?.alphaChannels ?? []} draft={alphaDraft} onDraft={updateAlphaDraft} execute={executeStudioCommand} enabled={command => commandRegistry.enabled(command)} />
            </DockPanelContent>

            <DockPanelContent panelId="structure">
              <StructurePanel
                studio={studio}
                document={doc}
                layerCompName={layerCompName}
                artboardName={artboardName}
                onLayerCompNameChange={setLayerCompName}
                onArtboardNameChange={setArtboardName}
                onNotify={notify}
                onExportArtboard={(artboardId, artboardNameToExport) => {
                  if (!studio) return;
                  void studio.exportArtboard(artboardId).then(async (blob) => {
                    await downloadOrSave(blob, `${artboardNameToExport.replace(/[^a-z0-9_-]+/gi, "-") || "artboard"}.png`, { locker: true });
                    notify(`${artboardNameToExport} exported`);
                  }).catch((error) => notify(error instanceof Error ? error.message : "Artboard export failed"));
                }}
              />
            </DockPanelContent>

            <DockPanelContent panelId="assets">
              <AssetsPanel
                plugins={studio?.listPlugins() ?? []}
                capturedBrushCount={capturedBrushes.length}
                desktop={desktop}
                onInstall={() => pluginInput.current?.click()}
                onUninstall={uninstallPlugin}
              />
            </DockPanelContent>

            <DockPanelContent panelId="document">
              <DocumentPanel
                studio={studio}
                document={doc}
                engineState={engineState}
                photoshopReport={photoshopReport}
                showGuides={showGuides}
                snapGuides={snapGuides}
                localCrashCount={localDiagnostics.summary().crashes}
                onNotify={notify}
                onToggleGuides={() => setShowGuides((visible) => !visible)}
                onToggleSnap={() => setSnapGuides((enabled) => !enabled)}
                onExportDiagnostics={() => {
                  const report = localDiagnostics.exportReport({
                    edition: desktop ? "pro" : "web",
                    appVersion: "0.1.0",
                    engine: engineState,
                  });
                  void downloadOrSave(report, `luma-diagnostics-${new Date().toISOString().slice(0, 10)}.json`).then(() => notify("Diagnostics report exported"));
                }}
              />
            </DockPanelContent>

            <DockPanelContent panelId="selection">
            {doc && (
              <section className="glass-card mask-card" data-contextual-panel="selection">
                <header><strong>Selection</strong>
                  <button aria-label="Deselect" disabled={!doc.selection} onClick={() => executeStudioCommand("deselect")}>×</button>
                </header>
                {TOOL_REGISTRY[activeTool].options !== "selection" && (
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
                )}
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
                <div className="mask-actions" aria-label="Selected pixel actions">
                  {([ ["select-subject", "Subject"], ["copy-pixels", "Copy"], ["copy-merged", "Copy merged"], ["cut-pixels", "Cut"], ["paste-pixels", "Paste"], ["paste-in-place", "Paste in place"], ["selection-to-layer", "New layer from selection"], ["delete-pixels", "Delete pixels"] ] as const).map(([id, label]) => (
                    <button key={id} disabled={!commandRegistry.enabled(id)} onClick={() => executeStudioCommand(id)} title={commandRegistry.get(id).shortcut || label}>{label}</button>
                  ))}
                </div>
                <p style={{ padding: "0 12px", fontSize: 11, opacity: 0.65 }}>
                  {tablet ? "Use New, Add, Subtract or Intersect in the tool options above." : "Hold ⇧ to add · ⌥ to subtract · ⌘ (with wand) for non-contiguous"}
                </p>
              </section>
            )}
            </DockPanelContent>

            <DockPanelContent panelId="mask">
            {activeLayer && (
              <section className="glass-card mask-card" data-contextual-panel="mask">
                <header><strong>Mask brush</strong>
                  <button onClick={() => activeLayerId && studio?.invertMask(activeLayerId)}>◑</button>
                </header>
                <div className="mask-segmented">
                  <button className={activeTool === "mask-add" ? "active" : ""} onClick={() => activateTool("mask-add", "mask")}>Reveal</button>
                  <button className={activeTool === "mask-remove" ? "active" : ""} onClick={() => activateTool("mask-remove", "mask")}>Hide</button>
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
                  <button onClick={() => { if (!activeLayerId || !studio) return; const refusal = studio.clearMaskRefusal(activeLayerId); if (refusal) { notify(refusal); return; } studio.clearMask(activeLayerId); notify("Mask revealed"); }}>Reveal all</button>
                </div>
              </section>
            )}
            </DockPanelContent>

            <DockPanelContent panelId="raw">
            {activeLayer?.raw && rawDevelop && (
              <section className="glass-card tone-card" data-contextual-panel="raw">
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
                  Re-developed from the original embedded {activeLayer.raw.sensor.format ?? activeLayer.source?.format ?? "RAW"} sensor asset · {activeLayer.raw.matrixSource.replaceAll("-", " ")}
                  {activeLayer.raw.sensor.warnings.length ? ` · ${activeLayer.raw.sensor.warnings.join(" · ")}` : ""}
                </p>
              </section>
            )}
            </DockPanelContent>

            <DockPanelContent panelId="curves">
            {activeLayer?.kind === "adjustment-curves" && activeLayer.curves && (
              <div className="contextual-panel-host" data-contextual-panel="curves"><Suspense fallback={<section className="glass-card tone-card" aria-label="Loading curves" />}>
                <CurvesEditor curves={activeLayer.curves} onLive={(c) => studio?.liveUpdateCurves(activeLayer.id, c)} onCommit={(c) => studio?.updateCurves(activeLayer.id, c)} onReset={() => studio?.updateCurves(activeLayer.id, cloneCurves(NEUTRAL_CURVES))} />
              </Suspense></div>
            )}
            </DockPanelContent>
            <DockPanelContent panelId="levels">
            {activeLayer?.kind === "adjustment-levels" && activeLayer.levels && (
              <div className="contextual-panel-host" data-contextual-panel="levels"><Suspense fallback={<section className="glass-card tone-card" aria-label="Loading levels" />}>
                <LevelsEditor levels={activeLayer.levels} onLive={(l) => studio?.liveUpdateLevels(activeLayer.id, l)} onCommit={(l) => studio?.updateLevels(activeLayer.id, l)} onReset={() => studio?.updateLevels(activeLayer.id, { ...NEUTRAL_LEVELS })} />
              </Suspense></div>
            )}
            </DockPanelContent>
            <DockPanelContent panelId="hsl">
            {activeLayer?.kind === "adjustment-hsl" && activeLayer.hsl && (
              <div className="contextual-panel-host" data-contextual-panel="hsl"><Suspense fallback={<section className="glass-card tone-card" aria-label="Loading HSL" />}>
                <HslEditor hsl={activeLayer.hsl} onLive={(h) => studio?.liveUpdateHsl(activeLayer.id, h)} onCommit={(h) => studio?.updateHsl(activeLayer.id, h)} onReset={() => studio?.updateHsl(activeLayer.id, { ...NEUTRAL_HSL })} />
              </Suspense></div>
            )}
            </DockPanelContent>
            <DockPanelContent panelId="pro-adjustment">
            {activeLayer?.kind === "adjustment-pro" && activeLayer.proAdjustment && (
              <div className="contextual-panel-host" data-contextual-panel="pro-adjustment"><Suspense fallback={<section className="glass-card tone-card" aria-label="Loading adjustment" />}>
                <ProAdjustmentEditor
                  key={`${activeDocumentId}:${activeLayer.id}`}
                  adjustment={activeLayer.proAdjustment}
                  onLive={(adjustment) => studio?.liveUpdateProAdjustment(activeLayer.id, adjustment)}
                  onCommit={(adjustment) => studio?.updateProAdjustment(activeLayer.id, adjustment)}
                  onReset={() => studio?.updateProAdjustment(activeLayer.id, defaultProAdjustment(activeLayer.proAdjustment!.kind))}
                />
              </Suspense></div>
            )}
            </DockPanelContent>
            <DockPanelContent panelId="tone">
            {activeLayer?.kind === "adjustment-tone" && (
              <section className="glass-card tone-card" data-contextual-panel="tone">
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
                        onPointerUp={onToneCommit}
                        onKeyUp={onToneCommit}
                        onBlur={onToneCommit} />
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
            </DockPanelContent>

            <DockPanelContent panelId="paint">
            {doc && (
              <section className="glass-card tone-card" data-contextual-panel="paint">
                <BrushToolbox
                  activeBrush={activeTool === "brush"}
                  mirrorAvailable={paintingTool}
                  settings={{ size: brushSize, hardness, opacity: brushOpacity, flow: brushFlow, spacing: brushSpacing, roundness: brushRoundness, angle: brushAngle, smoothing: brushSmoothing, scatter: brushScatter, tilt: brushTilt, texture: brushTexture, pressureSize, pressureOpacity, buildUp: brushBuildUp, blendMode: brushBlendMode }}
                  onPreset={applyBrushRecipe}
                  section={tablet ? touchPaintSection : undefined}
                  onSection={setTouchPaintSection}
                  mirror={{ mode: brushSymmetry, segments: brushSymmetrySegments, ...brushSymmetryCenter }}
                  onMirror={next => { setBrushSymmetry(next.mode); setBrushSymmetrySegments(next.segments); setBrushSymmetryCenter({ x: next.x, y: next.y }); }}
                  onCapture={() => { activateTool("capture-brush", "edit"); if (tablet) { setTouchPaintSection("settings"); setTabletPanel("paint"); } }}
                  onDone={tablet ? () => setTabletPanel(null) : undefined}
                />
                <div className="brush-tool-settings" hidden={tablet && touchPaintSection !== "settings"}>
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
                        <option value="material">Material transfer</option>
                      </select>
                    </label>
                    <label style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", fontSize: 10 }}>
                      <span><strong>Living source</strong><br /><small style={{ opacity: 0.62 }}>Re-sample before every stroke</small></span>
                      <input type="checkbox" checked={captureLive} onChange={(event) => setCaptureLive(event.target.checked)} />
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
                                <span style={{ width: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 9 }}>{asset.liveSource?.live ? "● " : ""}{asset.name}</span>
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
                </div>
                <div className="mask-segmented" style={{ paddingBottom: 9 }}>
                  <button className={pressureSize ? "active" : ""} onClick={() => setPressureSize((value) => !value)}>Pressure size</button>
                  <button className={pressureOpacity ? "active" : ""} onClick={() => setPressureOpacity((value) => !value)}>Pressure opacity</button>
                  <button className={brushBuildUp ? "active" : ""} onClick={() => setBrushBuildUp((value) => !value)}>Airbrush buildup</button>
                </div>
                </>)}
                </div>
              </section>
            )}

            </DockPanelContent>
            <DockPanelContent panelId="vector">
            {doc && (
              <section className="glass-card tone-card" data-contextual-panel="vector">
                <header>
                  <strong>Type & shape</strong>
                  <input type="color" value={brushColor} onChange={(e) => setBrushColor(e.target.value)} aria-label="Fill color" style={{ width: 28, height: 22, border: "none", background: "transparent" }} />
                </header>
                <div style={{ padding: "0 12px 8px" }}>
                  {studio && activeLayer && (activeLayer.path || activeLayer.shape) && <Suspense fallback={<span>Loading vector controls…</span>}>
                    <VectorConstructionPanel key={`${studio.activeDocumentState().id}:${activeLayer.id}`} studio={studio} layer={activeLayer} onSelect={setActiveLayerId} onNotify={notify} onSave={downloadOrSave} />
                  </Suspense>}
                  {studio && activeLayer?.lettering3d && <Suspense fallback={<p role="status">Loading 3D object editor…</p>}>
                    <LetteringObjectPanel key={`${studio.activeDocumentState().id}:${activeLayer.id}`} studio={studio} layer={activeLayer} onExport={downloadOrSave} />
                  </Suspense>}
                  {studio && activeLayer?.mesh3d && <Suspense fallback={<p role="status">Loading mesh controls…</p>}>
                    <FormMeshPanel key={`${studio.activeDocumentState().id}:${activeLayer.id}`} studio={studio} layer={activeLayer} onExport={downloadOrSave} />
                  </Suspense>}
                  {!activeLayer?.mesh3d && !activeLayer?.lettering3d && !activeLayer?.path && !activeLayer?.shape && <Suspense fallback={<div className="type-studio-loading">Loading typography…</div>}>
                    <TypePanel
                      outlineDisabledReason={TEXT_OUTLINE_COMMAND.disabledReason(activeLayer)}
                      onCreateOutlines={async () => {
                        if (!studio || !activeLayer) return;
                        const layer = await TEXT_OUTLINE_COMMAND.execute(studio, activeLayer.id);
                        setActiveLayerId(layer.id);
                        notify("Editable outlines created; original text preserved");
                      }}
                      key={`${studio?.activeDocumentState().id}:${activeLayer?.id}`}
                      text={activeLayer?.kind === "text" && activeLayer.text ? activeLayer.text : null}
                      draft={textDraft}
                      selection={textSelection}
                      defaultColor={brushColor}
                      onSelection={setTextSelection}
                      onDraftChange={(value) => {
                        setTextDraft(value);
                        if (activeLayer?.kind === "text" && activeLayer.text) studio?.liveUpdateText(activeLayer.id, { text: value });
                      }}
                      onDraftCommit={() => {
                        if (activeLayer?.kind === "text" && activeLayer.text) studio?.updateText(activeLayer.id, { text: textDraft });
                      }}
                      onPatch={(patch) => {
                        if (activeLayer?.kind === "text" && activeLayer.text) studio?.updateText(activeLayer.id, patch);
                      }}
                      onLivePatch={(patch) => {
                        if (activeLayer?.kind === "text" && activeLayer.text) studio?.liveUpdateText(activeLayer.id, patch);
                      }}
                      onCommitLive={() => {
                        if (activeLayer?.kind === "text" && activeLayer.text) studio?.updateText(activeLayer.id, {});
                      }}
                      onExportForm={async (includeGlyphs) => {
                        if (activeLayer?.kind !== "text" || !activeLayer.text) return;
                        const { computeTextOutlines } = await import("../engine/text-shaping-client");
                        const asset = includeGlyphs ? await formTextAssetWithOutlines(activeLayer, computeTextOutlines) : formTextAssetFromLayer(activeLayer);
                        const fileName = `${activeLayer.name.replace(/[^a-z0-9_-]+/gi, "-") || "Luma-Text"}.lumaformtext`;
                        const saved = await downloadOrSave(new Blob([serializeFormTextAsset(asset)], { type: "application/vnd.luma-form.text+json" }), fileName);
                        if (saved) notify(includeGlyphs ? "Shaped glyph geometry and editable source ready for Form Studio" : "Text source ready for Form Studio · proxy preview, not glyph geometry");
                      }}
                      spatialStyle={activeLayer?.kind === "text" ? activeLayer.spatial ?? activeLayer.text?.spatial : undefined}
                      onSpatialPatch={(patch) => {
                        if (activeLayer?.kind === "text") studio?.updateLayerSpatial(activeLayer.id, patch);
                      }}
                      onSpatialLivePatch={(patch) => {
                        if (activeLayer?.kind === "text") studio?.liveUpdateLayerSpatial(activeLayer.id, patch);
                      }}
                      onSpatialCommit={() => {
                        if (activeLayer?.kind === "text") studio?.updateLayerSpatial(activeLayer.id, {});
                      }}
                      onMeshRender={(canvas) => {
                        if (!studio || activeLayer?.kind !== "text") return;
                        const rendered = studio.addTextMeshRender(activeLayer.id, canvas);
                        setActiveLayerId(rendered.id);
                        notify("3D render added; original text preserved");
                      }}
                      onMeshAsset={(canvas, asset) => {
                        if (!studio || activeLayer?.kind !== "text") return;
                        const object = studio.addLetteringObject(activeLayer.id, canvas, asset);
                        setActiveLayerId(object.id);
                        notify("Editable 3D object added; source text preserved");
                      }}
                      onMeshExport={(blob, extension) => {
                        const name = activeLayer?.name.replace(/[^a-z0-9-]+/gi, "-") || "Luma-3D-Text";
                        return downloadOrSave(blob, `${name}.${extension}`);
                      }}
                    />
                  </Suspense>}
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

            </DockPanelContent>
            <DockPanelContent panelId="transform">
            {activeLayer?.kind === "group" && <p className="layer-selection-summary">Group transforms are not supported yet. Select a child layer to transform it.</p>}
            {doc && activeLayer?.kind !== "group" && selectedLayerIds.length <= 1 && (
              <section className="glass-card tone-card" data-contextual-panel="transform">
                <header><strong>Transform & geometry</strong><small>PRECISION</small></header>
                <div style={{ display: "grid", gap: 8, padding: "8px 12px 12px", fontSize: 11 }}>
                  <p style={{ margin: 0, opacity: 0.72 }}>
                    {quadTool ? `Place four corners in order · ${pointDraft.length}/4` : activeTool === "content-move" ? "Make a selection, then drag it to a new position." : activeTool === "crop" ? "Drag the retained crop rectangle." : "Drag directly on the document."}
                  </p>
                  {(activeTool === "radial-warp" || activeTool === "liquify") && <label style={{ display: "flex", gap: 8, alignItems: "center" }}><span>Influence</span><input type="range" min="16" max="600" value={warpRadius} onChange={(event) => setWarpRadius(Number(event.target.value))} /><output>{warpRadius}px</output></label>}
                  {pointDraft.length > 0 && <button onClick={() => setPointDraft([])}>Clear points</button>}
                  {activeLayer && (
                    <>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 6 }}>
                        {([[
                          "X", "tx", activeLayer.transform.tx, 1,
                        ], ["Y", "ty", activeLayer.transform.ty, 1], ["Scale X", "sx", activeLayer.transform.sx, 0.01], ["Scale Y", "sy", activeLayer.transform.sy, 0.01], ["Skew", "skewX", activeLayer.transform.skewX ?? 0, 0.01]] as const).map(([label, key, value, step]) => (
                          <label key={key} style={{ display: "grid", gap: 3 }}><span>{label}</span><input key={`${activeLayer.id}-${key}-${value}`} type="number" step={step} defaultValue={Math.round(value * 100) / 100} onBlur={(event) => {
                            const next = Number(event.target.value);
                            if (Number.isFinite(next)) studio?.updateTransform(activeLayer.id, { [key]: next });
                          }} /></label>
                        ))}
                        <label style={{ display: "grid", gap: 3 }}><span>Rotation °</span><input key={`${activeLayer.id}-rotation-${activeLayer.transform.rotation}`} type="number" step="0.1" defaultValue={Math.round(activeLayer.transform.rotation * 180 / Math.PI * 10) / 10} onBlur={(event) => {
                          const degrees = Number(event.target.value);
                          if (Number.isFinite(degrees) && doc) {
                            const points = layerCorners(activeLayer, activeLayer.surface?.grid.width ?? activeLayer.bitmap?.width ?? doc.width, activeLayer.surface?.grid.height ?? activeLayer.bitmap?.height ?? doc.height);
                            studio?.updateTransform(activeLayer.id, rotateLayerTransformAround(activeLayer.transform, degrees * Math.PI / 180 - activeLayer.transform.rotation, (points[0][0] + points[2][0]) / 2, (points[0][1] + points[2][1]) / 2));
                          }
                        }} /></label>
                      </div>
                      <button onClick={() => studio?.resetTransform(activeLayer.id)}>Reset transform</button>
                    </>
                  )}
                </div>
              </section>
            )}

            </DockPanelContent>
            <DockPanelContent panelId="measure">
            {doc && (
              <MeasurePanel measurement={measurement} colorSamples={colorSamples} onClear={() => { setColorSamples([]); setMeasurement(null); }} />
            )}

            </DockPanelContent>
            <DockPanelContent panelId="neural">
              <NeuralPanel
                prompt={aiPrompt}
                operation={aiOperation}
                quality={aiQuality}
                variations={aiVariations}
                strength={aiStrength}
                preserve={aiPreserve}
                temperature={aiTemperature}
                running={aiRunning}
                neuralProgress={neural?.pct ?? null}
                activeLayer={activeLayer}
                identityReference={identityReference}
                onPromptChange={setAiPrompt}
                onOperationChange={setAiOperation}
                onQualityChange={setAiQuality}
                onVariationsChange={setAiVariations}
                onStrengthChange={setAiStrength}
                onPreserveChange={setAiPreserve}
                onTemperatureChange={setAiTemperature}
                onToggleIdentity={() => {
                  if (!studio || !activeLayer) return;
                  const clearing = identityReference?.id === activeLayer.id;
                  studio.setIdentityReference(clearing ? null : activeLayer.id);
                  notify(clearing ? "Identity reference cleared" : `${activeLayer.name} locked as the AI reference`);
                }}
                onGenerate={runGenerativeEdit}
                onCancel={() => aiAbort.current?.abort()}
                onNeuralSubject={runNeuralSubject}
                onLumaMask={runSubject}
                onInvertMask={() => activeLayerId && studio?.invertMask(activeLayerId)}
                onRevealAll={() => { if (!activeLayerId || !studio) return; const refusal = studio.clearMaskRefusal(activeLayerId); if (refusal) { notify(refusal); return; } studio.clearMask(activeLayerId); notify("Mask revealed"); }}
              />
            </DockPanelContent>
            <DockPanelContent panelId="actions">
              <ActionsPanel actions={studio?.actions.list() ?? []} recordingName={recordingName} onStart={startRecording} onStop={stopRecording} onPlay={playAction}
                onEdit={(index, action) => { studio?.editAction(index, action); setActionReport(null); forceUpdate(); }}
                onUndoEdit={redo => { studio?.undoActionEdit(redo); setActionReport(null); forceUpdate(); }}
                canUndoEdit={studio?.actions.canUndoEdit() ?? false} canRedoEdit={studio?.actions.canRedoEdit() ?? false}
                report={actionReport?.documentId === activeDocumentId ? actionReport : null} />
            </DockPanelContent>

            <DockPanelContent panelId="history">
            <div className="spatial-view-dock">
              <button onClick={() => studio?.undo()} title="Undo" aria-label="Undo" disabled={!studio?.canUndo()}>↶</button>
              <button onClick={() => studio?.redo()} title="Redo" aria-label="Redo" disabled={!studio?.canRedo()}>↷</button>
              <button onClick={() => studio?.selectAll()} title="Select all" aria-label="Select all">▭</button>
              <span />
              <button
                onClick={() => setShowHistory(true)}
                title={`${historyState?.operations ?? 0} operations · ${historyState?.branchPoints ?? 0} branch points`}
                aria-label="Open version history"
              >
                ◴{historyState?.branchPoints ? <sup>{historyState.branchPoints + 1}</sup> : null}
              </button>
            </div>
            </DockPanelContent>
            </>}
          </DockManager>
          </DockRegion>
        </AppWorkspace>
        {desktop && (
          <StatusBarRegion>
          <ShellErrorBoundary title="Status" onSave={() => { void saveProject(); }}>
          <Suspense fallback={null}>
            <DesktopStatusbar
              dimensions={doc ? `${doc.width.toLocaleString()} × ${doc.height.toLocaleString()} px` : "No document open"}
              bitDepth={doc?.bitDepth ?? 8}
              colorSpace={doc?.colorSpace ?? "sRGB"}
              interactiveRenderer={engineState?.renderer ?? "canvas2d-rgba8"}
              exportRenderer={engineState?.exportRenderer ?? "canvas2d-rgba8"}
              tool={activeToolMeta?.[2] ?? "Tool"}
              shortcut={activeToolMeta ? resolveShortcut(activeToolMeta[0], activeToolMeta[3], workflowPreferences) : ""}
              zoom={zoomPercent}
            />
          </Suspense>
          </ShellErrorBoundary>
          </StatusBarRegion>
        )}
      {!desktop && <PwaToast {...pwaUpdate} />}
      {!desktop && lockerOffer && lockerAvailable && (
        <div className="luma-locker-offer" role="status">
          <span>{lockerOffer.state === "saved" ? `${lockerOffer.name} is in your Locker` : `Downloaded ${lockerOffer.name}`}</span>
          {lockerOffer.state !== "saved"
            ? <button type="button" onClick={saveOfferToLocker} disabled={lockerOffer.state === "saving"}>{lockerOffer.state === "saving" ? "Saving…" : "Save to Locker"}</button>
            : <a href="https://thecreatingco.com/locker/" target="_blank" rel="noreferrer">Open Locker</a>}
          <button type="button" className="luma-pwa-dismiss" onClick={() => setLockerOffer(null)} aria-label="Dismiss">×</button>
          <small>Locker keeps files in this browser on this device.</small>
        </div>
      )}
      </AppWindow>

      {showExportMenu && (
        <ShellErrorBoundary title="Export" region="dialog" onDismiss={() => setShowExportMenu(false)}>
        <Suspense fallback={null}>
          <ExportPopover
            onSaveProject={() => { setShowExportMenu(false); executeStudioCommand("save"); }}
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
            onExportFigma={(options) => { setShowExportMenu(false); void exportFigma(options); }}
            printAvailable={Boolean(studio && isNativeFilesystemAvailable() && studio.doc.bitDepth === 8 && studio.doc.colorSpace === "srgb" && studio.doc.width * studio.doc.height <= 4_000_000)}
            onExportPrint={() => { setShowExportMenu(false); runStudioCommand("export-print"); }}
            onExportVector={(format) => {
              if (!studio) return;
              setShowExportMenu(false);
              void studio.prepareVectorDelivery(format).then(setVectorTarget).catch(error => notify(error instanceof Error ? error.message : "Vector preflight failed"));
            }}
            onToggleGL={() => {
              if (!glSupported) return;
              const next = !useGL;
              setUseGL(next);
              studio?.setUseGL(next);
            }}
          />
        </Suspense>
        </ShellErrorBoundary>
      )}
      {printTarget && <ShellErrorBoundary title="Print output" region="dialog" onDismiss={() => setPrintTarget(null)}>
        <Suspense fallback={null}><PrintExportDialog documentName={printTarget.name} onClose={() => setPrintTarget(null)} onExport={async options => {
          if (!studio || studio.activeDocumentState().id !== printTarget.id) throw new Error("The print document changed; reopen print export from the intended tab");
          const blob = await studio.exportPrintPdf(options);
          await downloadOrSave(blob, `${printTarget.name}-cmyk.pdf`);
        }}/></Suspense>
      </ShellErrorBoundary>}
      {vectorTarget && <ShellErrorBoundary title="Vector delivery preflight" region="dialog" onDismiss={() => setVectorTarget(null)}>
        <Suspense fallback={null}><VectorPreflightDialog report={vectorTarget.report} onClose={() => setVectorTarget(null)} onInspectLayer={id => {
          try { vectorTarget.assertCurrent(); if (studio?.findLayer(id)) { setActiveLayerId(id); selectInspectorTab("properties"); } }
          catch (error) { notify(error instanceof Error ? error.message : "Document changed"); }
          setVectorTarget(null);
        }} onExport={async () => {
          if (!studio) throw new Error("The editor is not ready");
          vectorTarget.assertCurrent();
          const blob = await studio.exportVectorDocument(vectorTarget.report.format);
          vectorTarget.assertCurrent();
          await downloadOrSave(blob, `${vectorTarget.name}.${vectorTarget.report.format}`, { locker: true });
        }}/></Suspense>
      </ShellErrorBoundary>}
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
            <section className="workspace-layout-settings" aria-label="Panel layouts">
              <div className="workspace-layout-heading">
                <span><strong>Panel layouts</strong><small>Dock positions, tabs, sizes, and collapsed state</small></span>
                <button type="button" onClick={() => {
                  const name = window.prompt("Workspace name")?.trim();
                  if (!name) return;
                  const saved = { ...dockLayout, workspace: name };
                  setCustomDockWorkspaces((current) => ({ ...current, [name]: saved }));
                  setDockLayout(saved);
                }}>＋ Save current</button>
              </div>
              <div className="workspace-layout-grid">
                {BUILT_IN_WORKSPACES.map((name) => (
                  <button key={name} type="button" className={dockLayout.workspace === name ? "active" : ""} onClick={() => applyDockWorkspace(defaultDockLayout(name))}>
                    <strong>{name}</strong><small>Built-in</small>
                  </button>
                ))}
                {Object.entries(customDockWorkspaces).map(([name, layout]) => (
                  <div key={name} className={dockLayout.workspace === name ? "active" : ""}>
                    <button type="button" onClick={() => applyDockWorkspace(layout)}><strong>{name}</strong><small>Custom</small></button>
                    <button type="button" aria-label={`Delete ${name} workspace`} onClick={() => setCustomDockWorkspaces((current) => Object.fromEntries(Object.entries(current).filter(([candidate]) => candidate !== name)))}>×</button>
                  </div>
                ))}
              </div>
              <button type="button" onClick={() => applyDockWorkspace(defaultDockLayout())}>Reset default panel layout</button>
            </section>
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

      {recolorSession && studio && (
        <ShellErrorBoundary title="Recolor" region="dialog" onDismiss={() => { recolorSession.release(); setRecolorSession(null); }}>
          <Suspense fallback={null}>
            <RecolorDialog session={recolorSession}
              onClose={() => { recolorSession.release(); setRecolorSession(null); }}
              onApply={async (params, output, mode, progress) => {
                const id = await studio.applyRecolor(recolorSession, params, output, mode, progress);
                setActiveLayerId(id); forceUpdate(); recolorSession.release(); setRecolorSession(null);
                notify(output === "selection" ? "Color range selected" : output.startsWith("mask") ? "Color mask applied" : "Recolor applied · undo available");
              }} />
          </Suspense>
        </ShellErrorBoundary>
      )}

      {showMockups && studio && (
        <ShellErrorBoundary title="Mockups" region="dialog" onDismiss={() => setShowMockups(false)}>
          <Suspense fallback={null}>
            <MockupDialog projectName={projectName} getDocumentArt={() => studio.exportImage("image/png")}
              onSave={(blob, fileName) => downloadOrSave(blob, fileName, { locker: true })} onClose={() => setShowMockups(false)}
              onOpenAsDocument={async (file) => { await importDocumentFile(file); }} />
          </Suspense>
        </ShellErrorBoundary>
      )}

      {showUpscale && studio && (
        <ShellErrorBoundary title="Upscale" region="dialog" onDismiss={() => setShowUpscale(false)}>
          <Suspense fallback={null}>
            <UpscaleDialog
              getLayerCanvas={() => (activeLayer?.kind === "raster" ? activeLayer.bitmap ?? null : null)}
              onApply={(canvas, scale) => {
                const layer = studio.addRasterLayerFromCanvas(canvas, `${activeLayer?.name ?? "Layer"} ${scale}x`, activeLayer?.id);
                setActiveLayerId(layer.id);
                forceUpdate();
                notify(`Upscaled ${scale}× · added as a new layer`);
              }}
              onSave={(blob, fileName) => downloadOrSave(blob, fileName, { locker: true })}
              onClose={() => setShowUpscale(false)}
            />
          </Suspense>
        </ShellErrorBoundary>
      )}

      {showThumb && studio && (
        <ShellErrorBoundary title="Thumb" region="dialog" onDismiss={() => setShowThumb(false)}>
          <Suspense fallback={null}>
            <ThumbDialog
              getSubjectImage={() => studio.exportImage("image/png")}
              onSave={(blob, fileName) => downloadOrSave(blob, fileName, { locker: true })}
              onClose={() => setShowThumb(false)}
            />
          </Suspense>
        </ShellErrorBoundary>
      )}

      {showGlyph && (
        <ShellErrorBoundary title="Glyph" region="dialog" onDismiss={() => setShowGlyph(false)}>
          <Suspense fallback={null}>
            <GlyphDialog onClose={() => setShowGlyph(false)} onSave={(blob, fileName) => downloadOrSave(blob, fileName, { locker: true })}
              onAddText={studio ? (family, sample) => {
                try {
                  const size = Math.max(24, Math.round(Math.min(studio.doc.width, studio.doc.height) / 8));
                  const layer = studio.addTextLayer(sample, { x: studio.doc.width * 0.08, y: studio.doc.height * 0.5, color: brushColor, font: `400 ${size}px ${fontFamilyValue(family)}` });
                  setActiveLayerId(layer.id); forceUpdate();
                  notify(`Text layer set in ${family} · edit it with the Type tool`);
                } catch (error) { notify(error instanceof Error ? error.message : "Could not add the text layer"); }
              } : undefined} />
          </Suspense>
        </ShellErrorBoundary>
      )}

      {styleLayer && studio && (
        <ShellErrorBoundary title="Layer style" region="dialog" onDismiss={() => setStyleLayerId(null)}>
        <Suspense fallback={null}>
          <LayerStyleDialog layer={styleLayer} studio={studio} onClose={() => setStyleLayerId(null)} onNotify={notify} />
        </Suspense>
        </ShellErrorBoundary>
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
            <p>Restore a version, or mix an alternate branch into the current image as a new editable layer.</p>
            <div style={{ display: "grid", gridTemplateColumns: "68px minmax(0,1fr) 46px 112px", gap: 7, alignItems: "center", padding: "4px 12px 9px", fontSize: 10 }}>
              <span>Mix strength</span>
              <input type="range" min="1" max="100" value={Math.round(branchMixOpacity * 100)} onChange={(event) => setBranchMixOpacity(Number(event.target.value) / 100)} />
              <output>{Math.round(branchMixOpacity * 100)}%</output>
              <select value={branchMixBlend} onChange={(event) => setBranchMixBlend(event.target.value as BlendMode)} aria-label="Branch mix blend mode">
                <option value="source-over">Normal</option><option value="soft-light">Soft Light</option><option value="overlay">Overlay</option><option value="screen">Screen</option><option value="multiply">Multiply</option><option value="color">Color</option><option value="luminosity">Luminosity</option>
              </select>
            </div>
            <div role="tree" style={{ maxHeight: "min(56vh, 520px)", overflowY: "auto", padding: "2px 0" }}>
              {historyState?.nodes.map((node) => (
                <div
                  key={node.id}
                  role="treeitem"
                  aria-current={node.isCurrent ? "step" : undefined}
                  aria-selected={node.isCurrent}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "minmax(0,1fr) 54px",
                    alignItems: "center",
                    width: "100%",
                    gap: 5,
                    paddingLeft: 6 + node.depth * 16,
                    background: node.isCurrent
                      ? "linear-gradient(90deg,rgba(124,92,231,.3),rgba(35,133,244,.16))"
                      : node.isOnCurrentPath ? "rgba(255,255,255,.055)" : "rgba(255,255,255,.025)",
                    borderColor: node.isCurrent ? "rgba(154,126,255,.55)" : "rgba(255,255,255,.08)",
                    opacity: node.isOnCurrentPath || node.isCurrent ? 1 : 0.72,
                  }}
                >
                  <button
                    onClick={() => {
                      if (!studio || node.isCurrent) return;
                      studio.checkoutHistory(node.id);
                      notify(`Restored ${node.label}`);
                    }}
                    style={{ display: "grid", gridTemplateColumns: "20px minmax(0,1fr) auto", alignItems: "center", minWidth: 0, border: 0, background: "transparent", textAlign: "left" }}
                  >
                    <i aria-hidden="true">{node.isCurrent ? "●" : node.childCount > 1 ? "⑂" : "○"}</i>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{node.label}</span>
                    <small style={{ opacity: 0.58 }}>{node.childCount > 1 ? `${node.childCount} branches` : new Date(node.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</small>
                  </button>
                  <button
                    disabled={node.isCurrent || !node.parentId}
                    title={doc?.selection ? "Mix this version inside the active selection" : "Mix this version as a new layer"}
                    onClick={() => {
                      if (!studio) return;
                      const result = studio.mixHistoryBranch(node.id, branchMixOpacity, branchMixBlend);
                      if (result.error) { notify(result.error); return; }
                      if (result.layer) {
                        setActiveLayerId(result.layer.id);
                        notify(`${node.label} mixed as a new layer`);
                      }
                    }}
                    style={{ padding: "5px 6px", fontSize: 9 }}
                  >Mix</button>
                </div>
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
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 6, padding: "4px 8px 8px" }}>
              <button onClick={() => runFilter("blur", { radius: blurRadius })}><i>◌</i><span>Gaussian</span></button>
              <button onClick={() => runFilter("motion-blur", { radius: blurRadius * 2, angle: 0 })}><i>↔</i><span>Motion</span></button>
              <button onClick={() => runFilter("surface-blur", { radius: Math.min(12, blurRadius), threshold: 24 })}><i>◍</i><span>Surface</span></button>
              <button onClick={() => runFilter("lens-blur", { radius: blurRadius, blades: 6, rotation: 0, highlights: 0.15 })}><i>⬡</i><span>Lens</span></button>
              <button onClick={() => runFilter("high-pass", { radius: Math.min(32, blurRadius) })}><i>◇</i><span>High Pass</span></button>
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", fontSize: 12 }}>
              <span style={{ width: 90 }}>Sharpen</span>
              <input type="range" min="0" max="200" value={Math.round(sharpAmount * 100)} onChange={(e) => setSharpAmount(Number(e.target.value) / 100)} style={{ flex: 1 }} />
              <output>{sharpAmount.toFixed(2)}</output>
            </label>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 6, padding: "4px 8px 8px" }}>
              <button onClick={() => runFilter("sharpen", { radius: 2, amount: sharpAmount })}><i>✧</i><span>Unsharp</span></button>
              <button onClick={() => runFilter("median", { radius: Math.min(6, blurRadius) })}><i>⋯</i><span>Median</span></button>
              <button onClick={() => runFilter("dust-scratches", { radius: Math.min(6, blurRadius), threshold: 18 })}><i>⌁</i><span>Dust</span></button>
              <button onClick={() => runFilter("reduce-noise", { radius: Math.min(6, blurRadius), strength: 0.65, preserveDetail: 0.55, reduceColor: 0.7 })}><i>≈</i><span>Reduce Noise</span></button>
              <button onClick={() => runFilter("displace", { amount: 12, scale: 48, angle: 0 })}><i>∿</i><span>Displace</span></button>
              <button onClick={() => runFilter("maximum", { radius: Math.min(8, blurRadius) })}><i>⊕</i><span>Maximum</span></button>
              <button onClick={() => runFilter("minimum", { radius: Math.min(8, blurRadius) })}><i>⊖</i><span>Minimum</span></button>
              <button onClick={() => runFilter("invert")}><i>◑</i><span>Invert</span></button>
              <button onClick={() => runFilter("desaturate", { amount: 1 })}><i>◐</i><span>Desaturate</span></button>
              <button onClick={() => runFilter("hue", { degrees: 45 })}><i>✦</i><span>Hue +45°</span></button>
            </div>
          </section>
        </div>
      )}

      {showBatch && (
        <div className="spatial-modal" onMouseDown={() => !batchProgress && setShowBatch(false)}>
          <section
            className="batch-modal"
            onMouseDown={(e) => e.stopPropagation()}
            onDragOver={(event) => { event.preventDefault(); event.stopPropagation(); }}
            onDrop={(event) => {
              event.preventDefault();
              event.stopPropagation();
              queueBatchFiles(Array.from(event.dataTransfer.files));
            }}
          >
            <header>
              <div>
                <span>▦</span>
                <div>
                  <strong>Batch Studio</strong>
                  <small>Apply a recorded action to a set of images, download as a ZIP</small>
                </div>
              </div>
              <button aria-label="Close batch" disabled={!!batchProgress} onClick={() => setShowBatch(false)}>×</button>
            </header>
            <div className="batch-toolbar">
              <div>
                <span style={{ fontSize: 12, opacity: 0.7, marginRight: 8 }}>Action:</span>
                <select
                  value={selectedActionIdx ?? ""}
                  disabled={!!batchProgress}
                  onChange={(e) => setSelectedActionIdx(e.target.value === "" ? null : Number(e.target.value))}
                  style={{ padding: "4px 8px", fontSize: 12, borderRadius: 6, background: "rgba(255,255,255,.06)", color: "inherit", border: "1px solid rgba(255,255,255,.14)" }}
                >
                  <option value="">(none — export unchanged)</option>
                  {studio?.actions.list().map((a, i) => (
                    <option key={i} value={i}>{a.name} · {a.steps.length} steps</option>
                  ))}
                </select>
              </div>
              <button disabled={!!batchProgress} onClick={() => batchInput.current?.click()}>＋ Add images</button>
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
                      {batchItems[i]?.status === "succeeded" ? "✓" : batchItems[i]?.status === "failed" ? "!" : batchItems[i]?.status === "skipped" ? "–" : batchItems[i]?.status === "running" ? "•" : `${i + 1}`}
                    </span>
                  </div>
                  <strong>{f.name}</strong>
                  <small title={batchItems[i]?.message}>{batchItems[i]?.status ?? `${(f.size / 1024).toFixed(0)} KB`}{batchItems[i]?.message ? ` · ${batchItems[i].message}` : ""}</small>
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
                {batchProgress && <button onClick={() => batchAbortRef.current?.abort()}>Stop after current operation</button>}
                {batchFiles.length > 0 && !batchProgress && (
                  <button onClick={() => { setBatchFiles([]); setBatchItems({}); }} style={{ background: "rgba(255,255,255,.06)" }}>Clear</button>
                )}
                <button onClick={runBatchNow} disabled={!batchFiles.length || !!batchProgress}>
                  {batchProgress ? "Running…" : "Run & download ZIP ✦"}
                </button>
              </div>
            </footer>
          </section>
        </div>
      )}
      {pendingCloseDocumentId && studio && (() => {
        const pending = studio.listDocuments().find((candidate) => candidate.id === pendingCloseDocumentId);
        if (!pending) return null;
        return (
          <div className="spatial-modal" role="presentation">
            <section ref={unsavedDialogRef} className="unsaved-document-dialog" role="dialog" aria-modal="true" aria-labelledby="unsaved-document-title">
              <header><strong id="unsaved-document-title">Save changes to “{pending.name}”?</strong></header>
              <p>Your edits are not in the project file yet. Recovery is not a substitute for saving.</p>
              <footer>
                <button type="button" onClick={() => setPendingCloseDocumentId(null)}>Cancel</button>
                <button type="button" className="danger" onClick={discardPendingDocument}>Don’t Save</button>
                <button type="button" className="primary" onClick={() => void saveAndClosePendingDocument()}>Save</button>
              </footer>
            </section>
          </div>
        );
      })()}
      {pendingNativeClose && studio && (
        <div className="spatial-modal" style={{ zIndex: 10000 }} role="presentation">
          <section ref={unsavedDialogRef} className="unsaved-document-dialog" role="dialog" aria-modal="true" aria-labelledby="unsaved-quit-title">
            <header><strong id="unsaved-quit-title">Save before quitting Luma Studio?</strong></header>
            <p>{studio.dirtyDocuments().length} open document{studio.dirtyDocuments().length === 1 ? " has" : "s have"} unsaved changes. Quitting without saving permanently discards those edits.</p>
            <footer>
              <button type="button" disabled={nativeCloseBusy} onClick={() => { if (nativeCloseBusyRef.current) return; setPendingNativeClose(false); void cancelNativeClose(); }}>Cancel</button>
              <button type="button" disabled={nativeCloseBusy} className="danger" onClick={() => void discardAllAndCloseNative()}>Don’t Save</button>
              <button type="button" disabled={nativeCloseBusy} className="primary" onClick={() => void saveAllAndCloseNative()}>{nativeCloseBusy ? "Finishing…" : "Save All"}</button>
            </footer>
          </section>
        </div>
      )}
      {photoshopApproval && <ShellErrorBoundary title="Delivery preflight" region="dialog" onDismiss={() => { photoshopApproval.resolve(false); exportApprovalResolver.current = null; setPhotoshopApproval(null); }}><Suspense fallback={null}><ExportWarningDialog report={photoshopApproval.report} onChoose={proceed => { photoshopApproval.resolve(proceed); exportApprovalResolver.current = null; setPhotoshopApproval(null); }} onInspectLayer={id => {
        photoshopApproval.resolve(false); exportApprovalResolver.current = null; setPhotoshopApproval(null);
        if (studio?.activeDocumentState().id === photoshopApproval.documentId && studio.findLayer(id)) setActiveLayerId(id);
      }} /></Suspense></ShellErrorBoundary>}
      {showNewDocument && <ShellErrorBoundary title="New document" region="dialog" onDismiss={() => setShowNewDocument(false)}><Suspense fallback={null}><NewDocumentDialog onClose={() => setShowNewDocument(false)} onCreate={(width, height, name) => {
        if (!studio) throw new Error("The editor is still starting");
        studio.resetDocument(width, height, name);
        const layer = studio.addBlankRaster("Layer 1");
        setActiveLayerId(layer.id);
        // useDocumentView fits the new ID; the outgoing render's setter belongs to the old tab.
      }} /></Suspense></ShellErrorBoundary>}
      {layerRenameTarget && <ShellErrorBoundary title="Rename layer" region="dialog" onDismiss={() => setLayerRenameTarget(null)}><Suspense fallback={null}><RenameLayerDialog initialName={layerRenameTarget.name} onClose={() => setLayerRenameTarget(null)} onRename={name => {
        if (!studio || studio.activeDocumentState().id !== layerRenameTarget.documentId || !studio.findLayer(layerRenameTarget.layerId)) throw new Error("The selected layer is no longer active. Cancel and select it again.");
        studio.setLayerProp(layerRenameTarget.layerId, "name", name, "Layer renamed");
      }} /></Suspense></ShellErrorBoundary>}
      {pdfChoice && <ShellErrorBoundary title="PDF import" region="dialog" onDismiss={() => { pdfChoice.resolve(null); setPdfChoice(null); }}><Suspense fallback={null}><PdfImportDialog name={pdfChoice.name} onChoose={page => { pdfChoice.resolve(page); setPdfChoice(null); }} /></Suspense></ShellErrorBoundary>}
      {!startupReady && <div className="spatial-modal" style={{ zIndex: 10000 }} role="status" aria-label="Restoring workspace"><section className="unsaved-document-dialog"><header><strong>Restoring workspace…</strong></header><p>Preparing your documents before editing begins.</p></section></div>}
      {nativeOpening && <div className="spatial-modal" style={{ zIndex: 10000 }} role="status"><section className="unsaved-document-dialog"><header><strong>Opening document…</strong></header><p>Files open in order. Your existing documents stay open.</p></section></div>}
      {projectSaving && !downloadConfirmation && <div className="spatial-modal" style={{ zIndex: 10000 }}>
        <section className="unsaved-document-dialog" role="alertdialog" aria-modal="true" aria-label="Saving project" tabIndex={-1}>
          <header><strong>Saving project…</strong></header><p role="status">Writing your document and history. Editing resumes when the save finishes.</p>
        </section>
      </div>}
      {desktopUpdateInstalling && (
        <div className="spatial-modal" role="presentation">
          <section className="unsaved-document-dialog" role="alertdialog" aria-modal="true" aria-labelledby="desktop-update-title">
            <header><strong id="desktop-update-title">{desktopUpdatePhase}</strong></header>
            <p>Editing is paused. Luma will verify the download and checkpoint your unchanged workspace before installing and restarting. If any step fails, your documents stay open.</p>
            <footer><span aria-live="polite">Do not close the application.</span></footer>
          </section>
        </div>
      )}
      <input
        ref={batchInput}
        className="visually-hidden"
        type="file"
        aria-label="Choose images for batch processing"
        accept="image/png,image/jpeg,image/webp"
        multiple
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length) queueBatchFiles(files);
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
      {cutoutProgress && (
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
            <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 4 }}>Cutout</div>
            <div style={{ height: 4, borderRadius: 2, background: "rgba(255,255,255,0.14)", overflow: "hidden" }}>
              <div
                style={{
                  height: "100%",
                  width: `${Math.min(100, Math.max(2, cutoutProgress.pct))}%`,
                  background: "linear-gradient(90deg,#7c5ce7,#2385f4)",
                  transition: "width 200ms ease",
                }}
              />
            </div>
            <div style={{ fontSize: 11, opacity: 0.6, marginTop: 4 }}>{cutoutProgress.msg}</div>
          </div>
        </div>
      )}
      <input ref={fileInput} className="visually-hidden" type="file" aria-label="Open a file" accept={`.luma,.pdf,.lumaformtext,.lumaformmesh,.psd,.psb,image/*,${RAW_EXTENSIONS.map((extension) => `.${extension}`).join(",")}`} onChange={onFileChange} />
      <input ref={psdInput} className="visually-hidden" type="file" aria-label="Import a Photoshop file" accept=".psd,.psb,image/vnd.adobe.photoshop" onChange={onPsdImport} />
      <input ref={projectInput} className="visually-hidden" type="file" aria-label="Open a Luma project" accept=".luma,application/x-luma-project" onChange={onProjectImport} />
      <input ref={smartContentInput} className="visually-hidden" type="file" aria-label="Replace smart content" accept="image/png,image/jpeg,image/webp" onChange={async event => {
        const file = event.target.files?.[0];
        event.target.value = "";
        const target = smartContentTarget.current;
        smartContentTarget.current = null;
        if (!file || !target || !studio) return;
        try {
          const { replaceSmartContentFromFile } = await import("./smart-content-import");
          await replaceSmartContentFromFile(studio, target, file);
          notify("Contents replaced · fitted within original bounds; transform and styling preserved");
          forceUpdate();
        } catch (error) { notify(error instanceof Error ? error.message : "Content replacement failed"); }
      }} />
      <input ref={captureInput} className="visually-hidden" type="file" aria-label="Upload a sample image" accept="image/png,image/jpeg,image/webp,image/gif,image/bmp,image/tiff" onChange={onCaptureUpload} />
      <input ref={focusImportInput} className="visually-hidden" type="file" multiple aria-label="Import images" accept="image/png,image/jpeg,image/webp,image/gif,image/bmp,image/tiff" onChange={onFocusImportChange} />
      <input ref={pluginInput} className="visually-hidden" type="file" aria-label="Install a Luma plugin" accept=".luma-plugin,application/json" onChange={onPluginInstall} />
      {dropActive && (
        <div className="studio-drop-overlay" aria-hidden="true">
          <div className="studio-drop-card">
            <strong>Drop to import</strong>
            <span>Images become layers fitted to the canvas · PSD and .luma open as documents</span>
          </div>
        </div>
      )}
      {toast && <div className="spatial-toast" role="status">{toast}</div>}
      {downloadConfirmation && <DownloadConfirmation name={downloadConfirmation.name} onResolve={saved => { downloadConfirmation.resolve(saved); setDownloadConfirmation(null); }} />}
      {projectSaveError && <section className="project-save-error" role="alert" aria-label="Project not saved">
        <strong>Project not saved — keep this document open</strong>
        <p>{projectSaveError}</p>
        <button onClick={() => setProjectSaveError(null)}>Dismiss</button>
      </section>}
    </AppShell>
  );
}
