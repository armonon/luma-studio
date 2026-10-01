/** Touch drawing never inherits a stale desktop Space/hand modifier. */
export function canvasPointerIntent(button: number, pointerType: string, spaceHeld: boolean): "edit" | "pan" | "ignore" {
  if (pointerType === "touch") return button === 0 ? "edit" : "ignore";
  if (button === 1 || (button === 0 && spaceHeld)) return "pan";
  return button === 0 ? "edit" : "ignore";
}

/** Touch has an explicit More button; holds must not turn into desktop menus. */
export function allowToolHold(button: number, pointerType: string, touchWorkspace: boolean) {
  return button === 0 && pointerType !== "touch" && !touchWorkspace;
}
