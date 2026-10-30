export {canvasPointerIntent} from "../shared/drawing-input";

/** Touch has an explicit More button; holds must not turn into desktop menus. */
export function allowToolHold(button: number, pointerType: string, touchWorkspace: boolean) {
  return button === 0 && pointerType !== "touch" && !touchWorkspace;
}
