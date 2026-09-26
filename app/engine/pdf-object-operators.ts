import type { TextStyle, Transform } from "./document";
import { bundledFontFace } from "./bundled-fonts";
import { pdfVectorOperators, type PdfObjectHooks } from "./pdf-vector-operators";
import { layerTransform, type ImportedVector } from "./vector-svg-import";

type Matrix = [number, number, number, number, number, number];
export type PdfObject = { kind: "path"; vector: ImportedVector } | { kind: "text"; text: TextStyle; transform: Transform; opacity: number } |
  { kind: "image"; id: string; transform: Transform; opacity: number; width: number; height: number; canvas?: HTMLCanvasElement };
export type PdfObjects = { width: number; height: number; layers: PdfObject[]; fontFamily: string };
const identity = (): Matrix => [1, 0, 0, 1, 0, 0];
const mul = (a: Matrix, b: Matrix): Matrix => [a[0]*b[0]+a[2]*b[1], a[1]*b[0]+a[3]*b[1], a[0]*b[2]+a[2]*b[3], a[1]*b[2]+a[3]*b[3], a[0]*b[4]+a[2]*b[5]+a[4], a[1]*b[4]+a[3]*b[5]+a[5]];
const number = (n: unknown) => { if (typeof n !== "number" || !Number.isFinite(n) || Math.abs(n) > 1000000) throw new Error("Invalid PDF text/image numeric value."); return n; };

/** Explicit font-mapped reconstruction, not a claim of embedded-font fidelity. */
export function pdfObjectOperators(list: Parameters<typeof pdfVectorOperators>[0], viewport: Parameters<typeof pdfVectorOperators>[1], ops: Record<string, number>, family: string, fonts: Map<string, { vertical?: boolean; fontMatrix?: number[] }>): PdfObjects {
  bundledFontFace(family);
  const layers: PdfObject[] = []; let characters = 0, imagePixels = 0;
  let text = { matrix: identity(), x: 0, y: 0, lineX: 0, lineY: 0, font: "", size: 12, leading: 0, spacing: 0, word: 0, scale: 1, rise: 0, mode: 0 };
  const stack: typeof text[] = []; let inText = false;
  const add = (object: PdfObject) => { if (layers.length >= 512) throw new Error("PDF exceeds 512 editable objects."); layers.push(object); };
  const move = (x: number, y: number) => { text.lineX += x; text.lineY += y; text.x = text.lineX; text.y = text.lineY; };
  const hooks: PdfObjectHooks = {
    path: vector => add({ kind: "path", vector }),
    operator: (name, args, state) => {
      switch (name) {
        case "save": case "paintFormXObjectBegin": case "beginGroup": stack.push(structuredClone(text)); return false;
        case "restore": case "paintFormXObjectEnd": case "endGroup": text = stack.pop() ?? text; return false;
        case "dependency": return true;
        case "beginText": if (inText) throw new Error("Nested PDF text objects are unsupported."); inText = true; text = { ...text, matrix: identity(), x: 0, y: 0, lineX: 0, lineY: 0 }; return true;
        case "endText": if (!inText) throw new Error("Unbalanced PDF text object."); inText = false; return true;
        case "setFont": {
          if (typeof args[0] !== "string") throw new Error("Invalid PDF font reference.");
          const font = fonts.get(args[0]); if (!font || font.vertical || font.fontMatrix && (font.fontMatrix.length !== 6 || Math.abs(font.fontMatrix[0] - 0.001) > 1e-8 || Math.abs(font.fontMatrix[3] - 0.001) > 1e-8 || font.fontMatrix.some((n, i) => ![0, 3].includes(i) && n !== 0))) throw new Error("Vertical or custom-matrix PDF fonts need rendered-page import.");
          text.font = args[0]; text.size = number(args[1]); if (text.size < 1 || text.size > 2000) throw new Error("PDF text size exceeds editing limits."); return true;
        }
        case "setTextMatrix": {
          const value = Array.from(args.length === 1 && ArrayBuffer.isView(args[0]) ? args[0] as unknown as ArrayLike<number> : args.length === 1 && Array.isArray(args[0]) ? args[0] : args);
          if (value.length !== 6) throw new Error("Invalid PDF text matrix."); text.matrix = value.map(number) as Matrix; text.x = text.y = text.lineX = text.lineY = 0; return true;
        }
        case "setLeading": text.leading = number(args[0]); return true;
        case "setCharSpacing": text.spacing = number(args[0]); return true;
        case "setWordSpacing": text.word = number(args[0]); return true;
        case "setHScale": text.scale = number(args[0]) / 100; if (text.scale <= 0) throw new Error("Negative PDF text scaling is unsupported."); return true;
        case "setTextRise": text.rise = number(args[0]); return true;
        case "setTextRenderingMode": text.mode = number(args[0]); if (text.mode !== 0) throw new Error("Stroked, clipped or invisible PDF text needs rendered-page import."); return true;
        case "moveText": move(number(args[0]), number(args[1])); return true;
        case "setLeadingMoveText": text.leading = -number(args[1]); move(number(args[0]), number(args[1])); return true;
        case "nextLine": move(0, -text.leading); return true;
        case "showText": {
          if (!inText || !text.font || state.clips.length || !Array.isArray(args[0])) throw new Error("Clipped or malformed PDF text needs rendered-page import.");
          let value = "", advance = 0;
          for (const glyph of args[0]) {
            if (typeof glyph === "number") { advance -= number(glyph) * text.size / 1000; continue; }
            if (!glyph || typeof glyph.unicode !== "string" || !glyph.unicode || /[\u0000-\u001f\ufffd]/u.test(glyph.unicode)) throw new Error("PDF text has no dependable Unicode mapping; choose rendered-page import.");
            value += glyph.unicode; advance += number(glyph.width) * text.size / 1000 + text.spacing + (glyph.isSpace ? text.word : 0);
          }
          characters += value.length; if (characters > 10000 || value.length > 2000) throw new Error("PDF editable text exceeds the 10,000-character / 2,000-character object budget.");
          if (value) {
            const transform = layerTransform(mul(state.matrix, mul(text.matrix, [text.scale, 0, 0, -1, text.x, text.y + text.rise])));
            add({ kind: "text", text: { text: value, font: `400 ${text.size}px "${family}"`, color: state.fill, x: 0, y: 0, align: "left", lineHeight: 1.2, direction: "auto", layout: "point", tracking: text.spacing / text.size * 1000 }, transform, opacity: state.fillAlpha });
          }
          text.x += advance * text.scale; return true;
        }
        case "paintImageXObject": {
          if (state.clips.length || typeof args[0] !== "string") throw new Error("Clipped PDF images need rendered-page import.");
          const width = number(args[1]), height = number(args[2]); imagePixels += width * height;
          if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 8192 || height > 8192 || width * height > 4_000_000 || imagePixels > 16_000_000) throw new Error("PDF images exceed the 4 MP per-image / 16 MP total budget.");
          add({ kind: "image", id: args[0], width, height, transform: layerTransform(mul(state.matrix, [1 / width, 0, 0, -1 / height, 0, 1])), opacity: state.fillAlpha }); return true;
        }
        default: return false;
      }
    },
  };
  pdfVectorOperators(list, viewport, ops, hooks);
  if (inText || stack.length || !layers.length) throw new Error("Unbalanced or empty PDF objects.");
  return { width: viewport.width, height: viewport.height, layers: layers.reverse(), fontFamily: family };
}
