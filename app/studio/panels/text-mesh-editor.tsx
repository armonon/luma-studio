"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { SpatialLayerStyle, TextStyle } from "@/app/engine/document";
import { createShapedTextMesh, disposeTextMesh, updateTextMesh } from "@/app/engine/text-mesh";
import { computeTextOutlines } from "@/app/engine/text-shaping-client";
import { resolvedTextSpatial } from "@/app/engine/text-3d";
import { cloneLetteringAsset, letteringSourceKey, validateLetteringAsset, type LetteringAsset } from "@/app/engine/lettering-asset";
import { validateOutlineText, type ShapedOutlines } from "@/app/engine/text-outline-model";

type Runtime = { renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera; mesh?: ReturnType<typeof createShapedTextMesh>; draw: () => void };
export default function TextMeshEditor({ text, spatial, onLiveRotate, onCommit, onRender, onExport, onAsset, initialAsset, assetLabel = "Add editable 3D layer", showRasterAction = true }: {
  text: TextStyle;
  spatial: SpatialLayerStyle;
  onLiveRotate: (rotationX: number, rotationY: number) => void;
  onCommit: () => void;
  onRender: (canvas: HTMLCanvasElement) => void;
  onExport: (blob: Blob, extension: "glb" | "png") => Promise<unknown>;
  onAsset?: (canvas: HTMLCanvasElement, asset: LetteringAsset) => void;
  initialAsset?: LetteringAsset;
  assetLabel?: string;
  showRasterAction?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const runtime = useRef<Runtime | null>(null);
  const latest = useRef({ text, spatial, onLiveRotate, onCommit, onRender, onExport });
  useLayoutEffect(() => { latest.current = { text, spatial, onLiveRotate, onCommit, onRender, onExport }; });
  const [initialized, setInitialized] = useState(false);
  const [status, setStatus] = useState("Preparing 3D workspace…");
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const builtGeometry = useRef<string | null>(null);
  const builtOutlines = useRef<ShapedOutlines | null>(null);
  const drag = useRef<{ pointer: number; x: number; y: number; rx: number; ry: number } | null>(null);
  // Source position, projection and material changes do not change glyph geometry.
  const geometryKeyFor = (source: TextStyle, style: SpatialLayerStyle) => JSON.stringify({ text: { ...source, x: 0, y: 0, spatial: undefined }, extrusion: style.extrusion });
  const geometryKey = geometryKeyFor(text, spatial);
  const appearanceKey = JSON.stringify(spatial);

  useEffect(() => {
    const target = host.current;
    if (!target) return;
    let renderer: THREE.WebGLRenderer | undefined;
    let environment: THREE.WebGLRenderTarget | undefined;
    let observer: ResizeObserver | undefined;
    const contextLost = (event: Event) => { event.preventDefault(); setReady(false); setStatus("3D graphics context was lost. Close and reopen the 3D workspace; your source text is unchanged."); };
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true, powerPreference: "low-power" });
      renderer.setPixelRatio(1);
      renderer.setClearColor(0x000000, 0);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.domElement.setAttribute("aria-label", "3D lettering preview; drag to rotate, arrow keys to rotate, Shift for larger steps");
      renderer.domElement.tabIndex = 0;
      target.appendChild(renderer.domElement);
      renderer.domElement.addEventListener("webglcontextlost", contextLost);
      const scene = new THREE.Scene();
      const room = new RoomEnvironment();
      const generator = new THREE.PMREMGenerator(renderer);
      environment = generator.fromScene(room, 0.04);
      room.dispose(); generator.dispose();
      scene.environment = environment.texture;
      scene.add(new THREE.HemisphereLight(0xffffff, 0x3b4255, 1.1));
      const key = new THREE.DirectionalLight(0xffffff, 3); key.position.set(-2, 3, 4); scene.add(key);
      const fill = new THREE.DirectionalLight(0x9dbbff, 1.5); fill.position.set(3, 1, -2); scene.add(fill);
      const camera = new THREE.PerspectiveCamera(35, 4 / 3, 0.01, 100000);
      const engine: Runtime = { renderer, scene, camera, draw: () => {
        if (!engine.mesh || renderer!.getContext().isContextLost()) return;
        const safe = resolvedTextSpatial({ ...latest.current.spatial, enabled: true })!;
        updateTextMesh(engine.mesh, safe);
        const radius = Math.max(1, engine.mesh.geometry.boundingSphere?.radius ?? 1);
        camera.fov = 20 + safe.transform.perspective * 0.5;
        camera.aspect = renderer!.domElement.width / renderer!.domElement.height;
        camera.position.set(0, 0, radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.1 / Math.min(1, camera.aspect));
        camera.near = Math.max(0.01, camera.position.z - radius * 2); camera.far = camera.position.z + radius * 3;
        camera.updateProjectionMatrix(); camera.lookAt(0, 0, 0);
        renderer!.render(scene, camera);
      } };
      runtime.current = engine;
      const resize = () => { const width = Math.max(160, Math.min(640, target.clientWidth)); renderer!.setSize(width, Math.round(width * 0.75)); engine.draw(); };
      observer = new ResizeObserver(resize); observer.observe(target); resize();
      // Imperative renderer setup must publish readiness once to the React UI.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setInitialized(true);
    } catch (error) { setStatus(error instanceof Error ? error.message : "3D requires WebGL2 support."); }
    return () => {
      generation.current += 1;
      observer?.disconnect();
      const mesh = runtime.current?.mesh;
      if (mesh) disposeTextMesh(mesh);
      runtime.current = null;
      environment?.dispose();
      renderer?.domElement.removeEventListener("webglcontextlost", contextLost);
      renderer?.dispose(); renderer?.forceContextLoss(); renderer?.domElement.remove();
    };
  }, []);

  useEffect(() => {
    if (!initialized) return;
    const engine = runtime.current;
    if (!engine) return;
    const ticket = ++generation.current;
    const abort = new AbortController();
    setReady(false); setStatus("Building letter outlines…");
    // Debounce geometry work during typing or depth/bevel drags. Rotation/material
    // updates below reuse geometry and render only in response to an interaction.
    const timer = window.setTimeout(() => {
      const source = latest.current;
      const saved = initialAsset && letteringSourceKey(initialAsset.text) === letteringSourceKey(source.text) ? initialAsset : undefined;
      const outlinesJob = saved ? Promise.resolve().then(() => { validateLetteringAsset(saved); return saved.outlines; }) : computeTextOutlines(source.text, abort.signal);
      void outlinesJob.then(outlines => {
        if (ticket !== generation.current || runtime.current !== engine) return;
        const safe = resolvedTextSpatial({ ...source.spatial, enabled: true })!;
        const mesh = createShapedTextMesh(source.text, safe, outlines);
        if (engine.mesh) { engine.scene.remove(engine.mesh); disposeTextMesh(engine.mesh); }
        engine.mesh = mesh; engine.scene.add(mesh); engine.draw();
        builtGeometry.current = geometryKeyFor(source.text, source.spatial);
        builtOutlines.current = outlines;
        const face = validateOutlineText(source.text).selected;
        setStatus(`${face.font.family} ${face.face} · ${Math.round(mesh.geometry.getAttribute("position").count / 3).toLocaleString()} triangles`);
        setReady(true);
      }).catch(error => {
        if (ticket !== generation.current) return;
        if (engine.mesh) { engine.scene.remove(engine.mesh); disposeTextMesh(engine.mesh); engine.mesh = undefined; }
        engine.renderer.clear(); setStatus(error instanceof Error ? error.message : "Mesh creation failed.");
      });
    }, 120);
    return () => { window.clearTimeout(timer); generation.current += 1; abort.abort(); };
  }, [geometryKey, initialized, initialAsset]);

  useEffect(() => { runtime.current?.draw(); }, [appearanceKey]);

  const snapshot = () => {
    const engine = runtime.current;
    if (!ready || !engine?.mesh || engine.renderer.getContext().isContextLost()) throw new Error("Wait for the mesh to finish loading.");
    if (builtGeometry.current !== geometryKeyFor(latest.current.text, latest.current.spatial)) throw new Error("Text changed. Wait for the updated mesh before exporting.");
    const width = engine.renderer.domElement.width; const height = engine.renderer.domElement.height;
    try {
      engine.renderer.setSize(1600, 1200, false); engine.draw();
      const canvas = document.createElement("canvas"); canvas.width = 1600; canvas.height = 1200;
      const context = canvas.getContext("2d"); if (!context) throw new Error("Image rendering is unavailable.");
      context.drawImage(engine.renderer.domElement, 0, 0); return canvas;
    } finally { engine.renderer.setSize(width, height, false); engine.draw(); }
  };
  const assertCurrent = (source: string) => {
    if (!runtime.current || source !== JSON.stringify({ text: latest.current.text, spatial: latest.current.spatial })) throw new Error("Text or 3D settings changed during export. Try again.");
  };
  const action = async (work: () => Promise<unknown> | unknown) => { setBusy(true); try { await work(); } catch (error) { setStatus(error instanceof Error ? error.message : "3D export failed."); } finally { setBusy(false); } };

  return <section className="type-mesh-editor type-wide" aria-label="3D lettering workspace">
    <div ref={host} className="type-mesh-viewport"
      onPointerDown={event => { if (!ready || event.button !== 0) return; event.preventDefault(); event.stopPropagation(); runtime.current?.renderer.domElement.focus(); event.currentTarget.setPointerCapture(event.pointerId); drag.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, rx: spatial.transform.rotationX, ry: spatial.transform.rotationY }; }}
      onPointerMove={event => { const from = drag.current; if (!from || from.pointer !== event.pointerId) return; onLiveRotate(Math.max(-180, Math.min(180, from.rx + (event.clientY - from.y) * 0.5)), Math.max(-180, Math.min(180, from.ry + (event.clientX - from.x) * 0.5))); }}
      onPointerUp={event => { if (drag.current?.pointer === event.pointerId) { drag.current = null; onCommit(); } }}
      onPointerCancel={() => { const from = drag.current; drag.current = null; if (from) { onLiveRotate(from.rx, from.ry); onCommit(); } }}
      onLostPointerCapture={() => { if (drag.current) { drag.current = null; onCommit(); } }}
      onKeyDown={event => { if (!ready || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return; event.preventDefault(); event.stopPropagation(); const step = event.shiftKey ? 15 : 3; onLiveRotate(Math.max(-180, Math.min(180, spatial.transform.rotationX + (event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0))), Math.max(-180, Math.min(180, spatial.transform.rotationY + (event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0)))); }}
      onKeyUp={event => { if (event.key.startsWith("Arrow")) { event.stopPropagation(); onCommit(); } }} onBlur={onCommit} />
    <p role="status">{status}</p>
    <div className="type-mesh-actions">
      {onAsset && <button disabled={!ready || busy} onClick={() => void action(() => {
        const canvas = snapshot();
        if (!builtOutlines.current) throw new Error("Wait for the geometry to finish loading.");
        const asset: LetteringAsset = cloneLetteringAsset({ version: 1, renderer: "luma-lettering-v1", text: latest.current.text, spatial: resolvedTextSpatial({ ...latest.current.spatial, enabled: true })!, outlines: builtOutlines.current, width: canvas.width, height: canvas.height });
        validateLetteringAsset(asset);
        onAsset(canvas, asset);
      })}>{assetLabel}</button>}
      {showRasterAction && <button disabled={!ready || busy} onClick={() => void action(() => onRender(snapshot()))}>Add render layer</button>}
      <button disabled={!ready || busy} onClick={() => void action(async () => {
        const canvas = snapshot(); const source = JSON.stringify({ text: latest.current.text, spatial: latest.current.spatial });
        const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error("PNG encoding failed.")), "image/png"));
        assertCurrent(source);
        return onExport(blob, "png");
      })}>Export PNG</button>
      <button disabled={!ready || busy} onClick={() => void action(async () => {
        const source = JSON.stringify({ text: latest.current.text, spatial: latest.current.spatial }); const mesh = runtime.current?.mesh;
        if (!mesh) return;
        if (builtGeometry.current !== geometryKeyFor(latest.current.text, latest.current.spatial)) throw new Error("Text changed. Wait for the updated mesh before exporting.");
        runtime.current?.draw();
        mesh.userData.lumaTypography = structuredClone(latest.current.text);
        const { GLTFExporter } = await import("three/examples/jsm/exporters/GLTFExporter.js");
        assertCurrent(source);
        const bytes = await new GLTFExporter().parseAsync(mesh, { binary: true });
        assertCurrent(source);
        return onExport(new Blob([bytes as ArrayBuffer], { type: "model/gltf-binary" }), "glb");
      })}>Export GLB</button>
    </div>
    <small>Drag or use arrow keys to rotate. HarfBuzz outlines with bidirectional layout, up to 160 characters. Choose a font covering the script: Noto Sans Arabic, Noto Sans Hebrew, or Rajdhani for Devanagari. Point text supports four font faces with one shared color; frames require one style. Complex-script justification, vertical/path text and explicit Bidi controls are not supported. Editable 3D layers retain text, geometry, camera and materials with a 1600 × 1200 render. 2D fill stacks are not applied. GLB exports geometry.</small>
  </section>;
}
