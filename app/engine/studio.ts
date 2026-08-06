import {
  BlendMode,
  BlendPass,
  BlendIf,
  AiProvenance,
  Curves,
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
  Selection,
  ShapeStyle,
  SourceProvenance,
  SmartFilter,
  TextStyle,
  ToneParams,
  Transform,
  cloneCanvas,
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
import { BrushParams, paintSegment } from "./brush";
import { render, renderClean } from "./renderer";
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
  selectRect,
} from "./selection";
import {
  desaturate,
  gaussianBlur,
  hueRotate,
  invertColors,
  unsharpMask,
} from "./filters";
import { Action, ActionRecorder, ActionStep } from "./actions";
import { exportPsd, importPsd } from "./psd";
import { OperationHistory } from "./operation-history";
import { DEFAULT_TILE_SIZE, PixelFormat, PixelRect, PrecisionTileSurface, TileGrid } from "./tile-store";
import { precisionPreviewCacheStats } from "./precision-renderer";
import { IndexedDbTileBacking } from "./tile-backing";

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
  guidesBefore?: Guide[];
  guidesAfter?: Guide[];
  documentBefore?: Document;
  documentAfter?: Document;
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

export type LumaPlugin = {
  id: string;
  name: string;
  version?: string;
  activate(studio: Studio): void | (() => void);
};

export class Studio {
  doc: Document;
  target: HTMLCanvasElement;
  actions = new ActionRecorder();
  useGL = false; // GPU compositing (RGBA16F) when true and supported
  private subscribers = new Set<SubscribeFn>();
  private history = new OperationHistory<HistoryEntry>({ maxNodes: HISTORY_LIMIT });
  private renderScheduled = false;
  private disposed = false;
  private strokeTiles: Map<string, StrokeTile> | null = null;
  private lastPoint: { x: number; y: number; p: number } | null = null;
  private sessions: DocumentSession[] = [];
  private activeSessionId = "";
  private liveSnapshots = new Map<string, LayerSnapshot>();
  private plugins = new Map<string, { plugin: LumaPlugin; dispose?: () => void }>();
  private tileBacking = IndexedDbTileBacking.supported() ? new IndexedDbTileBacking() : null;

  constructor(width: number, height: number, target: HTMLCanvasElement) {
    this.doc = createDocument(width, height);
    this.target = target;
    const session: DocumentSession = {
      id: nextId("doc"),
      name: "Untitled",
      doc: this.doc,
      history: this.history,
    };
    this.sessions = [session];
    this.activeSessionId = session.id;
    // Keep marching ants animating even between edits (2D path only; GL path
    // draws a static frame — ants will still update via requestRender on
    // selection changes).
    const tick = () => {
      if (this.disposed) return;
      if (this.doc.selection && !this.useGL) render(this.doc, this.target);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  static canUseGL() { return isGLSupported(); }

  setUseGL(v: boolean) {
    this.useGL = v;
    this.requestRender();
    this.emit();
  }

  subscribe(fn: SubscribeFn) {
    this.subscribers.add(fn);
    return () => this.subscribers.delete(fn);
  }

  dispose() {
    this.disposed = true;
    for (const entry of this.plugins.values()) entry.dispose?.();
    this.plugins.clear();
    this.subscribers.clear();
  }
  private emit() {
    for (const fn of this.subscribers) fn();
  }

  requestRender() {
    if (this.renderScheduled) return;
    this.renderScheduled = true;
    requestAnimationFrame(() => {
      this.renderScheduled = false;
      if (this.useGL) {
        const ok = renderGL(this.doc, this.target);
        if (!ok) {
          this.useGL = false;
          render(this.doc, this.target);
          this.emit();
        }
      } else {
        render(this.doc, this.target);
      }
    });
  }

  private commit(entry: HistoryEntry) {
    this.history.commit(entry.label, entry);
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
    return {
      renderer: this.useGL ? "webgl2-rgba16f" as const : "canvas2d-rgba8" as const,
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
      proofing: { ...this.doc.proofing },
      previewCache: precisionPreviewCacheStats(),
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
    const guides = side === "before" ? entry.guidesBefore : entry.guidesAfter;
    if (guides) this.doc.guides = guides.map((guide) => ({ ...guide }));
    this.checkpointDocumentSurfaces(true);
  }
  private applySnapshots(snaps: LayerSnapshot[]) {
    for (const snap of snaps) {
      const layer = this.doc.layers.find((l) => l.id === snap.layerId);
      if (!layer) continue;
      if (snap.bitmap) { layer.bitmap = cloneCanvas(snap.bitmap); bumpBitmapVersion(layer.bitmap); }
      if (snap.surface) layer.surface = snap.surface.clone();
      if (snap.mask) { layer.mask = cloneCanvas(snap.mask); bumpBitmapVersion(layer.mask); }
      if (snap.tone) layer.tone = { ...snap.tone };
      if (snap.curves) layer.curves = cloneCurves(snap.curves);
      if (snap.levels) layer.levels = { ...snap.levels };
      if (snap.hsl) layer.hsl = { ...snap.hsl };
      if (snap.path) layer.path = { ...snap.path, anchors: snap.path.anchors.map((a) => ({ ...a, hIn: { ...a.hIn }, hOut: { ...a.hOut } })) };
      if (snap.parentId !== undefined) layer.parentId = snap.parentId ?? undefined;
      if (snap.locked !== undefined) layer.locked = snap.locked;
      if (snap.clipping !== undefined) layer.clipping = snap.clipping;
      if (snap.filters) layer.filters = cloneFilters(snap.filters);
      if (snap.ai) layer.ai = {
        ...snap.ai,
        sourceLayerIds: [...snap.ai.sourceLayerIds],
        parameters: snap.ai.parameters ? { ...snap.ai.parameters } : undefined,
      };
      if (snap.effects) layer.effects = cloneEffects(snap.effects);
      if (snap.opacity !== undefined) layer.opacity = snap.opacity;
      if (snap.fillOpacity !== undefined) layer.fillOpacity = snap.fillOpacity ?? undefined;
      if (snap.blend) layer.blend = snap.blend;
      if (snap.blendStack !== undefined) layer.blendStack = snap.blendStack ? cloneBlendStack(snap.blendStack) : undefined;
      if (snap.blendIf !== undefined) layer.blendIf = snap.blendIf ? cloneBlendIf(snap.blendIf) : undefined;
      if (snap.visible !== undefined) layer.visible = snap.visible;
      if (snap.name) layer.name = snap.name;
      if (snap.transform) layer.transform = { ...snap.transform };
      if (snap.text) layer.text = { ...snap.text };
      if (snap.shape) layer.shape = { ...snap.shape };
      if (snap.bitmap && !snap.surface) this.syncLayerSurface(layer);
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
    this.ensureDocumentSurfaces(doc);
    this.saveActiveSession();
    const current = this.sessions.find((session) => session.id === this.activeSessionId);
    if (current && current.doc.layers.length === 0) {
      current.name = name;
      current.doc = doc;
      current.history = new OperationHistory<HistoryEntry>({ maxNodes: HISTORY_LIMIT });
      this.doc = doc;
      this.history = current.history;
      this.checkpointDocumentSurfaces(true);
      return;
    }
    const session: DocumentSession = {
      id: nextId("doc"),
      name,
      doc,
      history: new OperationHistory<HistoryEntry>({ maxNodes: HISTORY_LIMIT }),
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
    this.history = new OperationHistory<HistoryEntry>({ maxNodes: HISTORY_LIMIT });
    const session = this.sessions.find((candidate) => candidate.id === this.activeSessionId);
    if (session) session.history = this.history;
    this.requestRender();
    this.emit();
  }

  openImage(name: string, img: HTMLImageElement, source?: SourceProvenance) {
    this.installDocument(createDocument(img.naturalWidth, img.naturalHeight), name);
    return this.addRasterFromImage(name, img, source);
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
    const x = Math.max(0, Math.floor(bounds.x));
    const y = Math.max(0, Math.floor(bounds.y));
    const width = Math.min(this.doc.width - x, Math.max(1, Math.ceil(bounds.w)));
    const height = Math.min(this.doc.height - y, Math.max(1, Math.ceil(bounds.h)));
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
    this.doc.guides = this.doc.guides
      .map((guide) => ({ ...guide, position: guide.position - (guide.orientation === "vertical" ? x : y) }))
      .filter((guide) => guide.position >= 0 && guide.position <= (guide.orientation === "vertical" ? width : height));
    this.doc.selection = null;
    const after = cloneDocument(this.doc);
    this.commit({ label: "Crop to selection", before: [], after: [], documentBefore: before, documentAfter: after });
    this.requestRender();
    return true;
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
    const dispose = plugin.activate(this) || undefined;
    this.plugins.set(plugin.id, { plugin, dispose });
    this.emit();
    return () => this.unregisterPlugin(plugin.id);
  }

  unregisterPlugin(id: string) {
    const entry = this.plugins.get(id);
    if (!entry) return;
    entry.dispose?.();
    this.plugins.delete(id);
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

  liveUpdateLevels(id: string, levels: LevelsParams) {
    const layer = this.findLayer(id);
    if (!layer || layer.kind !== "adjustment-levels") return;
    const key = `levels:${id}`;
    if (!this.liveSnapshots.has(key)) this.liveSnapshots.set(key, { layerId: id, levels: layer.levels ? { ...layer.levels } : undefined });
    layer.levels = { ...levels };
    this.requestRender();
  }
  updateLevels(id: string, levels: LevelsParams) {
    const layer = this.findLayer(id);
    if (!layer || layer.kind !== "adjustment-levels") return;
    const key = `levels:${id}`;
    const before: LayerSnapshot = this.liveSnapshots.get(key) ?? { layerId: id, levels: layer.levels ? { ...layer.levels } : undefined };
    this.liveSnapshots.delete(key);
    layer.levels = { ...levels };
    const after: LayerSnapshot = { layerId: id, levels: { ...levels } };
    this.commit({ label: "Levels adjusted", before: [before], after: [after] });
    this.requestRender();
  }

  liveUpdateHsl(id: string, hsl: HslParams) {
    const layer = this.findLayer(id);
    if (!layer || layer.kind !== "adjustment-hsl") return;
    const key = `hsl:${id}`;
    if (!this.liveSnapshots.has(key)) this.liveSnapshots.set(key, { layerId: id, hsl: layer.hsl ? { ...layer.hsl } : undefined });
    layer.hsl = { ...hsl };
    this.requestRender();
  }
  updateHsl(id: string, hsl: HslParams) {
    const layer = this.findLayer(id);
    if (!layer || layer.kind !== "adjustment-hsl") return;
    const key = `hsl:${id}`;
    const before: LayerSnapshot = this.liveSnapshots.get(key) ?? { layerId: id, hsl: layer.hsl ? { ...layer.hsl } : undefined };
    this.liveSnapshots.delete(key);
    layer.hsl = { ...hsl };
    const after: LayerSnapshot = { layerId: id, hsl: { ...hsl } };
    this.commit({ label: "HSL adjusted", before: [before], after: [after] });
    this.requestRender();
  }

  updateCurves(id: string, curves: Curves) {
    const layer = this.findLayer(id);
    if (!layer || layer.kind !== "adjustment-curves") return;
    const key = `curves:${id}`;
    const before: LayerSnapshot = this.liveSnapshots.get(key) ?? { layerId: id, curves: layer.curves ? cloneCurves(layer.curves) : undefined };
    this.liveSnapshots.delete(key);
    layer.curves = cloneCurves(curves);
    const after: LayerSnapshot = { layerId: id, curves: cloneCurves(curves) };
    this.commit({ label: "Curves adjusted", before: [before], after: [after] });
    this.requestRender();
  }

  liveUpdateCurves(id: string, curves: Curves) {
    const layer = this.findLayer(id);
    if (!layer || layer.kind !== "adjustment-curves") return;
    const key = `curves:${id}`;
    if (!this.liveSnapshots.has(key)) this.liveSnapshots.set(key, { layerId: id, curves: layer.curves ? cloneCurves(layer.curves) : undefined });
    layer.curves = cloneCurves(curves);
    this.requestRender();
  }

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
    const bitmap = newCanvas(this.doc.width, this.doc.height);
    const layer = createRasterLayer(name, bitmap);
    layer.surface = this.surfaceFromCanvas(bitmap);
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

  updateTone(id: string, tone: ToneParams) {
    const layer = this.findLayer(id);
    if (!layer || layer.kind !== "adjustment-tone") return;
    const key = `tone:${id}`;
    const before: LayerSnapshot = this.liveSnapshots.get(key) ?? { layerId: id, tone: layer.tone ? { ...layer.tone } : undefined };
    this.liveSnapshots.delete(key);
    layer.tone = { ...tone };
    const after: LayerSnapshot = { layerId: id, tone: { ...tone } };
    this.commit({ label: "Tone adjusted", before: [before], after: [after] });
    this.requestRender();
  }

  liveUpdateTone(id: string, tone: ToneParams) {
    const layer = this.findLayer(id);
    if (!layer || layer.kind !== "adjustment-tone") return;
    const key = `tone:${id}`;
    if (!this.liveSnapshots.has(key)) this.liveSnapshots.set(key, { layerId: id, tone: layer.tone ? { ...layer.tone } : undefined });
    layer.tone = { ...tone };
    this.requestRender();
  }

  // --- painting ---
  beginStroke(layerId: string, params: BrushParams, point: { x: number; y: number; p: number }) {
    const layer = this.findLayer(layerId);
    if (!layer || layer.locked) return;
    if (!paintTarget(layer, params, this.doc.width, this.doc.height)) return;
    this.strokeTiles = new Map();
    this.lastPoint = point;
    this.paintTo(layerId, params, point);
  }

  paintTo(layerId: string, params: BrushParams, point: { x: number; y: number; p: number }) {
    const layer = this.findLayer(layerId);
    if (!layer) return;
    const target = paintTarget(layer, params, this.doc.width, this.doc.height);
    if (!target) return;
    const ctx = target.getContext("2d")!;
    const prev = this.lastPoint ?? point;
    const stabilization = Math.max(0, Math.min(0.95, params.smoothing ?? 0));
    const response = 1 - stabilization * 0.9;
    const next = stabilization > 0 ? {
      x: prev.x + (point.x - prev.x) * response,
      y: prev.y + (point.y - prev.y) * response,
      p: prev.p + (point.p - prev.p) * response,
    } : point;
    this.captureStrokeTiles(layer, target, params, prev, next);

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
      paintSegment(sctx, prev, next, { ...params, mode: params.mode === "erase" ? "paint" : params.mode });
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
      paintSegment(ctx, prev, next, params);
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
    this.lastPoint = null;
  }

  private captureStrokeTiles(
    layer: Layer,
    canvas: HTMLCanvasElement,
    params: BrushParams,
    from: { x: number; y: number },
    to: { x: number; y: number },
  ) {
    if (!this.strokeTiles) return;
    const radius = params.size * 0.55 + 2;
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
    ensureMask(layer, this.doc.width, this.doc.height);
    const mask = layer.mask!;
    const before = [snapshotLayer(layer)];
    const ctx = mask.getContext("2d")!;
    const img = ctx.getImageData(0, 0, mask.width, mask.height);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) d[i + 3] = 255 - d[i + 3];
    ctx.putImageData(img, 0, 0);
    bumpBitmapVersion(mask);
    this.commit({ label: "Mask inverted", before, after: [snapshotLayer(layer)] });
    this.requestRender();
  }

  clearMask(layerId: string) {
    const layer = this.findLayer(layerId);
    if (!layer || !layer.mask) return;
    const before = [snapshotLayer(layer)];
    const ctx = layer.mask.getContext("2d")!;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "rgba(0,0,0,1)";
    ctx.fillRect(0, 0, this.doc.width, this.doc.height);
    ctx.restore();
    bumpBitmapVersion(layer.mask);
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

  async generativeEdit(
    layerId: string,
    prompt: string,
    operation: AiProvenance["operation"] = "fill",
  ) {
    const source = this.findLayer(layerId);
    if (!source || source.kind === "group") throw new Error("Select a content layer");
    const composite = this.flatten();
    const image = await canvasToBlob(composite);
    const body = new FormData();
    body.append("image", image, "source.png");
    body.append("prompt", prompt);
    body.append("operation", operation);
    let maskBlob: Blob | undefined;
    if (this.doc.selection) {
      const mask = newCanvas(this.doc.width, this.doc.height);
      const input = this.doc.selection.mask.getContext("2d")!.getImageData(0, 0, this.doc.width, this.doc.height);
      const output = mask.getContext("2d")!.createImageData(this.doc.width, this.doc.height);
      for (let i = 0; i < input.data.length; i += 4) {
        output.data[i] = 255;
        output.data[i + 1] = 255;
        output.data[i + 2] = 255;
        output.data[i + 3] = 255 - input.data[i + 3];
      }
      mask.getContext("2d")!.putImageData(output, 0, 0);
      maskBlob = await canvasToBlob(mask);
      body.append("mask", maskBlob, "mask.png");
    }
    const [inputSha256, maskSha256] = await Promise.all([
      sha256Blob(image),
      maskBlob ? sha256Blob(maskBlob) : Promise.resolve(undefined),
    ]);
    const response = await fetch("/api/ai/edit", { method: "POST", body });
    if (!response.ok) {
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      throw new Error(payload?.error ?? "Generative edit failed");
    }
    const result = await blobToCanvas(await response.blob(), this.doc.width, this.doc.height);
    const layer = createRasterLayer(`AI · ${operation}`, result);
    layer.surface = this.surfaceFromCanvas(result);
    layer.ai = {
      id: nextId("ai"),
      operation,
      provider: "openai",
      model: response.headers.get("x-luma-model") ?? "gpt-image-2",
      prompt,
      createdAt: new Date().toISOString(),
      sourceLayerIds: [layerId],
      usedSelection: !!this.doc.selection,
      requestId: response.headers.get("x-openai-request-id") ?? undefined,
      inputSha256,
      maskSha256,
      parameters: {
        quality: (response.headers.get("x-luma-quality") as "low" | "medium" | "high" | null) ?? "medium",
        size: response.headers.get("x-luma-size") ?? "auto",
      },
    };
    this.commitStructural(`AI ${operation}`, () => this.doc.layers.unshift(layer));
    this.checkpointLayerSurface(layer);
    this.requestRender();
    return layer;
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
    ensureMask(layer, this.doc.width, this.doc.height);
    const src = layer.bitmap.getContext("2d")!;
    const img = src.getImageData(0, 0, layer.bitmap.width, layer.bitmap.height);
    const d = img.data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    const mean = sum / (d.length / 4);
    const mask = layer.mask!;
    const mctx = mask.getContext("2d")!;
    const mimg = mctx.createImageData(mask.width, mask.height);
    const m = mimg.data;
    for (let i = 0, j = 0; i < d.length; i += 4, j += 4) {
      const luma = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      const t = Math.max(0, Math.min(1, (luma - (mean - 40)) / 80));
      m[j] = 255; m[j + 1] = 255; m[j + 2] = 255; m[j + 3] = Math.round(t * 255);
    }
    mctx.putImageData(mimg, 0, 0);
    bumpBitmapVersion(mask);
    this.commit({ label: "Auto subject mask", before, after: [snapshotLayer(layer)] });
    this.actions.push({ op: "autoSubject" });
    this.requestRender();
  }

  // --- selection ---
  selectRect(x: number, y: number, w: number, h: number, mode: SelectionMode = "replace", feather = 0) {
    const before = cloneSelection(this.doc.selection);
    selectRect(this.doc, x, y, w, h, mode, feather);
    const after = cloneSelection(this.doc.selection);
    this.commit({ label: "Selection", before: [], after: [], selectionBefore: before, selectionAfter: after });
    this.requestRender();
  }
  selectEllipse(x: number, y: number, w: number, h: number, mode: SelectionMode = "replace", feather = 0) {
    const before = cloneSelection(this.doc.selection);
    selectEllipse(this.doc, x, y, w, h, mode, feather);
    const after = cloneSelection(this.doc.selection);
    this.commit({ label: "Selection (ellipse)", before: [], after: [], selectionBefore: before, selectionAfter: after });
    this.requestRender();
  }
  selectLasso(points: Array<{ x: number; y: number }>, mode: SelectionMode = "replace", feather = 0) {
    const before = cloneSelection(this.doc.selection);
    selectLasso(this.doc, points, mode, feather);
    const after = cloneSelection(this.doc.selection);
    this.commit({ label: "Selection (lasso)", before: [], after: [], selectionBefore: before, selectionAfter: after });
    this.requestRender();
  }
  selectByColor(layerId: string, x: number, y: number, tolerance: number, mode: SelectionMode = "replace", contiguous = true) {
    const layer = this.findLayer(layerId);
    if (!layer || layer.kind !== "raster" || !layer.bitmap) return;
    const before = cloneSelection(this.doc.selection);
    selectByColor(this.doc, layer.bitmap, x, y, tolerance, mode, contiguous);
    const after = cloneSelection(this.doc.selection);
    this.commit({ label: "Magic wand", before: [], after: [], selectionBefore: before, selectionAfter: after });
    this.requestRender();
  }
  selectAll() {
    const before = cloneSelection(this.doc.selection);
    selectAll(this.doc);
    const after = cloneSelection(this.doc.selection);
    this.commit({ label: "Select all", before: [], after: [], selectionBefore: before, selectionAfter: after });
    this.actions.push({ op: "selectAll" });
    this.requestRender();
  }
  deselect() {
    if (!this.doc.selection) return;
    const before = cloneSelection(this.doc.selection);
    deselect(this.doc);
    this.commit({ label: "Deselect", before: [], after: [], selectionBefore: before, selectionAfter: null });
    this.actions.push({ op: "deselect" });
    this.requestRender();
  }
  invertSelectionArea() {
    const before = cloneSelection(this.doc.selection);
    invertSelection(this.doc);
    const after = cloneSelection(this.doc.selection);
    this.commit({ label: "Invert selection", before: [], after: [], selectionBefore: before, selectionAfter: after });
    this.actions.push({ op: "invertSelection" });
    this.requestRender();
  }
  featherSelection(radius: number) {
    const before = cloneSelection(this.doc.selection);
    featherSelection(this.doc, radius);
    const after = cloneSelection(this.doc.selection);
    this.commit({ label: `Feather ${radius}px`, before: [], after: [], selectionBefore: before, selectionAfter: after });
    this.actions.push({ op: "featherSelection", radius });
    this.requestRender();
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

  exportPsd(): ArrayBuffer { return exportPsd(this.doc); }

  async exportProject(name = "Untitled") {
    const { encodeLumaProject } = await import("./project");
    return encodeLumaProject(this.doc, this.actions.list(), name, this.history.snapshot());
  }

  async importProject(blob: Blob) {
    const { decodeLumaProject } = await import("./project");
    const project = await decodeLumaProject(blob);
    this.installDocument(project.doc, project.name);
    this.history = project.history ?? new OperationHistory<HistoryEntry>({ maxNodes: HISTORY_LIMIT });
    const session = this.sessions.find((candidate) => candidate.id === this.activeSessionId);
    if (session) session.history = this.history;
    this.actions.fromJSON(JSON.stringify(project.actions));
    this.requestRender();
    this.emit();
    return project;
  }

  // --- export ---
  async exportImage(type: "image/png" | "image/jpeg" | "image/webp" = "image/png", quality = 0.92): Promise<Blob> {
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

function shallowCloneLayer(layer: Layer): Layer {
  return {
    ...layer,
    surface: layer.surface?.clone(),
    source: layer.source ? { ...layer.source } : undefined,
    blendStack: layer.blendStack ? cloneBlendStack(layer.blendStack) : undefined,
    blendIf: layer.blendIf ? cloneBlendIf(layer.blendIf) : undefined,
    transform: { ...layer.transform },
    tone: layer.tone ? { ...layer.tone } : undefined,
    curves: layer.curves ? cloneCurves(layer.curves) : undefined,
    levels: layer.levels ? { ...layer.levels } : undefined,
    hsl: layer.hsl ? { ...layer.hsl } : undefined,
    text: layer.text ? { ...layer.text } : undefined,
    shape: layer.shape ? { ...layer.shape } : undefined,
    path: layer.path ? deepClonePath(layer.path) : undefined,
    filters: layer.filters ? cloneFilters(layer.filters) : undefined,
    ai: layer.ai ? {
      ...layer.ai,
      sourceLayerIds: [...layer.ai.sourceLayerIds],
      parameters: layer.ai.parameters ? { ...layer.ai.parameters } : undefined,
    } : undefined,
    effects: layer.effects ? cloneEffects(layer.effects) : undefined,
  };
}

function cloneDocument(doc: Document): Document {
  return {
    ...doc,
    resolution: { ...doc.resolution },
    guides: doc.guides.map((guide) => ({ ...guide })),
    proofing: { ...doc.proofing },
    layers: doc.layers.map((layer) => ({
      ...shallowCloneLayer(layer),
      bitmap: layer.bitmap ? cloneCanvas(layer.bitmap) : undefined,
      mask: layer.mask ? cloneCanvas(layer.mask) : undefined,
    })),
    selection: doc.selection ? {
      mask: cloneCanvas(doc.selection.mask),
      bounds: { ...doc.selection.bounds },
    } : null,
  };
}

function cloneSelection(selection: Selection | null | undefined): Selection | null {
  return selection ? {
    mask: cloneCanvas(selection.mask),
    bounds: { ...selection.bounds },
  } : null;
}

function deepClonePath(p: PathStyle): PathStyle {
  return {
    ...p,
    anchors: p.anchors.map((a) => ({ ...a, hIn: { ...a.hIn }, hOut: { ...a.hOut } })),
  };
}

function snapshotLayer(layer: Layer): LayerSnapshot {
  return {
    layerId: layer.id,
    bitmap: layer.bitmap ? cloneCanvas(layer.bitmap) : undefined,
    surface: layer.surface?.clone(),
    mask: layer.mask ? cloneCanvas(layer.mask) : undefined,
    tone: layer.tone ? { ...layer.tone } : undefined,
    curves: layer.curves ? cloneCurves(layer.curves) : undefined,
    levels: layer.levels ? { ...layer.levels } : undefined,
    hsl: layer.hsl ? { ...layer.hsl } : undefined,
    opacity: layer.opacity,
    fillOpacity: layer.fillOpacity ?? null,
    blend: layer.blend,
    blendStack: layer.blendStack ? cloneBlendStack(layer.blendStack) : null,
    blendIf: layer.blendIf ? cloneBlendIf(layer.blendIf) : null,
    visible: layer.visible,
    name: layer.name,
    transform: { ...layer.transform },
    text: layer.text ? { ...layer.text } : undefined,
    shape: layer.shape ? { ...layer.shape } : undefined,
    path: layer.path ? deepClonePath(layer.path) : undefined,
    parentId: layer.parentId ?? null,
    locked: layer.locked,
    clipping: layer.clipping,
    filters: layer.filters ? cloneFilters(layer.filters) : undefined,
    ai: layer.ai ? {
      ...layer.ai,
      sourceLayerIds: [...layer.ai.sourceLayerIds],
      parameters: layer.ai.parameters ? { ...layer.ai.parameters } : undefined,
    } : undefined,
    effects: layer.effects ? cloneEffects(layer.effects) : undefined,
  };
}

function pixelFormatForDepth(bitDepth: Document["bitDepth"]): PixelFormat {
  return bitDepth === 32 ? "rgba32f" : bitDepth === 16 ? "rgba16f" : "rgba8";
}

function cloneFilters(filters: SmartFilter[]): SmartFilter[] {
  return filters.map((filter) => ({ ...filter, params: { ...filter.params } }));
}

function cloneEffects(effects: LayerEffect[]): LayerEffect[] {
  return effects.map((effect) => ({ ...effect }));
}

function cloneBlendStack(passes: ReadonlyArray<BlendPass>): BlendPass[] {
  return passes.map((pass) => ({ ...pass }));
}

function cloneBlendIf(settings: BlendIf): BlendIf {
  return {
    activeChannel: settings.activeChannel,
    channels: {
      gray: { source: { ...settings.channels.gray.source }, underlying: { ...settings.channels.gray.underlying } },
      red: { source: { ...settings.channels.red.source }, underlying: { ...settings.channels.red.underlying } },
      green: { source: { ...settings.channels.green.source }, underlying: { ...settings.channels.green.underlying } },
      blue: { source: { ...settings.channels.blue.source }, underlying: { ...settings.channels.blue.underlying } },
    },
  };
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

function paintTarget(layer: Layer, params: BrushParams, width: number, height: number): HTMLCanvasElement | null {
  if (params.mode === "mask-add" || params.mode === "mask-remove") {
    return ensureMask(layer, width, height);
  }
  return layer.bitmap ?? null;
}

// Scripting surface — installed on window as `window.luma` in the studio page.
export type LumaAPI = {
  version: "0.3";
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
