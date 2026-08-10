"use client";

import {
  CircleDashed,
  FolderTree,
  ImagePlus,
  Layers3,
  LockKeyhole,
  Pin,
  PinOff,
  Plus,
  ScanSearch,
  Shapes,
  SlidersHorizontal,
  Sparkles,
  Type,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent } from "react";
import type { Layer } from "@/app/engine/document";
import type { FocusEditTarget, FocusItem, LayerFocusState } from "./layer-focus-model";

type FocusCreateAction = "new" | "import" | "adjustment" | "text" | "shape" | "group" | "generate" | "paste";

type Props = {
  items: FocusItem[];
  selectedLayerId: string | null;
  focus: LayerFocusState;
  focusedLayerName?: string;
  projectName: string;
  onSelect: (layerId: string) => void;
  onFocus: (layerId: string, target?: FocusEditTarget) => void;
  onExit: () => void;
  onPin: (layerId: string) => void;
  onReorder: (sourceId: string, targetId: string) => void;
  onCreate: (action: FocusCreateAction) => void;
  onDropFiles: (files: File[]) => void;
  onCollapse: () => void;
};

const CARD_WIDTH = 116;
const CARD_GAP = 10;
const CARD_STRIDE = CARD_WIDTH + CARD_GAP;

function layerBadge(layer: Layer) {
  if (layer.ai) return { label: "AI", Icon: Sparkles };
  if (layer.kind === "group") return { label: "Group", Icon: FolderTree };
  if (layer.kind === "text") return { label: "Text", Icon: Type };
  if (layer.kind === "shape" || layer.kind === "path") return { label: "Vector", Icon: Shapes };
  if (layer.kind.startsWith("adjustment")) return { label: "Adjustment", Icon: SlidersHorizontal };
  if (layer.mask) return { label: "Mask", Icon: CircleDashed };
  return null;
}

function layerRevision(layer: Layer) {
  const version = (canvas?: HTMLCanvasElement) => (canvas as unknown as { __v?: number } | undefined)?.__v ?? 0;
  return `${version(layer.bitmap)}:${version(layer.mask)}:${layer.opacity}:${layer.visible}:${layer.transform.tx}:${layer.transform.ty}:${layer.transform.sx}:${layer.transform.sy}:${layer.transform.rotation}:${layer.text?.text ?? ""}:${layer.text?.color ?? ""}:${layer.shape?.kind ?? ""}:${layer.shape?.fill ?? ""}:${layer.path?.anchors.length ?? 0}`;
}

function FocusThumbnail({ layer, previewLayer }: { layer: Layer; previewLayer?: Layer }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const visualLayer = previewLayer ?? layer;
  const revision = layerRevision(visualLayer);
  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#e4e7eb";
    context.fillRect(0, 0, canvas.width, canvas.height);
    const source = visualLayer.bitmap;
    if (source) {
      const scale = Math.max(canvas.width / Math.max(1, source.width), canvas.height / Math.max(1, source.height));
      const width = source.width * scale;
      const height = source.height * scale;
      context.drawImage(source, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
      return;
    }
    if (visualLayer.shape) {
      context.fillStyle = visualLayer.shape.fill;
      if (visualLayer.shape.kind === "ellipse") {
        context.beginPath();
        context.ellipse(canvas.width / 2, canvas.height / 2, canvas.width * 0.28, canvas.height * 0.32, 0, 0, Math.PI * 2);
        context.fill();
      } else context.fillRect(canvas.width * 0.22, canvas.height * 0.2, canvas.width * 0.56, canvas.height * 0.6);
      return;
    }
    if (visualLayer.text) {
      context.fillStyle = visualLayer.text.color;
      context.font = "600 30px system-ui, sans-serif";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(visualLayer.text.text.split("\n")[0].slice(0, 14) || "Text", canvas.width / 2, canvas.height / 2, canvas.width * 0.8);
      return;
    }
    if (visualLayer.path) {
      context.strokeStyle = visualLayer.path.stroke || "#5f6672";
      context.lineWidth = 5;
      context.beginPath();
      context.moveTo(canvas.width * 0.2, canvas.height * 0.68);
      context.bezierCurveTo(canvas.width * 0.34, canvas.height * 0.12, canvas.width * 0.66, canvas.height * 0.88, canvas.width * 0.8, canvas.height * 0.32);
      context.stroke();
    }
  }, [visualLayer, revision]);
  return <canvas ref={canvasRef} width={232} height={144} aria-hidden="true" />;
}

function FocusCard({
  item,
  selected,
  focused,
  focusTarget,
  onSelect,
  onFocus,
  onPin,
  onDragStart,
  onDrop,
}: {
  item: FocusItem;
  selected: boolean;
  focused: boolean;
  focusTarget: FocusEditTarget;
  onSelect: () => void;
  onFocus: (target?: FocusEditTarget) => void;
  onPin: () => void;
  onDragStart: () => void;
  onDrop: () => void;
}) {
  const badge = layerBadge(item.layer);
  const BadgeIcon = badge?.Icon;
  const metadata = `${item.layer.name}\n${item.layer.kind.replaceAll("-", " ")}${item.layer.bitmap ? ` · ${item.layer.bitmap.width} × ${item.layer.bitmap.height}` : ""}`;
  return (
    <article
      className={`focus-card${selected ? " selected" : ""}${focused ? " focused" : ""}${!item.layer.visible ? " hidden-layer" : ""}${item.layer.locked ? " locked-layer" : ""}`}
      title={metadata}
      draggable
      onDragStart={onDragStart}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => { event.preventDefault(); onDrop(); }}
    >
      <button className="focus-card-select" onClick={onSelect} onDoubleClick={() => onFocus()} aria-label={`Select ${item.layer.name}. Double-click to focus.`}>
        <FocusThumbnail layer={item.layer} previewLayer={item.previewLayer} />
        {BadgeIcon && <span className="focus-type-badge" title={badge?.label}><BadgeIcon size={11} strokeWidth={1.7} /></span>}
        {item.layer.locked && <span className="focus-lock-badge" title="Locked"><LockKeyhole size={10} strokeWidth={1.7} /></span>}
        {focused && <span className="focus-mode-badge"><ScanSearch size={10} strokeWidth={1.8} /> {focusTarget === "mask" ? "Mask" : "Focus"}</span>}
        <span className="focus-hover-meta"><strong>{item.layer.name}</strong><small>{item.layer.kind.replaceAll("-", " ")}</small></span>
      </button>
      <div className="focus-card-actions">
        <button onClick={() => onFocus()} title={`Focus ${item.layer.name}`}><ScanSearch size={12} strokeWidth={1.7} /><span>Focus</span></button>
        {item.layer.mask && <button onClick={() => onFocus("mask")} title={`Focus ${item.layer.name} mask`}><CircleDashed size={12} strokeWidth={1.7} /></button>}
        <button onClick={onPin} title={item.pinned ? "Unpin from Focus" : "Pin in Focus"}>{item.pinned ? <PinOff size={12} /> : <Pin size={12} />}</button>
      </div>
    </article>
  );
}

export default function LayerFocusPanel({
  items,
  selectedLayerId,
  focus,
  focusedLayerName,
  projectName,
  onSelect,
  onFocus,
  onExit,
  onPin,
  onReorder,
  onCreate,
  onDropFiles,
  onCollapse,
}: Props) {
  const stripRef = useRef<HTMLDivElement>(null);
  const draggedId = useRef<string | null>(null);
  const [visible, setVisible] = useState({ start: 0, end: 18 });
  const focusedLayerId = focus.scope?.layerId ?? null;
  const selectedIndex = items.findIndex((item) => item.layer.id === selectedLayerId);
  const rendered = useMemo(() => items.slice(visible.start, visible.end), [items, visible]);
  const updateWindow = () => {
    const strip = stripRef.current;
    if (!strip) return;
    const start = Math.max(0, Math.floor(strip.scrollLeft / CARD_STRIDE) - 3);
    const end = Math.min(items.length, Math.ceil((strip.scrollLeft + strip.clientWidth) / CARD_STRIDE) + 4);
    setVisible((current) => current.start === start && current.end === end ? current : { start, end });
  };

  useEffect(() => {
    const strip = stripRef.current;
    if (!strip || selectedIndex < 0) return;
    const left = selectedIndex * CARD_STRIDE;
    const right = left + CARD_WIDTH;
    if (left < strip.scrollLeft) strip.scrollTo({ left: Math.max(0, left - CARD_GAP), behavior: "smooth" });
    else if (right > strip.scrollLeft + strip.clientWidth) strip.scrollTo({ left: right - strip.clientWidth + CARD_GAP, behavior: "smooth" });
    strip.dispatchEvent(new Event("scroll"));
  }, [selectedIndex]);

  const focusedName = focus.scope
    ? focusedLayerName ?? items.find((item) => item.layer.id === focus.scope?.layerId)?.layer.name ?? "Layer"
    : null;

  const handleFileDrop = (event: DragEvent) => {
    if (!event.dataTransfer.files.length) return;
    event.preventDefault();
    onDropFiles([...event.dataTransfer.files]);
  };
  const chooseCreate = (action: FocusCreateAction) => (event: MouseEvent<HTMLButtonElement>) => {
    event.currentTarget.closest("details")?.removeAttribute("open");
    onCreate(action);
  };

  return (
    <section className="layer-focus-panel" aria-label="Layer Focus" onDragOver={(event) => event.preventDefault()} onDrop={handleFileDrop}>
      <div className="focus-status">
        <div><strong>FOCUS</strong><small>{focus.scope ? "Project / Layer" : "Project"}</small></div>
        <span title={focus.scope ? focusedName ?? undefined : projectName}>{focusedName ?? projectName}</span>
        {focus.scope && <button onClick={onExit} title="Exit Focus (Esc)">Back to Project</button>}
        <button className="focus-collapse" onClick={onCollapse} aria-label="Collapse Focus panel">⌄</button>
      </div>

      <div className="focus-window" ref={stripRef} onScroll={updateWindow}>
        <div className="focus-window-content" style={{ width: (items.length + 1) * CARD_STRIDE }}>
          {rendered.map((item, localIndex) => {
            const index = visible.start + localIndex;
            return (
              <div key={item.layer.id} className="focus-virtual-item" style={{ left: index * CARD_STRIDE }}>
                <FocusCard
                  item={item}
                  selected={selectedLayerId === item.layer.id}
                  focused={focusedLayerId === item.layer.id}
                  focusTarget={focusedLayerId === item.layer.id ? focus.scope?.target ?? "pixels" : "pixels"}
                  onSelect={() => onSelect(item.layer.id)}
                  onFocus={(target) => onFocus(item.layer.id, target)}
                  onPin={() => onPin(item.layer.id)}
                  onDragStart={() => { draggedId.current = item.layer.id; }}
                  onDrop={() => {
                    if (draggedId.current && draggedId.current !== item.layer.id) onReorder(draggedId.current, item.layer.id);
                    draggedId.current = null;
                  }}
                />
              </div>
            );
          })}
          <details className="focus-add-menu" style={{ left: items.length * CARD_STRIDE }}>
            <summary aria-label="Create or import layer"><Plus size={20} strokeWidth={1.5} /><span>Add</span></summary>
            <div>
              <button onClick={chooseCreate("new")}><Plus size={14} />New Layer</button>
              <button onClick={chooseCreate("import")}><ImagePlus size={14} />Import Image</button>
              <button onClick={chooseCreate("adjustment")}><SlidersHorizontal size={14} />Adjustment Layer</button>
              <button onClick={chooseCreate("text")}><Type size={14} />Text</button>
              <button onClick={chooseCreate("shape")}><Shapes size={14} />Shape</button>
              <button onClick={chooseCreate("group")}><FolderTree size={14} />Group</button>
              <button onClick={chooseCreate("generate")}><Sparkles size={14} />Generate</button>
              <button onClick={chooseCreate("paste")}><Layers3 size={14} />Paste as Layer</button>
            </div>
          </details>
        </div>
      </div>
    </section>
  );
}

export type { FocusCreateAction };
