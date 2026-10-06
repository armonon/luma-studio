/**
 * The desktop application menu.
 *
 * This is the canonical definition. The Rust side builds the real native menu
 * from the same ids (see `src-tauri/src/main.rs`), and a test asserts the two
 * agree — a menu item wired on one side and not the other is a dead entry, and
 * a menu full of dead entries is worse than no menu at all.
 *
 * Every command here is backed by something that exists today. That constraint
 * is the point: it would be easy to lay out Photoshop's whole menu bar and
 * have two thirds of it do nothing, which is the same class of untruth as
 * advertising an unbuilt capability. Items Luma cannot do yet are absent, not
 * greyed out and hopeful.
 */

/** Everything the menu can ask the studio to do. */
export type StudioCommand =
  // Application
  | "check-for-updates"
  // File
  | "new-document"
  | "close-document"
  | "open"
  | "save"
  | "save-as"
  | "export"
  | "export-print"
  | "batch"
  | "mockups"
  | "glyph-font-maker"
  // Edit
  | "undo"
  | "redo"
  | "history"
  | "copy-pixels" | "copy-merged" | "cut-pixels" | "paste-pixels" | "paste-in-place" | "delete-pixels" | "selection-to-layer"
  | "copy-layer-style"
  | "define-custom-shape"
  | "paste-layer-style"
  // Image
  | "document-properties"
  | "crop-selection"
  // Select
  | "select-all"
  | "deselect"
  | "invert-selection"
  | "select-subject"
  | "select-channel"
  | "channel-save" | "channel-load" | "channel-update" | "channel-rename" | "channel-delete" | "channel-invert" | "channel-calculate"
  // Layer
  | "new-layer"
  | "duplicate-layer"
  | "group-layer"
  | "ungroup-layers" | "merge-layers" | "rename-layer" | "toggle-layer-lock" | "toggle-layer-visibility"
  | "delete-layer"
  | "convert-smart-object"
  | "replace-smart-content"
  | "edit-smart-content" | "apply-smart-content"
  | "bring-forward"
  | "send-backward"
  | "layer-style"
  | "recolor"
  | "curves"
  | "levels"
  | "hsl"
  // Filter
  | "filter-gallery"
  | "filter-invert"
  | "filter-blur"
  | "filter-sharpen"
  | "filter-desaturate"
  // View
  | "zoom-in"
  | "zoom-out"
  | "zoom-fit"
  | "zoom-actual"
  | "toggle-guides"
  | "toggle-rulers"
  // Window
  | "panel-properties"
  | "panel-selection"
  | "panel-mask"
  | "panel-raw"
  | "panel-paint"
  | "panel-vector"
  | "panel-transform"
  | "panel-measure"
  | "panel-layers"
  | "panel-document"
  | "panel-channels"
  | "panel-comps"
  | "panel-campaign"
  | "panel-assets"
  | "panel-neural"
  | "panel-actions"
  | "workspace-settings";

export type MenuEntry =
  | { kind: "command"; id: StudioCommand; label: string; accelerator?: string }
  | { kind: "separator" }
  /**
   * A menu item the window manager owns — quit, minimise, close, the macOS
   * application menu's About and Services. Tauri builds these itself, so they
   * carry no command id and never reach the studio.
   */
  | { kind: "predefined"; role: PredefinedRole; label?: string };

export type PredefinedRole =
  | "about" | "services" | "hide" | "hide-others" | "show-all" | "quit"
  | "separator" | "close-window" | "minimize" | "fullscreen"
  | "copy" | "cut" | "paste" | "select-all-text" | "undo-text" | "redo-text";

export type MenuSection = { label: string; items: MenuEntry[] };

/**
 * Accelerators use Tauri's cross-platform `CmdOrCtrl` so one definition serves
 * macOS and Windows. They deliberately match the shortcuts the studio already
 * handles in its own key listener; the menu is a second way to reach the same
 * command, not a competing binding.
 */
export const DESKTOP_MENU: MenuSection[] = [
  {
    label: "Luma Studio",
    items: [
      { kind: "predefined", role: "about" },
      { kind: "separator" },
      { kind: "command", id: "check-for-updates", label: "Check for Updates…" },
      { kind: "separator" },
      { kind: "predefined", role: "services" },
      { kind: "separator" },
      { kind: "predefined", role: "hide" },
      { kind: "predefined", role: "hide-others" },
      { kind: "predefined", role: "show-all" },
      { kind: "separator" },
      { kind: "predefined", role: "quit" },
    ],
  },
  {
    label: "File",
    items: [
      { kind: "command", id: "new-document", label: "New…", accelerator: "CmdOrCtrl+N" },
      { kind: "command", id: "open", label: "Open…", accelerator: "CmdOrCtrl+O" },
      { kind: "command", id: "save", label: "Save", accelerator: "CmdOrCtrl+S" },
      { kind: "command", id: "save-as", label: "Save As…", accelerator: "CmdOrCtrl+Shift+S" },
      { kind: "separator" },
      { kind: "command", id: "export", label: "Export…", accelerator: "CmdOrCtrl+Shift+E" },
      { kind: "command", id: "export-print", label: "CMYK Print PDF…" },
      { kind: "command", id: "batch", label: "Batch Process…" },
      { kind: "separator" },
      // Alpha creative tools. Both open full-screen dialogs that work on any
      // document (Mockups reads the flattened artwork; Glyph needs none).
      { kind: "command", id: "mockups", label: "Mockups…" },
      { kind: "command", id: "glyph-font-maker", label: "Glyph Font Maker…" },
      { kind: "separator" },
      { kind: "command", id: "close-document", label: "Close Document", accelerator: "CmdOrCtrl+W" },
    ],
  },
  {
    label: "Edit",
    items: [
      { kind: "command", id: "undo", label: "Undo", accelerator: "CmdOrCtrl+Z" },
      { kind: "command", id: "redo", label: "Redo", accelerator: "CmdOrCtrl+Shift+Z" },
      { kind: "separator" },
      // The text roles are what make copy and paste work inside the studio's
      // own inputs; canvas clipboard events route to pixel commands instead.
      { kind: "predefined", role: "cut" },
      { kind: "predefined", role: "copy" },
      { kind: "predefined", role: "paste" },
      { kind: "separator" },
      { kind: "command", id: "copy-pixels", label: "Copy Selected Pixels" },
      { kind: "command", id: "copy-merged", label: "Copy Merged", accelerator: "CmdOrCtrl+Shift+C" },
      { kind: "command", id: "cut-pixels", label: "Cut Selected Pixels" },
      { kind: "command", id: "paste-pixels", label: "Paste Pixels as Layer" },
      { kind: "command", id: "paste-in-place", label: "Paste in Place", accelerator: "CmdOrCtrl+Shift+V" },
      { kind: "command", id: "delete-pixels", label: "Delete Selected Pixels" },
      { kind: "command", id: "selection-to-layer", label: "Layer via Copy", accelerator: "CmdOrCtrl+Alt+J" },
      { kind: "separator" },
      { kind: "command", id: "copy-layer-style", label: "Copy Layer Style" },
      { kind: "command", id: "define-custom-shape", label: "Define Custom Shape" },
      { kind: "command", id: "paste-layer-style", label: "Paste Layer Style" },
      { kind: "separator" },
      { kind: "command", id: "history", label: "Version History…" },
    ],
  },
  {
    label: "Image",
    items: [
      { kind: "command", id: "document-properties", label: "Document Properties…" },
      { kind: "separator" },
      { kind: "command", id: "crop-selection", label: "Crop to Selection" },
    ],
  },
  {
    label: "Layer",
    items: [
      { kind: "command", id: "new-layer", label: "New Layer", accelerator: "CmdOrCtrl+Shift+N" },
      { kind: "command", id: "duplicate-layer", label: "Duplicate Layer", accelerator: "CmdOrCtrl+J" },
      { kind: "command", id: "group-layer", label: "Group Selected Layers", accelerator: "CmdOrCtrl+G" },
      { kind: "command", id: "ungroup-layers", label: "Ungroup Selected Layers", accelerator: "CmdOrCtrl+Shift+G" },
      { kind: "command", id: "merge-layers", label: "Merge Selected Layers", accelerator: "CmdOrCtrl+E" },
      { kind: "command", id: "rename-layer", label: "Rename Layer…" },
      { kind: "command", id: "toggle-layer-lock", label: "Lock / Unlock Selected Layers" },
      { kind: "command", id: "toggle-layer-visibility", label: "Show / Hide Selected Layers" },
      { kind: "command", id: "delete-layer", label: "Delete Layer" },
      { kind: "command", id: "convert-smart-object", label: "Convert to Smart Object" },
      { kind: "command", id: "replace-smart-content", label: "Replace Raster Contents…" },
      { kind: "command", id: "edit-smart-content", label: "Edit Smart Contents…" },
      { kind: "command", id: "apply-smart-content", label: "Apply Contents to Parent" },
      { kind: "separator" },
      { kind: "command", id: "bring-forward", label: "Bring Forward", accelerator: "CmdOrCtrl+]" },
      { kind: "command", id: "send-backward", label: "Send Backward", accelerator: "CmdOrCtrl+[" },
      { kind: "separator" },
      { kind: "command", id: "layer-style", label: "Layer Style…" },
      { kind: "command", id: "recolor", label: "Recolor…", accelerator: "CmdOrCtrl+Alt+R" },
      { kind: "separator" },
      { kind: "command", id: "curves", label: "New Curves Adjustment" },
      { kind: "command", id: "levels", label: "New Levels Adjustment" },
      { kind: "command", id: "hsl", label: "New HSL Adjustment" },
    ],
  },
  {
    label: "Select",
    items: [
      { kind: "command", id: "select-all", label: "All", accelerator: "CmdOrCtrl+A" },
      { kind: "command", id: "deselect", label: "Deselect", accelerator: "CmdOrCtrl+D" },
      { kind: "command", id: "invert-selection", label: "Inverse", accelerator: "CmdOrCtrl+Shift+I" },
      { kind: "separator" },
      { kind: "command", id: "select-subject", label: "Subject" },
      { kind: "command", id: "select-channel", label: "Load Composite Channel", accelerator: "CmdOrCtrl+Alt+2" },
      { kind: "command", id: "channel-save", label: "Save Selection as Alpha Channel", accelerator: "CmdOrCtrl+Shift+Alt+2" },
      { kind: "command", id: "channel-load", label: "Load Saved Alpha Channel" },
      { kind: "command", id: "channel-update", label: "Replace Alpha with Selection" },
      { kind: "command", id: "channel-rename", label: "Rename Alpha Channel" },
      { kind: "command", id: "channel-invert", label: "Invert Alpha Channel" },
      { kind: "command", id: "channel-calculate", label: "Calculate Alpha Channels" },
      { kind: "command", id: "channel-delete", label: "Delete Alpha Channel" },
    ],
  },
  {
    label: "Filter",
    items: [
      { kind: "command", id: "filter-gallery", label: "Filter Gallery…" },
      { kind: "separator" },
      { kind: "command", id: "filter-invert", label: "Invert Pixels" },
      { kind: "command", id: "filter-blur", label: "Gaussian Blur" },
      { kind: "command", id: "filter-sharpen", label: "Sharpen" },
      { kind: "command", id: "filter-desaturate", label: "Desaturate" },
    ],
  },
  {
    label: "View",
    items: [
      { kind: "command", id: "zoom-in", label: "Zoom In", accelerator: "CmdOrCtrl+Plus" },
      { kind: "command", id: "zoom-out", label: "Zoom Out", accelerator: "CmdOrCtrl+-" },
      { kind: "separator" },
      { kind: "command", id: "zoom-fit", label: "Fit on Screen", accelerator: "CmdOrCtrl+0" },
      { kind: "command", id: "zoom-actual", label: "Actual Size", accelerator: "CmdOrCtrl+1" },
      { kind: "separator" },
      { kind: "command", id: "toggle-guides", label: "Show Guides" },
      { kind: "command", id: "toggle-rulers", label: "Show Rulers", accelerator: "CmdOrCtrl+R" },
      { kind: "separator" },
      { kind: "predefined", role: "fullscreen" },
      { kind: "predefined", role: "minimize" },
    ],
  },
  {
    label: "Window",
    items: [
      { kind: "command", id: "panel-layers", label: "Layers" },
      { kind: "command", id: "panel-properties", label: "Properties" },
      { kind: "command", id: "panel-selection", label: "Selection" },
      { kind: "command", id: "panel-mask", label: "Masks" },
      { kind: "command", id: "panel-raw", label: "RAW Develop" },
      { kind: "command", id: "panel-paint", label: "Brushes" },
      { kind: "command", id: "panel-vector", label: "Type & Vector" },
      { kind: "command", id: "panel-transform", label: "Transform" },
      { kind: "command", id: "panel-measure", label: "Measure" },
      { kind: "command", id: "panel-document", label: "Document & Color" },
      { kind: "command", id: "panel-channels", label: "Channels" },
      { kind: "command", id: "panel-comps", label: "Layer Comps & Artboards" },
      { kind: "command", id: "panel-campaign", label: "Campaign", accelerator: "CmdOrCtrl+Alt+K" },
      { kind: "command", id: "panel-assets", label: "Plugins & Assets" },
      { kind: "command", id: "panel-neural", label: "Neural Lab" },
      { kind: "command", id: "panel-actions", label: "Actions" },
      { kind: "separator" },
      { kind: "command", id: "workspace-settings", label: "Workspace Settings…" },
    ],
  },
];

/** Every command id the menu can emit, in menu order. */
export function menuCommands(menu: MenuSection[] = DESKTOP_MENU): StudioCommand[] {
  return menu.flatMap((section) =>
    section.items.flatMap((item) => (item.kind === "command" ? [item.id] : [])));
}

/** The event name the native menu emits on the window. */
export const MENU_COMMAND_EVENT = "luma://menu-command";

/**
 * A document to open, by absolute path.
 *
 * Emitted for a file double-clicked in the Finder, one passed on the command
 * line, and one chosen from Open Recent — all three are the same request, so
 * they arrive the same way.
 */
export const OPEN_FILE_EVENT = "luma://open-file";

/** How many entries the Open Recent submenu holds. Mirrored in main.rs. */
export const MAX_RECENT_FILES = 10;
