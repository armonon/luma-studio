"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Brush, Download, Eraser, FolderOpen, PenTool, Redo2, Save, Trash2, Type, Undo2, Wand2, X } from "lucide-react";
import {
  autoAdvance, buildOtf, buildTtf, createGlyphProject, drawnGlyphs, fontFileName, glyphContours, layoutText, validateFamilyName,
  validateGlyphProject, GLYPH_CHARSET, GLYPH_GROUPS, GLYPH_LIMITS, type Contour, type GlyphDraft, type GlyphProject, type GlyphStroke, type Vec,
} from "../engine/glyph-font";
import { installUserFont, listUserFonts, removeUserFont, type UserFontEntry } from "../engine/user-fonts";
import { notifyTextFontsChanged } from "../engine/text-font-resources";
import { BUNDLED_FONTS } from "../engine/bundled-fonts";
import "./creative-tools.css";

const STORAGE_KEY = "luma.glyph.project.v1";
const EDITOR = 560;
const HISTORY_LIMIT = 80;
type Tool = "brush" | "pen" | "erase";

function loadStoredProject(): GlyphProject {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return validateGlyphProject(JSON.parse(raw));
  } catch { /* a damaged draft must not block the editor; start fresh */ }
  return createGlyphProject();
}

const emptyDraft = (project: GlyphProject): GlyphDraft => ({ advanceWidth: project.metrics.defaultAdvance, strokes: [] });

function fillContours(ctx: CanvasRenderingContext2D, contours: readonly Contour[], map: (p: Vec) => [number, number]) {
  ctx.beginPath();
  for (const contour of contours) {
    contour.forEach((point, i) => { const [x, y] = map(point); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
    ctx.closePath();
  }
  ctx.fill("nonzero");
}

function setupCanvas(canvas: HTMLCanvasElement, width: number, height: number) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) { canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr); }
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  return ctx;
}

function GlyphThumb({ draft, char, metrics }: { draft?: GlyphDraft; char: string; metrics: GlyphProject["metrics"] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current; if (!canvas) return;
    const ctx = setupCanvas(canvas, 40, 40);
    const contours = draft ? glyphContours(draft) : [];
    if (!contours.length) return;
    const top = metrics.ascender + 60, range = top - (metrics.descender - 60), scale = 40 / range;
    const width = Math.max(draft!.advanceWidth, 1), offset = (40 - width * scale) / 2;
    ctx.fillStyle = "#e9edf5";
    fillContours(ctx, contours, ([x, y]) => [offset + x * scale, (top - y) * scale]);
  }, [draft, metrics]);
  return <><canvas ref={ref} aria-hidden="true" style={{ width: 40, height: 40 }} /><span className={draft?.strokes.length ? "gl-has" : ""}>{char}</span></>;
}

function distanceToSegment(p: Vec, a: Vec, b: Vec) {
  const dx = b[0] - a[0], dy = b[1] - a[1], len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}
function insidePolygon(p: Vec, polygon: readonly Vec[]) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i], [xj, yj] = polygon[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < (xj - xi) * (p[1] - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function hitStroke(stroke: GlyphStroke, p: Vec, tolerance: number) {
  if (stroke.kind === "brush") {
    const r = Math.max(stroke.width, ...(stroke.widths ?? [])) / 2 + tolerance;
    if (stroke.points.length === 1) return Math.hypot(p[0] - stroke.points[0][0], p[1] - stroke.points[0][1]) <= r;
    for (let i = 0; i + 1 < stroke.points.length; i++) if (distanceToSegment(p, stroke.points[i], stroke.points[i + 1]) <= r) return true;
    return false;
  }
  if (insidePolygon(p, stroke.points)) return true;
  return stroke.points.some((point, i) => distanceToSegment(p, point, stroke.points[(i + 1) % stroke.points.length]) <= tolerance);
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob), a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export default function GlyphDialog({ onClose, onAddText, onSave }: {
  onClose: () => void;
  /** Create a text layer set in the installed family (CSS value). */
  onAddText?: (family: string, sample: string) => void;
  onSave?: (blob: Blob, fileName: string) => Promise<boolean | void>;
}) {
  const [project, setProject] = useState<GlyphProject>(loadStoredProject);
  const [char, setChar] = useState("A");
  const [tool, setTool] = useState<Tool>("brush");
  const [brushWidth, setBrushWidth] = useState(70);
  const [smooth, setSmooth] = useState(true);
  const [cut, setCut] = useState(false);
  const [penPoints, setPenPoints] = useState<Vec[]>([]);
  // The in-progress stroke accumulates in a ref: pointer events arrive faster
  // than React renders, and appending to a state snapshot drops points.
  const liveRef = useRef<{ points: Vec[]; widths: number[] } | null>(null);
  const [liveVersion, setLiveVersion] = useState(0);
  const [reference, setReference] = useState(true);
  const [previewText, setPreviewText] = useState("Hamburgefonstiv 0123 — Sphinx of black quartz, judge my vow!");
  const [previewSize, setPreviewSize] = useState(56);
  const [status, setStatus] = useState("");
  const [nameDraft, setNameDraft] = useState(project.familyName);
  const [installed, setInstalled] = useState<UserFontEntry[]>(listUserFonts);
  const [busy, setBusy] = useState(false);
  // History lives in refs (written only from event handlers); the counts
  // mirror into state so render never reads a ref.
  const undo = useRef<GlyphProject[]>([]), redo = useRef<GlyphProject[]>([]);
  const projectRef = useRef(project);
  const [historyCounts, setHistoryCounts] = useState({ undo: 0, redo: 0 });
  const editor = useRef<HTMLCanvasElement>(null), previewCanvas = useRef<HTMLCanvasElement>(null), root = useRef<HTMLElement>(null), openInput = useRef<HTMLInputElement>(null);
  const dragAdvance = useRef(false);
  const draft = project.glyphs[char] ?? emptyDraft(project);
  const m = project.metrics;

  // View transform for the editor (font units, y up → canvas px, y down).
  const view = useMemo(() => {
    const top = Math.max(m.ascender, m.capHeight) + 120, bottom = m.descender - 120, scale = EDITOR / (top - bottom), left = -150;
    return {
      scale,
      toCanvas: ([x, y]: Vec): [number, number] => [(x - left) * scale, (top - y) * scale],
      toFont: (cx: number, cy: number): Vec => [Math.round((cx / scale + left) * 10) / 10, Math.round((top - cy / scale) * 10) / 10],
    };
  }, [m.ascender, m.capHeight, m.descender]);

  // Autosave the drawing (debounced); localStorage quota errors are surfaced, not swallowed.
  useEffect(() => {
    const timer = setTimeout(() => {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(project)); }
      catch { setStatus("Autosave failed (browser storage is full). Use Save project to keep your work."); }
    }, 400);
    return () => clearTimeout(timer);
  }, [project]);

  const apply = useCallback((next: GlyphProject, record: boolean) => {
    if (record) { undo.current = [...undo.current.slice(-(HISTORY_LIMIT - 1)), projectRef.current]; redo.current = []; }
    projectRef.current = next;
    setProject(next);
    setHistoryCounts({ undo: undo.current.length, redo: redo.current.length });
  }, []);
  const commit = useCallback((change: (current: GlyphProject) => GlyphProject) => {
    const next = change(projectRef.current);
    if (next !== projectRef.current) apply(next, true);
  }, [apply]);
  const updateGlyph = useCallback((target: string, change: (draft: GlyphDraft) => GlyphDraft) => commit(current => {
    const before = current.glyphs[target] ?? emptyDraft(current);
    return { ...current, glyphs: { ...current.glyphs, [target]: change(before) } };
  }), [commit]);
  const stepHistory = (from: React.RefObject<GlyphProject[]>, to: React.RefObject<GlyphProject[]>) => {
    const previous = from.current.at(-1); if (!previous) return;
    from.current = from.current.slice(0, -1);
    to.current = [...to.current, projectRef.current];
    apply(previous, false);
    setNameDraft(previous.familyName); setPenPoints([]);
  };

  const addStroke = (stroke: GlyphStroke) => {
    if (draft.strokes.length >= GLYPH_LIMITS.strokesPerGlyph) { setStatus(`A glyph can hold ${GLYPH_LIMITS.strokesPerGlyph} strokes; erase some first`); return; }
    updateGlyph(char, d => ({ ...d, strokes: [...d.strokes, stroke] }));
  };
  const closePen = () => {
    if (penPoints.length >= 3) addStroke({ kind: "shape", points: penPoints, smooth, cut });
    setPenPoints([]);
  };

  // ---- editor rendering ---------------------------------------------------
  useEffect(() => {
    const canvas = editor.current; if (!canvas) return;
    const ctx = setupCanvas(canvas, EDITOR, EDITOR);
    const X = (x: number) => view.toCanvas([x, 0])[0], Y = (y: number) => view.toCanvas([0, y])[1];
    ctx.fillStyle = "#11141a"; ctx.fillRect(0, 0, EDITOR, EDITOR);
    // Advance box.
    ctx.fillStyle = "#171b23"; ctx.fillRect(X(0), Y(m.ascender), X(draft.advanceWidth) - X(0), Y(m.descender) - Y(m.ascender));
    if (reference && /\S/.test(char)) {
      ctx.save();
      ctx.fillStyle = "rgba(160, 180, 220, 0.10)";
      ctx.font = `${(m.capHeight * view.scale) / 0.7}px Georgia, "Times New Roman", serif`;
      ctx.textBaseline = "alphabetic";
      ctx.fillText(char, X(40), Y(0));
      ctx.restore();
    }
    const guide = (y: number, label: string, color: string) => {
      ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, Math.round(Y(y)) + 0.5); ctx.lineTo(EDITOR, Math.round(Y(y)) + 0.5); ctx.stroke();
      ctx.fillStyle = color; ctx.font = "10px system-ui, sans-serif"; ctx.fillText(`${label} ${y}`, 6, Y(y) - 4);
    };
    guide(m.ascender, "Ascender", "#5b6b8a"); guide(m.capHeight, "Cap height", "#6f86b5"); guide(m.xHeight, "x-height", "#6f86b5");
    guide(0, "Baseline", "#9cb3e6"); guide(m.descender, "Descender", "#5b6b8a");
    ctx.strokeStyle = "#9cb3e6"; ctx.setLineDash([4, 4]);
    for (const x of [0, draft.advanceWidth]) { ctx.beginPath(); ctx.moveTo(Math.round(X(x)) + 0.5, 0); ctx.lineTo(Math.round(X(x)) + 0.5, EDITOR); ctx.stroke(); }
    ctx.setLineDash([]);
    ctx.fillStyle = "#9cb3e6"; ctx.font = "10px system-ui, sans-serif"; ctx.fillText(`Advance ${draft.advanceWidth}`, X(draft.advanceWidth) + 4, 14);
    // Compiled outline: what the font file will contain.
    ctx.fillStyle = "#f1f4fa";
    fillContours(ctx, glyphContours(draft), view.toCanvas);
    if (tool === "erase") {
      ctx.strokeStyle = "rgba(255, 120, 100, 0.55)"; ctx.lineWidth = 1;
      for (const stroke of draft.strokes) {
        ctx.beginPath();
        stroke.points.forEach((p, i) => { const [x, y] = view.toCanvas(p); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
        if (stroke.kind === "shape") ctx.closePath();
        ctx.stroke();
      }
    }
    const live = liveRef.current;
    if (live && live.points.length) {
      ctx.strokeStyle = "#f1f4fa"; ctx.lineCap = "round"; ctx.lineJoin = "round";
      for (let i = 0; i < live.points.length; i++) {
        const a = view.toCanvas(live.points[Math.max(0, i - 1)]), b = view.toCanvas(live.points[i]);
        ctx.lineWidth = live.widths[i] * view.scale; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
      }
    }
    if (penPoints.length) {
      ctx.strokeStyle = cut ? "#ff8f7a" : "#8cb6ff"; ctx.fillStyle = cut ? "rgba(255,143,122,0.2)" : "rgba(140,182,255,0.2)"; ctx.lineWidth = 1.5;
      ctx.beginPath(); penPoints.forEach((p, i) => { const [x, y] = view.toCanvas(p); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }); ctx.stroke();
      if (penPoints.length > 2) { ctx.closePath(); ctx.fill(); }
      for (const p of penPoints) { const [x, y] = view.toCanvas(p); ctx.fillStyle = "#fff"; ctx.fillRect(x - 3, y - 3, 6, 6); }
    }
  }, [draft, view, m, reference, char, tool, liveVersion, penPoints, cut]);

  // ---- live preview -------------------------------------------------------
  useEffect(() => {
    const canvas = previewCanvas.current; if (!canvas) return;
    const width = canvas.clientWidth || 600, lines = previewText.split("\n").slice(0, 4);
    const lineHeight = previewSize * 1.25, height = Math.max(lineHeight * lines.length + 16, 60);
    canvas.style.height = `${height}px`;
    const ctx = setupCanvas(canvas, width, height);
    const scale = previewSize / m.unitsPerEm;
    lines.forEach((line, row) => {
      const baseline = 8 + row * lineHeight + m.ascender * scale;
      const layout = layoutText(project, line);
      for (const glyph of layout.glyphs) {
        const x0 = 12 + glyph.x * scale;
        if (x0 > width) break;
        if (glyph.missing) {
          ctx.fillStyle = "rgba(160, 175, 200, 0.35)";
          ctx.font = `${previewSize * 0.7}px system-ui, sans-serif`;
          ctx.fillText(glyph.char, x0, baseline);
          continue;
        }
        ctx.fillStyle = "#f1f4fa";
        fillContours(ctx, glyph.contours, ([x, y]) => [x0 + x * scale, baseline - y * scale]);
      }
    });
  }, [project, previewText, previewSize, m]);

  useEffect(() => {
    const previous = document.activeElement; root.current?.focus();
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);

  // ---- pointer handling ---------------------------------------------------
  const fontPoint = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return view.toFont((event.clientX - rect.left) / rect.width * EDITOR, (event.clientY - rect.top) / rect.height * EDITOR);
  };
  const nearAdvance = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return Math.abs((event.clientX - rect.left) / rect.width * EDITOR - view.toCanvas([draft.advanceWidth, 0])[0]) < 6;
  };
  const widthFor = (event: React.PointerEvent) => event.pointerType === "pen" && event.pressure > 0 ? Math.max(GLYPH_LIMITS.brushWidth[0], brushWidth * (0.25 + 0.75 * event.pressure)) : brushWidth;

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (busy) return;
    const p = fontPoint(event);
    if (tool !== "pen" && nearAdvance(event)) {
      // One undo step for the whole drag: snapshot now, update silently while moving.
      dragAdvance.current = true; apply(projectRef.current, true);
      event.currentTarget.setPointerCapture(event.pointerId); return;
    }
    if (tool === "brush") { event.currentTarget.setPointerCapture(event.pointerId); liveRef.current = { points: [p], widths: [widthFor(event)] }; setLiveVersion(v => v + 1); return; }
    if (tool === "erase") {
      const tolerance = 6 / view.scale;
      const index = draft.strokes.findLastIndex(stroke => hitStroke(stroke, p, tolerance));
      if (index >= 0) updateGlyph(char, d => ({ ...d, strokes: d.strokes.filter((_, i) => i !== index) }));
      return;
    }
    // Pen: click to add points, click the first point (or Enter / double-click) to close.
    if (penPoints.length >= 3) {
      const [fx, fy] = view.toCanvas(penPoints[0]), [cx, cy] = view.toCanvas(p);
      if (Math.hypot(fx - cx, fy - cy) < 9) { closePen(); return; }
    }
    if (penPoints.length < GLYPH_LIMITS.pointsPerStroke) setPenPoints(points => [...points, p]);
  };
  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (dragAdvance.current) {
      const [x] = fontPoint(event), current = projectRef.current;
      apply({ ...current, glyphs: { ...current.glyphs, [char]: { ...(current.glyphs[char] ?? emptyDraft(current)), advanceWidth: Math.max(0, Math.min(GLYPH_LIMITS.advance[1], Math.round(x))) } } }, false);
      return;
    }
    event.currentTarget.style.cursor = tool !== "pen" && nearAdvance(event) ? "ew-resize" : tool === "erase" ? "not-allowed" : "crosshair";
    const live = liveRef.current;
    if (!live) return;
    const p = fontPoint(event), last = live.points[live.points.length - 1];
    if (Math.hypot(p[0] - last[0], p[1] - last[1]) < 4 / view.scale || live.points.length >= GLYPH_LIMITS.pointsPerStroke) return;
    live.points.push(p); live.widths.push(widthFor(event));
    setLiveVersion(v => v + 1);
  };
  const onPointerUp = () => {
    if (dragAdvance.current) { dragAdvance.current = false; return; }
    const live = liveRef.current;
    if (!live) return;
    liveRef.current = null;
    const pressure = live.widths.some(w => Math.abs(w - live.widths[0]) > 0.5);
    addStroke({ kind: "brush", points: live.points, width: brushWidth, ...(pressure ? { widths: live.widths } : {}) });
    setLiveVersion(v => v + 1);
  };

  // ---- file actions -------------------------------------------------------
  const takenNames = BUNDLED_FONTS.map(font => font.family);
  const applyName = () => {
    try { const familyName = validateFamilyName(nameDraft, takenNames); commit(current => ({ ...current, familyName })); setNameDraft(familyName); setStatus(""); return familyName; }
    catch (error) { setStatus(error instanceof Error ? error.message : String(error)); return null; }
  };
  const save = (blob: Blob, name: string) => (onSave ? onSave(blob, name) : (download(blob, name), Promise.resolve(true)));
  const exportFont = async (format: "otf" | "ttf") => {
    if (!applyName()) return;
    try {
      const bytes = format === "otf" ? buildOtf(project) : buildTtf(project);
      await save(new Blob([bytes], { type: format === "otf" ? "font/otf" : "font/ttf" }), fontFileName(project, format));
      setStatus(`${format.toUpperCase()} exported · ${drawnGlyphs(project).length} glyphs`);
    } catch (error) { setStatus(error instanceof Error ? error.message : String(error)); }
  };
  const install = async () => {
    const familyName = applyName(); if (!familyName) return null;
    setBusy(true);
    try {
      const named = { ...project, familyName };
      await installUserFont(familyName, buildTtf(named), JSON.stringify(named));
      notifyTextFontsChanged();
      setInstalled(listUserFonts());
      setStatus(`“${familyName}” is installed in Luma. Pick it in Type & Vector → Typeface (under “Yours · Glyph”).`);
      return familyName;
    } catch (error) { setStatus(error instanceof Error ? error.message : String(error)); return null; }
    finally { setBusy(false); }
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    event.stopPropagation(); // keep studio shortcuts out of the editor
    const typing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement;
    if (event.key === "Escape") { event.preventDefault(); if (penPoints.length) setPenPoints([]); else if (!busy) onClose(); return; }
    if (typing) return;
    const mod = event.metaKey || event.ctrlKey;
    if (mod && event.key.toLowerCase() === "z") { event.preventDefault(); if (event.shiftKey) stepHistory(redo, undo); else stepHistory(undo, redo); return; }
    if (mod) return;
    if (event.key === "Enter" && tool === "pen") { event.preventDefault(); closePen(); return; }
    if (event.key === "Backspace" && tool === "pen" && penPoints.length) { event.preventDefault(); setPenPoints(points => points.slice(0, -1)); return; }
    if (event.key === "b") setTool("brush"); else if (event.key === "p") setTool("pen"); else if (event.key === "e") setTool("erase");
    else if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      const i = GLYPH_CHARSET.indexOf(char), next = GLYPH_CHARSET[(i + (event.key === "ArrowRight" ? 1 : -1) + GLYPH_CHARSET.length) % GLYPH_CHARSET.length];
      setChar(next); setPenPoints([]);
    }
  };

  const drawn = drawnGlyphs(project).length;
  const metric = (key: keyof GlyphProject["metrics"], label: string, min: number, max: number) => (
    <label className="ct-row"><span>{label}</span><input type="number" min={min} max={max} value={m[key]} onChange={event => {
      const value = Math.round(Number(event.target.value));
      if (Number.isFinite(value) && value >= min && value <= max) commit(current => ({ ...current, metrics: { ...current.metrics, [key]: value } }));
    }} /></label>
  );

  return <div className="ct-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <section ref={root} tabIndex={-1} className="ct-dialog gl-dialog" role="dialog" aria-modal="true" aria-labelledby="glyph-title" onKeyDown={onKeyDown}>
      <header>
        <div><span className="ct-eyebrow">GLYPH · ALPHA</span><h2 id="glyph-title">Glyph font maker</h2><p>{project.familyName} · {drawn} of {GLYPH_CHARSET.length} glyphs drawn · autosaved in this browser</p></div>
        <div className="ct-header-actions">
          <button disabled={!historyCounts.undo} onClick={() => stepHistory(undo, redo)} aria-label="Undo" title="Undo (⌘Z)"><Undo2 size={16} /></button>
          <button disabled={!historyCounts.redo} onClick={() => stepHistory(redo, undo)} aria-label="Redo" title="Redo (⇧⌘Z)"><Redo2 size={16} /></button>
          <button disabled={busy} onClick={onClose} aria-label="Close Glyph"><X size={18} /></button>
        </div>
      </header>
      <div className="gl-body">
        <nav className="gl-grid" aria-label="Glyphs">
          {GLYPH_GROUPS.map(group => <section key={group.label}><h3>{group.label}</h3><div>
            {group.chars.map(c => <button key={c} aria-pressed={c === char} aria-label={`Glyph ${c}${project.glyphs[c]?.strokes.length ? " (drawn)" : ""}`} onClick={() => { setChar(c); setPenPoints([]); }}>
              <GlyphThumb draft={project.glyphs[c]} char={c} metrics={m} />
            </button>)}
          </div></section>)}
        </nav>
        <div className="gl-center">
          <div className="gl-toolbar" role="toolbar" aria-label="Drawing tools">
            <div className="ct-segmented">
              <button aria-pressed={tool === "brush"} onClick={() => setTool("brush")} title="Brush (B): freehand strokes become outlines; pen pressure tapers"><Brush size={14} /> Brush</button>
              <button aria-pressed={tool === "pen"} onClick={() => setTool("pen")} title="Pen (P): click points, click the first point or press Enter to close"><PenTool size={14} /> Pen shape</button>
              <button aria-pressed={tool === "erase"} onClick={() => { setTool("erase"); setPenPoints([]); }} title="Erase (E): click a stroke to remove it"><Eraser size={14} /> Erase</button>
            </div>
            {tool === "brush" && <label className="ct-slider gl-inline"><span>Width</span><input type="range" aria-label="Brush width" min={GLYPH_LIMITS.brushWidth[0]} max={240} value={brushWidth} onChange={event => setBrushWidth(Number(event.target.value))} /><output>{brushWidth}</output></label>}
            {tool === "pen" && <>
              <label className="ct-check"><input type="checkbox" checked={smooth} onChange={event => setSmooth(event.target.checked)} /> Smooth curve</label>
              <label className="ct-check"><input type="checkbox" checked={cut} onChange={event => setCut(event.target.checked)} /> Cut (make a hole)</label>
              <button disabled={penPoints.length < 3} onClick={closePen}>Close shape</button>
            </>}
          </div>
          <div className="gl-editor-wrap">
            <canvas ref={editor} className="gl-editor" style={{ width: EDITOR, height: EDITOR }} aria-label={`Drawing area for “${char}”. Tool: ${tool}.`}
              onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={() => { liveRef.current = null; setLiveVersion(v => v + 1); dragAdvance.current = false; }}
              onDoubleClick={() => { if (tool === "pen") closePen(); }} />
            <div className="gl-glyph-label" aria-live="polite"><strong>{char}</strong><span>U+{char.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}</span></div>
          </div>
          <div className="gl-glyph-actions">
            <label className="ct-row"><span>Advance width</span><input type="number" min={0} max={GLYPH_LIMITS.advance[1]} value={draft.advanceWidth} onChange={event => {
              const value = Math.round(Number(event.target.value));
              if (Number.isFinite(value) && value >= 0 && value <= GLYPH_LIMITS.advance[1]) updateGlyph(char, d => ({ ...d, advanceWidth: value }));
            }} /></label>
            <button disabled={!draft.strokes.length} onClick={() => updateGlyph(char, d => ({ ...d, advanceWidth: autoAdvance(d) }))} title="Fit the advance to the drawing with even side bearings"><Wand2 size={13} /> Auto-fit</button>
            <select aria-label="Copy strokes from another glyph" value="" onChange={event => {
              const source = project.glyphs[event.target.value]; if (!source) return;
              updateGlyph(char, () => structuredClone(source));
            }}><option value="">Copy from…</option>{GLYPH_CHARSET.filter(c => c !== char && project.glyphs[c]?.strokes.length).map(c => <option key={c} value={c}>{c}</option>)}</select>
            <label className="ct-check"><input type="checkbox" checked={reference} onChange={event => setReference(event.target.checked)} /> Reference letter</label>
            <button disabled={!draft.strokes.length} onClick={() => updateGlyph(char, d => ({ ...d, strokes: [] }))}><Trash2 size={13} /> Clear glyph</button>
          </div>
        </div>
        <aside className="ct-controls gl-side">
          <div className="ct-section">
            <h3>Live preview</h3>
            <textarea aria-label="Preview text" rows={2} value={previewText} maxLength={400} onChange={event => setPreviewText(event.target.value)} />
            <label className="ct-slider"><span>Size</span><input type="range" aria-label="Preview size" min={16} max={140} value={previewSize} onChange={event => setPreviewSize(Number(event.target.value))} /><output>{previewSize}</output></label>
            <canvas ref={previewCanvas} className="gl-preview" aria-label="Type preview" />
            <small>Grey letters are not drawn yet; they are left out of the font and fall back to the next typeface.</small>
          </div>
          <div className="ct-section">
            <h3>Font</h3>
            <label className="ct-row"><span>Family name</span><input value={nameDraft} maxLength={GLYPH_LIMITS.familyName} onChange={event => setNameDraft(event.target.value)} onBlur={applyName} /></label>
            {metric("ascender", "Ascender", 100, 2000)}
            {metric("capHeight", "Cap height", 50, 2000)}
            {metric("xHeight", "x-height", 50, 2000)}
            {metric("descender", "Descender", -1000, 0)}
            {metric("defaultAdvance", "Default advance", 50, 3000)}
            <small>Units per em: 1000. Brush width and coordinates use the same units.</small>
          </div>
          <div className="ct-section">
            <h3>Use & export</h3>
            <div className="ct-row-buttons">
              <button className="ct-primary" disabled={busy || !drawn} onClick={() => void install()}><Type size={14} /> Install in Luma</button>
              {onAddText && <button disabled={busy || !drawn} onClick={async () => { const family = await install(); if (family) { onAddText(family, previewText.split("\n")[0].slice(0, 80) || family); onClose(); } }}>Add text layer</button>}
            </div>
            <div className="ct-row-buttons">
              <button disabled={!drawn} onClick={() => void exportFont("otf")}><Download size={14} /> OTF</button>
              <button disabled={!drawn} onClick={() => void exportFont("ttf")}><Download size={14} /> TTF</button>
            </div>
            <div className="ct-row-buttons">
              <button onClick={() => void save(new Blob([JSON.stringify(project)], { type: "application/json" }), `${project.familyName.replace(/\s+/g, "-")}.lumaglyph.json`)}><Save size={14} /> Save project</button>
              <button onClick={() => openInput.current?.click()}><FolderOpen size={14} /> Open project</button>
            </div>
            <input ref={openInput} hidden type="file" accept=".json,.lumaglyph.json,application/json" onChange={async event => {
              const file = event.target.files?.[0]; event.target.value = "";
              if (!file) return;
              try {
                if (file.size > 8 * 1024 * 1024) throw new Error("Project file is too large");
                const loaded = validateGlyphProject(JSON.parse(await file.text()));
                commit(() => loaded); setNameDraft(loaded.familyName); setChar("A"); setStatus(`Opened ${loaded.familyName}`);
              } catch (error) { setStatus(error instanceof Error ? error.message : "Could not open that project"); }
            }} />
            {installed.length > 0 && <div className="gl-installed"><span>Installed Glyph fonts</span>{installed.map(font => <div key={font.family}><span>{font.family}</span><button aria-label={`Remove ${font.family}`} onClick={async () => { try { await removeUserFont(font.family); notifyTextFontsChanged(); setInstalled(listUserFonts()); } catch (error) { setStatus(String(error)); } }}><Trash2 size={12} /></button></div>)}</div>}
          </div>
          <p className="ct-note">Alpha. Outlines are straight-segment polygons (no curve fitting or hinting), with no kerning. Installed fonts live in this browser only: they are not embedded in .luma or PSD files, and mesh lettering / text outlining still need a bundled font.</p>
        </aside>
      </div>
      {status && <p className="ct-status" role="status">{status}</p>}
    </section>
  </div>;
}
