import type { TextStyle } from "./document";
import { OUTLINE_LIMITS, validateOutlineText, outlineRunSegments, type OutlineCommand, type ShapedOutlines } from "./text-outline-model";
import { bidiParagraph, physicalTextAlignment, visualTextRuns } from "./text-bidi";

type Segment = { direction: "ltr" | "rtl"; script: string; context: string; start: number; end: number };
type FontSession = { faces: Map<string, import("harfbuzzjs").Face>; fonts: Map<string, import("harfbuzzjs").Font> };

/** Called in a disposable worker in production. Never holds a process-wide WASM heap. */
export async function shapeTextOutlines(text: TextStyle, fonts: ArrayBuffer | ReadonlyMap<string, ArrayBuffer>, allowWhitespace = false, segment?: Segment, session: FontSession = { faces: new Map(), fonts: new Map() }): Promise<ShapedOutlines> {
  const { style, selected } = validateOutlineText(text, allowWhitespace);
  if (!segment && (text.runs?.length || text.direction === "rtl" || /[^\u0000-\u058f]/u.test(text.text))) return shapeMixedText(text, fonts, session);
  const bytes = fonts instanceof ArrayBuffer ? fonts : fonts.get(selected.file);
  if (!bytes) throw new Error(`Missing bundled outline face: ${selected.file}`);
  if (bytes.byteLength < 12 || bytes.byteLength > OUTLINE_LIMITS.fontBytes) throw new Error("Font exceeds the outline memory budget or is truncated.");
  const hb = await import("harfbuzzjs");
  let face = session.faces.get(selected.file);
  if (!face) { face = new hb.Face(new hb.Blob(bytes), 0); session.faces.set(selected.file, face); }
  if (!face.upem || !face.referenceTable("head") || !face.referenceTable("cmap")) throw new Error("Invalid outline font.");
  const variations = Object.entries({ ...(selected.face === "Variable" ? { wght: selected.weight } : {}), ...style.axes }).sort(([a], [b]) => a.localeCompare(b));
  const fontKey = `${selected.file}:${JSON.stringify(variations)}`;
  let font = session.fonts.get(fontKey);
  if (!font) {
    font = new hb.Font(face); font.setScale(face.upem, face.upem);
    font.setVariations(variations.map(([tag, value]) => new hb.Variation(tag, value))); session.fonts.set(fontKey, font);
  }
  const features = Object.entries(style.features).map(([tag, value]) => new hb.Feature(tag, Number(value)));
  const result: ShapedOutlines = { paths: [], glyphs: [], lineWidths: [], fontFile: selected.file };
  const scale = style.fontSize / face.upem, stretch = style.fontStretch / 100;
  const shear = style.fontStyle !== "normal" && !selected.italic ? 0.2 : 0;
  let commands = 0;
  const shapeLine = (line: string) => {
    const buffer = new hb.Buffer();
    if (segment) buffer.addText(segment.context, segment.start, segment.end - segment.start);
    else buffer.addText(line);
    buffer.guessSegmentProperties(); buffer.setDirection(segment?.direction === "rtl" ? hb.Direction.RTL : hb.Direction.LTR);
    if (segment) buffer.setScript(segment.script);
    if (text.language) buffer.setLanguage(text.language);
    hb.shape(font, buffer, features);
    const glyphs = buffer.getGlyphInfosAndPositions().map(glyph => ({ ...glyph, cluster: glyph.cluster - (segment?.start ?? 0) }));
    if (glyphs.length > OUTLINE_LIMITS.characters * 8) throw new Error("Shaped glyph budget exceeded.");
    const advances = glyphs.map((g, i) => (g.xAdvance ?? 0) * scale + (i + 1 < glyphs.length && g.cluster !== glyphs[i + 1].cluster ? style.tracking / 1000 * style.fontSize : 0));
    return { glyphs, advances, width: advances.reduce((sum, value) => sum + value, 0) };
  };
  const lines: { value: string; paragraphEnd: boolean }[] = [];
  for (const paragraph of text.text.split("\n")) {
    if (text.layout !== "paragraph") { lines.push({ value: paragraph, paragraphEnd: true }); continue; }
    // Wrap at whitespace, never split a shaping cluster or silently shrink an overlong word.
    let current = "";
    for (const word of paragraph.split(/(?<= )/u)) {
      const candidate = current + word;
      if (shapeLine(candidate.replace(/ +$/, "")).width * stretch > text.boxWidth! && current.replace(/ +$/, "")) {
        lines.push({ value: current.replace(/ +$/, ""), paragraphEnd: false }); current = word.replace(/^ +/, "");
      } else current = candidate;
      if (shapeLine(current.replace(/ +$/, "")).width * stretch > text.boxWidth!) throw new Error("A word exceeds the paragraph frame. Widen the frame before outlining.");
    }
    lines.push({ value: current.replace(/ +$/, ""), paragraphEnd: true });
  }
  let baseline = -style.baselineShift;
  for (const [lineIndex, entry] of lines.entries()) {
    const { glyphs, advances, width } = shapeLine(entry.value);
    if (text.layout === "paragraph" && baseline + style.fontSize > text.boxHeight!) throw new Error("Paragraph text overflows its frame. Enlarge the frame before outlining.");
    const frameWidth = text.layout === "paragraph" ? text.boxWidth! / stretch : 0;
    const spaces = new Set<number>();
    for (let i = 0; i < entry.value.length; i++) if (entry.value[i] === " ") spaces.add(i);
    const gaps = glyphs.filter(g => spaces.has(g.cluster)).length;
    const justified = text.layout === "paragraph" && text.justify && !entry.paragraphEnd;
    const extra = justified && gaps ? (frameWidth - width) / gaps : 0;
    result.lineWidths.push(width * stretch);
    // TextStyle.x is the alignment anchor in the existing canvas/document model,
    // not the left edge of a frame. Keep outlines anchored to that same point.
    let pen = justified ? 0 : text.align === "center" ? -width / 2 : ["right", "end"].includes(text.align) ? -width : 0;
    if (extra) { pen = 0; result.lineWidths[lineIndex] = text.boxWidth!; }
    for (const [index, glyph] of glyphs.entries()) {
      if (!glyph.codepoint) throw new Error("The bundled font has no outline for part of this text. Choose another font.");
      result.glyphs.push(glyph.codepoint);
      const path: OutlineCommand[] = [];
      for (const command of font.glyphToJson(glyph.codepoint)) {
        if (++commands > OUTLINE_LIMITS.commands) throw new Error("Letter outlines exceed the complexity budget.");
        const values = command.values;
        const point = (i: number) => {
          const y = -(values[i + 1] + (glyph.yOffset ?? 0)) * scale;
          return { x: (pen + (values[i] + (glyph.xOffset ?? 0)) * scale - y * shear) * stretch, y: baseline + y };
        };
        if (command.type === "M" || command.type === "L") path.push({ type: command.type, ...point(0) });
        else if (command.type === "Q") { const p = point(0); path.push({ type: "Q", x1: p.x, y1: p.y, ...point(2) }); }
        else if (command.type === "C") { const p = point(0), q = point(2); path.push({ type: "C", x1: p.x, y1: p.y, x2: q.x, y2: q.y, ...point(4) }); }
        else if (command.type === "Z") path.push({ type: "Z" });
        else throw new Error("Unsupported glyph outline command.");
      }
      result.paths.push({ commands: path }); pen += advances[index] + (spaces.has(glyph.cluster) ? extra : 0);
    }
    baseline += style.fontSize * (text.lineHeight + (entry.paragraphEnd ? text.paragraphSpacing ?? 0 : 0));
  }
  return result;
}

async function shapeMixedText(text: TextStyle, fonts: ArrayBuffer | ReadonlyMap<string, ArrayBuffer>, session: FontSession): Promise<ShapedOutlines> {
  const { selected, style } = validateOutlineText(text);
  const runs = outlineRunSegments(text);
  if (fonts instanceof ArrayBuffer && runs.some(run => run.selected.file !== selected.file)) throw new Error("Mixed-font outlining requires the complete font resource map.");
  if (text.layout === "paragraph" && text.justify) throw new Error("Bidirectional/complex-script paragraph outlines currently require non-justified alignment.");
  const result: ShapedOutlines = { paths: [], glyphs: [], lineWidths: [], fontFile: selected.file };
  const embedding = bidiParagraph(text.text, text.direction);
  // Only a bounded 160-character story is admitted. Reuse shaped candidate lines
  // during wrapping rather than rebuilding the same font/glyph data twice.
  const cache = new Map<string, { paths: ShapedOutlines["paths"]; glyphs: number[]; width: number; largest: number; base: number }>();
  const compose = async (start: number, end: number) => {
    const key = `${start}:${end}`, cached = cache.get(key); if (cached) return cached;
    const { runs: fragments, base } = visualTextRuns(text, start, end, embedding);
    const paths: ShapedOutlines["paths"] = [], glyphs: number[] = [];
    let width = 0, largest = style.fontSize, count = 0;
    for (const [index, run] of fragments.entries()) {
      const fragment = await shapeTextOutlines({ ...text, text: text.text.slice(run.start, run.end), layout: "point", runs: undefined, defaultStyle: run.style, align: "left" }, fonts, true,
        { direction: run.level % 2 ? "rtl" : "ltr", script: run.script, context: text.text.slice(start, end), start: run.start - start, end: run.end - start }, session);
      for (const path of fragment.paths) {
        count += path.commands.length;
        if (count > OUTLINE_LIMITS.commands) throw new Error("Letter outlines exceed the complexity budget.");
        paths.push({ commands: path.commands.map(command => translateOutlineCommand(command, width, 0)) });
      }
      glyphs.push(...fragment.glyphs);
      if (glyphs.length > OUTLINE_LIMITS.characters * 8) throw new Error("Shaped glyph budget exceeded.");
      width += fragment.lineWidths[0] + (index < fragments.length - 1 ? run.style.tracking / 1000 * run.style.fontSize * run.style.fontStretch / 100 : 0);
      largest = Math.max(largest, run.style.fontSize);
    }
    const composed = { paths, glyphs, width, largest, base };
    // Do not retain every growing candidate of a long paragraph (quadratic size).
    if (cache.size >= 2) cache.delete(cache.keys().next().value!);
    cache.set(key, composed); return composed;
  };
  let offset = 0, baseline = 0, commands = 0;
  const lines: { start: number; end: number; paragraphEnd: boolean }[] = [];
  for (const paragraph of text.text.split("\n")) {
    if (text.layout !== "paragraph") lines.push({ start: offset, end: offset + paragraph.length, paragraphEnd: true });
    else {
      let start = offset, end = offset;
      for (const word of paragraph.split(/(?<= )/u)) {
        const candidateEnd = end + word.length;
        const trimmed = text.text.slice(start, candidateEnd).replace(/ +$/, "");
        if ((await compose(start, start + trimmed.length)).width > text.boxWidth! && end > start) {
          lines.push({ start, end: start + text.text.slice(start, end).trimEnd().length, paragraphEnd: false });
          start = end; while (text.text[start] === " " && start < candidateEnd) start++;
        }
        end = candidateEnd;
        if ((await compose(start, start + text.text.slice(start, end).trimEnd().length)).width > text.boxWidth!) throw new Error("A word exceeds the paragraph frame. Widen the frame before outlining.");
      }
      lines.push({ start, end: start + text.text.slice(start, end).trimEnd().length, paragraphEnd: true });
    }
    offset += paragraph.length + 1;
  }
  for (const line of lines) {
    const shaped = await compose(line.start, line.end);
    if (text.layout === "paragraph" && baseline - style.baselineShift + style.fontSize > text.boxHeight!) throw new Error("Paragraph text overflows its frame. Enlarge the frame before outlining.");
    const alignment = physicalTextAlignment(text.align, shaped.base);
    const align = alignment === "center" ? -shaped.width / 2 : alignment === "right" ? -shaped.width : 0;
    for (const path of shaped.paths) {
      commands += path.commands.length;
      if (commands > OUTLINE_LIMITS.commands) throw new Error("Letter outlines exceed the complexity budget.");
      result.paths.push({ commands: path.commands.map(command => translateOutlineCommand(command, align, baseline)) });
    }
    result.glyphs.push(...shaped.glyphs);
    if (result.glyphs.length > OUTLINE_LIMITS.characters * 8) throw new Error("Shaped glyph budget exceeded.");
    result.lineWidths.push(shaped.width);
    baseline += shaped.largest * (text.lineHeight + (line.paragraphEnd ? text.paragraphSpacing ?? 0 : 0));
  }
  return result;
}

function translateOutlineCommand(c: OutlineCommand, x: number, y: number): OutlineCommand {
  if (c.type === "Z") return c;
  if (c.type === "Q") return { ...c, x: c.x + x, y: c.y + y, x1: c.x1 + x, y1: c.y1 + y };
  if (c.type === "C") return { ...c, x: c.x + x, y: c.y + y, x1: c.x1 + x, y1: c.y1 + y, x2: c.x2 + x, y2: c.y2 + y };
  return { ...c, x: c.x + x, y: c.y + y };
}
