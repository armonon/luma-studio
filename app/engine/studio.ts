import { selectLayerRange, selectedLayerTree, type LayerSelection, type LayerSelectionModifiers } from "./layer-selection";
import { materializeImportedVectors } from "./vector-import-install";
import {
  BlendMode,
  BlendPass,
  BlendIf,
  AiProvenance,
  fitImageRect,
  CapturedBrushAsset,
  Document,
  HslParams,
  Guide,
  IDENTITY_TRANSFORM,
  Layer,
  MAX_CAPTURED_BRUSHES,
  MAX_CAPTURED_BRUSH_EDGE,
  MAX_ARTBOARDS,
  MAX_LAYER_COMPS,
  LayerKind,
  LayerEffect,
  LayerEffectKind,
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
  affineForLayerTransform,
  documentPointToLayer,
  inverseAffineForLayerTransform,
  rotateLayerTransformAround,
  cloneCurves,
  cloneCanvas,
  createAdjustmentLayer,
  createCurvesLayer,
  createDocument,
  createHslLayer,
  createLevelsLayer,
  createGroupLayer,
  createPathLayer,
  createProAdjustmentLayer,
  createRasterLayer,
  createShapeLayer,
  createTextLayer,
  newCanvas,
  nextId,
  reserveId,
  resolvedBlendPasses,
  resolvedBlendIf,
  resolvedEffectBlendMode,
  resolvedFillOpacity,
  resolvedGlobalLight,
  transformPoint,
  type GlobalLight,
} from "./document";
import { captureSelectedPixels, clipboardRegion, type PixelClipboard } from "./selection-clipboard";
import {
  PRO_ADJUSTMENT_LABELS,
  defaultProAdjustment,
  type ProAdjustmentKind,
  type ProAdjustmentParams,
} from "./pro-adjustments";
import { instantiateStyle, planCreateLayers, type LayerStylePreset } from "./layer-styles";
import { renderEffectAlone } from "./layer-effects";
import { isNeutralBlendIf } from "./blend";
import { validateVectorPath } from "./vector-path";
import { blendRecipePasses, type BlendRecipeId } from "./blend-recipes";
import { compositeNativeTile, isNativeCoreAvailable } from "./native-core";
import {
  BrushParams,
  BrushPoint,
  brushTileBatches,
  BrushCoverageCache,
  BrushStrokePlanner,
  validBrushPoint,
  smoothBrushPoint,
  ImageBrushMode,
  ImageBrushTip,
  PaintSegmentState,
  createPaintSegmentState,
  paintSegment,
  parseBrushColor,
  planStroke,
  replayStrokeFloat,
} from "./brush";
import {
  renderClean,
  renderTiledClean,
  tiledCleanRenderBytes,
  renderViewport,
  viewportRenderCacheStats,
  viewportRenderPerformanceStats,
  type FocusRenderOptions,
} from "./renderer";
import { bumpBitmapVersion, gpuTextureCacheStats, isGLSupported, rasterizeLayer, renderGL } from "./gl-renderer";
import { pendingDocumentFonts, subscribeTextFonts, waitForDocumentFonts } from "./text-font-resources";
import { renderedTextLayers } from "./text-render-dependencies";
import { nativeFontResourceStats } from "./native-font-resources";
import { nativeCanUseSurfaceDirectly, nativeFlattenRefusal, tileFromContext } from "./native-flatten";
import { documentSizeRefusal, exceedsBrowserCanvas, fitsBrowserCanvas } from "./large-documents";
import { isValidTransformQuad } from "./advanced-tools";
import { currentEdition } from "./edition";
import { ProjectEncodingQueue } from "./project-encoding-queue";
import { parseLegacyCanvasFont, textRunsAfterContentEdit } from "./text-model";
import { cloneSpatialStyle, withTextSpatial } from "./text-3d";
import {
  SelectionMode,
  RefineSelectionParams,
  deselect,
  featherSelection,
  invertSelection,
  refineSelection,
  selectAll,
  selectByColorTiled,
  selectEllipse,
  selectLasso,
  selectTransformedMask,
  selectText,
  selectRect,
  selectionRegionCanvas,
  selectionSurface,
} from "./selection";
import { SparseAlphaSurface, type AlphaTileRecord } from "./alpha-surface";
import {
  desaturate,
  destructiveFilterScratchBytes,
  filterRegionForSelection,
  gaussianBlur,
  hueRotate,
  invertColors,
  smartFilterInfluenceRadius,
  unsharpMask,
} from "./filters";
import type { Curves } from "./document";
import { Action, ActionRecorder, ActionStep, isSafeAction } from "./actions";
import { ActionPlaybackError, actionStepUnavailableReason, type ActionPlaybackReport } from "./action-playback";
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
  vectorPathBytes,
} from "./history-payload";
import { paintTarget } from "./stroke-target";
import {
  hasLayerMask,
  layerMaskSurface,
  setLayerMaskFromCanvas,
} from "./layer-mask";
import { applyLayerSnapshot } from "./layer-snapshot-apply";
import {
  AdjustmentKind,
  AdjustmentParams,
  adjustmentLabel,
  applyAdjustment,
  isAdjustmentLayer,
  snapshotForAdjustment,
} from "./layer-mutations";
import { autoLumaMaskInPlace, clearMaskInPlace, featherMaskInPlace, invertMaskInPlace } from "./mask-ops";
import { withSelectionCommit } from "./selection-driver";
import type {
  PhotoshopCompatibilityReport,
  PhotoshopExportOptions,
} from "./psd";
import { getPhotoshopDocumentMetadata, setPhotoshopDocumentMetadata, getPhotoshopLayerMetadata, setPhotoshopLayerMetadata } from "./psd-metadata";
import { recolorProcessor, validateRecolor, type RecolorParams } from "./recolor";
import { emptyCampaign, validateCampaign, textRecipe, layerColor, setLayerColor, CAMPAIGN_FORMATS, CAMPAIGN_COMMANDS, campaignPreflight, campaignFormatRefusal, type Campaign, type CampaignAction } from "./campaign";
import { validateDesignSnapshots, DESIGN_SNAPSHOT_LIMITS, DESIGN_SNAPSHOT_COMMANDS, type DesignSnapshot, type DesignSnapshotAction } from "./design-snapshots";
import { applyDesignLayout } from "./campaign";
import { CAMPAIGN_MASK_BYTES, cloneComponentLayer, componentMapping, componentTree, linkedComponents, mappedTransform, mapComponentMasks } from "./campaign-components";
import { recolorUnavailableReason, recolorDocumentMaskBounds, recolorSelectionWeights, type RecolorSession, type RecolorOutput, type RecolorProgress } from "./recolor-target";
import { alphaSurfaceFromCanvas } from "./selection";
import { assertSmartContentDimensions, embeddedPhotoshopSource, smartContentUnavailableReason, type SmartContentTarget } from "./smart-object-content";
import { cloneLetteringAsset, validateLetteringAsset, type LetteringAsset } from "./lettering-asset";
import { parseFormMesh, validateFormMesh, type FormMeshAsset } from "./form-mesh-asset";
import { actionConditionMatches, describeActionCondition } from "./action-conditions";
import { OperationHistory } from "./operation-history";
import { DEFAULT_TILE_SIZE, PixelFormat, PixelRect, PrecisionTileSurface, TileGrid } from "./tile-store";
import { drawLayerContentManaged, precisionPreviewCacheStats } from "./precision-renderer";
import { displaySrgbToWorking, workingToDisplaySrgb } from "./color";
import { replayRetouch, planRepairOffsets, type RetouchMode } from "./retouch";
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
import { calculateDisplayViewport, sameDisplayViewport, type DisplayViewport } from "./viewport";
import { appendDirtyRegion } from "./dirty-regions";
import { AdaptiveRenderGovernor } from "./performance-governor";
import { computeResidencyBudget } from "./tile-residency";
import { ResidentMemoryBudget } from "./resident-memory";
import {
  normalizeAiEditConfig,
  runAiEditVariations,
  selectionAlphaToEditMask,
  type AiEditOperation,
  type AiEditQuality,
  type AiOperationControls,
  type AiSelectionGuide,
} from "./ai-edit";
import { planAiWorkRegion, planAiGeometryCopy, type AiGeometryCopy } from "./ai-work-region";
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
  smartSource?: Uint8Array | null;
  lettering3d?: LetteringAsset;
  mesh3d?: FormMeshAsset;
  layerId: string;
  bitmap?: HTMLCanvasElement;
  surface?: PrecisionTileSurface;
  maskSurface?: SparseAlphaSurface;
  mask?: HTMLCanvasElement;
  maskPresent?: boolean;
  tone?: ToneParams;
  curves?: Curves;
  levels?: LevelsParams;
  hsl?: HslParams;
  proAdjustment?: ProAdjustmentParams;
  opacity?: number;
  fillOpacity?: number | null;
  blend?: BlendMode;
  blendStack?: BlendPass[] | null;
  blendIf?: BlendIf | null;
  visible?: boolean;
  name?: string;
  transform?: Transform;
  spatial?: Layer["spatial"] | null;
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
  knockout?: Layer["knockout"] | null;
  blendChannels?: Layer["blendChannels"] | null;
  maskHidesEffects?: boolean | null;
  vectorMaskHidesEffects?: boolean | null;
  transparencyShapesLayer?: boolean | null;
  blendClippedAsGroup?: boolean | null;
};

/** A layer style on the clipboard: effects plus the blending options. */
export type CopiedLayerStyle = {
  effects: LayerEffect[];
  blendStack: BlendPass[];
  blendIf: BlendIf;
  fillOpacity: number;
};

export type HistoryEntry = {
  campaignBefore?: Campaign | null;
  designSnapshotsBefore?: DesignSnapshot[];
  designSnapshotsAfter?: DesignSnapshot[];
  campaignAfter?: Campaign | null;
  artboardsBefore?: NonNullable<Document["artboards"]>;
  artboardsAfter?: NonNullable<Document["artboards"]>;
  layoutBefore?: { width: number; height: number };
  layoutAfter?: { width: number; height: number };
  channelsBefore?: NonNullable<Document["alphaChannels"]>;
  channelsAfter?: NonNullable<Document["alphaChannels"]>;
  label: string;
  before: LayerSnapshot[];
  after: LayerSnapshot[];
  layersBefore?: Layer[];
  layersAfter?: Layer[];
  /** Compact structural history for pure reorders. Layer objects and pixel
   * stores stay shared; only stable ids are retained. */
  layerOrderBefore?: string[];
  layerOrderAfter?: string[];
  selectionBefore?: Selection | null;
  selectionAfter?: Selection | null;
  selectionTranslation?: SelectionTranslationPatch;
  pixelPatches?: PixelPatch[];
  surfacePatches?: SurfaceTilePatch[];
  maskSurfacePatches?: LayerMaskTilePatch[];
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
  /** Pixel patches already own the exact display mirror for this operation. */
  updateBitmap?: boolean;
};

export type LayerMaskTilePatch = {
  layerId: string;
  key: string;
  before: AlphaTileRecord | null;
  after: AlphaTileRecord | null;
};

export type SelectionTranslationPatch = {
  sourceX: number;
  sourceY: number;
  source: ImageData | null;
  deltaX: number;
  deltaY: number;
  beforeBounds: Selection["bounds"];
  afterBounds: Selection["bounds"];
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
  nativePath?: string;
  recovered?: boolean;
  savedHistoryNodeId: string;
  /** True while an interactive edit has changed pixels/parameters but has not
   * yet been folded into a single history entry. This keeps close/quit guards
   * honest during a drag instead of waiting for pointer-up. */
  transientDirty: boolean;
  /** Action-library edits are not canvas gestures and must survive canvas undo. */
  actionsDirty?: boolean;
};

export const HISTORY_LIMIT = 80;
export const HISTORY_MAX_BYTES = 512 * 1024 * 1024; // 512 MB across all entries
export const HISTORY_MIN_BYTES = 64 * 1024 * 1024;

const CONTENT_MOVE_HEAL_BLUR = 14;
const CONTENT_MOVE_HEAL_PADDING = Math.ceil(CONTENT_MOVE_HEAL_BLUR * 4) + 2;

export type SelectionContentMovePlan = {
  /** The exact non-zero selection support copied into the moving scratch. */
  content: PixelRect;
  /** Content support plus transparent resampling guard pixels. */
  contentScratch: PixelRect;
  /** Blur scratch in document coordinates; may extend outside the document. */
  healWork: PixelRect | null;
  /** Source and translated destination union used for tile/screen invalidation. */
  affected: PixelRect;
};

/**
 * Bounds temporary content-aware-move storage by selection size. Selection
 * alpha and its undo state remain sparse throughout the operation.
 */
export function planSelectionContentMove(
  bounds: Selection["bounds"],
  documentWidth: number,
  documentHeight: number,
  deltaX: number,
  deltaY: number,
  healSource = true,
): SelectionContentMovePlan | null {
  const left = Math.max(0, Math.floor(bounds.x));
  const top = Math.max(0, Math.floor(bounds.y));
  const right = Math.min(documentWidth, Math.ceil(bounds.x + Math.max(0, bounds.w)));
  const bottom = Math.min(documentHeight, Math.ceil(bounds.y + Math.max(0, bounds.h)));
  if (right <= left || bottom <= top) return null;
  const content = { x: left, y: top, width: right - left, height: bottom - top };
  const contentScratch = clipPixelRect({
    x: content.x - 2,
    y: content.y - 2,
    width: content.width + 4,
    height: content.height + 4,
  }, documentWidth, documentHeight)!;
  const destination = {
    x: Math.floor(content.x + deltaX),
    y: Math.floor(content.y + deltaY),
    width: Math.ceil(content.x + content.width + deltaX) - Math.floor(content.x + deltaX),
    height: Math.ceil(content.y + content.height + deltaY) - Math.floor(content.y + deltaY),
  };
  const affectedLeft = Math.min(content.x, destination.x);
  const affectedTop = Math.min(content.y, destination.y);
  const affectedRight = Math.max(content.x + content.width, destination.x + destination.width);
  const affectedBottom = Math.max(content.y + content.height, destination.y + destination.height);
  return {
    content,
    contentScratch,
    healWork: healSource ? {
      x: content.x - CONTENT_MOVE_HEAL_PADDING,
      y: content.y - CONTENT_MOVE_HEAL_PADDING,
      width: content.width + CONTENT_MOVE_HEAL_PADDING * 2,
      height: content.height + CONTENT_MOVE_HEAL_PADDING * 2,
    } : null,
    affected: {
      x: affectedLeft,
      y: affectedTop,
      width: affectedRight - affectedLeft,
      height: affectedBottom - affectedTop,
    },
  };
}

function clipPixelRect(rect: PixelRect, width: number, height: number): PixelRect | null {
  const left = Math.max(0, Math.floor(rect.x));
  const top = Math.max(0, Math.floor(rect.y));
  const right = Math.min(width, Math.ceil(rect.x + Math.max(0, rect.width)));
  const bottom = Math.min(height, Math.ceil(rect.y + Math.max(0, rect.height)));
  return right <= left || bottom <= top
    ? null
    : { x: left, y: top, width: right - left, height: bottom - top };
}

function selectionMoveMutationRegions(
  content: PixelRect,
  deltaX: number,
  deltaY: number,
  width: number,
  height: number,
) {
  const source = clipPixelRect(content, width, height);
  const destination = clipPixelRect({
    x: Math.floor(content.x + deltaX),
    y: Math.floor(content.y + deltaY),
    width: Math.ceil(content.x + content.width + deltaX) - Math.floor(content.x + deltaX),
    height: Math.ceil(content.y + content.height + deltaY) - Math.floor(content.y + deltaY),
  }, width, height);
  if (!source) return destination ? [destination] : [];
  if (!destination) return [source];
  const overlaps = source.x < destination.x + destination.width && destination.x < source.x + source.width &&
    source.y < destination.y + destination.height && destination.y < source.y + source.height;
  if (!overlaps) return [source, destination];
  const left = Math.min(source.x, destination.x);
  const top = Math.min(source.y, destination.y);
  const right = Math.max(source.x + source.width, destination.x + destination.width);
  const bottom = Math.max(source.y + source.height, destination.y + destination.height);
  return [{ x: left, y: top, width: right - left, height: bottom - top }];
}

/** Scale undo storage down on memory-constrained devices without reducing the node cap. */
export function historyBudgetForDeviceMemory(deviceMemoryGiB?: number) {
  if (deviceMemoryGiB === undefined) return HISTORY_MAX_BYTES;
  if (!Number.isFinite(deviceMemoryGiB) || deviceMemoryGiB <= 0) return HISTORY_MIN_BYTES;
  return Math.max(
    HISTORY_MIN_BYTES,
    Math.min(HISTORY_MAX_BYTES, Math.floor(deviceMemoryGiB * 128 * 1024 * 1024)),
  );
}

function runtimeDeviceMemoryGiB() {
  try {
    return typeof navigator === "undefined"
      ? undefined
      : (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  } catch {
    return undefined;
  }
}

export function newHistory(maxBytes = HISTORY_MAX_BYTES) {
  return new OperationHistory<HistoryEntry>({
    maxNodes: HISTORY_LIMIT,
    maxBytes,
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
  private smartContentEdits = new Map<string, { parentId: string; layerId: string; node: string; bitmap: HTMLCanvasElement }>();
  private readonly unsubscribeTextFonts = subscribeTextFonts(() => {
    this.requestPresentationRender();
  });
  doc: Document;
  target: HTMLCanvasElement;
  actions = new ActionRecorder();
  useGL = false; // GPU compositing (RGBA16F) when true and supported
  private subscribers = new Set<SubscribeFn>();
  /** Copy/Paste Layer Style, session-scoped like Photoshop's. */
  private styleClipboard: CopiedLayerStyle | null = null;
  private pixelClipboard: PixelClipboard | null = null;
  private selectionGesture: { doc: Document; before: Selection | null; mode: SelectionMode; accumulated: Selection | null } | null = null;
  private history: OperationHistory<HistoryEntry>;
  private readonly historyBudgetBytes: number;
  private readonly residentMemoryBudget: ResidentMemoryBudget;
  private reservedOperationBytes = 0;
  private readonly projectEncodingQueue = new ProjectEncodingQueue();

  private compressedSources(document: Document, entries: readonly HistoryEntry[] = [], includeProjectAssets = false) {
    const sources = new Set<Uint8Array>();
    const visited = new Set<object>();
    const visitLayers = (layers: readonly (Layer | LayerSnapshot)[] | undefined) => {
      for (const layer of layers ?? []) {
        if (visited.has(layer)) continue;
        visited.add(layer);
        const bytes = layer.surface?.store.sourceState()?.base.source.bytes;
        if (bytes) sources.add(bytes);
        if(includeProjectAssets&&layer.raw?.original)sources.add(layer.raw.original);
        if(includeProjectAssets&&layer.smartSource)sources.add(layer.smartSource);
      }
    };
    const visitDocument = (doc: Document | undefined) => {
      if (!doc || visited.has(doc)) return;
      visited.add(doc);
      const bytes = getPhotoshopDocumentMetadata(doc)?.originalSource;
      if (bytes) sources.add(bytes);
      visitLayers(doc.layers);
      if(includeProjectAssets)for (const snapshot of doc.designSnapshots ?? []) sources.add(snapshot.bytes);
    };
    visitDocument(document);
    for (const entry of entries) {
      visitLayers(entry.before); visitLayers(entry.after);
      visitLayers(entry.layersBefore); visitLayers(entry.layersAfter);
      visitDocument(entry.documentBefore); visitDocument(entry.documentAfter);
      if(includeProjectAssets)for (const snapshot of [...(entry.designSnapshotsBefore ?? []), ...(entry.designSnapshotsAfter ?? [])]) sources.add(snapshot.bytes);
    }
    return sources;
  }

  private serializationMemory(document: Document, entries: readonly HistoryEntry[] = []) {
    let bytes = 8 * 1024 * 1024;
    for (const source of this.compressedSources(document, entries, true)) bytes += source.byteLength * 3;
    for (const layer of document.layers) {
      bytes += (layer.bitmap ? layer.bitmap.width * layer.bitmap.height * 8 : 0)
        + (layer.mask ? layer.mask.width * layer.mask.height * 8 : 0)
        + (layer.surface?.store.stats().residentBytes ?? 0) * 3
        + (layer.maskSurface?.stats().residentBytes ?? 0) * 3;
      bytes += historyEntrySize({label:"Serialization metadata",before:[],after:[{layerId:layer.id,path:layer.path,lettering3d:layer.lettering3d,mesh3d:layer.mesh3d,proAdjustment:layer.proAdjustment}]}) * 3;
    }
    for(const brush of document.capturedBrushes??[])bytes+=brush.bitmap.width*brush.bitmap.height*8;
    if(document.selection?.mask)bytes+=document.selection.mask.width*document.selection.mask.height*8;
    bytes += (document.selection?.surface?.stats().residentBytes ?? 0) * 3;
    for (const channel of document.alphaChannels ?? []) bytes += channel.surface.stats().residentBytes * 3;
    return bytes;
  }

  /** Conservative admission of known allocations, not a claim to measure the JS heap. */
  private reserveOperationMemory(bytes: number) {
    let known = this.residentMemoryBudget.stats().residentBytes + this.reservedOperationBytes + nativeFontResourceStats().residentBytes;
    const canvases = new Set<HTMLCanvasElement>();
    if (this.pixelClipboard) canvases.add(this.pixelClipboard.canvas);
    for (const session of this.sessions) {
      known += session.history.summary().bytes;
      const document = session.id === this.activeSessionId ? this.doc : session.doc;
      for (const layer of document.layers) {
        if (layer.bitmap) canvases.add(layer.bitmap);
        if (layer.mask) canvases.add(layer.mask);
        if (layer.subjectMask) canvases.add(layer.subjectMask);
      }
      for (const brush of document.capturedBrushes ?? []) canvases.add(brush.bitmap);
    }
    for (const canvas of canvases) known += canvas.width * canvas.height * 4;
    const viewport = viewportRenderCacheStats();
    known += gpuTextureCacheStats().residentBytes + viewport.scratchCacheBytes + viewport.maxBytesPerDocument * this.sessions.length;
    const ceiling = 1024 * 1024 * 1024;
    if (!Number.isSafeInteger(bytes) || bytes < 0 || known + bytes > ceiling) throw new Error(`Operation exceeds the 1 GB known-memory admission ceiling (${Math.ceil(known / 1024 / 1024)} MiB already accounted for, ${Math.ceil(bytes / 1024 / 1024)} MiB requested); close documents or reduce the operation size.`);
    this.reservedOperationBytes += bytes;
    let released = false;
    return () => { if (!released) { released = true; this.reservedOperationBytes -= bytes; } };
  }
  private renderScheduled = false;
  private renderRevision = 0;
  // Fonts, viewports and focus invalidate preview caches, not document ownership.
  private presentationRenderRevision = 0;
  private actionRevision = 0;
  private layerHierarchyRevision = 0;
  private fullRenderPending = true;
  private pendingDirtyRegions: PixelRect[] = [];
  private disposed = false;
  private antsTimer: number | null = null;
  private strokeTiles: Map<string, StrokeTile> | null = null;
  private activeStroke: { layer: Layer; document: Document; params: BrushParams; originalMask: Layer["mask"]; originalMaskSurface: Layer["maskSurface"] } | null = null;
  private lastPoint: BrushPoint | null = null;
  private paintSegmentState: PaintSegmentState | null = null;
  private precisionStroke: {
    layerId: string;
    params: BrushParams;
    planner: BrushStrokePlanner;
    tiles: Map<string, { base: Float32Array; values: Float32Array; coverage: BrushCoverageCache }>;
    workingColor: readonly [number, number, number];
    cacheBytes: number;
    before: Map<string, Uint8Array | null>;
  } | null = null;
  private maskStroke: {
    layerId: string;
    planner: BrushStrokePlanner;
    cacheBytes: number;
    tiles: Map<string, { base: Float32Array; values: Float32Array; coverage: BrushCoverageCache }>;
    before: Map<string, AlphaTileRecord | null>;
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
  private layerSelections = new Map<string, LayerSelection>();

  layerSelection(activeId: string | null): LayerSelection {
    const saved = this.layerSelections.get(this.activeSessionId);
    const valid = new Set(this.doc.layers.map(layer => layer.id));
    if (!saved || saved.primary !== activeId) return { ids: activeId && valid.has(activeId) ? [activeId] : [], primary: activeId, anchor: activeId };
    return { ...saved, ids: saved.ids.filter(id => valid.has(id)) };
  }

  selectLayers(id: string, modifiers: LayerSelectionModifiers, activeId: string | null) {
    const valid = new Set(this.doc.layers.map(layer => layer.id));
    const order = modifiers.orderedIds?.filter(key => valid.has(key)) ?? [...valid];
    const next = selectLayerRange(order, this.layerSelection(activeId), id, modifiers);
    this.layerSelections.set(this.activeSessionId, next);
    return next;
  }

  setSelectedLayers(ids: string[]) {
    const valid = ids.filter(id => this.findLayer(id));
    const primary = valid[0] ?? null;
    this.layerSelections.set(this.activeSessionId, { ids: valid, primary, anchor: primary });
    return primary;
  }

  rememberedLayerSelectionPrimary() {
    const saved = this.layerSelections.get(this.activeSessionId);
    if (saved?.primary && this.findLayer(saved.primary)) return saved.primary;
    return this.doc.layers[0]?.id ?? null;
  }
  private activeSessionId = "";
  private liveSnapshots = new Map<string, LayerSnapshot>();
  private liveGlobalLightDocument: Document | null = null;
  private plugins = new Map<string, { plugin: LumaPlugin; dispose?: () => void }>();
  private tileBacking = IndexedDbTileBacking.supported() ? new IndexedDbTileBacking() : null;
  private rawSessions = new Map<string, DngDevelopSession>();
  private virtualPyramid: VirtualCanvasPyramid;
  private virtualPlanner: ViewportTilePlanner;
  private virtualDirty: PyramidDirtyTracker;
  private virtualPlan: ViewportPlan | null = null;
  private displayViewport: DisplayViewport | null = null;
  private channelView: "rgb" | "red" | "green" | "blue" | "alpha" = "rgb";
  private focusPreview: FocusRenderOptions | null = null;
  private readonly renderGovernor = new AdaptiveRenderGovernor();
  private renderQualityTimer: number | null = null;

  constructor(width: number, height: number, target: HTMLCanvasElement) {
    const deviceMemoryGiB = runtimeDeviceMemoryGiB();
    this.historyBudgetBytes = historyBudgetForDeviceMemory(deviceMemoryGiB);
    this.residentMemoryBudget = new ResidentMemoryBudget(computeResidencyBudget({
      // navigator.deviceMemory is optional (notably under tests and hardened
      // webviews). Eight GiB is a conservative desktop fallback; the 1.5 GiB
      // hard cap below remains authoritative.
      availableMemoryBytes: (deviceMemoryGiB ?? 8) * 1024 * 1024 * 1024,
      fraction: 0.25,
      reserveBytes: 512 * 1024 * 1024,
      minimumBytes: 256 * 1024 * 1024,
      maximumBytes: 1536 * 1024 * 1024,
    }));
    this.history = newHistory(this.historyBudgetBytes);
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
      savedHistoryNodeId: this.history.current,
      transientDirty: false,
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
        // Reuse the existing composite tiles: only the marching-ant phase has
        // changed. Keeping the content revision stable turns this repaint into
        // cached tile copies instead of recompositing every layer five times a
        // second.
        if (this.doc.selection && !this.renderScheduled) {
          this.requestRender(undefined, { reuseComposite: true });
        }
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
    this.smartContentEdits.clear();
    this.layerSelections.clear();
    this.cancelSelectionGesture();
    this.pixelClipboard = null;
    this.unsubscribeTextFonts();
    this.cancelStroke();
    this.disposed = true;
    if (this.antsTimer !== null) {
      window.clearTimeout(this.antsTimer);
      this.antsTimer = null;
    }
    if (this.renderQualityTimer !== null) {
      window.clearTimeout(this.renderQualityTimer);
      this.renderQualityTimer = null;
    }
    // Third-party dispose handlers must not be able to abort teardown — an
    // uncaught throw here previously skipped both clear() calls below, leaking
    // every React subscriber onto a disposed Studio.
    for (const [id, entry] of this.plugins) runPluginDispose(id, entry.dispose);
    this.plugins.clear();
    this.subscribers.clear();
    if (this.tileBacking) {
      for (const session of this.sessions) {
        for (const layer of session.doc.layers) {
          void this.tileBacking.deleteSurface(this.surfaceBackingId(layer.id, session.id)).catch(() => undefined);
        }
      }
    }
  }
  private emit() {
    // A UI observer must not turn a committed edit into an apparent failure.
    for (const fn of this.subscribers) {
      try { fn(); } catch (error) { console.error("Studio subscriber failed", error); }
    }
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
    if (sameDisplayViewport(this.displayViewport, viewport)) return this.virtualPlan;
    this.displayViewport = viewport;
    this.virtualPlan = this.virtualPlanner.plan(viewport, {
      prefetchMarginTiles: 1,
      fallbackLevels: 2,
      maxRequests: 2048,
    });
    this.requestPresentationRender();
    this.scheduleFullQualityPreview();
    return this.virtualPlan;
  }

  /** A shell remount must never leave the engine drawing into a detached canvas. */
  attachDisplayTarget(target: HTMLCanvasElement) {
    if (this.target === target) return;
    this.target = target;
    this.requestPresentationRender();
  }

  /** Interactive editing scope; deliberately excluded from exports and project data. */
  setFocusPreview(next: FocusRenderOptions | null) {
    const currentKey = this.focusPreview
      ? `${this.focusPreview.layerId}:${this.focusPreview.target}:${this.focusPreview.context}`
      : "project";
    const nextKey = next ? `${next.layerId}:${next.target}:${next.context}` : "project";
    if (currentKey === nextKey) return;
    this.focusPreview = next ? { ...next } : null;
    this.requestPresentationRender();
  }

  private scheduleFullQualityPreview() {
    if (!Studio.hasDom()) return;
    if (this.renderQualityTimer !== null) window.clearTimeout(this.renderQualityTimer);
    this.renderQualityTimer = window.setTimeout(() => {
      this.renderQualityTimer = null;
      if (this.renderGovernor.restoreFullQuality()) this.requestPresentationRender();
    }, 180);
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

  /** Repaint changed presentation without invalidating document save tickets. */
  private requestPresentationRender() {
    if (this.disposed) return;
    this.presentationRenderRevision++;
    this.requestRender();
  }

  requestRender(dirtyRegion?: PixelRect, options: { reuseComposite?: boolean } = {}) {
    if (this.disposed) return;
    if (!options.reuseComposite) {
      this.renderRevision += 1;
      if (dirtyRegion && !this.fullRenderPending) {
        this.pendingDirtyRegions = appendDirtyRegion(this.pendingDirtyRegions, dirtyRegion);
        this.virtualDirty.invalidate(dirtyRegion);
        this.scheduleFullQualityPreview();
      } else if (!dirtyRegion) {
        this.fullRenderPending = true;
        this.pendingDirtyRegions = [];
      }
    }
    // Headless: there is nothing to paint into and no frame clock. Bumping the
    // revision is still correct so cache invalidation stays consistent.
    if (!Studio.hasDom()) return;
    if (this.renderScheduled) return;
    this.renderScheduled = true;
    requestAnimationFrame(() => {
      this.renderScheduled = false;
      if (this.disposed) return;
      const dirtyRegions = this.fullRenderPending ? undefined : this.pendingDirtyRegions;
      this.fullRenderPending = false;
      this.pendingDirtyRegions = [];
      // GPU preview when the user has asked for it AND the platform actually
      // supports RGBA16F FBOs. Any failure falls straight back to the CPU path
      // so the toggle can't visually break the app.
      // The interactive viewport is CPU-only on purpose. `renderGL` composites
      // the whole document 1:1 and takes no DisplayViewport, so routing the
      // preview through it silently discards zoom/pan, distorts aspect ratio,
      // desynchronises the overlay plane and pointer mapping, and drops the
      // selection outline. Until renderGL accepts a viewport, GPU compositing
      // is used only for export/flatten (see exportImage/flatten).
      const workload = dirtyRegions?.length ? "interactive" as const : "navigation" as const;
      const baseViewport = this.displayViewport ?? this.fallbackDisplayViewport();
      const governedViewport = this.renderGovernor.apply(baseViewport);
      const renderStartedAt = performance.now();
      renderViewport(this.doc, this.target, governedViewport, {
        cacheRevision: this.renderRevision,
        hierarchyRevision: this.layerHierarchyRevision,
        dirtyRegions,
        channelView: this.channelView,
        focus: this.focusPreview,
      });
      if (this.renderGovernor.record(performance.now() - renderStartedAt, workload)) {
        this.requestRender();
      }
    });
  }

  private commit(entry: HistoryEntry) {
    // Surface creation is relatively rare compared with interactive redraws.
    // Register here instead of in requestRender so a 10K-layer document does
    // not pay an O(layer-count) scan for every brush segment.
    this.bindDocumentMemory(this.doc, entry);
    this.history.commit(entry.label, entry);
    const session = this.sessions.find((candidate) => candidate.id === this.activeSessionId);
    if (session && this.liveSnapshots.size === 0 && !this.liveGlobalLightDocument) {
      session.transientDirty = false;
    }
    this.virtualDirty.invalidateAll();
    this.emit();
  }

  private markTransientDirty() {
    const session = this.sessions.find((candidate) => candidate.id === this.activeSessionId);
    if (!session || session.transientDirty) return;
    session.transientDirty = true;
    this.emit();
  }

  private clearTransientDirtyIfSettled() {
    if (this.liveSnapshots.size > 0 || this.liveGlobalLightDocument || this.selectionGesture) return;
    const session = this.sessions.find((candidate) => candidate.id === this.activeSessionId);
    if (session) session.transientDirty = false;
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
    if (this.doc.selection?.mask) surfaces.push(this.doc.selection.mask);
    let tiles = 0;
    let workingSetBytes = 0;
    for (const surface of surfaces) {
      const grid = new TileGrid(surface.width, surface.height, DEFAULT_TILE_SIZE);
      tiles += grid.totalTiles;
      workingSetBytes += grid.estimatedBytes("rgba8");
    }
    let precisionTiles = 0;
    let precisionBytes = 0;
    let sourceBackedBytes = 0;
    const sourceBuffers = new Set<Uint8Array>();
    let alphaTiles = 0;
    let alphaBytes = 0;
    for (const layer of this.doc.layers) {
      if (!layer.surface) continue;
      const stats = layer.surface.stats();
      precisionTiles += stats.residentTiles;
      precisionBytes += stats.residentBytes;
      const source = layer.surface.store.sourceState()?.base.source.bytes;
      if (source && !sourceBuffers.has(source)) { sourceBuffers.add(source); sourceBackedBytes += source.byteLength; }
    }
    for (const surface of [
      ...this.doc.layers.map((layer) => layer.maskSurface),
      this.doc.selection?.surface,
      ...(this.doc.alphaChannels ?? []).map(channel => channel.surface),
    ]) {
      if (!surface) continue;
      const stats = surface.stats();
      alphaTiles += stats.residentTiles;
      alphaBytes += stats.residentBytes;
    }
    workingSetBytes += precisionBytes;
    workingSetBytes += sourceBackedBytes;
    workingSetBytes += alphaBytes;
    const historyStats = this.history.summary();
    const gpuStats = gpuTextureCacheStats();
    const viewportCache = viewportRenderCacheStats();
    // This is deliberately labelled as a floor: browser canvas backing stores
    // and model/runtime heaps cannot be measured precisely from JavaScript.
    const estimatedResidentBytes = workingSetBytes + historyStats.bytes +
      gpuStats.residentBytes + gpuStats.framebufferBytes + viewportCache.scratchCacheBytes + nativeFontResourceStats().residentBytes;
    const blendPasses = this.doc.layers.reduce((count, layer) => count + (layer.kind === "group" ? 0 : resolvedBlendPasses(layer).length), 0);
    const advancedBlendLayers = this.doc.layers.filter((layer) => !isNeutralBlendIf(resolvedBlendIf(layer)) || resolvedFillOpacity(layer) < 1).length;
    const photoshopMetadata = getPhotoshopDocumentMetadata(this.doc);
    const photoshopContainer = photoshopMetadata?.header.container
      ?? (this.doc.width > 30000 || this.doc.height > 30000 ? "psb" : "psd");
    const photoshopCanExport = this.doc.width > 0 && this.doc.height > 0
      && this.doc.width <= 300000 && this.doc.height <= 300000;
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
      sourceBackedBytes,
      alphaTiles,
      alphaBytes,
      surfaces: surfaces.length,
      workingSetBytes,
      estimatedResidentBytes,
      residentMemoryBudget: this.residentMemoryBudget.stats(),
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
        container: photoshopContainer,
        canExport: photoshopCanExport,
        warnings: photoshopMetadata?.importedIssues.filter((issue) => issue.severity === "warning").length ?? 0,
        preserved: photoshopMetadata?.importedIssues.filter((issue) => issue.severity === "info").length ?? 0,
      },
      proofing: { ...this.doc.proofing },
      previewCache: precisionPreviewCacheStats(),
      viewportCache,
      viewportPerformance: viewportRenderPerformanceStats(),
      adaptivePreview: this.renderGovernor.stats(),
      gpuTextureCache: gpuStats,
      channelView: this.channelView,
      tileBacking: this.tileBacking?.stats() ?? { supported: false, writes: 0, bytesWritten: 0, failures: 0 },
      history: historyStats,
    };
  }

  /**
   * Drop every in-flight live edit.
   *
   * `liveSnapshots` and `liveGlobalLightDocument` are two halves of the same
   * idea — the "before" state of an edit still under the pointer — and they
   * must die together. They did not: liveGlobalLightDocument was cleared in
   * only two places, so an abandoned Global Light drag survived a document
   * switch and was later committed as *another* document's undo baseline.
   * Undo then replaced that document wholesale. Clearing both here, and
   * calling this everywhere either was cleared, makes the pair impossible to
   * separate again.
   */
  private discardLiveEdits() {
    this.cancelSelectionGesture();
    this.cancelStroke();
    this.liveSnapshots.clear();
    this.liveGlobalLightDocument = null;
  }

  /** Cancel unfinished property gestures before leaving their document.
   * Clearing only the baselines leaves preview values permanently outside undo.
   * Reverse insertion order restores the earliest value for overlapping edits.
   */
  private cancelLiveEditsForDocumentChange() {
    this.applySnapshots([...this.liveSnapshots.values()].reverse());
    if (this.liveGlobalLightDocument) {
      const light = this.liveGlobalLightDocument.globalLight;
      this.doc.globalLight = light ? { ...light } : undefined;
    }
    this.discardLiveEdits();
    this.clearTransientDirtyIfSettled();
  }

  undo() {
    if (this.selectionGesture) { this.cancelSelectionGesture(); return; }
    this.cancelStroke();
    const node = this.history.undo();
    if (!node?.value) return;
    this.applyHistoryEntry(node.value, "before");
    this.discardLiveEdits();
    this.requestRender();
    this.emit();
  }
  redo(branchId?: string) {
    this.cancelStroke();
    const node = this.history.redo(branchId);
    if (!node?.value) return;
    this.applyHistoryEntry(node.value, "after");
    this.discardLiveEdits();
    this.requestRender();
    this.emit();
  }

  checkoutHistory(nodeId: string) {
    this.cancelStroke();
    const transition = this.history.checkout(nodeId);
    if (!transition.undo.length && !transition.redo.length) return false;
    for (const node of transition.undo) {
      if (node.value) this.applyHistoryEntry(node.value, "before");
    }
    for (const node of transition.redo) {
      if (node.value) this.applyHistoryEntry(node.value, "after");
    }
    this.discardLiveEdits();
    this.requestRender();
    this.emit();
    return true;
  }

  /**
   * Flattens an alternate history branch into a new, editable layer above the
   * current document. With an active selection only that bounded region is
   * rendered, so this remains practical on very large documents.
   */
  mixHistoryBranch(nodeId: string, opacity = 0.5, blend: BlendMode = "source-over"):
    { layer?: Layer; error?: string } {
    const currentId = this.history.current;
    if (nodeId === currentId) return { error: "Choose a different history version" };
    const bounds = this.doc.selection?.bounds ?? { x: 0, y: 0, w: this.doc.width, h: this.doc.height };
    const width = Math.max(1, Math.ceil(bounds.w));
    const height = Math.max(1, Math.ceil(bounds.h));
    if (exceedsBrowserCanvas(width, height) || width * height > 64 * 1024 * 1024) {
      return { error: "Select a smaller region before mixing this large branch" };
    }
    const originalSize = { width: this.doc.width, height: this.doc.height };
    const applyTransition = (target: string) => {
      const transition = this.history.checkout(target);
      for (const node of transition.undo) if (node.value) this.applyHistoryEntry(node.value, "before");
      for (const node of transition.redo) if (node.value) this.applyHistoryEntry(node.value, "after");
    };
    let branchBitmap: HTMLCanvasElement | null = null;
    let failure: string | null = null;
    try {
      applyTransition(nodeId);
      if (this.doc.width !== originalSize.width || this.doc.height !== originalSize.height) {
        failure = "Versions with different canvas sizes cannot be mixed yet";
      } else {
        branchBitmap = newCanvas(width, height);
        this.renderRevision += 1;
        renderViewport(this.doc, branchBitmap, {
          x: bounds.x,
          y: bounds.y,
          width,
          height,
          zoom: 1,
          outputWidth: width,
          outputHeight: height,
          cssScale: 1,
          devicePixelRatio: 1,
        }, {
          checkerboard: false,
          selectionOverlay: false,
          proofing: false,
          cacheRevision: this.renderRevision,
          hierarchyRevision: this.layerHierarchyRevision,
        });
      }
    } catch (error) {
      failure = error instanceof Error ? error.message : "That branch could not be rendered";
    } finally {
      try {
        applyTransition(currentId);
      } catch (error) {
        // A failed restore is more important than the original render error.
        failure = error instanceof Error ? error.message : "The current version could not be restored";
      }
    }
    if (failure || !branchBitmap) {
      this.requestRender();
      this.emit();
      return { error: failure ?? "That branch could not be mixed" };
    }
    if (this.doc.selection) {
      const context = branchBitmap.getContext("2d")!;
      context.save();
      context.globalCompositeOperation = "destination-in";
      const selection = selectionRegionCanvas(this.doc, {
        x: bounds.x,
        y: bounds.y,
        width: bounds.w,
        height: bounds.h,
      });
      if (selection) context.drawImage(selection, 0, 0);
      context.restore();
    }
    const node = this.history.tree().find((candidate) => candidate.id === nodeId);
    const layer = createRasterLayer(`Branch Mix · ${node?.label ?? "Version"}`, branchBitmap);
    layer.surface = this.surfaceFromCanvas(branchBitmap);
    layer.opacity = Math.max(0, Math.min(1, opacity));
    layer.blend = blend;
    layer.transform = { ...layer.transform, tx: bounds.x, ty: bounds.y };
    this.commitStructural("History branch mixed", () => this.doc.layers.unshift(layer));
    this.checkpointLayerSurface(layer);
    this.requestRender();
    return { layer };
  }

  private applyHistoryEntry(entry: HistoryEntry, side: "before" | "after") {
    const snapshots = side === "before" ? entry.designSnapshotsBefore : entry.designSnapshotsAfter;
    if (snapshots) this.doc.designSnapshots = snapshots.map(snapshot => ({ ...snapshot }));
    const campaignKey=side==="before"?"campaignBefore":"campaignAfter";
    if(campaignKey in entry)this.doc.campaign=entry[campaignKey]?structuredClone(entry[campaignKey]!):undefined;
    const boards=side==="before"?entry.artboardsBefore:entry.artboardsAfter;
    if(boards)this.doc.artboards=boards.map(board=>({...board}));
    const layout=side==="before"?entry.layoutBefore:entry.layoutAfter;
    if(layout){this.doc.width=layout.width;this.doc.height=layout.height;this.resetVirtualGeometry(layout.width,layout.height);}
    const document = side === "before" ? entry.documentBefore : entry.documentAfter;
    if (document) {
      this.doc = cloneDocument(document);
      this.layerHierarchyRevision += 1;
      this.resetVirtualGeometry(document.width, document.height);
    }
    const channels = side === "before" ? entry.channelsBefore : entry.channelsAfter;
    if (channels) this.doc.alphaChannels = channels.map(channel => ({ ...channel, surface: channel.surface.clone() }));
    this.applySnapshots(side === "before" ? entry.before : entry.after);
    const layers = side === "before" ? entry.layersBefore : entry.layersAfter;
    if (layers) {
      this.doc.layers = layers.map(shallowCloneLayer);
      this.layerHierarchyRevision += 1;
    }
    const layerOrder = side === "before" ? entry.layerOrderBefore : entry.layerOrderAfter;
    if (layerOrder) {
      const byId = new Map(this.doc.layers.map((layer) => [layer.id, layer]));
      const reordered = layerOrder.map((id) => byId.get(id)).filter((layer): layer is Layer => Boolean(layer));
      if (reordered.length === this.doc.layers.length) {
        this.doc.layers = reordered;
        this.layerHierarchyRevision += 1;
      }
    }
    const selectionKey = side === "before" ? "selectionBefore" : "selectionAfter";
    if (selectionKey in entry) {
      const selection = entry[selectionKey];
      this.doc.selection = cloneSelection(selection);
    }
    if (entry.selectionTranslation) this.applySelectionTranslation(entry.selectionTranslation, side);
    if (entry.pixelPatches) this.applyPixelPatches(entry.pixelPatches, side);
    if (entry.surfacePatches) this.applySurfacePatches(entry.surfacePatches, side);
    if (entry.maskSurfacePatches) this.applyMaskSurfacePatches(entry.maskSurfacePatches, side);
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
      layer.surface?.store.bindMemoryBudget(this.residentMemoryBudget, `pixels:${layer.id}`);
      layer.maskSurface?.bindMemoryBudget(this.residentMemoryBudget, `mask:${layer.id}`);
      this.checkpointLayerSurface(layer);
    }
  }

  private applyPixelPatches(patches: PixelPatch[], side: "before" | "after") {
    for (const patch of patches) {
      const layer = this.findLayer(patch.layerId);
      if (patch.target === "mask" && layer) {
        const image = patch[side];
        const alpha = new Uint8Array(image.width * image.height);
        for (let pixel = 0; pixel < alpha.length; pixel += 1) alpha[pixel] = image.data[pixel * 4 + 3];
        layerMaskSurface(layer, this.doc.width, this.doc.height, true)!.writeRegion({
          x: patch.x,
          y: patch.y,
          width: image.width,
          height: image.height,
        }, alpha);
        continue;
      }
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
      if (patch.updateBitmap ?? true) this.updateLayerBitmapTile(layer, patch.key);
      this.checkpointLayerSurface(layer);
    }
  }

  private applyMaskSurfacePatches(patches: LayerMaskTilePatch[], side: "before" | "after") {
    for (const patch of patches) {
      const layer = this.findLayer(patch.layerId);
      if (!layer) continue;
      const surface = layerMaskSurface(layer, this.doc.width, this.doc.height, true)!;
      surface.bindMemoryBudget(this.residentMemoryBudget, `mask:${layer.id}`);
      surface.applyPatch({ key: patch.key, before: patch.before, after: patch.after }, side);
    }
  }

  private applySelectionTranslation(patch: SelectionTranslationPatch, side: "before" | "after") {
    const surface = new SparseAlphaSurface(this.doc.width, this.doc.height);
    surface.bindMemoryBudget(this.residentMemoryBudget, "selection");
    if (patch.source) {
      const alpha = new Uint8Array(patch.source.width * patch.source.height);
      for (let pixel = 0; pixel < alpha.length; pixel += 1) alpha[pixel] = patch.source.data[pixel * 4 + 3];
      surface.writeRegion({
        x: patch.sourceX + (side === "after" ? patch.deltaX : 0),
        y: patch.sourceY + (side === "after" ? patch.deltaY : 0),
        width: patch.source.width,
        height: patch.source.height,
      }, alpha);
    }
    this.doc.selection = {
      surface,
      bounds: { ...(side === "before" ? patch.beforeBounds : patch.afterBounds) },
    };
  }

  // --- doc lifecycle ---
  listDocuments() {
    this.saveActiveSession();
    return this.sessions.map((session) => ({
      id: session.id,
      name: session.name,
      active: session.id === this.activeSessionId,
      nativePath: session.nativePath,
      dirty: Boolean(session.actionsDirty) || session.transientDirty || session.history.current !== session.savedHistoryNodeId,
    }));
  }

  activeDocumentState() {
    this.saveActiveSession();
    const session = this.sessions.find((candidate) => candidate.id === this.activeSessionId)!;
    return {
      id: session.id,
      name: session.name,
      nativePath: session.nativePath,
      dirty: Boolean(session.actionsDirty) || session.transientDirty || session.history.current !== session.savedHistoryNodeId,
    };
  }

  dirtyDocuments() {
    this.saveActiveSession();
    return this.sessions.filter((session) => session.actionsDirty || session.transientDirty || session.history.current !== session.savedHistoryNodeId).map((session) => ({
      id: session.id,
      name: session.name,
      nativePath: session.nativePath,
    }));
  }

  markDocumentSaved(id = this.activeSessionId, nativePath?: string) {
    this.saveActiveSession();
    const session = this.sessions.find((candidate) => candidate.id === id);
    if (!session) return false;
    session.savedHistoryNodeId = session.history.current;
    session.actionsDirty = false;
    session.transientDirty = false;
    if (id === this.activeSessionId) this.discardLiveEdits();
    if (nativePath) {
      session.nativePath = nativePath;
      const fileName = nativePath.split(/[\\/]/).at(-1)?.replace(/\.luma$/i, "");
      if (fileName) session.name = fileName;
    }
    this.emit();
    return true;
  }

  setDocumentNativePath(id: string, nativePath?: string) {
    const session = this.sessions.find((candidate) => candidate.id === id);
    if (!session) return false;
    session.nativePath = nativePath;
    this.emit();
    return true;
  }

  /**
   * Restores local-only session metadata after a crash checkpoint is decoded.
   * The native path deliberately lives beside the recovery blob instead of in
   * the portable .luma archive, so sharing a project never leaks its source
   * machine's filesystem layout.
   */
  restoreDocumentSessionState(id: string, state: { nativePath?: string; dirty?: boolean }) {
    const session = this.sessions.find((candidate) => candidate.id === id);
    if (!session) return false;
    session.nativePath = state.nativePath;
    session.transientDirty = state.dirty === true;
    this.emit();
    return true;
  }

  switchDocument(id: string) {
    if (id === this.activeSessionId) return;
    const next = this.sessions.find((session) => session.id === id);
    if (!next) return;
    // An edit still under the pointer belongs to the document being left.
    this.cancelLiveEditsForDocumentChange();
    this.saveActiveSession();
    this.activeSessionId = next.id;
    this.doc = next.doc;
    this.history = next.history;
    this.layerHierarchyRevision += 1;
    this.focusPreview = null;
    this.resetVirtualGeometry(this.doc.width, this.doc.height);
    this.requestRender();
    this.emit();
  }

  closeDocument(id: string) {
    const index = this.sessions.findIndex((session) => session.id === id);
    if (index < 0) return;
    this.layerSelections.delete(id);
    this.smartContentEdits.delete(id);
    const closing = this.sessions[index];
    const wasActive = id === this.activeSessionId;
    // A close request for another tab must never cancel the active stroke or
    // discard its slider/selection transaction. Unknown IDs are true no-ops.
    if (wasActive) this.discardLiveEdits();
    this.sessions.splice(index, 1);
    if (this.tileBacking) {
      for (const layer of closing.doc.layers) {
        void this.tileBacking.deleteSurface(this.surfaceBackingId(layer.id, closing.id)).catch(() => undefined);
      }
    }
    if (this.sessions.length === 0) {
      this.installDocument(createDocument(1600, 1067), "Untitled");
      this.requestRender();
    } else if (wasActive) {
      const next = this.sessions[Math.min(index, this.sessions.length - 1)];
      this.activeSessionId = next.id;
      this.doc = next.doc;
      this.history = next.history;
      this.layerHierarchyRevision += 1;
      this.focusPreview = null;
      this.resetVirtualGeometry(this.doc.width, this.doc.height);
      this.requestRender();
    }
    this.bindDocumentMemory(this.doc);
    this.emit();
  }

  private saveActiveSession() {
    const session = this.sessions.find((candidate) => candidate.id === this.activeSessionId);
    if (!session) return;
    session.doc = this.doc;
    session.history = this.history;
  }

  private createSessionHistory() {
    return newHistory(this.historyBudgetBytes);
  }

  private installDocument(doc: Document, name: string, recoveryId?: string) {
    this.saveActiveSession();
    const current = this.sessions.find(session => session.id === this.activeSessionId);
    const reusable = current && !current.recovered && current.doc.layers.length === 0 && !current.nativePath && !current.transientDirty && !current.actionsDirty
      && current.name === "Untitled" && current.history.current === current.savedHistoryNodeId;
    const occupied = this.sessions.find(session => session.id === recoveryId);
    if (recoveryId !== undefined && (!/^(?:doc-[0-9a-z]{1,10}|legacy)$/.test(recoveryId) || (occupied && !(occupied === current && reusable)))) {
      throw new Error("Recovery document identity is invalid or already open");
    }
    if (recoveryId) reserveId(recoveryId);
    // Roll back unfinished previews in the outgoing document, not just their
    // baselines; otherwise switching back exposes edits with no undo record.
    this.cancelLiveEditsForDocumentChange();
    this.rawSessions.clear();
    this.focusPreview = null;
    this.resetVirtualGeometry(doc.width, doc.height);
    this.ensureDocumentSurfaces(doc);
    this.layerHierarchyRevision += 1;
    this.saveActiveSession();
    if (current && reusable) {
      if (recoveryId) { current.id = recoveryId; current.recovered = true; this.activeSessionId = recoveryId; }
      current.name = name;
      current.doc = doc;
      current.history = this.createSessionHistory();
      current.savedHistoryNodeId = current.history.current;
      current.transientDirty = false;
      current.nativePath = undefined;
      this.doc = doc;
      this.history = current.history;
      this.checkpointDocumentSurfaces(true);
      return;
    }
    const session: DocumentSession = {
      id: recoveryId ?? nextId("doc"),
      recovered: Boolean(recoveryId),
      name,
      doc,
      history: this.createSessionHistory(),
      savedHistoryNodeId: "",
      transientDirty: false,
    };
    session.savedHistoryNodeId = session.history.current;
    this.sessions.push(session);
    this.activeSessionId = session.id;
    this.doc = doc;
    this.history = session.history;
    this.checkpointDocumentSurfaces(true);
  }

  resetDocument(width: number, height: number, name = "Untitled") {
    if (![width, height].every(value => Number.isSafeInteger(value) && value > 0)) throw new Error("Document dimensions must be positive whole pixels");
    const refusal = documentSizeRefusal(width, height, currentEdition());
    if (refusal) throw new Error(refusal);
    const next = createDocument(width, height);
    this.installDocument(next, name.trim() || "Untitled");
    this.history = this.createSessionHistory();
    const session = this.sessions.find((candidate) => candidate.id === this.activeSessionId);
    if (session) {
      session.history = this.history;
      session.savedHistoryNodeId = this.history.current;
      session.transientDirty = false;
    }
    this.requestRender();
    this.emit();
  }

  openImage(name: string, img: HTMLImageElement, source?: SourceProvenance) {
    this.installDocument(createDocument(img.naturalWidth, img.naturalHeight), name);
    return this.addRasterFromImage(name, img, source, { fit: false });
  }

  /** Install a sensor-developed camera RAW without quantizing its float master. */
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
      mode: developed.provenance.mode,
      originalBytes: developed.provenance.originalBytes,
    };
    layer.raw = {
      original: new Uint8Array(original.slice(0)),
      settings: cloneRawSettings(developed.settings),
      decoder: developed.provenance.decoder,
      boundary: developed.provenance.boundary,
      matrixSource: developed.provenance.matrixSource,
      sensor: {
        format: developed.provenance.format,
        bitsPerSample: developed.metadata.bitsPerSample,
        dngVersion: developed.metadata.dngVersion,
        warnings: [...developed.metadata.warnings],
      },
    };
    this.commitStructural(`${name} developed from ${developed.provenance.format}`, () => this.doc.layers.unshift(layer));
    this.checkpointLayerSurface(layer);
    this.requestRender();
    return layer;
  }

  /** Re-run the sensor pipeline from the embedded original DNG and commit one undo step. */
  redevelopRaw(layerId: string, patch: Partial<RawDevelopSettings>) {
    const layer = this.findLayer(layerId);
    if (!layer?.raw || (layer.source?.mode !== "dng-cfa-developed" && layer.source?.mode !== "camera-raw-developed")) return false;
    const before = snapshotLayer(layer);
    let session = this.rawSessions.get(layerId);
    if (!session) {
      const source = layer.raw.original.slice().buffer as ArrayBuffer;
      session = new DngDevelopSession(
        source,
        layer.source.originalName,
        layer.raw.settings,
        layer.raw.sensor.format ?? layer.source.format,
      );
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
    const cropped = this.cropRect(bounds.x, bounds.y, bounds.w, bounds.h, "Crop to selection");
    if (cropped) this.actions.push({ op: "cropSelection" });
    return cropped;
  }

  cropRect(inputX: number, inputY: number, requestedWidth: number, requestedHeight: number, label = "Crop") {
    const x = Math.max(0, Math.floor(inputX));
    const y = Math.max(0, Math.floor(inputY));
    const width = Math.min(this.doc.width - x, Math.max(1, Math.ceil(requestedWidth)));
    const height = Math.min(this.doc.height - y, Math.max(1, Math.ceil(requestedHeight)));
    if (x === 0 && y === 0 && width === this.doc.width && height === this.doc.height) return false;
    const before = cloneDocument(this.doc);
    const croppedChannels = this.doc.alphaChannels?.map(channel => ({ ...channel, surface: channel.surface.cropped(x, y, width, height) }));
    for (const layer of this.doc.layers) {
      layer.transform = { ...layer.transform, tx: layer.transform.tx - x, ty: layer.transform.ty - y };
      if (hasLayerMask(layer)) {
        layer.maskSurface = layerMaskSurface(layer, this.doc.width, this.doc.height)!.cropped(x, y, width, height);
        layer.mask = undefined;
      }
    }
    this.doc.width = width;
    this.doc.height = height;
    this.doc.alphaChannels = croppedChannels;
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

  /** Why a perspective crop cannot run, or null if it can. */
  perspectiveCropRefusal(quad: Quad): string | null {
    if (exceedsBrowserCanvas(this.doc.width, this.doc.height)) return "Perspective crop is not available on a document this large yet.";
    if (!isValidTransformQuad(quad)) return "Place four corners that form a shape without crossing sides.";
    return null;
  }

  perspectiveCrop(quad: Quad) {
    if (this.doc.alphaChannels?.length) throw new Error("Perspective crop cannot yet transform saved alpha channels. Save a copy and remove its saved channels first.");
    if (this.perspectiveCropRefusal(quad)) return null;
    const release = this.reserveOperationMemory(this.serializationMemory(this.doc) * 2 + this.doc.width * this.doc.height * 64);
    const original = this.doc;
    const node = this.history.current;
    try {
    const before = cloneDocument(this.doc);
    const composite = newCanvas(this.doc.width, this.doc.height);
    renderClean(this.doc, composite);
    const source = composite.getContext("2d")!.getImageData(0, 0, composite.width, composite.height);
    const rectified = rectifyQuadrilateral({ width: source.width, height: source.height, data: source.data }, quad);
    const bitmap = newCanvas(rectified.width, rectified.height);
    bitmap.getContext("2d")!.putImageData(new ImageData(Uint8ClampedArray.from(rectified.data), rectified.width, rectified.height), 0, 0);
    const layer = createRasterLayer("Perspective crop", bitmap);
    layer.surface = this.surfaceFromCanvas(bitmap);
    this.doc = { ...original };
    this.doc.width = rectified.width;
    this.doc.height = rectified.height;
    this.doc.layers = [layer];
    this.layerHierarchyRevision += 1;
    this.doc.guides = [];
    this.doc.selection = null;
    this.resetVirtualGeometry(rectified.width, rectified.height);
    const after = cloneDocument(this.doc);
    this.commit({ label: "Perspective crop", before: [], after: [], documentBefore: before, documentAfter: after });
    this.checkpointLayerSurface(layer);
    this.requestRender();
    return layer;
    } catch (error) {
      if (this.history.current === node) {
        this.doc = original;
        this.resetVirtualGeometry(original.width, original.height);
        this.bindDocumentMemory(original);
      }
      throw error;
    } finally { release(); }
  }

  straightenDocument(angleRadians: number) {
    if (this.doc.alphaChannels?.length) throw new Error("Straighten cannot yet rotate saved alpha channels. Save a copy and remove its saved channels first.");
    if (!Number.isFinite(angleRadians) || Math.abs(angleRadians) < 1e-5) return false;
    const before = cloneDocument(this.doc);
    const centerX = this.doc.width / 2;
    const centerY = this.doc.height / 2;
    for (const layer of this.doc.layers) {
      layer.transform = rotateLayerTransformAround(layer.transform, angleRadians, centerX, centerY);
    }
    const after = cloneDocument(this.doc);
    this.commit({ label: "Straighten image", before: [], after: [], documentBefore: before, documentAfter: after });
    this.requestRender();
    return true;
  }

  sampleLayerColor(layerId: string, x: number, y: number, sampleMerged = false) {
    if (sampleMerged) {
      if (x < 0 || y < 0 || x >= this.doc.width || y >= this.doc.height) return null;
      const sample = newCanvas(1, 1);
      renderViewport(this.doc, sample, {
        x: Math.floor(x),
        y: Math.floor(y),
        width: 1,
        height: 1,
        zoom: 1,
        outputWidth: 1,
        outputHeight: 1,
        cssScale: 1,
        devicePixelRatio: 1,
      }, { checkerboard: false, selectionOverlay: false, proofing: false });
      return rgbaToHex(sample.getContext("2d")!.getImageData(0, 0, 1, 1).data);
    }
    const layer = this.findLayer(layerId);
    if (layer?.surface && !layer.bitmap) {
      const local = documentPointToLayer(layer.transform, x, y);
      if (!local || local.x < 0 || local.y < 0 || local.x >= layer.surface.grid.width || local.y >= layer.surface.grid.height) return null;
      const rgba = layer.surface.readPixel(Math.floor(local.x), Math.floor(local.y));
      const rgb = workingToDisplaySrgb([rgba[0], rgba[1], rgba[2]], layer.surface.colorSpace);
      return rgbaToHex(new Uint8ClampedArray([...rgb.map(channel => Math.round(channel * 255)), Math.round(rgba[3] * 255)]));
    }
    if (!layer?.bitmap) return null;
    const local = documentPointToLayer(layer.transform, x, y);
    if (!local || local.x < 0 || local.y < 0 || local.x >= layer.bitmap.width || local.y >= layer.bitmap.height) {
      return null;
    }
    const px = Math.floor(local.x);
    const py = Math.floor(local.y);
    return rgbaToHex(layer.bitmap.getContext("2d")!.getImageData(px, py, 1, 1).data);
  }

  private applyGeneratedFill(layerId: string, generate: () => { width: number; height: number; data: Uint8ClampedArray }, label: string) {
    const layer = this.findLayer(layerId);
    if (layer?.surface?.store.sourceState()) throw new Error("Generated fills are not supported on source-backed layers yet. Use a separate paint layer.");
    if (layer?.lettering3d || layer?.mesh3d) return false;
    if (!layer?.bitmap || layer.locked) return false;
    const inverse = inverseAffineForLayerTransform(layer.transform);
    if (!inverse) return false;
    // Admit document-sized generator/mask scratch before allocating any pixels.
    const release = this.reserveOperationMemory(this.doc.width * this.doc.height * 32);
    try {
    this.editRasterTransaction(layer, label, () => {
    const pixels = generate();
    const generated = newCanvas(pixels.width, pixels.height);
    generated.getContext("2d")!.putImageData(new ImageData(Uint8ClampedArray.from(pixels.data), pixels.width, pixels.height), 0, 0);
    if (this.doc.selection) {
      const context = generated.getContext("2d")!;
      context.globalCompositeOperation = "destination-in";
      const selection = selectionRegionCanvas(this.doc, {
        x: 0,
        y: 0,
        width: generated.width,
        height: generated.height,
      });
      if (selection) context.drawImage(selection, 0, 0);
      context.globalCompositeOperation = "source-over";
    }
    const localGenerated = newCanvas(layer.bitmap!.width, layer.bitmap!.height);
    const localContext = localGenerated.getContext("2d")!;
    localContext.setTransform(inverse.a, inverse.b, inverse.c, inverse.d, inverse.e, inverse.f);
    localContext.drawImage(generated, 0, 0);
    layer.bitmap!.getContext("2d")!.drawImage(localGenerated, 0, 0);
    });
    return true;
    } finally { release(); }
  }

  gradientFill(
    layerId: string,
    start: Point,
    end: Point,
    from: string,
    to: string,
    type: "linear" | "radial" = "linear",
  ) {
    if (exceedsBrowserCanvas(this.doc.width, this.doc.height)) return false;
    return this.applyGeneratedFill(
      layerId,
      () => createGradientPixels(this.doc.width, this.doc.height, start, end, from, to, type),
      `${type === "radial" ? "Radial" : "Linear"} gradient`,
    );
  }

  /**
   * The ceiling refusal shared by every operation that needs a real canvas.
   *
   * Past the browser canvas ceiling a raster layer holds a tile surface and no
   * bitmap, so these operations cannot run. Each used to return a bare falsy
   * value and the callers ignored it, so on a large document the gradient tool,
   * the frame tool and the Layer Style buttons did nothing and said nothing.
   */
  private oversizedDocumentRefusal(operation: string): string | null {
    return exceedsBrowserCanvas(this.doc.width, this.doc.height)
      ? `${operation} is not available on a document this large yet.`
      : null;
  }

  /** Why a gradient cannot be drawn into this layer, or null if it can. */
  gradientFillRefusal(layerId: string): string | null {
    return this.oversizedDocumentRefusal("Gradient fill") ?? this.generatedFillRefusal(layerId);
  }

  /** Why an artboard frame cannot be added, or null if it can. */
  addFrameRefusal(): string | null {
    return this.oversizedDocumentRefusal("Adding a frame");
  }

  /** Why a layer's effects cannot be cleared, or null if they can. */
  clearLayerStyleRefusal(layerId: string): string | null {
    const layer = this.findLayer(layerId);
    if (!layer) return "Select a layer first.";
    return this.oversizedDocumentRefusal("Clearing a layer style");
  }

  /** Why a layer style cannot be rasterized into layers, or null if it can. */
  createLayersFromStyleRefusal(layerId: string): string | null {
    const layer = this.findLayer(layerId);
    if (!layer?.effects?.length) return "This layer has no effects to turn into layers.";
    if (layer.locked) return "Unlock this layer first.";
    return this.oversizedDocumentRefusal("Creating layers from a style");
  }

  /**
   * Why a generated fill cannot be applied to this layer, or null if it can.
   *
   * patternFill returns a single false for a document past the canvas ceiling,
   * a locked layer, a 3D layer and a layer with no bitmap, so the caller had to
   * guess — and guessed "Layer is locked" for all of them, naming a lock that
   * was not there.
   */
  generatedFillRefusal(layerId: string): string | null {
    const layer = this.findLayer(layerId);
    if (!layer) return "Select a layer first.";
    if (exceedsBrowserCanvas(this.doc.width, this.doc.height)) return "Generated fills are not available on a document this large yet.";
    if (layer.lettering3d || layer.mesh3d) return "Flatten this 3D layer before filling it.";
    if (!layer.bitmap) return "Select a raster layer to fill.";
    if (layer.locked) return "Unlock this layer first.";
    if (!inverseAffineForLayerTransform(layer.transform)) return "This layer's transform cannot be inverted.";
    return null;
  }

  patternFill(layerId: string, kind: PatternKind, foreground: string, background: string, scale = 16) {
    if (this.generatedFillRefusal(layerId)) return false;
    return this.applyGeneratedFill(
      layerId,
      () => createPatternPixels(this.doc.width, this.doc.height, kind, foreground, background, scale),
      `${kind} pattern`,
    );
  }

  /** Why a perspective warp cannot run on this layer, or null if it can. */
  perspectiveWarpRefusal(layerId: string, quad: Quad): string | null {
    const layer = this.findLayer(layerId);
    if (!layer) return "Select a layer first.";
    if (layer.lettering3d || layer.mesh3d) return "Flatten this 3D layer before warping it.";
    // The ceiling comes before the bitmap check on purpose: past it a raster
    // layer holds a tile surface and no canvas, so testing the bitmap first
    // answered "needs a raster layer" to someone who had selected exactly that.
    if (exceedsBrowserCanvas(this.doc.width, this.doc.height)) return "Perspective warp is not available on a document this large yet.";
    if (!layer.bitmap) return "Perspective warp needs a raster layer.";
    if (layer.locked) return "Unlock this layer first.";
    if (!isValidTransformQuad(quad)) return "Place four corners that form a shape without crossing sides.";
    return null;
  }

  perspectiveWarpLayer(layerId: string, quad: Quad) {
    const layer = this.findLayer(layerId);
    if (layer?.surface?.store.sourceState()) throw new Error("Perspective warp is not supported on source-backed layers yet. The original layer has not changed.");
    if (this.perspectiveWarpRefusal(layerId, quad)) return false;
    // Already covered by the refusal above; kept so the compiler can narrow.
    if (!layer?.bitmap) return false;
    const release = this.reserveOperationMemory(this.doc.width * this.doc.height * 64);
    try {
    this.editRasterTransaction(layer, "Perspective warp", () => {
    const source = layer.bitmap!.getContext("2d")!.getImageData(0, 0, layer.bitmap!.width, layer.bitmap!.height);
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
    layer.surface = undefined;
    });
    return true;
    } finally { release(); }
  }

  /** Interactive distortion is deliberately bounded and never silently flattens masks/precision data. */
  distortionUnavailableReason(layerId: string): string | null {
    const layer = this.findLayer(layerId);
    if (!layer || layer.kind !== "raster" || !layer.bitmap) return "Select a raster layer for Distort.";
    if (layer.locked) return "Unlock this layer first.";
    if (this.doc.bitDepth !== 8) return "Distort currently supports 8-bit documents only.";
    if (layer.mask || layer.maskSurface || layer.vectorMask || layer.spatial?.enabled || layer.raw) return "Distort requires a raster layer without masks, RAW development or spatial transforms.";
    if (layer.filters?.some(f => f.enabled)) return "Apply or disable smart filters before distorting.";
    if (exceedsBrowserCanvas(this.doc.width, this.doc.height) || this.doc.width * this.doc.height > 8_000_000
      || layer.bitmap.width * layer.bitmap.height > 8_000_000
      || (layer.surface && (layer.surface.grid.width !== layer.bitmap.width || layer.surface.grid.height !== layer.bitmap.height))) {
      return "Interactive Distort is limited to full-resolution raster layers and documents up to 8 MP.";
    }
    return null;
  }

  distortLayer(layerId: string, quad: Quad) {
    if (this.distortionUnavailableReason(layerId)) return false;
    if (!isValidTransformQuad(quad)) return false;
    return this.perspectiveWarpLayer(layerId, quad);
  }

  radialWarpLayer(layerId: string, from: Point, to: Point, radius: number, label = "Radial warp") {
    const layer = this.findLayer(layerId);
    if (layer?.surface?.store.sourceState()) throw new Error("Radial warp is not supported on source-backed layers yet. The original layer has not changed.");
    if (layer?.lettering3d || layer?.mesh3d) return false;
    if (!layer?.bitmap || layer.locked) return false;
    if (![from.x, from.y, to.x, to.y, radius].every(Number.isFinite)) throw new Error("Radial warp requires finite coordinates and radius");
    const dx = to.x - from.x, dy = to.y - from.y;
    if (![dx, dy].every(Number.isFinite)) throw new Error("Radial warp requires a finite displacement");
    if (dx === 0 && dy === 0) return false;
    const bitmap = layer.bitmap, r = Math.max(1, radius);
    const x = Math.max(0, Math.floor(to.x - r)), y = Math.max(0, Math.floor(to.y - r));
    const right = Math.min(bitmap.width, Math.ceil(to.x + r) + 1), bottom = Math.min(bitmap.height, Math.ceil(to.y + r) + 1);
    if (right <= x || bottom <= y) return false;
    const region = { x, y, width: right - x, height: bottom - y };
    // Reverse sampling moves at most dx/dy. Include its complete source range
    // and the bilinear neighbour; the rest of the layer is never copied/edited.
    const sx = Math.max(0, Math.floor(Math.min(x, x - dx)) - 1);
    const sy = Math.max(0, Math.floor(Math.min(y, y - dy)) - 1);
    const sw = Math.min(bitmap.width, Math.ceil(Math.max(right, right - dx)) + 1) - sx;
    const sh = Math.min(bitmap.height, Math.ceil(Math.max(bottom, bottom - dy)) + 1) - sy;
    const release = this.reserveOperationMemory(sw * sh * 12);
    try {
      return this.editRegionTransaction(layer, region, label, ctx => {
        const source = ctx.getImageData(sx, sy, sw, sh);
        const warped = radialWarp(source, { x: from.x - sx, y: from.y - sy }, { x: to.x - sx, y: to.y - sy }, r);
        ctx.putImageData(new ImageData(Uint8ClampedArray.from(warped.data), sw, sh), sx, sy, x - sx, y - sy, region.width, region.height);
      });
    } finally { release(); }
  }

  moveSelectionContent(layerId: string, deltaX: number, deltaY: number, healSource = true) {
    const layer = this.findLayer(layerId);
    if (layer?.surface?.store.sourceState()) throw new Error("Content-aware move is not supported on source-backed layers yet. Use Copy/Paste to move selected pixels on a new layer.");
    if (layer?.lettering3d || layer?.mesh3d) return false;
    const selection = this.doc.selection;
    if (!layer?.bitmap || !selection || layer.locked) return false;
    selectionSurface(this.doc);
    const selectionBefore = cloneSelection(selection);
    const plan = planSelectionContentMove(
      selection.bounds,
      this.doc.width,
      this.doc.height,
      deltaX,
      deltaY,
      healSource,
    );
    const context = layer.bitmap.getContext("2d")!;
    const mutationRegions = plan
      ? selectionMoveMutationRegions(plan.content, deltaX, deltaY, layer.bitmap.width, layer.bitmap.height)
      : [];
    const pixelPatches: PixelPatch[] = mutationRegions.map((region) => {
      const before = context.getImageData(region.x, region.y, region.width, region.height);
      return {
        layerId,
        target: "bitmap",
        x: region.x,
        y: region.y,
        before,
        // Replaced after compositing below. Sharing the bounded before payload
        // avoids a redundant transient allocation while the edit is running.
        after: before,
      };
    });
    const touchedSurfaceKeys = new Set<string>();
    const surfaceBefore = new Map<string, Uint8Array | null>();
    if (layer.surface) {
      for (const region of mutationRegions) {
        for (const tile of layer.surface.grid.tilesIntersecting(region)) touchedSurfaceKeys.add(tile.key);
      }
      for (const key of touchedSurfaceKeys) surfaceBefore.set(key, layer.surface.store.read(key));
    }
    const afterBounds = {
      x: selection.bounds.x + deltaX,
      y: selection.bounds.y + deltaY,
      w: selection.bounds.w,
      h: selection.bounds.h,
    };
    let content: HTMLCanvasElement | null = null;
    if (plan) {
      const scratch = plan.contentScratch;
      content = newCanvas(scratch.width, scratch.height);
      const contentContext = content.getContext("2d")!;
      contentContext.drawImage(
        layer.bitmap,
        scratch.x,
        scratch.y,
        scratch.width,
        scratch.height,
        0,
        0,
        scratch.width,
        scratch.height,
      );
      contentContext.globalCompositeOperation = "destination-in";
      const scratchSelection = selectionRegionCanvas(this.doc, scratch);
      if (scratchSelection) contentContext.drawImage(scratchSelection, 0, 0);
    }

    context.save();
    context.globalCompositeOperation = "destination-out";
    if (plan) {
      const contentSelection = selectionRegionCanvas(this.doc, plan.content);
      if (contentSelection) context.drawImage(contentSelection, plan.content.x, plan.content.y);
    }
    context.restore();
    if (plan?.healWork) {
      const work = plan.healWork;
      const fill = newCanvas(work.width, work.height);
      const fillContext = fill.getContext("2d")!;
      fillContext.filter = `blur(${CONTENT_MOVE_HEAL_BLUR}px)`;
      const sourceWidth = Math.min(this.doc.width, layer.bitmap.width);
      const sourceHeight = Math.min(this.doc.height, layer.bitmap.height);
      if (sourceWidth > 0 && sourceHeight > 0) {
        // Crop at document boundaries before filtering. Pixels outside the
        // document are transparent in the former full-size scratch and must
        // not contribute when an imported bitmap happens to be larger.
        fillContext.drawImage(
          layer.bitmap,
          0,
          0,
          sourceWidth,
          sourceHeight,
          -work.x,
          -work.y,
          sourceWidth,
          sourceHeight,
        );
      }
      fillContext.filter = "none";
      fillContext.globalCompositeOperation = "destination-in";
      const workSelection = selectionRegionCanvas(this.doc, work);
      if (workSelection) fillContext.drawImage(workSelection, 0, 0);
      context.drawImage(
        fill,
        plan.content.x - work.x,
        plan.content.y - work.y,
        plan.content.width,
        plan.content.height,
        plan.content.x,
        plan.content.y,
        plan.content.width,
        plan.content.height,
      );
    }
    if (content && plan) {
      context.drawImage(content, plan.contentScratch.x + deltaX, plan.contentScratch.y + deltaY);
    }
    const movedSurface = selectionSurface(this.doc)!.translated(deltaX, deltaY);
    this.doc.selection = {
      surface: movedSurface,
      bounds: afterBounds,
    };
    bumpBitmapVersion(layer.bitmap);
    if (mutationRegions.length) {
      for (const region of mutationRegions) this.syncLayerSurface(layer, region);
    }
    this.checkpointLayerSurface(layer);
    for (const patch of pixelPatches) {
      patch.after = context.getImageData(patch.x, patch.y, patch.before.width, patch.before.height);
    }
    const surfacePatches = layer.surface && touchedSurfaceKeys.size
      ? [...touchedSurfaceKeys].map((key): SurfaceTilePatch => ({
        layerId,
        key,
        before: surfaceBefore.get(key) ?? null,
        after: layer.surface!.store.read(key),
        updateBitmap: false,
      }))
      : undefined;
    this.commit({
      label: "Content-aware move",
      before: [],
      after: [],
      pixelPatches,
      surfacePatches,
      selectionBefore,
      selectionAfter: cloneSelection(this.doc.selection),
    });
    this.requestRender(plan?.affected);
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
    // Only sizes past the ceiling can be refused — documentSizeRefusal returns
    // null for anything that fits — so shrinking a large document back under it
    // stays possible in every edition. A document opened on the desktop and
    // reopened on the web must not be permanently unresizable.
    const refusal = documentSizeRefusal(width, height, currentEdition());
    if (refusal) throw new Error(refusal);
    const before = cloneDocument(this.doc);
    const sx = width / this.doc.width;
    const sy = height / this.doc.height;
    const resizedChannels = this.doc.alphaChannels?.map(channel => ({ ...channel, surface: channel.surface.resized(width, height) }));
    for (const layer of this.doc.layers) {
      if (layer.bitmap && !layer.lettering3d && !layer.mesh3d && !exceedsBrowserCanvas(width, height)) {
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
      if (layer.bitmap && !layer.lettering3d && !layer.mesh3d && !exceedsBrowserCanvas(width, height)) {
        layer.transform = { ...layer.transform, tx: layer.transform.tx * sx, ty: layer.transform.ty * sy };
      }
      if (hasLayerMask(layer)) {
        layer.maskSurface = layerMaskSurface(layer, this.doc.width, this.doc.height)!.resized(width, height);
        layer.mask = undefined;
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
      const surface = selectionSurface(this.doc)!.resized(width, height);
      const b = this.doc.selection.bounds;
      this.doc.selection = { surface, bounds: { x: b.x * sx, y: b.y * sy, w: b.w * sx, h: b.h * sy } };
    }
    this.doc.guides = this.doc.guides.map((guide) => ({ ...guide, position: guide.position * (guide.orientation === "vertical" ? sx : sy) }));
    this.doc.alphaChannels = resizedChannels;
    this.doc.artboards = this.doc.artboards?.map((artboard) => ({
      ...artboard,
      x: artboard.x * sx,
      y: artboard.y * sy,
      width: artboard.width * sx,
      height: artboard.height * sy,
    }));
    this.doc.layerComps = this.doc.layerComps?.map((comp) => ({
      ...comp,
      layers: comp.layers.map((state) => ({
        ...state,
        transform: {
          ...state.transform,
          tx: state.transform.tx * sx,
          ty: state.transform.ty * sy,
          sx: state.transform.sx * sx,
          sy: state.transform.sy * sy,
        },
      })),
    }));
    this.doc.width = width;
    this.doc.height = height;
    this.resetVirtualGeometry(width, height);
    const after = cloneDocument(this.doc);
    this.commit({ label: "Image resized", before: [], after: [], documentBefore: before, documentAfter: after });
    this.requestRender();
    return true;
  }

  /** Change print-resolution metadata without resampling document pixels. */
  setDocumentResolution(horizontal: number, vertical = horizontal) {
    if (!Number.isFinite(horizontal) || !Number.isFinite(vertical)) return false;
    const x = Math.round(horizontal * 100) / 100;
    const y = Math.round(vertical * 100) / 100;
    if (x < 1 || y < 1 || x > 12000 || y > 12000) return false;
    if (x === this.doc.resolution.x && y === this.doc.resolution.y) return false;
    const before = cloneDocument(this.doc);
    this.doc.resolution = { x, y, unit: "ppi" };
    const after = cloneDocument(this.doc);
    this.commit({
      label: `Resolution: ${x === y ? x : `${x} × ${y}`} ppi`,
      before: [],
      after: [],
      documentBefore: before,
      documentAfter: after,
    });
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

  setChannelView(channel: "rgb" | "red" | "green" | "blue" | "alpha") {
    if (!["rgb", "red", "green", "blue", "alpha"].includes(channel) || channel === this.channelView) return false;
    this.channelView = channel;
    this.requestRender();
    this.emit();
    return true;
  }

  /** Named alpha edits never copy layer pixels or mutate a retained history plane. */
  editAlphaChannel(operation: "save" | "update" | "rename" | "delete" | "invert" | "calculate", options: {
    id?: string; name?: string; otherId?: string;
    mode?: import("./alpha-surface").AlphaCalculation; opacity?: number;
  } = {}) {
    const original = this.doc.alphaChannels;
    const channels = original ?? [];
    const current = channels.find(channel => channel.id === options.id);
    if (operation !== "save" && !current) throw new Error("Select a saved alpha channel first");
    if ((operation === "save" || operation === "calculate") && channels.length >= 64) throw new Error("A document supports at most 64 saved alpha channels");
    const selection = operation === "save" || operation === "update" ? selectionSurface(this.doc) : undefined;
    if ((operation === "save" || operation === "update") && !selection) throw new Error("Create or load a selection first");
    const other = operation === "calculate" ? channels.find(channel => channel.id === options.otherId) : undefined;
    if (operation === "calculate" && !other) throw new Error("Choose both source channels");
    const bytes = channels.reduce((sum, channel) => sum + channel.surface.stats().residentBytes, 0);
    const release = this.reserveOperationMemory(bytes * 4 + (selection?.stats().residentBytes ?? 0) * 3 + 1024 * 1024);
    const node = this.history.current;
    try {
      const before = channels.map(channel => ({ ...channel, surface: channel.surface.clone() }));
      let next = channels.slice();
      let id = current?.id ?? nextId("alpha-channel");
      const name = options.name?.trim().slice(0, 80) || current?.name || `Alpha ${channels.length + 1}`;
      if (operation === "save") next.push({ id, name, surface: selection!.clone() });
      else if (operation === "delete") next = next.filter(channel => channel.id !== id);
      else if (operation === "calculate") {
        id = nextId("alpha-channel");
        next.push({ id, name: options.name?.trim().slice(0, 80) || "Calculated alpha", surface: current!.surface.calculated(other!.surface, options.mode ?? "multiply", options.opacity ?? 1) });
      } else next = next.map(channel => channel.id !== id ? channel : { ...channel, name,
        surface: operation === "invert" ? channel.surface.inverted() : operation === "update" ? selection!.clone() : channel.surface });
      const after = next.map(channel => ({ ...channel, surface: channel.surface.clone() }));
      this.doc.alphaChannels = next;
      this.commit({ label: `${operation[0].toUpperCase()}${operation.slice(1)} alpha channel`, before: [], after: [], channelsBefore: before, channelsAfter: after });
      this.requestRender();
      return id;
    } catch (error) {
      if (this.history.current === node) { this.doc.alphaChannels = original; this.bindDocumentMemory(this.doc); }
      throw error;
    } finally { release(); }
  }

  loadAlphaChannel(id: string, mode: import("./alpha-surface").AlphaCombineMode = "replace") {
    const channel = this.doc.alphaChannels?.find(candidate => candidate.id === id);
    if (!channel) throw new Error("Select a saved alpha channel first");
    const release = this.reserveOperationMemory((channel.surface.stats().residentBytes + (this.doc.selection?.surface?.stats().residentBytes ?? 0)) * 4 + 1024 * 1024);
    try {
      const current = selectionSurface(this.doc) ?? new SparseAlphaSurface(this.doc.width, this.doc.height, { tileSize: channel.surface.tileSize });
      const surface = current.combined(channel.surface, mode);
      this.commitSelection(`Load ${channel.name}`, () => { this.doc.selection = { surface, bounds: surface.bounds() }; });
    } finally { release(); }
  }

  /** Turn a composite channel into editable selection alpha, without a document-sized RGBA buffer. */
  selectCompositeChannel(channel = this.channelView) {
    if (!["rgb", "red", "green", "blue", "alpha"].includes(channel)) throw new Error("Unknown channel");
    // Bounded synchronous campaign: sparse storage does not make an exhaustive
    // composite scan cheap. Refuse before rendering, not halfway through an edit.
    const pixels = this.doc.width * this.doc.height;
    if (pixels > 16_000_000) throw new Error("Composite channel extraction currently supports up to 16 megapixels. Use a local selection or layer mask for larger documents.");
    const release = this.reserveOperationMemory(tiledCleanRenderBytes(this.doc) + pixels * 3);
    try {
      const surface = new SparseAlphaSurface(this.doc.width, this.doc.height);
      for (let row = 0; row < surface.grid.rows; row++) for (let column = 0; column < surface.grid.columns; column++) {
        const tile = surface.grid.address(column, row);
        const canvas = newCanvas(tile.width, tile.height);
        renderViewport(this.doc, canvas, { x: tile.x, y: tile.y, width: tile.width, height: tile.height,
          outputWidth: tile.width, outputHeight: tile.height, zoom: 1, cssScale: 1, devicePixelRatio: 1 },
        { checkerboard: false, selectionOverlay: false, proofing: false, cacheRevision: this.renderRevision, hierarchyRevision: this.layerHierarchyRevision });
        const data = canvas.getContext("2d")!.getImageData(0, 0, tile.width, tile.height).data;
        const alpha = new Uint8Array(tile.width * tile.height);
        const component = channel === "red" ? 0 : channel === "green" ? 1 : 2;
        for (let p = 0; p < alpha.length; p++) {
          const i = p * 4;
          alpha[p] = channel === "alpha" ? data[i + 3] : Math.round((channel === "rgb"
            ? data[i] * .2126 + data[i + 1] * .7152 + data[i + 2] * .0722 : data[i + component]) * data[i + 3] / 255);
        }
        surface.writeTile(tile.key, alpha);
      }
      this.commitSelection(`Select ${channel === "rgb" ? "luminosity" : channel} channel`, () => {
        this.doc.selection = { surface, bounds: surface.bounds() };
      });
    } finally { release(); }
  }

  captureLayerComp(name = "Layer Comp") {
    const before = cloneDocument(this.doc);
    const comp = {
      id: nextId("layer-comp"),
      name: name.trim().slice(0, 80) || `Layer Comp ${(this.doc.layerComps?.length ?? 0) + 1}`,
      createdAt: new Date().toISOString(),
      layers: this.doc.layers.map((layer) => ({
        layerId: layer.id,
        visible: layer.visible,
        opacity: layer.opacity,
        transform: { ...layer.transform },
      })),
    };
    this.doc.layerComps = [...(this.doc.layerComps ?? []), comp].slice(-MAX_LAYER_COMPS);
    const after = cloneDocument(this.doc);
    this.commit({ label: `Capture comp: ${comp.name}`, before: [], after: [], documentBefore: before, documentAfter: after });
    return comp;
  }

  recaptureLayerComp(id: string) {
    const index = this.doc.layerComps?.findIndex((comp) => comp.id === id) ?? -1;
    if (index < 0) return false;
    const before = cloneDocument(this.doc);
    const current = this.doc.layerComps![index];
    this.doc.layerComps![index] = {
      ...current,
      layers: this.doc.layers.map((layer) => ({
        layerId: layer.id,
        visible: layer.visible,
        opacity: layer.opacity,
        transform: { ...layer.transform },
      })),
    };
    const after = cloneDocument(this.doc);
    this.commit({ label: `Update comp: ${current.name}`, before: [], after: [], documentBefore: before, documentAfter: after });
    return true;
  }

  applyLayerComp(id: string) {
    const comp = this.doc.layerComps?.find((candidate) => candidate.id === id);
    if (!comp) return false;
    const states = new Map(comp.layers.map((state) => [state.layerId, state]));
    const affected = this.doc.layers.filter((layer) => states.has(layer.id));
    if (!affected.length) return false;
    const before = affected.map(snapshotLayer);
    for (const layer of affected) {
      const state = states.get(layer.id)!;
      layer.visible = state.visible;
      layer.opacity = Math.max(0, Math.min(1, state.opacity));
      layer.transform = { ...state.transform };
    }
    const after = affected.map(snapshotLayer);
    this.commit({ label: `Apply comp: ${comp.name}`, before, after });
    this.requestRender();
    return true;
  }

  removeLayerComp(id: string) {
    const comps = this.doc.layerComps ?? [];
    const next = comps.filter((comp) => comp.id !== id);
    if (next.length === comps.length) return false;
    const before = cloneDocument(this.doc);
    this.doc.layerComps = next;
    const after = cloneDocument(this.doc);
    this.commit({ label: "Remove layer comp", before: [], after: [], documentBefore: before, documentAfter: after });
    return true;
  }

  /** All campaign mutations share one atomic, document-owned command route. */
  /** UI entry point: never arrange with a temporary fallback face. */
  async executeCampaignReady(action: CampaignAction, signal?: AbortSignal) {
    const owner=this.doc, current=this.guardDocumentOperation("campaign font preparation",undefined,false);
    const frozen=structuredClone(action), textState=JSON.stringify(owner.layers.filter(l=>l.text).map(l=>l.text));
    if(signal?.aborted)throw new Error("Campaign operation cancelled");
    const pending=pendingDocumentFonts(owner);
    if(pending)await new Promise<void>((resolve,reject)=>{
      const finish=(error?:unknown)=>{clearTimeout(timer);signal?.removeEventListener("abort",cancel);if(error)reject(error);else resolve();};
      const cancel=()=>finish(new Error("Campaign operation cancelled"));
      const timer=setTimeout(()=>finish(new Error("Fonts did not finish loading within 15 seconds; no layout was changed")),15000);
      signal?.addEventListener("abort",cancel,{once:true});pending.then(()=>finish(),finish);
    });
    current();
    if(signal?.aborted)throw new Error("Campaign operation cancelled");
    if(this.doc!==owner||textState!==JSON.stringify(owner.layers.filter(l=>l.text).map(l=>l.text)))throw new Error("Document changed while preparing text layout");
    return this.executeCampaign(frozen);
  }

  executeCampaign(action: CampaignAction) {
    if(this.liveSnapshots.size||this.liveGlobalLightDocument||this.activeStroke||this.precisionStroke||this.maskStroke||this.retouchStroke||this.selectionGesture)throw new Error("Finish the current editing gesture before changing campaign designs");
    const original=this.doc;
    if(["flow","reflow","board-resize","sync"].includes(action.kind)){
      const pending=pendingDocumentFonts(original);
      if(pending){void pending.catch(()=>{});throw new Error("Fonts are still loading. Use the font-ready campaign command before arranging text");}
    }
    if(original.layers.length>2048)throw new Error("Campaign commands are bounded to 2,048 layers per document");
    const label=CAMPAIGN_COMMANDS[action.kind]?.label;
    if(!label)throw new Error("Unknown campaign command");
    const release=this.reserveOperationMemory(32*1024*1024);
    const allocated:HTMLCanvasElement[]=[];
    const releases:Array<()=>void>=[];
    let committed=false;
    try {
    // Commands below replace edited metadata; immutable/large assets remain
    // shared. A brand rename must never clone every RAW source or 3D mesh.
    const next:Document={...original,layers:original.layers.map(layer=>({...layer})),artboards:original.artboards?.map(a=>({...a}))??[],campaign:validateCampaign(original.campaign)??emptyCampaign()};
    const preservation=getPhotoshopDocumentMetadata(original);if(preservation)setPhotoshopDocumentMetadata(next,preservation);
    next.layers.forEach((layer,index)=>{const metadata=getPhotoshopLayerMetadata(original.layers[index]);if(metadata)setPhotoshopLayerMetadata(layer,metadata);});
    const kit=next.campaign!;
    const replacesContent=action.kind==="sync"&&action.replaceContent===true;
    const geometry=["format","flow","reflow","board-resize","sync"].includes(action.kind);
    const hasMasks=original.layers.some(l=>l.mask||l.maskSurface||l.vectorMask);
    const fullTransaction=replacesContent||(geometry&&hasMasks);
    const maskBudget={remaining:CAMPAIGN_MASK_BYTES};
    if(geometry&&hasMasks)releases.push(this.reserveOperationMemory(CAMPAIGN_MASK_BYTES*4));
    if(fullTransaction)releases.push(this.reserveOperationMemory(this.serializationMemory(original)*4));
    const components=action.kind==="sync"?linkedComponents(original):[];
    if(replacesContent){
      // Bill each target separately: one enlarged master may feed many tiny
      // copies, so the original document's size alone is not an upper bound.
      let copies=0;
      for(const component of components)copies+=historyEntrySize({label:"Linked copy",before:[],after:[],layersAfter:component.tree.layers});
      if(copies>128*1024*1024)throw new Error("Linked content copies exceed the 128 MiB campaign budget");
      releases.push(this.reserveOperationMemory(copies*3));
    }
    const selected=(ids:string[])=>{if(!ids.length||ids.length>128||new Set(ids).size!==ids.length)throw new Error("Select 1–128 distinct layers");return ids.map(id=>{const l=next.layers.find(l=>l.id===id);if(!l)throw new Error("Selected design layer is missing");return l;});};
    const linkFor=(layerId:string)=>{let link=kit.links.find(l=>l.layerId===layerId);if(!link){link={layerId};kit.links.push(link);}return link;};
    const designSnapshot=(layer:Layer):LayerSnapshot=>({layerId:layer.id,transform:{...layer.transform},visible:layer.visible,opacity:layer.opacity,text:layer.text?structuredClone(layer.text):undefined,shape:layer.shape?{...layer.shape}:undefined,path:layer.path?deepClonePath(layer.path):undefined,spatial:layer.spatial?structuredClone(layer.spatial):undefined});
      switch(action.kind) {
        case "brand-import": {
          const imported=validateCampaign({...emptyCampaign(),colors:action.colors,types:action.types})!;
          kit.colors.push(...imported.colors.map(c=>({...c,id:nextId("brand-color")})));
          kit.types.push(...imported.types.map(t=>({...t,id:nextId("brand-type")})));break;
        }
        case "color-save": {
          let token=kit.colors.find(c=>c.id===action.id);
          if(action.id&&!token)throw new Error("Brand color no longer exists");
          if(!token){token={id:nextId("brand-color"),name:action.name,value:action.value};kit.colors.push(token);}else {token.name=action.name;token.value=action.value;}
          for(const link of kit.links.filter(l=>l.colorId===token!.id)) {
            const layer=next.layers.find(l=>l.id===link.layerId);
            if(layer&&layerColor(layer,link.slot)===link.appliedColor){setLayerColor(layer,token.value,link.slot);link.appliedColor=token.value;}
          }
          break;
        }
        case "color-link": {
          const token=kit.colors.find(c=>c.id===action.id);if(!token)throw new Error("Choose a brand color");
          for(const layer of selected(action.layerIds)){setLayerColor(layer,token.value,action.slot);Object.assign(linkFor(layer.id),{colorId:token.id,slot:action.slot,appliedColor:token.value});}break;
        }
        case "type-save": {
          const layer=next.layers.find(l=>l.id===action.layerId);if(!layer?.text)throw new Error("Select a text layer to capture its style");
          let token=kit.types.find(t=>t.id===action.id);if(action.id&&!token)throw new Error("Text style no longer exists");
          if(!token){token={id:nextId("brand-type"),name:action.name,value:textRecipe(layer.text)};kit.types.push(token);}else {token.name=action.name;token.value=textRecipe(layer.text);}
          for(const link of kit.links.filter(l=>l.typeId===token!.id)) {
            const target=next.layers.find(l=>l.id===link.layerId);
            if(target?.text&&JSON.stringify(textRecipe(target.text))===JSON.stringify(link.appliedType)){target.text={...target.text,...structuredClone(token.value)};link.appliedType=structuredClone(token.value);}
          }break;
        }
        case "type-link": {
          const token=kit.types.find(t=>t.id===action.id);if(!token)throw new Error("Choose a text style");
          for(const layer of selected(action.layerIds)){if(!layer.text)throw new Error("Text styles require text layers");layer.text={...layer.text,...structuredClone(token.value)};Object.assign(linkFor(layer.id),{typeId:token.id,appliedType:structuredClone(token.value)});}break;
        }
        case "unlink": {
          selected(action.layerIds);
          const components=new Set(kit.links.filter(l=>action.layerIds.includes(l.layerId)).map(l=>l.componentId).filter(Boolean));
          kit.links=kit.links.filter(l=>!action.layerIds.includes(l.layerId)&&!components.has(l.componentId));break;
        }
        case "anchors":for(const layer of selected(action.layerIds))Object.assign(linkFor(layer.id),{anchorX:action.x,anchorY:action.y});break;
        case "format": {
          if(!action.formats.length||action.formats.length>6||new Set(action.formats).size!==action.formats.length)throw new Error("Choose 1–6 distinct formats");
          selected(action.layerIds);
          const refusalReason=campaignFormatRefusal(next,action.layerIds);if(refusalReason)throw new Error(refusalReason);
          const tree=componentTree(original,action.layerIds),sources=tree.layers;
          let source=next.artboards!.find(a=>a.id===action.sourceBoardId);
          if(action.sourceBoardId&&!source)throw new Error("Source artboard no longer exists");
          if(!source){source={id:nextId("artboard"),name:"Master",x:0,y:0,width:original.width,height:original.height};next.artboards!.push(source);}
          for(const layer of sources)linkFor(layer.id).boardId=source.id;
          let x=Math.max(next.width,...next.artboards!.map(a=>a.x+a.width))+64;
          const bytes=historyEntrySize({label:"Component copies",before:[],after:[],layersAfter:sources})*2*action.formats.length;
          if(bytes>128*1024*1024)throw new Error("Linked-format raster copies exceed the 128 MiB campaign budget; reduce source images or create fewer formats");
          releases.push(this.reserveOperationMemory(bytes));
          const boards=action.formats.map(formatId=>{
            const preset=CAMPAIGN_FORMATS.find(f=>f.id===formatId);if(!preset)throw new Error("Unknown campaign format");
            const board={id:nextId("artboard"),name:preset.name,x,y:0,width:preset.width,height:preset.height};next.artboards!.push(board);
            x+=board.width+64;next.width=Math.max(next.width,board.x+board.width);next.height=Math.max(next.height,board.height);
            return board;
          });
          if(next.artboards!.length>128||next.width>300000||next.height>300000)throw new Error("Campaign exceeds the artboard or canvas limits");
          const refusal=documentSizeRefusal(next.width,next.height,currentEdition());if(refusal)throw new Error(refusal);
          // Grow existing masks without scaling their document-space coordinates.
          for(const layer of next.layers)mapComponentMasks(layer,original.width,original.height,next.width,next.height,{scale:1,dx:0,dy:0},maskBudget);
          for(const board of boards)for(const root of [...tree.roots].reverse()) {
            const family=componentTree(original,[root.id]).layers;
            const copies=family.map(layer=>cloneComponentLayer(layer,undefined,allocated)),ids=new Map(family.map((layer,i)=>[layer.id,copies[i].id]));
            const rootId=ids.get(root.id)!,mapping=componentMapping(root,source,board,linkFor(root.id));
            copies.forEach((copy,i)=>{
              const layer=family[i];copy.name=`${layer.name} · ${board.name}`;copy.parentId=layer.parentId?ids.get(layer.parentId):undefined;
              copy.transform=mappedTransform(layer.transform,mapping);
              mapComponentMasks(copy,original.width,original.height,next.width,next.height,mapping,maskBudget);
              kit.links.push({...linkFor(layer.id),layerId:copy.id,sourceId:layer.id,boardId:board.id,componentId:rootId});
            });next.layers.unshift(...copies);
          }
          break;
        }
        case "flow": {
          const board=next.artboards!.find(a=>a.id===action.boardId);if(!board)throw new Error("Choose an artboard");
          const layers=selected(action.layerIds);
          const recipe={boardId:action.boardId,layerIds:action.layerIds,direction:action.direction,padding:action.padding,gap:action.gap,wrap:action.wrap,align:action.align};
          kit.layouts=[...(kit.layouts??[]).filter(l=>l.boardId!==board.id),structuredClone(recipe)];
          validateCampaign(kit);applyDesignLayout(next,recipe,maskBudget);
          for(const layer of layers)linkFor(layer.id).boardId=board.id;
          break;
        }
        case "layout-remove":kit.layouts=(kit.layouts??[]).filter(l=>l.boardId!==action.boardId);break;
        case "reflow": {
          const layouts=(kit.layouts??[]).filter(l=>!action.boardId||l.boardId===action.boardId);
          if(!layouts.length)throw new Error("No saved layout to reflow");
          for(const layout of layouts)applyDesignLayout(next,layout,maskBudget);break;
        }
        case "board-resize": {
          const board=next.artboards!.find(a=>a.id===action.boardId);if(!board)throw new Error("Choose an artboard");
          if(![action.width,action.height].every(n=>Number.isSafeInteger(n)&&n>0)||board.x+action.width>next.width||board.y+action.height>next.height)throw new Error("Artboard dimensions must fit inside the document; enlarge the canvas first");
          const from={...board};board.width=action.width;board.height=action.height;
          const boardLinks=kit.links.filter(l=>l.boardId===board.id);
          for(const layer of selectedLayerTree(next.layers,boardLinks.map(l=>l.layerId)).roots){
            const link=boardLinks.find(l=>l.layerId===layer.id)!;
            const mapping=componentMapping(layer,from,board,link);
            for(const member of selectedLayerTree(next.layers,[layer.id]).layers){member.transform=mappedTransform(member.transform,mapping);mapComponentMasks(member,next.width,next.height,next.width,next.height,mapping,maskBudget);}
          }
          for(const layout of kit.layouts??[])if(layout.boardId===board.id)applyDesignLayout(next,layout,maskBudget);
          break;
        }
        case "grid": {
          const board=action.boardId?next.artboards!.find(b=>b.id===action.boardId):{x:0,y:0,width:next.width,height:next.height};
          if(!board)throw new Error("Artboard no longer exists");
          if(![action.columns,action.rows].every(n=>Number.isSafeInteger(n)&&n>=1&&n<=24)||![action.margin,action.gutter].every(n=>Number.isFinite(n)&&n>=0&&n<=10000))throw new Error("Grid requires 1–24 rows/columns and finite nonnegative spacing");
          const guides=(next.guides??[]).map(g=>({...g}));
          for(const [orientation,origin,extent,count] of [["vertical",board.x,board.width,action.columns],["horizontal",board.y,board.height,action.rows]] as const){
            const cell=(extent-2*action.margin-(count-1)*action.gutter)/count;if(cell<=0)throw new Error("Grid margins and gutters exceed the artboard");
            for(let i=0;i<count;i++)for(const offset of [0,cell]){const position=origin+action.margin+i*(cell+action.gutter)+offset;
              if(!guides.some(g=>g.orientation===orientation&&Math.abs(g.position-position)<.01))guides.push({id:nextId("guide"),orientation,position});
            }
          }
          if(guides.length>256)throw new Error("Grid would exceed 256 guides; remove unused guides first");next.guides=guides;break;
        }
        case "sync": {
          for(const component of components) {
            const {link,source,target,tree,targets,members}=component;
            const sourceLink=original.campaign?.links.find(l=>l.layerId===source.id),from=next.artboards!.find(a=>a.id===(action.sourceBoardId??sourceLink?.boardId)),to=next.artboards!.find(a=>a.id===link.boardId);
            if(!from||!to)throw new Error("A linked artboard is missing");
            for(const layer of targets.layers)if(this.isLayerLocked(layer.id))throw new Error(`Unlock ${layer.name} before syncing linked content`);
            const mapping=componentMapping(source,from,to,link);
            if(replacesContent){
              const copies=tree.layers.map(layer=>cloneComponentLayer(layer,original.layers.find(l=>l.id===members.find(m=>m.sourceId===layer.id)?.layerId),allocated));
              const ids=new Map(tree.layers.map((layer,i)=>[layer.id,copies[i].id]));
              const insertion=next.layers.findIndex(l=>l.id===target.id);
              const removed=new Set([...targets.ids,...members.map(m=>m.layerId)]);
              kit.links=kit.links.filter(l=>!removed.has(l.layerId));
              copies.forEach((copy,i)=>{
                const master=tree.layers[i],binding=original.campaign?.links.find(l=>l.layerId===master.id),previous=members.find(l=>l.sourceId===master.id);
                copy.parentId=master.parentId?ids.get(master.parentId):undefined;copy.transform=mappedTransform(master.transform,mapping);
                mapComponentMasks(copy,original.width,original.height,next.width,next.height,mapping,maskBudget);
                kit.links.push({...binding,layerId:copy.id,sourceId:master.id,boardId:to.id,componentId:target.id,anchorX:previous?.anchorX,anchorY:previous?.anchorY});
              });
              next.layers=next.layers.filter(l=>!removed.has(l.id));next.layers.splice(insertion,0,...copies);
              const retained=new Set(copies.map(l=>l.id));kit.layouts=kit.layouts?.map(l=>({...l,layerIds:l.layerIds.filter(id=>!removed.has(id)||retained.has(id))})).filter(l=>l.layerIds.length);
            }else {
              if(tree.layers.length!==members.length||tree.layers.some(l=>!members.some(m=>m.sourceId===l.id)))throw new Error("Component membership changed; enable Replace local content & appearance to synchronize its structure");
              for(const member of members){
              const master=original.layers.find(l=>l.id===member.sourceId),copy=next.layers.find(l=>l.id===member.layerId);
              if(!master||!copy||!tree.ids.has(master.id))throw new Error("Component membership changed; enable Replace local content & appearance to synchronize its structure");
              const before=copy.transform,after=mappedTransform(master.transform,mapping);
              const scale=after.sx/before.sx;
              const a=affineForLayerTransform(before),b=affineForLayerTransform(after);
              if(!Number.isFinite(scale)||scale<=0||(copy.mask||copy.maskSurface||copy.vectorMask)&&["a","b","c","d"].some(key=>Math.abs(b[key as "a"]-a[key as "a"]*scale)>1e-8))throw new Error("Use content replacement to synchronize a locally distorted masked component");
              mapComponentMasks(copy,next.width,next.height,next.width,next.height,{scale,dx:after.tx-before.tx*scale,dy:after.ty-before.ty*scale},maskBudget);
              copy.transform=after;
              if(copy.text&&master.text)copy.text={...copy.text,text:master.text.text,runs:master.text.runs?structuredClone(master.text.runs):undefined,paragraphs:master.text.paragraphs?structuredClone(master.text.paragraphs):undefined};
              }
            }
          }
          for(const layout of kit.layouts??[])applyDesignLayout(next,layout,maskBudget);
          break;
        }
        case "variant-save": {
          if(next.layers.length>1024)throw new Error("Design variants are bounded to 1,024 layers");
          kit.variants.push({id:nextId("variant"),name:action.name,colors:structuredClone(kit.colors),types:structuredClone(kit.types),links:structuredClone(kit.links),layers:next.layers.map(l=>{
            const slot=kit.links.find(link=>link.layerId===l.id)?.slot??"fill",value=layerColor(l,slot);
            return {id:l.id,transform:{...l.transform},visible:l.visible,opacity:l.opacity,color:value&&/^#[\da-f]{6}$/i.test(value)?value:undefined,slot,type:l.text?textRecipe(l.text):undefined,text:l.text?.text,runs:l.text?.runs?structuredClone(l.text.runs):undefined,paragraphs:l.text?.paragraphs?structuredClone(l.text.paragraphs):undefined};
          })});break;
        }
        case "variant-apply": {
          const variant=kit.variants.find(v=>v.id===action.id);if(!variant)throw new Error("Choose a design variant");
          if(variant.layers.some(s=>!next.layers.some(l=>l.id===s.id)))throw new Error("This variant references deleted layers; use history to restore them first");
          // Keep later-created token identities so newer links do not dangle.
          for(const token of variant.colors){const at=kit.colors.findIndex(c=>c.id===token.id);if(at<0)kit.colors.push({...token});else kit.colors[at]={...token};}
          for(const token of variant.types){const at=kit.types.findIndex(c=>c.id===token.id);if(at<0)kit.types.push(structuredClone(token));else kit.types[at]=structuredClone(token);}
          kit.links=[...kit.links.filter(l=>!variant.layers.some(s=>s.id===l.layerId)),...structuredClone(variant.links)];
          for(const saved of variant.layers){const layer=next.layers.find(l=>l.id===saved.id)!;layer.transform={...saved.transform};layer.visible=saved.visible;layer.opacity=saved.opacity;if(saved.color)setLayerColor(layer,saved.color,saved.slot);if(layer.text&&saved.type)layer.text={...layer.text,...structuredClone(saved.type),text:saved.text??layer.text.text,runs:saved.runs?structuredClone(saved.runs):undefined,paragraphs:saved.paragraphs?structuredClone(saved.paragraphs):undefined};}
          break;
        }
        case "variant-delete":if(!kit.variants.some(v=>v.id===action.id))throw new Error("Variant no longer exists");kit.variants=kit.variants.filter(v=>v.id!==action.id);break;
      }
      if(next.layers.length>2048)throw new Error("Campaign exceeds the 2,048-layer limit");
      if(replacesContent)kit.links=kit.links.filter(l=>next.layers.some(layer=>layer.id===l.layerId));
      next.campaign=validateCampaign(kit);
      const before:LayerSnapshot[]=[],after:LayerSnapshot[]=[];
      for(const layer of next.layers){const old=original.layers.find(l=>l.id===layer.id);if(!old)continue;
        if(old.transform===layer.transform&&old.visible===layer.visible&&old.opacity===layer.opacity&&old.text===layer.text&&old.shape===layer.shape&&old.path===layer.path&&old.spatial===layer.spatial)continue;
        const a=designSnapshot(old),b=designSnapshot(layer);if(JSON.stringify(a)!==JSON.stringify(b)){if(this.isLayerLocked(old.id))throw new Error(`Unlock ${old.name} and its parent groups before changing linked designs`);before.push(a);after.push(b);}}
      const structural=next.layers.length!==original.layers.length;
      const resized=next.width!==original.width||next.height!==original.height;
      const entry:HistoryEntry=fullTransaction?{label:replacesContent?"Replace linked content & reflow":label,before:[],after:[],documentBefore:cloneDocument(original),documentAfter:cloneDocument(next)}:{label,before:structural?[]:before,after:structural?[]:after,campaignBefore:original.campaign?structuredClone(original.campaign):null,campaignAfter:structuredClone(next.campaign!),artboardsBefore:structuredClone(original.artboards??[]),artboardsAfter:structuredClone(next.artboards),
        ...(action.kind==="grid"?{guidesBefore:structuredClone(original.guides??[]),guidesAfter:structuredClone(next.guides??[])}:{}),
        ...(structural?{layersBefore:original.layers.map(shallowCloneLayer),layersAfter:next.layers.map(shallowCloneLayer)}:{}),
        ...(resized?{layoutBefore:{width:original.width,height:original.height},layoutAfter:{width:next.width,height:next.height}}:{})};
      if(historyEntrySize(entry)>this.historyBudgetBytes)throw new Error("Campaign edit exceeds the undo budget; reduce the operation size");
      const previousHierarchy=this.layerHierarchyRevision;
      this.doc=next;this.layerHierarchyRevision+=1;
      try{this.commit(entry);committed=true;}catch(error){this.doc=original;this.layerHierarchyRevision=previousHierarchy;this.bindDocumentMemory(original);throw error;}
      if(resized)this.resetVirtualGeometry(next.width,next.height);
      this.requestRender();return next.campaign!;
    } finally {if(!committed)for(const bitmap of allocated){bitmap.width=1;bitmap.height=1;}for(const done of releases)done();release();}
  }

  campaignPreflight() { return campaignPreflight(this.doc); }

  /** Pixel-complete variants use the same admitted codec as Save, not history bookmarks.
   * Archives contain no other archives/history, so captures never grow recursively. */
  async executeDesignSnapshot(action: DesignSnapshotAction, signal?: AbortSignal) {
    const checkGesture = () => {
      if (this.liveSnapshots.size || this.liveGlobalLightDocument || this.activeStroke || this.precisionStroke || this.maskStroke || this.retouchStroke || this.selectionGesture) throw new Error("Finish the current editing gesture before changing variants");
    };
    checkGesture();
    const original = this.doc, assertCurrent = this.guardDocumentOperation("full variant");
    const assertReady = () => { assertCurrent(); checkGesture(); if (signal?.aborted) throw new Error("Variant operation cancelled"); };
    const snapshots = validateDesignSnapshots(original.designSnapshots);
    const label = DESIGN_SNAPSHOT_COMMANDS[action.kind];
    const releases: Array<() => void> = [];
    try {
      let next: Document, entry: HistoryEntry;
      if (action.kind === "capture") {
        if (!action.name.trim() || action.name.length > 80) throw new Error("Variant name must contain 1–80 characters");
        if (snapshots.length >= DESIGN_SNAPSHOT_LIMITS.count) throw new Error("Full variants are limited to six snapshots");
        const source = { ...original, designSnapshots: undefined };
        const metadata = getPhotoshopDocumentMetadata(original);
        if (metadata) setPhotoshopDocumentMetadata(source, metadata);
        const estimated = this.serializationMemory(source);
        if (estimated > DESIGN_SNAPSHOT_LIMITS.bytes) throw new Error("This document exceeds the bounded full-variant capture budget; save a separate .luma project instead");
        releases.push(this.reserveOperationMemory(estimated * 2));
        const { encodeLumaProject } = await import("./project"); assertReady();
        const blob = await encodeLumaProject(source, [], action.name, undefined, {maximumArchiveBytes: DESIGN_SNAPSHOT_LIMITS.bytes-snapshots.reduce((n,snapshot)=>n+snapshot.bytes.byteLength,0)}); assertReady();
        if (snapshots.reduce((n, snapshot) => n + snapshot.bytes.byteLength, blob.size) > DESIGN_SNAPSHOT_LIMITS.bytes) throw new Error("Full variants exceed the 128 MiB archive budget");
        const bytes = new Uint8Array(await blob.arrayBuffer()); assertReady();
        snapshots.push({ id: `variant-${crypto.randomUUID()}`, name: action.name.trim(), bytes });
        next = { ...original, designSnapshots: validateDesignSnapshots(snapshots) };
        if (metadata) setPhotoshopDocumentMetadata(next, metadata);
        entry = { label, before: [], after: [], designSnapshotsBefore: original.designSnapshots ?? [], designSnapshotsAfter: next.designSnapshots };
      } else if (action.kind === "delete") {
        if (!snapshots.some(snapshot => snapshot.id === action.id)) throw new Error("Full variant no longer exists");
        next = { ...original, designSnapshots: snapshots.filter(snapshot => snapshot.id !== action.id) };
        const metadata = getPhotoshopDocumentMetadata(original);
        if (metadata) setPhotoshopDocumentMetadata(next, metadata);
        entry = { label, before: [], after: [], designSnapshotsBefore: snapshots, designSnapshotsAfter: next.designSnapshots };
      } else {
        const snapshot = snapshots.find(snapshot => snapshot.id === action.id);
        if (!snapshot) throw new Error("Full variant no longer exists");
        releases.push(this.reserveOperationMemory(this.serializationMemory(original) * 2));
        const { decodeLumaProject } = await import("./project"); assertReady();
        const decoded = await decodeLumaProject(snapshot.bytes, { restoreHistory: false, admitDecodedBytes: bytes => {
          releases.push(this.reserveOperationMemory(bytes * 3));
          return () => {}; // Keep decoder + undo/redo admission until publication.
        } });
        assertReady();
        if (decoded.doc.designSnapshots?.length) throw new Error("Nested full variants are not supported");
        const refusal = documentSizeRefusal(decoded.doc.width, decoded.doc.height, currentEdition());
        if (refusal) throw new Error(refusal);
        next = decoded.doc;
        next.designSnapshots = snapshots;
        entry = { label, before: [], after: [], documentBefore: cloneDocument(original), documentAfter: cloneDocument(next) };
      }
      assertReady();
      if (historyEntrySize(entry) > this.historyBudgetBytes) throw new Error("Variant exceeds the undo budget; save a separate .luma project instead");
      const hierarchy = this.layerHierarchyRevision;
      this.doc = next; this.layerHierarchyRevision++;
      try { this.commit(entry); } catch (error) { this.doc = original; this.layerHierarchyRevision = hierarchy; this.bindDocumentMemory(original); throw error; }
      if (action.kind === "apply") this.resetVirtualGeometry(next.width, next.height);
      this.requestRender();
    } finally { for (const release of releases) release(); }
  }

  async exportCampaign(signal?: AbortSignal) {
    const assertCurrent=this.guardDocumentOperation("campaign delivery");
    const issues=this.campaignPreflight();if(issues.some(i=>i.severity==="error"))throw new Error(issues.filter(i=>i.severity==="error").map(i=>i.message).join("\n"));
    const boards=this.doc.artboards??[];
    if(boards.length>12)throw new Error("Campaign delivery is bounded to 12 artboards per package");
    const pixels=boards.reduce((n,a)=>n+a.width*a.height,0),largest=Math.max(...boards.map(a=>a.width*a.height));
    const release=this.reserveOperationMemory(pixels*8+largest*48);
    try {
      const {default:JSZip}=await import("jszip");const zip=new JSZip();const files=[];
      for(let i=0;i<boards.length;i++) {
        assertCurrent();if(signal?.aborted)throw new Error("Campaign export cancelled");
        const board=boards[i],filename=`${String(i+1).padStart(2,"0")}-${board.name.replace(/[^a-z0-9_-]/gi,"-").slice(0,60)}.png`;
        const blob=await this.exportArtboard(board.id,"image/png",.92,true);assertCurrent();zip.file(filename,await blob.arrayBuffer());files.push({filename,width:board.width,height:board.height});
      }
      zip.file("delivery.json",JSON.stringify({format:"luma-campaign-delivery",version:1,colorSpace:"srgb",bitDepth:8,files,issues},null,2));
      zip.file("READ-ME.txt","Luma campaign delivery\nPNG artboards are flattened 8-bit sRGB, not editable vectors or certified print PDFs. Keep the .luma master separately.\n\n"+issues.map(i=>`${i.severity.toUpperCase()}: ${i.message}`).join("\n"));
      const result=await zip.generateAsync({type:"blob",compression:"STORE"});assertCurrent();if(signal?.aborted)throw new Error("Campaign export cancelled");return result;
    }finally{release();}
  }

  createArtboard(name = "Artboard", bounds?: PixelRect) {
    const source = bounds ?? { x: 0, y: 0, width: this.doc.width, height: this.doc.height };
    const left = Math.max(0, Math.min(this.doc.width - 1, Math.floor(source.x)));
    const top = Math.max(0, Math.min(this.doc.height - 1, Math.floor(source.y)));
    const right = Math.max(left + 1, Math.min(this.doc.width, Math.ceil(source.x + source.width)));
    const bottom = Math.max(top + 1, Math.min(this.doc.height, Math.ceil(source.y + source.height)));
    const before = cloneDocument(this.doc);
    const artboard = {
      id: nextId("artboard"),
      name: name.trim().slice(0, 80) || `Artboard ${(this.doc.artboards?.length ?? 0) + 1}`,
      x: left,
      y: top,
      width: right - left,
      height: bottom - top,
    };
    this.doc.artboards = [...(this.doc.artboards ?? []), artboard].slice(-MAX_ARTBOARDS);
    const after = cloneDocument(this.doc);
    this.commit({ label: `Create artboard: ${artboard.name}`, before: [], after: [], documentBefore: before, documentAfter: after });
    return artboard;
  }

  removeArtboard(id: string) {
    const artboards = this.doc.artboards ?? [];
    const next = artboards.filter((artboard) => artboard.id !== id);
    if (next.length === artboards.length) return false;
    const before = cloneDocument(this.doc);
    this.doc.artboards = next;
    const after = cloneDocument(this.doc);
    this.commit({ label: "Remove artboard", before: [], after: [], documentBefore: before, documentAfter: after });
    return true;
  }

  async exportArtboard(id: string, type: "image/png" | "image/jpeg" | "image/webp" = "image/png", quality = 0.92, campaignOnly = false) {
    const assertCurrent = this.guardDocumentOperation("artboard export");
    const artboard = this.doc.artboards?.find((candidate) => candidate.id === id);
    if (!artboard) throw new Error("Artboard not found.");
    // Linked objects belong to one format. Do not let neighboring-board overflow
    // contaminate delivery; unassigned document layers remain shared backgrounds.
    const excluded=campaignOnly?new Set(this.doc.campaign?.links.filter(l=>l.boardId&&l.boardId!==id).map(l=>l.layerId)):new Set<string>();
    const renderDoc=excluded.size?{...this.doc,layers:this.doc.layers.filter(l=>!excluded.has(l.id))}:this.doc;
    await this.prepareFontsForExport(renderDoc);
    assertCurrent();
    // An artboard past the canvas ceiling streams band by band, the same way a
    // document does. It used to throw, which meant a large document could hold
    // an artboard that could never be exported out of it.
    if (exceedsBrowserCanvas(artboard.width, artboard.height)) {
      if (type !== "image/png") {
        throw new Error("Artboards past the canvas ceiling export as PNG; JPEG and WebP have no streaming encoder.");
      }
      const { exportTiledPng } = await import("./png-stream");
      assertCurrent();
      return exportTiledPng(renderDoc, {
        assertCurrent,
        region: { x: artboard.x, y: artboard.y, width: artboard.width, height: artboard.height },
      });
    }
    const output = newCanvas(artboard.width, artboard.height);
    try {
    renderViewport(renderDoc, output, {
      x: artboard.x,
      y: artboard.y,
      width: artboard.width,
      height: artboard.height,
      zoom: 1,
      outputWidth: artboard.width,
      outputHeight: artboard.height,
      cssScale: 1,
      devicePixelRatio: 1,
    }, { checkerboard: false, selectionOverlay: false, proofing: false, outputColorSpace: "srgb" });
    const result = await new Promise<Blob>((resolve, reject) => {
      output.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Artboard encoding failed.")), type, quality);
    });
    assertCurrent();
    return result;
    } finally { output.width=1;output.height=1; }
  }

  private surfaceFromCanvas(
    canvas: HTMLCanvasElement,
    format = pixelFormatForDepth(this.doc.bitDepth),
    colorSpace = this.doc.colorSpace,
  ) {
    const surface = new PrecisionTileSurface(canvas.width, canvas.height, format, colorSpace);
    surface.store.bindMemoryBudget(this.residentMemoryBudget, "raster pixels");
    const context = canvas.getContext("2d")!;
    try {
      for (let row = 0; row < surface.grid.rows; row += 1) {
        for (let column = 0; column < surface.grid.columns; column += 1) {
          const tile = surface.grid.address(column, row);
          surface.updateFromImageData(context.getImageData(tile.x, tile.y, tile.width, tile.height), tile.x, tile.y);
        }
      }
    } catch (error) {
      surface.store.unbindMemoryBudget();
      throw error;
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
      layer.surface?.store.bindMemoryBudget(this.residentMemoryBudget, `pixels:${layer.id}`);
      layer.maskSurface?.bindMemoryBudget(this.residentMemoryBudget, `mask:${layer.id}`);
      if (!layer.bitmap) continue;
      if (layer.surface && layer.surface.grid.width === layer.bitmap.width &&
          layer.surface.grid.height === layer.bitmap.height && layer.surface.format === format &&
          layer.surface.colorSpace === doc.colorSpace) continue;
      const surface = new PrecisionTileSurface(layer.bitmap.width, layer.bitmap.height, format, doc.colorSpace);
      surface.store.bindMemoryBudget(this.residentMemoryBudget, `pixels:${layer.id}`);
      const context = layer.bitmap.getContext("2d")!;
      for (let row = 0; row < surface.grid.rows; row += 1) {
        for (let column = 0; column < surface.grid.columns; column += 1) {
          const tile = surface.grid.address(column, row);
          surface.updateFromImageData(context.getImageData(tile.x, tile.y, tile.width, tile.height), tile.x, tile.y);
        }
      }
      layer.surface = surface;
    }
    doc.selection?.surface?.bindMemoryBudget(this.residentMemoryBudget, "selection");
    for (const channel of doc.alphaChannels ?? []) channel.surface.bindMemoryBudget(this.residentMemoryBudget, `channel:${channel.id}`);
  }

  private bindDocumentMemory(doc: Document, pending?: HistoryEntry) {
    // Include every open tab; reconciling against only the active document
    // invalidates still-live accounts belonging to inactive documents.
    const live = new Set<object>();
    const documents = new Set([doc, ...this.sessions.map(session => session.id === this.activeSessionId ? this.doc : session.doc)]);
    for (const document of documents) {
      const history = document === this.doc ? this.history : this.sessions.find(session => session.doc === document)?.history;
      const entries = history?.snapshot().nodes.flatMap(node => node.value ? [node.value] : []) ?? [];
      if (pending && document === doc) entries.push(pending);
      for (const source of this.compressedSources(document, entries)) if (!live.has(source)) {
        this.residentMemoryBudget.register(source, "Photoshop immutable source and decoder reserve", source.byteLength + 96 * 1024 * 1024);
        live.add(source);
      }
      for (const source of this.compressedSources(document, entries, true)) if (!live.has(source)) {
        // Inactive archives need only their bytes, not one Photoshop decoder
        // workspace each. Decode admission is reserved when a variant opens.
        this.residentMemoryBudget.register(source, "Immutable project asset", source.byteLength);
        live.add(source);
      }
      for (const layer of document.layers) {
        if (layer.smartSource) { this.residentMemoryBudget.register(layer.smartSource, `smart-source:${layer.id}`, layer.smartSource.byteLength); live.add(layer.smartSource); }
        if (layer.surface) {
          layer.surface.store.bindMemoryBudget(this.residentMemoryBudget, `pixels:${layer.id}`);
          live.add(layer.surface.store);
        }
        if (layer.maskSurface) {
          layer.maskSurface.bindMemoryBudget(this.residentMemoryBudget, `mask:${layer.id}`);
          live.add(layer.maskSurface);
        }
      }
      if (document.selection?.surface) {
        document.selection.surface.bindMemoryBudget(this.residentMemoryBudget, "selection");
        live.add(document.selection.surface);
      }
      for (const channel of document.alphaChannels ?? []) {
        channel.surface.bindMemoryBudget(this.residentMemoryBudget, `channel:${channel.id}`);
        live.add(channel.surface);
      }
    }
    this.residentMemoryBudget.retainOnly(live);
  }

  private surfaceBackingId(layerId: string, sessionId = this.activeSessionId) {
    return `${sessionId}:${layerId}`;
  }

  private checkpointLayerSurface(layer: Layer, replace = false) {
    if (!this.tileBacking || !layer.surface || layer.surface.store.sourceState()) return;
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

  /**
   * Add an image as a raster layer.
   *
   * `fit` (the default for importing into an existing document) scales the
   * image down to fit and centres it. Without it the image is drawn at 0,0 at
   * native size, which crops anything larger than the canvas and pins smaller
   * images to the top-left corner. `openImage` passes `fit: false` because it
   * has just sized the document to the image, so 1:1 is already exact.
   */
  addRasterFromImage(
    name: string,
    img: HTMLImageElement,
    source?: SourceProvenance,
    { fit = true }: { fit?: boolean } = {},
  ) {
    if (this.doc.width === 0) {
      this.doc.width = img.naturalWidth;
      this.doc.height = img.naturalHeight;
    }
    const tiledDocument = exceedsBrowserCanvas(this.doc.width, this.doc.height);
    const bitmap = newCanvas(
      tiledDocument ? img.naturalWidth : this.doc.width,
      tiledDocument ? img.naturalHeight : this.doc.height,
    );
    const context = bitmap.getContext("2d")!;
    if (fit && !tiledDocument) {
      const rect = fitImageRect(img.naturalWidth, img.naturalHeight, this.doc.width, this.doc.height);
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(img, rect.x, rect.y, rect.width, rect.height);
    } else {
      context.drawImage(img, 0, 0);
    }
    const layer = createRasterLayer(name, bitmap);
    if (fit && tiledDocument) {
      const rect = fitImageRect(img.naturalWidth, img.naturalHeight, this.doc.width, this.doc.height);
      layer.transform = { ...layer.transform, tx: rect.x, ty: rect.y, sx: rect.scale, sy: rect.scale };
    }
    layer.source = source ? { ...source } : undefined;
    layer.surface = this.surfaceFromCanvas(bitmap);
    this.commitStructural(`${name} imported`, () => this.doc.layers.unshift(layer));
    this.checkpointLayerSurface(layer);
    this.requestRender();
    return layer;
  }

  /** A bounded 3D render is a new layer; never rasterize or replace its source. */
  addTextMeshRender(sourceId: string, image: HTMLCanvasElement) {
    const source = this.findLayer(sourceId);
    if (!source?.text || source.kind !== "text") throw new Error("The source text layer is no longer available.");
    if (!image.width || !image.height || image.width > 2048 || image.height > 2048) throw new Error("3D render exceeds the 2048-pixel per-axis image budget.");
    const bitmap = newCanvas(image.width, image.height);
    bitmap.getContext("2d")!.drawImage(image, 0, 0);
    const layer = createRasterLayer(`${source.name} · 3D render`, bitmap);
    const scale = Math.min(1, this.doc.width / image.width, this.doc.height / image.height);
    layer.transform = { ...layer.transform, sx: scale, sy: scale, tx: (this.doc.width - image.width * scale) / 2, ty: (this.doc.height - image.height * scale) / 2 };
    layer.surface = this.surfaceFromCanvas(bitmap);
    this.commitStructural("3D lettering render added", () => this.doc.layers.unshift(layer));
    this.checkpointLayerSurface(layer);
    this.requestRender();
    return layer;
  }

  /** Pixels and editable source are admitted and committed as one transaction. */
  addLetteringObject(sourceId: string, image: HTMLCanvasElement, asset: LetteringAsset) {
    const source = this.findLayer(sourceId);
    if (!source?.text || source.kind !== "text" || source.locked) throw new Error("Select an unlocked source text layer.");
    if (this.doc.layers.length >= 1024) throw new Error("The document has reached its 1024-layer limit.");
    validateLetteringAsset(asset);
    if (JSON.stringify(source.text) !== JSON.stringify(asset.text)) throw new Error("The source text changed before its 3D render was ready.");
    if (image.width !== asset.width || image.height !== asset.height) throw new Error("3D render and source dimensions do not match.");
    const bitmap = cloneCanvas(image);
    const metadata = cloneLetteringAsset(asset);
    const layer = createRasterLayer(`${source.name} · 3D`, bitmap);
    layer.kind = "smart-object";
    layer.lettering3d = metadata;
    layer.visible = source.visible;
    const scale = Math.min(1, this.doc.width / image.width, this.doc.height / image.height);
    layer.transform = { ...layer.transform, sx: scale, sy: scale, tx: (this.doc.width - image.width * scale) / 2, ty: (this.doc.height - image.height * scale) / 2 };
    layer.surface = this.surfaceFromCanvas(bitmap);
    this.commitStructural("Editable 3D lettering added", () => {
      source.visible = false;
      this.doc.layers.splice(this.doc.layers.indexOf(source), 0, layer);
    });
    this.requestRender();
    return layer;
  }

  prepareLetteringEdit(layerId: string): SmartContentTarget {
    const layer = this.findLayer(layerId);
    if (!layer?.lettering3d || layer.kind !== "smart-object" || !layer.bitmap || layer.locked) throw new Error("Select an unlocked 3D lettering object.");
    return { documentId: this.activeSessionId, layerId, revision: this.renderRevision };
  }

  updateLetteringObject(target: SmartContentTarget, image: HTMLCanvasElement, asset: LetteringAsset) {
    if (target.documentId !== this.activeSessionId || target.revision !== this.renderRevision) throw new Error("The document changed. Reopen the 3D editor before applying this edit.");
    this.prepareLetteringEdit(target.layerId);
    validateLetteringAsset(asset);
    if (image.width !== asset.width || image.height !== asset.height) throw new Error("3D render and source dimensions do not match.");
    const layer = this.findLayer(target.layerId)!;
    const metadata = cloneLetteringAsset(asset);
    const bitmap = cloneCanvas(image);
    const before: LayerSnapshot = { layerId: layer.id, bitmap: cloneCanvas(layer.bitmap!), surface: layer.surface?.clone(), lettering3d: cloneLetteringAsset(layer.lettering3d!) };
    const afterBitmap = cloneCanvas(bitmap);
    const surface = this.surfaceFromCanvas(bitmap);
    let after: LayerSnapshot;
    try { after = { layerId: layer.id, bitmap: afterBitmap, surface: surface.clone(), lettering3d: cloneLetteringAsset(metadata) }; }
    catch (error) { surface.store.unbindMemoryBudget(); throw error; }
    layer.bitmap = bitmap; layer.surface = surface; layer.lettering3d = metadata;
    bumpBitmapVersion(bitmap);
    this.commit({ label: "3D lettering edited", before: [before], after: [after] });
    this.requestRender();
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
    this.actions.push({ op: "addCurves" });
    this.requestRender();
    return layer;
  }

  addLevelsLayer(name = "Levels") {
    const layer = createLevelsLayer(name, { ...NEUTRAL_LEVELS });
    this.commitStructural(`${name} added`, () => this.doc.layers.unshift(layer));
    this.actions.push({ op: "addLevels" });
    this.requestRender();
    return layer;
  }

  addHslLayer(name = "HSL") {
    const layer = createHslLayer(name, { ...NEUTRAL_HSL });
    this.commitStructural(`${name} added`, () => this.doc.layers.unshift(layer));
    this.actions.push({ op: "addHsl" });
    this.requestRender();
    return layer;
  }

  addProAdjustmentLayer(
    kind: ProAdjustmentKind,
    params: ProAdjustmentParams = defaultProAdjustment(kind),
  ) {
    const name = PRO_ADJUSTMENT_LABELS[kind];
    const layer = createProAdjustmentLayer(name, params);
    this.commitStructural(`${name} added`, () => this.doc.layers.unshift(layer));
    this.actions.push({ op: "addProAdjustment", kind, params: { ...params } });
    this.requestRender();
    return layer;
  }

  liveUpdateLevels(id: string, levels: LevelsParams) { this.liveAdjustment(id, "levels", levels); }
  updateLevels(id: string, levels: LevelsParams) { this.commitAdjustment(id, "levels", levels); }
  liveUpdateHsl(id: string, hsl: HslParams) { this.liveAdjustment(id, "hsl", hsl); }
  updateHsl(id: string, hsl: HslParams) { this.commitAdjustment(id, "hsl", hsl); }
  liveUpdateProAdjustment(id: string, params: ProAdjustmentParams) { this.liveAdjustment(id, "proAdjustment", params); }
  updateProAdjustment(id: string, params: ProAdjustmentParams) { this.commitAdjustment(id, "proAdjustment", params); }
  updateCurves(id: string, curves: Curves) { this.commitAdjustment(id, "curves", curves); }
  liveUpdateCurves(id: string, curves: Curves) { this.liveAdjustment(id, "curves", curves); }

  addPathLayer(path: PathStyle, name = "Path") {
    validateVectorPath(path);
    const layer = createPathLayer(name.slice(0, 128), deepClonePath(path));
    this.commitStructural("Path added", () => this.doc.layers.unshift(layer));
    this.requestRender();
    return layer;
  }

  addOutlinedText(path: PathStyle, sourceId: string) {
    validateVectorPath(path);
    const source = this.findLayer(sourceId);
    if (!source?.text || source.locked || source.parentId || this.doc.layers.length >= 1024) throw new Error("Cannot create outlines from this layer");
    const layer = createPathLayer(`${source.name} · outlines`, deepClonePath(path));
    layer.transform = { ...source.transform };
    layer.opacity = source.opacity;
    layer.fillOpacity = source.fillOpacity;
    layer.visible = source.visible;
    this.commitStructural("Create text outlines", () => {
      // Replace at the same stack position, preserving all surrounding compositing.
      const index = this.doc.layers.indexOf(source);
      source.visible = false;
      this.doc.layers.splice(index, 0, layer);
    });
    this.requestRender(); return layer;
  }

  updatePath(id: string, path: PathStyle) {
    const layer = this.findLayer(id);
    if (!layer || layer.locked || layer.kind !== "path") return;
    // Existing color shortcuts continue to edit the first matching paint.
    if (path.appearance && layer.path) {
      path = deepClonePath(path);
      for (const kind of ["fill", "stroke"] as const) {
        const paint = path.appearance!.find(p => p.kind === kind);
        if (paint && path[kind] !== layer.path[kind]) paint.color = path[kind];
        if (paint && kind === "stroke" && path.strokeWidth !== layer.path.strokeWidth) paint.width = path.strokeWidth;
      }
    }
    validateVectorPath(path);
    if (path.symbolId !== layer.path?.symbolId) throw new Error("Use the symbol link/detach commands to change instance identity");
    const targets = layer.path?.symbolId ? this.doc.layers.filter(l => l.path?.symbolId === layer.path!.symbolId) : [layer];
    if (targets.length > 256 || targets.some(l => l.locked)) throw new Error("Unlock all linked instances before editing; maximum 256 instances");
    if (vectorPathBytes(path) * targets.length > 16 * 1024 * 1024 || targets.reduce((bytes, target) => bytes + vectorPathBytes(target.path), 0) > 16 * 1024 * 1024) throw new Error("Linked edit exceeds the 16 MiB geometry budget; detach instances or simplify the path");
    const before = targets.map(l => ({ layerId: l.id, path: deepClonePath(l.path!) }));
    for (const target of targets) target.path = deepClonePath(path);
    const after = targets.map(l => ({ layerId: l.id, path: deepClonePath(l.path!) }));
    this.commit({ label: targets.length > 1 ? "Symbol updated" : "Path updated", before, after });
    this.requestRender();
  }

  createVectorInstance(id: string) {
    const source = this.findLayer(id);
    if (!source?.path || source.locked) throw new Error("Select an unlocked path to create a linked instance");
    // Symbol IDs must survive reopening/deleting instances without depending
    // on the process-local layer counter (including IDs retained in undo).
    const symbolId = source.path.symbolId ?? `symbol-${crypto.randomUUID()}`;
    const siblings = this.doc.layers.filter(l => l.path?.symbolId === symbolId);
    if (siblings.length >= 256 || this.doc.layers.length >= 1024) throw new Error("Vector instance limit reached");
    if (vectorPathBytes(source.path) * (source.path.symbolId ? siblings.length + 1 : 2) > 16 * 1024 * 1024) throw new Error("Linked instances exceed the 16 MiB geometry budget");
    const path = deepClonePath({ ...source.path, symbolId });
    validateVectorPath(path);
    const instance = createPathLayer(`${source.name} instance`, deepClonePath(path));
    instance.transform = { ...source.transform, tx: source.transform.tx + 20, ty: source.transform.ty + 20 };
    this.commitStructural("Linked vector instance", () => {
      source.path = path;
      this.doc.layers.unshift(instance);
    });
    this.requestRender();
    return instance;
  }

  detachVectorInstance(id: string) {
    const layer = this.findLayer(id);
    if (!layer?.path?.symbolId || layer.locked) throw new Error("Select an unlocked linked vector instance");
    const before = { layerId: id, path: deepClonePath(layer.path) };
    layer.path = deepClonePath(layer.path);
    delete layer.path.symbolId;
    this.commit({ label: "Detach vector instance", before: [before], after: [{ layerId: id, path: deepClonePath(layer.path) }] });
    this.requestRender();
  }

  liveUpdatePath(id: string, path: PathStyle) {
    const layer = this.findLayer(id);
    if (!layer || layer.locked || layer.kind !== "path") return;
    if (layer.path?.symbolId && this.doc.layers.some(l => l.path?.symbolId === layer.path!.symbolId && l.locked)) return;
    validateVectorPath(path);
    layer.path = deepClonePath(path);
    this.requestRender();
  }

  addBooleanPath(path: PathStyle, sourceIds: string[]) {
    validateVectorPath(path);
    if (!path.booleanSource || sourceIds.length !== 2 || new Set(sourceIds).size !== 2) throw new Error("A boolean result requires two distinct source layers");
    const sources = sourceIds.map(id => this.findLayer(id));
    if (sources.some(layer => !layer || layer.locked || layer.parentId || (!layer.path && !layer.shape))) throw new Error("Select two unlocked, ungrouped vector layers");
    const layer = createPathLayer(`Boolean ${path.booleanSource.operation}`, deepClonePath(path));
    this.commitStructural("Boolean shape", () => {
      sources.forEach(source => { source!.visible = false; });
      this.doc.layers.unshift(layer);
    });
    this.requestRender();
    return layer;
  }

  addOffsetPath(path: PathStyle, sourceId: string) {
    validateVectorPath(path);
    const source = this.findLayer(sourceId);
    if (!source || source.locked || source.parentId || !path.offsetSource || this.doc.layers.length >= 1024) throw new Error("Cannot create offset from this layer");
    const layer = createPathLayer(`${source.name} offset`, deepClonePath(path));
    layer.transform = { ...source.transform };
    layer.opacity = source.opacity;
    layer.fillOpacity = source.fillOpacity;
    this.commitStructural("Offset path", () => { source.visible = false; this.doc.layers.unshift(layer); });
    this.requestRender(); return layer;
  }

  addBlankRaster(name = "Layer") {
    const browserCanvasSafe = fitsBrowserCanvas(this.doc.width, this.doc.height);
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
    layer.surface.store.bindMemoryBudget(this.residentMemoryBudget, `pixels:${layer.id}`);
    this.commitStructural(`${name} added`, () => this.doc.layers.unshift(layer));
    this.actions.push({ op: "addRaster", name });
    this.checkpointLayerSurface(layer);
    this.requestRender();
    return layer;
  }

  duplicateLayer(id: string) {
    return this.duplicateLayers([id])[0] ?? null;
  }

  duplicateLayers(ids: string[]) {
    const tree = selectedLayerTree(this.doc.layers, ids);
    if (!tree.roots.length) return [];
    const action = this.layerBatchAction("duplicate", tree.roots.map(layer => layer.id));
    const source = tree.roots[0];
    const sources = tree.layers;
    const release = this.reserveOperationMemory(sources.reduce((total, layer) => total + (layer.bitmap ? layer.bitmap.width * layer.bitmap.height * 8 : 0) + (layer.mask ? layer.mask.width * layer.mask.height * 8 : 0) + (layer.surface?.store.stats().residentBytes ?? 0) * 2 + (layer.maskSurface?.stats().residentBytes ?? 0) * 2, 0));
    const duplicates: Layer[] = [];
    try {
    const idMap = new Map(sources.map((layer) => [layer.id, nextId("layer")]));
    for (const original of sources) {
      const copy = shallowCloneLayer(original);
      copy.id = idMap.get(original.id)!;
      // Own only newly allocated resources, including during partial failure.
      copy.bitmap = undefined; copy.mask = undefined;
      copy.surface = undefined; copy.maskSurface = undefined;
      duplicates.push(copy);
      copy.name = tree.roots.includes(original) ? `${original.name} copy` : original.name;
      copy.parentId = original.parentId && idMap.has(original.parentId)
        ? idMap.get(original.parentId)
        : original.parentId;
      copy.bitmap = original.bitmap ? cloneCanvas(original.bitmap) : undefined;
      copy.mask = original.mask ? cloneCanvas(original.mask) : undefined;
      copy.surface = original.surface?.clone();
      copy.maskSurface = original.maskSurface?.clone();
      copy.filters = copy.filters?.map((filter) => ({ ...filter, id: nextId("filter") }));
      copy.effects = copy.effects?.map((effect) => ({ ...effect, id: nextId("effect") }));
      copy.blendStack = copy.blendStack?.map((pass) => ({ ...pass, id: nextId("pass") }));
      copy.surface?.store.bindMemoryBudget(this.residentMemoryBudget, `pixels:${copy.id}`);
      copy.maskSurface?.bindMemoryBudget(this.residentMemoryBudget, `mask:${copy.id}`);
    }
    this.commitStructural(tree.roots.length > 1 ? "Layers duplicated" : source.kind === "group" ? "Layer group duplicated" : "Layer duplicated", () => {
      const insertions = new Map(tree.roots.map(root => {
        const subtree = selectedLayerTree(sources, [root.id]);
        return [root.id, duplicates.filter((_, index) => subtree.ids.has(sources[index].id))];
      }));
      this.doc.layers = this.doc.layers.flatMap(layer => [...(insertions.get(layer.id) ?? []), layer]);
    });
    if (tree.roots.length === 1) this.actions.push({ op: "duplicateActive" });
    else this.actions.push(action);
    for (const copy of duplicates) this.checkpointLayerSurface(copy);
    this.requestRender();
    return tree.roots.map(root => duplicates[sources.indexOf(root)]);
    } finally {
      for (const copy of duplicates) if (!this.doc.layers.includes(copy)) {
        if (copy.bitmap) { copy.bitmap.width = 1; copy.bitmap.height = 1; }
        if (copy.mask) { copy.mask.width = 1; copy.mask.height = 1; }
        copy.surface?.store.unbindMemoryBudget();
        copy.maskSurface?.unbindMemoryBudget();
      }
      release();
    }
  }

  layerBatchReason(ids: string[], operation: "group" | "merge" | "delete" | "ungroup") {
    const tree = selectedLayerTree(this.doc.layers, ids);
    if (!tree.roots.length) return "Select layers first";
    if (tree.layers.some(layer => {
      const seen = new Set<string>();
      let current: Layer | undefined = layer;
      while (current && !seen.has(current.id)) {
        if (current.locked) return true;
        seen.add(current.id); current = current.parentId ? this.findLayer(current.parentId) : undefined;
      }
      return false;
    })) return "Unlock the selected layers and their groups first";
    if ((operation === "group" || operation === "merge") && tree.roots.some(layer => layer.parentId !== tree.roots[0].parentId)) return "Choose layers in the same group";
    if (operation === "ungroup" && tree.roots.some(layer => layer.kind !== "group" || layer.opacity !== 1 || !layer.visible || layer.mask || layer.maskSurface || layer.effects?.length || layer.filters?.length || layer.clipping || resolvedFillOpacity(layer) !== 1 || resolvedBlendPasses(layer).some(pass => pass.mode !== "source-over" || pass.opacity !== 1) || !isNeutralBlendIf(resolvedBlendIf(layer)))) return "Select unmodified, visible groups to ungroup without changing their appearance";
    if (operation === "merge") {
      if (tree.layers.length < 2) return "Select at least two layers or a group";
      if (tree.layers.some(layer => !layer.visible)) return "Show the selected layers and group contents before merging";
      if (this.doc.bitDepth !== 8 || this.doc.colorSpace !== "srgb") return "Merge currently requires an 8-bit sRGB document";
      if (exceedsBrowserCanvas(this.doc.width, this.doc.height)) return "This document exceeds the safe bitmap merge size";
      const siblings = this.doc.layers.filter(layer => layer.parentId === tree.roots[0].parentId);
      const indexes = tree.roots.map(layer => siblings.indexOf(layer));
      if (Math.max(...indexes) - Math.min(...indexes) + 1 !== tree.roots.length) return "Select consecutive sibling layers to preserve stacking";
      if (siblings[Math.min(...indexes) - 1]?.clipping) return "Include the clipping layer above this selection before merging";
      let parent = tree.roots[0].parentId;
      const seen = new Set<string>();
      while (parent && !seen.has(parent)) {
        seen.add(parent); const group = this.findLayer(parent);
        if (group && group.opacity !== 1) return "Merge the parent group instead to preserve its opacity";
        parent = group?.parentId;
      }
      if (tree.layers.some(layer => layer.kind.startsWith("adjustment-") || layer.clipping || resolvedBlendPasses(layer).some(pass => pass.mode !== "source-over") || !isNeutralBlendIf(resolvedBlendIf(layer)) || layer.effects?.length)) return "Merge normal, unclipped layers without backdrop-dependent effects; other layers must remain editable";
    }
    return null;
  }

  groupLayers(ids: string[]) {
    const reason = this.layerBatchReason(ids, "group"); if (reason) throw new Error(reason);
    const tree = selectedLayerTree(this.doc.layers, ids);
    const action = this.layerBatchAction("group", tree.roots.map(layer => layer.id));
    const group = createGroupLayer("Group"); group.parentId = tree.roots[0].parentId;
    const index = this.doc.layers.indexOf(tree.layers[0]);
    this.commitStructural("Layers grouped", () => {
      for (const root of tree.roots) root.parentId = group.id;
      this.doc.layers = this.doc.layers.filter(layer => !tree.ids.has(layer.id));
      this.doc.layers.splice(index, 0, group, ...tree.layers);
    });
    this.actions.push(action);
    this.requestRender(); return group;
  }

  ungroupLayers(ids: string[]) {
    const reason = this.layerBatchReason(ids, "ungroup"); if (reason) throw new Error(reason);
    const tree = selectedLayerTree(this.doc.layers, ids);
    const action = this.layerBatchAction("ungroup", tree.roots.map(layer => layer.id));
    const groups = new Map(tree.roots.map(layer => [layer.id, layer]));
    this.commitStructural("Layers ungrouped", () => {
      for (const layer of this.doc.layers) if (layer.parentId && groups.has(layer.parentId)) layer.parentId = groups.get(layer.parentId)!.parentId;
      this.doc.layers = this.doc.layers.filter(layer => !groups.has(layer.id));
    });
    this.actions.push(action);
    this.requestRender();
    return tree.layers.filter(layer => !groups.has(layer.id)).map(layer => layer.id);
  }

  removeLayers(ids: string[]) {
    const reason = this.layerBatchReason(ids, "delete"); if (reason) throw new Error(reason);
    const tree = selectedLayerTree(this.doc.layers, ids);
    const action = this.layerBatchAction("delete", tree.roots.map(layer => layer.id));
    this.commitStructural("Layers deleted", () => { this.doc.layers = this.doc.layers.filter(layer => !tree.ids.has(layer.id)); });
    this.actions.push(action);
    if (this.tileBacking) for (const id of tree.ids) void this.tileBacking.deleteSurface(this.surfaceBackingId(id)).catch(() => undefined);
    this.requestRender();
  }

  setLayersFlag(ids: string[], key: "visible" | "locked", value: boolean) {
    const layers = this.doc.layers.filter(layer => ids.includes(layer.id));
    if (!layers.length) return;
    const action = this.layerBatchAction(key, ids, value);
    this.commitStructural(value ? `${key === "visible" ? "Show" : "Lock"} layers` : `${key === "visible" ? "Hide" : "Unlock"} layers`, () => {
      for (const layer of layers) layer[key] = value;
    });
    this.actions.push(action);
    this.requestRender();
  }

  mergeLayers(ids: string[]) {
    const reason = this.layerBatchReason(ids, "merge"); if (reason) throw new Error(reason);
    const tree = selectedLayerTree(this.doc.layers, ids);
    const action = this.layerBatchAction("merge", tree.roots.map(layer => layer.id));
    const roots = new Set(tree.roots.map(layer => layer.id));
    const mergeDocument = { ...this.doc, selection: null, layers: tree.layers.map(layer => roots.has(layer.id) ? { ...layer, parentId: undefined } : layer) };
    const release = this.reserveOperationMemory(tiledCleanRenderBytes(mergeDocument));
    let bitmap: HTMLCanvasElement | undefined;
    try {
      bitmap = newCanvas(this.doc.width, this.doc.height);
      renderTiledClean(mergeDocument, bitmap);
      const merged = createRasterLayer(`${tree.roots[0].name} merged`, bitmap);
      merged.parentId = tree.roots[0].parentId;
      const index = this.doc.layers.indexOf(tree.layers[0]);
      this.commitStructural("Layers merged", () => {
        this.doc.layers = this.doc.layers.filter(layer => !tree.ids.has(layer.id));
        this.doc.layers.splice(index, 0, merged);
      });
      bitmap = undefined;
      this.actions.push(action);
      this.requestRender(); return merged;
    } finally { if (bitmap) { bitmap.width = 1; bitmap.height = 1; } release(); }
  }

  groupLayer(id: string) {
    const layer = this.findLayer(id);
    if (!layer || layer.kind === "group" || this.layerBatchReason([id], "group")) return null;
    const group = this.actions.withoutRecording(() => this.groupLayers([id]));
    this.actions.push({ op: "groupActive" });
    this.requestRender();
    return group;
  }

  private layerBatchAction(operation: Extract<ActionStep, { op: "layerBatch" }>["operation"], ids: string[], value?: boolean): ActionStep {
    // Stable stack positions, not document-specific UUIDs. Replay checks kinds
    // before editing; applying to a different layer structure fails explicitly.
    const selected = new Set(ids);
    return { op: "layerBatch", operation, targets: this.doc.layers.flatMap((layer, index) => selected.has(layer.id) ? [{ index, kind: layer.kind }] : []), ...(value === undefined ? {} : { value }) };
  }

  ungroupLayer(groupId: string) {
    const group = this.findLayer(groupId);
    if (!group || group.kind !== "group" || this.layerBatchReason([groupId], "ungroup")) return;
    this.ungroupLayers([groupId]);
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
    this.actions.push({ op: "addSmartFilter", kind, params: { ...params } });
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

  private mutateSmartFilter(
    layerId: string,
    filterId: string,
    patch: Partial<Pick<SmartFilter, "enabled" | "opacity" | "params">>,
  ) {
    const layer = this.findLayer(layerId);
    const filter = layer?.filters?.find((candidate) => candidate.id === filterId);
    if (!layer || !filter || layer.locked) return false;
    if (typeof patch.enabled === "boolean") filter.enabled = patch.enabled;
    if (patch.opacity !== undefined && Number.isFinite(patch.opacity)) {
      filter.opacity = Math.max(0, Math.min(1, patch.opacity));
    }
    if (patch.params) {
      filter.params = Object.fromEntries(Object.entries({ ...filter.params, ...patch.params })
        .filter(([, value]) => Number.isFinite(value)));
    }
    return true;
  }

  liveUpdateSmartFilter(
    layerId: string,
    filterId: string,
    patch: Partial<Pick<SmartFilter, "enabled" | "opacity" | "params">>,
  ) {
    const layer = this.findLayer(layerId);
    if (!layer?.filters || layer.locked) return false;
    const key = `smart-filter:${layerId}:${filterId}`;
    if (!this.liveSnapshots.has(key)) {
      this.liveSnapshots.set(key, { layerId, filters: cloneFilters(layer.filters) });
    }
    const changed = this.mutateSmartFilter(layerId, filterId, patch);
    if (changed) {
      this.markTransientDirty();
      this.requestRender();
    }
    return changed;
  }

  updateSmartFilter(
    layerId: string,
    filterId: string,
    patch: Partial<Pick<SmartFilter, "enabled" | "opacity" | "params">>,
  ) {
    const layer = this.findLayer(layerId);
    if (!layer?.filters || layer.locked) return false;
    const key = `smart-filter:${layerId}:${filterId}`;
    const before = this.liveSnapshots.get(key) ?? { layerId, filters: cloneFilters(layer.filters) };
    this.liveSnapshots.delete(key);
    if (!this.mutateSmartFilter(layerId, filterId, patch)) return false;
    const after: LayerSnapshot = { layerId, filters: cloneFilters(layer.filters) };
    if (JSON.stringify(before.filters ?? []) === JSON.stringify(after.filters ?? [])) {
      this.clearTransientDirtyIfSettled();
      this.requestRender();
      this.emit();
      return true;
    }
    this.commit({ label: "Smart filter updated", before: [before], after: [after] });
    this.requestRender();
    return true;
  }

  moveSmartFilter(layerId: string, filterId: string, direction: -1 | 1) {
    const layer = this.findLayer(layerId);
    if (!layer?.filters || layer.locked) return false;
    const index = layer.filters.findIndex((filter) => filter.id === filterId);
    const destination = index + direction;
    if (index < 0 || destination < 0 || destination >= layer.filters.length) return false;
    const before: LayerSnapshot = { layerId, filters: cloneFilters(layer.filters) };
    const filters = [...layer.filters];
    const [filter] = filters.splice(index, 1);
    filters.splice(destination, 0, filter);
    layer.filters = filters;
    this.commit({
      label: "Smart filter reordered",
      before: [before],
      after: [{ layerId, filters: cloneFilters(filters) }],
    });
    this.requestRender();
    return true;
  }

  convertToSmartObject(layerId: string) {
    const layer = this.findLayer(layerId);
    if (!layer || layer.kind !== "raster" || !layer.bitmap || layer.locked) return;
    const before = this.doc.layers.map(shallowCloneLayer);
    layer.kind = "smart-object";
    layer.name = `${layer.name} · Smart`;
    const after = this.doc.layers.map(shallowCloneLayer);
    this.commit({ label: "Converted to Smart Object", before: [], after: [], layersBefore: before, layersAfter: after });
    this.actions.push({ op: "convertSmartObject" });
    this.requestRender();
  }

  /** Capture the destination before an asynchronous file picker/decoder. */
  prepareSmartContentReplacement(layerId: string, mode: "replace" | "edit" = "replace"): SmartContentTarget {
    const reason = smartContentUnavailableReason(this.doc, this.findLayer(layerId), mode);
    if (reason) throw new Error(reason);
    return { documentId: this.activeSessionId, layerId, revision: this.renderRevision };
  }

  replaceSmartContent(target: SmartContentTarget, source: HTMLCanvasElement, embeddedProject?: Uint8Array) {
    if (target.documentId !== this.activeSessionId || target.revision !== this.renderRevision) {
      throw new Error("The document changed while choosing contents. Select the intended layer and try again.");
    }
    const layer = this.findLayer(target.layerId);
    const reason = smartContentUnavailableReason(this.doc, layer, embeddedProject ? "edit" : "replace");
    if (reason) throw new Error(reason);
    assertSmartContentDimensions(source.width, source.height);
    if (embeddedProject && embeddedProject.byteLength > 32 * 1024 * 1024) throw new Error("Embedded Smart Object source exceeds 32 MiB");
    const bitmap = layer!.bitmap!;
    assertSmartContentDimensions(bitmap.width, bitmap.height);
    const release = this.reserveOperationMemory((bitmap.width * bitmap.height * 40) + source.width * source.height * 4 + (embeddedProject?.byteLength ?? 0) * 2);
    const previousSurface = layer!.surface;
    const previousSource = layer!.smartSource;
    const historyNode = this.history.current;
    try {
    // Keep source bounds, masks, filters, layer effects and transform intact.
    // Contain the replacement (no crop or stretching) within the old bounds.
    const replacement = newCanvas(bitmap.width, bitmap.height);
    const ctx = replacement.getContext("2d")!;
    const scale = Math.min(bitmap.width / source.width, bitmap.height / source.height);
    const width = source.width * scale, height = source.height * scale;
    ctx.drawImage(source, (bitmap.width - width) / 2, (bitmap.height - height) / 2, width, height);
    const before: LayerSnapshot = { layerId: layer!.id, bitmap: cloneCanvas(bitmap), surface: layer!.surface?.clone(), smartSource: previousSource ?? null };
    const afterBitmap = cloneCanvas(replacement);
    // Reserve the tiled pixels and prepare history before touching the layer.
    const surface = this.surfaceFromCanvas(replacement);
    let after: LayerSnapshot;
    try { after = { layerId: layer!.id, bitmap: afterBitmap, surface: surface.clone(), smartSource: embeddedProject?.slice() ?? null }; }
    catch (error) { surface.store.unbindMemoryBudget(); throw error; }
    layer!.bitmap = replacement;
    layer!.surface = surface;
    layer!.smartSource = after.smartSource ?? undefined;
    bumpBitmapVersion(replacement);
    try {
      this.commit({ label: "Smart Object contents replaced", before: [before], after: [after] });
    } catch (error) {
      if (this.history.current === historyNode) {
        layer!.bitmap = bitmap;
        layer!.surface = previousSurface;
        layer!.smartSource = previousSource;
        surface.store.unbindMemoryBudget();
        this.bindDocumentMemory(this.doc);
        throw error;
      }
    }
    this.requestRender();
    } finally { release(); }
  }

  canApplySmartContents() { return this.smartContentEdits.has(this.activeSessionId); }

  async editSmartContents(layerId: string) {
    const target = this.prepareSmartContentReplacement(layerId, "edit");
    const layer = this.findLayer(layerId)!;
    const assertCurrent = this.guardDocumentOperation("open Smart Object contents");
    const node = this.history.current;
    for (const [id, edit] of this.smartContentEdits) {
      if (edit.parentId === target.documentId && edit.layerId === layerId && this.sessions.some(session => session.id === id)) {
        if (edit.node !== node || edit.bitmap !== layer.bitmap) throw new Error("An older contents tab is still open. Save or close it, then reopen this Smart Object's contents.");
        this.switchDocument(id); return id;
      }
    }
    let contents: Document;
    if (layer.smartSource) {
      const { decodeLumaProject } = await import("./project");
      const project = await decodeLumaProject(layer.smartSource, { restoreHistory: false, admitDecodedBytes: bytes => this.reserveOperationMemory(bytes) });
      assertCurrent(); contents = project.doc;
      assertSmartContentDimensions(contents.width, contents.height);
      if (contents.bitDepth !== 8 || contents.colorSpace !== "srgb") throw new Error("Native Smart Object contents currently require RGB8 sRGB");
    } else if (embeddedPhotoshopSource(this.doc, layer)?.data) {
      const source = embeddedPhotoshopSource(this.doc, layer)!.data!;
      const { inspectPhotoshopHeader, estimatePhotoshopDecodeBytes } = await import("./input-limits");
      assertCurrent();
      const header = inspectPhotoshopHeader(source);
      if (header.layers > 128) throw new Error("Embedded Photoshop contents are limited to 128 layers");
      const release = this.reserveOperationMemory(estimatePhotoshopDecodeBytes(header, source.byteLength));
      try {
        const { importPsd } = await import("./psd"); assertCurrent();
        contents = await importPsd(source.slice().buffer as ArrayBuffer, { mode: "layered", sourceBacked: false });
        assertCurrent();
        if (contents.layers.some(child => child.kind === "smart-object") || contents.colorSpace !== "srgb") throw new Error("Nested Smart Objects and non-sRGB contents remain preservation-only");
        if (getPhotoshopDocumentMetadata(contents)?.rawImageResources.some(resource => resource.id === 1039)) throw new Error("Profiled embedded Photoshop contents remain preservation-only until source-profile conversion is available");
      } finally { release(); }
    } else {
      const release = this.reserveOperationMemory(layer.bitmap!.width * layer.bitmap!.height * 24);
      try {
        contents = createDocument(layer.bitmap!.width, layer.bitmap!.height);
        const raster = createRasterLayer("Contents", cloneCanvas(layer.bitmap!));
        raster.surface = this.surfaceFromCanvas(raster.bitmap!); contents.layers = [raster];
      } finally { release(); }
    }
    assertCurrent();
    this.installDocument(contents, `${layer.name} · Contents`);
    const id = this.activeSessionId;
    this.smartContentEdits.set(id, { parentId: target.documentId, layerId, node, bitmap: layer.bitmap! });
    this.emit(); return id;
  }

  async applySmartContents() {
    const childId = this.activeSessionId, edit = this.smartContentEdits.get(childId);
    if (!edit) throw new Error("Open Smart Object contents first");
    assertSmartContentDimensions(this.doc.width, this.doc.height);
    if (this.doc.bitDepth !== 8 || this.doc.colorSpace !== "srgb" || this.doc.layers.some(layer => layer.smartSource || layer.kind === "smart-object")) throw new Error("Smart contents currently require RGB8 sRGB without nested embedded sources");
    const assertCurrent = this.guardDocumentOperation("apply Smart Object contents");
    await this.prepareFontsForExport(); assertCurrent();
    const release = this.reserveOperationMemory(this.serializationMemory(this.doc) * 2 + this.doc.width * this.doc.height * 16);
    let rendered: HTMLCanvasElement | undefined;
    try {
      const { encodeLumaProject } = await import("./project"); assertCurrent();
      const blob = await encodeLumaProject(this.doc, [], "Embedded Smart Object"); assertCurrent();
      if (blob.size > 32 * 1024 * 1024) throw new Error("Embedded Smart Object source exceeds 32 MiB");
      const bytes = new Uint8Array(await blob.arrayBuffer()); assertCurrent();
      const parent = this.sessions.find(session => session.id === edit.parentId);
      const layer = parent?.doc.layers.find(candidate => candidate.id === edit.layerId);
      if (!parent || parent.history.current !== edit.node || layer?.bitmap !== edit.bitmap) throw new Error("The parent document changed or closed. Save or close this contents tab, then reopen the parent's Smart Object before applying.");
      const reason = smartContentUnavailableReason(parent.doc, layer, "edit"); if (reason) throw new Error(reason);
      rendered = newCanvas(this.doc.width, this.doc.height); renderClean(this.doc, rendered);
      this.switchDocument(edit.parentId);
      try {
        this.replaceSmartContent(this.prepareSmartContentReplacement(edit.layerId, "edit"), rendered, bytes);
        edit.node = this.history.current; edit.bitmap = this.findLayer(edit.layerId)!.bitmap!;
      } catch (error) { this.switchDocument(childId); throw error; }
      // Stay on the parent to show the committed result. The contents tab is
      // retained, so close/save protection is never bypassed by this command.
      return edit.layerId;
    } finally { if (rendered) { rendered.width = 1; rendered.height = 1; } release(); }
  }

  /** Sensible starting values per effect, matching Photoshop's defaults closely. */
  private static effectPreset(kind: LayerEffectKind): Omit<LayerEffect, "id" | "kind"> {
    switch (kind) {
      case "drop-shadow":
        return { enabled: true, opacity: 0.45, color: "rgba(0,0,0,0.9)", blur: 24, offsetX: 12, offsetY: 16 };
      case "inner-shadow":
        return { enabled: true, opacity: 0.5, color: "rgba(0,0,0,0.9)", blur: 18, offsetX: 6, offsetY: 8 };
      case "outer-glow":
        return { enabled: true, opacity: 0.6, color: "rgba(255,238,170,1)", blur: 26, offsetX: 0, offsetY: 0 };
      case "color-overlay":
        return { enabled: true, opacity: 1, color: "#7656ef", blur: 0, offsetX: 0, offsetY: 0 };
      case "stroke":
        return { enabled: true, opacity: 1, color: "#101014", blur: 0, offsetX: 0, offsetY: 0, width: 4, position: "outside" };
      case "bevel-emboss":
        return {
          enabled: true, opacity: 0.75, color: "rgba(0,0,0,0.9)", blur: 6, offsetX: 0, offsetY: 0,
          depth: 4, angle: 135, highlightColor: "#ffffff", shadowColor: "#000000",
        };
      case "inner-glow":
        return {
          enabled: true, opacity: 0.55, color: "rgba(255,238,170,1)", blur: 18, offsetX: 0, offsetY: 0,
          glowSource: "edge",
        };
      case "satin":
        return {
          enabled: true, opacity: 0.4, color: "rgba(0,0,0,0.9)", blur: 14, offsetX: 11, offsetY: 11,
          invert: true,
        };
      case "gradient-overlay":
        return {
          enabled: true, opacity: 1, color: "#7656ef", blur: 0, offsetX: 0, offsetY: 0,
          stops: [{ offset: 0, color: "#7656ef" }, { offset: 1, color: "#2385f4" }],
          gradientAngle: 90, gradientStyle: "linear",
        };
      case "pattern-overlay":
        return {
          enabled: true, opacity: 0.35, color: "#101014", blur: 0, offsetX: 0, offsetY: 0,
          pattern: "checker", patternScale: 16,
        };
      case "backdrop-blur":
        return {
          enabled: true, opacity: 1, color: "#ffffff", blur: 24, offsetX: 0, offsetY: 0,
          saturation: 1.8, tint: 0.12,
        };
      case "bloom":
        return {
          enabled: true, opacity: 0.8, color: "#ffffff", blur: 28, offsetX: 0, offsetY: 0,
          threshold: 0.72,
        };
      case "relief":
        return {
          enabled: true, opacity: 0.7, color: "#808080", blur: 0, offsetX: 0, offsetY: 0,
          depth: 2, angle: 135,
        };
      case "long-shadow":
        return {
          enabled: true, opacity: 0.5, color: "rgba(0,0,0,0.9)", blur: 0, offsetX: 90, offsetY: 90,
          steps: 48,
        };
      case "refraction":
        return {
          enabled: true, opacity: 1, color: "#ffffff", blur: 6, offsetX: 0, offsetY: 0,
          strength: 18,
        };
      case "reflection":
        return {
          enabled: true, opacity: 0.35, color: "#ffffff", blur: 10, offsetX: 0, offsetY: 6,
        };
      case "contact-shadow":
        // Mid-dark rather than black: the colour is a multiplier here, so pure
        // black would crush the band to nothing at any opacity.
        return {
          enabled: true, opacity: 0.7, color: "#3a3a44", blur: 6, offsetX: 0, offsetY: 0,
          strength: 10,
        };
    }
  }

  /** Add a layer style effect. Locked layers are refused; groups are allowed. */
  addLayerEffect(layerId: string, kind: LayerEffectKind) {
    const layer = this.findLayer(layerId);
    if (!layer || layer.locked) return null;
    const before: LayerSnapshot = { layerId, effects: cloneEffects(layer.effects ?? []) };
    const effect: LayerEffect = { id: nextId("effect"), kind, ...Studio.effectPreset(kind) };
    layer.effects = [...(layer.effects ?? []), effect];
    this.commit({
      label: `${kind.replace(/-/g, " ")} added`,
      before: [before],
      after: [{ layerId, effects: cloneEffects(layer.effects) }],
    });
    this.requestRender();
    return effect;
  }

  /** Patch one effect in place. Locked layers are refused, as for add/remove. */
  updateLayerEffect(layerId: string, effectId: string, patch: Partial<Omit<LayerEffect, "id" | "kind">>) {
    const layer = this.findLayer(layerId);
    if (layer?.locked) return;
    if (!layer?.effects?.some((effect) => effect.id === effectId)) return;
    const key = `layer-effect:${layerId}:${effectId}`;
    const before: LayerSnapshot = this.liveSnapshots.get(key) ?? { layerId, effects: cloneEffects(layer.effects) };
    this.liveSnapshots.delete(key);
    layer.effects = layer.effects.map((effect) =>
      effect.id === effectId ? { ...effect, ...patch } : effect);
    this.commit({
      label: "Layer effect changed",
      before: [before],
      after: [{ layerId, effects: cloneEffects(layer.effects) }],
    });
    this.requestRender();
  }

  liveUpdateLayerEffect(layerId: string, effectId: string, patch: Partial<Omit<LayerEffect, "id" | "kind">>) {
    const layer = this.findLayer(layerId);
    if (layer?.locked || !layer?.effects?.some((effect) => effect.id === effectId)) return false;
    const key = `layer-effect:${layerId}:${effectId}`;
    if (!this.liveSnapshots.has(key)) this.liveSnapshots.set(key, { layerId, effects: cloneEffects(layer.effects) });
    layer.effects = layer.effects.map((effect) => effect.id === effectId ? { ...effect, ...patch } : effect);
    this.markTransientDirty();
    this.requestRender();
    return true;
  }

  commitLiveLayerEffect(layerId: string, effectId: string) {
    const layer = this.findLayer(layerId);
    const key = `layer-effect:${layerId}:${effectId}`;
    const before = this.liveSnapshots.get(key);
    if (!layer?.effects || !before) return false;
    this.liveSnapshots.delete(key);
    this.commit({ label: "Layer effect changed", before: [before], after: [{ layerId, effects: cloneEffects(layer.effects) }] });
    this.requestRender();
    return true;
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
    this.actions.push({ op: "addDropShadow" });
    this.requestRender();
  }

  /**
   * Multiply every size-like field of a layer's effects.
   *
   * Photoshop's Scale Effects: a one-shot rewrite of the numbers rather than a
   * stored multiplier, so it lands in history as a single undoable edit and
   * nothing downstream has to know about a scale factor.
   */
  scaleLayerEffects(layerId: string, factor: number) {
    const layer = this.findLayer(layerId);
    if (!layer?.effects?.length || layer.locked) return;
    if (!Number.isFinite(factor) || factor <= 0) return;
    const before: LayerSnapshot = { layerId, effects: cloneEffects(layer.effects) };
    const grow = (value: number | undefined) => value === undefined ? undefined : value * factor;
    layer.effects = layer.effects.map((effect) => ({
      ...effect,
      blur: effect.blur * factor,
      offsetX: effect.offsetX * factor,
      offsetY: effect.offsetY * factor,
      width: grow(effect.width),
      depth: grow(effect.depth),
      patternScale: grow(effect.patternScale),
    }));
    this.commit({
      label: `Effects scaled ${Math.round(factor * 100)}%`,
      before: [before],
      after: [{ layerId, effects: cloneEffects(layer.effects) }],
    });
    this.requestRender();
  }

  /**
   * Photoshop's Copy/Paste Layer Style: the effects *and* the blending
   * options, which is what makes a pasted style actually look the same.
   */
  copyLayerStyle(layerId: string) {
    const layer = this.findLayer(layerId);
    if (!layer) return null;
    this.styleClipboard = {
      effects: cloneEffects(layer.effects ?? []),
      blendStack: resolvedBlendPasses(layer).map((pass) => ({ ...pass })),
      blendIf: cloneBlendIf(resolvedBlendIf(layer)),
      fillOpacity: resolvedFillOpacity(layer),
    };
    return this.styleClipboard;
  }

  hasCopiedLayerStyle() {
    return this.styleClipboard !== null;
  }

  pasteLayerStyle(layerId: string) {
    const style = this.styleClipboard;
    const layer = this.findLayer(layerId);
    if (!style || !layer || layer.locked) return false;
    const before: LayerSnapshot = {
      layerId,
      effects: cloneEffects(layer.effects ?? []),
      blendStack: layer.blendStack ? layer.blendStack.map((pass) => ({ ...pass })) : null,
      blendIf: layer.blendIf ? cloneBlendIf(layer.blendIf) : null,
      fillOpacity: layer.fillOpacity ?? null,
    };
    // Fresh ids: two layers must not share effect or pass identity, or editing
    // one would look like editing the other to every id-keyed lookup.
    layer.effects = style.effects.map((effect) => ({ ...effect, id: nextId("effect") }));
    layer.blendStack = style.blendStack.map((pass) => ({ ...pass, id: nextId("pass") }));
    layer.blendIf = cloneBlendIf(style.blendIf);
    layer.fillOpacity = style.fillOpacity;
    this.commit({
      label: "Layer style pasted",
      before: [before],
      after: [{
        layerId,
        effects: cloneEffects(layer.effects),
        blendStack: layer.blendStack.map((pass) => ({ ...pass })),
        blendIf: cloneBlendIf(layer.blendIf),
        fillOpacity: layer.fillOpacity,
      }],
    });
    this.requestRender();
    return true;
  }

  /** Remove every effect from a layer in one undoable step. */
  clearLayerStyle(layerId: string) {
    const layer = this.findLayer(layerId);
    if (!layer?.effects?.length || layer.locked) return false;
    const before: LayerSnapshot = { layerId, effects: cloneEffects(layer.effects) };
    layer.effects = [];
    this.commit({ label: "Layer style cleared", before: [before], after: [{ layerId, effects: [] }] });
    this.requestRender();
    return true;
  }

  /**
   * Compute and cache the layer's subject matte, for effects that ask to be
   * confined to it.
   *
   * Inference is async and rendering is not, so the result is stored on the
   * layer and the renderer simply uses it once it appears. Deliberately not
   * undoable: it is derived data, like a cache, not an edit.
   */
  async computeSubjectMask(layerId: string, onProgress?: (message: string, pct: number) => void) {
    const assertCurrent = this.guardDocumentOperation("subject detection");
    const layer = this.findLayer(layerId);
    if (!layer || exceedsBrowserCanvas(this.doc.width, this.doc.height)) return null;
    const source = newCanvas(this.doc.width, this.doc.height);
    const ctx = source.getContext("2d")!;
    drawLayerContentManaged(ctx, layer);
    const { neuralMatte } = await import("./neural");
    assertCurrent();
    const matte = await neuralMatte(source, onProgress);
    assertCurrent();
    const current = this.findLayer(layerId);
    if (!current) return null;
    current.subjectMask = matte;
    this.requestRender();
    this.emit();
    return matte;
  }

  /** Apply a named style preset, replacing whatever the layer had. */
  applyLayerStyle(layerId: string, preset: LayerStylePreset) {
    const layer = this.findLayer(layerId);
    if (!layer || layer.locked) return false;
    const before: LayerSnapshot = {
      layerId,
      effects: cloneEffects(layer.effects ?? []),
      blendStack: layer.blendStack ? layer.blendStack.map((pass) => ({ ...pass })) : null,
      fillOpacity: layer.fillOpacity ?? null,
    };
    const style = instantiateStyle(preset);
    layer.effects = style.effects;
    if (style.blendStack) layer.blendStack = style.blendStack;
    layer.fillOpacity = style.fillOpacity;
    this.commit({
      label: `Style: ${preset.name}`,
      before: [before],
      after: [{
        layerId,
        effects: cloneEffects(layer.effects),
        blendStack: layer.blendStack ? layer.blendStack.map((pass) => ({ ...pass })) : null,
        fillOpacity: layer.fillOpacity ?? null,
      }],
    });
    this.requestRender();
    return true;
  }

  /**
   * Photoshop's "Create Layers": rasterize each effect into its own layer.
   *
   * The style is removed afterwards, because leaving it would double every
   * effect. Effects that read the layers beneath are left in place instead of
   * being split: separated, they would sample a different backdrop — including
   * the new layers themselves — and stop matching what they replaced.
   */
  createLayersFromStyle(layerId: string) {
    const layer = this.findLayer(layerId);
    if (!layer?.effects?.length || layer.locked || exceedsBrowserCanvas(this.doc.width, this.doc.height)) return null;
    const { layers: plan, unsplittable } = planCreateLayers(layer);
    if (!plan.length) return { created: 0, kept: unsplittable.length };

    // The layer's own pixels, rendered once and reused for every effect.
    const content = newCanvas(this.doc.width, this.doc.height);
    drawLayerContentManaged(content.getContext("2d")!, layer);

    const created: Layer[] = [];
    for (const item of plan) {
      const canvas = renderEffectAlone(
        layer,
        item.effect,
        content,
        this.doc.width,
        this.doc.height,
        resolvedGlobalLight(this.doc),
      );
      const effectLayer = createRasterLayer(item.name, canvas);
      effectLayer.parentId = layer.parentId;
      // The effect's own blend mode has to travel with it, or a multiplied
      // inner shadow becomes an opaque grey smear once it is its own layer.
      effectLayer.blend = resolvedEffectBlendMode(item.effect);
      created.push(effectLayer);
    }

    this.commitStructural("Effects to layers", () => {
      const index = this.doc.layers.findIndex((candidate) => candidate.id === layerId);
      const above = created.filter((_, i) => plan[i].placement === "above");
      const below = created.filter((_, i) => plan[i].placement === "below");
      // Index 0 is topmost, so "above" goes before the layer and "below" after.
      this.doc.layers.splice(index, 0, ...above.reverse());
      this.doc.layers.splice(index + above.length + 1, 0, ...below);
      layer.effects = unsplittable.length ? unsplittable.map((effect) => ({ ...effect })) : [];
    });
    this.requestRender();
    return { created: created.length, kept: unsplittable.length };
  }

  /**
   * Advanced blending: knockout, channel masking, mask-hides-effects.
   *
   * One setter rather than three, because they are one pane in the dialog and
   * share a history label.
   */
  setLayerBlendingOption<K extends "knockout" | "blendChannels" | "maskHidesEffects" | "vectorMaskHidesEffects" | "transparencyShapesLayer" | "blendClippedAsGroup">(
    layerId: string,
    key: K,
    value: Layer[K],
  ) {
    const layer = this.findLayer(layerId);
    if (!layer || layer.locked) return;
    const before = { layerId, [key]: layer[key] ?? null } as LayerSnapshot;
    (layer as Record<string, unknown>)[key] = value;
    this.commit({
      label: "Advanced blending",
      before: [before],
      after: [{ layerId, [key]: value ?? null } as LayerSnapshot],
    });
    this.requestRender();
  }

  /**
   * The shared light direction every opted-in effect follows.
   *
   * Document-level, so it snapshots the document the way guides and resize do.
   * The layers are shared by reference through cloneDocument, so this is cheap
   * even though it looks like a whole-document capture.
   */
  setGlobalLight(patch: Partial<GlobalLight>) {
    const current = resolvedGlobalLight(this.doc);
    const next = { ...current, ...patch };
    if (!this.liveGlobalLightDocument && next.angle === current.angle && next.altitude === current.altitude) return;
    const before = this.liveGlobalLightDocument ?? cloneDocument(this.doc);
    this.liveGlobalLightDocument = null;
    this.doc.globalLight = next;
    this.commit({
      label: "Global light",
      before: [],
      after: [],
      documentBefore: before,
      documentAfter: cloneDocument(this.doc),
    });
    this.requestRender();
  }

  liveUpdateGlobalLight(patch: Partial<GlobalLight>) {
    const current = resolvedGlobalLight(this.doc);
    const next = { ...current, ...patch };
    if (next.angle === current.angle && next.altitude === current.altitude) return;
    if (!this.liveGlobalLightDocument) this.liveGlobalLightDocument = cloneDocument(this.doc);
    this.doc.globalLight = next;
    this.markTransientDirty();
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

  addTextLayer(text: string, style: Partial<TextStyle> = {}, transform: Transform = IDENTITY_TRANSFORM) {
    const s: TextStyle = {
      schemaVersion: 2,
      text,
      font: '700 96px "Lato", sans-serif',
      color: "#ffffff",
      align: "left",
      lineHeight: 1.1,
      x: this.doc.width * 0.08,
      y: this.doc.height * 0.55,
      direction: "auto",
      writingMode: "horizontal-tb",
      language: "und",
      defaultStyle: {
        fontFamily: '"Lato", sans-serif',
        fontSize: 96,
        fontWeight: 700,
        fontStyle: "normal",
        fontStretch: 100,
        color: "#ffffff",
        tracking: 0,
        baselineShift: 0,
        decoration: "none",
        axes: { wght: 700, wdth: 100, opsz: 96 },
        features: { kern: true, liga: true },
      },
      ...style,
    };
    const legacy = parseLegacyCanvasFont(s.font);
    s.defaultStyle = {
      ...s.defaultStyle,
      ...legacy,
      color: s.color,
      tracking: s.tracking ?? s.defaultStyle?.tracking ?? 0,
      ...style.defaultStyle,
      axes: {
        ...(s.defaultStyle?.axes ?? {}),
        wght: style.defaultStyle?.axes?.wght ?? legacy.fontWeight,
        wdth: style.defaultStyle?.axes?.wdth ?? s.defaultStyle?.fontStretch ?? 100,
        opsz: style.defaultStyle?.axes?.opsz ?? legacy.fontSize,
        ...(style.defaultStyle?.axes ?? {}),
      },
    };
    const layer = createTextLayer(text.split("\n")[0] || "Text", s);
    layer.transform = { ...transform };
    this.commitStructural(`Text added`, () => this.doc.layers.unshift(layer));
    this.actions.push({ op: "addText", text, style: { ...s }, transform: { ...transform } });
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
    this.actions.push({ op: "addShape", style: { ...s } });
    this.requestRender();
    return layer;
  }

  addFrame(x: number, y: number, width: number, height: number, ellipse = false) {
    if (exceedsBrowserCanvas(this.doc.width, this.doc.height)) return null;
    if (![x, y, width, height].every(Number.isFinite) || !width || !height) throw new Error("Frame bounds must be finite and non-empty.");
    const left = Math.floor(Math.min(x, x + width)), top = Math.floor(Math.min(y, y + height));
    const localWidth = Math.ceil(Math.max(x, x + width)) - left;
    const localHeight = Math.ceil(Math.max(y, y + height)) - top;
    if (exceedsBrowserCanvas(localWidth + 2, localHeight + 2)) throw new Error("Frame exceeds the supported raster bounds.");
    const release = this.reserveOperationMemory((localWidth + 2) * (localHeight + 2) * 32 + 8 * 1024 * 1024);
    let placeholder: Layer | undefined;
    try {
    const group = createGroupLayer(ellipse ? "Ellipse frame" : "Rectangle frame");
    const mask = newCanvas(localWidth + 2, localHeight + 2);
    const maskContext = mask.getContext("2d")!;
    maskContext.fillStyle = "white";
    if (ellipse) {
      maskContext.beginPath();
      maskContext.ellipse(x + width / 2 - left + 1, y + height / 2 - top + 1, Math.abs(width) / 2, Math.abs(height) / 2, 0, 0, Math.PI * 2);
      maskContext.fill();
    } else {
      maskContext.fillRect(x - left + 1, y - top + 1, width, height);
    }
    setLayerMaskFromCanvas(group, mask, this.doc.width, this.doc.height, left - 1, top - 1);
    const placeholderCanvas = newCanvas(localWidth, localHeight);
    const placeholderContext = placeholderCanvas.getContext("2d")!;
    const gradient = placeholderContext.createLinearGradient(x - left, y - top, x + width - left, y + height - top);
    gradient.addColorStop(0, "#262b36");
    gradient.addColorStop(1, "#5a6170");
    placeholderContext.fillStyle = gradient;
    placeholderContext.fillRect(x - left, y - top, width, height);
    placeholder = createRasterLayer("Frame content", placeholderCanvas);
    placeholder.transform = { ...IDENTITY_TRANSFORM, tx: left, ty: top };
    placeholder.parentId = group.id;
    // Prepare the precision surface before publishing the structural/history edit.
    this.syncLayerSurface(placeholder);
    const content = placeholder;
    this.commitStructural("Frame added", () => this.doc.layers.unshift(group, content));
    this.requestRender();
    return group;
    } catch (error) {
      if (placeholder && !this.doc.layers.includes(placeholder)) placeholder.surface?.store.unbindMemoryBudget();
      throw error;
    } finally { release(); }
  }

  removeLayer(id: string) {
    if (this.layerBatchReason([id], "delete")) return;
    this.actions.withoutRecording(() => this.removeLayers([id]));
    this.actions.push({ op: "deleteActive" });
  }

  isLayerLocked(id: string) {
    const seen = new Set<string>();
    let layer = this.findLayer(id);
    while (layer && !seen.has(layer.id)) {
      if (layer.locked) return true;
      seen.add(layer.id); layer = layer.parentId ? this.findLayer(layer.parentId) : undefined;
    }
    return false;
  }

  reorderLayer(id: string, delta: number) {
    if (this.layerBatchReason([id], "group")) return;
    const idx = this.doc.layers.findIndex((l) => l.id === id);
    if (idx < 0) return;
    const next = Math.max(0, Math.min(this.doc.layers.length - 1, idx + delta));
    if (next === idx) return;
    const owners = this.doc.layers.slice(), revision = this.layerHierarchyRevision, historyNode = this.history.current;
    try {
      const [layer] = this.doc.layers.splice(idx, 1);
      this.doc.layers.splice(next, 0, layer);
      this.layerHierarchyRevision += 1;
      this.commit({ label: "Layer reordered", before: [], after: [],
        layerOrderBefore: owners.map(layer => layer.id), layerOrderAfter: this.doc.layers.map(layer => layer.id) });
    } catch (error) {
      if (this.history.current === historyNode) {
        this.doc.layers = owners; this.layerHierarchyRevision = revision;
        throw error;
      }
    }
    this.requestRender();
  }

  private commitStructural(label: string, mutate: () => void) {
    const owners = this.doc.layers.slice();
    const descriptors = owners.map(layer => Object.getOwnPropertyDescriptors(layer));
    const before = owners.map(shallowCloneLayer);
    const revision = this.layerHierarchyRevision;
    const historyNode = this.history.current;
    try {
      mutate();
      const after = this.doc.layers.map(shallowCloneLayer);
      this.layerHierarchyRevision += 1;
      this.commit({ label, before: [], after: [], layersBefore: before, layersAfter: after });
    } catch (error) {
      if (this.history.current !== historyNode) return;
      // Restore the same mutable owners, not history clones. Callers may still
      // hold a layer reference, and newly inserted canvases must not stay live.
      owners.forEach((layer, index) => {
        for (const key of Object.keys(layer)) if (!(key in descriptors[index])) delete (layer as unknown as Record<string, unknown>)[key];
        Object.defineProperties(layer, descriptors[index]);
      });
      this.doc.layers = owners;
      this.layerHierarchyRevision = revision;
      try { this.bindDocumentMemory(this.doc); } catch { /* Preserve the original admission failure. */ }
      throw error;
    }
  }

  /**
   * Props a locked layer still accepts.
   *
   * Locking protects a layer's *appearance*, not its bookkeeping — you must
   * always be able to unlock it again, and hiding or renaming a locked layer
   * is how Photoshop behaves too. Everything else (opacity, blend, fill
   * opacity, clipping) is an appearance change and is refused below.
   */
  private static readonly LOCKED_LAYER_WRITABLE_PROPS = new Set<keyof Layer>(["locked", "visible", "name"]);

  setLayerProp<K extends keyof Layer>(id: string, key: K, value: Layer[K], label?: string) {
    const layer = this.findLayer(id);
    if (!layer) return;
    if (this.isLayerLocked(id) && !Studio.LOCKED_LAYER_WRITABLE_PROPS.has(key)) return;
    const liveKey = `layer-prop:${id}:${String(key)}`;
    const liveBefore = this.liveSnapshots.get(liveKey);
    if (!liveBefore && Object.is(layer[key], value)) return;
    const before: LayerSnapshot = liveBefore ?? { layerId: id };
    this.liveSnapshots.delete(liveKey);
    const after: LayerSnapshot = { layerId: id };
    if (key === "opacity" || key === "fillOpacity" || key === "blend" || key === "visible" || key === "name" || key === "locked" || key === "clipping") {
      if (!liveBefore) (before as Record<string, unknown>)[key as string] = layer[key];
      (after as Record<string, unknown>)[key as string] = value;
    }
    if (key === "fillOpacity") {
      if (!liveBefore) before.fillOpacity = layer.fillOpacity ?? null;
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
    if (key === "opacity") this.actions.push({ op: "setOpacity", opacity: value as number });
    else if (key === "fillOpacity") this.actions.push({ op: "setFillOpacity", opacity: value as number });
    else if (key === "blend") this.actions.push({ op: "setBlendMode", mode: value as BlendMode });
    this.requestRender();
  }

  liveUpdateLayerProp<K extends "opacity" | "fillOpacity">(id: string, key: K, value: Layer[K]) {
    const layer = this.findLayer(id);
    if (!layer) return false;
    if (this.isLayerLocked(id) && !Studio.LOCKED_LAYER_WRITABLE_PROPS.has(key)) return false;
    const liveKey = `layer-prop:${id}:${String(key)}`;
    if (!this.liveSnapshots.has(liveKey)) {
      this.liveSnapshots.set(liveKey, { layerId: id, [key]: layer[key] ?? null } as LayerSnapshot);
    }
    layer[key] = value;
    this.markTransientDirty();
    this.requestRender();
    return true;
  }

  updateLayerSpatial(id: string, patch: Parameters<typeof withTextSpatial>[1]) {
    const layer = this.findLayer(id);
    if (layer?.lettering3d || layer?.mesh3d) return false;
    if (!layer || layer.locked || layer.kind.startsWith("adjustment-") || layer.kind === "group") return false;
    const key = `layer-spatial:${id}`;
    const liveBefore = this.liveSnapshots.get(key);
    const current = layer.spatial ?? layer.text?.spatial;
    const next = withTextSpatial(current, patch);
    if (!liveBefore && JSON.stringify(current) === JSON.stringify(next)) return false;
    const before = liveBefore ?? { layerId: id, spatial: cloneSpatialStyle(layer.spatial) ?? null };
    this.liveSnapshots.delete(key);
    layer.spatial = next;
    this.commit({ label: "Spatial layer changed", before: [before], after: [{ layerId: id, spatial: cloneSpatialStyle(next) }] });
    this.requestRender();
    return true;
  }

  liveUpdateLayerSpatial(id: string, patch: Parameters<typeof withTextSpatial>[1]) {
    const layer = this.findLayer(id);
    if (layer?.lettering3d || layer?.mesh3d) return false;
    if (!layer || layer.locked || layer.kind.startsWith("adjustment-") || layer.kind === "group") return false;
    const key = `layer-spatial:${id}`;
    if (!this.liveSnapshots.has(key)) this.liveSnapshots.set(key, { layerId: id, spatial: cloneSpatialStyle(layer.spatial) ?? null });
    layer.spatial = withTextSpatial(layer.spatial ?? layer.text?.spatial, patch);
    this.markTransientDirty();
    this.requestRender();
    return true;
  }

  setIdentityReference(id: string | null) {
    const target = id ? this.findLayer(id) : null;
    if (id && (!target || target.kind === "group" || target.kind.startsWith("adjustment-"))) return false;
    const current = this.doc.layers.find((layer) => layer.identityReference)?.id ?? null;
    if (current === id) return false;
    this.commitStructural(id ? "Identity reference locked" : "Identity reference cleared", () => {
      for (const layer of this.doc.layers) layer.identityReference = layer.id === id || undefined;
    });
    this.requestRender();
    return true;
  }

  setBlendStack(id: string, passes: ReadonlyArray<BlendPass>, label = "Blend stack changed") {
    const layer = this.findLayer(id);
    if (!layer || layer.kind === "group" || layer.locked) return false;
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

  applyBlendRecipe(id: string, recipe: BlendRecipeId) {
    const passes = blendRecipePasses(recipe);
    if (!passes) return false;
    return this.setBlendStack(id, passes, `Blend recipe · ${recipe}`);
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

  /**
   * Preview a blend-pass slider without producing one history node per input
   * event. The first tick captures the exact pre-drag state; the matching
   * commit below consumes it as a single undoable operation.
   */
  liveUpdateBlendPass(id: string, passId: string, patch: Partial<Omit<BlendPass, "id">>) {
    const layer = this.findLayer(id);
    if (!layer || layer.kind === "group" || layer.locked) return false;
    const passes = resolvedBlendPasses(layer);
    const index = passes.findIndex((pass) => pass.id === passId);
    if (index < 0) return false;
    const key = `blend-pass:${id}:${passId}`;
    if (!this.liveSnapshots.has(key)) {
      this.liveSnapshots.set(key, {
        layerId: id,
        blend: layer.blend,
        blendStack: layer.blendStack ? cloneBlendStack(layer.blendStack) : null,
      });
    }
    passes[index] = {
      ...passes[index],
      ...patch,
      opacity: Math.max(0, Math.min(1, patch.opacity ?? passes[index].opacity)),
    };
    layer.blendStack = cloneBlendStack(passes);
    layer.blend = passes[0].mode;
    this.markTransientDirty();
    this.requestRender();
    return true;
  }

  commitBlendPass(id: string, passId: string, patch: Partial<Omit<BlendPass, "id">>) {
    const layer = this.findLayer(id);
    if (!layer || layer.kind === "group" || layer.locked) return false;
    const passes = resolvedBlendPasses(layer);
    const index = passes.findIndex((pass) => pass.id === passId);
    if (index < 0) return false;
    const key = `blend-pass:${id}:${passId}`;
    const before = this.liveSnapshots.get(key) ?? {
      layerId: id,
      blend: layer.blend,
      blendStack: layer.blendStack ? cloneBlendStack(layer.blendStack) : null,
    };
    this.liveSnapshots.delete(key);
    passes[index] = {
      ...passes[index],
      ...patch,
      opacity: Math.max(0, Math.min(1, patch.opacity ?? passes[index].opacity)),
    };
    layer.blendStack = cloneBlendStack(passes);
    layer.blend = passes[0].mode;
    this.commit({
      label: patch.opacity !== undefined ? "Blend pass opacity" : "Blend pass changed",
      before: [before],
      after: [{ layerId: id, blend: layer.blend, blendStack: cloneBlendStack(passes) }],
    });
    this.requestRender();
    return true;
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
    return this.commitLayerBlendIf(id, settings);
  }

  liveUpdateLayerBlendIf(id: string, settings: BlendIf) {
    const layer = this.findLayer(id);
    if (!layer || layer.kind === "group" || layer.locked) return false;
    const key = `blend-if:${id}`;
    if (!this.liveSnapshots.has(key)) {
      this.liveSnapshots.set(key, {
        layerId: id,
        blendIf: layer.blendIf ? cloneBlendIf(layer.blendIf) : null,
      });
    }
    const normalized = resolvedBlendIf({ blendIf: settings });
    layer.blendIf = cloneBlendIf(normalized);
    this.markTransientDirty();
    this.requestRender();
    return true;
  }

  commitLayerBlendIf(id: string, settings: BlendIf) {
    const layer = this.findLayer(id);
    if (!layer || layer.kind === "group" || layer.locked) return false;
    const key = `blend-if:${id}`;
    const before: LayerSnapshot = this.liveSnapshots.get(key) ?? {
      layerId: id,
      blendIf: layer.blendIf ? cloneBlendIf(layer.blendIf) : null,
    };
    this.liveSnapshots.delete(key);
    const normalized = resolvedBlendIf({ blendIf: settings });
    layer.blendIf = cloneBlendIf(normalized);
    const after: LayerSnapshot = { layerId: id, blendIf: cloneBlendIf(normalized) };
    if (JSON.stringify(before.blendIf) === JSON.stringify(after.blendIf)) {
      this.clearTransientDirtyIfSettled();
      this.requestRender();
      this.emit();
      return true;
    }
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
    if (!layer || this.isLayerLocked(id) || layer.kind === "group") return;
    if (Object.values(patch).some(value => !Number.isFinite(value))) return;
    const key = `transform:${id}`;
    const liveBefore = this.liveSnapshots.get(key);
    if (!liveBefore && Object.entries(patch).every(([name, value]) => Object.is(layer.transform[name as keyof Transform], value))) return;
    const before: LayerSnapshot = liveBefore ?? { layerId: id, transform: { ...layer.transform } };
    this.liveSnapshots.delete(key);
    layer.transform = { ...layer.transform, ...patch };
    if (liveBefore?.transform && Object.keys(layer.transform).every(name => (layer.transform[name as keyof Transform] ?? 0) === (liveBefore.transform![name as keyof Transform] ?? 0))) {
      this.clearTransientDirtyIfSettled();
      this.emit();
      return;
    }
    const after: LayerSnapshot = { layerId: id, transform: { ...layer.transform } };
    this.commit({ label: "Transform", before: [before], after: [after] });
    this.actions.push({ op: "setTransform", transform: { ...layer.transform } });
    this.requestRender();
  }

  liveUpdateTransform(id: string, patch: Partial<Transform>) {
    const layer = this.findLayer(id);
    if (!layer || this.isLayerLocked(id) || layer.kind === "group") return;
    if (Object.values(patch).some(value => !Number.isFinite(value))) return;
    if (Object.entries(patch).every(([name, value]) => (layer.transform[name as keyof Transform] ?? 0) === value)) return;
    const key = `transform:${id}`;
    if (!this.liveSnapshots.has(key)) this.liveSnapshots.set(key, { layerId: id, transform: { ...layer.transform } });
    layer.transform = { ...layer.transform, ...patch };
    this.markTransientDirty();
    this.requestRender();
  }

  cancelLiveTransform(id: string) {
    const key = `transform:${id}`;
    const before = this.liveSnapshots.get(key);
    const layer = this.findLayer(id);
    if (!before?.transform || !layer) return;
    layer.transform = { ...before.transform };
    this.liveSnapshots.delete(key);
    this.clearTransientDirtyIfSettled();
    this.requestRender();
    this.emit();
  }

  resetTransform(id: string) {
    this.updateTransform(id, IDENTITY_TRANSFORM);
  }

  updateText(id: string, patch: Partial<TextStyle>) {
    const layer = this.findLayer(id);
    if (!layer || !layer.text || layer.locked) return;
    const key = `text:${id}`;
    const liveBefore = this.liveSnapshots.get(key);
    if (!liveBefore && Object.entries(patch).every(([name, value]) => Object.is(layer.text![name as keyof TextStyle], value))) return;
    const before: LayerSnapshot = liveBefore ?? { layerId: id, text: { ...layer.text } };
    this.liveSnapshots.delete(key);
    const safePatch = patch.text !== undefined && patch.runs === undefined
      ? { ...patch, runs: textRunsAfterContentEdit(layer.text, patch.text) }
      : patch;
    layer.text = { ...layer.text, ...safePatch };
    const after: LayerSnapshot = { layerId: id, text: { ...layer.text } };
    this.commit({ label: "Text updated", before: [before], after: [after] });
    this.actions.push({ op: "updateText", text: { ...layer.text } });
    this.requestRender();
  }

  /**
   * Per-keystroke text edits, without a history entry per keystroke.
   *
   * Mirrors liveUpdateTransform: the first call in a typing burst snapshots
   * the pre-edit text as the eventual undo "before", every call after that
   * just mutates and re-renders, and the caller commits once — on blur — via
   * updateText, which consumes that snapshot. Without this, every character
   * typed became its own undo step, so Cmd+Z undid one letter at a time
   * instead of the edit as a whole.
   */
  liveUpdateText(id: string, patch: Partial<TextStyle>) {
    const layer = this.findLayer(id);
    if (!layer || !layer.text || layer.locked) return;
    const key = `text:${id}`;
    if (!this.liveSnapshots.has(key)) this.liveSnapshots.set(key, { layerId: id, text: { ...layer.text } });
    const safePatch = patch.text !== undefined && patch.runs === undefined
      ? { ...patch, runs: textRunsAfterContentEdit(layer.text, patch.text) }
      : patch;
    layer.text = { ...layer.text, ...safePatch };
    this.markTransientDirty();
    this.requestRender();
  }

  updateShape(id: string, patch: Partial<ShapeStyle>) {
    const layer = this.findLayer(id);
    if (!layer || !layer.shape || layer.locked) return;
    const key = `shape:${id}`;
    const liveBefore = this.liveSnapshots.get(key);
    if (!liveBefore && Object.entries(patch).every(([name, value]) => Object.is(layer.shape![name as keyof ShapeStyle], value))) return;
    const before: LayerSnapshot = liveBefore ?? { layerId: id, shape: { ...layer.shape } };
    this.liveSnapshots.delete(key);
    layer.shape = { ...layer.shape, ...patch };
    const after: LayerSnapshot = { layerId: id, shape: { ...layer.shape } };
    this.commit({ label: "Shape updated", before: [before], after: [after] });
    this.actions.push({ op: "updateShape", shape: { ...layer.shape } });
    this.requestRender();
  }

  liveUpdateShape(id: string, patch: Partial<ShapeStyle>) {
    const layer = this.findLayer(id);
    if (!layer || !layer.shape || layer.locked) return;
    const key = `shape:${id}`;
    if (!this.liveSnapshots.has(key)) this.liveSnapshots.set(key, { layerId: id, shape: { ...layer.shape } });
    layer.shape = { ...layer.shape, ...patch };
    this.markTransientDirty();
    this.requestRender();
  }

  updateTone(id: string, tone: ToneParams) { this.commitAdjustment(id, "tone", tone); }
  liveUpdateTone(id: string, tone: ToneParams) { this.liveAdjustment(id, "tone", tone); }

  /** Live tick during a slider drag — stores an initial snapshot the first
   *  time so the committing call can undo cleanly. */
  private liveAdjustment<K extends AdjustmentKind>(id: string, kind: K, params: AdjustmentParams[K]) {
    const layer = this.findLayer(id);
    // isAdjustmentLayer is a kind test only, so the lock has to be checked
    // separately here — every other layer-style mutator refuses a locked layer.
    if (!isAdjustmentLayer(layer, kind) || layer.locked) return;
    const key = `${kind}:${id}`;
    if (!this.liveSnapshots.has(key)) {
      this.liveSnapshots.set(key, snapshotForAdjustment(layer, kind));
    }
    applyAdjustment(layer, kind, params);
    this.markTransientDirty();
    this.requestRender();
  }

  /** Slider release — consumes the live snapshot (if any) as the "before"
   *  side of the commit, ensuring a single history entry per drag. */
  private commitAdjustment<K extends AdjustmentKind>(id: string, kind: K, params: AdjustmentParams[K]) {
    const layer = this.findLayer(id);
    if (!isAdjustmentLayer(layer, kind) || layer.locked) return;
    const key = `${kind}:${id}`;
    const before = this.liveSnapshots.get(key) ?? snapshotForAdjustment(layer, kind);
    this.liveSnapshots.delete(key);
    applyAdjustment(layer, kind, params);
    const after = snapshotForAdjustment(layer, kind);
    if (JSON.stringify(before) === JSON.stringify(after)) {
      this.clearTransientDirtyIfSettled();
      this.requestRender();
      this.emit();
      return;
    }
    this.commit({ label: adjustmentLabel(kind), before: [before], after: [after] });
    this.requestRender();
  }

  // --- painting ---
  private sampledBrushBitmap(
    source: HTMLCanvasElement,
    centerX: number,
    centerY: number,
    radius: number,
  ) {
    const sourceDiameter = radius * 2;
    const edge = Math.max(8, Math.min(MAX_CAPTURED_BRUSH_EDGE, Math.ceil(sourceDiameter)));
    const bitmap = newCanvas(edge, edge);
    const context = bitmap.getContext("2d")!;
    context.save();
    context.beginPath();
    context.arc(edge / 2, edge / 2, edge / 2, 0, Math.PI * 2);
    context.clip();
    context.drawImage(
      source,
      centerX - radius,
      centerY - radius,
      sourceDiameter,
      sourceDiameter,
      0,
      0,
      edge,
      edge,
    );
    context.restore();
    return bitmap;
  }

  addCapturedBrush(
    name: string,
    source: HTMLCanvasElement,
    centerX = source.width / 2,
    centerY = source.height / 2,
    radius = Math.min(source.width, source.height) / 2,
    liveSource?: CapturedBrushAsset["liveSource"],
  ): CapturedBrushAsset | null {
    if (!Number.isFinite(centerX) || !Number.isFinite(centerY) || !Number.isFinite(radius) || radius < 1 ||
        source.width < 1 || source.height < 1) return null;
    const sourceDiameter = radius * 2;
    const bitmap = this.sampledBrushBitmap(source, centerX, centerY, radius);
    const asset: CapturedBrushAsset = {
      id: nextId("captured-brush"),
      name: name.trim().slice(0, 80) || `Captured Brush ${(this.doc.capturedBrushes?.length ?? 0) + 1}`,
      bitmap,
      sourceDiameter,
      createdAt: new Date().toISOString(),
      liveSource,
    };
    const brushes = [...(this.doc.capturedBrushes ?? []), asset];
    this.doc.capturedBrushes = brushes.slice(-MAX_CAPTURED_BRUSHES);
    this.emit();
    return asset;
  }

  captureBrushFromDocument(
    x: number,
    y: number,
    radius: number,
    options: { name?: string; sourceLayerId?: string; live?: boolean } = {},
  ) {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(radius)) return null;
    const diameter = radius * 2;
    const edge = Math.max(8, Math.min(MAX_CAPTURED_BRUSH_EDGE, Math.ceil(diameter)));
    const scale = edge / diameter;
    const source = newCanvas(edge, edge);
    if (options.sourceLayerId) {
      const layer = this.findLayer(options.sourceLayerId);
      if (!layer || layer.kind === "group") return null;
      drawLayerContentManaged(source.getContext("2d")!, layer, {
        a: scale,
        b: 0,
        c: 0,
        d: scale,
        e: -(x - radius) * scale,
        f: -(y - radius) * scale,
      });
    } else {
      renderViewport(this.doc, source, {
        x: x - radius,
        y: y - radius,
        width: diameter,
        height: diameter,
        zoom: scale,
        outputWidth: edge,
        outputHeight: edge,
        cssScale: scale,
        devicePixelRatio: 1,
      }, {
        checkerboard: false,
        selectionOverlay: false,
        proofing: false,
        cacheRevision: this.renderRevision,
        hierarchyRevision: this.layerHierarchyRevision,
      });
    }
    const asset = this.addCapturedBrush(
      options.name ?? "Canvas capture",
      source,
      edge / 2,
      edge / 2,
      edge / 2,
      options.live ? {
        mode: options.sourceLayerId ? "layer" : "merged",
        layerId: options.sourceLayerId,
        centerX: x,
        centerY: y,
        radius,
        live: true,
      } : undefined,
    );
    if (asset) asset.sourceDiameter = diameter;
    return asset;
  }

  /** Re-samples a Living Source Brush once at stroke start, never per dab. */
  refreshCapturedBrush(id: string) {
    const brushes = this.doc.capturedBrushes ?? [];
    const index = brushes.findIndex((brush) => brush.id === id);
    const asset = brushes[index];
    const live = asset?.liveSource;
    if (!asset || !live?.live || live.radius < 1) return false;
    const diameter = live.radius * 2;
    const edge = Math.max(8, Math.min(MAX_CAPTURED_BRUSH_EDGE, Math.ceil(diameter)));
    const scale = edge / diameter;
    const source = newCanvas(edge, edge);
    if (live.mode === "layer") {
      const layer = live.layerId ? this.findLayer(live.layerId) : null;
      if (!layer || layer.kind === "group") return false;
      drawLayerContentManaged(source.getContext("2d")!, layer, {
        a: scale, b: 0, c: 0, d: scale,
        e: -(live.centerX - live.radius) * scale,
        f: -(live.centerY - live.radius) * scale,
      });
    } else {
      renderViewport(this.doc, source, {
        x: live.centerX - live.radius,
        y: live.centerY - live.radius,
        width: diameter,
        height: diameter,
        zoom: scale,
        outputWidth: edge,
        outputHeight: edge,
        cssScale: scale,
        devicePixelRatio: 1,
      }, {
        checkerboard: false,
        selectionOverlay: false,
        proofing: false,
        cacheRevision: this.renderRevision,
        hierarchyRevision: this.layerHierarchyRevision,
      });
    }
    const next = [...brushes];
    next[index] = {
      ...asset,
      bitmap: this.sampledBrushBitmap(source, edge / 2, edge / 2, edge / 2),
      sourceDiameter: diameter,
    };
    this.doc.capturedBrushes = next;
    this.emit();
    return true;
  }

  removeCapturedBrush(id: string) {
    const brushes = this.doc.capturedBrushes ?? [];
    const next = brushes.filter((brush) => brush.id !== id);
    if (next.length === brushes.length) return false;
    this.doc.capturedBrushes = next;
    this.emit();
    return true;
  }

  capturedBrushTip(id: string, mode: ImageBrushMode = "color"): ImageBrushTip | null {
    const asset = this.doc.capturedBrushes?.find((brush) => brush.id === id);
    if (!asset) return null;
    const image = asset.bitmap.getContext("2d")!.getImageData(0, 0, asset.bitmap.width, asset.bitmap.height);
    const workingData = new Float32Array(image.data.length);
    for (let offset = 0; offset < image.data.length; offset += 4) {
      const working = displaySrgbToWorking([
        image.data[offset] / 255,
        image.data[offset + 1] / 255,
        image.data[offset + 2] / 255,
      ], this.doc.colorSpace);
      workingData[offset] = working[0];
      workingData[offset + 1] = working[1];
      workingData[offset + 2] = working[2];
      workingData[offset + 3] = image.data[offset + 3] / 255;
    }
    return {
      id: asset.id,
      name: asset.name,
      width: image.width,
      height: image.height,
      data: image.data,
      workingData,
      mode,
    };
  }

  private layerStrokePoint(layer: Layer, params: BrushParams, point: BrushPoint) {
    if (params.mode === "mask-add" || params.mode === "mask-remove") return { ...point };
    const local = documentPointToLayer(layer.transform, point.x, point.y);
    return local ? { ...point, x: local.x, y: local.y } : null;
  }

  private selectionTileForLayer(layer: Layer, x: number, y: number, width: number, height: number) {
    if (!this.doc.selection) return null;
    const inverse = inverseAffineForLayerTransform(layer.transform);
    if (!inverse) return null;
    const forward = affineForLayerTransform(layer.transform);
    const corners = [
      transformPoint(forward, x, y),
      transformPoint(forward, x + width, y),
      transformPoint(forward, x, y + height),
      transformPoint(forward, x + width, y + height),
    ];
    const minX = Math.floor(Math.min(...corners.map((point) => point.x))) - 1;
    const minY = Math.floor(Math.min(...corners.map((point) => point.y))) - 1;
    const maxX = Math.ceil(Math.max(...corners.map((point) => point.x))) + 1;
    const maxY = Math.ceil(Math.max(...corners.map((point) => point.y))) + 1;
    const region = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    const selection = selectionRegionCanvas(this.doc, region);
    if (!selection) return null;
    const local = newCanvas(width, height);
    const context = local.getContext("2d")!;
    context.setTransform(inverse.a, inverse.b, inverse.c, inverse.d, inverse.e - x, inverse.f - y);
    context.drawImage(selection, region.x, region.y);
    return context.getImageData(0, 0, width, height).data;
  }

  beginStroke(layerId: string, params: BrushParams, point: BrushPoint) {
    this.cancelStroke();
    if (!validBrushPoint(point) || !Number.isFinite(params.size) || params.size <= 0 || params.size > 4096) throw new Error("Brush size must be between 0 and 4096 pixels with finite coordinates");
    const layer = this.findLayer(layerId);
    if (!layer || layer.locked) return false;
    const maskPaint = params.mode === "mask-add" || params.mode === "mask-remove";
    if ((layer.lettering3d || layer.mesh3d || layer.smartSource) && !maskPaint) return false;
    const originalMask = layer.mask, originalMaskSurface = layer.maskSurface;
    if (maskPaint) layerMaskSurface(layer, this.doc.width, this.doc.height, true)!
      .bindMemoryBudget(this.residentMemoryBudget, `mask:${layer.id}`);
    layer.surface?.store.bindMemoryBudget(this.residentMemoryBudget, `pixels:${layer.id}`);
    const localPoint = this.layerStrokePoint(layer, params, point);
    if (!localPoint) return false;
    const precisionPaint = (params.mode === "paint" || params.mode === "erase") && !!layer.surface;
    if (!precisionPaint && !maskPaint && !paintTarget(layer, params)) return false;
    params = { ...params, symmetry: params.symmetry ? { ...params.symmetry } : undefined, texture: params.texture ? { ...params.texture } : undefined,
      pressureCurve: Array.isArray(params.pressureCurve) ? params.pressureCurve.map(value => ({ ...value })) : params.pressureCurve };
    this.activeStroke = { layer, document: this.doc, params, originalMask, originalMaskSurface };
    this.strokeTiles = new Map();
    this.maskStroke = maskPaint ? { layerId, before: new Map(), planner: new BrushStrokePlanner(params), tiles: new Map(), cacheBytes: 0 } : null;
    this.precisionStroke = precisionPaint ? {
      layerId,
      params: { ...params },
      planner: new BrushStrokePlanner(params),
      tiles: new Map(),
      workingColor: displaySrgbToWorking(parseBrushColor(params.color).map(value => value / 255) as [number, number, number], layer.surface!.colorSpace),
      cacheBytes: 0,
      before: new Map(),
    } : null;
    this.lastPoint = localPoint;
    this.paintSegmentState = null;
    try { this.paintToLayer(layerId, params, localPoint); }
    catch (error) { this.cancelStroke(); throw error; }
    this.paintSegmentState = createPaintSegmentState(params);
    this.paintSegmentState.planner.start(localPoint, false);
    this.paintSegmentState.started = true;
    return true;
  }

  paintTo(layerId: string, params: BrushParams, point: BrushPoint) {
    const stroke = this.activeStroke;
    if (!stroke || stroke.document !== this.doc || stroke.layer.id !== layerId) return;
    const layer = stroke.layer;
    if (layer.locked || this.findLayer(layerId) !== layer) { this.cancelStroke(); return; }
    params = stroke.params;
    if (!validBrushPoint(point)) { this.cancelStroke(); throw new Error("Invalid brush coordinates or pressure"); }
    const localPoint = this.layerStrokePoint(layer, params, point);
    if (!localPoint) return;
    try { this.paintToLayer(layerId, params, localPoint); }
    catch (error) { this.cancelStroke(); throw error; }
  }

  private paintToLayer(layerId: string, params: BrushParams, point: BrushPoint) {
    const layer = this.findLayer(layerId);
    if (!layer) return;
    const maskPaint = params.mode === "mask-add" || params.mode === "mask-remove";
    const precisionPaint = (params.mode === "paint" || params.mode === "erase") && !!layer.surface;
    const target = precisionPaint || maskPaint ? null : paintTarget(layer, params);
    if (!precisionPaint && !maskPaint && !target) return;
    const prev = this.lastPoint ?? point;
    const next = smoothBrushPoint(prev, point, params.smoothing);
    const dirtyRegion = this.strokeDirtyRegion(layer, params, prev, next);
    if (maskPaint) {
      this.paintMaskSegment(layer, params, next);
      this.lastPoint = next;
      this.requestRender(dirtyRegion);
      return;
    }
    if (precisionPaint) {
      this.paintPrecisionStroke(layer, params, next);
      this.lastPoint = next;
      this.requestRender(dirtyRegion);
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
      const right = Math.min(target!.width, Math.ceil(Math.max(prev.x, next.x) + radius));
      const bottom = Math.min(target!.height, Math.ceil(Math.max(prev.y, next.y) + radius));
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
      const selection = this.selectionTileForLayer(layer, x, y, scratch.width, scratch.height);
      if (selection) {
        const selectionCanvas = newCanvas(scratch.width, scratch.height);
        const selectionContext = selectionCanvas.getContext("2d")!;
        const selectionImage = selectionContext.createImageData(scratch.width, scratch.height);
        selectionImage.data.set(selection);
        selectionContext.putImageData(selectionImage, 0, 0);
        sctx.drawImage(selectionCanvas, 0, 0);
      } else {
        sctx.clearRect(0, 0, scratch.width, scratch.height);
      }
      sctx.globalCompositeOperation = "source-over";
      // Composite scratch into layer (erase uses destination-out)
      ctx.globalCompositeOperation = params.mode === "erase" ? "destination-out" : "source-over";
      ctx.drawImage(scratch, x, y);
      ctx.globalCompositeOperation = "source-over";
    } else {
      paintSegment(ctx, prev, next, params, this.paintSegmentState ?? undefined);
    }
    if (layer.bitmap) {
      bumpBitmapVersion(layer.bitmap);
    }
    this.lastPoint = next;
    this.requestRender(dirtyRegion);
  }

  private strokeDirtyRegion(layer: Layer, params: BrushParams, from: BrushPoint, to: BrushPoint): PixelRect {
    const radius = params.size * (0.6 + Math.max(0, params.scatter ?? 0)) + 3;
    const local: PixelRect = {
      x: Math.min(from.x, to.x) - radius,
      y: Math.min(from.y, to.y) - radius,
      width: Math.abs(to.x - from.x) + radius * 2,
      height: Math.abs(to.y - from.y) + radius * 2,
    };
    if (params.mode === "mask-add" || params.mode === "mask-remove") return local;
    const transform = affineForLayerTransform(layer.transform);
    const corners = [
      transformPoint(transform, local.x, local.y),
      transformPoint(transform, local.x + local.width, local.y),
      transformPoint(transform, local.x + local.width, local.y + local.height),
      transformPoint(transform, local.x, local.y + local.height),
    ];
    const left = Math.min(...corners.map((corner) => corner.x));
    const top = Math.min(...corners.map((corner) => corner.y));
    const right = Math.max(...corners.map((corner) => corner.x));
    const bottom = Math.max(...corners.map((corner) => corner.y));
    return { x: left, y: top, width: right - left, height: bottom - top };
  }

  /** Restore only the active gesture's tiles; cancellation never adds history. */
  cancelStroke() {
    const stroke = this.activeStroke;
    if (!stroke) return;
    const { layer } = stroke;
    try {
      if (this.precisionStroke && layer.surface) {
        // Release replacement tiles first so restoration does not need extra admission.
        for (const key of this.precisionStroke.before.keys()) layer.surface.store.delete(key);
        for (const [key, before] of this.precisionStroke.before) {
          if (before) layer.surface.store.write(key, before);
          this.updateLayerBitmapTile(layer, key);
        }
      } else if (this.maskStroke && layer.maskSurface) {
        for (const key of this.maskStroke.before.keys()) layer.maskSurface.applyPatch({ key, before: null, after: null }, "before");
        for (const [key, before] of this.maskStroke.before) layer.maskSurface.applyPatch({ key, before, after: null }, "before");
        if (layer.maskSurface !== stroke.originalMaskSurface) layer.maskSurface.unbindMemoryBudget();
        layer.mask = stroke.originalMask;
        layer.maskSurface = stroke.originalMaskSurface;
      } else if (this.strokeTiles) {
        for (const tile of this.strokeTiles.values()) {
          const canvas = tile.target === "bitmap" ? layer.bitmap : layer.mask;
          canvas?.getContext("2d")!.putImageData(tile.before, tile.x, tile.y);
          if (canvas) bumpBitmapVersion(canvas);
        }
      }
    } finally {
      this.activeStroke = null;
      this.strokeTiles = null;
      this.precisionStroke = null;
      this.maskStroke = null;
      this.lastPoint = null;
      this.paintSegmentState = null;
      this.requestRender();
    }
  }

  endStroke(layerId: string, params: BrushParams, endpoint?: BrushPoint) {
    try {
      const stroke = this.activeStroke;
      if (endpoint && stroke?.layer.id === layerId && stroke.document === this.doc) {
        if (!validBrushPoint(endpoint)) throw new Error("Invalid brush endpoint");
        const local = this.layerStrokePoint(stroke.layer, stroke.params, endpoint);
        // Catch the final position even when the host omits its last move event.
        // Do not stamp stationary pointer-up events twice.
        if (local && this.lastPoint && (local.x !== this.lastPoint.x || local.y !== this.lastPoint.y)) {
          this.paintToLayer(layerId, { ...stroke.params, smoothing: 0 }, local);
        }
      }
      this.finishStroke(layerId, params);
    }
    catch (error) { this.cancelStroke(); throw error; }
  }

  private finishStroke(layerId: string, params: BrushParams) {
    if (!this.strokeTiles || !this.activeStroke || this.activeStroke.layer.id !== layerId || this.activeStroke.document !== this.doc) return;
    params = this.activeStroke.params;
    const layer = this.findLayer(layerId);
    if (!layer) return;
    const label =
      params.mode === "erase" ? "Erase stroke" :
      params.mode === "mask-add" ? "Mask paint (add)" :
      params.mode === "mask-remove" ? "Mask paint (remove)" :
      "Brush stroke";
    if (this.maskStroke && this.maskStroke.layerId === layerId && layer.maskSurface) {
      const maskSurfacePatches: LayerMaskTilePatch[] = [...this.maskStroke.before].map(([key, before]) => ({
        layerId,
        key,
        before,
        after: layer.maskSurface!.record(key),
      }));
      this.commit({ label, before: [], after: [], maskSurfacePatches });
      this.activeStroke = null;
      this.strokeTiles = null;
      this.maskStroke = null;
      this.lastPoint = null;
      this.paintSegmentState = null;
      return;
    }
    if (this.precisionStroke && layer.surface) {
      const surfacePatches: SurfaceTilePatch[] = [...this.precisionStroke.before].map(([key, before]) => ({
        layerId,
        key,
        before,
        after: layer.surface!.store.read(key),
      }));
      this.commit({ label, before: [], after: [], surfacePatches });
      this.activeStroke = null;
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
    this.activeStroke = null;
    this.checkpointLayerSurface(layer);
    this.strokeTiles = null;
    this.precisionStroke = null;
    this.maskStroke = null;
    this.lastPoint = null;
    this.paintSegmentState = null;
  }

  private paintMaskSegment(
    layer: Layer,
    params: BrushParams,
    to: BrushPoint,
  ) {
    const state = this.maskStroke;
    if (!state || state.layerId !== layer.id) return;
    const surface = layerMaskSurface(layer, this.doc.width, this.doc.height, true)!;
    const batches = brushTileBatches(state.planner.add(to), surface.grid);
    let admissionBytes = state.cacheBytes;
    for (const key of batches.keys()) if (!state.tiles.has(key)) {
      const tile = surface.grid.parseKey(key);
      admissionBytes += tile.width * tile.height * (params.imageTip ? 80 : 68);
    }
    if (admissionBytes > 128 * 1024 * 1024) throw new Error("Mask stroke exceeds the 128 MiB working-set limit; use shorter strokes");
    state.cacheBytes = admissionBytes;
    for (const [key, dabs] of batches) {
      const tile = surface.grid.parseKey(key);
      let cached = state.tiles.get(key);
      if (!cached) {
        state.before.set(key, surface.record(key));
        const alpha = surface.readTile(key);
        const base = new Float32Array(alpha.length * 4);
        for (let i = 0; i < alpha.length; i++) {
          const offset = i * 4;
          base[offset] = base[offset + 1] = base[offset + 2] = 1;
          base[offset + 3] = alpha[i] / 255;
        }
        cached = { base, values: new Float32Array(base.length), coverage: {} };
        state.tiles.set(key, cached);
      }
      cached.values.set(cached.base);
      replayStrokeFloat({ width: tile.width, height: tile.height, originX: tile.x, originY: tile.y, data: cached.values },
        { layerId: layer.id, params, points: [] }, [1, 1, 1], { dabs, cache: cached.coverage });
      const alpha = new Uint8Array(tile.width * tile.height);
      for (let i = 0; i < alpha.length; i++) alpha[i] = Math.round(cached.values[i * 4 + 3] * 255);
      surface.writeTile(key, alpha);
      this.requestRender(tile);
    }
  }

  private paintPrecisionStroke(layer: Layer, params: BrushParams, point: BrushPoint) {
    const state = this.precisionStroke;
    const surface = layer.surface;
    if (!state || !surface || state.layerId !== layer.id) return;
    const dabs = state.planner.add(point);
    if (!dabs.length) return;
    // Index only NEW dabs. Never revisit the full stroke bounds or retain points.
    const batches = brushTileBatches(dabs, surface.grid);
    let admissionBytes = state.cacheBytes;
    for (const key of batches.keys()) if (!state.tiles.has(key)) {
      const tile = surface.grid.parseKey(key);
      // Base + output + coverage + worst-case before/after history copies.
      admissionBytes += tile.width * tile.height * (params.imageTip ? 80 : 68);
    }
    if (admissionBytes > 128 * 1024 * 1024) throw new Error("Stroke exceeds the 128 MiB working-set limit; use shorter strokes or a smaller brush");
    state.cacheBytes = admissionBytes;
    for (const [key, batch] of batches) {
      const tile = surface.grid.parseKey(key);
      let cached = state.tiles.get(key);
      if (!cached) {
        state.before.set(key, surface.store.read(key));
        const base = surface.tileToWorkingFloat32(key);
        cached = { base, values: new Float32Array(base.length), coverage: {} };
        state.tiles.set(key, cached);
      }
      const { values, base } = cached;
      values.set(base);
      replayStrokeFloat({
        width: tile.width,
        height: tile.height,
        data: values,
        originX: tile.x,
        originY: tile.y,
      }, { layerId: layer.id, params, points: [] }, state.workingColor, { dabs: batch, cache: cached.coverage });
      if (this.doc.selection) {
        const selection = this.selectionTileForLayer(layer, tile.x, tile.y, tile.width, tile.height);
        if (!selection) continue;
        for (let pixel = 0; pixel < tile.width * tile.height; pixel += 1) {
          const alpha = selection[pixel * 4 + 3] / 255;
          for (let channel = 0; channel < 4; channel += 1) {
            const offset = pixel * 4 + channel;
            values[offset] = base[offset] * (1 - alpha) + values[offset] * alpha;
          }
        }
      }
      surface.writeWorkingFloat32Tile(tile.key, values);
      this.updateLayerBitmapTile(layer, tile.key);
      this.virtualDirty.invalidate(tile, params.size + 2);
      this.requestRender(this.strokeDirtyRegion(layer, { ...params, size: 0, scatter: 0 },
        { x: tile.x, y: tile.y, p: 1 }, { x: tile.x + tile.width, y: tile.y + tile.height, p: 1 }));
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
    const localDestination = documentPointToLayer(layer.transform, destination.x, destination.y);
    const localSource = sourcePoint ? documentPointToLayer(layer.transform, sourcePoint.x, sourcePoint.y) : null;
    if (!localDestination || (sourcePoint && !localSource)) return false;
    this.retouchStroke = {
      layerId,
      mode,
      params: { ...params, mode: "paint" },
      points: [],
      before: new Map(),
      source: layer.surface.clone(),
      sourceOffsetX: (localSource?.x ?? localDestination.x) - localDestination.x,
      sourceOffsetY: (localSource?.y ?? localDestination.y) - localDestination.y,
    };
    this.retouchTo(layerId, destination);
    return true;
  }

  retouchTo(layerId: string, point: BrushPoint) {
    const state = this.retouchStroke;
    const layer = this.findLayer(layerId);
    const surface = layer?.surface;
    if (!state || !layer || !surface || state.layerId !== layerId) return;
    const local = documentPointToLayer(layer.transform, point.x, point.y);
    if (!local) return;
    point = { ...point, x: local.x, y: local.y };
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
    const repairOffsets = state.mode === "remove" || state.mode === "spot-heal"
      ? planRepairOffsets(dabs, (x, y) => state.source.sampleBilinearWorking(x, y)) : undefined;
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
        repairOffsets,
        sample: (x, y) => state.source.sampleBilinearWorking(x, y),
      });
      if (this.doc.selection && beforeValues) {
        const selection = this.selectionTileForLayer(layer, tile.x, tile.y, tile.width, tile.height);
        if (!selection) continue;
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

  /** Regional edits retain bounded pixel/tile diffs until history publication succeeds. */
  private editRegionTransaction(layer: Layer, region: PixelRect, label: string, edit: (ctx: CanvasRenderingContext2D) => boolean | void) {
    const bitmap = layer.bitmap!;
    const surface = layer.surface;
    if (surface && (surface.grid.width !== bitmap.width || surface.grid.height !== bitmap.height)) {
      throw new Error("This edit requires full-resolution pixels, not a large-document preview proxy.");
    }
    const addresses = surface?.grid.tilesIntersecting(region) ?? [];
    const tileBytes = addresses.reduce((sum, tile) => sum + surface!.grid.byteLength(tile, surface!.format), 0);
    const release = this.reserveOperationMemory(tileBytes * 2 + region.width * region.height * 8);
    try {
      this.bindDocumentMemory(this.doc);
      surface?.store.assertRegionCapacity(region);
      const tiles = addresses.map(tile => ({ key: tile.key, data: surface!.store.read(tile.key) }));
      const ctx = bitmap.getContext("2d")!;
      const before = ctx.getImageData(region.x, region.y, region.width, region.height);
      const node = this.history.current;
      try {
        ctx.save();
        let changed: boolean | void;
        try { ctx.setTransform(1, 0, 0, 1, 0, 0); changed = edit(ctx); }
        finally { ctx.restore(); }
        if (changed === false) return false;
        bumpBitmapVersion(bitmap);
        this.syncLayerSurface(layer, region);
        const after = ctx.getImageData(region.x, region.y, region.width, region.height);
        const surfacePatches = surface && surface.format !== "rgba8"
          ? tiles.map(tile => ({ layerId: layer.id, key: tile.key, before: tile.data, after: surface.store.read(tile.key), updateBitmap: false })) : undefined;
        this.commit({ label, before: [], after: [], pixelPatches: [{ layerId: layer.id, target: "bitmap", x: region.x, y: region.y, before, after }], surfacePatches });
      } catch (error) {
        if (this.history.current === node) {
          ctx.putImageData(before, region.x, region.y); bumpBitmapVersion(bitmap);
          if (layer.surface !== surface) layer.surface?.store.unbindMemoryBudget();
          layer.surface = surface;
          if (surface) {
            for (const tile of tiles) if (!tile.data) surface.store.delete(tile.key);
            for (const tile of tiles) if (tile.data) surface.store.write(tile.key, tile.data);
          }
          this.bindDocumentMemory(this.doc); this.requestRender();
        }
        throw error;
      }
      this.checkpointLayerSurface(layer); this.requestRender();
      return true;
    } finally { release(); }
  }

  fillLayer(layerId: string, color: string, opacity = 1) {
    const layer = this.findLayer(layerId);
    if (!layer || layer.kind !== "raster" || (!layer.bitmap && !layer.surface) || layer.locked) return;
    if (!layer.bitmap && layer.surface) return this.fillPrecisionPixels(layer, color, opacity);
    const region = filterRegionForSelection(this.doc, layer);
    if (!region) return;
    const release = this.reserveOperationMemory(region.width * region.height * 32);
    try {
    const fillOpacity = Math.max(0, Math.min(1, Number.isFinite(opacity) ? opacity : 1));
    const changed = this.editRegionTransaction(layer, region, `Filled with ${color}`, ctx => {
    if (this.doc.selection) {
      const scratch = newCanvas(region.width, region.height);
      const sctx = scratch.getContext("2d")!;
      sctx.fillStyle = color;
      sctx.globalAlpha = fillOpacity;
      sctx.fillRect(0, 0, region.width, region.height);
      sctx.globalAlpha = 1;
      sctx.globalCompositeOperation = "destination-in";
      const mask = newCanvas(region.width, region.height);
      const maskData = this.selectionTileForLayer(layer, region.x, region.y, region.width, region.height);
      if (!maskData) return false;
      mask.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(maskData), region.width, region.height), 0, 0);
      sctx.drawImage(mask, 0, 0);
      ctx.drawImage(scratch, region.x, region.y);
    } else {
      ctx.fillStyle = color;
      ctx.globalAlpha = fillOpacity;
      ctx.fillRect(region.x, region.y, region.width, region.height);
    }
    });
    if (changed) this.actions.push({ op: "fill", color, opacity: fillOpacity });
    } finally { release(); }
  }

  private fillPrecisionPixels(layer: Layer, color: string, opacity: number) {
    const surface = layer.surface!, region = filterRegionForSelection(this.doc, layer);
    const strength = Math.max(0, Math.min(1, Number.isFinite(opacity) ? opacity : 1));
    if (!region || !strength) return;
    // Admit geometry before enumerating tiles or decoding source pixels.
    if (region.width * region.height * 32 > 128 * 1024 * 1024) throw new Error("Fill would exceed the 128 MiB tile-history limit. Select a smaller area.");
    const tiles = surface.grid.tilesIntersecting(region);
    const bytes = tiles.reduce((sum, tile) => sum + surface.grid.byteLength(tile, surface.format) * 2, 0);
    if (bytes > 128 * 1024 * 1024) throw new Error("Fill would exceed the 128 MiB tile-history limit. Select a smaller area.");
    const release = this.reserveOperationMemory(bytes * 2 + 16 * 1024 * 1024);
    const patches: SurfaceTilePatch[] = [];
    try {
      this.bindDocumentMemory(this.doc);
      surface.store.assertRegionCapacity(region);
      const sample = newCanvas(1, 1).getContext("2d")!;
      sample.fillStyle = color; sample.fillRect(0, 0, 1, 1);
      const rgba = sample.getImageData(0, 0, 1, 1).data;
      const rgb = displaySrgbToWorking([rgba[0] / 255, rgba[1] / 255, rgba[2] / 255], surface.colorSpace);
      for (const tile of tiles) {
        const alpha = this.doc.selection ? this.selectionTileForLayer(layer, tile.x, tile.y, tile.width, tile.height) : null;
        if (this.doc.selection && !alpha) continue;
        const values = surface.tileToWorkingFloat32(tile.key);
        let changed = false;
        for (let pixel = 0; pixel < tile.width * tile.height; pixel++) {
          const a = strength * rgba[3] / 255 * (alpha ? alpha[pixel * 4 + 3] / 255 : 1);
          if (!a) continue;
          const offset = pixel * 4, oldAlpha = values[offset + 3], outAlpha = a + oldAlpha * (1 - a);
          for (let c = 0; c < 3; c++) values[offset + c] = (rgb[c] * a + values[offset + c] * oldAlpha * (1 - a)) / outAlpha;
          values[offset + 3] = outAlpha; changed = true;
        }
        if (!changed) continue;
        const patch: SurfaceTilePatch = { layerId: layer.id, key: tile.key, before: surface.store.read(tile.key), after: null, updateBitmap: false };
        patches.push(patch);
        surface.writeWorkingFloat32Tile(tile.key, values);
        patch.after = surface.store.read(tile.key);
      }
      if (!patches.length) return;
      this.commit({ label: `Filled with ${color}`, before: [], after: [], surfacePatches: patches });
      this.actions.push({ op: "fill", color, opacity: strength });
      this.checkpointLayerSurface(layer); this.requestRender();
    } catch (error) {
      for (const patch of patches) {
        if (patch.before) surface.store.write(patch.key, patch.before); else surface.store.delete(patch.key);
      }
      this.requestRender(); throw error;
    } finally { release(); }
  }

  clearPixels(layerId: string) {
    const layer = this.findLayer(layerId);
    if (!layer || layer.kind !== "raster" || (!layer.bitmap && !layer.surface) || layer.locked) return;
    if (layer.surface) return this.clearPrecisionPixels(layer);
    if (!layer.bitmap) return;
    const region = filterRegionForSelection(this.doc, layer);
    if (!region) return;
    if (region.width * region.height > 16 * 1024 * 1024) throw new Error("Delete is limited to 16 megapixels on legacy bitmap layers. Select a smaller area.");
    const release = this.reserveOperationMemory(region.width * region.height * 24);
    try {
    const changed = this.editRegionTransaction(layer, region, "Pixels cleared", ctx => {
    if (this.doc.selection) {
      ctx.globalCompositeOperation = "destination-out";
      const mask = newCanvas(region.width, region.height);
      const maskData = this.selectionTileForLayer(layer, region.x, region.y, region.width, region.height);
      if (!maskData) return false;
      mask.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(maskData), region.width, region.height), 0, 0);
      ctx.drawImage(mask, region.x, region.y);
    } else {
      ctx.clearRect(region.x, region.y, region.width, region.height);
    }
    });
    if (changed) this.actions.push({ op: "clear" });
    } finally { release(); }
  }

  private clearPrecisionPixels(layer: Layer) {
    const surface = layer.surface!;
    const region = filterRegionForSelection(this.doc, layer);
    if (!region) return;
    if (surface.store.sourceState() && region.width * region.height * 32 > 128 * 1024 * 1024) throw new Error("Delete would exceed the 128 MiB tile-history limit. Select a smaller area.");
    this.bindDocumentMemory(this.doc);
    const keys = [...surface.store.keys()].filter(key => {
      const tile = surface.grid.parseKey(key);
      return tile.x < region.x + region.width && tile.y < region.y + region.height && tile.x + tile.width > region.x && tile.y + tile.height > region.y;
    });
    const bytes = keys.reduce((total, key) => total + surface.grid.byteLength(surface.grid.parseKey(key), surface.format) * 2, 0);
    if (bytes > 128 * 1024 * 1024) throw new Error("Delete would exceed the 128 MiB tile-history limit. Select a smaller area.");
    const release = this.reserveOperationMemory(bytes + 16 * 1024 * 1024);
    const patches: SurfaceTilePatch[] = [];
    try {
      for (const key of keys) {
        const tile = surface.grid.parseKey(key);
        const alpha = this.doc.selection ? this.selectionTileForLayer(layer, tile.x, tile.y, tile.width, tile.height) : null;
        if (this.doc.selection && !alpha) continue;
        const values = surface.tileToWorkingFloat32(key);
        let changed = false;
        for (let pixel = 0; pixel < tile.width * tile.height; pixel++) {
          const coverage = alpha ? alpha[pixel * 4 + 3] / 255 : 1;
          const index = pixel * 4 + 3;
          if (coverage > 0 && values[index] > 0) { values[index] *= 1 - coverage; changed = true; }
        }
        if (!changed) continue;
        const patch: SurfaceTilePatch = { layerId: layer.id, key, before: surface.store.read(key), after: null, updateBitmap: Boolean(layer.bitmap) };
        patches.push(patch);
        surface.writeWorkingFloat32Tile(key, values);
        patch.after = surface.store.read(key);
        this.updateLayerBitmapTile(layer, key);
      }
      if (!patches.length) return;
      this.commit({ label: "Selected pixels deleted", before: [], after: [], surfacePatches: patches });
      this.checkpointLayerSurface(layer);
      this.actions.push({ op: "clear" });
      this.requestRender();
    } catch (error) {
      for (const patch of patches) {
        if (patch.before) surface.store.write(patch.key, patch.before); else surface.store.delete(patch.key);
        this.updateLayerBitmapTile(layer, patch.key);
      }
      this.requestRender();
      throw error;
    } finally { release(); }
  }

  async selectSubject(layerId: string, mode: SelectionMode = "replace", onProgress?: (message: string, pct: number) => void) {
    const assertCurrent = this.guardDocumentOperation("Select Subject");
    const layer = this.findLayer(layerId);
    if (!layer?.bitmap || layer.kind !== "raster") throw new Error("Select Subject needs a raster layer; use Quick Selection for tiled layers.");
    const scale = Math.min(1, 1024 / Math.max(layer.bitmap.width, layer.bitmap.height));
    const preview = newCanvas(Math.max(1, Math.round(layer.bitmap.width * scale)), Math.max(1, Math.round(layer.bitmap.height * scale)));
    preview.getContext("2d")!.drawImage(layer.bitmap, 0, 0, preview.width, preview.height);
    const { neuralMatte } = await import("./neural");
    assertCurrent();
    const matte = await neuralMatte(preview, onProgress);
    assertCurrent();
    this.commitSelection("Select Subject", () => selectTransformedMask(this.doc, matte, {
      ...layer.transform, sx: layer.transform.sx * layer.bitmap!.width / preview.width, sy: layer.transform.sy * layer.bitmap!.height / preview.height,
    }, mode));
  }

  invertMask(layerId: string) {
    const layer = this.findLayer(layerId);
    if (!layer || layer.locked) return;
    const before = [this.maskSnapshot(layer)];
    invertMaskInPlace(layer, this.doc.width, this.doc.height);
    this.commit({ label: "Mask inverted", before, after: [this.maskSnapshot(layer)] });
    this.actions.push({ op: "invertMask" });
    this.requestRender();
  }

  /**
   * Why this layer's mask cannot be cleared, or null if it can.
   *
   * clearMask returns void, so "Reveal all" on a locked layer did nothing and
   * said nothing. The operation and the explanation have to share one set of
   * conditions or they drift apart, which is why clearMask consults this rather
   * than repeating the checks.
   */
  clearMaskRefusal(layerId: string): string | null {
    const layer = this.findLayer(layerId);
    if (!layer) return "Select a layer first.";
    if (!hasLayerMask(layer)) return "This layer has no mask to reveal.";
    if (layer.locked) return "Unlock this layer first.";
    return null;
  }

  clearMask(layerId: string) {
    const layer = this.findLayer(layerId);
    // A locked layer must not lose its mask — this is destructive.
    if (!layer || this.clearMaskRefusal(layerId)) return;
    const before = [this.maskSnapshot(layer)];
    clearMaskInPlace(layer, this.doc.width, this.doc.height);
    this.commit({ label: "Mask cleared", before, after: [this.maskSnapshot(layer)] });
    this.actions.push({ op: "clearMask" });
    this.requestRender();
  }

  featherMask(layerId: string, radius: number) {
    const layer = this.findLayer(layerId);
    if (!layer || layer.locked || !hasLayerMask(layer) || !Number.isFinite(radius) || radius <= 0) return false;
    const before = layerMaskSurface(layer, this.doc.width, this.doc.height)!.clone();
    featherMaskInPlace(layer, this.doc.width, this.doc.height, radius);
    const keys = new Set([...before.keys(), ...layer.maskSurface!.keys()]);
    const maskSurfacePatches = [...keys].map((key): LayerMaskTilePatch => ({
      layerId,
      key,
      before: before.record(key),
      after: layer.maskSurface!.record(key),
    }));
    this.commit({ label: `Mask feather ${radius}px`, before: [], after: [], maskSurfacePatches });
    this.requestRender();
    return true;
  }

  private maskSnapshot(layer: Layer): LayerSnapshot {
    const present = hasLayerMask(layer);
    return {
      layerId: layer.id,
      maskPresent: present,
      maskSurface: present ? layerMaskSurface(layer, this.doc.width, this.doc.height)!.clone() : undefined,
    };
  }

  // Neural subject mask via MODNet. Falls back to the luma threshold if the
  // model fails to load (offline, blocked CDN, etc.).
  async neuralSubject(
    layerId: string,
    onProgress?: (msg: string, pct: number) => void,
  ): Promise<{ used: "neural" | "luma" }> {
    const assertCurrent = this.guardDocumentOperation("neural masking");
    const layer = this.findLayer(layerId);
    if (!layer || layer.kind !== "raster" || !layer.bitmap) {
      throw new Error("Neural subject needs a raster layer");
    }
    if (layer.locked) throw new Error("Unlock the layer before changing its mask");
    try {
      const { neuralMatte } = await import("./neural");
      assertCurrent();
      const matte = await neuralMatte(layer.bitmap, onProgress);
      assertCurrent();
      const before = [this.maskSnapshot(layer)];
      setLayerMaskFromCanvas(layer, matte, this.doc.width, this.doc.height);
      this.commit({
        label: "Neural subject mask",
        before,
        after: [this.maskSnapshot(layer)],
      });
      this.actions.push({ op: "autoSubject" });
      this.requestRender();
      return { used: "neural" };
    } catch (err) {
      assertCurrent();
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
      endpoint?: string;
      controls?: Partial<AiOperationControls>;
      quality?: AiEditQuality;
      size?: "auto" | `${number}x${number}`;
      variations?: number;
      signal?: AbortSignal;
      onVariation?: (completed: number, total: number) => void;
      /** Explicit raster output in a new document; original layered document stays untouched. */
      geometryCopy?: AiGeometryCopy;
    } = {},
  ) {
    const assertCurrent = this.guardDocumentOperation("AI editing");
    const source = this.findLayer(layerId);
    if (!source || source.kind === "group") throw new Error("Select a content layer");
    if (options.geometryCopy && options.geometryCopy.mode !== operation) throw new Error("AI geometry mode must match the operation");
    const geometry = options.geometryCopy ? planAiGeometryCopy(this.doc.width, this.doc.height, options.geometryCopy) : undefined;
    if (geometry) normalizeAiEditConfig({ operation, prompt, controls: options.controls, size: geometry.requestSize });
    const work = geometry?.work ?? planAiWorkRegion(
      this.doc.width,
      this.doc.height,
      this.doc.selection?.bounds,
      this.displayViewport,
    );
    const variationCount = Math.max(1, Math.min(4, options.variations ?? 1));
    const release = this.reserveOperationMemory(work.outputWidth * work.outputHeight * 48 + (geometry ? geometry.outputWidth * geometry.outputHeight : work.outputWidth * work.outputHeight) * 32 * variationCount + (geometry ? 8_294_400 * 4 : 0));
    const preparedLayers: Layer[] = [];
    let installed = false;
    try {
    const composite = newCanvas(work.outputWidth, work.outputHeight);
    renderViewport(this.doc, composite, {
      x: work.x,
      y: work.y,
      width: work.width,
      height: work.height,
      zoom: work.outputWidth / work.width,
      outputWidth: work.outputWidth,
      outputHeight: work.outputHeight,
      cssScale: work.outputWidth / work.width,
      devicePixelRatio: 1,
    }, {
      checkerboard: false,
      selectionOverlay: false,
      proofing: false,
      cacheRevision: this.renderRevision,
      hierarchyRevision: this.layerHierarchyRevision,
    });
    const image = await canvasToBlob(composite);
    assertCurrent();
    const identityLayer = this.doc.layers.find((layer) => layer.identityReference && layer.id !== layerId);
    let referenceBlob: Blob | undefined;
    if (identityLayer) {
      const reference = newCanvas(work.outputWidth, work.outputHeight);
      renderViewport({ ...this.doc, layers: [identityLayer], selection: null }, reference, {
        x: work.x,
        y: work.y,
        width: work.width,
        height: work.height,
        zoom: work.outputWidth / work.width,
        outputWidth: work.outputWidth,
        outputHeight: work.outputHeight,
        cssScale: work.outputWidth / work.width,
        devicePixelRatio: 1,
      }, { checkerboard: false, selectionOverlay: false, proofing: false });
      referenceBlob = await canvasToBlob(reference);
      assertCurrent();
    }
    let maskBlob: Blob | undefined;
    let selectionGuide: AiSelectionGuide = { mode: "none" };
    if (geometry && operation === "expand") {
      // Opaque original area is protected; only the transparent extension is
      // editable. Selection state never changes the meaning of canvas expansion.
      const mask = newCanvas(work.outputWidth, work.outputHeight);
      const ctx = mask.getContext("2d")!;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(geometry.paddingX * work.outputWidth / work.width, geometry.paddingY * work.outputHeight / work.height,
        this.doc.width * work.outputWidth / work.width, this.doc.height * work.outputHeight / work.height);
      maskBlob = await canvasToBlob(mask);
      assertCurrent();
      selectionGuide = { mode: "selection", coverage: 1 - this.doc.width * this.doc.height / (work.width * work.height) };
    } else if (this.doc.selection && !geometry) {
      const localMask = newCanvas(work.outputWidth, work.outputHeight);
      const localContext = localMask.getContext("2d")!;
      const selection = selectionRegionCanvas(this.doc, {
        x: work.x,
        y: work.y,
        width: work.width,
        height: work.height,
      });
      if (selection) localContext.drawImage(selection, 0, 0, work.outputWidth, work.outputHeight);
      const input = localContext.getImageData(0, 0, work.outputWidth, work.outputHeight);
      const alpha = new Uint8Array(work.outputWidth * work.outputHeight);
      for (let pixel = 0; pixel < alpha.length; pixel += 1) alpha[pixel] = input.data[pixel * 4 + 3];
      const editMask = selectionAlphaToEditMask(alpha, work.outputWidth, work.outputHeight);
      const mask = newCanvas(work.outputWidth, work.outputHeight);
      const output = mask.getContext("2d")!.createImageData(work.outputWidth, work.outputHeight);
      output.data.set(editMask.data);
      mask.getContext("2d")!.putImageData(output, 0, 0);
      maskBlob = await canvasToBlob(mask);
      assertCurrent();
      selectionGuide = editMask.guide;
    }
    const [inputSha256, maskSha256, referenceSha256] = await Promise.all([
      sha256Blob(image),
      maskBlob ? sha256Blob(maskBlob) : Promise.resolve(undefined),
      referenceBlob ? sha256Blob(referenceBlob) : Promise.resolve(undefined),
    ]);
    const total = options.variations ?? 1;
    assertCurrent();
    let completed = 0;
    const results = await runAiEditVariations({
      endpoint: options.endpoint,
      image,
      mask: maskBlob,
      reference: referenceBlob,
      operation,
      prompt,
      controls: options.controls,
      quality: options.quality,
      size: geometry?.requestSize ?? options.size,
      selection: selectionGuide,
      variations: total,
      signal: options.signal,
      onVariation: () => options.onVariation?.(++completed, total),
    });
    assertCurrent();
    const layers = preparedLayers;
    let original: HTMLCanvasElement | undefined;
    if (geometry && operation === "expand") {
      original = newCanvas(this.doc.width, this.doc.height);
      renderClean(this.doc, original);
    }
    for (const result of results) {
      const bitmap = await blobToCanvas(result.image, geometry?.outputWidth ?? work.outputWidth, geometry?.outputHeight ?? work.outputHeight);
      assertCurrent();
      options.signal?.throwIfAborted();
      if (original && geometry) {
        const ctx = bitmap.getContext("2d")!;
        ctx.clearRect(geometry.paddingX, geometry.paddingY, original.width, original.height);
        ctx.drawImage(original, geometry.paddingX, geometry.paddingY);
      }
      const layer = createRasterLayer(`AI · ${operation}${total > 1 ? ` · ${result.index + 1}` : ""}`, bitmap);
      layers.push(layer);
      layer.transform = {
        tx: geometry ? 0 : work.x,
        ty: geometry ? 0 : work.y,
        sx: geometry ? 1 : work.width / work.outputWidth,
        sy: geometry ? 1 : work.height / work.outputHeight,
        rotation: 0,
      };
      layer.surface = this.surfaceFromCanvas(bitmap);
      const config = normalizeAiEditConfig({
        operation,
        prompt,
        controls: options.controls,
        quality: options.quality,
        size: geometry?.requestSize ?? options.size,
        selection: selectionGuide,
        variationIndex: result.index,
        sourceDigest: inputSha256,
        maskDigest: maskSha256,
        referenceDigest: referenceSha256,
      });
      layer.ai = {
        id: result.provenanceId ?? nextId("ai"),
        operation,
        provider: "openai",
        model: result.model ?? "gpt-image-2",
        prompt,
        createdAt: new Date().toISOString(),
        sourceLayerIds: [layerId, ...(identityLayer ? [identityLayer.id] : [])],
        usedSelection: selectionGuide.mode !== "none",
        requestId: result.upstreamRequestId,
        inputSha256,
        maskSha256,
        referenceSha256,
        parameters: {
          quality: config.quality,
          size: config.size,
          variationIndex: config.variationIndex,
          controls: config.controls,
          selection: config.selection,
          identityReferenceLayerId: identityLayer?.id,
          workRegion: { ...work },
          ...(geometry ? { geometryCopy: { ...options.geometryCopy!, width: geometry.outputWidth, height: geometry.outputHeight } } : {}),
        },
      };
    }
    assertCurrent();
    const label = `AI ${operation} · ${layers.length} variation${layers.length === 1 ? "" : "s"}`;
    if (geometry) {
      const document = createDocument(geometry.outputWidth, geometry.outputHeight);
      document.bitDepth = this.doc.bitDepth;
      document.colorSpace = this.doc.colorSpace;
      document.resolution = { ...this.doc.resolution };
      document.layers = layers;
      layers.forEach((layer, i) => { layer.visible = i === 0; });
      // Prepare memory and history before switching away from the source tab.
      this.ensureDocumentSurfaces(document);
      const history = this.createSessionHistory();
      history.commit(label, { label, before: [], after: [], layersBefore: [], layersAfter: layers.map(shallowCloneLayer) });
      const name = `${this.activeDocumentState().name} · AI ${operation}`;
      this.installDocument(document, name);
      this.history = history;
      this.saveActiveSession();
    } else {
      this.commitStructural(label, () => this.doc.layers.unshift(...layers));
    }
    installed = true;
    for (const layer of layers) this.checkpointLayerSurface(layer);
    this.requestRender();
    return layers;
    } finally {
      if (!installed) for (const layer of preparedLayers) layer.surface?.store.unbindMemoryBudget();
      release();
    }
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
  ): Promise<{ used: "sam" | "wand"; reason?: string }> {
    const assertCurrent = this.guardDocumentOperation("SAM selection");
    const layer = this.findLayer(layerId);
    if (!layer || layer.kind !== "raster" || !layer.bitmap) {
      throw new Error("SAM needs a raster layer");
    }
    const local = documentPointToLayer(layer.transform, x, y);
    if (!local || local.x < 0 || local.y < 0 || local.x >= layer.bitmap.width || local.y >= layer.bitmap.height) throw new Error("Click inside the selected layer");
    const scale = Math.min(1, 1024 / Math.max(layer.bitmap.width, layer.bitmap.height));
    const preview = newCanvas(Math.max(1, Math.round(layer.bitmap.width * scale)), Math.max(1, Math.round(layer.bitmap.height * scale)));
    preview.getContext("2d")!.drawImage(layer.bitmap, 0, 0, preview.width, preview.height);
    const sx = preview.width / layer.bitmap.width, sy = preview.height / layer.bitmap.height;
    try {
      const { samClickMask } = await import("./neural");
      assertCurrent();
      const mask = await samClickMask(preview, local.x * sx, local.y * sy, onProgress);
      assertCurrent();
      this.commitSelection("SAM click select", () => selectTransformedMask(this.doc, mask, { ...layer.transform, sx: layer.transform.sx / sx, sy: layer.transform.sy / sy }, mode));
      return { used: "sam" };
    } catch (err) {
      assertCurrent();
      console.warn("SAM failed, falling back to magic wand", err);
      this.selectByColor(layerId, x, y, 24, mode);
      return { used: "wand", reason: err instanceof Error ? err.message.slice(0, 240) : "Local model unavailable" };
    }
  }

  autoLumaMask(layerId: string) {
    const layer = this.findLayer(layerId);
    if (!layer || layer.locked) return;
    if (layer?.surface?.store.sourceState()) throw new Error("Automatic luma masks are not supported on source-backed layers yet. Manual selection and mask painting remain available.");
    if (!layer || layer.kind !== "raster" || !layer.bitmap) return;
    const before = [this.maskSnapshot(layer)];
    if (!autoLumaMaskInPlace(layer, this.doc.width, this.doc.height)) return;
    this.commit({ label: "Auto subject mask", before, after: [this.maskSnapshot(layer)] });
    this.actions.push({ op: "autoSubject" });
    this.requestRender();
  }

  // --- selection ---
  hasPixelClipboard() { return this.pixelClipboard !== null; }

  /** Covers native decode, IPC, browser decode and insertion; release even on refusal. */
  beginClipboardImport() {
    const assertCurrent = this.guardDocumentOperation("clipboard paste");
    const release = this.reserveOperationMemory(512 * 1024 * 1024);
    return { assertCurrent, release };
  }

  copyPixels(layerId?: string, merged = false) {
    const layer = layerId ? this.findLayer(layerId) : undefined;
    if (!merged && !layer) throw new Error("Select a layer to copy");
    const region = clipboardRegion(this.doc);
    const release = this.reserveOperationMemory(region.width * region.height * 24);
    try {
      const next = captureSelectedPixels(this.doc, merged ? undefined : layer);
      this.pixelClipboard = next;
      this.emit();
      return next.canvas;
    } finally { release(); }
  }

  cutPixels(layerId: string) {
    const layer = this.findLayer(layerId);
    if (!layer || layer.locked || layer.kind !== "raster" || (!layer.bitmap && !layer.surface)) throw new Error("Cut needs an unlocked raster layer");
    if (this.doc.bitDepth !== 8) throw new Error("Pixel clipboard is 8-bit. Use Copy or duplicate the layer to preserve high-depth originals; Cut is disabled.");
    const previous = this.pixelClipboard;
    const canvas = this.copyPixels(layerId);
    try { this.clearPixels(layerId); }
    catch (error) { this.pixelClipboard = previous; throw error; }
    return canvas;
  }

  /** Capture first; never delete before the OS has accepted a native Cut. */
  preparePixelCut(layerId: string) {
    const layer = this.findLayer(layerId);
    if (!layer || layer.locked || layer.kind !== "raster" || (!layer.bitmap && !layer.surface)) throw new Error("Cut needs an unlocked raster layer");
    if (this.doc.bitDepth !== 8) throw new Error("Cut is disabled for high-depth originals; use Copy or duplicate the layer.");
    const canvas = this.copyPixels(layerId);
    const clipboard = this.pixelClipboard;
    const assertCurrent = this.guardDocumentOperation("clipboard cut");
    let completed = false;
    return { canvas, complete: () => {
      if (completed) throw new Error("Cut was already completed");
      assertCurrent();
      if (this.pixelClipboard !== clipboard) throw new Error("Clipboard changed during Cut; original pixels were kept");
      this.clearPixels(layerId);
      completed = true;
    } };
  }

  pastePixels(inPlace = false) {
    const clip = this.pixelClipboard;
    if (!clip) throw new Error("Copy or cut pixels before pasting");
    const release = this.reserveOperationMemory(clip.canvas.width * clip.canvas.height * 24);
    try {
      const bitmap = cloneCanvas(clip.canvas);
      const layer = createRasterLayer("Pasted pixels", bitmap);
      layer.surface = this.surfaceFromCanvas(bitmap);
      layer.transform.tx = inPlace ? clip.x : Math.round((this.doc.width - bitmap.width) / 2);
      layer.transform.ty = inPlace ? clip.y : Math.round((this.doc.height - bitmap.height) / 2);
      this.commitStructural("Paste pixels", () => this.doc.layers.unshift(layer));
      this.checkpointLayerSurface(layer);
      this.requestRender();
      return layer;
    } finally { release(); }
  }

  selectionToLayer(layerId: string) {
    const previous = this.pixelClipboard;
    try { this.copyPixels(layerId); return this.pastePixels(true); }
    finally { this.pixelClipboard = previous; }
  }

  private commitSelection(label: string, mutate: () => void) {
    const before = cloneSelection(this.doc.selection);
    try {
      if (this.selectionGesture?.doc === this.doc) { mutate(); this.bindDocumentMemory(this.doc); this.markTransientDirty(); }
      else this.commit(withSelectionCommit(this.doc, label, mutate));
    }
    catch (error) { this.doc.selection = before; this.bindDocumentMemory(this.doc); throw error; }
    this.requestRender();
  }

  beginSelectionGesture(mode: SelectionMode = "replace") {
    this.cancelSelectionGesture();
    this.selectionGesture = { doc: this.doc, before: cloneSelection(this.doc.selection), mode, accumulated: null };
  }

  endSelectionGesture() {
    const gesture = this.selectionGesture;
    if (!gesture) return;
    this.selectionGesture = null;
    if (gesture.doc !== this.doc) { gesture.doc.selection = gesture.before; return; }
    try {
      this.commit({ label: "Quick selection stroke", before: [], after: [], selectionBefore: gesture.before, selectionAfter: cloneSelection(this.doc.selection) });
    } catch (error) {
      this.doc.selection = gesture.before;
      this.bindDocumentMemory(this.doc);
      this.clearTransientDirtyIfSettled();
      this.requestRender();
      throw error;
    }
    this.clearTransientDirtyIfSettled();
    this.requestRender();
  }

  cancelSelectionGesture() {
    const gesture = this.selectionGesture;
    if (!gesture) return;
    this.selectionGesture = null;
    gesture.doc.selection = gesture.before;
    this.bindDocumentMemory(this.doc);
    this.clearTransientDirtyIfSettled();
    this.emit();
    this.requestRender();
  }

  selectRect(x: number, y: number, w: number, h: number, mode: SelectionMode = "replace", feather = 0) {
    this.commitSelection("Selection", () => selectRect(this.doc, x, y, w, h, mode, feather));
    return true;
  }
  selectEllipse(x: number, y: number, w: number, h: number, mode: SelectionMode = "replace", feather = 0) {
    this.commitSelection("Selection (ellipse)", () => selectEllipse(this.doc, x, y, w, h, mode, feather));
    return true;
  }
  selectLasso(points: Array<{ x: number; y: number }>, mode: SelectionMode = "replace", feather = 0) {
    this.commitSelection("Selection (lasso)", () => selectLasso(this.doc, points, mode, feather));
    return true;
  }
  selectByColor(layerId: string, x: number, y: number, tolerance: number, mode: SelectionMode = "replace", contiguous = true) {
    const layer = this.findLayer(layerId);
    if (!layer || layer.kind !== "raster" || (!layer.bitmap && !layer.surface)) return false;
    this.commitSelection("Magic wand", () => {
      const gesture = this.selectionGesture?.doc === this.doc ? this.selectionGesture : null;
      const target = gesture ? { ...this.doc, selection: gesture.accumulated } : this.doc;
      selectByColorTiled(target, {
      readRegion: (rect) => {
        const tile = newCanvas(rect.width, rect.height);
        drawLayerContentManaged(tile.getContext("2d")!, layer, {
          a: 1,
          b: 0,
          c: 0,
          d: 1,
          e: -rect.x,
          f: -rect.y,
        });
        return tile.getContext("2d")!.getImageData(0, 0, rect.width, rect.height);
      },
      }, x, y, tolerance, gesture ? "add" : mode, contiguous);
      if (gesture) {
        const incoming = selectionSurface(target)!;
        const original = gesture.before?.surface;
        const surface = original && gesture.mode !== "replace" ? original.combined(incoming, gesture.mode) : incoming;
        gesture.accumulated = target.selection;
        this.doc.selection = { surface, bounds: surface.bounds() };
      }
    });
    return true;
  }
  selectAll() {
    this.commitSelection("Select all", () => selectAll(this.doc));
    this.actions.push({ op: "selectAll" });
    return true;
  }
  deselect() {
    if (!this.doc.selection) return;
    this.commitSelection("Deselect", () => deselect(this.doc));
    this.actions.push({ op: "deselect" });
  }
  invertSelectionArea() {
    this.commitSelection("Invert selection", () => invertSelection(this.doc));
    this.actions.push({ op: "invertSelection" });
    return true;
  }
  featherSelection(radius: number) {
    this.commitSelection(`Feather ${radius}px`, () => featherSelection(this.doc, radius));
    this.actions.push({ op: "featherSelection", radius });
  }
  refineSelection(params: RefineSelectionParams) {
    if (!this.doc.selection) return false;
    const original = this.doc.selection;
    const release = this.reserveOperationMemory((original.surface?.stats().residentBytes ?? this.doc.width * this.doc.height) * 4);
    const node = this.history.current;
    try {
    const before = cloneSelection(this.doc.selection);
    this.doc.selection = cloneSelection(original);
    if (!refineSelection(this.doc, params)) return false;
    const after = cloneSelection(this.doc.selection);
    this.commit({ label: "Selection edge refined", before: [], after: [], selectionBefore: before, selectionAfter: after });
    this.requestRender();
    return true;
    } catch (error) {
      if (this.history.current === node) { this.doc.selection = original; this.bindDocumentMemory(this.doc); }
      throw error;
    } finally { release(); }
  }

  // --- filters ---
  prepareRecolor(layerId: string): RecolorSession {
    const layer=this.findLayer(layerId), reason=recolorUnavailableReason(this.doc,layer);
    if(reason)throw new Error(reason);
    if(this.isLayerLocked(layerId))throw new Error("Unlock the layer and its groups first");
    const bitmap=layer!.bitmap!, scale=Math.min(1,640/Math.max(bitmap.width,bitmap.height));
    const width=Math.max(1,Math.round(bitmap.width*scale)),height=Math.max(1,Math.round(bitmap.height*scale));
    const release=this.reserveOperationMemory(width*height*32);
    const preview=newCanvas(width,height);
    try {
      const ctx=preview.getContext("2d",{colorSpace:"srgb"})!;ctx.imageSmoothingEnabled=false;ctx.drawImage(bitmap,0,0,width,height);
      const session={layerId,documentId:this.activeSessionId,name:layer!.name,width:bitmap.width,height:bitmap.height,
        preview:ctx.getImageData(0,0,width,height),selection:recolorSelectionWeights(selectionSurface(this.doc),layer!,width,height),
        // Viewport resize/quality redraws are not document edits. History and
        // document ownership remain guarded throughout preview and processing.
        assertCurrent:this.guardDocumentOperation("recolor",this.activeSessionId,false),release};
      return session;
    } catch(error) {release();throw error;} finally {preview.width=1;preview.height=1;}
  }

  async applyRecolor(session: RecolorSession, input: RecolorParams, output: RecolorOutput, mode: SelectionMode = "replace", progress: RecolorProgress = {}) {
    session.assertCurrent();
    if(!["copy","pixels","selection","mask-keep","mask-remove"].includes(output)||!["replace","add","subtract","intersect"].includes(mode))throw new Error("Unknown recolor output");
    const p=validateRecolor(input),layer=this.findLayer(session.layerId),reason=recolorUnavailableReason(this.doc,layer);
    if(reason)throw new Error(reason);
    if(this.isLayerLocked(session.layerId))throw new Error("Unlock the layer and its groups first");
    const bitmap=layer!.bitmap!,width=bitmap.width,height=bitmap.height;
    if(layer!.mask && layer!.mask.width*layer!.mask.height>4_000_000)throw new Error("Convert the existing large legacy mask to sparse alpha first");
    const alphaOutput=output==="selection"||output==="mask-keep"||output==="mask-remove";
    const bounds=alphaOutput?recolorDocumentMaskBounds(this.doc,layer!):undefined;
    const selected=selectionSurface(this.doc);
    // Alpha stays sparse. Copy needs one output canvas and one output master;
    // destructive edits admit only the changed tile pairs as they are found.
    const releases=[this.reserveOperationMemory(16*1024*1024+
      (alphaOutput?width*height+bounds!.width*bounds!.height*4:output==="copy"?width*height*8:0)+
      (selected?.stats().residentBytes??0)*4+(layer!.maskSurface?.stats().residentBytes??0)*4+
      (layer!.mask?layer!.mask.width*layer!.mask.height*12:0))];
    let generated: HTMLCanvasElement|undefined;
    const originalSurface=layer!.surface;
    let nextSurface: PrecisionTileSurface|undefined;
    const patches: PixelPatch[]=[];
    const check=()=>{session.assertCurrent();if(progress.signal?.aborted)throw new Error("Recolor cancelled. No changes were applied.");};
    const advance=async(fraction:number)=>{progress.onProgress?.(fraction);await new Promise<void>(resolve=>setTimeout(resolve,0));check();};
    const admitSave=(document: Document,entry: HistoryEntry)=>{
      if(width*height<=4_000_000)return;
      // Do not publish a large edit that the existing save-with-history path
      // would immediately refuse. This deliberately retains conservative bounds.
      try {this.reserveOperationMemory(this.serializationMemory(document)+this.history.summary().bytes*3+historyEntrySize(entry)*4)();}
      catch {throw new Error("Recolor would leave insufficient memory to save this project with undo history. Use a smaller selected color range or layer; a recolored copy requires additional memory. No changes were applied.");}
    };
    try {
      check();
      const ctx=bitmap.getContext("2d")!,grid=new TileGrid(width,height);
      const tiles=grid.tilesIntersecting({x:0,y:0,width,height});
      const localAlpha=alphaOutput?new SparseAlphaSurface(width,height):undefined;
      if(!alphaOutput)nextSurface=originalSurface?.clone();
      if(output==="copy") {
        generated=newCanvas(width,height);generated.getContext("2d")!.drawImage(bitmap,0,0);
        nextSurface??=new PrecisionTileSurface(width,height,"rgba8","srgb");
      }
      const process=recolorProcessor(p);
      let matched=false;
      for(let index=0;index<tiles.length;index++) {
        const tile=tiles[index],before=ctx.getImageData(tile.x,tile.y,tile.width,tile.height);
        const after=new ImageData(before.data.slice(),tile.width,tile.height),mask=new Uint8Array(tile.width*tile.height);
        const selection=p.respectSelection?recolorSelectionWeights(selected,layer!,tile.width,tile.height,tile):undefined;
        process(after.data,mask,0,mask.length,selection);
        matched ||= mask.some(value=>value>0);
        if(localAlpha)localAlpha.writeTile(tile.key,mask);
        else {
          const changed=after.data.some((value,i)=>value!==before.data[i]);
          if(changed) {
            if(output==="pixels") {
              releases.push(this.reserveOperationMemory(tile.width*tile.height*(originalSurface?12:8)));
              patches.push({layerId:layer!.id,target:"bitmap",x:tile.x,y:tile.y,before,after});
            } else generated!.getContext("2d")!.putImageData(after,tile.x,tile.y);
            nextSurface?.updateFromImageData(after,tile.x,tile.y);
          } else if(output==="copy"&&!originalSurface)nextSurface!.updateFromImageData(before,tile.x,tile.y);
        }
        await advance((index+1)/tiles.length*(alphaOutput?.8:1));
      }
      if(!matched && p.mode!=="isolate")throw new Error("No pixels matched. Sample a color or widen the matching range.");
      if(alphaOutput) {
        let surface=new SparseAlphaSurface(this.doc.width,this.doc.height);
        const inverse=inverseAffineForLayerTransform(layer!.transform)!;
        const projected=surface.grid.tilesIntersecting(bounds!);
        for(let index=0;index<projected.length;index++) {
          const tile=projected[index],data=new Uint8Array(tile.width*tile.height);
          for(let y=0;y<tile.height;y++)for(let x=0;x<tile.width;x++) {
            const dx=tile.x+x+.5,dy=tile.y+y+.5;
            data[y*tile.width+x]=localAlpha!.sample(inverse.a*dx+inverse.c*dy+inverse.e,inverse.b*dx+inverse.d*dy+inverse.f);
          }
          surface.writeTile(tile.key,data);await advance(.8+.2*(index+1)/projected.length);
        }
        check();
        if(output==="selection") {
          const current=selectionSurface(this.doc);if(current && mode!=="replace")surface=current.combined(surface,mode);
          const selection={surface,bounds:surface.bounds()};
          admitSave({...this.doc,selection},{label:"Select recolor range",before:[],after:[],selectionBefore:this.doc.selection,selectionAfter:selection});
          this.commitSelection("Select recolor range",()=>{this.doc.selection=selection;});
        } else {
          if(output==="mask-remove")surface=surface.inverted();
          const previous=layer!.maskSurface??(layer!.mask?alphaSurfaceFromCanvas(layer!.mask):null);
          if(previous)surface=previous.combined(surface,"intersect");
          const oldMask=layer!.mask,oldSurface=layer!.maskSurface,node=this.history.current;
          const before: LayerSnapshot={layerId:layer!.id,maskPresent:Boolean(previous),maskSurface:previous?.clone()};
          const entry: HistoryEntry={label:output==="mask-keep"?"Mask to recolor range":"Mask out recolor range",before:[before],after:[{layerId:layer!.id,maskPresent:true,maskSurface:surface.clone()}]};
          admitSave({...this.doc,layers:this.doc.layers.map(item=>item===layer?{...item,mask:undefined,maskSurface:surface}:item)},entry);
          try {
            layer!.mask=undefined;layer!.maskSurface=surface;
            this.commit(entry);
          } catch(error) {
            if(this.history.current===node) {
              surface.unbindMemoryBudget();layer!.mask=oldMask;layer!.maskSurface=oldSurface;this.bindDocumentMemory(this.doc);
            }
            throw error;
          }
          this.requestRender();
        }
        return layer!.id;
      }
      if(output==="pixels") {
        if(!patches.length)return layer!.id;
        const node=this.history.current;
        const entry: HistoryEntry={label:"Recolor pixels",before:[],after:[],pixelPatches:patches};
        admitSave({...this.doc,layers:this.doc.layers.map(item=>item===layer?{...item,surface:nextSurface}:item)},entry);
        try {
          for(const patch of patches)ctx.putImageData(patch.after,patch.x,patch.y);
          layer!.surface=nextSurface;bumpBitmapVersion(bitmap);
          this.commit(entry);
        } catch(error) {
          if(this.history.current===node) {
            for(const patch of patches)ctx.putImageData(patch.before,patch.x,patch.y);
            nextSurface?.store.unbindMemoryBudget();layer!.surface=originalSurface;
            bumpBitmapVersion(bitmap);this.bindDocumentMemory(this.doc);
          }
          throw error;
        }
        this.checkpointLayerSurface(layer!);this.requestRender();
        return layer!.id;
      }
      const copy=shallowCloneLayer(layer!);copy.id=nextId("layer");copy.name=`${layer!.name} · Recolor`;copy.bitmap=generated;
      copy.surface=nextSurface!;copy.mask=layer!.mask?cloneCanvas(layer!.mask):undefined;copy.photoshop=undefined;
      try {
        admitSave({...this.doc,layers:[copy,...this.doc.layers]},{label:"Recolor copy",before:[],after:[],layersBefore:this.doc.layers,layersAfter:[copy,...this.doc.layers]});
        this.commitStructural("Recolor copy",()=>{layer!.visible=false;copy.visible=true;this.doc.layers.splice(this.doc.layers.indexOf(layer!),0,copy);});
      } catch(error) {copy.surface.store.unbindMemoryBudget();if(copy.mask){copy.mask.width=1;copy.mask.height=1;}throw error;}
      generated=undefined;this.checkpointLayerSurface(copy);this.requestRender();return copy.id;
    } finally {if(generated){generated.width=1;generated.height=1;}for(const release of releases)release();}
  }

  /** Keep the original pixel owners alive until all fallible edit work passes. */
  private editRasterTransaction(layer: Layer & { bitmap?: HTMLCanvasElement }, label: string, edit: () => void) {
    const bitmap = layer.bitmap!;
    const surface = layer.surface;
    const transform = layer.transform;
    if (surface && (surface.grid.width !== bitmap.width || surface.grid.height !== bitmap.height)) {
      throw new Error("This destructive operation requires a full-resolution bitmap; it cannot modify a large-document preview proxy.");
    }
    const release = this.reserveOperationMemory(bitmap.width * bitmap.height * 64 + (surface?.store.stats().residentBytes ?? 0) * 4);
    try {
      const before = [snapshotLayer(layer)];
      const historyNode = this.history.current;
      try {
        layer.bitmap = cloneCanvas(bitmap);
        layer.surface = surface?.clone();
        edit();
        bumpBitmapVersion(layer.bitmap);
        this.syncLayerSurface(layer);
        const after = [snapshotLayer(layer)];
        this.commit({ label, before, after });
      } catch (error) {
        if (this.history.current === historyNode) {
          if (layer.surface !== surface) layer.surface?.store.unbindMemoryBudget();
          layer.bitmap = bitmap;
          layer.surface = surface;
          layer.transform = transform;
          this.bindDocumentMemory(this.doc);
        }
        throw error;
      }
      this.checkpointLayerSurface(layer);
      this.requestRender();
    } finally { release(); }
  }

  filter(layerId: string, kind: "blur" | "sharpen" | "invert" | "desaturate" | "hue", opts: Record<string, number> = {}) {
    const layer = this.findLayer(layerId);
    if (layer?.surface?.store.sourceState()) throw new Error("Destructive filters are not supported on source-backed layers yet. Use an editable smart filter instead.");
    if (!layer || layer.kind !== "raster" || !layer.bitmap || layer.locked) return;
    if (Object.values(opts).some(value => !Number.isFinite(value))) throw new Error("Filter parameters must be finite.");
    if (kind === "sharpen" && (opts.radius ?? 2) < 0) throw new Error("Sharpen radius must not be negative.");
    if ((kind === "blur" && (opts.radius ?? 8) <= 0) ||
        (kind === "sharpen" && (opts.amount ?? 0.6) === 0) ||
        (kind === "desaturate" && (opts.amount ?? 1) === 0) ||
        (kind === "hue" && (opts.degrees ?? 45) % 360 === 0)) return;
    const influence = smartFilterInfluenceRadius({ kind, params: opts });
    if (!Number.isFinite(influence)) throw new Error("Filter radius exceeds safe sampling bounds.");
    const region = filterRegionForSelection(this.doc, layer);
    const sampling = filterRegionForSelection(this.doc, layer, influence);
    if (!region || !sampling) return;
    const release = this.reserveOperationMemory(destructiveFilterScratchBytes(this.doc, layer, sampling));
    try {
    // Only the selected bounds are written. Blur's halo is read-only scratch,
    // not history and not a reason to quantize unrelated high-depth pixels.
    this.editRegionTransaction(layer, region, `Filter: ${kind}`, () => {
    if (kind === "blur") {
      const r = opts.radius ?? 8;
      gaussianBlur(this.doc, layer, r);
    } else if (kind === "sharpen") {
      const r = opts.radius ?? 2;
      const a = opts.amount ?? 0.6;
      unsharpMask(this.doc, layer, r, a);
    } else if (kind === "invert") {
      invertColors(this.doc, layer);
    } else if (kind === "desaturate") {
      const a = opts.amount ?? 1;
      desaturate(this.doc, layer, a);
    } else if (kind === "hue") {
      const d = opts.degrees ?? 45;
      hueRotate(this.doc, layer, d);
    }
    });
    if (kind === "blur") this.actions.push({ op: kind, radius: opts.radius ?? 8 });
    else if (kind === "sharpen") this.actions.push({ op: kind, radius: opts.radius ?? 2, amount: opts.amount ?? 0.6 });
    else if (kind === "desaturate") this.actions.push({ op: kind, amount: opts.amount ?? 1 });
    else if (kind === "hue") this.actions.push({ op: kind, degrees: opts.degrees ?? 45 });
    else this.actions.push({ op: kind });
    } finally { release(); }
  }

  // --- actions ---
  private actionLibraryChanged() {
    const session = this.sessions.find(candidate => candidate.id === this.activeSessionId);
    if (session) session.actionsDirty = true;
    // Scripts are metadata: do not invalidate or recompose a potentially huge
    // canvas just because a condition or action name changed.
    this.actionRevision += 1;
    this.emit();
  }
  startRecording(name: string) { this.actions.start(name); this.emit(); }
  stopRecording() {
    const a = this.actions.stop();
    if (a) this.actionLibraryChanged();
    this.emit();
    return a;
  }
  editAction(index: number, action: Action) {
    if (!this.actions.replace(index, action)) return false;
    this.actionLibraryChanged();
    return true;
  }
  undoActionEdit(redo = false) {
    if (!(redo ? this.actions.redoEdit() : this.actions.undoEdit())) return false;
    this.actionLibraryChanged();
    return true;
  }
  replay(action: Action, activeLayerId: string | null) {
    const report = this.replayWithReport(action, activeLayerId);
    if (!report.completed) throw new ActionPlaybackError(report);
    return report.targetId;
  }
  replayWithReport(action: Action, activeLayerId: string | null): ActionPlaybackReport {
    if (!isSafeAction(action)) throw new Error("Action is malformed or unsupported; no steps were applied");
    const documentId = this.activeSessionId;
    const report: ActionPlaybackReport = { name: action.name, documentId, targetId: activeLayerId, completed: true, steps: [] };
    let target = activeLayerId;
    // A recording must not recursively collect its own playback operations.
    return this.actions.withoutRecording(() => {
      for (const [index, step] of action.steps.slice().entries()) {
        if (step.enabled === false) { report.steps.push({ index, operation: step.op, targetId: target, status: "disabled" }); continue; }
        try {
          if (this.activeSessionId !== documentId) throw new Error("The active document changed during playback");
          const unmet = step.conditions?.find(condition => !actionConditionMatches(condition, this.doc, target ? this.findLayer(target) : undefined));
          if (unmet) {
            report.steps.push({ index, operation: step.op, targetId: target, status: "skipped", message: `Condition not met: ${describeActionCondition(unmet)}` });
            continue;
          }
          const unavailable = actionStepUnavailableReason(step, this.doc, target ? this.findLayer(target) : undefined);
          if (unavailable) throw new Error(unavailable);
          const before = this.history.current;
          target = this.runStep(step, target);
          report.targetId = target;
          if (this.activeSessionId !== documentId) throw new Error("The active document changed during playback");
          report.steps.push({ index, operation: step.op, targetId: target, status: this.history.current === before ? "unchanged" : "applied" });
        } catch (error) {
          report.completed = false;
          report.steps.push({ index, operation: step.op, targetId: target, status: "failed", message: error instanceof Error ? error.message : "Operation failed" });
          break;
        }
      }
      return report;
    });
  }
  private runStep(step: ActionStep, activeLayerId: string | null) {
    let nextTarget = activeLayerId;
    switch (step.op) {
      case "layerBatch": {
        const targets = step.targets.map(target => {
          const layer = this.doc.layers[target.index];
          if (!layer || layer.kind !== target.kind) throw new Error("Recorded layer selection does not match this document's layer structure");
          return layer.id;
        });
        switch (step.operation) {
          case "group": nextTarget = this.groupLayers(targets).id; break;
          case "ungroup": nextTarget = this.ungroupLayers(targets)[0] ?? null; break;
          case "merge": nextTarget = this.mergeLayers(targets).id; break;
          case "duplicate": nextTarget = this.duplicateLayers(targets)[0]?.id ?? null; break;
          case "delete": this.removeLayers(targets); nextTarget = null; break;
          case "visible": case "locked": this.setLayersFlag(targets, step.operation, step.value!); break;
        }
        break;
      }
      case "fill":
        if (activeLayerId) this.fillLayer(activeLayerId, step.color, step.opacity ?? 1);
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
      case "addAdjustment": nextTarget = this.addAdjustmentLayer("Tone", step.tone as Partial<ToneParams>).id; break;
      case "addCurves": nextTarget = this.addCurvesLayer().id; break;
      case "addLevels": nextTarget = this.addLevelsLayer().id; break;
      case "addHsl": nextTarget = this.addHslLayer().id; break;
      case "addProAdjustment": nextTarget = this.addProAdjustmentLayer(step.kind, step.params).id; break;
      case "addRaster": nextTarget = this.addBlankRaster(step.name).id; break;
      case "addShape": nextTarget = this.addShapeLayer(step.style).id; break;
      case "addText": nextTarget = this.addTextLayer(step.text, step.style, step.transform).id; break;
      case "addSmartFilter": if (activeLayerId) this.addSmartFilter(activeLayerId, step.kind, step.params); break;
      case "addDropShadow": if (activeLayerId) this.addDropShadow(activeLayerId); break;
      case "convertSmartObject": if (activeLayerId) this.convertToSmartObject(activeLayerId); break;
      case "groupActive": if (activeLayerId) nextTarget = this.groupLayer(activeLayerId)?.id ?? activeLayerId; break;
      case "duplicateActive": if (activeLayerId) nextTarget = this.duplicateLayer(activeLayerId)?.id ?? activeLayerId; break;
      case "deleteActive": if (activeLayerId) { this.removeLayer(activeLayerId); nextTarget = null; } break;
      case "setOpacity": if (activeLayerId) this.setLayerProp(activeLayerId, "opacity", step.opacity, "Opacity"); break;
      case "setFillOpacity": if (activeLayerId) this.setLayerProp(activeLayerId, "fillOpacity", step.opacity, "Fill opacity"); break;
      case "setBlendMode": if (activeLayerId) this.setLayerProp(activeLayerId, "blend", step.mode, "Blend mode"); break;
      case "invertMask": if (activeLayerId) this.invertMask(activeLayerId); break;
      case "clearMask": if (activeLayerId) this.clearMask(activeLayerId); break;
      case "cropSelection": this.cropToSelection(); break;
      case "setTransform": if (activeLayerId) this.updateTransform(activeLayerId, step.transform); break;
      case "updateShape": if (activeLayerId) this.updateShape(activeLayerId, step.shape); break;
      case "updateText": if (activeLayerId) this.updateText(activeLayerId, step.text); break;
      case "autoSubject": if (activeLayerId) this.autoLumaMask(activeLayerId); break;
    }
    return nextTarget;
  }

  // --- PSD ---
  async importFormText(source: string) {
    const { parseFormTextAsset } = await import("./form-studio-bridge");
    const asset = parseFormTextAsset(source);
    const next = createDocument(1920, 1080);
    const layer = createTextLayer(asset.name, { ...structuredClone(asset.typography), x: asset.typography.x ?? 100, y: asset.typography.y ?? 250, spatial: structuredClone(asset.spatial), formOrigin: { assetId: asset.id, layerId: asset.source.layerId } });
    if (layer.text!.spatial!.link) layer.text!.spatial!.link!.autoUpdate = false;
    next.layers = [layer];
    // A returned source always becomes a new document: it never overwrites newer local work.
    this.installDocument(next, `${asset.name} · Form return`);
    this.commit({ label: "Form text imported", before: [], after: [] });
    this.requestRender();
    return next;
  }

  async importFormMesh(source: string, render?: (asset: FormMeshAsset) => Promise<HTMLCanvasElement>) {
    const asset = parseFormMesh(source);
    const canvas = await (render ?? (await import("./form-mesh-render")).renderFormMesh)(asset);
    if (canvas.width !== asset.width || canvas.height !== asset.height) throw new Error("Mesh render dimensions do not match its source.");
    const next = createDocument(asset.width, asset.height);
    const layer = createRasterLayer(asset.name, canvas); layer.kind = "smart-object"; layer.mesh3d = structuredClone(asset);
    next.layers = [layer];
    this.installDocument(next, `${asset.name} · Form mesh`);
    this.commit({ label: "Editable Form mesh imported", before: [], after: [] }); this.requestRender(); return next;
  }

  async updateFormMesh(layerId: string, source: FormMeshAsset, render?: (asset: FormMeshAsset) => Promise<HTMLCanvasElement>) {
    const layer = this.findLayer(layerId);
    if (!layer?.mesh3d || layer.locked || !layer.bitmap) throw new Error("Select an unlocked Form mesh layer.");
    validateFormMesh(source);
    const asset = structuredClone(source), documentId = this.activeSessionId, revision = this.renderRevision;
    const canvas = await (render ?? (await import("./form-mesh-render")).renderFormMesh)(asset);
    if (this.activeSessionId !== documentId || this.renderRevision !== revision || this.findLayer(layerId) !== layer || layer.locked) throw new Error("Document changed while rendering. Retry the mesh edit.");
    if (canvas.width !== asset.width || canvas.height !== asset.height) throw new Error("Mesh render dimensions do not match its source.");
    const before: LayerSnapshot = { layerId, bitmap: cloneCanvas(layer.bitmap), surface: layer.surface?.clone(), mesh3d: structuredClone(layer.mesh3d) };
    const surface = this.surfaceFromCanvas(canvas);
    let after: LayerSnapshot;
    try { after = { layerId, bitmap: cloneCanvas(canvas), surface: surface.clone(), mesh3d: structuredClone(asset) }; }
    catch (error) { surface.store.unbindMemoryBudget(); throw error; }
    layer.bitmap = canvas; layer.surface = surface; layer.mesh3d = asset; bumpBitmapVersion(canvas);
    this.commit({ label: "Form mesh edited", before: [before], after: [after] }); this.requestRender();
  }

  async importSvg(source: string, name = "Imported SVG", parse?: (source: string) => Promise<import("./vector-svg-import").ImportedSvg>) {
    const result = await (parse ?? (await import("./vector-svg-client")).importSvgInWorker)(source);
    return this.installImportedVectors(result, name, "SVG imported");
  }

  async importPdf(bytes: ArrayBuffer, page: number, name = "Imported PDF", parse?: typeof import("./pdf-import").importEditablePdf) {
    const result = await (parse ?? (await import("./pdf-import")).importEditablePdf)(bytes, page);
    return this.installImportedVectors(result, name, "PDF imported");
  }

  async importPdfObjects(bytes: ArrayBuffer, page: number, family: string, name = "Editable PDF objects", parse?: typeof import("./pdf-object-import").importPdfObjects) {
    const result = await (parse ?? (await import("./pdf-object-import")).importPdfObjects)(bytes, page, family);
    const refusal = documentSizeRefusal(result.width, result.height, currentEdition()); if (refusal) throw new Error(refusal);
    if (!result.layers.length || result.layers.length > 512) throw new Error("PDF object count exceeds the editing budget.");
    const next = createDocument(result.width, result.height);
    next.layers = result.layers.map((object, index) => {
      if (object.kind === "path") return { ...createPathLayer(`PDF path ${index + 1}`, object.vector.path), transform: object.vector.transform, opacity: object.vector.opacity };
      if (object.kind === "text") return { ...createTextLayer(`PDF text · ${object.text.text.slice(0, 32)}`, object.text), transform: object.transform, opacity: object.opacity };
      if (!object.canvas) throw new Error("Missing decoded PDF image.");
      return { ...createRasterLayer(`PDF image ${index + 1}`, object.canvas), transform: object.transform, opacity: object.opacity };
    });
    this.installDocument(next, `${name} · font mapped`);
    this.commit({ label: "PDF objects imported with explicit font mapping", before: [], after: [] }); this.requestRender(); return next;
  }

  async importRenderedPdf(bytes: ArrayBuffer, page: number, ppi: number, name = "Rendered PDF", render?: typeof import("./pdf-import").renderPdfPage) {
    const result = await (render ?? (await import("./pdf-import")).renderPdfPage)(bytes, page, ppi);
    try {
      const refusal = documentSizeRefusal(result.canvas.width, result.canvas.height, currentEdition());
      if (refusal) throw new Error(refusal);
      const next = createDocument(result.canvas.width, result.canvas.height);
      next.resolution = { x: result.ppi, y: result.ppi, unit: "ppi" };
      next.layers = [createRasterLayer(`${name} · flattened`, result.canvas)];
      this.installDocument(next, name);
      this.commit({ label: "PDF rendered page imported", before: [], after: [] });
      this.requestRender();
      return next;
    } catch (error) { result.canvas.width = 1; result.canvas.height = 1; throw error; }
  }

  private installImportedVectors(result: import("./vector-svg-import").ImportedSvg, name: string, label: string) {
    const refusal = documentSizeRefusal(result.width, result.height, currentEdition());
    if (refusal) throw new Error(refusal);
    const next = createDocument(result.width, result.height);
    next.layers = materializeImportedVectors(result);
    // Nothing touches the workspace until the entire file has passed validation.
    this.installDocument(next, name);
    this.commit({ label, before: [], after: [] });
    this.requestRender();
    return next;
  }

  async importPsd(buffer: ArrayBuffer, name = "Imported PSD") {
    const { importPsd } = await import("./psd");
    const newDoc = await importPsd(buffer);
    this.installDocument(newDoc, name.trim() || "Imported PSD");
    this.commit({ label: "PSD imported", before: [], after: [] });
    this.requestRender();
    return newDoc;
  }

  private async prepareFontsForExport(flattenedDocument?: Document) {
    const document = this.doc;
    const history = this.history.current;
    const textState = JSON.stringify(document.layers.filter(layer => layer.text).map(layer => layer.text));
    // Layered exports still require every editable face. Flattened delivery
    // needs only render dependencies, including otherwise hidden clip bases.
    await waitForDocumentFonts(flattenedDocument ? { layers: renderedTextLayers(flattenedDocument) } : document);
    if (this.doc !== document || this.history.current !== history || textState !== JSON.stringify(document.layers.filter(layer => layer.text).map(layer => layer.text))) throw new Error("The document changed while loading its fonts. Please export again.");
  }

  /** Reject delayed work rather than applying it to another tab or revision. */
  private guardDocumentOperation(operation: string, id = this.activeSessionId, includeRenderRevision = true) {
    this.saveActiveSession();
    const session = this.sessions.find(candidate => candidate.id === id);
    if (!session) throw new Error(`Document ${id} is no longer open`);
    const document = session.doc;
    const node = session.history.current;
    const revision = this.renderRevision - this.presentationRenderRevision;
    const actions = this.actionRevision;
    const active = this.activeSessionId;
    return () => {
      if (!this.sessions.includes(session) || session.doc !== document || session.history.current !== node ||
          this.activeSessionId !== active || (includeRenderRevision && this.renderRevision - this.presentationRenderRevision !== revision) || this.actionRevision !== actions) {
        throw new Error(`The document changed during ${operation}. Please try again.`);
      }
    };
  }

  async exportPsd(options: PhotoshopExportOptions = {}): Promise<ArrayBuffer> {
    return (await this.exportPhotoshop(options)).buffer;
  }

  async exportPhotoshop(options: PhotoshopExportOptions = {}, approve?: (report: PhotoshopCompatibilityReport) => Promise<boolean>) {
    const assertCurrent = this.guardDocumentOperation("Photoshop export");
    const { exportPhotoshopDocument, photoshopCompatibilityReport } = await import("./psd");
    assertCurrent();
    let preflight = photoshopCompatibilityReport(this.doc, options);
    const blocking = preflight.issues.filter(issue => issue.severity === "error" && issue.code !== "SMART_CONTENT_REQUIRES_PREPARATION");
    if (blocking.length) {
      if (approve) await approve({ ...preflight, canExport: false, issues: preflight.issues.filter(issue => issue.code !== "SMART_CONTENT_REQUIRES_PREPARATION") });
      assertCurrent();
      throw new Error(blocking.map(issue => issue.message).join("\n"));
    }
    assertCurrent();
    const { highDepthExportBytes } = await import("./high-depth-psd");
    const { photoshopAlphaExportBytes } = await import("./psd-alpha-channels");
    assertCurrent();
    const native = preflight.issues.some(issue => issue.code === "OUTPUT_16_BIT_NATIVE" || issue.code === "OUTPUT_32_BIT_NATIVE");
    const passthrough = preflight.issues.some(issue => issue.code === "ORIGINAL_SOURCE_PASSTHROUGH");
    // Original-source copies do not render text or change descriptors. Missing
    // local fonts must not prevent preserving the user's original document.
    if (!passthrough) { await this.prepareFontsForExport(); assertCurrent(); }
    const alphaBytes = photoshopAlphaExportBytes(this.doc);
    const cleanPreview = !native && !passthrough && this.doc.width * this.doc.height <= 4_000_000 && !this.doc.layers.some(layer => layer.surface?.store.sourceState());
    const workingBytes = (native ? highDepthExportBytes(this.doc) : 0) + (alphaBytes || cleanPreview ? this.serializationMemory(this.doc) * 2 + alphaBytes * 3 : 0)
      + (cleanPreview ? this.doc.width * this.doc.height * (64 + this.doc.layers.filter(layer => layer.kind === "group").length * 4) : 0);
    const release = workingBytes && !passthrough ? this.reserveOperationMemory(workingBytes) : () => {};
    let prepared: Awaited<ReturnType<typeof import("./psd-smart-objects").preparePhotoshopSmartObjects>> | undefined;
    let preview: HTMLCanvasElement | undefined;
    try {
      if (!passthrough) {
        const { preparePhotoshopSmartObjects } = await import("./psd-smart-objects"); assertCurrent();
        prepared = await preparePhotoshopSmartObjects(this.doc, bytes => this.reserveOperationMemory(bytes), assertCurrent);
        assertCurrent();
      }
      if (cleanPreview) { preview = newCanvas(this.doc.width, this.doc.height); renderClean(this.doc, preview); }
      const ready = { ...options, preparedSmartObjects: prepared?.objects, mergedPreview: preview };
      preflight = photoshopCompatibilityReport(this.doc, ready);
      if (!preflight.canExport) throw new Error(preflight.issues.filter(issue => issue.severity === "error").map(issue => issue.message).join("\n"));
      if (preflight.issues.some(issue => issue.severity === "warning")) {
        if (!approve) throw new Error("This Photoshop copy requires compatibility approval. Review its export preflight before exporting; the Luma document is unchanged.");
        if (!await approve(preflight)) throw new Error("Photoshop export cancelled");
      }
      assertCurrent();
      const result = exportPhotoshopDocument(this.doc, ready);
      assertCurrent();
      return result;
    } finally { if (preview) { preview.width = 1; preview.height = 1; } prepared?.release(); release(); }
  }

  async photoshopCompatibility(options: PhotoshopExportOptions = {}): Promise<PhotoshopCompatibilityReport> {
    const { photoshopCompatibilityReport } = await import("./psd");
    return photoshopCompatibilityReport(this.doc, options);
  }

  async exportProject(name = "Untitled") {
    return (await this.prepareProjectSave(name)).blob;
  }

  /** Pin identity, path and revision before the first async boundary. */
  async prepareProjectSave(name = this.activeDocumentState().name) {
    const state = this.activeDocumentState();
    const document = this.doc;
    const history = this.history.snapshot();
    const historyNodeId = this.history.current;
    const revision = this.renderRevision - this.presentationRenderRevision;
    const actions = this.actions.list();
    const actionRevision = this.actionRevision;
    const finishEncoding = await this.projectEncodingQueue.acquire();
    let release: (() => void) | undefined;
    try {
    const assertUnchanged = () => {
      if (this.doc !== document || this.activeSessionId !== state.id || this.history.current !== historyNodeId || this.renderRevision - this.presentationRenderRevision !== revision || this.actionRevision !== actionRevision) {
        throw new Error("The document changed while saving. Please save again.");
      }
    };
    const { encodeLumaProject } = await import("./project");
    assertUnchanged();
    release = this.reserveOperationMemory(this.serializationMemory(document, history.nodes.flatMap(node => node.value ? [node.value] : [])) + this.history.summary().bytes * 3);
    const blob = await encodeLumaProject(document, actions, name, history);
    assertUnchanged();
    return { blob, documentId: state.id, nativePath: state.nativePath, historyNodeId, revision, actionRevision };
    } finally { release?.(); finishEncoding(); }
  }

  completeProjectSave(ticket: { documentId: string; historyNodeId: string; revision: number; actionRevision: number }, nativePath?: string) {
    const session = this.sessions.find(candidate => candidate.id === ticket.documentId);
    if (!session) return false;
    if (nativePath) this.setDocumentNativePath(ticket.documentId, nativePath);
    if (session.history.current !== ticket.historyNodeId || this.renderRevision - this.presentationRenderRevision !== ticket.revision || this.actionRevision !== ticket.actionRevision) return false;
    return this.markDocumentSaved(ticket.documentId, nativePath);
  }

  async exportRecoveryDocument(id = this.activeSessionId) {
    const assertCurrent = this.guardDocumentOperation("recovery", id);
    const finishEncoding = await this.projectEncodingQueue.acquire();
    let release: (() => void) | undefined;
    try {
    const { encodeLumaProject } = await import("./project");
    assertCurrent();
    this.saveActiveSession();
    const session = this.sessions.find((candidate) => candidate.id === id);
    if (!session) throw new Error(`Recovery document ${id} is no longer open`);
    release = this.reserveOperationMemory(this.serializationMemory(session.doc));
    const checkpoint = {
      id: session.id,
      name: session.name,
      active: session.id === this.activeSessionId,
      nativePath: session.nativePath,
      dirty: Boolean(session.actionsDirty) || session.transientDirty || session.history.current !== session.savedHistoryNodeId,
      updatedAt: Date.now(),
      blob: await encodeLumaProject(session.doc, this.actions.list(), session.name, undefined, { mode: "recovery" }),
    };
    assertCurrent();
    return checkpoint;
    } finally { release?.(); finishEncoding(); }
  }

  async exportRecoveryWorkspace() {
    const assertCurrent = this.guardWorkspaceOperation("workspace recovery");
    this.saveActiveSession();
    const checkpoints = [];
    // Full-workspace checkpoints are reserved for explicit lifecycle events.
    // Encode serially so several large JSZip archives cannot coexist while
    // they are being compressed.
    for (const session of this.sessions) {
      assertCurrent();
      checkpoints.push(await this.exportRecoveryDocument(session.id));
    }
    assertCurrent();
    return checkpoints;
  }

  /** Pin every tab, including inactive documents, across lifecycle I/O. */
  private guardWorkspaceOperation(operation: string) {
    const assertActive = this.guardDocumentOperation(operation);
    const captured = this.sessions.map(session => ({ session, document: session.doc,
      node: session.history.current, name: session.name, path: session.nativePath,
      saved: session.savedHistoryNodeId, dirty: session.transientDirty, actions: session.actionsDirty }));
    return () => {
      assertActive();
      if (this.sessions.length !== captured.length || captured.some((entry, index) => {
        const session = this.sessions[index];
        return session !== entry.session || session.doc !== entry.document || session.history.current !== entry.node ||
          session.name !== entry.name || session.nativePath !== entry.path || session.savedHistoryNodeId !== entry.saved ||
          session.transientDirty !== entry.dirty || session.actionsDirty !== entry.actions;
      })) throw new Error(`The workspace changed during ${operation}. Please try again.`);
    };
  }

  /** A completed write is not permission to restart if edits arrived during it. */
  async checkpointForRestart(write: (checkpoints: Awaited<ReturnType<Studio["exportRecoveryWorkspace"]>>) => Promise<unknown>) {
    if (this.dirtyDocuments().length) throw new Error("Save all open documents before installing an update");
    const assertCurrent = this.guardWorkspaceOperation("update checkpoint");
    const checkpoints = await this.exportRecoveryWorkspace();
    assertCurrent();
    await write(checkpoints);
    assertCurrent();
    if (this.dirtyDocuments().length) throw new Error("Documents changed during the update checkpoint. Save them before installing");
    return assertCurrent;
  }

  async importProject(blob: Blob, options: { restoreHistory?: boolean; recoveryId?: string } = {}) {
    const protectActionEdits = () => {
      if (!options.recoveryId && (this.actions.isRecording() || this.sessions.some(session => session.actionsDirty))) {
        throw new Error("Stop recording and save projects with action-library edits before opening another project. Its action library would replace the current one.");
      }
    };
    protectActionEdits();
    const { decodeLumaProject } = await import("./project");
    const project = await decodeLumaProject(blob, { ...options, admitDecodedBytes: bytes => this.reserveOperationMemory(bytes) });
    protectActionEdits();
    this.installDocument(project.doc, project.name, options.recoveryId);
    this.history = project.history
      ? OperationHistory.fromSnapshot(project.history.snapshot(), {
        maxNodes: HISTORY_LIMIT,
        maxBytes: this.historyBudgetBytes,
        sizeOf: historyEntrySize,
      })
      : this.createSessionHistory();
    const session = this.sessions.find((candidate) => candidate.id === this.activeSessionId);
    if (session) session.history = this.history;
    this.bindDocumentMemory(this.doc);
    this.actions.fromJSON(JSON.stringify(project.actions));
    this.requestRender();
    this.emit();
    return project;
  }

  // --- export ---
  async prepareVectorDelivery(format: "svg" | "pdf") {
    const assertCurrent = this.guardDocumentOperation("vector preflight");
    const { planVectorDelivery } = await import("./vector-delivery-plan");
    assertCurrent();
    return { name: this.activeDocumentState().name, report: planVectorDelivery(this.doc, format).report, assertCurrent };
  }

  async exportVectorDocument(format: "svg" | "pdf"): Promise<Blob> {
    const assertCurrent = this.guardDocumentOperation("vector export");
    const source = this.doc;
    if (format === "pdf") {
      const { exportVectorPdf } = await import("./vector-pdf");
      assertCurrent();
      const bytes = await exportVectorPdf(source);
      assertCurrent();
      return new Blob([new Uint8Array(bytes)], { type: "application/pdf" });
    }
    const { exportVectorSvg } = await import("./vector-delivery");
    assertCurrent();
    const svg = exportVectorSvg(source);
    assertCurrent();
    return new Blob([svg], { type: "image/svg+xml" });
  }

  async exportImage(type: "image/png" | "image/jpeg" | "image/webp" = "image/png", quality = 0.92): Promise<Blob> {
    const bytes = fitsBrowserCanvas(this.doc.width, this.doc.height)
      ? this.doc.width * this.doc.height * (24 + this.doc.layers.length * 4)
      : 384 * 1024 * 1024 + this.doc.width * 64 * 4;
    const release = this.reserveOperationMemory(bytes);
    try { return await this.exportImageSnapshot(type, quality); }
    finally { release(); }
  }

  private async exportImageSnapshot(type: "image/png" | "image/jpeg" | "image/webp", quality: number): Promise<Blob> {
    const assertCurrent = this.guardDocumentOperation("image export");
    await this.prepareFontsForExport(this.doc);
    assertCurrent();
    const browserCanvasSafe = fitsBrowserCanvas(this.doc.width, this.doc.height);
    if (type === "image/png" && !browserCanvasSafe) {
      const { exportTiledPng } = await import("./png-stream");
      assertCurrent();
      const blob = await exportTiledPng(this.doc, { assertCurrent });
      assertCurrent();
      return blob;
    }
    if (!browserCanvasSafe) {
      throw new Error("Large-document JPEG/WebP export is unavailable; export PNG or reduce the document dimensions.");
    }
    const output = newCanvas(this.doc.width, this.doc.height);
    const nativeComposite = await this.flattenNative().catch((error) => {
      console.warn("Native compositing failed; using the portable renderer", error);
      return null;
    });
    assertCurrent();
    if (type === "image/jpeg") {
      const clean = nativeComposite ?? newCanvas(this.doc.width, this.doc.height);
      if (!nativeComposite && (!this.useGL || !renderGL(this.doc, clean, false, false))) renderClean(this.doc, clean);
      const ctx = output.getContext("2d")!;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, output.width, output.height);
      ctx.drawImage(clean, 0, 0);
    } else if (nativeComposite) {
      output.getContext("2d")!.drawImage(nativeComposite, 0, 0);
    } else if (!this.useGL || !renderGL(this.doc, output, false, false)) renderClean(this.doc, output);
    const blob = await new Promise<Blob>((resolve, reject) => {
      output.toBlob((blob) => blob ? resolve(blob) : reject(new Error("toBlob failed")), type, quality);
    });
    assertCurrent();
    return blob;
  }

  exportPNG(): Promise<Blob> { return this.exportImage("image/png"); }

  async exportPrintPdf(options: import("./print-output").PrintOptions) {
    const assertCurrent = this.guardDocumentOperation("CMYK print export");
    const { PRINT_MAX_PIXELS, validatePrinterProfile, convertPrintPixels, createCmykPrintPdf } = await import("./print-output");
    assertCurrent();
    if (this.doc.width * this.doc.height > PRINT_MAX_PIXELS || this.doc.bitDepth !== 8 || this.doc.colorSpace !== "srgb") throw new Error("CMYK print export currently accepts sRGB 8-bit documents up to 4 megapixels; save the high-depth master separately");
    if (this.doc.resolution.x !== this.doc.resolution.y) throw new Error("CMYK print output requires equal horizontal and vertical resolution");
    validatePrinterProfile(options.profile);
    const doc = this.doc;
    const release = this.reserveOperationMemory(doc.width * doc.height * (96 + doc.layers.length * 4) + options.profile.byteLength * 8);
    // Keep the output profile identical to the conversion profile even if an
    // API caller mutates its options while the native command is in flight.
    let canvas: HTMLCanvasElement | undefined;
    try {
      const outputOptions = { ...options, profile: options.profile.slice() };
      await this.prepareFontsForExport(doc); assertCurrent();
      canvas = newCanvas(doc.width, doc.height); renderClean(doc, canvas);
      const rgba = canvas.getContext("2d")!.getImageData(0, 0, doc.width, doc.height).data;
      const rgb = new Uint8Array(doc.width * doc.height * 3);
      // Explicit white-paper flatten, not accidental transparency loss in IPC.
      for (let i = 0; i < doc.width * doc.height; i++) {
        const alpha = rgba[i * 4 + 3] / 255;
        for (let c = 0; c < 3; c++) rgb[i * 3 + c] = Math.round(rgba[i * 4 + c] * alpha + 255 * (1 - alpha));
      }
      const cmyk = await convertPrintPixels(doc.width, doc.height, rgb, outputOptions); assertCurrent();
      const result = await createCmykPrintPdf(doc.width, doc.height, doc.resolution.x, cmyk, outputOptions); assertCurrent();
      return result;
    } finally { if (canvas) { canvas.width = 1; canvas.height = 1; } release(); }
  }

  /**
   * Flatten through the Rust f32 compositor.
   *
   * Layers whose stored pixels are already what the compositor should see go
   * across as precision surfaces — full float, no canvas round trip. Everything
   * else is rendered through the shared pipeline first, so transforms, smart
   * filters, self-contained effects, vector masks and clipping are honoured
   * rather than refused. `nativeFlattenRefusal` says what is still out of
   * reach and why.
   *
   * Returns null when the native core is absent as well as when the document
   * is refused; callers fall back to the portable renderer either way.
   */
  async flattenNative(): Promise<HTMLCanvasElement | null> {
    const assertCurrent = this.guardDocumentOperation("native compositing");
    if (!isNativeCoreAvailable()) return null;
    if (nativeFlattenRefusal(this.doc) !== null) return null;

    const layers = this.doc.layers.filter((layer) => layer.visible && layer.opacity > 0);
    const output = newCanvas(this.doc.width, this.doc.height);
    if (!layers.length) return output;

    // One grid drives the tiling. A layer that cannot supply the reference grid
    // is rasterized instead, so a mismatch no longer sinks the document.
    //
    // The fallback builds a bare grid rather than a surface from a canvas: only
    // the tile addresses are wanted, and allocating a document-sized canvas to
    // get them would cost a full RGBA buffer for nothing — and would fail
    // outright on a document past the canvas ceiling.
    const reference = layers.find((layer) => nativeCanUseSurfaceDirectly(layer, this.doc))?.surface
      ?? new PrecisionTileSurface(this.doc.width, this.doc.height, pixelFormatForDepth(this.doc.bitDepth), this.doc.colorSpace);

    // Rasterizing is per layer, not per tile: doing it inside the tile loop
    // would re-render every layer once per tile.
    const rendered = new Map<string, CanvasRenderingContext2D>();
    const sources = layers.map((layer) => {
      const direct = nativeCanUseSurfaceDirectly(layer, this.doc)
        && layer.surface!.grid.width === reference.grid.width
        && layer.surface!.grid.height === reference.grid.height
        && layer.surface!.grid.tileSize === reference.grid.tileSize;
      if (!direct && !rendered.has(layer.id)) {
        rendered.set(layer.id, rasterizeLayer(this.doc, layer).getContext("2d", { willReadFrequently: true })!);
      }
      return { layer, direct };
    });

    const outputContext = output.getContext("2d")!;
    const addresses = reference.grid.tilesIntersecting({ x: 0, y: 0, width: this.doc.width, height: this.doc.height });
    for (const address of addresses) {
      const maskCache = new Map<string, Float32Array>();
      const nativeLayers = sources.flatMap(({ layer, direct }) => {
        // Display sRGB, not the raw working buffer: the working space is
        // linear light, and luma-core is being asked to blend in sRGB so the
        // result matches the portable renderer. Feeding it linear values and
        // writing them into an 8-bit canvas as if they were sRGB is what made
        // every native export come out too dark.
        //
        // Unpremultiplied, because composite_pixel takes straight alpha and
        // multiplies coverage in itself.
        const pixels = direct
          ? layer.surface!.tileToFloat32Display(address.key, false)
          : tileFromContext(rendered.get(layer.id)!, address);
        let maskAlpha: Float32Array | undefined;
        // Only the direct path leaves the mask outstanding. A rasterized layer
        // has it baked in — in the CPU renderer's order, which decides whether
        // effects fall outside it — so applying it again would square the
        // coverage at every soft edge.
        if (hasLayerMask(layer) && direct) {
          maskAlpha = maskCache.get(layer.id);
          if (!maskAlpha) {
            const mask = layerMaskSurface(layer, this.doc.width, this.doc.height)!
              .readRegion({ x: address.x, y: address.y, width: address.width, height: address.height });
            maskAlpha = new Float32Array(address.width * address.height);
            for (let pixel = 0; pixel < maskAlpha.length; pixel += 1) maskAlpha[pixel] = mask[pixel] / 255;
            maskCache.set(layer.id, maskAlpha);
          }
        }
        // Fill opacity is applied inside the effect pipeline when a layer is
        // rasterized, so folding it in again here would apply it twice.
        const fill = direct ? resolvedFillOpacity(layer) : 1;
        return resolvedBlendPasses(layer)
          .filter((pass) => pass.enabled && pass.opacity > 0)
          .reverse()
          .map((pass) => ({
            pixels,
            maskAlpha,
            mode: pass.mode,
            opacity: layer.opacity * fill * pass.opacity,
            linear: false,
          }));
      });
      const composite = await compositeNativeTile({
        width: address.width,
        height: address.height,
        layers: nativeLayers,
      });
      assertCurrent();
      if (!composite) return null;
      const image = outputContext.createImageData(address.width, address.height);
      for (let pixel = 0; pixel < address.width * address.height; pixel += 1) {
        const offset = pixel * 4;
        image.data[offset] = Math.round(Math.max(0, Math.min(1, composite[offset])) * 255);
        image.data[offset + 1] = Math.round(Math.max(0, Math.min(1, composite[offset + 1])) * 255);
        image.data[offset + 2] = Math.round(Math.max(0, Math.min(1, composite[offset + 2])) * 255);
        image.data[offset + 3] = Math.round(Math.max(0, Math.min(1, composite[offset + 3])) * 255);
      }
      outputContext.putImageData(image, address.x, address.y);
    }
    return output;
  }

  /**
   * Rasterize the entire document into a fresh canvas, without the
   * checkerboard.
   *
   * One canvas, so it cannot serve a document past the canvas ceiling. That
   * used to be unreachable because large documents were never really open;
   * now they are, so the limit is stated here rather than surfacing as a
   * failed allocation deep inside the caller.
   */
  flatten(): HTMLCanvasElement {
    if (exceedsBrowserCanvas(this.doc.width, this.doc.height)) {
      throw new Error(
        "This document is too large to flatten into a single image. Export a PNG, or an artboard, instead.",
      );
    }
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
  try { canvas.getContext("2d")!.drawImage(image, 0, 0, width, height); }
  finally { image.close(); }
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
