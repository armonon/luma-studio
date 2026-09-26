import bidiFactory from "bidi-js";
import type { TextStyle } from "./document";
import { outlineRunSegments } from "./text-outline-model";

// bidi-js 1.1.0 implements UAX #9 / Unicode 13. HarfBuzz handles glyph mirroring
// and cluster ordering inside each logical run; never reverse the source string.
const bidi = bidiFactory();
const scripts: [RegExp, string][] = [
  [/\p{Script=Arabic}/u, "Arab"], [/\p{Script=Hebrew}/u, "Hebr"],
  [/\p{Script=Devanagari}/u, "Deva"], [/\p{Script=Latin}/u, "Latn"],
  [/\p{Script=Greek}/u, "Grek"], [/\p{Script=Cyrillic}/u, "Cyrl"],
];

export function bidiParagraph(text: string, direction: TextStyle["direction"]) {
  return bidi.getEmbeddingLevels(text, direction === "rtl" || direction === "ltr" ? direction : "auto");
}

/** Shared by Canvas and outline delivery; wrapped numeric lines retain their
 * parent paragraph's direction and trailing spaces obey the UAX L1 reset. */
export function bidiLineOrder(text: Pick<TextStyle, "text" | "direction">, start: number, end: number, embedding = bidiParagraph(text.text, text.direction)) {
  const paragraph = embedding.paragraphs.find(p => p.start <= start && p.end >= start);
  const base = paragraph?.level ?? (text.direction === "rtl" ? 1 : 0);
  const value = text.text.slice(start, end), levels = embedding.levels.slice(start, end);
  // Use line-local indices, including the UAX L1 trailing-space reset. This also
  // avoids bidi-js's partial-range trailing-whitespace indexing issue.
  for (let i = value.length - 1; i >= 0 && /\s/u.test(value[i]); i--) levels[i] = base;
  const order = bidi.getReorderedIndices(value, { levels, paragraphs: [{ start: 0, end: value.length - 1, level: base }] });
  return { base, levels, order };
}

export function physicalTextAlignment(align: TextStyle["align"], base: number): "left" | "right" | "center" {
  if (align === "center" || align === "left" || align === "right") return align;
  return (align === "start" ? base % 2 === 1 : base % 2 === 0) ? "right" : "left";
}

/** Resolve a line using its paragraph's levels, not a fresh paragraph direction. */
export function visualTextRuns(text: TextStyle, start: number, end: number, embedding = bidiParagraph(text.text, text.direction)) {
  const { base, levels, order } = bidiLineOrder(text, start, end, embedding);
  const value = text.text.slice(start, end);
  const ranks = new Map(order.map((logical, visual) => [logical, visual]));
  const styles = outlineRunSegments(text);
  const parts = Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value), part => {
    const from = start + part.index;
    return { start: from, end: from + part.segment.length, level: levels[part.index] ?? base,
      script: scripts.find(([pattern]) => pattern.test(part.segment))?.[1] ?? "",
      run: styles.findIndex(run => run.start <= from && run.end > from), rank: ranks.get(part.index) ?? part.index };
  });
  // Common/Inherited characters take the adjacent script at the same level.
  // Grapheme boundaries keep Indic syllables and combining marks intact.
  for (let i = 0; i < parts.length; i++) if (!parts[i].script) {
    const previous = parts[i - 1], next = parts.slice(i + 1).find(part => part.script && part.level === parts[i].level);
    parts[i].script = previous?.level === parts[i].level ? previous.script : next?.script ?? "Zyyy";
  }
  const logical: typeof parts = [];
  for (const part of parts) {
    const previous = logical.at(-1);
    if (previous && previous.end === part.start && previous.level === part.level && previous.script === part.script && previous.run === part.run) {
      previous.end = part.end; previous.rank = Math.min(previous.rank, part.rank);
    } else logical.push({ ...part });
  }
  return { base, runs: logical.sort((a, b) => a.rank - b.rank).map(part => ({ ...part, style: styles[part.run].style })) };
}
