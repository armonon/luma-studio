import assert from "node:assert/strict";
import test from "node:test";
import { createDocument, createRasterLayer } from "../app/engine/document.ts";
import { renderClean, renderTiledClean } from "../app/engine/renderer.ts";
import { pixelAt, solidCanvas, testCanvas } from "./canvas-harness.ts";

for (const [name, render] of [["full", renderClean], ["tiled", renderTiledClean]] as const) {
  test(`${name} clean rendering requests sRGB before a display context can convert export pixels`, () => {
    const doc = createDocument(4, 4); doc.layers = [createRasterLayer("Color", solidCanvas(4, 4, "#229966"))];
    const target = testCanvas(4, 4), original = target.getContext.bind(target);
    const requests: (string | undefined)[] = [];
    target.getContext = ((type: string, options?: CanvasRenderingContext2DSettings) => {
      requests.push(options?.colorSpace);
      return original(type as "2d", options);
    }) as typeof target.getContext;
    render(doc, target);
    assert.equal(requests[0], "srgb");
    assert.deepEqual(pixelAt(target, 0, 0), { r: 34, g: 153, b: 102, a: 255 });
  });
  test(`${name} clean rendering refuses an already-P3 viewport instead of mislabeling its samples`, () => {
    const doc = createDocument(4, 4), target = testCanvas(4, 4), context = target.getContext("2d")!;
    context.getContextAttributes = () => ({ colorSpace: "display-p3" }) as CanvasRenderingContext2DSettings;
    assert.throws(() => render(doc, target), /fresh sRGB/);
  });
}
