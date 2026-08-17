export type VirtualRangeInput = {
  itemCount: number;
  itemHeight: number;
  viewportHeight: number;
  scrollTop: number;
  overscan?: number;
};

export type VirtualRange = {
  start: number;
  end: number;
  offset: number;
  totalHeight: number;
};

/** A bounded slice for panels that may contain tens of thousands of rows. */
export function virtualRange({
  itemCount,
  itemHeight,
  viewportHeight,
  scrollTop,
  overscan = 8,
}: VirtualRangeInput): VirtualRange {
  const count = Math.max(0, Math.floor(itemCount));
  const height = Math.max(1, itemHeight);
  const viewport = Math.max(0, viewportHeight);
  const maxScroll = Math.max(0, count * height - viewport);
  const scroll = Math.max(0, Math.min(maxScroll, scrollTop));
  const padding = Math.max(0, Math.floor(overscan));
  const visibleStart = Math.floor(scroll / height);
  const visibleEnd = Math.ceil((scroll + viewport) / height);
  const start = Math.max(0, visibleStart - padding);
  const end = Math.min(count, Math.max(visibleEnd + padding, start));
  return { start, end, offset: start * height, totalHeight: count * height };
}
