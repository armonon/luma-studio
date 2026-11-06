import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { build } from "esbuild";
import React, { act, createRef } from "react";

// A DOM unit harness only, never a browser driver. Reuse an installed harness
// through ordinary resolution; a fresh checkout can explicitly skip without it.
const require = createRequire(import.meta.url);
let jsdomPath;
try { jsdomPath = require.resolve("jsdom", process.env.LUMA_TEST_DOM_ROOT ? { paths: [process.env.LUMA_TEST_DOM_ROOT] } : undefined); } catch { /* Optional installed test harness. */ }

test("mounted Edit Points previews/commits final endpoints, cancels, preserves multiselection, numeric angles and mobile controls", { skip: !jsdomPath && "Installed jsdom harness not available; set LUMA_TEST_DOM_ROOT to an existing trusted package root" }, async () => {
  const { JSDOM } = await import(pathToFileURL(jsdomPath).href);
  const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', { url: "https://luma.test", pretendToBeVisual: true });
  const previous = new Map();
  const setGlobal = (key, value) => { previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { value, configurable: true, writable: true }); };
  for (const key of ["window", "document", "HTMLElement", "Element", "Event", "MouseEvent", "KeyboardEvent", "HTMLInputElement"]) setGlobal(key, dom.window[key]);
  setGlobal("navigator", dom.window.navigator); setGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let frameId = 0; const frames = new Map();
  setGlobal("requestAnimationFrame", fn => { frames.set(++frameId, fn); return frameId; }); setGlobal("cancelAnimationFrame", id => frames.delete(id));
  const flush = () => { const queued = [...frames.values()]; frames.clear(); queued.forEach(fn => fn(0)); };
  const tmp = await mkdtemp(new URL("../node_modules/.cache-point-ui-", import.meta.url)), output = path.join(tmp, "editor.mjs");
  let root;
  try {
    await build({ entryPoints: [new URL("../app/studio/path-point-editor.tsx", import.meta.url).pathname], outfile: output, bundle: true, packages: "external", platform: "node", format: "esm", jsx: "automatic", loader: { ".css": "empty" }, logLevel: "silent" });
    const { PathPointEditor } = await import(pathToFileURL(output).href);
    const { createRoot } = await import("react-dom/client");
    const layer = { id: "vector", kind: "path", locked: false, transform: { tx: 0, ty: 0, sx: 1, sy: 1, rotation: 0 }, path: {
      anchors: [
        { id: "a", x: 30, y: 80, mode: "corner", hIn: { dx: -10, dy: 0 }, hOut: { dx: 30, dy: -20 } },
        { id: "b", x: 150, y: 80, mode: "corner", hIn: { dx: -25, dy: -20 }, hOut: { dx: 0, dy: 0 } },
        { id: "c", x: 230, y: 120, mode: "corner", hIn: { dx: 0, dy: 0 }, hOut: { dx: 0, dy: 0 } },
      ], closed: false, fill: "none", stroke: "#fff", strokeWidth: 2, fillRule: "evenodd",
    } };
    const history = [], errors = [];
    const studio = { doc: { layers: [layer] }, activeDocumentState: () => ({ id: "document" }), findLayer: id => id === layer.id ? layer : undefined, requestRender() {}, liveUpdatePath(id, next) { assert.equal(id, layer.id); layer.path = structuredClone(next); }, updatePath(id, next) { assert.equal(id, layer.id); history.push({ before: structuredClone(layer.path), after: structuredClone(next) }); layer.path = structuredClone(next); } };
    const ref = createRef(), container = dom.window.document.getElementById("app"); root = createRoot(container);
    const mount = phone => React.createElement(PathPointEditor, { ref, studio, layer, documentId: "document", viewport: { x: 0, y: 0, width: 400, height: 300, cssScale: 1 }, phone, notify: message => errors.push(message) });
    await act(async () => root.render(mount(false)));
    container.querySelector("svg").getBoundingClientRect = () => ({ width: 400, height: 300, left: 0, top: 0 });
    const pointer = (x, y, extra = {}) => ({ x, y, pointerId: 1, pointerType: "mouse", shiftKey: false, altKey: false, ...extra });
    await act(async () => { ref.current.down(pointer(30, 80)); ref.current.end(pointer(30, 80)); });
    assert.match(container.querySelector("summary").textContent, /1 selected/); assert.equal(history.length, 0, "selection alone creates no history");
    await act(async () => { ref.current.down(pointer(30, 80)); ref.current.move(pointer(50, 110)); flush(); });
    assert.equal(layer.path.anchors[0].x, 50); assert.equal(history.length, 0, "preview is transient");
    await act(async () => ref.current.end(pointer(70, 120)));
    assert.equal(history.length, 1); assert.equal(layer.path.anchors[0].x, 70); assert.equal(layer.path.anchors[0].y, 120, "release coordinate is retained");
    const committed = structuredClone(layer.path);
    await act(async () => { ref.current.down(pointer(70, 120)); ref.current.move(pointer(95, 140)); flush(); dom.window.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    assert.deepEqual(layer.path, committed); assert.equal(history.length, 1); assert.equal(ref.current.active, false);
    await act(async () => { ref.current.down(pointer(150, 80, { shiftKey: true })); ref.current.end(pointer(150, 80, { shiftKey: true })); });
    assert.match(container.querySelector("summary").textContent, /2 selected/);
    await act(async () => { ref.current.down(pointer(70, 120)); ref.current.move(pointer(80, 130)); ref.current.end(pointer(80, 130)); });
    assert.equal(layer.path.anchors[0].x, 80); assert.equal(layer.path.anchors[1].x, 160); assert.equal(history.length, 2);
    // Select one point again before editing numeric controls.
    await act(async () => { ref.current.down(pointer(350, 250)); ref.current.end(pointer(350, 250)); ref.current.down(pointer(160, 90)); ref.current.end(pointer(160, 90)); });
    const inputFor = label => [...container.querySelectorAll("label")].find(node => node.firstChild?.textContent === label)?.querySelector("input");
    const enterNumber = async (input, value) => {
      assert.ok(input); await act(async () => input.focus());
      await act(async () => { Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set.call(input, String(value)); input.dispatchEvent(new dom.window.Event("input", { bubbles: true })); });
      await act(async () => input.blur());
    };
    const out = [...container.querySelectorAll("fieldset")].find(node => node.querySelector("legend")?.textContent === "Outgoing handle");
    await enterNumber(out.querySelector('input[type="number"]'), 25);
    const angle = [...container.querySelectorAll("fieldset")].find(node => node.querySelector("legend")?.textContent === "Outgoing handle").querySelectorAll("input")[1];
    await enterNumber(angle, 90);
    assert.ok(Math.abs(layer.path.anchors[1].hOut.dx) < 1e-8); assert.equal(layer.path.anchors[1].hOut.dy, -25);
    assert.ok(inputFor("Point X (local px)"));
    await act(async () => root.render(mount(true)));
    assert.equal(container.querySelector("details").open, false, "phone starts with compact controls");
    assert.match(container.textContent, /Straight endpoint chord|Cut \/ Open/);
    const original = structuredClone(layer.path), count = history.length;
    await act(async () => { ref.current.down(pointer(230, 120, { pointerType: "touch" })); ref.current.move(pointer(250, 130, { pointerType: "touch" })); flush(); ref.current.end(pointer(250, 130, { pointerType: "touch" }), true); });
    assert.deepEqual(layer.path, original); assert.equal(history.length, count, "touch cancellation creates no history");
    let rootUndos = 0; const undo = event => { if (event.key === "z" && event.ctrlKey) rootUndos++; }; dom.window.addEventListener("keydown", undo);
    await act(async () => { ref.current.down(pointer(230, 120)); ref.current.move(pointer(250, 140)); flush(); dom.window.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true, cancelable: true })); });
    assert.deepEqual(layer.path, original); assert.equal(rootUndos, 0, "Undo during a preview cancels it without undoing an unrelated edit");
    await act(async () => dom.window.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true })));
    assert.equal(rootUndos, 1, "ordinary app undo is left available after cancellation"); dom.window.removeEventListener("keydown", undo);
    await act(async () => { ref.current.down(pointer(230, 120)); ref.current.move(pointer(250, 140)); flush(); dom.window.document.body.dispatchEvent(new dom.window.Event("pointerdown", { bubbles: true })); });
    assert.deepEqual(layer.path, original); assert.equal(history.length, count, "outside menu/layer actions cannot consume a preview");
    await act(async () => { ref.current.down(pointer(230, 120)); ref.current.move(pointer(260, 150)); flush(); root.unmount(); }); root = null;
    assert.deepEqual(layer.path, original, "unmount restores source preview"); assert.deepEqual(errors, []);
  } finally {
    if (root) await act(async () => root.unmount());
    await rm(tmp, { recursive: true, force: true }); dom.window.close();
    for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
  }
});
