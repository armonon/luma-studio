import type { TextRun, TextRunStyle, TextStyle } from "./document";

export const TEXT_SCHEMA_VERSION = 2 as const;

export const DEFAULT_TEXT_RUN_STYLE: Readonly<Required<Pick<TextRunStyle,
  "fontFamily" | "fontSize" | "fontWeight" | "fontStyle" | "fontStretch" |
  "color" | "tracking" | "baselineShift" | "decoration"
>>> = Object.freeze({
  fontFamily: "Inter, system-ui, sans-serif",
  fontSize: 96,
  fontWeight: 700,
  fontStyle: "normal",
  fontStretch: 100,
  color: "#ffffff",
  tracking: 0,
  baselineShift: 0,
  decoration: "none",
});

export type ResolvedTextRunStyle = typeof DEFAULT_TEXT_RUN_STYLE & {
  axes: Record<string, number>;
  features: Record<string, boolean>;
};

const weightName: Record<string, number> = {
  normal: 400,
  bold: 700,
  lighter: 300,
  bolder: 700,
};

export function parseLegacyCanvasFont(font: string) {
  const sizeMatch = font.match(/(\d+(?:\.\d+)?)px\s+(.+)$/i);
  const prefix = sizeMatch ? font.slice(0, sizeMatch.index).trim().split(/\s+/) : [];
  const weightToken = prefix.find((token) => /^(?:[1-9]00|normal|bold|lighter|bolder)$/i.test(token));
  return {
    fontFamily: sizeMatch?.[2]?.trim() || DEFAULT_TEXT_RUN_STYLE.fontFamily,
    fontSize: Number(sizeMatch?.[1] ?? DEFAULT_TEXT_RUN_STYLE.fontSize),
    fontWeight: weightToken ? Number(weightToken) || weightName[weightToken.toLowerCase()] || 400 : 400,
    fontStyle: prefix.some((token) => token === "italic") ? "italic" as const
      : prefix.some((token) => token === "oblique") ? "oblique" as const
        : "normal" as const,
  };
}

export function resolvedDefaultTextStyle(style: TextStyle): ResolvedTextRunStyle {
  const legacy = parseLegacyCanvasFont(style.font);
  return {
    ...DEFAULT_TEXT_RUN_STYLE,
    ...legacy,
    color: style.color || DEFAULT_TEXT_RUN_STYLE.color,
    tracking: style.tracking ?? DEFAULT_TEXT_RUN_STYLE.tracking,
    ...style.defaultStyle,
    axes: { ...(style.defaultStyle?.axes ?? {}) },
    features: { kern: true, liga: true, ...(style.defaultStyle?.features ?? {}) },
  };
}

export function canvasFontForRun(run: ResolvedTextRunStyle) {
  const style = run.fontStyle === "normal" ? "" : `${run.fontStyle} `;
  // Character width is a geometric scale shared with outlines and 3D, not
  // CSS font-stretch (which selects a face and may reject percentages).
  return `${style}${run.fontWeight} ${run.fontSize}px ${run.fontFamily}`;
}

export function resolvedTextStyleAt(style: TextStyle, offset: number): ResolvedTextRunStyle {
  const base = resolvedDefaultTextStyle(style);
  const run = style.runs?.find((candidate) => offset >= candidate.start && offset < candidate.end);
  if (!run) return base;
  return {
    ...base,
    ...run.style,
    axes: { ...base.axes, ...(run.style.axes ?? {}) },
    features: { ...base.features, ...(run.style.features ?? {}) },
  };
}

function cleanRun(run: TextRun, length: number): TextRun | null {
  const start = Math.max(0, Math.min(length, Math.trunc(run.start)));
  const end = Math.max(start, Math.min(length, Math.trunc(run.end)));
  return end > start ? { start, end, style: { ...run.style } } : null;
}

function sameStyle(a: TextRunStyle, b: TextRunStyle) {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function normalizeTextRuns(runs: ReadonlyArray<TextRun> | undefined, length: number) {
  const cleaned = (runs ?? []).map((run) => cleanRun(run, length)).filter((run): run is TextRun => Boolean(run));
  const boundaries = new Set<number>([0, length]);
  cleaned.forEach((run) => { boundaries.add(run.start); boundaries.add(run.end); });
  const points = [...boundaries].sort((a, b) => a - b);
  const normalized: TextRun[] = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    if (end <= start) continue;
    const style = cleaned.filter((run) => run.start <= start && run.end >= end)
      .reduce<TextRunStyle>((current, run) => ({ ...current, ...run.style }), {});
    if (Object.keys(style).length === 0) continue;
    const previous = normalized.at(-1);
    if (previous && previous.end === start && sameStyle(previous.style, style)) previous.end = end;
    else normalized.push({ start, end, style });
  }
  return normalized;
}

/** Apply a character style to a UTF-16 selection without flattening existing runs. */
export function applyTextRunStyle(
  textStyle: TextStyle,
  selectionStart: number,
  selectionEnd: number,
  patch: TextRunStyle,
): TextRun[] {
  const start = Math.max(0, Math.min(textStyle.text.length, Math.min(selectionStart, selectionEnd)));
  const end = Math.max(start, Math.min(textStyle.text.length, Math.max(selectionStart, selectionEnd)));
  if (end === start) return normalizeTextRuns(textStyle.runs, textStyle.text.length);
  const runs = normalizeTextRuns(textStyle.runs, textStyle.text.length);
  const boundaries = new Set<number>([0, textStyle.text.length, start, end]);
  runs.forEach((run) => { boundaries.add(run.start); boundaries.add(run.end); });
  const points = [...boundaries].sort((a, b) => a - b);
  const result: TextRun[] = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const rangeStart = points[index];
    const rangeEnd = points[index + 1];
    const existing = runs.find((run) => run.start <= rangeStart && run.end >= rangeEnd)?.style ?? {};
    const selected = rangeStart < end && rangeEnd > start;
    const next = selected ? { ...existing, ...patch } : existing;
    if (Object.keys(next).length === 0) continue;
    const previous = result.at(-1);
    if (previous && previous.end === rangeStart && sameStyle(previous.style, next)) previous.end = rangeEnd;
    else result.push({ start: rangeStart, end: rangeEnd, style: next });
  }
  return result;
}

/** Preserve styles before an edit and safely clamp styles after replaced text. */
export function textRunsAfterContentEdit(style: TextStyle, nextText: string) {
  if (!style.runs?.length || style.text === nextText) return normalizeTextRuns(style.runs, nextText.length);
  const previous = style.text;
  let prefix = 0;
  while (prefix < previous.length && prefix < nextText.length && previous[prefix] === nextText[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < previous.length - prefix
    && suffix < nextText.length - prefix
    && previous[previous.length - suffix - 1] === nextText[nextText.length - suffix - 1]
  ) suffix += 1;
  const removedEnd = previous.length - suffix;
  const insertedEnd = nextText.length - suffix;
  const delta = nextText.length - previous.length;
  const pureInsertion = removedEnd === prefix;
  const remapped = style.runs.map((run) => {
    const start = run.start < prefix || (!pureInsertion && run.start === prefix)
      ? run.start
      : run.start >= removedEnd ? run.start + delta : prefix;
    const end = run.end <= prefix ? run.end : run.end >= removedEnd ? run.end + delta : insertedEnd;
    return { ...run, start, end };
  });
  return normalizeTextRuns(remapped, nextText.length);
}

export function withDefaultTextStyle(style: TextStyle, patch: TextRunStyle): Partial<TextStyle> {
  const current = resolvedDefaultTextStyle(style);
  const next = { ...style.defaultStyle, ...patch };
  const font = canvasFontForRun({
    ...current,
    ...next,
    axes: { ...current.axes, ...(next.axes ?? {}) },
    features: { ...current.features, ...(next.features ?? {}) },
  });
  return {
    schemaVersion: TEXT_SCHEMA_VERSION,
    defaultStyle: next,
    font,
    color: next.color ?? style.color,
    tracking: next.tracking ?? style.tracking,
  };
}

export function cloneTextStyle(style: TextStyle): TextStyle {
  return {
    ...style,
    formOrigin: style.formOrigin ? { ...style.formOrigin } : undefined,
    path: style.path ? structuredClone(style.path) : undefined,
    defaultStyle: style.defaultStyle ? {
      ...style.defaultStyle,
      axes: style.defaultStyle.axes ? { ...style.defaultStyle.axes } : undefined,
      features: style.defaultStyle.features ? { ...style.defaultStyle.features } : undefined,
    } : undefined,
    runs: style.runs?.map((run) => ({
      ...run,
      style: {
        ...run.style,
        axes: run.style.axes ? { ...run.style.axes } : undefined,
        features: run.style.features ? { ...run.style.features } : undefined,
      },
    })),
    paragraphs: style.paragraphs?.map((paragraph) => ({ ...paragraph, style: { ...paragraph.style } })),
    appearance: style.appearance ? {
      fills: style.appearance.fills.map((fill) => ({ ...fill })),
      strokes: style.appearance.strokes.map((stroke) => ({ ...stroke })),
    } : undefined,
    spatial: style.spatial ? {
      ...style.spatial,
      transform: { ...style.spatial.transform },
      extrusion: { ...style.spatial.extrusion },
      material: { ...style.spatial.material },
      link: style.spatial.link ? { ...style.spatial.link } : undefined,
    } : undefined,
  };
}
