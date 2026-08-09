/**
 * Luma engine — public API.
 *
 * This is the single supported entry point. Both editions consume it:
 *
 *   web — `app/studio` in the browser
 *   pro — the packaged desktop build
 *
 * Import from here (`@/app/engine`) rather than reaching into individual
 * modules, so internals stay free to move. Anything not re-exported here is
 * internal and may change without notice.
 *
 * The engine is DOM-optional. Document, history, selection, plugin and blend
 * work run headlessly (see tests); only rendering and export need a canvas.
 */

// ---------- document model ----------
export {
  BLEND_LABELS,
  IDENTITY_TRANSFORM,
  NEUTRAL_CURVES,
  NEUTRAL_HSL,
  NEUTRAL_LEVELS,
  NEUTRAL_TONE,
  cloneCanvas,
  cloneCurves,
  createDocument,
  curveToLut,
  layerCorners,
  newCanvas,
} from "./document";
export type {
  BlendMode,
  CapturedBrushAsset,
  MAX_CAPTURED_BRUSHES,
  MAX_CAPTURED_BRUSH_EDGE,
  Curves,
  Document,
  HslParams,
  Layer,
  LayerKind,
  LevelsParams,
  PathAnchor,
  PathStyle,
  Selection,
  ShapeStyle,
  TextStyle,
  ToneParams,
  Transform,
} from "./document";

export type { ImageBrushMode, ImageBrushTip } from "./brush";

// ---------- controller ----------
export { LUMA_API_VERSION, Studio, isCompatibleApiVersion } from "./studio";
export type { HistoryEntry, LayerSnapshot, LumaAPI, LumaPlugin } from "./studio";

// ---------- editions ----------
export {
  CAPABILITY_STATUS,
  DEFAULT_EDITION,
  EDITION_CAPABILITIES,
  currentEdition,
  hasCapability,
  isAvailable,
  proOnlyCapabilities,
} from "./edition";
export type { Capability, CapabilityStatus, LumaEdition } from "./edition";

// ---------- compositing ----------
export { blendRgb, compositeBlendStack, isNeutralBlendIf } from "./blend";
export { render, renderClean, renderViewport } from "./renderer";
export { isGLSupported, renderGL } from "./gl-renderer";
export {
  compositeNativeTile,
  encodeNativeTileRequest,
  isNativeCoreAvailable,
  nativeCoreInfo,
} from "./native-core";
export type { NativeTileLayer, NativeTileRequest } from "./native-core";
export { isNativeFilesystemAvailable, openNativeFile, saveNativeFile } from "./native-files";

// ---------- selection ----------
export {
  deselect,
  featherSelection,
  invertSelection,
  selectAll,
  selectByColor,
  selectEllipse,
  selectLasso,
  selectMask,
  selectRect,
} from "./selection";
export type { SelectionMode } from "./selection";

// ---------- history ----------
export { OperationHistory } from "./operation-history";
export type { OperationHistorySnapshot, OperationNode } from "./operation-history";

// ---------- interchange ----------
export { exportPsd, importPsd } from "./psd";
export {
  DNG_DECODED_EXTENSIONS,
  RAW_EXTENSIONS,
  ingestRaw,
  rawExtension,
  supportsSensorDecode,
} from "./raw";

// ---------- automation ----------
export { ActionRecorder } from "./actions";
export type { Action, ActionStep } from "./actions";
