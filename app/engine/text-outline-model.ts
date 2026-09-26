import type { PathAnchor, PathStyle, TextStyle } from "./document";
import { bundledFontFace } from "./bundled-fonts";
import { resolvedDefaultTextStyle, resolvedTextStyleAt } from "./text-model";
import { validateVectorPath, type PathContour } from "./vector-path";

export const OUTLINE_LIMITS = { characters: 160, commands: 12000, fontBytes: 2 * 1024 * 1024 } as const;
export type OutlineCommand = { type: "M" | "L"; x: number; y: number } | { type: "Q"; x: number; y: number; x1: number; y1: number } | { type: "C"; x: number; y: number; x1: number; y1: number; x2: number; y2: number } | { type: "Z" };
export type ShapedOutlines = { paths: { commands: OutlineCommand[] }[]; glyphs: number[]; lineWidths: number[]; fontFile: string };

/** Bounded lettering with explicit font coverage and paragraph frames. */
export function validateOutlineText(text: TextStyle, allowWhitespace = false): { style: ReturnType<typeof resolvedDefaultTextStyle>; selected: ReturnType<typeof bundledFontFace> } {
  if (!text.text.trim() && !allowWhitespace) throw new Error("Enter some text first.");
  if (text.text.length > OUTLINE_LIMITS.characters) throw new Error("Outlined lettering supports up to 160 characters per object. Split longer text into layers.");
  if (text.layout && !["point", "paragraph"].includes(text.layout)) throw new Error("Outlined lettering supports Point or Paragraph text; vertical and path layouts stay in the 2D editor.");
  if (text.layout === "paragraph" && (!Number.isFinite(text.boxWidth) || text.boxWidth! < 1 || text.boxWidth! > 100000 || !Number.isFinite(text.boxHeight) || text.boxHeight! < 1 || text.boxHeight! > 100000)) throw new Error("Paragraph outlines need a finite frame width and height.");
  if (text.layout === "paragraph" && text.frameOrigin === "top") throw new Error("Imported paragraph first-baseline metrics are not yet qualified for outlines. Keep the editable text or export a rendered copy.");
  if (text.paragraphs?.length) throw new Error("Outlined lettering requires one paragraph style. Separate paragraph overrides into text layers.");
  if (text.runs?.length) {
    if (text.layout === "paragraph") throw new Error("Mixed-style outlines currently require Point text. Single-style paragraph frames remain supported.");
    outlineRunSegments(text);
  }
  if (/[\u202a-\u202e\u2066-\u2069]/u.test(text.text)) throw new Error("Explicit Bidi embedding/isolate controls are not supported in outlined lettering. Use paragraph direction instead.");
  if (/[\u0000-\u0009\u000b-\u001f\u007f]/u.test(text.text)) throw new Error("Tabs and control characters are not supported in outlined lettering.");
  const style = resolvedDefaultTextStyle(text);
  if (![style.fontSize, style.fontStretch, style.tracking, style.baselineShift, text.lineHeight, text.paragraphSpacing ?? 0, text.x, text.y].every(Number.isFinite)
    || style.fontSize < 1 || style.fontSize > 2000 || style.fontStretch < 50 || style.fontStretch > 200
    || style.tracking < -1000 || style.tracking > 5000 || text.lineHeight < 0.1 || text.lineHeight > 10
    || (text.paragraphSpacing ?? 0) < 0 || (text.paragraphSpacing ?? 0) > 10) throw new Error("Text dimensions exceed the supported lettering limits.");
  for (const [tag, value] of Object.entries(style.features)) if (!/^[a-zA-Z0-9]{4}$/.test(tag) || typeof value !== "boolean") throw new Error("Invalid OpenType feature setting.");
  for (const [tag, value] of Object.entries(style.axes)) if (!/^[a-zA-Z0-9]{4}$/.test(tag) || !Number.isFinite(value)) throw new Error("Invalid font variation setting.");
  return { style, selected: bundledFontFace(style.fontFamily, style.fontWeight, style.fontStyle !== "normal") };
}

/** Style changes may not split a grapheme; ranges must already be normalized. */
export function outlineRunSegments(text: TextStyle) {
  const base = resolvedDefaultTextStyle(text);
  const graphemes = new Set([0, text.text.length, ...Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text.text), part => part.index)]);
  const boundaries = new Set([0, text.text.length]); let previousEnd = 0;
  if ((text.runs?.length ?? 0) > 32) throw new Error("Outlined lettering supports up to 32 character style runs.");
  for (const run of text.runs ?? []) {
    if (!Number.isInteger(run.start) || !Number.isInteger(run.end) || run.start < previousEnd || run.end <= run.start || !graphemes.has(run.start) || !graphemes.has(run.end)) throw new Error("Outline style ranges must be ordered and must not split a grapheme.");
    previousEnd = run.end; boundaries.add(run.start); boundaries.add(run.end);
  }
  const offsets = [...boundaries].sort((a, b) => a - b);
  const result = offsets.slice(0, -1).map((start, index) => {
    const style = resolvedTextStyleAt(text, start);
    if (style.color !== base.color || style.decoration !== base.decoration) throw new Error("Mixed-color/decorated outlines require separate layers; paint is never flattened silently.");
    const selected = validateOutlineText({ ...text, runs: undefined, defaultStyle: style }, true).selected;
    return { start, end: offsets[index + 1], style, selected };
  });
  if (new Set([bundledFontFace(base.fontFamily, base.fontWeight, base.fontStyle !== "normal").file, ...result.map(run => run.selected.file)]).size > 4) throw new Error("Outlined lettering supports at most four bundled font faces per object.");
  return result;
}

/** Quadratics become exact cubics; counter winding and glyph placement survive. */
export function outlinedVectorPath(text: TextStyle, shaped: ShapedOutlines): PathStyle {
  const { style } = validateOutlineText(text);
  if (text.appearance || style.decoration !== "none") throw new Error("Remove text appearance stacks and decorations before outlining; they are not flattened silently.");
  const contours: PathContour[] = [];
  let contour: PathContour | undefined;
  const anchor = (x: number, y: number): PathAnchor => ({ x: x + text.x, y: y + text.y, hIn: { dx: 0, dy: 0 }, hOut: { dx: 0, dy: 0 } });
  for (const path of shaped.paths) for (const command of path.commands) {
    if (command.type === "M") { contour = { anchors: [anchor(command.x, command.y)], closed: false }; contours.push(contour); continue; }
    if (!contour) throw new Error("Invalid glyph contour.");
    const previous = contour.anchors.at(-1)!;
    if (command.type === "Z") {
      const first = contour.anchors[0];
      if (contour.anchors.length > 1 && previous.x === first.x && previous.y === first.y) { first.hIn = previous.hIn; contour.anchors.pop(); }
      contour.closed = true; contour = undefined; continue;
    }
    const next = anchor(command.x, command.y);
    if (command.type === "C") {
      previous.hOut = { dx: command.x1 + text.x - previous.x, dy: command.y1 + text.y - previous.y };
      next.hIn = { dx: command.x2 - command.x, dy: command.y2 - command.y };
    } else if (command.type === "Q") {
      previous.hOut = { dx: (command.x1 + text.x - previous.x) * 2 / 3, dy: (command.y1 + text.y - previous.y) * 2 / 3 };
      next.hIn = { dx: (command.x1 - command.x) * 2 / 3, dy: (command.y1 - command.y) * 2 / 3 };
    }
    contour.anchors.push(next);
  }
  if (!contours.length) throw new Error("The text has no visible outlines.");
  const result: PathStyle = { ...contours[0], contours: contours.slice(1), fill: style.color, stroke: "none", strokeWidth: 0, fillRule: "nonzero" };
  validateVectorPath(result);
  return result;
}
