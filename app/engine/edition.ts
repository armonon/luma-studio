/**
 * Editions.
 *
 * Luma ships in two forms from one engine:
 *
 *   web — runs in the browser. Sandboxed: no filesystem, memory bounded by the
 *         tab, RAW limited to what decodes in WASM.
 *   pro — packaged desktop build. Native filesystem, larger memory ceiling,
 *         and room for native codecs.
 *
 * Capabilities are declared here so features can gate on a real, testable flag
 * instead of a UI guess. A capability answers "is this edition *permitted* to
 * do this", not "is this already built" — see `CAPABILITY_STATUS` for the
 * latter, which exists specifically so we do not advertise unbuilt features.
 */

export type LumaEdition = "web" | "pro";

export type Capability =
  /** Open/save through the OS without a file picker round-trip. */
  | "filesystem-access"
  /** Documents beyond the browser's canvas area ceiling (~64MP / 16384px). */
  | "large-documents"
  /** Sensor decode for non-DNG camera RAW (needs a native/WASM RAW library). */
  | "native-raw"
  /** RGBA16F GPU compositing for flattened export. */
  | "gpu-export"
  /** On-device matting/segmentation models. */
  | "on-device-models"
  /** Load plugins from disk rather than only via the scripting console. */
  | "plugin-install";

const WEB: readonly Capability[] = ["gpu-export", "on-device-models"];

const PRO: readonly Capability[] = [
  ...WEB,
  "filesystem-access",
  "large-documents",
  "native-raw",
  "plugin-install",
];

export const EDITION_CAPABILITIES: Readonly<Record<LumaEdition, readonly Capability[]>> = {
  web: WEB,
  pro: PRO,
};

/**
 * Implementation status, kept deliberately separate from permission.
 *
 * "shipped"  — implemented and reachable by a user today.
 * "planned"  — permitted by the edition but NOT built. Nothing may advertise
 *              a planned capability as available; `isAvailable` returns false.
 */
export type CapabilityStatus = "shipped" | "planned";

export const CAPABILITY_STATUS: Readonly<Record<Capability, CapabilityStatus>> = {
  "gpu-export": "shipped",
  "on-device-models": "shipped",
  "filesystem-access": "shipped",
  // Sparse selections and sparse masks shipped, so the old note here — that
  // they were the blockers — is no longer true. What remains is narrower and
  // more stubborn: past the ceiling a raster layer has a tile surface and no
  // canvas, so PNG export streams band by band but JPEG and WebP have no
  // tile-streaming encoder to use, and the operations that need a real canvas
  // (gradient and pattern fill, perspective crop and warp, distort, frames,
  // layer-style rasterization, bitmap merge) refuse and say why. That is a
  // usable large-document workflow, not a complete one, and "shipped" would
  // promise the complete one. See docs/release/large-documents-decision.md.
  "large-documents": "planned",
  // DNG development and macOS camera-codec fallback are shipped; a complete
  // nondestructive proprietary-RAW pipeline is not.
  "native-raw": "planned",
  "plugin-install": "shipped",
};

export const DEFAULT_EDITION: LumaEdition = "web";

function normalizeEdition(value: string | undefined | null): LumaEdition | null {
  return value === "web" || value === "pro" ? value : null;
}

/**
 * The edition this build is running as. Set NEXT_PUBLIC_LUMA_EDITION=pro (or
 * LUMA_EDITION=pro) in the desktop build; anything else is the web edition.
 */
export function currentEdition(env: Record<string, string | undefined> = readEnv()): LumaEdition {
  return (
    normalizeEdition(env.NEXT_PUBLIC_LUMA_EDITION) ??
    normalizeEdition(env.LUMA_EDITION) ??
    DEFAULT_EDITION
  );
}

function readEnv(): Record<string, string | undefined> {
  try {
    return typeof process !== "undefined" && process.env ? process.env : {};
  } catch {
    return {};
  }
}

/** Whether the edition is permitted this capability (ignores build status). */
export function hasCapability(edition: LumaEdition, capability: Capability): boolean {
  return EDITION_CAPABILITIES[edition].includes(capability);
}

/**
 * Whether a user can actually use this capability right now: the edition must
 * permit it AND it must be built. UI should gate on this, never on
 * `hasCapability` alone, so planned work is never surfaced as available.
 */
export function isAvailable(edition: LumaEdition, capability: Capability): boolean {
  return hasCapability(edition, capability) && CAPABILITY_STATUS[capability] === "shipped";
}

/** Capabilities pro adds over web — the honest basis for any upgrade prompt. */
export function proOnlyCapabilities(): readonly Capability[] {
  return EDITION_CAPABILITIES.pro.filter((c) => !EDITION_CAPABILITIES.web.includes(c));
}
