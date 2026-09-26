export const RULER_SIZE = 22;
export const RULERS_KEY = "luma.workspace.rulers.v1";

/** Work is bounded by viewport size, never by document dimensions. */
export function rulerTicks(start: number, span: number, scale: number) {
  if (![start, span, scale].every(Number.isFinite) || span <= 0 || scale <= 0) return [];
  const desired = 80 / scale;
  const power = 10 ** Math.floor(Math.log10(desired));
  const major = [1, 2, 5, 10].map(n => n * power).find(n => n >= desired) ?? power * 10;
  const minor = major / 5;
  const first = Math.ceil(start / minor);
  const last = Math.floor((start + span) / minor);
  const ticks: { value: number; percent: number; major: boolean; label: string }[] = [];
  for (let i = first; i <= last && ticks.length < 2048; i++) {
    const value = Number((i * minor).toPrecision(12));
    ticks.push({ value, percent: (value - start) / span * 100, major: i % 5 === 0, label: String(value) });
  }
  return ticks;
}

export function rulerGuidePosition(offset: number, extent: number, start: number, span: number, limit: number) {
  if (![offset, extent, start, span, limit].every(Number.isFinite) || extent <= 0 || span <= 0 || offset < RULER_SIZE || offset > extent) return null;
  const position = Math.round(start + offset / extent * span);
  return position >= 0 && position <= limit ? position : null;
}
