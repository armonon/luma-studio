"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Download, FileImage, ImagePlus, Package, RotateCcw, Undo2, Redo2, Save, FolderOpen, Upload, X } from "lucide-react";
import JSZip from "jszip";
import { mockupFileName, normalizePlacement, sceneDeltaToOffset, type MockupPlacement, type MockupSceneId, type Quad, type RasterImage } from "../engine/mockup";
import { MOCKUP_SCENES, sceneInfo } from "../engine/mockup-scenes";
import { MockupClient } from "./mockup-client";
import type { MockupRenderResult } from "./mockup-renderer";
import { initialMockupStates, readMockupProject, type MockupStates } from "../engine/mockup-project";
import "./creative-tools.css";

const PREVIEW_SIZE = 760, THUMB_SIZE = 200, MAX_ART = 2048;
const EXPORT_SIZES = [1200, 1600, 2000] as const;
type ExportType = "image/png" | "image/jpeg";
type SceneState = { placement: MockupPlacement; color: string; ink: number };

/** Decode to RGBA, bounded: the print area never needs more than ~2k pixels of artwork. */
async function decodeArt(blob: Blob): Promise<RasterImage> {
  const bitmap = await createImageBitmap(blob);
  try {
    const scale = Math.min(1, MAX_ART / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale)), height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, width, height);
    const image = ctx.getImageData(0, 0, width, height);
    return { width, height, data: image.data };
  } finally { bitmap.close(); }
}

function toBlob(result: MockupRenderResult, type: ExportType, quality = 0.92): Promise<Blob> {
  const canvas = document.createElement("canvas"); canvas.width = result.width; canvas.height = result.height;
  const ctx = canvas.getContext("2d")!;
  ctx.putImageData(new ImageData(new Uint8ClampedArray(result.data), result.width, result.height), 0, 0);
  return new Promise((resolve, reject) => canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error("Could not encode the mockup"))), type, quality));
}

function paint(canvas: HTMLCanvasElement | null, result: MockupRenderResult) {
  if (!canvas) throw new Error("Mockup preview is unavailable. Retry the preview.");
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Mockup preview could not start. Retry the preview.");
  canvas.width = result.width; canvas.height = result.height;
  context.putImageData(new ImageData(new Uint8ClampedArray(result.data), result.width, result.height), 0, 0);
}

function Slider({ label, value, min, max, step = 1, format, onChange }: { label: string; value: number; min: number; max: number; step?: number; format: (v: number) => string; onChange: (value: number) => void }) {
  return <label className="ct-slider"><span>{label}</span><input type="range" aria-label={label} min={min} max={max} step={step} value={value} onChange={event => onChange(Number(event.target.value))} /><output>{format(value)}</output></label>;
}

export default function MockupDialog({ projectName, getDocumentArt, onOpenAsDocument, onSave, onClose }: {
  projectName: string;
  getDocumentArt: () => Promise<Blob>;
  onOpenAsDocument: (file: File) => Promise<void> | void;
  onSave: (blob: Blob, fileName: string) => Promise<boolean | void>;
  onClose: () => void;
}) {
  // Created lazily outside render; disposal nulls it so a remount (React
  // strict mode) gets a fresh worker instead of a terminated one.
  const clientRef = useRef<MockupClient | null>(null);
  const client = useCallback(() => (clientRef.current ??= new MockupClient()), []);
  useEffect(() => () => { clientRef.current?.dispose(); clientRef.current = null; }, []);
  const getArtRef = useRef(getDocumentArt);
  const [art, setArt] = useState<RasterImage | null>(null);
  const [sceneId, setSceneId] = useState<MockupSceneId>("tshirt");
  const [states, updateStates] = useState(initialMockupStates);
  const history = useRef<{past: MockupStates[]; future: MockupStates[]}>({past:[],future:[]});
  const [historyRevision, setHistoryRevision] = useState(0);
  const gesture = useRef(false), recordedGesture = useRef(false);
  const stateNow = useRef(states); stateNow.current = states;
  const setStates = (change: (current: MockupStates) => MockupStates) => {
    const current = stateNow.current, next = change(current);
    if (JSON.stringify(current) === JSON.stringify(next)) return;
    if (!gesture.current || !recordedGesture.current) { history.current.past.push(current); if (history.current.past.length > 80) history.current.past.shift(); }
    recordedGesture.current = gesture.current;
    history.current.future = []; stateNow.current = next; updateStates(next); setHistoryRevision(r=>r+1);
  };
  const travel = (redo: boolean) => {
    const from = redo ? history.current.future : history.current.past;
    const next = from.pop(); if (!next) return;
    (redo ? history.current.past : history.current.future).push(stateNow.current);
    stateNow.current = next; updateStates(next); setHistoryRevision(r=>r+1);
  };
  const beginGesture = () => { gesture.current = true; recordedGesture.current = false; };
  const endGesture = () => { gesture.current = false; recordedGesture.current = false; };
  const projectInput = useRef<HTMLInputElement>(null);
  const [artLabel, setArtLabel] = useState("Loading the current document…");
  const [artRevision, setArtRevision] = useState(0);
  const [hasArt, setHasArt] = useState(false);
  const [previewPending, setPreviewPending] = useState(true);
  const artLoad = useRef(0);
  const [quad, setQuad] = useState<Quad | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [exportType, setExportType] = useState<ExportType>("image/png");
  const [exportSize, setExportSize] = useState<number>(1600);
  const [progress, setProgress] = useState<number | null>(null);
  const cancelExport = useRef(false);
  const root = useRef<HTMLElement>(null), preview = useRef<HTMLCanvasElement>(null), fileInput = useRef<HTMLInputElement>(null);
  const thumbs = useRef(new Map<MockupSceneId, HTMLCanvasElement>());
  const state = states[sceneId], info = sceneInfo(sceneId);

  useEffect(() => {
    const canvas = preview.current;
    const restore = () => setArtRevision(r => r + 1);
    canvas?.addEventListener("contextrestored", restore);
    return () => canvas?.removeEventListener("contextrestored", restore);
  }, []);

  const loadArt = useCallback(async (source: () => Promise<Blob>, label: string) => {
    const load = ++artLoad.current;
    setHasArt(false); setPreviewPending(true); setArtRevision(0); setArt(null);
    setError(""); setArtLabel(`Loading ${label}…`);
    try {
      const decoded = await decodeArt(await source());
      if (load !== artLoad.current) return;
      setArt(decoded); setArtLabel(`${label} · ${decoded.width} × ${decoded.height}`);
    } catch (reason) {
      if (load !== artLoad.current) return;
      setPreviewPending(false);
      setError(reason instanceof Error ? reason.message : "Could not read that artwork");
      setArtLabel("No artwork");
    }
  }, []);

  useEffect(() => {
    void loadArt(getArtRef.current, "Current document");
    // This is a request sequence, not a DOM ref; cleanup invalidates late decodes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return () => { artLoad.current++; };
  }, [loadArt]);
  useEffect(() => {
    if (!art) return;
    let cancelled = false;
    client().setArt(art).then(() => { if (!cancelled) { setHasArt(true); setArtRevision(r => r + 1); } }, reason => { if (!cancelled) setError(String(reason)); });
    return () => { cancelled = true; };
  }, [art, client]);

  // Main preview: re-render on any change to the active scene.
  useEffect(() => {
    if (!artRevision) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      setPreviewPending(true);
      void client().render({ scene: sceneId, size: PREVIEW_SIZE, color: state.color, placement: state.placement, inkOpacity: state.ink, cache: true })
        .then(result => { if (!cancelled) { paint(preview.current, result); setQuad(result.quad); setPreviewPending(false); } })
        .catch(reason => { if (!cancelled) { setPreviewPending(false); setError(reason instanceof Error ? reason.message : String(reason)); } });
    }, 16);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [client, sceneId, state, artRevision]);

  const retryPreview = async () => {
    if (!art) return;
    setError(""); setPreviewPending(true); setHasArt(false);
    clientRef.current?.dispose(); clientRef.current = null;
    try {
      await client().setArt(art);
      setHasArt(true); setArtRevision(r => r + 1);
    } catch (reason) { setPreviewPending(false); setError(String(reason)); }
  };

  // Thumbnails: refresh every scene after the art changes, and the active one as it is edited.
  const renderThumb = useCallback((id: MockupSceneId, s: SceneState) => {
    return client().render({ scene: id, size: THUMB_SIZE, color: s.color, placement: s.placement, inkOpacity: s.ink, cache: true })
      .then(result => paint(thumbs.current.get(id) ?? null, result)).catch(() => {});
  }, [client]);
  const statesRef = useRef(states);
  useEffect(() => { statesRef.current = states; }, [states]);
  useEffect(() => {
    if (!artRevision) return;
    let chain = Promise.resolve();
    for (const scene of MOCKUP_SCENES) chain = chain.then(() => renderThumb(scene.id, statesRef.current[scene.id]));
  }, [artRevision, renderThumb]);
  useEffect(() => {
    if (!artRevision) return;
    const timer = setTimeout(() => void renderThumb(sceneId, state), 250);
    return () => clearTimeout(timer);
  }, [sceneId, state, artRevision, renderThumb]);

  const patch = (value: Partial<SceneState>) => setStates(current => ({ ...current, [sceneId]: { ...current[sceneId], ...value } }));
  const place = (value: Partial<MockupPlacement>) => patch({ placement: normalizePlacement({ ...state.placement, ...value }, info.defaultPlacement) });

  // Drag the artwork directly on the product; the wheel scales it.
  const drag = useRef<{ x: number; y: number; start: MockupPlacement } | null>(null);
  const scenePoint = (event: React.PointerEvent<HTMLCanvasElement>): [number, number] => {
    const rect = event.currentTarget.getBoundingClientRect();
    return [(event.clientX - rect.left) / rect.width * PREVIEW_SIZE, (event.clientY - rect.top) / rect.height * PREVIEW_SIZE];
  };

  useEffect(() => {
    const previous = document.activeElement; root.current?.focus();
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);

  const exportOne = async (id: MockupSceneId, s: SceneState) => {
    const result = await client().render({ scene: id, size: exportSize, color: s.color, placement: s.placement, inkOpacity: s.ink, cache: false });
    return toBlob(result, exportType);
  };

  const run = async (label: string, task: () => Promise<void>) => {
    setBusy(label); setError("");
    try { await task(); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(null); setProgress(null); }
  };

  const downloadCurrent = () => run("Rendering…", async () => {
    const blob = await exportOne(sceneId, state);
    await onSave(blob, mockupFileName(projectName, sceneId, exportType));
  });

  const downloadAll = () => run("Rendering all mockups…", async () => {
    cancelExport.current = false;
    const zip = new JSZip();
    for (const [index, scene] of MOCKUP_SCENES.entries()) {
      if (cancelExport.current) throw new Error("Export cancelled");
      setProgress(index / MOCKUP_SCENES.length);
      zip.file(mockupFileName(projectName, scene.id, exportType), await exportOne(scene.id, statesRef.current[scene.id]));
    }
    setProgress(1);
    const blob = await zip.generateAsync({ type: "blob", compression: "STORE" });
    await onSave(blob, `${mockupFileName(projectName, "tshirt", exportType).replace(/-tshirt\.(png|jpg)$/, "")}s.zip`);
  });

  const openAsDocument = () => run("Rendering…", async () => {
    const blob = await exportOne(sceneId, state);
    const name = mockupFileName(projectName, sceneId, exportType);
    await onOpenAsDocument(new File([blob], name, { type: exportType }));
    onClose();
  });

  const saveProject = () => run("Saving project…", async () => {
    if (!art) return;
    const canvas = document.createElement("canvas"); canvas.width=art.width; canvas.height=art.height;
    canvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(art.data), art.width, art.height),0,0);
    await onSave(new Blob([JSON.stringify({format:"luma-mockups",version:1,scene:sceneId,states:stateNow.current,artwork:canvas.toDataURL("image/png")})],{type:"application/json"}), `${projectName.replace(/[^a-z0-9_-]/gi,"-")}.mockups`);
  });
  const openProject = (file: File) => run("Opening project…", async () => {
    if(file.size > 34_000_000) throw new Error("This project exceeds the 34 MB limit.");
    const project = readMockupProject(JSON.parse(await file.text()));
    const decoded = await decodeArt(await (await fetch(project.artwork)).blob());
    artLoad.current++; setArt(decoded); setArtLabel(file.name); setHasArt(false); setPreviewPending(true); setArtRevision(0);
    history.current={past:[],future:[]}; stateNow.current=project.states; updateStates(project.states); setHistoryRevision(r=>r+1); setSceneId(project.scene);
  });
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  return <div className="ct-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <section ref={root} tabIndex={-1} data-history-revision={historyRevision} className="ct-dialog mk-dialog" role="dialog" aria-modal="true" aria-labelledby="mockup-title" onKeyDown={event => {
      event.stopPropagation();
      if (event.key === "Tab") {
        const controls = [...(root.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not([hidden]):not(:disabled),select:not(:disabled),[tabindex="0"]') ?? [])].filter(el=>el.getClientRects().length);
        const first=controls[0], last=controls.at(-1);
        if(event.shiftKey && (document.activeElement===first || document.activeElement===root.current)){event.preventDefault();last?.focus();}
        else if(!event.shiftKey && document.activeElement===last){event.preventDefault();first?.focus();}
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z" && !(event.target instanceof HTMLInputElement) && !busy) { event.preventDefault(); travel(event.shiftKey); }
      if (event.key === "Escape" && !busy) { event.preventDefault(); onClose(); }
    }}>
      <header>
        <div><span className="ct-eyebrow">MOCKUP · ALPHA</span><h2 id="mockup-title">Mockups</h2><p>{artLabel}</p></div>
        <div className="ct-header-actions">
          <button disabled={!!busy || !history.current.past.length} aria-label="Undo mockup change" onClick={()=>travel(false)}><Undo2 size={16}/></button>
          <button disabled={!!busy || !history.current.future.length} aria-label="Redo mockup change" onClick={()=>travel(true)}><Redo2 size={16}/></button>
          <button disabled={!!busy} aria-label="Open Mockups project" onClick={()=>projectInput.current?.click()}><FolderOpen size={16}/></button>
          <button disabled={!!busy || !hasArt} aria-label="Save Mockups project" onClick={()=>void saveProject()}><Save size={16}/></button>
          <input ref={projectInput} hidden type="file" accept=".mockups,application/json" onChange={e=>{const f=e.target.files?.[0];e.target.value="";if(f)void openProject(f);}}/>
          <button disabled={!!busy} onClick={onClose} aria-label="Close Mockups"><X size={18} /></button></div>
      </header>
      <div className="mk-body">
        <aside className="mk-library">          <div className="ct-section">
            <h3>Artwork</h3>
            <div className="ct-row-buttons">
              <button disabled={!!busy} onClick={() => void loadArt(getDocumentArt, "Current document")}><FileImage size={14} /> Current document</button>
              <button disabled={!!busy} onClick={() => fileInput.current?.click()}><Upload size={14} /> Upload image…</button>
            </div>
            <input ref={fileInput} hidden type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={event => {
              const file = event.target.files?.[0]; event.target.value = "";
              if (file) void loadArt(() => Promise.resolve(file), file.name.slice(0, 60));
            }} />
          </div>
<h3 className="mk-library-title">Products</h3>
        <nav className="mk-scenes" aria-label="Mockup scenes">
          {MOCKUP_SCENES.map(scene => <button key={scene.id} disabled={!!busy} aria-pressed={scene.id === sceneId} onClick={() => setSceneId(scene.id)} title={scene.description}>
            <canvas ref={node => { if (node) thumbs.current.set(scene.id, node); else thumbs.current.delete(scene.id); }} width={THUMB_SIZE} height={THUMB_SIZE} aria-hidden="true" />
            <span>{scene.name}</span>
          </button>)}
        </nav></aside>
        <div className="mk-stage">
          <canvas ref={preview} width={PREVIEW_SIZE} height={PREVIEW_SIZE} aria-label={`${info.name} mockup preview. Drag to move the artwork, scroll to scale.`}
            onPointerDown={event => { if (!quad || busy) return; beginGesture(); event.currentTarget.setPointerCapture(event.pointerId); const [x, y] = scenePoint(event); drag.current = { x, y, start: state.placement }; }}
            onPointerMove={event => {
              if (!drag.current || !quad) return;
              const [x, y] = scenePoint(event), [du, dv] = sceneDeltaToOffset({ quad }, [drag.current.x, drag.current.y], [x, y]);
              place({ offsetX: drag.current.start.offsetX + du, offsetY: drag.current.start.offsetY + dv });
            }}
            onPointerUp={() => { drag.current = null; endGesture(); }} onPointerCancel={() => { drag.current = null; endGesture(); }}
            onWheel={event => { if (!hasArt || busy) return; place({ scale: state.placement.scale * (event.deltaY < 0 ? 1.05 : 1 / 1.05) }); }} />
          {previewPending && !error && <p className="mk-stage-note" role="status">{hasArt ? "Rendering preview…" : "Preparing artwork…"}</p>}
        </div>
        <fieldset className="ct-controls" disabled={!!busy} onPointerDownCapture={beginGesture} onPointerUpCapture={endGesture} onPointerCancelCapture={endGesture}>
          <div className="ct-section">
            <h3>Placement · {info.name}</h3>
            <div className="ct-segmented" role="group" aria-label="Fit">
              {(["contain", "cover"] as const).map(fit => <button key={fit} aria-pressed={state.placement.fit === fit} onClick={() => place({ fit })}>{fit === "contain" ? "Fit inside" : "Fill area"}</button>)}
            </div>
            <Slider label="Scale" value={Math.round(state.placement.scale * 100)} min={10} max={300} format={v => `${v}%`} onChange={v => place({ scale: v / 100 })} />
            <Slider label="Rotation" value={Math.round(state.placement.rotation)} min={-180} max={180} format={v => `${v}°`} onChange={v => place({ rotation: v })} />
            <Slider label="Horizontal" value={Math.round(state.placement.offsetX * 100)} min={-100} max={100} format={v => `${v}`} onChange={v => place({ offsetX: v / 100 })} />
            <Slider label="Vertical" value={Math.round(state.placement.offsetY * 100)} min={-100} max={100} format={v => `${v}`} onChange={v => place({ offsetY: v / 100 })} />
            <div className="ct-row-buttons">
              <button onClick={() => patch({ placement: { ...info.defaultPlacement } })}><RotateCcw size={13} /> Reset</button>
              <button onClick={() => setStates(current => Object.fromEntries(MOCKUP_SCENES.map(scene => [scene.id, { ...current[scene.id], placement: { ...current[sceneId].placement, fit: current[scene.id].placement.fit } }])) as typeof current)} title="Copy scale, rotation and offset to every scene">Apply to all</button>
            </div>
          </div>
          <div className="ct-section">
            <h3>{sceneId === "poster" ? "Wall" : sceneId === "phone" ? "Backdrop" : sceneId === "vinyl" ? "Record label" : "Product"} colour</h3>
            <div className="ct-swatches">
              {info.swatches.map(color => <button key={color} aria-label={`Colour ${color}`} aria-pressed={state.color === color} style={{ background: color }} onClick={() => patch({ color })} />)}
              <input type="color" aria-label="Custom colour" value={state.color} onChange={event => patch({ color: event.target.value })} />
            </div>
            {["tshirt", "hoodie", "tote"].includes(sceneId) && <Slider label="Ink density" value={Math.round(state.ink * 100)} min={50} max={100} format={v => `${v}%`} onChange={v => patch({ ink: v / 100 })} />}
          </div>
          <div className="ct-section">
            <h3>Export</h3>
            <label className="ct-row">Format<select value={exportType} onChange={event => setExportType(event.target.value as ExportType)}><option value="image/png">PNG</option><option value="image/jpeg">JPEG</option></select></label>
            <label className="ct-row">Size<select value={exportSize} onChange={event => setExportSize(Number(event.target.value))}>{EXPORT_SIZES.map(size => <option key={size} value={size}>{size} × {size}</option>)}</select></label>
          </div>
          <p className="ct-note">Alpha. Scenes are drawn procedurally by Luma (no photos or third-party templates). Folds, weave and glare are stylised approximations, not photographic renders.</p>
        </fieldset>
      </div>
      {progress !== null && <div className="ct-progress" role="status"><progress aria-label="Export progress" value={Math.round(progress * 100)} max={100} /><span>{pct(progress)}</span><button onClick={() => { cancelExport.current = true; }}>Cancel</button></div>}
      {error && <div className="ct-error" role="alert">{error} {art && <button disabled={!!busy} onClick={() => void retryPreview()}><RotateCcw size={14} /> Retry preview</button>}</div>}
      <footer>
        <span className="ct-footer-status" aria-live="polite">{busy ?? ""}</span>
        <button disabled={!!busy || !hasArt || previewPending} onClick={() => void openAsDocument()}><ImagePlus size={14} /> Open as document</button>
        <button disabled={!!busy || !hasArt || previewPending} onClick={() => void downloadCurrent()}><Download size={14} /> Download {info.name}</button>
        <button className="ct-primary" disabled={!!busy || !hasArt || previewPending} onClick={() => void downloadAll()}><Package size={14} /> Download all (ZIP)</button>
      </footer>
    </section>
  </div>;
}
