"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { Layer, PathStyle } from "../engine/document";
import { affineForLayerTransform, documentPointToLayer, transformPoint } from "../engine/document";
import type { Studio } from "../engine/studio";
import { pathContours } from "../engine/vector-path";
import { snapAnglePoint, type Point } from "../shared/path-editing";
import { addSegmentPoint, bendSegment, changePointMode, cutPathAtPoint, editablePointPath, editHandle, hitPathPoint, imageHandlePolar as handlePolar, imagePolarHandle as polarHandle, movePoints, partAt, PathPointTransaction, pointKey, removePathPoints, segmentControls, type PointHit, type PointRef, type SegmentRef } from "./path-point-editing";
import styles from "./path-point-editor.module.css";

export type PointPointer = Point & { pointerId: number; pointerType: string; shiftKey: boolean; altKey: boolean };
export type PathPointEditorHandle = { readonly active: boolean; down: (event: PointPointer) => void; move: (event: PointPointer) => void; end: (event: PointPointer, cancelled?: boolean) => void; cancel: () => void };
type Props = { studio: Studio; layer: Layer; documentId: string; viewport: { x: number; y: number; width: number; height: number; cssScale?: number }; phone: boolean; notify: (message: string) => void };
type Gesture = { pointerId: number; transaction: PathPointTransaction; base: PathStyle; next: PathStyle; hit: PointHit; start: Point; selected: PointRef[]; moved: boolean };

function NumberField({ label, value, onCommit, min, disabled = false }: { label: string; value: number; onCommit: (value: number) => void; min?: number; disabled?: boolean }) {
  const [draft, setDraft] = useState(String(Number(value.toFixed(4))));
  const [focused, setFocused] = useState(false), skip = useRef(false);
  const displayed = focused ? draft : String(Number(value.toFixed(4)));
  return <label>{label}<input type="number" step="any" min={min} disabled={disabled} value={displayed} onFocus={() => { setFocused(true); setDraft(String(Number(value.toFixed(4)))); }} onChange={event => setDraft(event.target.value)} onBlur={() => {
    setFocused(false); const next = Number(draft);
    if (!skip.current && draft.trim() && Number.isFinite(next) && (min === undefined || next >= min) && next !== value) onCommit(next);
    skip.current = false;
  }} onKeyDown={event => { event.stopPropagation(); if (event.key === "Enter") event.currentTarget.blur(); if (event.key === "Escape") { skip.current = true; setDraft(String(value)); event.currentTarget.blur(); } }} /></label>;
}

/** Overlay is passive: the existing canvas/tablet router owns capture, pan and pinch. */
export const PathPointEditor = forwardRef<PathPointEditorHandle, Props>(function PathPointEditor({ studio, layer, documentId, viewport, phone, notify }, ref) {
  const [, redraw] = useState(0), [selected, setSelected] = useState<PointRef[]>([]), selection = useRef<PointRef[]>([]);
  const [segment, setSegment] = useState<SegmentRef | null>(null), [tool, setTool] = useState<"select" | "bend" | "add">("select"), [snap, setSnap] = useState(false);
  const gesture = useRef<Gesture | null>(null), frame = useRef<number | null>(null), svg = useRef<SVGSVGElement>(null);
  const path = layer.path!, matrix = affineForLayerTransform(layer.transform);
  const scale = () => Math.max(1e-6, (svg.current?.getBoundingClientRect().width ?? viewport.width) / viewport.width);
  const render = () => redraw(value => value + 1);
  const select = (points: PointRef[]) => { selection.current = points; setSelected(points); };
  const stopFrame = () => { if (frame.current !== null) cancelAnimationFrame(frame.current); frame.current = null; };
  const cancel = () => { stopFrame(); const current = gesture.current; gesture.current = null; if (current) { current.transaction.cancel(); render(); } };
  const showError = (error: unknown) => notify(error instanceof Error ? error.message : "Path edit could not be applied");
  const run = (change: (source: PathStyle) => PathStyle) => {
    cancel();
    try { studio.updatePath(layer.id, change(layer.path!)); render(); return true; } catch (error) { showError(error); return false; }
  };
  const move = (event: PointPointer) => {
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId) return;
    let local = documentPointToLayer(layer.transform, event.x, event.y); if (!local) return;
    if (Math.hypot(local.x - current.start.x, local.y - current.start.y) * scale() < .5 && !current.moved) return;
    current.moved = true;
    if (event.shiftKey) local = snapAnglePoint(current.hit.kind === "in" || current.hit.kind === "out" ? partAt(current.base, current.hit.contour)!.anchors[current.hit.index] : current.start, local);
    if (snap) local = { x: Math.round(local.x), y: Math.round(local.y) };
    try {
      if (current.hit.kind === "anchor") current.next = movePoints(current.base, current.selected, { x: local.x - current.start.x, y: local.y - current.start.y });
      else if (current.hit.kind === "in" || current.hit.kind === "out") current.next = editHandle(current.base, current.hit, current.hit.kind, local, event.altKey);
      else if (current.hit.kind === "segment") current.next = bendSegment(current.base, current.hit, { x: local.x - current.start.x, y: local.y - current.start.y });
      if (frame.current === null) frame.current = requestAnimationFrame(() => { frame.current = null; if (gesture.current === current) { try { current.transaction.preview(current.next); render(); } catch (error) { cancel(); showError(error); } } });
    } catch (error) { cancel(); showError(error); }
  };
  useImperativeHandle(ref, () => ({
    get active() { return gesture.current !== null; }, cancel, move,
    down(event) {
      cancel();
      const hit = hitPathPoint(layer.path!, layer, event, selection.current, scale(), event.pointerType === "touch" ? 22 : 11);
      if (!hit) { if (!event.shiftKey) { select([]); setSegment(null); } return; }
      const local = documentPointToLayer(layer.transform, event.x, event.y); if (!local) { notify("This layer transform cannot be inverted"); return; }
      if (hit.kind === "segment") {
        setSegment(hit);
        if (tool === "add") { if (run(source => addSegmentPoint(source, hit))) select([{ contour: hit.contour, index: hit.index + 1 }]); return; }
        if (tool !== "bend") return;
      } else {
        setSegment(null);
        if (hit.kind === "anchor") {
          const included = selection.current.some(ref => pointKey(ref) === pointKey(hit));
          const next = event.shiftKey ? included ? selection.current.filter(ref => pointKey(ref) !== pointKey(hit)) : [...selection.current, hit] : included ? selection.current : [hit];
          select(next); if (!next.some(ref => pointKey(ref) === pointKey(hit))) return;
        }
      }
      try { gesture.current = { pointerId: event.pointerId, transaction: new PathPointTransaction(studio, layer, documentId), base: editablePointPath(layer.path!), next: layer.path!, hit, start: local, selected: [...selection.current], moved: false }; }
      catch (error) { showError(error); }
    },
    end(event, cancelled = false) {
      const current = gesture.current; if (!current || current.pointerId !== event.pointerId) return;
      if (cancelled) { cancel(); return; }
      move(event); stopFrame();
      if (gesture.current !== current) return;
      gesture.current = null;
      try { current.transaction.commit(current.next); render(); } catch (error) { showError(error); }
    },
  }));
  useEffect(() => {
    const blur = () => cancel();
    // A menu save/undo or layer switch must never consume an uncommitted preview.
    const outsideDown = (event: PointerEvent) => { if (gesture.current && !(event.target instanceof Element && event.target.closest("canvas"))) cancel(); };
    const key = (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"]')) return;
      if (event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); if (gesture.current) cancel(); else { select([]); setSegment(null); } return; }
      if ((event.ctrlKey || event.metaKey) && ["z", "s"].includes(event.key.toLowerCase())) {
        const wasEditing = gesture.current !== null; cancel();
        if (wasEditing && event.key.toLowerCase() === "z") { event.preventDefault(); event.stopImmediatePropagation(); }
        return;
      }
      if (!selection.current.length || event.ctrlKey || event.metaKey || event.altKey || target?.closest('button,a,summary')) return;
      const directions: Record<string, Point> = { ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 }, ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 } };
      const direction = directions[event.key]; if (!direction) return;
      event.preventDefault(); event.stopImmediatePropagation();
      run(source => movePoints(source, selection.current, { x: direction.x * (event.shiftKey ? 10 : 1), y: direction.y * (event.shiftKey ? 10 : 1) }));
    };
    window.addEventListener("blur", blur); window.addEventListener("keydown", key, true); window.addEventListener("pointerdown", outsideDown, true);
    return () => { window.removeEventListener("blur", blur); window.removeEventListener("keydown", key, true); window.removeEventListener("pointerdown", outsideDown, true); cancel(); };
    // Lifetime follows the source layer/document key, never pointer-frame renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studio, layer.id, documentId]);
  const first = selected.find(ref => partAt(path, ref.contour)?.anchors[ref.index]), anchor = first ? partAt(path, first.contour)!.anchors[first.index] : null;
  const chosenSegment = segment ?? (first && (() => { try { segmentControls(path, first); return { ...first, t: .5 }; } catch { return null; } })());
  const chord = chosenSegment ? (() => { try { const { a, b } = segmentControls(path, chosenSegment); return handlePolar({ dx: b.x - a.x, dy: b.y - a.y }); } catch { return null; } })() : null;
  const handleField = (side: "in" | "out", field: "length" | "angle", value: number) => {
    if (!first || !anchor) return;
    const original = handlePolar(side === "in" ? anchor.hIn : anchor.hOut), vector = polarHandle(field === "length" ? value : original.length, field === "angle" ? value : original.angle);
    run(source => editHandle(source, first, side, { x: anchor.x + vector.dx, y: anchor.y + vector.dy }));
  };
  const toDoc = (point: Point) => transformPoint(matrix, point.x, point.y);
  const r = 4 / Math.max(viewport.cssScale ?? 1, 1e-6);
  const chosenKeys = new Set(selected.map(pointKey));
  return <div className={styles.editor}>
    <svg ref={svg} aria-hidden="true" viewBox={`${viewport.x} ${viewport.y} ${viewport.width} ${viewport.height}`} preserveAspectRatio="none" className={styles.overlay}>
      {pathContours(path).map((part, contour) => <g key={contour}>
        {part.anchors.map((a, index) => {
          const p = toDoc(a), ref = { contour, index }, chosen = chosenKeys.has(pointKey(ref));
          const incoming = toDoc({ x: a.x + a.hIn.dx, y: a.y + a.hIn.dy }), outgoing = toDoc({ x: a.x + a.hOut.dx, y: a.y + a.hOut.dy });
          const next = part.anchors[index + 1] ?? (part.closed ? part.anchors[0] : null), q = next && toDoc(next), handle = next && toDoc({ x: next.x + next.hIn.dx, y: next.y + next.hIn.dy });
          return <g key={a.id ?? index}>
            {q && handle && <path d={`M${p.x} ${p.y} C${outgoing.x} ${outgoing.y} ${handle.x} ${handle.y} ${q.x} ${q.y}`} fill="none" stroke={chosenSegment?.contour === contour && chosenSegment.index === index ? "#ffbe74" : "#61dbff"} strokeWidth={1.3} vectorEffect="non-scaling-stroke" />}
            {chosen && <>{(part.closed || index > 0) && <><line x1={incoming.x} y1={incoming.y} x2={p.x} y2={p.y} stroke="#ffbe74" strokeWidth={1} vectorEffect="non-scaling-stroke" /><circle cx={incoming.x} cy={incoming.y} r={r} fill="#ffbe74" stroke="#111" vectorEffect="non-scaling-stroke" /></>}{(part.closed || index < part.anchors.length - 1) && <><line x1={p.x} y1={p.y} x2={outgoing.x} y2={outgoing.y} stroke="#ffbe74" strokeWidth={1} vectorEffect="non-scaling-stroke" /><circle cx={outgoing.x} cy={outgoing.y} r={r} fill="#ffbe74" stroke="#111" vectorEffect="non-scaling-stroke" /></>}</>}
            <rect x={p.x - r} y={p.y - r} width={r * 2} height={r * 2} fill={chosen ? "#61dbff" : "white"} stroke="#172238" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          </g>;
        })}
      </g>)}
    </svg>
    <details className={styles.panel} open={!phone} onPointerDown={event => event.stopPropagation()} onWheel={event => event.stopPropagation()}>
      <summary>Edit Points · {selected.length} selected</summary>
      <div className={styles.content}>
        <div className={styles.row}>{([['select', 'Select'], ['bend', 'Bend segment'], ['add', 'Add Point']] as const).map(([value, label]) => <button key={value} aria-pressed={tool === value} onClick={() => { cancel(); setTool(value); }}>{label}</button>)}<button aria-pressed={snap} onClick={() => setSnap(value => !value)}>Snap local 1 px</button></div>
        <p>Shift: select points / constrain drag 45°. Alt: independent handle. Arrow keys: 1 px; Shift: 10 px. Touch: use existing draw/navigate switch; pinch cancels the edit.</p>
        <div className={styles.row}><button onClick={() => select(pathContours(path).flatMap((part, contour) => part.anchors.map((_, index) => ({ contour, index }))))}>Select all points</button><button disabled={!selected.length} onClick={() => { if (run(source => removePathPoints(source, selection.current))) { select([]); setSegment(null); } }}>Remove · reconnect</button><button disabled={!first} onClick={() => { if (first && run(source => cutPathAtPoint(source, first))) { select([{ contour: first.contour, index: partAt(path, first.contour)!.closed ? 0 : first.index }]); setSegment(null); } }}>Cut / Open at point</button></div>
        {anchor && first && <>
          <div className={styles.row}><label>Point mode<select value={anchor.mode ?? "corner"} onChange={event => run(source => changePointMode(source, selection.current, event.target.value as "corner" | "smooth" | "symmetric"))}><option value="corner">Corner · independent</option><option value="smooth">Smooth · unequal lengths</option><option value="symmetric">Symmetric · equal lengths</option></select></label><NumberField label="Point X (local px)" value={anchor.x} onCommit={value => run(source => movePoints(source, selection.current, { x: value - anchor.x, y: 0 }))} /><NumberField label="Point Y (local px)" value={anchor.y} onCommit={value => run(source => movePoints(source, selection.current, { x: 0, y: value - anchor.y }))} /></div>
          <div className={styles.row}>{(["in", "out"] as const).map(side => { const polar = handlePolar(side === "in" ? anchor.hIn : anchor.hOut), part = partAt(path, first.contour)!, unused = !part.closed && (side === "in" ? first.index === 0 : first.index === part.anchors.length - 1); return <fieldset key={side}><legend>{side === "in" ? "Incoming" : "Outgoing"} handle{unused ? " · open endpoint" : ""}</legend><NumberField label="Length (px)" value={polar.length} disabled={unused} min={0} onCommit={value => handleField(side, "length", value)} /><NumberField label="Angle (° counterclockwise)" value={polar.angle} disabled={unused} onCommit={value => handleField(side, "angle", value)} /></fieldset>; })}</div>
        </>}
        {chosenSegment && chord && <fieldset><legend>Straight endpoint chord · not curve arc length</legend><div className={styles.row}>{(["length", "angle"] as const).map(field => <NumberField key={field} label={field === "length" ? "Chord length (px)" : "Chord angle (° counterclockwise)"} value={chord[field]} min={field === "length" ? 0 : undefined} onCommit={value => run(source => {
          const { a, b, next } = segmentControls(source, chosenSegment), vector = polarHandle(field === "length" ? value : chord.length, field === "angle" ? value : chord.angle);
          return movePoints(source, [{ contour: chosenSegment.contour, index: next }], { x: a.x + vector.dx - b.x, y: a.y + vector.dy - b.y });
        })} />)}<button onClick={() => { if (run(source => addSegmentPoint(source, chosenSegment))) { select([{ contour: chosenSegment.contour, index: chosenSegment.index + 1 }]); setSegment(null); } }}>Add Point at {Math.round(chosenSegment.t * 100)}%</button></div></fieldset>}
        <p>Edits retain vector source, contours, fill rule and layer transform. Add Point exactly subdivides the curve; symmetric endpoints become smooth where subdivision changes handle lengths. Remove reconnects neighbors; Cut opens/splits the contour.</p>
      </div>
    </details>
  </div>;
});
