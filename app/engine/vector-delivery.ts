import { affineForLayerTransform, type Document, type Layer, type PathStyle } from "./document";
import { cloneContour, pathContours, validateVectorPath, vectorPaints, vectorPathData, vectorPathBounds, type PathContour } from "./vector-path";
import { requireVectorDelivery, type VectorDeliveryNode } from "./vector-delivery-plan";
import { alphaTilePng, VECTOR_ALPHA_LIMITS } from "./vector-alpha-delivery";

const xml = (value: string) => value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);
function paint(value: string) {
  if (!/^(?:none|transparent|#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})|rgba?\(\s*\d+(?:\.\d+)?\s*,\s*\d+(?:\.\d+)?\s*,\s*\d+(?:\.\d+)?(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\))$/i.test(value) || value.length > 128) throw new Error("SVG export supports solid CSS hex/rgb colors only");
  return xml(value === "transparent" ? "none" : value);
}

export function vectorDeliveryProblem(layer: Layer): string | null {
  if (!layer.path && !layer.shape) return `${layer.name}: only path and shape layers can be exported as editable vectors`;
  if (layer.parentId) return `${layer.name}: ungroup before vector delivery`;
  if (layer.mask || layer.maskSurface || layer.vectorMask || layer.subjectMask || layer.clipping) return `${layer.name}: masks and clipping are not supported by vector delivery yet`;
  if (layer.blend !== "source-over" || layer.blendStack?.some(p => p.enabled) || layer.effects?.some(e => e.enabled) || layer.filters?.some(f => f.enabled) || layer.spatial?.enabled || (layer.knockout && layer.knockout !== "none") || layer.blendChannels && Object.values(layer.blendChannels).some(v => !v)) return `${layer.name}: raster effects, spatial effects, or blending require raster export`;
  if (layer.blendIf) return `${layer.name}: Blend If requires raster export`;
  return null;
}

/** Curves stay curves. Rectangle/ellipse conversion is local geometry, not a bitmap trace. */
export function layerVectorPath(layer: Layer): PathStyle {
  if (layer.path) { validateVectorPath(layer.path); return structuredClone(layer.path); }
  const s = layer.shape;
  if (!s) throw new Error("Select a vector path or shape");
  const anchor = (x: number, y: number, ix = 0, iy = 0, ox = 0, oy = 0) => ({ x, y, hIn: { dx: ix, dy: iy }, hOut: { dx: ox, dy: oy } });
  const { x, y, w, h } = s;
  if (![x, y, w, h].every(Number.isFinite) || w < 0 || h < 0) throw new Error("Invalid shape dimensions");
  let anchors;
  if (s.kind === "ellipse") {
    const k = 0.5522847498307936, rx = w / 2, ry = h / 2, cx = x + rx, cy = y + ry;
    anchors = [anchor(cx, y, -rx * k, 0, rx * k, 0), anchor(x + w, cy, 0, -ry * k, 0, ry * k), anchor(cx, y + h, rx * k, 0, -rx * k, 0), anchor(x, cy, 0, ry * k, 0, -ry * k)];
  } else {
    const r = Math.max(0, Math.min(s.radius, w / 2, h / 2));
    if (r) {
      const k = r * 0.5522847498307936;
      anchors = [anchor(x + r, y, -k, 0), anchor(x + w - r, y, 0, 0, k, 0),
        anchor(x + w, y + r, 0, -k), anchor(x + w, y + h - r, 0, 0, 0, k),
        anchor(x + w - r, y + h, k, 0), anchor(x + r, y + h, 0, 0, -k, 0),
        anchor(x, y + h - r, 0, k), anchor(x, y + r, 0, 0, 0, -k)];
    } else anchors = [anchor(x, y), anchor(x + w, y), anchor(x + w, y + h), anchor(x, y + h)];
  }
  const result: PathStyle = { anchors, closed: true, fill: s.fill, stroke: s.stroke, strokeWidth: s.strokeWidth };
  validateVectorPath(result);
  return result;
}

export function documentContours(layer: Layer): PathContour[] {
  const matrix = affineForLayerTransform(layer.transform);
  const path = layerVectorPath(layer);
  const contours = pathContours(path).map(cloneContour);
  for (const contour of contours) for (const a of contour.anchors) {
    const x = matrix.a * a.x + matrix.c * a.y + matrix.e, y = matrix.b * a.x + matrix.d * a.y + matrix.f;
    for (const handle of [a.hIn, a.hOut]) { const dx = matrix.a * handle.dx + matrix.c * handle.dy; handle.dy = matrix.b * handle.dx + matrix.d * handle.dy; handle.dx = dx; }
    a.x = x; a.y = y;
  }
  return contours;
}

/** Strict delivery: never silently drops an unsupported visible layer. */
export function exportVectorSvg(doc: Document, selected?: Layer[]): string {
  const { nodes } = requireVectorDelivery(doc, "svg", selected);
  const definitions: string[] = [];
  const ids = new Set(doc.layers.map(l => l.id));
  let maskIndex = 0;
  let encodedCharacters = 0;
  const maskId = () => { let id: string; do { id = `luma-mask-${maskIndex++}`; } while (ids.has(id)); ids.add(id); return id; };
  const bounds = (node: VectorDeliveryNode): { x: number; y: number; width: number; height: number } => {
    let boxes;
    if (node.path) {
      const b = vectorPathBounds(node.path), m = affineForLayerTransform(node.layer.transform);
      const points = [[b.x,b.y],[b.x+b.width,b.y],[b.x,b.y+b.height],[b.x+b.width,b.y+b.height]].map(([x,y])=>({x:m.a*x+m.c*y+m.e,y:m.b*x+m.d*y+m.f}));
      const left=Math.min(...points.map(p=>p.x)),top=Math.min(...points.map(p=>p.y));
      boxes=[{x:left,y:top,width:Math.max(...points.map(p=>p.x))-left,height:Math.max(...points.map(p=>p.y))-top}];
    } else boxes = node.children.map(bounds);
    const x = Math.max(0, Math.min(doc.width, ...boxes.map(b=>b.x))), y = Math.max(0, Math.min(doc.height, ...boxes.map(b=>b.y)));
    return { x, y, width: Math.max(1, Math.min(doc.width, Math.max(0,...boxes.map(b=>b.x+b.width)))-x), height: Math.max(1, Math.min(doc.height, Math.max(0,...boxes.map(b=>b.y+b.height)))-y) };
  };
  const element = (node: VectorDeliveryNode): string => {
    const { layer, path: p } = node;
    const m = affineForLayerTransform(layer.transform);
    const opacity = node.compositeOpacity ?? layer.opacity * (p ? 1 : layer.fillOpacity ?? 1);
    const clips: string[] = [];
    for (const source of [node.mask, node.clip]) {
      if (!source || source === node.mask && pathContours(source).every(c => c.anchors.length < 2)) continue;
      const id = maskId();
      const contours = pathContours(source).map(c => ({ ...c, closed: true }));
      const mask = { ...source, ...contours[0], contours: contours.slice(1) };
      definitions.push(`<clipPath id="${id}" clipPathUnits="userSpaceOnUse"><path d="${vectorPathData(mask)}" clip-rule="${mask.fillRule ?? "nonzero"}"/></clipPath>`);
      clips.push(id);
    }
    const clipAttribute = clips.length ? ` clip-path="url(#${clips[0]})"` : "";
    const isolation = () => {
      // One paint has no overlap to isolate. Avoid unnecessary offscreen
      // filters and extra alpha quantization, especially on huge canvases.
      if (p && vectorPaints(p).filter(paint => paint.enabled && paint.color !== "none" && paint.color !== "transparent" && (paint.kind === "fill" || paint.width > 0)).length <= 1) return "";
      const filter = maskId(), b = bounds(node);
      definitions.push(`<filter id="${filter}" filterUnits="userSpaceOnUse" x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 1 0"/></filter>`);
      return ` filter="url(#${filter})"`;
    };
    let alphaAttribute = "", clippingAlpha = "";
    if (node.clipContent) {
      const id = maskId();
      definitions.push(`<mask id="${id}" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" x="0" y="0" width="${doc.width}" height="${doc.height}" style="mask-type:alpha">${element({ ...node.clipContent, synthetic: true })}</mask>`);
      clippingAlpha = ` mask="url(#${id})"${isolation()}`;
    }
    if (node.alpha) {
      const alpha = node.alpha, id = maskId();
      const rect = (x: number, y: number, width: number, height: number, value: number) => `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="rgb(${value},${value},${value})"/>`;
      const tiles = [rect(0, 0, alpha.width, alpha.height, alpha.defaultAlpha)];
      for (const tile of alpha.tiles()) {
        if (typeof tile.alpha === "number") tiles.push(rect(tile.x, tile.y, tile.width, tile.height, tile.alpha));
        else {
          const data = alphaTilePng({ ...tile, alpha: tile.alpha });
          encodedCharacters += data.length;
          if (encodedCharacters > VECTOR_ALPHA_LIMITS.encodedCharacters) throw new Error("Encoded masks exceed the 64 MiB SVG delivery budget");
          tiles.push(`<image x="${tile.x}" y="${tile.y}" width="${tile.width}" height="${tile.height}" xlink:href="${data}"/>`);
        }
      }
      definitions.push(`<mask id="${id}" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" x="0" y="0" width="${doc.width}" height="${doc.height}" mask-type="luminance" color-interpolation="sRGB">${tiles.join("")}</mask>`);
      // WebKit otherwise applies a group mask separately to overlapping child
      // paints. A no-op filter forces one isolated result without baking pixels
      // into the file. Bound it to artwork (including strokes), not a 50K page.
      alphaAttribute = ` mask="url(#${id})"${isolation()}`;
    }
    const clipped = (content: string) => {
      const result = clips.slice(1).reduce((result, id) => `<g clip-path="url(#${id})">${result}</g>`, content);
      return clippingAlpha ? `<g${clippingAlpha}>${result}</g>` : result;
    };
    const id = node.synthetic ? maskId() : xml(layer.id);
    if (!p) return `<g id="${id}" opacity="${opacity}"${clipAttribute}${alphaAttribute}><title>${xml(layer.name)}</title>${clipped(node.children.map(element).join(""))}</g>`;
    const closed = pathContours(p).filter(contour => contour.closed);
    const fillPath: PathStyle = { ...p, anchors: closed[0]?.anchors ?? [], closed: true, contours: closed.slice(1) };
    const paints = vectorPaints(p).filter(entry => entry.enabled).map(entry => entry.kind === "fill"
      ? `<path d="${vectorPathData(fillPath)}" fill="${paint(entry.color)}" fill-opacity="${entry.opacity}" fill-rule="${p.fillRule ?? "nonzero"}"/>`
      : `<path d="${vectorPathData(p)}" fill="none" stroke="${paint(entry.color)}" stroke-opacity="${entry.opacity}" stroke-width="${entry.width}" stroke-linecap="round" stroke-linejoin="round"/>`).join("");
    // Masks live in document space, outside the object's local transform.
    const content = `<g opacity="${layer.fillOpacity ?? 1}" transform="matrix(${m.a} ${m.b} ${m.c} ${m.d} ${m.e} ${m.f})">${paints}</g>`;
    return `<g id="${id}" opacity="${opacity}"${clipAttribute}${alphaAttribute}><title>${xml(layer.name)}</title>${clipped(content)}</g>`;
  };
  const elements = nodes.map(element).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg"${encodedCharacters ? ' xmlns:xlink="http://www.w3.org/1999/xlink"' : ""} width="${doc.width}" height="${doc.height}" viewBox="0 0 ${doc.width} ${doc.height}"><metadata>Luma vector delivery: sRGB solid paths, groups and masks; no print-profile conversion.</metadata>${definitions.length ? `<defs>${definitions.join("")}</defs>` : ""}${elements}</svg>`;
}
