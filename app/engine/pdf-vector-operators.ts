import { parseEditableSvg, type ImportedSvg, type ImportedVector } from "./vector-svg-import";
type Matrix = [number, number, number, number, number, number];
type State = { matrix: Matrix; fill: string; stroke: string; width: number; cap: number; join: number; fillAlpha: number; strokeAlpha: number; clips: number[][] };
export type PdfObjectHooks = { operator: (name: string | undefined, args: unknown[], state: Readonly<State>) => boolean; path: (vector: ImportedVector) => void };
const multiply = (l: Matrix, r: Matrix): Matrix => [l[0]*r[0]+l[2]*r[1],l[1]*r[0]+l[3]*r[1],l[0]*r[2]+l[2]*r[3],l[1]*r[2]+l[3]*r[3],l[0]*r[4]+l[2]*r[5]+l[4],l[1]*r[4]+l[3]*r[5]+l[5]];
const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= 1_000_000;

/** Deliberately strict: unsupported paint never disappears from an editable import. */
export function pdfVectorOperators(list: { fnArray: number[]; argsArray: unknown[][] }, viewport: { width: number; height: number; transform: number[] }, ops: Record<string, number>, hooks?: PdfObjectHooks): ImportedSvg {
  if (list.fnArray.length > 50000 || list.fnArray.length !== list.argsArray.length) throw new Error("PDF exceeds the 50,000-operation import budget.");
  if (![viewport.width, viewport.height, ...viewport.transform].every(finite) || viewport.width <= 0 || viewport.height <= 0) throw new Error("Invalid PDF page dimensions.");
  let state: State = { matrix: viewport.transform as Matrix, fill: "#000000", stroke: "#000000", width: 1, cap: 0, join: 0, fillAlpha: 1, strokeAlpha: 1, clips: [] };
  const stack: { state: State; kind: string }[] = [], paths: string[] = [];
  const names = new Map(Object.entries(ops).map(([name, id]) => [id, name]));
  let total = 0;
  const save = (kind: string) => { if (stack.length >= 32) throw new Error("PDF graphics-state nesting exceeds 32."); stack.push({ state: structuredClone(state), kind }); };
  const restore = (kind: string) => { const previous = stack.pop(); if (!previous || previous.kind !== kind) throw new Error("Unbalanced PDF graphics state."); state = previous.state; };
  const matrix = (value: unknown) => { if (value instanceof Float32Array || value instanceof Float64Array) value = Array.from(value); if (!Array.isArray(value) || value.length !== 6 || !value.every(finite)) throw new Error("Invalid PDF transform."); state.matrix = multiply(state.matrix, value as Matrix); if (!state.matrix.every(finite)) throw new Error("PDF transform exceeds coordinate limits."); };
  const addClip = (bbox: unknown) => {
    if (bbox == null) return;
    if (bbox instanceof Float32Array || bbox instanceof Float64Array) bbox = Array.from(bbox);
    if (!Array.isArray(bbox) || bbox.length !== 4 || !bbox.every(finite)) throw new Error("Invalid PDF form bounds.");
    // Retain inverse matrix so arbitrary rotated form boxes are not approximated by AABBs.
    state.clips.push([...bbox, ...state.matrix]);
  };
  const alpha = (value: unknown) => { if (!finite(value) || value < 0 || value > 1) throw new Error("Invalid PDF opacity."); return value; };
  for (let index = 0; index < list.fnArray.length; index++) {
    const name = names.get(list.fnArray[index]), a = list.argsArray[index] ?? [];
    if (hooks?.operator(name, a, state)) continue;
    switch (name) {
      case "save": save("save"); break;
      case "restore": restore("save"); break;
      case "transform": matrix(a); break;
      case "setFillRGBColor": case "setStrokeRGBColor": {
        // PDF.js 6 normalizes color spaces into CSS hex before this boundary.
        if (a.length !== 1 || typeof a[0] !== "string" || !/^#[0-9a-f]{6}$/i.test(a[0])) throw new Error("Unsupported PDF color representation.");
        state[name === "setFillRGBColor" ? "fill" : "stroke"] = a[0]; break;
      }
      case "setLineWidth": if (!finite(a[0]) || a[0] < 0) throw new Error("Invalid PDF stroke width."); state.width = a[0]; break;
      case "setLineCap": case "setLineJoin": if (![0, 1, 2].includes(Number(a[0]))) throw new Error("Invalid PDF line style."); state[name === "setLineCap" ? "cap" : "join"] = Number(a[0]); break;
      case "setMiterLimit": case "setFlatness": case "setRenderingIntent": break;
      case "setDash": if (!Array.isArray(a[0]) || a[0].length) throw new Error("Dashed PDF strokes are not yet editable."); break;
      case "setGState": {
        if (!Array.isArray(a[0])) throw new Error("Invalid PDF graphics state.");
        for (const [key, value] of a[0] as [string, unknown][]) {
          if (key === "ca") state.fillAlpha = alpha(value);
          else if (key === "CA") state.strokeAlpha = alpha(value);
          else if (key === "BM" && value === "source-over" || key === "SMask" && !value || key === "TR" && !value) continue;
          else throw new Error(`PDF graphics state ${key} is not supported for editable import.`);
        }
        break;
      }
      case "paintFormXObjectBegin": save("form"); if (a[0]) matrix(a[0]); addClip(a[1]); break;
      case "paintFormXObjectEnd": restore("form"); break;
      case "beginGroup": {
        const g = a[0] as { matrix?: number[]; bbox?: number[]; knockout?: boolean; smask?: unknown; hasSoftMask?: boolean; isGray?: boolean };
        if (!g || g.knockout || g.smask || g.hasSoftMask || g.isGray || state.fillAlpha !== 1 || state.strokeAlpha !== 1) throw new Error("PDF transparency groups require raster import; group opacity is not flattened silently.");
        // Group matrix positions the clip; the following form-begin applies it to content.
        save("group"); { const before = state.matrix; if (g.matrix) matrix(g.matrix); addClip(g.bbox); state.matrix = before; } break;
      }
      case "endGroup": restore("group"); break;
      case "constructPath": {
        const operation = names.get(Number(a[0]));
        if (!["fill", "eoFill", "stroke", "closeStroke", "fillStroke", "eoFillStroke", "closeFillStroke", "closeEOFillStroke", "endPath"].includes(operation ?? "")) throw new Error("PDF clipping paths are not yet editable.");
        if (operation === "endPath") break;
        const data = (a[1] as ArrayLike<ArrayLike<number>>)?.[0];
        if (!data || data.length > 140000) throw new Error("PDF path exceeds the geometry budget.");
        let d = "", offset = 0;
        while (offset < data.length) {
          const op = data[offset++], length = op === 0 || op === 1 ? 2 : op === 2 ? 6 : op === 3 ? 4 : op === 4 ? 0 : -1;
          if (length < 0 || offset + length > data.length || ++total > 20000) throw new Error("Invalid or oversized PDF path.");
          const p = Array.from({ length }, (_, i) => data[offset + i]); offset += length;
          if (!p.every(finite)) throw new Error("Invalid PDF path coordinates.");
          const drawsStroke = /stroke/i.test(operation!);
          if (drawsStroke && (state.cap !== 1 || state.join !== 1 || !state.width)) throw new Error("Editable PDF strokes currently require round caps/joins and a positive width.");
          // A curve's control hull bounds its geometry. Reject clipped content instead of losing its clip.
          for (let i = 0; i < p.length; i += 2) for (const clip of state.clips) {
            const m = state.matrix, worldX = m[0]*p[i]+m[2]*p[i+1]+m[4], worldY = m[1]*p[i]+m[3]*p[i+1]+m[5];
            const [x0,y0,x1,y1,ca,cb,cc,cd,ce,cf] = clip, determinant = ca*cd-cb*cc;
            const x = (cd*(worldX-ce)-cc*(worldY-cf))/determinant, y = (-cb*(worldX-ce)+ca*(worldY-cf))/determinant;
            // Frobenius norms bound forward and inverse magnification even under shear.
            const margin = drawsStroke ? state.width * Math.hypot(m[0],m[1],m[2],m[3]) * Math.hypot(ca,cb,cc,cd) / Math.abs(determinant) : 0;
            if (!Number.isFinite(x) || !Number.isFinite(y) || x-margin < x0-1e-4 || x+margin > x1+1e-4 || y-margin < y0-1e-4 || y+margin > y1+1e-4) throw new Error("PDF content crosses a form clip; this file cannot yet be imported editably.");
          }
          d += `${["M","L","C","Q","Z"][op]}${p.join(" ")} `;
        }
        if (/^close/.test(operation!)) d += "Z";
        const hasFill = /fill/i.test(operation!), hasStroke = /stroke/i.test(operation!);
        paths.push(`<path d="${d}" transform="matrix(${state.matrix.join(" ")})" fill="${hasFill ? state.fill : "none"}" stroke="${hasStroke ? state.stroke : "none"}" stroke-width="${state.width}" fill-opacity="${state.fillAlpha}" stroke-opacity="${state.strokeAlpha}" fill-rule="${/eo/i.test(operation!) ? "evenodd" : "nonzero"}" stroke-linecap="round" stroke-linejoin="round"/>`);
        if (hooks) {
          const converted = parseEditableSvg(`<svg xmlns="http://www.w3.org/2000/svg" width="${viewport.width}" height="${viewport.height}">${paths.at(-1)}</svg>`);
          // SVG import returns top-first; individual PDF paint operations arrive bottom-first.
          for (const vector of [...converted.layers].reverse()) {
            if (vector.kind === "group") throw new Error("Unexpected group in a PDF paint operation");
            hooks.path(vector);
          }
        }
        if (paths.length > 512) throw new Error("PDF exceeds the 512 editable-path limit.");
        break;
      }
      default: throw new Error(`PDF operation ${name ?? list.fnArray[index]} is not yet supported for editable import. Text, images, patterns, annotations and clipping are never silently dropped.`);
    }
  }
  if (stack.length) throw new Error("Unbalanced PDF graphics state.");
  if (hooks) return { width: viewport.width, height: viewport.height, layers: [] };
  return parseEditableSvg(`<svg xmlns="http://www.w3.org/2000/svg" width="${viewport.width}" height="${viewport.height}">${paths.join("")}</svg>`);
}
