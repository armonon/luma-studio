export const PHONE_DRAW_KEY = "luma.phone.finger-drawing.v1";
export const PHONE_VIEWPORT_LIMITS = { maxDimension: 2048, maxPixels: 2_000_000 } as const;

export function compactPhoneViewport(width: number, height: number) {
  return width > 0 && height > 0 && (width <= 600 || (width <= 900 && height <= 500));
}

/** Screen dimensions, not keyboard-reduced viewport height, select the form factor. */
export function phoneInterface(touchPoints: number, coarse: boolean, platform: string, width: number, height: number, override: string | null) {
  if (override === "phone") return true;
  if (override === "desktop" || override === "tablet") return false;
  if (touchPoints < 1) return false;
  if (/iPhone|iPod/.test(platform)) return true;
  return coarse && Number.isFinite(width) && Number.isFinite(height)
    && Math.min(width, height) > 0 && Math.min(width, height) <= 600;
}

export function phoneViewport(height: number, offsetTop: number, scale: number) {
  // Don't undo accessibility page zoom. CSS remains the fallback without VisualViewport.
  if (!Number.isFinite(height) || height <= 0 || !Number.isFinite(offsetTop) || scale !== 1) return null;
  return { height: Math.round(height), top: Math.max(0, Math.round(offsetTop)) };
}

/** Only text-entry occlusion, never page zoom or ordinary orientation changes. */
export function phoneKeyboardOpen(layoutHeight: number, viewportHeight: number, scale: number, textEntry: boolean, previouslyOpen = false) {
  // Tapping a category/preset may blur the field before iOS retracts its keyboard.
  // Keep the sheet expanded until the actual occlusion ends.
  return (textEntry || previouslyOpen) && scale === 1 && Number.isFinite(layoutHeight) && Number.isFinite(viewportHeight)
    && viewportHeight > 0 && layoutHeight - viewportHeight > 120;
}
