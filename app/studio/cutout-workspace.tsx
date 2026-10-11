"use client";
import { useEffect, useRef, useState, type PointerEvent } from "react";
import { ArrowUpRight, Download, Eraser, FolderOpen, ImagePlus, Paintbrush, RotateCcw, Save, Undo2, WandSparkles, X } from "lucide-react";
import { composeCutout, cutoutSize, paintCutoutMask, type CutoutPoint } from "../engine/cutout";
import { CUTOUT_PROJECT_LIMIT, openCutoutProject, saveCutoutProject } from "../engine/cutout-project";
import "./cutout.css";

export default function Cutout({ getDocumentArt, onClose, onOpenAsDocument, onSave }: {
  getDocumentArt?: () => Promise<Blob>; onClose?: () => void;
  onOpenAsDocument?: (file: File) => Promise<void> | void; onSave?: (blob: Blob, name: string) => Promise<boolean | void>;
}) {
  const [name, setName] = useState("cutout"), [ready, setReady] = useState(false), [revision, revise] = useState(0);
  const [mode, setMode] = useState<"erase" | "restore">("erase"), [brush, setBrush] = useState(60), [feather, setFeather] = useState(0);
  const [before, setBefore] = useState(false), [busy, setBusy] = useState(""), [error, setError] = useState("");
  const source = useRef<HTMLCanvasElement | null>(null), mask = useRef<Uint8ClampedArray | null>(null), output = useRef<HTMLCanvasElement | null>(null);
  const history = useRef<Uint8ClampedArray[]>([]), pointer = useRef<CutoutPoint | null>(null), activePointer = useRef<number | null>(null);
  const input = useRef<HTMLInputElement>(null), preview = useRef<HTMLCanvasElement>(null), abort = useRef<AbortController | null>(null), epoch = useRef(0);
  const initialArt = useRef(getDocumentArt), busyRef = useRef(false);
  const projectInput = useRef<HTMLInputElement>(null), dirty = useRef(false);
  function download(blob: Blob, filename: string) { const url = URL.createObjectURL(blob), link = document.createElement("a"); link.href = url; link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 30000); }
  function mayReplace() { return !dirty.current || window.confirm("Replace this Cutout? Download the project first to keep its editable mask."); }
  async function projectFile(file?: File) {
    if (!file || busyRef.current || !mayReplace()) return;
    busyRef.current = true; setBusy("Opening project..."); setError("");
    const id = ++epoch.current;
    try {
      if (file.size > CUTOUT_PROJECT_LIMIT) throw Error("Cutout projects must be smaller than 24 MB.");
      const project = await openCutoutProject(await file.arrayBuffer());
      if (id !== epoch.current) return;
      const canvas = document.createElement("canvas"); canvas.width = project.width; canvas.height = project.height;
      const ctx = canvas.getContext("2d")!, pixels = ctx.createImageData(project.width, project.height); pixels.data.set(project.rgba); ctx.putImageData(pixels, 0, 0);
      source.current = canvas; mask.current = project.mask; history.current = []; dirty.current = false;
      setName(project.name); setFeather(project.feather); setBefore(false); setReady(true); revise(n => n + 1);
    } catch (reason) { if (id === epoch.current) setError(reason instanceof Error ? reason.message : "Could not open this project."); }
    finally { if (id === epoch.current) { busyRef.current = false; setBusy(""); } }
  }
  async function saveProject() {
    if (!source.current || !mask.current || busyRef.current) return;
    busyRef.current = true; setBusy("Preparing project..."); setError("");
    try {
      const canvas = source.current;
      const blob = await saveCutoutProject({name, width:canvas.width, height:canvas.height, feather, rgba:canvas.getContext("2d")!.getImageData(0,0,canvas.width,canvas.height).data, mask:mask.current});
      download(blob, `${name.replace(/[^a-z0-9_-]+/gi,"-").slice(0,80)}.cutout`); dirty.current = false;
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Project export failed."); }
    finally { busyRef.current = false; setBusy(""); }
  }
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty.current) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
  }, []);
  function checkpoint() { if (mask.current) { dirty.current = true; history.current = [...history.current.slice(-7), mask.current.slice()]; } }
  async function load(blob: Blob, title: string) {
    if (busyRef.current || !mayReplace()) return; const id = ++epoch.current; busyRef.current = true; setBusy("Opening image..."); setError("");
    try {
      if (blob.size > 30 * 1024 * 1024) throw Error("Choose an image smaller than 30 MB.");
      const image = await createImageBitmap(blob);
      try {
        if (id !== epoch.current) return;
        const size = cutoutSize(image.width, image.height), canvas = document.createElement("canvas"); Object.assign(canvas, size);
        canvas.getContext("2d")!.drawImage(image, 0, 0, size.width, size.height); source.current = canvas;
        mask.current = new Uint8ClampedArray(size.width * size.height).fill(255); history.current = []; setName(title.replace(/\.[^.]+$/, "") || "cutout");
        dirty.current = false; setReady(true); setBefore(false); setFeather(0); revise(n => n + 1);
      } finally { image.close(); }
    } catch (reason) { if (id === epoch.current) setError(reason instanceof Error ? reason.message : "Could not open this image."); }
    finally { if (id === epoch.current) { busyRef.current = false; setBusy(""); } }
  }
  useEffect(() => {
    let alive = true;
    if (initialArt.current) void initialArt.current().then(blob => { if (alive) void load(blob, "Current document"); }).catch(reason => { if (alive) setError(String(reason)); });
    return () => { alive = false; epoch.current++; abort.current?.abort(); busyRef.current = false; };
    // The initial document is captured once; later imports are explicit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!source.current || !mask.current || !preview.current) return;
    const canvas = before ? source.current : composeCutout(source.current, mask.current, feather); output.current = canvas;
    preview.current.width = canvas.width; preview.current.height = canvas.height; preview.current.getContext("2d")!.drawImage(canvas, 0, 0);
  }, [revision, before, feather, ready]);
  async function automatic() {
    if (!source.current || busyRef.current) return;
    const controller = new AbortController(), id = epoch.current; abort.current = controller; busyRef.current = true; setBusy("Loading local model..."); setError("");
    try {
      const { neuralMatte } = await import("../engine/neural");
      const matte = await neuralMatte(source.current, (message, pct) => { if (!controller.signal.aborted && id === epoch.current) setBusy(`${message}${pct ? ` ${Math.round(pct)}%` : ""}`); }, controller.signal);
      if (id !== epoch.current || controller.signal.aborted) return;
      const data = matte.getContext("2d")!.getImageData(0, 0, matte.width, matte.height).data; checkpoint();
      mask.current = Uint8ClampedArray.from({ length: matte.width * matte.height }, (_, i) => data[i * 4 + 3]); dirty.current = true; setBefore(false); revise(n => n + 1);
    } catch (reason) { if (id === epoch.current) setError(controller.signal.aborted ? "Cancelled. Your previous mask is unchanged." : reason instanceof Error ? reason.message : "Matting failed. Manual refinement is still available."); }
    finally { if (id === epoch.current) { abort.current = null; busyRef.current = false; setBusy(""); } }
  }
  function paint(e: PointerEvent<HTMLCanvasElement>, first: boolean) {
    if (busyRef.current || before || !source.current || !mask.current || (!first && activePointer.current !== e.pointerId)) return;
    if (first && activePointer.current !== null) return;
    const rect = e.currentTarget.getBoundingClientRect(), point = { x: (e.clientX - rect.left) / rect.width * source.current.width, y: (e.clientY - rect.top) / rect.height * source.current.height };
    if (first) { checkpoint(); activePointer.current = e.pointerId; e.currentTarget.setPointerCapture(e.pointerId); pointer.current = point; }
    if (!pointer.current) return;
    paintCutoutMask(mask.current, source.current.width, source.current.height, pointer.current, point, brush / 2, mode === "restore"); pointer.current = point; dirty.current = true; revise(n => n + 1);
  }
  async function save(open = false) {
    if (!source.current || !mask.current || busyRef.current) return;
    busyRef.current = true; setBusy("Preparing PNG..."); setError("");
    try {
      const canvas = composeCutout(source.current, mask.current, feather);
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(Error("PNG export failed.")), "image/png"));
      const filename = `${name.replace(/[^a-z0-9_-]+/gi, "-").slice(0, 80)}-cutout.png`;
      if (open && onOpenAsDocument) { await onOpenAsDocument(new File([blob], filename, { type: "image/png" })); onClose?.(); }
      else if (onSave) await onSave(blob, filename);
      else { const url = URL.createObjectURL(blob), link = document.createElement("a"); link.href = url; link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 30000); }
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Export failed."); }
    finally { busyRef.current = false; setBusy(""); }
  }
  return <section className={`cutout-app${onClose ? " cutout-modal" : ""}`} role={onClose ? "dialog" : undefined} aria-modal={onClose ? true : undefined} aria-label="Cutout">
    <header><a href="/studio">Luma</a><h1>Cutout</h1><span className="cutout-alpha">ALPHA</span><div className="cutout-actions"><button onClick={() => input.current?.click()} disabled={!!busy}><ImagePlus size={18} />Open image</button><button disabled={!ready || !!busy} onClick={() => void save()}><Download size={18} />PNG</button>{onClose ? <button title="Close Cutout" aria-label="Close Cutout" disabled={!!busy} onClick={() => { if (mayReplace()) onClose(); }}><X size={18} /></button> : <a href="/studio" title="Open Luma Studio"><ArrowUpRight size={20} /></a>}</div></header>
    <input ref={input} hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={e => { const file = e.target.files?.[0]; e.target.value = ""; if (file) void load(file, file.name); }} />
    <input ref={projectInput} hidden aria-label="Open Cutout project" type="file" accept=".cutout" onChange={e => { const file=e.target.files?.[0]; e.target.value=""; void projectFile(file); }} />
    <div className="cutout-layout"><main className="cutout-stage" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); const file = e.dataTransfer.files[0]; if (file) void load(file, file.name); }}>
      {!ready && <button className="cutout-empty" onClick={() => input.current?.click()} disabled={!!busy}><ImagePlus size={40} /><span>Open image</span></button>}
      <canvas ref={preview} hidden={!ready} aria-label="Cutout mask editor" onPointerDown={e => paint(e, true)} onPointerMove={e => paint(e, false)} onPointerUp={() => { pointer.current = null; activePointer.current = null; }} onPointerCancel={() => { pointer.current = null; activePointer.current = null; }} />
    </main><aside><button className="cutout-primary" disabled={!ready || !!busy} onClick={() => void automatic()} title="Downloads MODNet on first use. Processing stays on this device. Best for foreground subjects; review edges."><WandSparkles size={18} />Remove background</button>
      <fieldset disabled={!ready || !!busy}><legend>Refine mask</legend><div className="cutout-modes" role="group" aria-label="Mask brush"><button title="Erase from mask" aria-label="Erase" aria-pressed={mode === "erase"} onClick={() => { setMode("erase"); setBefore(false); }}><Eraser size={20} /></button><button title="Restore to mask" aria-label="Restore" aria-pressed={mode === "restore"} onClick={() => { setMode("restore"); setBefore(false); }}><Paintbrush size={20} /></button><button title="Undo mask edit" aria-label="Undo mask edit" disabled={!history.current.length} onClick={() => { mask.current = history.current.pop()!; dirty.current = true; revise(n => n + 1); }}><Undo2 size={20} /></button><button title="Reset mask" aria-label="Reset mask" onClick={() => { checkpoint(); mask.current!.fill(255); revise(n => n + 1); }}><RotateCcw size={20} /></button></div>
      <label>Brush size <output>{brush}px</output><input aria-label="Brush size" type="range" min="4" max="240" value={brush} onChange={e => setBrush(+e.target.value)} /></label><label>Feather <output>{feather}px</output><input aria-label="Feather" type="range" min="0" max="8" step=".5" value={feather} onChange={e => { dirty.current = true; setFeather(+e.target.value); }} /></label><label className="cutout-check"><input type="checkbox" checked={before} onChange={e => setBefore(e.target.checked)} />Original</label></fieldset>
      {ready && <output className="cutout-meta">{name} · {source.current?.width} × {source.current?.height}</output>}
      <div className="cutout-project-actions"><button title="Download editable Cutout project" disabled={!ready || !!busy} onClick={() => void saveProject()}><Save size={18} />Save project</button><button title="Open editable Cutout project" disabled={!!busy} onClick={() => projectInput.current?.click()}><FolderOpen size={18} />Open project</button></div>
      {onOpenAsDocument && <button disabled={!ready || !!busy} onClick={() => void save(true)}><ArrowUpRight size={18} />Open result in Luma</button>}
      {busy && <div role="status">{busy}{abort.current && <button onClick={() => { abort.current?.abort(); setBusy("Cancelling after the current model operation..."); }}>Cancel</button>}</div>}{error && <p role="alert">{error}</p>}
    </aside></div>
  </section>;
}
