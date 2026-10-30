import assert from "node:assert/strict";
import test from "node:test";
import "./canvas-harness.ts";
import { testCanvas, pixelAt } from "./canvas-harness.ts";
import { Studio } from "../app/engine/studio.ts";
import { notifyTextFontsChanged } from "../app/engine/text-font-resources.ts";
import { viewportRenderCacheStats } from "../app/engine/renderer.ts";
import { AdaptiveRenderGovernor } from "../app/engine/performance-governor.ts";
import type { DisplayViewport } from "../app/engine/viewport.ts";

function withFrames(run: (flush: () => void) => Promise<void>) {
  const host = globalThis as unknown as Record<string, unknown>;
  const priorWindow = host.window, priorRaf = host.requestAnimationFrame;
  const frames: Array<() => void> = [];
  host.window = { setTimeout: () => 1, clearTimeout() {} };
  host.requestAnimationFrame = (callback: () => void) => { frames.push(callback); return frames.length; };
  const flush = () => { let count = 0; while (frames.length) { assert.ok(count++ < 20, "render loop must settle"); frames.shift()!(); } };
  return run(flush).finally(() => {
    if (priorWindow === undefined) delete host.window; else host.window = priorWindow;
    if (priorRaf === undefined) delete host.requestAnimationFrame; else host.requestAnimationFrame = priorRaf;
  });
}
const view: DisplayViewport = { x: 0, y: 0, width: 64, height: 64, outputWidth: 64, outputHeight: 64, cssScale: 1, devicePixelRatio: 1, zoom: 1 };
function steadyGovernor(studio: Studio) {
  (studio as unknown as { renderGovernor: AdaptiveRenderGovernor }).renderGovernor = new AdaptiveRenderGovernor({ navigationTargetMs: 100_000, interactiveTargetMs: 100_000 });
}

test("returning to a viewport reuses unchanged pixels, while edits and undo invalidate them", async () => {
  await withFrames(async flush => {
    const target = testCanvas(64, 64), studio = new Studio(64, 64, target);
    steadyGovernor(studio);
    try {
      const layer = studio.addBlankRaster("Paint");
      studio.fillLayer(layer.id, "red");
      studio.setVirtualViewport(view); flush();
      const original = target.getContext("2d")!.getImageData(0, 0, 64, 64).data.slice();
      studio.setVirtualViewport({ ...view, x: 8, y: 4 }); flush();
      const beforeReturn = viewportRenderCacheStats();
      studio.setVirtualViewport(view); flush();
      const returned = viewportRenderCacheStats();
      assert.equal(returned.misses, beforeReturn.misses, "pan does not invalidate content tiles");
      assert.ok(returned.hits > beforeReturn.hits);
      assert.deepEqual(target.getContext("2d")!.getImageData(0, 0, 64, 64).data, original);
      studio.fillLayer(layer.id, "blue"); flush();
      assert.ok(pixelAt(target, 20, 20).b > 200, "content edit replaces cached red");
      studio.undo(); flush();
      assert.ok(pixelAt(target, 20, 20).r > 200, "undo restores actual red content");
      studio.redo(); flush();
      assert.ok(pixelAt(target, 20, 20).b > 200);
      const reopened = new Studio(1, 1, testCanvas(1, 1));
      try {
        await reopened.importProject(await studio.exportProject("Navigation pixels"));
        assert.ok(pixelAt(reopened.doc.layers[0].bitmap!, 20, 20).b > 200);
        reopened.undo();
        assert.ok(pixelAt(reopened.doc.layers[0].bitmap!, 20, 20).r > 200);
      } finally { reopened.dispose(); }
    } finally { studio.dispose(); }
  });
});

test("focus cache entries remain distinct without destroying the full composite", async () => {
  await withFrames(async flush => {
    const target=testCanvas(64,64), studio=new Studio(64,64,target);steadyGovernor(studio);
    try {
      const bottom=studio.addBlankRaster("Bottom");studio.fillLayer(bottom.id,"red");
      const top=studio.addBlankRaster("Top");studio.fillLayer(top.id,"blue");
      studio.setVirtualViewport(view);flush();
      studio.setFocusPreview({layerId:bottom.id,target:"pixels",context:"off"});flush();
      assert.ok(pixelAt(target,20,20).r>200);
      const before=viewportRenderCacheStats();studio.setFocusPreview(null);flush();
      assert.ok(pixelAt(target,20,20).b>200);
      assert.equal(viewportRenderCacheStats().misses,before.misses);
    } finally {studio.dispose();}
  });
});

test("adaptive preview redraws do not invalidate an unchanged project-save ticket", async () => {
  await withFrames(async flush => {
    const studio=new Studio(64,64,testCanvas(64,64));steadyGovernor(studio);
    try {
      const layer=studio.addBlankRaster("Paint");studio.fillLayer(layer.id,"red");
      studio.setVirtualViewport(view);flush();
      const ticket=await studio.prepareProjectSave("Quality adjustment");
      (studio as unknown as {renderGovernor:AdaptiveRenderGovernor}).renderGovernor=new AdaptiveRenderGovernor({navigationTargetMs:0.000001,slowFramesToDownshift:1});
      studio.setVirtualViewport({...view,x:1});flush();
      assert.ok(studio.engineState().adaptivePreview.downshifts>0);
      assert.equal(studio.completeProjectSave(ticket),true,"display quality is not a document edit");
    } finally {studio.dispose();}
  });
});

test("external font refresh invalidates composite tiles without invalidating a document-save ticket",async()=>{
 await withFrames(async flush=>{
  const studio=new Studio(64,64,testCanvas(64,64));steadyGovernor(studio);
  try{
   const layer=studio.addBlankRaster("Pixels");studio.fillLayer(layer.id,"red");studio.setVirtualViewport(view);flush();
   const ticket=await studio.prepareProjectSave("Font resource refresh"),before=viewportRenderCacheStats();
   notifyTextFontsChanged();flush();
   assert.ok(viewportRenderCacheStats().misses>before.misses,"new font resources must not reuse stale fallback glyph tiles");
   assert.equal(studio.completeProjectSave(ticket),true,"font availability is not an authored document change");
  }finally{studio.dispose();}
 });
});
