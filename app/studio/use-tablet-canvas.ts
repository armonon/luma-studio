"use client";

import { useEffect, useRef, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import type { CanvasView } from "../engine/viewport";
import { navigateTouches, TabletPointerSession } from "./tablet-input";

type CanvasEvent = ReactPointerEvent<HTMLCanvasElement>;
export function useTabletCanvas({ enabled, drawWithTouch, documentId, view, fitScale, stage, setView, down, move, up, cancel, canCancelTouch }: {
  canCancelTouch?: () => boolean;
  enabled: boolean; drawWithTouch: boolean; documentId: string | null; view: CanvasView; fitScale: number;
  stage: RefObject<HTMLDivElement | null>; setView: (view: CanvasView) => void;
  down: (event: CanvasEvent) => void; move: (event: CanvasEvent) => void;
  up: (event: CanvasEvent) => void; cancel: (event: CanvasEvent) => void;
}) {
  const session = useRef(new TabletPointerSession());
  const editorEvent = useRef<CanvasEvent | null>(null);
  const frame = useRef<number | null>(null);
  const pendingView = useRef<CanvasView | null>(null);
  useEffect(() => {
    session.current = new TabletPointerSession();
    editorEvent.current = null;
    pendingView.current = null;
    return () => { if (frame.current !== null) cancelAnimationFrame(frame.current); frame.current = null; };
  }, [documentId, enabled]);
  const flush = () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    if (pendingView.current) setView(pendingView.current);
    if (!session.current.touches.size) pendingView.current = null;
  };
  const point = (event: CanvasEvent) => {
    const rect = stage.current?.getBoundingClientRect();
    return { x: event.clientX - (rect ? rect.left + rect.width / 2 : 0), y: event.clientY - (rect ? rect.top + rect.height / 2 : 0) };
  };
  const finish = (event: CanvasEvent, cancelled: boolean) => {
    if (!enabled) { (cancelled ? cancel : up)(event); return; }
    const s = session.current;
    if (s.editor === event.pointerId) (cancelled ? cancel : up)(event);
    if (s.editor === event.pointerId) editorEvent.current = null;
    s.up(event.pointerId);
    flush();
  };
  return {
    onPointerDown: (event: CanvasEvent) => {
      if (!enabled) { down(event); return; }
      event.preventDefault();
      const route = session.current.down(event.pointerId, event.pointerType, drawWithTouch, point(event), canCancelTouch?.() ?? false);
      event.currentTarget.setPointerCapture(event.pointerId);
      if (route === "cancel-edit" && editorEvent.current) {
        cancel({ ...editorEvent.current, type: "pointercancel" });
        editorEvent.current = null;
      }
      if (route === "edit") { editorEvent.current = { ...event, currentTarget: event.currentTarget, target: event.target }; flush(); down(event); }
    },
    onPointerMove: (event: CanvasEvent) => {
      if (!enabled) { move(event); return; }
      const s = session.current;
      if (s.blocked.has(event.pointerId)) return;
      if (s.editor !== null) { if (s.editor === event.pointerId) { s.updateEditor(event.pointerId, point(event)); move(event); } return; }
      if (!s.touches.has(event.pointerId)) { if (event.pointerType !== "touch") move(event); return; }
      event.preventDefault();
      const previous = [...s.touches.values()];
      s.touches.set(event.pointerId, point(event));
      pendingView.current = navigateTouches(pendingView.current ?? view, previous, [...s.touches.values()], fitScale);
      if (frame.current === null) frame.current = requestAnimationFrame(() => { frame.current = null; flush(); });
    },
    onPointerUp: (event: CanvasEvent) => finish(event, false),
    onPointerCancel: (event: CanvasEvent) => finish(event, true),
    onLostPointerCapture: (event: CanvasEvent) => {
      // The caller retains its existing tool rollback; clear only this pointer.
      const wasEditor = session.current.editor === event.pointerId;
      if (enabled) { session.current.up(event.pointerId); flush(); }
      return wasEditor;
    },
  };
}
