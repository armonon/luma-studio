import {
  BlendMode,
  BlendPass,
  BlendIf,
  AiProvenance,
  Document,
  HslParams,
  Guide,
  IDENTITY_TRANSFORM,
  Layer,
  LayerKind,
  LayerEffect,
  MAX_LAYER_BLEND_PASSES,
  LevelsParams,
  NEUTRAL_CURVES,
  NEUTRAL_HSL,
  NEUTRAL_LEVELS,
  NEUTRAL_TONE,
  PathStyle,
  ProofSettings,
  RawLayerSource,
  Selection,
  ShapeStyle,
  SourceProvenance,
  SmartFilter,
  TextStyle,
  ToneParams,
  Transform,
  cloneCurves,
  createAdjustmentLayer,
  createCurvesLayer,
  createDocument,
  createHslLayer,
  createLevelsLayer,
  createGroupLayer,
  createPathLayer,
  createRasterLayer,
  createShapeLayer,
  createTextLayer,
  ensureMask,
  newCanvas,
  nextId,
  resolvedBlendPasses,
  resolvedBlendIf,
  resolvedFillOpacity,
} from "./document";
import { isNeutralBlendIf } from "./blend";
import {
  BrushParams,
  BrushPoint,
  PaintSegmentState,
  createPaintSegmentState,
  paintSegment,
  parseBrushColor,
  planStroke,
  replayStrokeFloat,
} from "./brush";
import { renderClean, renderViewport, viewportRenderCacheStats } from "./renderer";
import { bumpBitmapVersion, isGLSupported, renderGL } from "./gl-renderer";
import {
  SelectionMode,
  RefineSelectionParams,
  deselect,
  featherSelection,
  invertSelection,
  refineSelection,
  selectAll,
  selectByColor,
  selectEllipse,
  selectLasso,
  selectText,
  selectRect,
} from "./selection";
import {
  desaturate,
  gaussianBlur,
  hueRotate,
  invertColors,
  unsharpMask,
} from "./filters";
import type { Curves } from "./document";
import { Action, ActionRecorder, ActionStep } from "./actions";
import {
  cloneBlendIf,
  cloneBlendStack,
  cloneDocument,
  cloneEffects,
  cloneFilters,
  cloneRawSettings,
  cloneSelection,
  deepClonePath,
  historyEntrySize,
  shallowCloneLayer,
  snapshotLayer,
} from "./history-payload";
import { paintTarget } from "./stroke-target";
import { applyLayerSnapshot } from "./layer-snapshot-apply";
import {
  AdjustmentKind,
  AdjustmentParams,
  adjustmentLabel,
  applyAdjustment,
  isAdjustmentLayer,
  snapshotForAdjustment,
} from "./layer-mutations";
import { autoLumaMaskInPlace, clearMaskInPlace, invertMaskInPlace } from "./mask-ops";
import { withSelectionCommit } from "./selection-driver";
import {
  exportPhotoshopDocument,
  exportPsd,
  importPsd,
  photoshopCompatibilityReport,
  type PhotoshopExportOptions,
} from "./psd";
import { OperationHistory } from "./operation-history";
import { DEFAULT_TILE_SIZE, PixelFormat, PixelRect, PrecisionTileSurface, TileGrid } from "./tile-store";
import { precisionPreviewCacheStats } from "./precision-renderer";
import { displaySrgbToWorking } from "./color";
import { replayRetouch, type RetouchMode } from "./retouch";
import { IndexedDbTileBacking } from "./tile-backing";
import type { DevelopedDng } from "./raw-dng";
import { DngDevelopSession, previewDisplayRgba } from "./raw-dng";
import type { RawDevelopSettings } from "./raw-develop";
import { developedDngToSurface } from "./raw-surface";
import { defaultColorProfileRegistry } from "./color-management";
import {
  PyramidDirtyTracker,
  ViewportTilePlanner,
  VirtualCanvasPyramid,
  type ViewportPlan,
} from "./virtual-canvas";
import { calculateDisplayViewport, type DisplayViewport } from "./viewport";
import {
  normalizeAiEditConfig,
  runAiEditVariations,
  selectionAlphaToEditMask,
  type AiEditOperation,
  type AiEditQuality,
  type AiOperationControls,
  type AiSelectionGuide,
} from "./ai-edit";
import {
  createGradientPixels,
  createPatternPixels,
  radialWarp,
  rectifyQuadrilateral,
  rgbaToHex,
  warpToQuadrilateral,
  type PatternKind,
  type Point,
  type Quad,
} from "./advanced-tools";

type SubscribeFn = () => void;

export type LayerSnapshot = {
  layerId: string;
  bitmap?: HTMLCanvasElement;
  surface?: PrecisionTileSurface;
  mask?: HTMLCanvasElement;
  tone?: ToneParams;
  curves?: Curves;
  levels?: LevelsParams;
  hsl?: HslParams;
  opacity?: number;
  fillOpacity?: number | null;
  blend?: BlendMode;
  blendStack?: BlendPass[] | null;
  blendIf?: BlendIf | null;
  visible?: boolean;
  name?: string;
  transform?: Transform;
  text?: TextStyle;
  shape?: ShapeStyle;
  path?: PathStyle;
  parentId?: string | null;
  locked?: boolean;
  clipping?: boolean;
  filters?: SmartFilter[];
  ai?: AiProvenance;
  raw?: RawLayerSource;
  effects?: LayerEffect[];
};

export type HistoryEntry = {
  label: string;
  before: LayerSnapshot[];
  after: LayerSnapshot[];
  layersBefore?: Layer[];
  layersAfter?: Layer[];
  selectionBefore?: Selection | null;
  selectionAfter?: Selection | null;
  pixelPatches?: PixelPatch[];
  surfacePatches?: SurfaceTilePatch[];
  guidesBefore?: Guide[];
  guidesAfter?: Guide[];
  documentBefore?: Document;
  documentAfter?: Document;
};

export type SurfaceTilePatch = {
  layerId: string;
  key: string;
  before: Uint8Array | null;
  after: Uint8Array | null;
};

export type PixelPatch = {
  layerId: string;
  target: "bitmap" | "mask";
  x: number;
  y: number;
  before: ImageData;
  after: ImageData;
};

type StrokeTile = Omit<PixelPatch, "after">;

type DocumentSession = {
  id: string;
  name: string;
  doc: Document;
  history: OperationHistory<HistoryEntry>;
};

export const HISTORY_LIMIT = 80;
export const HISTORY_MAX_BYTES = 512 * 1024 * 1024; // 512 MB across all entries

export function newHistory() {
  return new OperationHistory<HistoryEntry>({
    maxNodes: HISTORY_LIMIT,
    maxBytes: HISTORY_MAX_BYTES,
    sizeOf: historyEntrySize,
  });
}

/**
 * Version of the scripting/plugin surface. Bump the minor on any breaking
 * change to `LumaAPI` or to what `activate(studio)` may rely on. While we are
 * pre-1.0, minor bumps are breaking (standard 0.x semantics).
 */
export const LUMA_API_VERSION = "0.3";

export type LumaPlugin = {
  id: string;
  name: string;
  /** The plugin's own version. Informational; not used for compatibility. */
  version?: string;
  /**
   * The Luma API version this plugin was written against, e.g. "0.3". When
   * present it is checked against LUMA_API_VERSION and registration is
   * rejected on mismatch, so a stale plugin fails loudly at register time
   * rather than misbehaving somewhere deep in an edit.
   */
  apiVersion?: string;
  activate(studio: Studio): void | (() => void);
};

/** 0.x semantics: the minor is the breaking-change axis. */
export function isCompatibleApiVersion(declared: string, current = LUMA_API_VERSION) {
  const key = (v: string) => v.trim().split(".").slice(0, 2).join(".");
  return key(declared) === key(current);
}

export class Studio {
  doc: Document;
  target: HTMLCanvasElement;
  actions = new ActionRecorder();
  useGL = false; // GPU compositing (RGBA16F) when true and supported
  private subscribers = new Set<SubscribeFn>();
  private history = newHistory();
  private renderScheduled = false;
  private renderRevision = 0;
  private disposed = false;
  private antsTimer: number | null = null;
  private strokeTiles: Map<string, StrokeTile> | null = null;
  private lastPoint: BrushPoint | null = null;
  private paintSegmentState: PaintSegmentState | null = null;
  private precisionStroke: {
    layerId: string;
    params: BrushParams;
    points: BrushPoint[];
    before: Map<string, Uint8Array | null>;
  } | null = null;
  private retouchStroke: {
    layerId: string;
    mode: RetouchMode;
    params: BrushParams;
    points: BrushPoint[];
    before: Map<string, Uint8Array | null>;
    source: PrecisionTileSurface;
    sourceOffsetX: number;
    sourceOffsetY: number;
  } | null = null;
  private sessions: DocumentSession[] = [];
  private activeSessionId = "";
  private liveSnapshots = new Map<string, LayerSnapshot>();
  private plugins = new Map<string, { plugin: LumaPlugin; dispose?: () => void }>();
  private tileBacking = IndexedDbTileBacking.supported() ? new IndexedDbTileBacking() : null;
  private rawSessions = new Map<string, DngDevelopSession>();
  private virtualPyramid: VirtualCanvasPyramid;
  private virtualPlanner: ViewportTilePlanner;
  private virtualDirty: PyramidDirtyTracker;
  private virtualPlan: ViewportPlan | null = null;
  private displayViewport: DisplayViewport | null = null;

  constructor(width: number, height: number, target: HTMLCanvasElement) {
    this.doc = createDocument(width, height);
    this.target = target;
    this.virtualPyramid = new VirtualCanvasPyramid(width, height, DEFAULT_TILE_SIZE);
    this.virtualPlanner = new ViewportTilePlanner(this.virtualPyramid);
    this.virtualDirty = new PyramidDirtyTracker(this.virtualPyramid);
    const session: DocumentSession = {
      id: nextId("doc"),
      name: "Untitled",
      doc: this.doc,
      history: this.history,
    };
    this.sessions = [session];
    this.activeSessionId = session.id;
    // Marching ants: instead of running a full-viewport recomposite at 60 Hz,
    // schedule a cheap re-render only every ~200 ms while a selection exists,
    // and only if we're not already scheduled. Composite-vs-ant repaint could
    // eventually be split so ants animate over a cached bitmap, but this alone
    // is a ~12x CPU cut vs. the old RAF path.
    // Headless (unit-test / worker) construction is supported: everything that
    // needs a DOM is deferred, so a Studio can be built and driven for
    // document, history and plugin work without a browser. Only the render and
    // export paths require a real canvas.
    if (Studio.hasDom()) {
      const ants = () => {
        if (this.disposed) return;
        if (this.doc.selection && !this.renderScheduled) this.requestRender();
        this.antsTimer = window.setTimeout(ants, 200);
      };
      this.antsTimer = window.setTimeout(ants, 200);
    }
  }

  /** Whether a DOM with animation timing is available. False under node. */
  private static hasDom() {
    return typeof window !== "undefined" && typeof requestAnimationFrame === "function";
  }

  static canUseGL() { return isGLSupported(); }

  /**
   * Enable GPU (RGBA16F, linear-light) compositing for **export and flatten
   * only**. The interactive viewport stays on the CPU tiled renderer because
   * `renderGL` has no viewport concept — see the note in `requestRender`.
   */
  setUseGL(v: boolean) {
    this.useGL = v;
    this.emit();
  }

  subscribe(fn: SubscribeFn) {
    this.subscribers.add(fn);
    return () => this.subscribers.delete(fn);
  }

  dispose() {
    this.disposed = true;
    if (this.antsTimer !== null) {
      window.clearTimeout(this.antsTimer);
      this.antsTimer = null;
    }
    // Third-party dispose handlers must not be able to abort teardown — an
    // uncaught throw here previously skipped both clear() calls below, leaking
    // every React subscriber onto a disposed Studio.
    for (const [id, entry] of this.plugins) runPluginDispose(id, entry.dispose);
    this.plugins.clear();
    this.subscribers.clear();
  }
  private emit() {
    for (const fn of this.subscribers) fn();
  }

  private resetVirtualGeometry(width: number, height: number) {
    this.virtualPyramid = new VirtualCanvasPyramid(width, height, DEFAULT_TILE_SIZE);
    this.virtualPlanner = new ViewportTilePlanner(this.virtualPyramid);
    this.virtualDirty = new PyramidDirtyTracker(this.virtualPyramid);
    this.virtualPlan = null;
    this.displayViewport = null;
  }

  /** Keep a bounded, priority-ordered tile plan aligned with the visible canvas. */
  setVirtualViewport(viewport: DisplayViewport) {
    this.displayViewport = viewport;
    this.virtualPlan = this.virtualPlanner.plan(viewport, {
      prefetchMarginTiles: 1,
      fallbackLevels: 2,
      maxRequests: 2048,
    });
    this.requestRender();
    return this.virtualPlan;
  }

  private fallbackDisplayViewport() {
    return calculateDisplayViewport(
      this.doc.width,
      this.doc.height,
      this.target.clientWidth || Math.min(this.doc.width, 1280),
      this.target.clientHeight || Math.min(this.doc.height, 900),
      { zoom: 1, panX: 0, panY: 0 },
      typeof devicePixelRatio === "number" ? devicePixelRatio : 1,
    );
  }

  requestRender() {
    this.renderRevision += 1;
    // Headless: there is nothing to paint into and no frame clock. Bumping the
    // revision is still correct so cache invalidation stays consistent.
    if (!Studio.hasDom()) return;
    if (this.renderScheduled) return;
    this.renderScheduled = true;
    requestAnimationFrame(() => {
      this.renderScheduled = false;
      // GPU preview when the user has asked for it AND the platform actually
      // supports RGBA16F FBOs. Any failure falls straight back to the CPU path
      // so the toggle can't visually break the app.
      // The interactive viewport is CPU-only on purpose. `renderGL` composites
      // the whole document 1:1 and takes no DisplayViewport, so routing the
      // preview through it silently discards zoom/pan, distorts aspect ratio,
      // desynchronises the overlay plane and pointer mapping, and drops the
      // selection outline. Until renderGL accepts a viewport, GPU compositing
      // is used only for export/flatten (see exportImage/flatten).
      renderViewport(this.doc, this.target, this.displayViewport ?? this.fallbackDisplayViewport(), {
        cacheRevision: this.renderRevision,
      });
    });
  }

  private commit(entry: HistoryEntry) {
    this.history.commit(entry.label, entry);
    this.virtualDirty.invalidateAll();
    this.emit();
  }

  canUndo() { return this.history.canUndo(); }
  canRedo() { return this.history.canRedo(); }
  historyLabels() { return this.history.lineage().map((node) => node.label); }
  historyState() {
    return {
      ...this.history.summary(),
      nodes: this.history.tree(),
      redoBranches: this.history.branches(),
    };
  }
  engineState() {
    const surfaces = this.doc.layers.flatMap((layer) => [layer.bitmap, layer.mask]).filter(Boolean) as HTMLCanvasElement[];
    if (this.doc.selection) surfaces.push(this.doc.selection.mask);
    let tiles = 0;
    let workingSetBytes = 0;
    for (const surface of surfaces) {
      const grid = new TileGrid(surface.width, surface.height, DEFAULT_TILE_SIZE);
      tiles += grid.totalTiles;
      workingSetBytes += grid.estimatedBytes("rgba8");
    }
    let precisionTiles = 0;
    let precisionBytes = 0;
    for (const layer of this.doc.layers) {
      if (!layer.surface) continue;
      const stats = layer.surface.stats();
      precisionTiles += stats.residentTiles;
      precisionBytes += stats.residentBytes;
    }
    workingSetBytes += precisionBytes;
    const blendPasses = this.doc.layers.reduce((count, layer) => count + (layer.kind === "group" ? 0 : resolvedBlendPasses(layer).length), 0);
    const advancedBlendLayers = this.doc.layers.filter((layer) => !isNeutralBlendIf(resolvedBlendIf(layer)) || resolvedFillOpacity(layer) < 1).length;
    const photoshop = photoshopCompatibilityReport(this.doc, { format: "auto" });
    return {
      // The interactive viewport is always the CPU tiled renderer; `useGL`
      // only selects the export/flatten path, so it is reported separately
      // rather than being conflated with what is on screen.
      renderer: this.displayViewport
        ? "viewport-tiled-canvas2d" as const
        : "canvas2d-rgba8" as const,
      exportRenderer: this.useGL && isGLSupported()
        ? "webgl2-rgba16f" as const
        : "canvas2d-rgba8" as const,
      historyOverBudget: this.history.overBudget(),
      plugins: this.plugins.size,
      tileSize: DEFAULT_TILE_SIZE,
      tiles,
      precisionTiles,
      precisionBytes,
      surfaces: surfaces.length,
      workingSetBytes,
      layers: this.doc.layers.length,
      blendPasses,
      advancedBlendLayers,
      colorSpace: this.doc.colorSpace,
      bitDepth: this.doc.bitDepth,
      colorManagement: {
        profiles: defaultColorProfileRegistry.list().length,
        transformCache: defaultColorProfileRegistry.transforms.stats,
        embeddedProfiles: this.doc.layers.filter((layer) => !!layer.source?.colorProfile).length,
      },
      virtualCanvas: {
        levels: this.virtualPyramid.maxLevel + 1,
        totalBaseTiles: this.virtualPyramid.level(0).totalTiles,
        plannedLevel: this.virtualPlan?.level ?? 0,
        plannedTiles: this.virtualPlan?.requests.length ?? 0,
        visibleTiles: this.virtualPlan?.visibleTileCount ?? 0,
        fallbackTiles: this.virtualPlan?.fallbackTileCount ?? 0,
        prefetchTiles: this.virtualPlan?.prefetchTileCount ?? 0,
        truncated: this.virtualPlan?.truncated ?? false,
        dirty: this.virtualDirty.stats(),
      },
      photoshop: {
        container: photoshop.container,
        canExport: photoshop.canExport,
        warnings: photoshop.issues.filter((issue) => issue.severity === "warning").length,
        preserved: photoshop.issues.filter((issue) => issue.severity === "info").length,
      },
      proofing: { ...this.doc.proofing },
      previewCache: precisionPreviewCacheStats(),
      viewportCache: viewportRenderCacheStats(),
      tileBacking: this.tileBacking?.stats() ?? { supported: false, writes: 0, bytesWritten: 0, failures: 0 },
      history: this.history.summary(),
    };
  }

  undo() {
    const node = this.history.undo();
    if (!node?.value) return;
    this.applyHistoryEntry(node.value, "before");
    this.liveSnapshots.clear();
    this.requestRender();
    this.emit();
  }
  redo(branchId?: string) {
    const node = this.history.redo(branchId);
    if (!node?.value) return;
    this.applyHistoryEntry(node.value, "after");
    this.liveSnapshots.clear();
    this.requestRender();
    this.emit();
  }

  checkoutHistory(nodeId: string) {
    const transition = this.history.checkout(nodeId);
    if (!transition.undo.length && !transition.redo.length) return false;
    for (const node of transition.undo) {
      if (node.value) this.applyHistoryEntry(node.value, "before");
    }
    for (const node of transition.redo) {
      if (node.value) this.applyHistoryEntry(node.value, "after");
    }
    this.liveSnapshots.clear();
    this.requestRender();
    this.emit();
    return true;
  }

  private applyHistoryEntry(entry: HistoryEntry, side: "before" | "after") {
    const document = side === "before" ? entry.documentBefore : entry.documentAfter;
    if (document) this.doc = cloneDocument(document);
    this.applySnapshots(side === "before" ? entry.before : entry.after);
    const layers = side === "before" ? entry.layersBefore : entry.layersAfter;
    if (layers) this.doc.layers = layers.map(shallowCloneLayer);
    const selectionKey = side === "before" ? "selectionBefore" : "selectionAfter";
    if (selectionKey in entry) {
      const selection = entry[selectionKey];
      this.doc.selection = cloneSelection(selection);
    }
    if (entry.pixelPatches) this.applyPixelPatches(entry.pixelPatches, side);
    if (entry.surfacePatches) this.applySurfacePatches(entry.surfacePatches, side);
    const guides = side === "before" ? entry.guidesBefore : entry.guidesAfter;
    if (guides) this.doc.guides = guides.map((guide) => ({ ...guide }));
    this.checkpointDocumentSurfaces(true);
  }
  private applySnapshots(snaps: LayerSnapshot[]) {
    for (const snap of snaps) {
      const layer = this.doc.layers.find((l) => l.id === snap.layerId);
      if (!layer) continue;
      const { bitmapReplaced } = applyLayerSnapshot(layer, snap);
      if (bitmapReplaced && !snap.surface) this.syncLayerSurface(layer);
      this.checkpointLayerSurface(layer);
    }
  }

  private applyPixelPatches(patches: PixelPatch[], side: "before" | "after") {
    for (const patch of patches) {
      const layer = this.findLayer(patch.layerId);
      const canvas = patch.target === "bitmap" ? layer?.bitmap : layer?.mask;
      if (!canvas) continue;
      canvas.getContext("2d")!.putImageData(patch[side], patch.x, patch.y);
      bumpBitmapVersion(canvas);
      if (patch.target === "bitmap" && layer) this.syncLayerSurface(layer, {
        x: patch.x,
        y: patch.y,
        width: patch[side].width,
        height: patch[side].height,
      });
      if (layer) this.checkpointLayerSurface(layer);
    }
  }

  private applySurfacePatches(patches: SurfaceTilePatch[], side: "before" | "after") {
    for (const patch of patches) {
      const layer = this.findLayer(patch.layerId);
      if (!layer?.surface) continue;
      const bytes = patch[side];
      if (bytes) layer.surface.store.write(patch.key, bytes);
      else layer.surface.store.delete(patch.key);
      this.updateLayerBitmapTile(layer, patch.key);
      this.checkpointLayerSurface(layer);
    }
  }

  // --- doc lifecycle ---
  listDocuments() {
    this.saveActiveSession();
    return this.sessions.map((session) => ({
      id: session.id,
      name: session.name,
      active: session.id === this.activeSessionId,
    }));
  }

  switchDocument(id: string) {
    if (id === this.activeSessionId) return;
    const next = this.sessions.find((session) => session.id === id);
    if (!next) return;
    this.saveActiveSession();
    this.activeSessionId = next.id;
    this.doc = next.doc;
    this.history = next.history;
    this.resetVirtualGeometry(this.doc.width, this.doc.height);
    this.requestRender();
    this.emit();
  }

  closeDocument(id: string) {
    if (this.sessions.length <= 1) return;
    const index = this.sessions.findIndex((session) => session.id === id);
    if (index < 0) return;
    const wasActive = id === this.activeSessionId;
    this.sessions.splice(index, 1);
    if (wasActive) {
      const next = this.sessions[Math.min(index, this.sessions.length - 1)];
      this.activeSessionId = next.id;
      this.doc = next.doc;
      this.history = next.history;
      this.resetVirtualGeometry(this.doc.width, this.doc.height);
      this.requestRender();
    }
    this.emit();
  }

  private saveActiveSession() {
    const session = this.sessions.find((candidate) => candidate.id === this.activeSessionId);
    if (!session) return;
    session.doc = this.doc;
    session.history = this.history;
  }

  private installDocument(doc: Document, name: string) {
    this.rawSessions.clear();
    this.resetVirtualGeometry(doc.width, doc.height);
    this.ensureDocumentSurfaces(doc);
    this.saveActiveSession();
    const current = this.sessions.find((session) => session.id === this.activeSessionId);
    if (current && current.doc.layers.length === 0) {
      current.name = name;
      current.doc = doc;
      current.history = newHistory();
      this.doc = doc;
      this.history = current.history;
      this.checkpointDocumentSurfaces(true);
      return;
    }
    const session: DocumentSession = {
      id: nextId("doc"),
      name,
      doc,
      history: newHistory(),
    };
    this.sessions.push(session);
    this.activeSessionId = session.id;
    this.doc = doc;
    this.history = session.history;
    this.checkpointDocumentSurfaces(true);
  }

  resetDocument(width: number, height: number) {
    const next = createDocument(width, height);
    this.installDocument(next, "Untitled");
    this.history = newHistory();
    const session = this.sessions.find((candidate) => candidate.id === this.activeSessionId);
    if (session) session.history = this.history;
    this.requestRender();
    this.emit();
  }

  openImage(name: string, img: HTMLImageElement, source?: SourceProvenance) {
    this.installDocument(createDocument(img.naturalWidth, img.naturalHeight), name);
    return this.addRasterFromImage(name, img, source);
  }

  /** Install a sensor-developed DNG without quantizing its float master. */
  openDevelopedDng(name: string, original: ArrayBuffer, developed: DevelopedDng) {
    const doc = createDocument(developed.width, developed.height);
    doc.bitDepth = 32;
    doc.colorSpace = developed.settings.workingSpace;
    this.installDocument(doc, name);
    const bitmap = developedDngPreviewCanvas(developed);
    const layer = createRasterLayer(name, bitmap);
    layer.surface = developedDngToSurface(developed, "rgba32f");
    layer.source = {
      originalName: developed.provenance.originalName,
      format: developed.provenance.format,
      mode: "dng-cfa-developed",
      originalBytes: developed.provenance.originalBytes,
    };
    layer.raw = {
      original: new Uint8Array(original.slice(0)),
      settings: cloneRawSettings(developed.settings),
      decoder: developed.provenance.decoder,
      boundary: developed.provenance.boundary,
      matrixSource: developed.provenance.matrixSource,
      sensor: {
        bitsPerSample: developed.metadata.bitsPerSample,
        dngVersion: developed.metadata.dngVersion,
        warnings: [...developed.metadata.warnings],
      },
    };
    this.commitStructural(`${name} developed from DNG`, () => this.doc.layers.unshift(layer));
    this.checkpointLayerSurface(layer);
    this.requestRender();
    return layer;
  }

  /** Re-run the sensor pipeline from the embedded original DNG and commit one undo step. */
  redevelopRaw(layerId: string, patch: Partial<RawDevelopSettings>) {
    const layer = this.findLayer(layerId);
    if (!layer?.raw || layer.source?.mode !== "dng-cfa-developed") return false;
    const before = snapshotLayer(layer);
    let session = this.rawSessions.get(layerId);
    if (!session) {
      const source = layer.raw.original.slice().buffer as ArrayBuffer;
      session = new DngDevelopSession(source, layer.source.originalName, layer.raw.settings);
      this.rawSessions.set(layerId, session);
    }
    const developed = session.develop({
      ...patch,
      // A layer master always stays in the document working space.
      workingSpace: this.doc.colorSpace,
    });
    layer.bitmap = developedDngPreviewCanvas(developed);
    bumpBitmapVersion(layer.bitmap);
    layer.surface = developedDngToSurface(developed, pixelFormatForDepth(this.doc.bitDepth));
    layer.raw = {
      ...layer.raw,
      settings: cloneRawSettings(developed.settings),
      matrixSource: developed.provenance.matrixSource,
      sensor: {
        bitsPerSample: developed.metadata.bitsPerSample,
        dngVersion: developed.metadata.dngVersion,
        warnings: [...developed.metadata.warnings],
      },
    };
    const after = snapshotLayer(layer);
    this.commit({ label: "RAW developed", before: [before], after: [after] });
    this.checkpointLayerSurface(layer, true);
    this.requestRender();
    return true;
  }

  // --- layer helpers ---
  findLayer(id: string) { return this.doc.layers.find((l) => l.id === id); }
  activeLayer(id: string | null) { return id ? this.findLayer(id) ?? null : null; }

  addGuide(orientation: Guide["orientation"], position: number) {
    const before = this.doc.guides.map((guide) => ({ ...guide }));
    const limit = orientation === "vertical" ? this.doc.width : this.doc.height;
    const guide: Guide = { id: nextId("guide"), orientation, position: Math.max(0, Math.min(limit, position)) };
    this.doc.guides = [...this.doc.guides, guide];
    this.commit({ label: "Guide added", before: [], after: [], guidesBefore: before, guidesAfter: this.doc.guides.map((item) => ({ ...item })) });
    this.requestRender();
    return guide;
  }

  removeGuide(id: string) {
    const before = this.doc.guides.map((guide) => ({ ...guide }));
    this.doc.guides = this.doc.guides.filter((guide) => guide.id !== id);
    if (before.length === this.doc.guides.length) return;
    this.commit({ label: "Guide removed", before: [], after: [], guidesBefore: before, guidesAfter: this.doc.guides.map((guide) => ({ ...guide })) });
    this.requestRender();
  }

  clearGuides() {
    if (!this.doc.guides.length) return;
    const before = this.doc.guides.map((guide) => ({ ...guide }));
    this.doc.guides = [];
    this.commit({ label: "Guides cleared", before: [], after: [], guidesBefore: before, guidesAfter: [] });
    this.requestRender();
  }

  cropToSelection() {
    const bounds = this.doc.selection?.bounds;
    if (!bounds) return false;
    return this.cropRect(bounds.x, bounds.y, bounds.w, bounds.h, "Crop to selection");
  }

  cropRect(inputX: number, inputY: number, requestedWidth: number, requestedHeight: number, label = "Crop") {
    const x = Math.max(0, Math.floor(inputX));
    const y = Math.max(0, Math.floor(inputY));
    const width = Math.min(this.doc.width - x, Math.max(1, Math.ceil(requestedWidth)));
    const height = Math.min(this.doc.height - y, Math.max(1, Math.ceil(requestedHeight)));
    if (x === 0 && y === 0 && width === this.doc.width && height === this.doc.height) return false;
    const before = cloneDocument(this.doc);
    for (const layer of this.doc.layers) {
      layer.transform = { ...layer.transform, tx: layer.transform.tx - x, ty: layer.transform.ty - y };
      if (layer.mask) {
        const mask = newCanvas(width, height);
        mask.getContext("2d")!.drawImage(layer.mask, -x, -y);
        layer.mask = mask;
      }
    }
    this.doc.width = width;
    this.doc.height = height;
    this.resetVirtualGeometry(width, height);
    this.doc.guides = this.doc.guides
      .map((guide) => ({ ...guide, position: guide.position - (guide.orientation === "vertical" ? x : y) }))
      .filter((guide) => guide.position >= 0 && guide.position <= (guide.orientation === "vertical" ? width : height));
    this.doc.selection = null;
    const after = cloneDocument(this.doc);
    this.commit({ label, before: [], after: [], documentBefore: before, documentAfter: after });
    this.requestRender();
    return true;
  }

  perspectiveCrop(quad: Quad) {
    const before = cloneDocument(this.doc);
    const composite = newCanvas(this.doc.width, this.doc.height);
    renderClean(this.doc, composite);
    const source = composite.getContext("2d")!.getImageData(0, 0, composite.width, composite.height);
    const rectified = rectifyQuadrilateral({ width: source.width, height: source.height, data: source.data }, quad);
    const bitmap = newCanvas(rectified.width, rectified.height);
    bitmap.getContext("2d")!.putImageData(new ImageData(Uint8ClampedArray.from(rectified.data), rectified.width, rectified.height), 0, 0);
    const layer = createRasterLayer("Perspective crop", bitmap);
    this.doc.width = rectified.width;
    this.doc.height = rectified.height;
    this.doc.layers = [layer];
    this.doc.guides = [];
    this.doc.selection = null;
    this.resetVirtualGeometry(rectified.width, rectified.height);
    layer.surface = this.surfaceFromCanvas(bitmap);
    this.checkpointLayerSurface(layer);
    const after = cloneDocument(this.doc);
    this.commit({ label: "Perspective crop", before: [], after: [], documentBefore: before, documentAfter: after });
    this.requestRender();
    return layer;
  }

  straightenDocument(angleRadians: number) {
    if (!Number.isFinite(angleRadians) || Math.abs(angleRadians) < 1e-5) return false;
    const before = cloneDocument(this.doc);
    const centerX = this.doc.width / 2;
    const centerY = this.doc.height / 2;
    const cosine = Math.cos(angleRadians);
    const sine = Math.sin(angleRadians);
    for (const layer of this.doc.layers) {
      const t = layer.transform;
      const layerCenterX = t.tx + this.doc.width * t.sx / 2;
      const layerCenterY = t.ty + this.doc.height * t.sy / 2;
      const dx = layerCenterX - centerX;
      const dy = layerCenterY - centerY;
      const rotatedCenterX = centerX + dx * cosine - dy * sine;
      const rotatedCenterY = centerY + dx * sine + dy * cosine;
      layer.transform = {
        ...t,
        rotation: t.rotation + angleRadians,
        tx: rotatedCenterX - this.doc.width * t.sx / 2,
        ty: rotatedCenterY - this.doc.height * t.sy / 2,
      };
    }
    const after = cloneDocument(this.doc);
    this.commit({ label: "Straighten image", before: [], after: [], documentBefore: before, documentAfter: after });
    this.requestRender();
    return true;
  }

  sampleLayerColor(layerId: string, x: number, y: number) {
    const layer = this.findLayer(layerId);
    if (!layer?.bitmap) return null;
    const px = Math.max(0, Math.min(layer.bitmap.width - 1, Math.round(x)));
    const py = Math.max(0, Math.min(layer.bitmap.height - 1, Math.round(y)));
    return rgbaToHex(layer.bitmap.getContext("2d")!.getImageData(px, py, 1, 1).data);
  }

  private applyGeneratedFill(layerId: string, pixels: { width: number; height: number; data: Uint8ClampedArray }, label: string) {
    const layer = this.findLayer(layerId);
    if (!layer?.bitmap || layer.locked) return false;
    const before = [snapshotLayer(layer)];
    const generated = newCanvas(pixels.width, pixels.height);
    generated.getContext("2d")!.putImageData(new ImageData(Uint8ClampedArray.from(pixels.data), pixels.width, pixels.height), 0, 0);
    if (this.doc.selection) {
      const context = generated.getContext("2d")!;
      context.globalCompositeOperation = "destination-in";
      context.drawImage(this.doc.selection.mask, 0, 0);
      context.globalCompositeOperation = "source-over";
    }
    layer.bitmap.getContext("2d")!.drawImage(generated, 0, 0);
    bumpBitmapVersion(layer.bitmap);
    this.syncLayerSurface(layer);
    this.checkpointLayerSurface(layer);
    this.commit({ label, before, after: [snapshotLayer(layer)] });
    this.requestRender();
    return true;
  }

  gradientFill(
    layerId: string,
    start: Point,
    end: Point,
    from: string,
    to: string,
    type: "linear" | "radial" = "linear",
  ) {
    return this.applyGeneratedFill(
      layerId,
      createGradientPixels(this.doc.width, this.doc.height, start, end, from, to, type),
      `${type === "radial" ? "Radial" : "Linear"} gradient`,
    );
  }

  patternFill(layerId: string, kind: PatternKind, foreground: string, background: string, scale = 16) {
    return this.applyGeneratedFill(
      layerId,
      createPatternPixels(this.doc.width, this.doc.height, kind, foreground, background, scale),
      `${kind} pattern`,
    );
  }

  perspectiveWarpLayer(layerId: string, quad: Quad) {
    const layer = this.findLayer(layerId);
    if (!layer?.bitmap || layer.locked) return false;
    const before = [snapshotLayer(layer)];
    const source = layer.bitmap.getContext("2d")!.getImageData(0, 0, layer.bitmap.width, layer.bitmap.height);
    const warped = warpToQuadrilateral(
      { width: source.width, height: source.height, data: source.data },
      this.doc.width,
      this.doc.height,
      quad,
    );
    const bitmap = newCanvas(warped.width, warped.height);
    bitmap.getContext("2d")!.putImageData(new ImageData(Uint8ClampedArray.from(warped.data), warped.width, warped.height), 0, 0);
    layer.bitmap = bitmap;
    layer.transform = { ...IDENTITY_TRANSFORM };
    layer.surface = this.surfaceFromCanvas(bitmap);
    this.checkpointLayerSurface(layer);
    this.commit({ label: "Perspective warp", before, after: [snapshotLayer(layer)] });
    this.requestRender();
    return true;
  }

  radialWarpLayer(layerId: string, from: Point, to: Point, radius: number, label = "Puppet warp") {
    const layer = this.findLayer(layerId);
    if (!layer?.bitmap || layer.locked) return false;
    const before = [snapshotLayer(layer)];
    const source = layer.bitmap.getContext("2d")!.getImageData(0, 0, layer.bitmap.width, layer.bitmap.height);
    const warped = radialWarp({ width: source.width, height: source.height, data: source.data }, from, to, radius);
    layer.bitmap.getContext("2d")!.putImageData(new ImageData(Uint8ClampedArray.from(warped.data), warped.width, warped.height), 0, 0);
    bumpBitmapVersion(layer.bitmap);
    this.syncLayerSurface(layer);
    this.checkpointLayerSurface(layer);
    this.commit({ label, before, after: [snapshotLayer(layer)] });
    this.requestRender();
    return true;
  }

  moveSelectionContent(layerId: string, deltaX: number, deltaY: number, healSource = true) {
    const layer = this.findLayer(layerId);
    const selection = this.doc.selection;
    if (!layer?.bitmap || !selection || layer.locked) return false;
    const before = [snapshotLayer(layer)];
    const selectionBefore = cloneSelection(selection);
    const content = newCanvas(this.doc.width, this.doc.height);
    const contentContext = content.getContext("2d")!;
    contentContext.drawImage(layer.bitmap, 0, 0);
    contentContext.globalCompositeOperation = "destination-in";
    contentContext.drawImage(selection.mask, 0, 0);

    const context = layer.bitmap.getContext("2d")!;
    context.save();
    context.globalCompositeOperation = "destination-out";
    context.drawImage(selection.mask, 0, 0);
    context.restore();
    if (healSource) {
      const fill = newCanvas(this.doc.width, this.doc.height);
      const fillContext = fill.getContext("2d")!;
      fillContext.filter = "blur(14px)";
      fillContext.drawImage(layer.bitmap, 0, 0);
      fillContext.filter = "none";
      fillContext.globalCompositeOperation = "destination-in";
      fillContext.drawImage(selection.mask, 0, 0);
      context.drawImage(fill, 0, 0);
    }
    context.drawImage(content, deltaX, deltaY);
    const movedMask = newCanvas(this.doc.width, this.doc.height);
    movedMask.getContext("2d")!.drawImage(selection.mask, deltaX, deltaY);
    this.doc.selection = {
      mask: movedMask,
      bounds: {
        x: selection.bounds.x + deltaX,
        y: selection.bounds.y + deltaY,
        w: selection.bounds.w,
        h: selection.bounds.h,
      },
    };
    bumpBitmapVersion(layer.bitmap);
    this.syncLayerSurface(layer);
    this.checkpointLayerSurface(layer);
    this.commit({
      label: "Content-aware move",
      before,
      after: [snapshotLayer(layer)],
      selectionBefore,
      selectionAfter: cloneSelection(this.doc.selection),
    });
    this.requestRender();
    return true;
  }

  selectTextMask(text: string, x: number, y: number, font: string, vertical = false) {
    const before = cloneSelection(this.doc.selection);
    selectText(this.doc, text, x, y, font, "replace", vertical);
    const after = cloneSelection(this.doc.selection);
    this.commit({ label: "Type mask selection", before: [], after: [], selectionBefore: before, selectionAfter: after });
    this.requestRender();
    return !!this.doc.selection;
  }

  resizeDocument(width: number, height: number) {
    width = Math.max(1, Math.min(32768, Math.round(width)));
    height = Math.max(1, Math.min(32768, Math.round(height)));
    if (width === this.doc.width && height === this.doc.height) return false;
    const before = cloneDocument(this.doc);
    const sx = width / this.doc.width;
    const sy = height / this.doc.height;
    for (const layer of this.doc.layers) {
      if (layer.bitmap) {
        const bitmap = newCanvas(width, height);
        bitmap.getContext("2d")!.drawImage(layer.bitmap, 0, 0, width, height);
        layer.bitmap = bitmap;
        layer.surface = this.surfaceFromCanvas(bitmap);
        this.checkpointLayerSurface(layer);
      } else {
        layer.transform = {
          ...layer.transform,
          tx: layer.transform.tx * sx,
          ty: layer.transform.ty * sy,
          sx: layer.transform.sx * sx,
          sy: layer.transform.sy * sy,
        };
      }
      if (layer.bitmap) {
        layer.transform = { ...layer.transform, tx: layer.transform.tx * sx, ty: layer.transform.ty * sy };
      }
      if (layer.mask) {
        const mask = newCanvas(width, height);
        mask.getContext("2d")!.drawImage(layer.mask, 0, 0, width, height);
        layer.mask = mask;
      }
      if (layer.effects) {
        const scale = (sx + sy) / 2;
        layer.effects = layer.effects.map((effect) => ({
          ...effect,
          blur: effect.blur * scale,
          offsetX: effect.offsetX * sx,
          offsetY: effect.offsetY * sy,
        }));
      }
    }
    if (this.doc.selection) {
      const mask = newCanvas(width, height);
      mask.getContext("2d")!.drawImage(this.doc.selection.mask, 0, 0, width, height);
      const b = this.doc.selection.bounds;
      this.doc.selection = { mask, bounds: { x: b.x * sx, y: b.y * sy, w: b.w * sx, h: b.h * sy } };
    }
    this.doc.guides = this.doc.guides.map((guide) => ({ ...guide, position: guide.position * (guide.orientation === "vertical" ? sx : sy) }));
    this.doc.width = width;
    this.doc.height = height;
    this.resetVirtualGeometry(width, height);
    const after = cloneDocument(this.doc);
    this.commit({ label: "Image resized", before: [], after: [], documentBefore: before, documentAfter: after });
    this.requestRender();
    return true;
  }

  setDocumentPrecision(
    bitDepth: Document["bitDepth"],
    colorSpace: Document["colorSpace"],
  ) {
    if (![8, 16, 32].includes(bitDepth) || !["srgb", "display-p3", "linear-srgb"].includes(colorSpace)) {
      return false;
    }
    if (bitDepth === this.doc.bitDepth && colorSpace === this.doc.colorSpace) return false;
    const before = cloneDocument(this.doc);
    const format = pixelFormatForDepth(bitDepth);
    for (const layer of this.doc.layers) {
      if (!layer.bitmap) continue;
      layer.surface = layer.surface
        ? layer.surface.convert(format, colorSpace)
        : this.surfaceFromCanvas(layer.bitmap, format, colorSpace);
      this.checkpointLayerSurface(layer);
    }
    this.doc.bitDepth = bitDepth;
    this.doc.colorSpace = colorSpace;
    const after = cloneDocument(this.doc);
    this.commit({
      label: `${bitDepth}-bit ${colorSpace.toUpperCase()} conversion`,
      before: [],
      after: [],
      documentBefore: before,
      documentAfter: after,
    });
    this.requestRender();
    return true;
  }

  setDocumentProofing(patch: Partial<ProofSettings>) {
    const next: ProofSettings = { ...this.doc.proofing, ...patch };
    if (!["none", "srgb", "display-p3", "cmyk-generic"].includes(next.profile) ||
        !["perceptual", "relative-colorimetric", "absolute-colorimetric", "saturation"].includes(next.intent)) return false;
    if (JSON.stringify(next) === JSON.stringify(this.doc.proofing)) return false;
    const before = cloneDocument(this.doc);
    this.doc.proofing = next;
    const after = cloneDocument(this.doc);
    this.commit({
      label: next.profile === "none" ? "Soft proof disabled" : `Soft proof: ${next.profile.toUpperCase()}`,
      before: [],
      after: [],
      documentBefore: before,
      documentAfter: after,
    });
    this.requestRender();
    return true;
  }

  private surfaceFromCanvas(
    canvas: HTMLCanvasElement,
    format = pixelFormatForDepth(this.doc.bitDepth),
    colorSpace = this.doc.colorSpace,
  ) {
    const surface = new PrecisionTileSurface(canvas.width, canvas.height, format, colorSpace);
    const context = canvas.getContext("2d")!;
    for (let row = 0; row < surface.grid.rows; row += 1) {
      for (let column = 0; column < surface.grid.columns; column += 1) {
        const tile = surface.grid.address(column, row);
        surface.updateFromImageData(context.getImageData(tile.x, tile.y, tile.width, tile.height), tile.x, tile.y);
      }
    }
    return surface;
  }

  private syncLayerSurface(layer: Layer, rect?: PixelRect) {
    const canvas = layer.bitmap;
    if (!canvas) return;
    const expectedFormat = pixelFormatForDepth(this.doc.bitDepth);
    if (!layer.surface || layer.surface.grid.width !== canvas.width || layer.surface.grid.height !== canvas.height ||
        layer.surface.format !== expectedFormat || layer.surface.colorSpace !== this.doc.colorSpace) {
      layer.surface = this.surfaceFromCanvas(canvas);
      return;
    }
    if (!rect) {
      const context = canvas.getContext("2d")!;
      for (let row = 0; row < layer.surface.grid.rows; row += 1) {
        for (let column = 0; column < layer.surface.grid.columns; column += 1) {
          const tile = layer.surface.grid.address(column, row);
          layer.surface.updateFromImageData(context.getImageData(tile.x, tile.y, tile.width, tile.height), tile.x, tile.y);
        }
      }
      return;
    }
    const x = Math.max(0, Math.floor(rect.x));
    const y = Math.max(0, Math.floor(rect.y));
    const right = Math.min(canvas.width, Math.ceil(rect.x + rect.width));
    const bottom = Math.min(canvas.height, Math.ceil(rect.y + rect.height));
    if (right <= x || bottom <= y) return;
    const image = canvas.getContext("2d")!.getImageData(x, y, right - x, bottom - y);
    layer.surface.updateFromImageData(image, x, y);
  }

  private ensureDocumentSurfaces(doc: Document) {
    const format = pixelFormatForDepth(doc.bitDepth);
    for (const layer of doc.layers) {
      if (!layer.bitmap) continue;
      if (layer.surface && layer.surface.grid.width === layer.bitmap.width &&
          layer.surface.grid.height === layer.bitmap.height && layer.surface.format === format &&
          layer.surface.colorSpace === doc.colorSpace) continue;
      const surface = new PrecisionTileSurface(layer.bitmap.width, layer.bitmap.height, format, doc.colorSpace);
      const context = layer.bitmap.getContext("2d")!;
      for (let row = 0; row < surface.grid.rows; row += 1) {
        for (let column = 0; column < surface.grid.columns; column += 1) {
          const tile = surface.grid.address(column, row);
          surface.updateFromImageData(context.getImageData(tile.x, tile.y, tile.width, tile.height), tile.x, tile.y);
        }
      }
      layer.surface = surface;
    }
  }

  private surfaceBackingId(layerId: string) {
    return `${this.activeSessionId}:${layerId}`;
  }

  private checkpointLayerSurface(layer: Layer, replace = false) {
    if (!this.tileBacking || !layer.surface) return;
    void this.tileBacking.checkpoint(this.surfaceBackingId(layer.id), layer.surface, replace).catch(() => undefined);
  }

  private checkpointDocumentSurfaces(replace = false) {
    for (const layer of this.doc.layers) this.checkpointLayerSurface(layer, replace);
  }

  registerPlugin(plugin: LumaPlugin) {
    if (!plugin.id || this.plugins.has(plugin.id)) throw new Error(`Plugin already registered: ${plugin.id}`);
    if (plugin.apiVersion && !isCompatibleApiVersion(plugin.apiVersion)) {
      throw new Error(
        `Plugin "${plugin.id}" targets Luma API ${plugin.apiVersion}, but this build is ${LUMA_API_VERSION}`,
      );
    }
    const dispose = plugin.activate(this) || undefined;
    this.plugins.set(plugin.id, { plugin, dispose });
    this.emit();
    return () => this.unregisterPlugin(plugin.id);
  }

  unregisterPlugin(id: string) {
    const entry = this.plugins.get(id);
    if (!entry) return;
    // Remove first: a dispose that throws must not be able to wedge the plugin
    // in the map, where every retry would fail at the same line.
    this.plugins.delete(id);
    runPluginDispose(id, entry.dispose);
    this.emit();
  }

  listPlugins() {
    return [...this.plugins.values()].map(({ plugin }) => ({ id: plugin.id, name: plugin.name, version: plugin.version }));
  }

  addRasterFromImage(name: string, img: HTMLImageElement, source?: SourceProvenance) {
    if (this.doc.width === 0) {
      this.doc.width = img.naturalWidth;
      this.doc.height = img.naturalHeight;
    }
    const bitmap = newCanvas(this.doc.width, this.doc.height);
    bitmap.getContext("2d")!.drawImage(img, 0, 0);
    const layer = createRasterLayer(name, bitmap);
    layer.source = source ? { ...source } : undefined;
    layer.surface = this.surfaceFromCanvas(bitmap);
    this.commitStructural(`${name} imported`, () => this.doc.layers.unshift(layer));
    this.checkpointLayerSurface(layer);
    this.requestRender();
    return layer;
  }

  addAdjustmentLayer(name = "Adjustment", tone: Partial<ToneParams> = {}) {
    const layer = createAdjustmentLayer(name, { ...NEUTRAL_TONE, ...tone });
    this.commitStructural(`${name} added`, () => this.doc.layers.unshift(layer));
    this.actions.push({ op: "addAdjustment", tone: { ...NEUTRAL_TONE, ...tone } });
    this.requestRender();
    return layer;
  }

  addCurvesLayer(name = "Curves") {
    const layer = createCurvesLayer(name, cloneCurves(NEUTRAL_CURVES));
    this.commitStructural(`${name} added`, () => this.doc.layers.unshift(layer));
    this.requestRender();
    return layer;
  }

  addLevelsLayer(name = "Levels") {
    const layer = createLevelsLayer(name, { ...NEUTRAL_LEVELS });
    this.commitStructural(`${name} added`, () => this.doc.layers.unshift(layer));
    this.requestRender();
    return layer;
  }

  addHslLayer(name = "HSL") {
    const layer = createHslLayer(name, { ...NEUTRAL_HSL });
    this.commitStructural(`${name} added`, () => this.doc.layers.unshift(layer));
    this.requestRender();
    return layer;
  }

  liveUpdateLevels(id: string, levels: LevelsParams) { this.liveAdjustment(id, "levels", levels); }
  updateLevels(id: string, levels: LevelsParams) { this.commitAdjustment(id, "levels", levels); }
  liveUpdateHsl(id: string, hsl: HslParams) { this.liveAdjustment(id, "hsl", hsl); }
  updateHsl(id: string, hsl: HslParams) { this.commitAdjustment(id, "hsl", hsl); }
  updateCurves(id: string, curves: Curves) { this.commitAdjustment(id, "curves", curves); }
  liveUpdateCurves(id: string, curves: Curves) { this.liveAdjustment(id, "curves", curves); }

  addPathLayer(path: PathStyle) {
    const layer = createPathLayer("Path", path);
    this.commitStructural("Path added", () => this.doc.layers.unshift(layer));
    this.requestRender();
    return layer;
  }

  updatePath(id: string, path: PathStyle) {
    const layer = this.findLayer(id);
    if (!layer || layer.kind !== "path") return;
    const before: LayerSnapshot = { layerId: id, path: layer.path ? deepClonePath(layer.path) : undefined };
    layer.path = deepClonePath(path);
    const after: LayerSnapshot = { layerId: id, path: deepClonePath(path) };
    this.commit({ label: "Path updated", before: [before], after: [after] });
    this.requestRender();
  }

  liveUpdatePath(id: string, path: PathStyle) {
    const layer = this.findLayer(id);
    if (!layer || layer.kind !== "path") return;
    layer.path = deepClonePath(path);
    this.requestRender();
  }

  addBlankRaster(name = "Layer") {
    const browserCanvasSafe = this.doc.width <= 16384 && this.doc.height <= 16384 &&
      this.doc.width * this.doc.height <= 64_000_000;
    const bitmap = browserCanvasSafe ? newCanvas(this.doc.width, this.doc.height) : undefined;
    const layer = createRasterLayer(name, bitmap);
    layer.surface = bitmap
      ? this.surfaceFromCanvas(bitmap)
      : new PrecisionTileSurface(
        this.doc.width,
        this.doc.height,
        pixelFormatForDepth(this.doc.bitDepth),
        this.doc.colorSpace,
      );
    this.commitStructural(`${name} added`, () => this.doc.layers.unshift(layer));
    this.checkpointLayerSurface(layer);
    this.requestRender();
    return layer;
  }

  groupLayer(id: string) {
    const layer = this.findLayer(id);
    if (!layer || layer.kind === "group") return null;
    const group = createGroupLayer("Group");
    group.parentId = layer.parentId;
    this.commitStructural("Layer grouped", () => {
      const index = this.doc.layers.findIndex((item) => item.id === id);
      layer.parentId = group.id;
      this.doc.layers.splice(index, 0, group);
    });
    this.requestRender();
    return group;
  }

  ungroupLayer(groupId: string) {
    const group = this.findLayer(groupId);
    if (!group || group.kind !== "group") return;
    this.commitStructural("Group removed", () => {
      for (const layer of this.doc.layers) {
        if (layer.parentId === groupId) layer.parentId = group.parentId;
      }
      this.doc.layers = this.doc.layers.filter((layer) => layer.id !== groupId);
    });
    this.requestRender();
  }

  addSmartFilter(
    layerId: string,
    kind: SmartFilter["kind"],
    params: Record<string, number> = {},
  ) {
    const layer = this.findLayer(layerId);
    if (!layer || layer.kind === "group" || layer.locked) return null;
    const before: LayerSnapshot = { layerId, filters: cloneFilters(layer.filters ?? []) };
    const filter: SmartFilter = {
      id: nextId("filter"),
      kind,
      enabled: true,
      opacity: 1,
      params: { ...params },
    };
    layer.filters = [...(layer.filters ?? []), filter];
    const after: LayerSnapshot = { layerId, filters: cloneFilters(layer.filters) };
    this.commit({ label: `Smart filter: ${kind}`, before: [before], after: [after] });
    this.requestRender();
    return filter;
  }

  removeSmartFilter(layerId: string, filterId: string) {
    const layer = this.findLayer(layerId);
    if (!layer?.filters || layer.locked) return;
    const before: LayerSnapshot = { layerId, filters: cloneFilters(layer.filters) };
    layer.filters = layer.filters.filter((filter) => filter.id !== filterId);
    const after: LayerSnapshot = { layerId, filters: cloneFilters(layer.filters) };
    this.commit({ label: "Smart filter removed", before: [before], after: [after] });
    this.requestRender();
  }

  convertToSmartObject(layerId: string) {
    const layer = this.findLayer(layerId);
    if (!layer || layer.kind !== "raster" || !layer.bitmap) return;
    const before = this.doc.layers.map(shallowCloneLayer);
    layer.kind = "smart-object";
    layer.name = `${layer.name} · Smart`;
    const after = this.doc.layers.map(shallowCloneLayer);
    this.commit({ label: "Converted to Smart Object", before: [], after: [], layersBefore: before, layersAfter: after });
    this.requestRender();
  }

  addDropShadow(layerId: string) {
    const layer = this.findLayer(layerId);
    if (!layer || layer.kind === "group" || layer.locked) return;
    const before: LayerSnapshot = { layerId, effects: cloneEffects(layer.effects ?? []) };
    const effect: LayerEffect = {
      id: nextId("effect"),
      kind: "drop-shadow",
      enabled: true,
      opacity: 0.45,
      color: "rgba(0,0,0,0.9)",
      blur: 24,
      offsetX: 12,
      offsetY: 16,
    };
    layer.effects = [...(layer.effects ?? []), effect];
    this.commit({ label: "Drop shadow", before: [before], after: [{ layerId, effects: cloneEffects(layer.effects) }] });
    this.requestRender();
  }

  removeLayerEffect(layerId: string, effectId: string) {
    const layer = this.findLayer(layerId);
    if (!layer?.effects || layer.locked) return;
    const before: LayerSnapshot = { layerId, effects: cloneEffects(layer.effects) };
    layer.effects = layer.effects.filter((effect) => effect.id !== effectId);
    this.commit({ label: "Layer effect removed", before: [before], after: [{ layerId, effects: cloneEffects(layer.effects) }] });
    this.requestRender();
  }

  addTextLayer(text: string, style: Partial<TextStyle> = {}) {
    const s: TextStyle = {
      text,
      font: "700 96px 'Inter', system-ui, sans-serif",
      color: "#ffffff",
      align: "left",
      lineHeight: 1.1,
      x: this.doc.width * 0.08,
      y: this.doc.height * 0.55,
      ...style,
    };
    const layer = createTextLayer(text.split("\n")[0] || "Text", s);
    this.commitStructural(`Text added`, () => this.doc.layers.unshift(layer));
    this.requestRender();
    return layer;
  }

  addShapeLayer(style: Partial<ShapeStyle> = {}) {
    const s: ShapeStyle = {
      kind: "rect",
      x: this.doc.width * 0.25,
      y: this.doc.height * 0.25,
      w: this.doc.width * 0.5,
      h: this.doc.height * 0.5,
      fill: "#ffffff",
      stroke: "#000000",
      strokeWidth: 0,
      radius: 0,
      ...style,
    };
    const layer = createShapeLayer(s.kind === "rect" ? "Rectangle" : "Ellipse", s);
    this.commitStructural(`Shape added`, () => this.doc.layers.unshift(layer));
    this.requestRender();
    return layer;
  }

  addFrame(x: number, y: number, width: number, height: number, ellipse = false) {
    const group = createGroupLayer(ellipse ? "Ellipse frame" : "Rectangle frame");
    const mask = newCanvas(this.doc.width, this.doc.height);
    const maskContext = mask.getContext("2d")!;
    maskContext.fillStyle = "white";
    if (ellipse) {
      maskContext.beginPath();
      maskContext.ellipse(x + width / 2, y + height / 2, Math.abs(width) / 2, Math.abs(height) / 2, 0, 0, Math.PI * 2);
      maskContext.fill();
    } else {
      maskContext.fillRect(x, y, width, height);
    }
    group.mask = mask;
    const placeholderCanvas = newCanvas(this.doc.width, this.doc.height);
    const placeholderContext = placeholderCanvas.getContext("2d")!;
    const gradient = placeholderContext.createLinearGradient(x, y, x + width, y + height);
    gradient.addColorStop(0, "#262b36");
    gradient.addColorStop(1, "#5a6170");
    placeholderContext.fillStyle = gradient;
    placeholderContext.fillRect(x, y, width, height);
    const placeholder = createRasterLayer("Frame content", placeholderCanvas);
    placeholder.parentId = group.id;
    this.commitStructural("Frame added", () => this.doc.layers.unshift(group, placeholder));
    this.ensureDocumentSurfaces(this.doc);
    this.requestRender();
    return group;
  }

  removeLayer(id: string) {
    if (this.findLayer(id)?.locked) return;
    this.commitStructural("Layer deleted", () => {
      this.doc.layers = this.doc.layers.filter((l) => l.id !== id);
    });
    if (this.tileBacking) void this.tileBacking.deleteSurface(this.surfaceBackingId(id)).catch(() => undefined);
    this.requestRender();
  }

  reorderLayer(id: string, delta: number) {
    const idx = this.doc.layers.findIndex((l) => l.id === id);
    if (idx < 0) return;
    const next = Math.max(0, Math.min(this.doc.layers.length - 1, idx + delta));
    if (next === idx) return;
    this.commitStructural("Layer reordered", () => {
      const [l] = this.doc.layers.splice(idx, 1);
      this.doc.layers.splice(next, 0, l);
    });
    this.requestRender();
  }

  private commitStructural(label: string, mutate: () => void) {
    const before = this.doc.layers.map(shallowCloneLayer);
    mutate();
    const after = this.doc.layers.map(shallowCloneLayer);
    this.commit({ label, before: [], after: [], layersBefore: before, layersAfter: after });
  }

  setLayerProp<K extends keyof Layer>(id: string, key: K, value: Layer[K], label?: string) {
    const layer = this.findLayer(id);
    if (!layer) return;
    const before: LayerSnapshot = { layerId: id };
    const after: LayerSnapshot = { layerId: id };
    if (key === "opacity" || key === "fillOpacity" || key === "blend" || key === "visible" || key === "name" || key === "locked" || key === "clipping") {
      (before as Record<string, unknown>)[key as string] = layer[key];
      (after as Record<string, unknown>)[key as string] = value;
    }
    if (key === "fillOpacity") {
      before.fillOpacity = layer.fillOpacity ?? null;
      after.fillOpacity = value as number;
    }
    if (key === "blend") {
      before.blendStack = layer.blendStack ? cloneBlendStack(layer.blendStack) : null;
      const passes = resolvedBlendPasses(layer);
      passes[0] = { ...passes[0], mode: value as BlendMode };
      layer.blendStack = cloneBlendStack(passes);
      after.blendStack = cloneBlendStack(passes);
    }
    layer[key] = value;
    this.commit({ label: label || `${String(key)} changed`, before: [before], after: [after] });
    this.requestRender();
  }

  setBlendStack(id: string, passes: ReadonlyArray<BlendPass>, label = "Blend stack changed") {
    const layer = this.findLayer(id);
    if (!layer || layer.kind === "group") return false;
    const ids = new Set<string>();
    const next = passes.slice(0, MAX_LAYER_BLEND_PASSES).map((pass) => {
      let passId = pass.id || nextId("blend");
      while (ids.has(passId)) passId = nextId("blend");
      ids.add(passId);
      return {
        id: passId,
        mode: pass.mode,
        opacity: Math.max(0, Math.min(1, Number.isFinite(pass.opacity) ? pass.opacity : 1)),
        enabled: pass.enabled !== false,
      };
    });
    if (!next.length) return false;
    const before: LayerSnapshot = {
      layerId: id,
      blend: layer.blend,
      blendStack: layer.blendStack ? cloneBlendStack(layer.blendStack) : null,
    };
    layer.blendStack = cloneBlendStack(next);
    layer.blend = next[0].mode;
    const after: LayerSnapshot = {
      layerId: id,
      blend: layer.blend,
      blendStack: cloneBlendStack(next),
    };
    this.commit({ label, before: [before], after: [after] });
    this.requestRender();
    return true;
  }

  addBlendPass(id: string, mode: BlendMode = "source-over") {
    const layer = this.findLayer(id);
    if (!layer) return false;
    const passes = resolvedBlendPasses(layer);
    if (passes.length >= MAX_LAYER_BLEND_PASSES) return false;
    passes.push({ id: nextId("blend"), mode, opacity: 1, enabled: true });
    return this.setBlendStack(id, passes, "Blend pass added");
  }

  updateBlendPass(id: string, passId: string, patch: Partial<Omit<BlendPass, "id">>) {
    const layer = this.findLayer(id);
    if (!layer) return false;
    const passes = resolvedBlendPasses(layer);
    const index = passes.findIndex((pass) => pass.id === passId);
    if (index < 0) return false;
    passes[index] = { ...passes[index], ...patch };
    return this.setBlendStack(id, passes, patch.mode ? "Blend mode changed" : patch.opacity !== undefined ? "Blend pass opacity" : "Blend pass toggled");
  }

  removeBlendPass(id: string, passId: string) {
    const layer = this.findLayer(id);
    if (!layer) return false;
    const passes = resolvedBlendPasses(layer);
    if (passes.length <= 1) return false;
    return this.setBlendStack(id, passes.filter((pass) => pass.id !== passId), "Blend pass removed");
  }

  moveBlendPass(id: string, passId: string, delta: number) {
    const layer = this.findLayer(id);
    if (!layer) return false;
    const passes = resolvedBlendPasses(layer);
    const index = passes.findIndex((pass) => pass.id === passId);
    const nextIndex = Math.max(0, Math.min(passes.length - 1, index + delta));
    if (index < 0 || index === nextIndex) return false;
    const [pass] = passes.splice(index, 1);
    passes.splice(nextIndex, 0, pass);
    return this.setBlendStack(id, passes, "Blend passes reordered");
  }

  setLayerFillOpacity(id: string, opacity: number) {
    return this.setLayerProp(id, "fillOpacity", Math.max(0, Math.min(1, opacity)), "Fill opacity");
  }

  setLayerBlendIf(id: string, settings: BlendIf) {
    const layer = this.findLayer(id);
    if (!layer || layer.kind === "group") return false;
    const before: LayerSnapshot = {
      layerId: id,
      blendIf: layer.blendIf ? cloneBlendIf(layer.blendIf) : null,
    };
    const normalized = resolvedBlendIf({ blendIf: settings });
    layer.blendIf = cloneBlendIf(normalized);
    const after: LayerSnapshot = { layerId: id, blendIf: cloneBlendIf(normalized) };
    this.commit({ label: "Blend If", before: [before], after: [after] });
    this.requestRender();
    return true;
  }

  resetLayerBlendIf(id: string) {
    const layer = this.findLayer(id);
    if (!layer?.blendIf) return false;
    const before: LayerSnapshot = { layerId: id, blendIf: cloneBlendIf(layer.blendIf) };
    layer.blendIf = undefined;
    this.commit({ label: "Blend If reset", before: [before], after: [{ layerId: id, blendIf: null }] });
    this.requestRender();
    return true;
  }

  updateTransform(id: string, patch: Partial<Transform>) {
    const layer = this.findLayer(id);
    if (!layer || layer.locked) return;
    const key = `transform:${id}`;
    const before: LayerSnapshot = this.liveSnapshots.get(key) ?? { layerId: id, transform: { ...layer.transform } };
    this.liveSnapshots.delete(key);
    layer.transform = { ...layer.transform, ...patch };
    const after: LayerSnapshot = { layerId: id, transform: { ...layer.transform } };
    this.commit({ label: "Transform", before: [before], after: [after] });
    this.requestRender();
  }

  liveUpdateTransform(id: string, patch: Partial<Transform>) {
    const layer = this.findLayer(id);
    if (!layer || layer.locked) return;
    const key = `transform:${id}`;
    if (!this.liveSnapshots.has(key)) this.liveSnapshots.set(key, { layerId: id, transform: { ...layer.transform } });
    layer.transform = { ...layer.transform, ...patch };
    this.requestRender();
  }

  resetTransform(id: string) {
    this.updateTransform(id, IDENTITY_TRANSFORM);
  }

  updateText(id: string, patch: Partial<TextStyle>) {
    const layer = this.findLayer(id);
    if (!layer || !layer.text || layer.locked) return;
    const before: LayerSnapshot = { layerId: id, text: { ...layer.text } };
    layer.text = { ...layer.text, ...patch };
    const after: LayerSnapshot = { layerId: id, text: { ...layer.text } };
    this.commit({ label: "Text updated", before: [before], after: [after] });
    this.requestRender();
  }

  updateShape(id: string, patch: Partial<ShapeStyle>) {
    const layer = this.findLayer(id);
    if (!layer || !layer.shape || layer.locked) return;
    const before: LayerSnapshot = { layerId: id, shape: { ...layer.shape } };
    layer.shape = { ...layer.shape, ...patch };
    const after: LayerSnapshot = { layerId: id, shape: { ...layer.shape } };
    this.commit({ label: "Shape updated", before: [before], after: [after] });
    this.requestRender();
  }

  updateTone(id: string, tone: ToneParams) { this.commitAdjustment(id, "tone", tone); }
  liveUpdateTone(id: string, tone: ToneParams) { this.liveAdjustment(id, "tone", tone); }

  /** Live tick during a slider drag — stores an initial snapshot the first
   *  time so the committing call can undo cleanly. */
  private liveAdjustment<K extends AdjustmentKind>(id: string, kind: K, params: AdjustmentParams[K]) {
    const layer = this.findLayer(id);
    if (!isAdjustmentLayer(layer, kind)) return;
    const key = `${kind}:${id}`;
    if (!this.liveSnapshots.has(key)) {
      this.liveSnapshots.set(key, snapshotForAdjustment(layer, kind));
    }
    applyAdjustment(layer, kind, params);
    this.requestRender();
  }

  /** Slider release — consumes the live snapshot (if any) as the "before"
   *  side of the commit, ensuring a single history entry per drag. */
  private commitAdjustment<K extends AdjustmentKind>(id: string, kind: K, params: AdjustmentParams[K]) {
    const layer = this.findLayer(id);
    if (!isAdjustmentLayer(layer, kind)) return;
    const key = `${kind}:${id}`;
    const before = this.liveSnapshots.get(key) ?? snapshotForAdjustment(layer, kind);
    this.liveSnapshots.delete(key);
    applyAdjustment(layer, kind, params);
    const after = snapshotForAdjustment(layer, kind);
    this.commit({ label: adjustmentLabel(kind), before: [before], after: [after] });
    this.requestRender();
  }

  // --- painting ---
  beginStroke(layerId: string, params: BrushParams, point: BrushPoint) {
    const layer = this.findLayer(layerId);
    if (!layer || layer.locked) return;
    const precisionPaint = (params.mode === "paint" || params.mode === "erase") && !!layer.surface;
    if (!precisionPaint && !paintTarget(layer, params, this.doc.width, this.doc.height)) return;
    this.strokeTiles = new Map();
    this.precisionStroke = precisionPaint ? {
      layerId,
      params: { ...params },
      points: [],
      before: new Map(),
    } : null;
    this.lastPoint = point;
    this.paintSegmentState = null;
    this.paintTo(layerId, params, point);
    this.paintSegmentState = createPaintSegmentState(params);
    this.paintSegmentState.planner.start(point, false);
    this.paintSegmentState.started = true;
  }

  paintTo(layerId: string, params: BrushParams, point: BrushPoint) {
    const layer = this.findLayer(layerId);
    if (!layer) return;
    const precisionPaint = (params.mode === "paint" || params.mode === "erase") && !!layer.surface;
    const target = precisionPaint ? null : paintTarget(layer, params, this.doc.width, this.doc.height);
    if (!precisionPaint && !target) return;
    const prev = this.lastPoint ?? point;
    const stabilization = Math.max(0, Math.min(0.95, params.smoothing ?? 0));
    const response = 1 - stabilization * 0.9;
    const next = stabilization > 0 ? {
      x: prev.x + (point.x - prev.x) * response,
      y: prev.y + (point.y - prev.y) * response,
      p: prev.p + (point.p - prev.p) * response,
      tiltX: (prev.tiltX ?? 0) + ((point.tiltX ?? 0) - (prev.tiltX ?? 0)) * response,
      tiltY: (prev.tiltY ?? 0) + ((point.tiltY ?? 0) - (prev.tiltY ?? 0)) * response,
      azimuth: point.azimuth,
    } : point;
    if (precisionPaint) {
      this.paintPrecisionStroke(layer, params, next);
      this.lastPoint = next;
      this.requestRender();
      return;
    }
    const ctx = target!.getContext("2d")!;
    this.captureStrokeTiles(layer, target!, params, prev, next);

    // If selection exists and we're painting into a raster layer, constrain
    // strokes by drawing through a clipped scratch, then re-composite.
    if (this.doc.selection && (params.mode === "paint" || params.mode === "erase")) {
      const radius = params.size * 0.55 + 2;
      const x = Math.max(0, Math.floor(Math.min(prev.x, next.x) - radius));
      const y = Math.max(0, Math.floor(Math.min(prev.y, next.y) - radius));
      const right = Math.min(this.doc.width, Math.ceil(Math.max(prev.x, next.x) + radius));
      const bottom = Math.min(this.doc.height, Math.ceil(Math.max(prev.y, next.y) + radius));
      const scratch = newCanvas(Math.max(1, right - x), Math.max(1, bottom - y));
      const sctx = scratch.getContext("2d")!;
      sctx.translate(-x, -y);
      paintSegment(
        sctx,
        prev,
        next,
        { ...params, mode: params.mode === "erase" ? "paint" : params.mode },
        this.paintSegmentState ?? undefined,
      );
      // Mask scratch by selection
      sctx.setTransform(1, 0, 0, 1, 0, 0);
      sctx.globalCompositeOperation = "destination-in";
      sctx.drawImage(this.doc.selection.mask, x, y, scratch.width, scratch.height, 0, 0, scratch.width, scratch.height);
      sctx.globalCompositeOperation = "source-over";
      // Composite scratch into layer (erase uses destination-out)
      ctx.globalCompositeOperation = params.mode === "erase" ? "destination-out" : "source-over";
      ctx.drawImage(scratch, x, y);
      ctx.globalCompositeOperation = "source-over";
    } else {
      paintSegment(ctx, prev, next, params, this.paintSegmentState ?? undefined);
    }
    if (params.mode === "mask-add" || params.mode === "mask-remove") {
      if (layer.mask) bumpBitmapVersion(layer.mask);
    } else if (layer.bitmap) {
      bumpBitmapVersion(layer.bitmap);
    }
    this.lastPoint = next;
    this.requestRender();
  }

  endStroke(layerId: string, params: BrushParams) {
    if (!this.strokeTiles) return;
    const layer = this.findLayer(layerId);
    if (!layer) return;
    const label =
      params.mode === "erase" ? "Erase stroke" :
      params.mode === "mask-add" ? "Mask paint (add)" :
      params.mode === "mask-remove" ? "Mask paint (remove)" :
      "Brush stroke";
    if (this.precisionStroke && layer.surface) {
      const surfacePatches: SurfaceTilePatch[] = [...this.precisionStroke.before].map(([key, before]) => ({
        layerId,
        key,
        before,
        after: layer.surface!.store.read(key),
      }));
      this.commit({ label, before: [], after: [], surfacePatches });
      this.checkpointLayerSurface(layer);
      this.strokeTiles = null;
      this.precisionStroke = null;
      this.lastPoint = null;
      this.paintSegmentState = null;
      return;
    }
    const patches: PixelPatch[] = [];
    for (const tile of this.strokeTiles.values()) {
      const canvas = tile.target === "bitmap" ? layer.bitmap : layer.mask;
      if (!canvas) continue;
      const after = canvas.getContext("2d")!.getImageData(tile.x, tile.y, tile.before.width, tile.before.height);
      patches.push({
        ...tile,
        after,
      });
      if (tile.target === "bitmap") this.syncLayerSurface(layer, {
        x: tile.x,
        y: tile.y,
        width: after.width,
        height: after.height,
      });
    }
    this.commit({ label, before: [], after: [], pixelPatches: patches });
    this.checkpointLayerSurface(layer);
    this.strokeTiles = null;
    this.precisionStroke = null;
    this.lastPoint = null;
    this.paintSegmentState = null;
  }

  private paintPrecisionStroke(layer: Layer, params: BrushParams, point: BrushPoint) {
    const state = this.precisionStroke;
    const surface = layer.surface;
    if (!state || !surface || state.layerId !== layer.id) return;
    state.points.push({ ...point });
    const dabs = planStroke(state.points, params);
    if (!dabs.length) return;
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    for (const dab of dabs) {
      const radius = dab.size / 2 + 2;
      left = Math.min(left, dab.x - radius);
      top = Math.min(top, dab.y - radius);
      right = Math.max(right, dab.x + radius);
      bottom = Math.max(bottom, dab.y + radius);
    }
    const tiles = surface.grid.tilesIntersecting({ x: left, y: top, width: right - left, height: bottom - top });
    const parsed = parseBrushColor(params.color);
    const workingColor = displaySrgbToWorking(
      [parsed[0] / 255, parsed[1] / 255, parsed[2] / 255],
      surface.colorSpace,
    );
    for (const tile of tiles) {
      if (!state.before.has(tile.key)) state.before.set(tile.key, surface.store.read(tile.key));
      const original = state.before.get(tile.key);
      if (original) surface.store.write(tile.key, original);
      else surface.store.delete(tile.key);
      const values = surface.tileToWorkingFloat32(tile.key);
      const beforeValues = this.doc.selection ? values.slice() : null;
      replayStrokeFloat({
        width: tile.width,
        height: tile.height,
        data: values,
        originX: tile.x,
        originY: tile.y,
      }, { layerId: layer.id, params, points: state.points }, workingColor);
      if (this.doc.selection && beforeValues) {
        const selection = this.doc.selection.mask.getContext("2d")!
          .getImageData(tile.x, tile.y, tile.width, tile.height).data;
        for (let pixel = 0; pixel < tile.width * tile.height; pixel += 1) {
          const alpha = selection[pixel * 4 + 3] / 255;
          for (let channel = 0; channel < 4; channel += 1) {
            const offset = pixel * 4 + channel;
            values[offset] = beforeValues[offset] * (1 - alpha) + values[offset] * alpha;
          }
        }
      }
      surface.writeWorkingFloat32Tile(tile.key, values);
      this.updateLayerBitmapTile(layer, tile.key);
      this.virtualDirty.invalidate(tile, params.size + 2);
    }
  }

  private updateLayerBitmapTile(layer: Layer, key: string) {
    if (!layer.surface || !layer.bitmap) return;
    const tile = layer.surface.grid.parseKey(key);
    const preview = layer.surface.tileToRgba8(key);
    const context = layer.bitmap.getContext("2d")!;
    context.clearRect(tile.x, tile.y, tile.width, tile.height);
    const image = context.createImageData(preview.width, preview.height);
    image.data.set(preview.data);
    context.putImageData(image, tile.x, tile.y);
    bumpBitmapVersion(layer.bitmap);
  }

  beginRetouchStroke(
    layerId: string,
    mode: RetouchMode,
    sourcePoint: { x: number; y: number } | null,
    destination: BrushPoint,
    params: BrushParams,
  ) {
    const layer = this.findLayer(layerId);
    if (!layer?.surface || layer.locked) return false;
    if ((mode === "clone" || mode === "heal" || mode === "patch") && !sourcePoint) return false;
    this.retouchStroke = {
      layerId,
      mode,
      params: { ...params, mode: "paint" },
      points: [],
      before: new Map(),
      source: layer.surface.clone(),
      sourceOffsetX: (sourcePoint?.x ?? destination.x) - destination.x,
      sourceOffsetY: (sourcePoint?.y ?? destination.y) - destination.y,
    };
    this.retouchTo(layerId, destination);
    return true;
  }

  retouchTo(layerId: string, point: BrushPoint) {
    const state = this.retouchStroke;
    const layer = this.findLayer(layerId);
    const surface = layer?.surface;
    if (!state || !layer || !surface || state.layerId !== layerId) return;
    const previous = state.points.at(-1);
    if (previous && (state.mode === "smudge" || state.mode === "liquify")) {
      state.sourceOffsetX = previous.x - point.x;
      state.sourceOffsetY = previous.y - point.y;
    }
    state.points.push({ ...point });
    const dabs = planStroke(state.points, state.params);
    if (!dabs.length) return;
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    for (const dab of dabs) {
      const radius = dab.size / 2 + 2;
      left = Math.min(left, dab.x - radius);
      top = Math.min(top, dab.y - radius);
      right = Math.max(right, dab.x + radius);
      bottom = Math.max(bottom, dab.y + radius);
    }
    const tiles = surface.grid.tilesIntersecting({ x: left, y: top, width: right - left, height: bottom - top });
    for (const tile of tiles) {
      if (!state.before.has(tile.key)) state.before.set(tile.key, surface.store.read(tile.key));
      const original = state.before.get(tile.key);
      if (original) surface.store.write(tile.key, original);
      else surface.store.delete(tile.key);
      const values = surface.tileToWorkingFloat32(tile.key);
      const beforeValues = this.doc.selection ? values.slice() : null;
      replayRetouch({
        width: tile.width,
        height: tile.height,
        data: values,
        originX: tile.x,
        originY: tile.y,
      }, {
        mode: state.mode,
        dabs,
        params: state.params,
        sourceOffsetX: state.sourceOffsetX,
        sourceOffsetY: state.sourceOffsetY,
        sample: (x, y) => state.source.sampleBilinearWorking(x, y),
      });
      if (this.doc.selection && beforeValues) {
        const selection = this.doc.selection.mask.getContext("2d")!
          .getImageData(tile.x, tile.y, tile.width, tile.height).data;
        for (let pixel = 0; pixel < tile.width * tile.height; pixel += 1) {
          const alpha = selection[pixel * 4 + 3] / 255;
          for (let channel = 0; channel < 4; channel += 1) {
            const offset = pixel * 4 + channel;
            values[offset] = beforeValues[offset] * (1 - alpha) + values[offset] * alpha;
          }
        }
      }
      surface.writeWorkingFloat32Tile(tile.key, values);
      this.updateLayerBitmapTile(layer, tile.key);
      this.virtualDirty.invalidate(tile, state.params.size + 2);
    }
    this.requestRender();
  }

  endRetouchStroke() {
    const state = this.retouchStroke;
    const layer = state ? this.findLayer(state.layerId) : null;
    if (!state || !layer?.surface) return;
    const surfacePatches: SurfaceTilePatch[] = [...state.before].map(([key, before]) => ({
      layerId: layer.id,
      key,
      before,
      after: layer.surface!.store.read(key),
    }));
    const labels: Record<RetouchMode, string> = {
      clone: "Clone stamp",
      heal: "Healing brush",
      "spot-heal": "Spot healing",
      patch: "Patch healing",
      remove: "Remove stroke",
      dodge: "Dodge stroke",
      burn: "Burn stroke",
      blur: "Blur stroke",
      sharpen: "Sharpen stroke",
      smudge: "Smudge stroke",
      sponge: "Sponge stroke",
      mixer: "Mixer brush",
      liquify: "Liquify stroke",
    };
    const label = labels[state.mode];
    this.commit({ label, before: [], after: [], surfacePatches });
    this.checkpointLayerSurface(layer);
    this.retouchStroke = null;
  }

  private captureStrokeTiles(
    layer: Layer,
    canvas: HTMLCanvasElement,
    params: BrushParams,
    from: { x: number; y: number },
    to: { x: number; y: number },
  ) {
    if (!this.strokeTiles) return;
    const radius = params.size * (0.55 + Math.max(0, params.scatter ?? 0)) + 2;
    const target: PixelPatch["target"] = params.mode === "mask-add" || params.mode === "mask-remove" ? "mask" : "bitmap";
    const ctx = canvas.getContext("2d")!;
    const grid = new TileGrid(canvas.width, canvas.height, DEFAULT_TILE_SIZE);
    const tiles = grid.tilesIntersecting({
      x: Math.min(from.x, to.x) - radius,
      y: Math.min(from.y, to.y) - radius,
      width: Math.abs(to.x - from.x) + radius * 2,
      height: Math.abs(to.y - from.y) + radius * 2,
    });
    for (const tile of tiles) {
      const key = `${target}:${tile.key}`;
      if (this.strokeTiles.has(key)) continue;
      this.strokeTiles.set(key, {
        layerId: layer.id,
        target,
        x: tile.x,
        y: tile.y,
        before: ctx.getImageData(tile.x, tile.y, tile.width, tile.height),
      });
    }
  }

  fillLayer(layerId: string, color: string) {
    const layer = this.findLayer(layerId);
    if (!layer || layer.kind !== "raster" || !layer.bitmap || layer.locked) return;
    const before = [snapshotLayer(layer)];
    const ctx = layer.bitmap.getContext("2d")!;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (this.doc.selection) {
      const scratch = newCanvas(this.doc.width, this.doc.height);
      const sctx = scratch.getContext("2d")!;
      sctx.fillStyle = color;
      sctx.fillRect(0, 0, this.doc.width, this.doc.height);
      sctx.globalCompositeOperation = "destination-in";
      sctx.drawImage(this.doc.selection.mask, 0, 0);
      ctx.drawImage(scratch, 0, 0);
    } else {
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, this.doc.width, this.doc.height);
    }
    ctx.restore();
    bumpBitmapVersion(layer.bitmap);
    this.syncLayerSurface(layer);
    this.checkpointLayerSurface(layer);
    this.commit({ label: `Filled with ${color}`, before, after: [snapshotLayer(layer)] });
    this.actions.push({ op: "fill", color });
    this.requestRender();
  }

  clearPixels(layerId: string) {
    const layer = this.findLayer(layerId);
    if (!layer || layer.kind !== "raster" || !layer.bitmap || layer.locked) return;
    const before = [snapshotLayer(layer)];
    const ctx = layer.bitmap.getContext("2d")!;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (this.doc.selection) {
      ctx.globalCompositeOperation = "destination-out";
      ctx.drawImage(this.doc.selection.mask, 0, 0);
    } else {
      ctx.clearRect(0, 0, this.doc.width, this.doc.height);
    }
    ctx.restore();
    bumpBitmapVersion(layer.bitmap);
    this.syncLayerSurface(layer);
    this.checkpointLayerSurface(layer);
    this.commit({ label: "Pixels cleared", before, after: [snapshotLayer(layer)] });
    this.actions.push({ op: "clear" });
    this.requestRender();
  }

  invertMask(layerId: string) {
    const layer = this.findLayer(layerId);
    if (!layer) return;
    const before = [snapshotLayer(layer)];
    invertMaskInPlace(layer, this.doc.width, this.doc.height);
    this.commit({ label: "Mask inverted", before, after: [snapshotLayer(layer)] });
    this.requestRender();
  }

  clearMask(layerId: string) {
    const layer = this.findLayer(layerId);
    if (!layer || !layer.mask) return;
    const before = [snapshotLayer(layer)];
    clearMaskInPlace(layer, this.doc.width, this.doc.height);
    this.commit({ label: "Mask cleared", before, after: [snapshotLayer(layer)] });
    this.requestRender();
  }

  // Neural subject mask via MODNet. Falls back to the luma threshold if the
  // model fails to load (offline, blocked CDN, etc.).
  async neuralSubject(
    layerId: string,
    onProgress?: (msg: string, pct: number) => void,
  ): Promise<{ used: "neural" | "luma" }> {
    const layer = this.findLayer(layerId);
    if (!layer || layer.kind !== "raster" || !layer.bitmap) {
      throw new Error("Neural subject needs a raster layer");
    }
    try {
      const { neuralMatte } = await import("./neural");
      const matte = await neuralMatte(layer.bitmap, onProgress);
      const before = [snapshotLayer(layer)];
      ensureMask(layer, this.doc.width, this.doc.height);
      const mctx = layer.mask!.getContext("2d")!;
      mctx.save();
      mctx.setTransform(1, 0, 0, 1, 0, 0);
      mctx.globalCompositeOperation = "source-over";
      mctx.clearRect(0, 0, layer.mask!.width, layer.mask!.height);
      mctx.drawImage(matte, 0, 0);
      mctx.restore();
      bumpBitmapVersion(layer.mask!);
      this.commit({
        label: "Neural subject mask",
        before,
        after: [snapshotLayer(layer)],
      });
      this.actions.push({ op: "autoSubject" });
      this.requestRender();
      return { used: "neural" };
    } catch (err) {
      console.warn("Neural subject failed, falling back to luma", err);
      this.autoLumaMask(layerId);
      return { used: "luma" };
    }
  }

  async generativeEditVariations(
    layerId: string,
    prompt: string,
    operation: AiEditOperation = "fill",
    options: {
      controls?: Partial<AiOperationControls>;
      quality?: AiEditQuality;
      size?: "auto" | `${number}x${number}`;
      variations?: number;
      signal?: AbortSignal;
      onVariation?: (completed: number, total: number) => void;
    } = {},
  ) {
    const source = this.findLayer(layerId);
    if (!source || source.kind === "group") throw new Error("Select a content layer");
    const composite = this.flatten();
    const image = await canvasToBlob(composite);
    let maskBlob: Blob | undefined;
    let selectionGuide: AiSelectionGuide = { mode: "none" };
    if (this.doc.selection) {
      const input = this.doc.selection.mask.getContext("2d")!.getImageData(0, 0, this.doc.width, this.doc.height);
      const alpha = new Uint8Array(this.doc.width * this.doc.height);
      for (let pixel = 0; pixel < alpha.length; pixel += 1) alpha[pixel] = input.data[pixel * 4 + 3];
      const editMask = selectionAlphaToEditMask(alpha, this.doc.width, this.doc.height);
      const mask = newCanvas(this.doc.width, this.doc.height);
      const output = mask.getContext("2d")!.createImageData(this.doc.width, this.doc.height);
      output.data.set(editMask.data);
      mask.getContext("2d")!.putImageData(output, 0, 0);
      maskBlob = await canvasToBlob(mask);
      selectionGuide = editMask.guide;
    }
    const [inputSha256, maskSha256] = await Promise.all([
      sha256Blob(image),
      maskBlob ? sha256Blob(maskBlob) : Promise.resolve(undefined),
    ]);
    const total = options.variations ?? 1;
    let completed = 0;
    const results = await runAiEditVariations({
      image,
      mask: maskBlob,
      operation,
      prompt,
      controls: options.controls,
      quality: options.quality,
      size: options.size,
      selection: selectionGuide,
      variations: total,
      signal: options.signal,
      onVariation: () => options.onVariation?.(++completed, total),
    });
    const layers = await Promise.all(results.map(async (result) => {
      const bitmap = await blobToCanvas(result.image, this.doc.width, this.doc.height);
      const layer = createRasterLayer(`AI · ${operation}${total > 1 ? ` · ${result.index + 1}` : ""}`, bitmap);
      layer.surface = this.surfaceFromCanvas(bitmap);
      const config = normalizeAiEditConfig({
        operation,
        prompt,
        controls: options.controls,
        quality: options.quality,
        size: options.size,
        selection: selectionGuide,
        variationIndex: result.index,
        sourceDigest: inputSha256,
        maskDigest: maskSha256,
      });
      layer.ai = {
        id: result.provenanceId ?? nextId("ai"),
        operation,
        provider: "openai",
        model: "gpt-image-2",
        prompt,
        createdAt: new Date().toISOString(),
        sourceLayerIds: [layerId],
        usedSelection: selectionGuide.mode !== "none",
        requestId: result.upstreamRequestId,
        inputSha256,
        maskSha256,
        parameters: {
          quality: config.quality,
          size: config.size,
          variationIndex: config.variationIndex,
          controls: config.controls,
          selection: config.selection,
        },
      };
      return layer;
    }));
    this.commitStructural(`AI ${operation} · ${layers.length} variation${layers.length === 1 ? "" : "s"}`, () => this.doc.layers.unshift(...layers));
    for (const layer of layers) this.checkpointLayerSurface(layer);
    this.requestRender();
    return layers;
  }

  async generativeEdit(
    layerId: string,
    prompt: string,
    operation: AiProvenance["operation"] = "fill",
  ) {
    return (await this.generativeEditVariations(layerId, prompt, operation, { variations: 1 }))[0];
  }

  // Click-point SAM segmentation. The mask returned becomes the document
  // selection so any subsequent op (brush, fill, filter, mask paint) respects
  // it. If SAM can't load, falls back to a magic-wand at the click point.
  async samClickSelect(
    layerId: string,
    x: number,
    y: number,
    mode: "replace" | "add" | "subtract" | "intersect" = "replace",
    onProgress?: (msg: string, pct: number) => void,
  ): Promise<{ used: "sam" | "wand" }> {
    const layer = this.findLayer(layerId);
    if (!layer || layer.kind !== "raster" || !layer.bitmap) {
      throw new Error("SAM needs a raster layer");
    }
    try {
      const { samClickMask } = await import("./neural");
      const mask = await samClickMask(layer.bitmap, x, y, onProgress);
      const before = cloneSelection(this.doc.selection);
      if (mode === "replace" || !this.doc.selection) {
        this.doc.selection = { mask, bounds: { x: 0, y: 0, w: this.doc.width, h: this.doc.height } };
      } else {
        const current = this.doc.selection.mask;
        const cctx = current.getContext("2d")!;
        cctx.globalCompositeOperation = mode === "add" ? "source-over" : mode === "subtract" ? "destination-out" : "destination-in";
        cctx.drawImage(mask, 0, 0);
        cctx.globalCompositeOperation = "source-over";
      }
      const after = cloneSelection(this.doc.selection);
      this.commit({ label: "SAM click select", before: [], after: [], selectionBefore: before, selectionAfter: after });
      this.requestRender();
      return { used: "sam" };
    } catch (err) {
      console.warn("SAM failed, falling back to magic wand", err);
      this.selectByColor(layerId, x, y, 24, mode);
      return { used: "wand" };
    }
  }

  autoLumaMask(layerId: string) {
    const layer = this.findLayer(layerId);
    if (!layer || layer.kind !== "raster" || !layer.bitmap) return;
    const before = [snapshotLayer(layer)];
    if (!autoLumaMaskInPlace(layer, this.doc.width, this.doc.height)) return;
    this.commit({ label: "Auto subject mask", before, after: [snapshotLayer(layer)] });
    this.actions.push({ op: "autoSubject" });
    this.requestRender();
  }

  // --- selection ---
  private commitSelection(label: string, mutate: () => void) {
    this.commit(withSelectionCommit(this.doc, label, mutate));
    this.requestRender();
  }

  selectRect(x: number, y: number, w: number, h: number, mode: SelectionMode = "replace", feather = 0) {
    this.commitSelection("Selection", () => selectRect(this.doc, x, y, w, h, mode, feather));
  }
  selectEllipse(x: number, y: number, w: number, h: number, mode: SelectionMode = "replace", feather = 0) {
    this.commitSelection("Selection (ellipse)", () => selectEllipse(this.doc, x, y, w, h, mode, feather));
  }
  selectLasso(points: Array<{ x: number; y: number }>, mode: SelectionMode = "replace", feather = 0) {
    this.commitSelection("Selection (lasso)", () => selectLasso(this.doc, points, mode, feather));
  }
  selectByColor(layerId: string, x: number, y: number, tolerance: number, mode: SelectionMode = "replace", contiguous = true) {
    const layer = this.findLayer(layerId);
    if (!layer || layer.kind !== "raster" || !layer.bitmap) return;
    this.commitSelection("Magic wand", () => selectByColor(this.doc, layer.bitmap!, x, y, tolerance, mode, contiguous));
  }
  selectAll() {
    this.commitSelection("Select all", () => selectAll(this.doc));
    this.actions.push({ op: "selectAll" });
  }
  deselect() {
    if (!this.doc.selection) return;
    this.commitSelection("Deselect", () => deselect(this.doc));
    this.actions.push({ op: "deselect" });
  }
  invertSelectionArea() {
    this.commitSelection("Invert selection", () => invertSelection(this.doc));
    this.actions.push({ op: "invertSelection" });
  }
  featherSelection(radius: number) {
    this.commitSelection(`Feather ${radius}px`, () => featherSelection(this.doc, radius));
    this.actions.push({ op: "featherSelection", radius });
  }
  refineSelection(params: RefineSelectionParams) {
    if (!this.doc.selection) return false;
    const before = cloneSelection(this.doc.selection);
    if (!refineSelection(this.doc, params)) return false;
    const after = cloneSelection(this.doc.selection);
    this.commit({ label: "Selection edge refined", before: [], after: [], selectionBefore: before, selectionAfter: after });
    this.requestRender();
    return true;
  }

  // --- filters ---
  filter(layerId: string, kind: "blur" | "sharpen" | "invert" | "desaturate" | "hue", opts: Record<string, number> = {}) {
    const layer = this.findLayer(layerId);
    if (!layer || layer.kind !== "raster" || !layer.bitmap || layer.locked) return;
    const before = [snapshotLayer(layer)];
    if (kind === "blur") {
      const r = opts.radius ?? 8;
      gaussianBlur(this.doc, layer, r);
      this.actions.push({ op: "blur", radius: r });
    } else if (kind === "sharpen") {
      const r = opts.radius ?? 2;
      const a = opts.amount ?? 0.6;
      unsharpMask(this.doc, layer, r, a);
      this.actions.push({ op: "sharpen", radius: r, amount: a });
    } else if (kind === "invert") {
      invertColors(this.doc, layer);
      this.actions.push({ op: "invert" });
    } else if (kind === "desaturate") {
      const a = opts.amount ?? 1;
      desaturate(this.doc, layer, a);
      this.actions.push({ op: "desaturate", amount: a });
    } else if (kind === "hue") {
      const d = opts.degrees ?? 45;
      hueRotate(this.doc, layer, d);
      this.actions.push({ op: "hue", degrees: d });
    }
    if (layer.bitmap) bumpBitmapVersion(layer.bitmap);
    this.syncLayerSurface(layer);
    this.checkpointLayerSurface(layer);
    this.commit({ label: `Filter: ${kind}`, before, after: [snapshotLayer(layer)] });
    this.requestRender();
  }

  // --- actions ---
  startRecording(name: string) { this.actions.start(name); this.emit(); }
  stopRecording() {
    const a = this.actions.stop();
    this.emit();
    return a;
  }
  replay(action: Action, activeLayerId: string | null) {
    for (const step of action.steps) this.runStep(step, activeLayerId);
  }
  private runStep(step: ActionStep, activeLayerId: string | null) {
    switch (step.op) {
      case "fill":
        if (activeLayerId) this.fillLayer(activeLayerId, step.color);
        break;
      case "clear":
        if (activeLayerId) this.clearPixels(activeLayerId);
        break;
      case "invert":
        if (activeLayerId) this.filter(activeLayerId, "invert");
        break;
      case "blur":
        if (activeLayerId) this.filter(activeLayerId, "blur", { radius: step.radius });
        break;
      case "sharpen":
        if (activeLayerId) this.filter(activeLayerId, "sharpen", { radius: step.radius, amount: step.amount });
        break;
      case "desaturate":
        if (activeLayerId) this.filter(activeLayerId, "desaturate", { amount: step.amount });
        break;
      case "hue":
        if (activeLayerId) this.filter(activeLayerId, "hue", { degrees: step.degrees });
        break;
      case "invertSelection": this.invertSelectionArea(); break;
      case "featherSelection": this.featherSelection(step.radius); break;
      case "selectAll": this.selectAll(); break;
      case "deselect": this.deselect(); break;
      case "addAdjustment": this.addAdjustmentLayer("Tone", step.tone as Partial<ToneParams>); break;
      case "autoSubject": if (activeLayerId) this.autoLumaMask(activeLayerId); break;
    }
  }

  // --- PSD ---
  async importPsd(buffer: ArrayBuffer) {
    const newDoc = await importPsd(buffer);
    this.installDocument(newDoc, "Imported PSD");
    this.commit({ label: "PSD imported", before: [], after: [] });
    this.requestRender();
    return newDoc;
  }

  exportPsd(options: PhotoshopExportOptions = {}): ArrayBuffer { return exportPsd(this.doc, options); }
  exportPhotoshop(options: PhotoshopExportOptions = {}) { return exportPhotoshopDocument(this.doc, options); }
  photoshopCompatibility(options: PhotoshopExportOptions = {}) { return photoshopCompatibilityReport(this.doc, options); }

  async exportProject(name = "Untitled") {
    const { encodeLumaProject } = await import("./project");
    return encodeLumaProject(this.doc, this.actions.list(), name, this.history.snapshot());
  }

  async importProject(blob: Blob) {
    const { decodeLumaProject } = await import("./project");
    const project = await decodeLumaProject(blob);
    this.installDocument(project.doc, project.name);
    this.history = project.history ?? newHistory();
    const session = this.sessions.find((candidate) => candidate.id === this.activeSessionId);
    if (session) session.history = this.history;
    this.actions.fromJSON(JSON.stringify(project.actions));
    this.requestRender();
    this.emit();
    return project;
  }

  // --- export ---
  async exportImage(type: "image/png" | "image/jpeg" | "image/webp" = "image/png", quality = 0.92): Promise<Blob> {
    const browserCanvasSafe = this.doc.width <= 16384 && this.doc.height <= 16384 &&
      this.doc.width * this.doc.height <= 64_000_000;
    if (type === "image/png" && !browserCanvasSafe) {
      const { exportTiledPng } = await import("./png-stream");
      return exportTiledPng(this.doc);
    }
    if (!browserCanvasSafe) {
      throw new Error("Large-document JPEG/WebP export is unavailable; export PNG or reduce the document dimensions.");
    }
    const output = newCanvas(this.doc.width, this.doc.height);
    if (type === "image/jpeg") {
      const clean = newCanvas(this.doc.width, this.doc.height);
      if (!this.useGL || !renderGL(this.doc, clean, false, false)) renderClean(this.doc, clean);
      const ctx = output.getContext("2d")!;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, output.width, output.height);
      ctx.drawImage(clean, 0, 0);
    } else if (!this.useGL || !renderGL(this.doc, output, false, false)) renderClean(this.doc, output);
    return new Promise((resolve, reject) => {
      output.toBlob((blob) => blob ? resolve(blob) : reject(new Error("toBlob failed")), type, quality);
    });
  }

  exportPNG(): Promise<Blob> { return this.exportImage("image/png"); }

  // Rasterize the entire document into a fresh canvas without the checkerboard.
  flatten(): HTMLCanvasElement {
    const c = newCanvas(this.doc.width, this.doc.height);
    if (!this.useGL || !renderGL(this.doc, c, false, false)) renderClean(this.doc, c);
    return c;
  }
}

/**
 * Run a plugin's dispose handler without letting it break the host. Plugin code
 * is not trusted to be well-behaved; a throw here must never abort Studio
 * teardown or strand other plugins.
 */
function runPluginDispose(id: string, dispose: (() => void) | undefined) {
  if (!dispose) return;
  try {
    dispose();
  } catch (error) {
    console.error(`Luma plugin "${id}" threw while disposing`, error);
  }
}

// Snapshot / clone helpers moved to ./history-payload for testability.

function pixelFormatForDepth(bitDepth: Document["bitDepth"]): PixelFormat {
  return bitDepth === 32 ? "rgba32f" : bitDepth === 16 ? "rgba16f" : "rgba8";
}

// Deep clone helpers moved to ./history-payload for testability.
function developedDngPreviewCanvas(developed: DevelopedDng) {
  const canvas = newCanvas(developed.width, developed.height);
  const context = canvas.getContext("2d")!;
  const image = context.createImageData(developed.width, developed.height);
  image.data.set(previewDisplayRgba(developed));
  context.putImageData(image, 0, 0);
  return canvas;
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Canvas encoding failed")), "image/png");
  });
}

async function blobToCanvas(blob: Blob, width: number, height: number) {
  const canvas = newCanvas(width, height);
  const image = await createImageBitmap(blob);
  canvas.getContext("2d")!.drawImage(image, 0, 0, width, height);
  image.close();
  return canvas;
}

async function sha256Blob(blob: Blob) {
  if (!globalThis.crypto?.subtle) return undefined;
  const digest = await globalThis.crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

// paintTarget moved to ./stroke-target for testability.

// Scripting surface — installed on window as `window.luma` in the studio page.
export type LumaAPI = {
  version: typeof LUMA_API_VERSION;
  studio: Studio;
  layers(): Layer[];
  active(): Layer | null;
  select(id: string | null): void;
  documents(): ReturnType<Studio["listDocuments"]>;
  history(): ReturnType<Studio["historyState"]>;
  engine(): ReturnType<Studio["engineState"]>;
  checkoutHistory(nodeId: string): boolean;
  registerPlugin(plugin: LumaPlugin): () => void;
  plugins(): ReturnType<Studio["listPlugins"]>;
  export(type?: "image/png" | "image/jpeg" | "image/webp", quality?: number): Promise<Blob>;
};

export { nextId };
export type { LayerKind };
