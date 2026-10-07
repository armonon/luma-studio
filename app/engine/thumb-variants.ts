// Pure layout generation for the Thumb (YouTube thumbnail maker). Given a
// title string, deterministically produces up to 3 distinct A/B layout
// variants — same title always produces the same variants, so re-opening a
// project or regenerating doesn't scramble a layout the user already liked.

export type ThumbLayout = "subject-left" | "subject-right" | "subject-center";

export type ThumbVariant = {
  id: string;
  layout: ThumbLayout;
  titleAlign: "left" | "right" | "center";
  /** Relative scale applied to the base title type size (1 = base preset size). */
  titleScale: number;
  accent: string;
};

export const THUMB_WIDTH = 1280;
export const THUMB_HEIGHT = 720;

const LAYOUTS: readonly ThumbLayout[] = ["subject-left", "subject-right", "subject-center"];
const ACCENTS: readonly string[] = ["#ffcc00", "#ff3b30", "#2bd1a6", "#2385f4", "#7c5ce7", "#ff7a1a"];

function hashString(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193);
  }
  return hash >>> 0;
}

function titleAlignFor(layout: ThumbLayout): ThumbVariant["titleAlign"] {
  if (layout === "subject-left") return "right";
  if (layout === "subject-right") return "left";
  return "center";
}

/**
 * Generate `count` (1-3) distinct thumbnail layout variants for `title`.
 * Deterministic: the same title and count always produce the same variants,
 * in the same order, and no two variants in one call share a layout.
 */
export function generateThumbVariants(title: string, count = 3): ThumbVariant[] {
  if (!Number.isInteger(count) || count < 1 || count > LAYOUTS.length) {
    throw new Error(`Thumb supports between 1 and ${LAYOUTS.length} variants`);
  }
  const seed = hashString(title.trim() || "thumbnail");
  const rotation = seed % LAYOUTS.length;
  const variants: ThumbVariant[] = [];
  for (let index = 0; index < count; index += 1) {
    const layout = LAYOUTS[(rotation + index) % LAYOUTS.length];
    const accent = ACCENTS[(seed >>> (index + 1)) % ACCENTS.length];
    const steps = (seed >>> (index + 3)) % 3; // 0, 1 or 2
    variants.push({
      id: `variant-${index + 1}`,
      layout,
      titleAlign: titleAlignFor(layout),
      titleScale: 1 + steps * 0.08,
      accent,
    });
  }
  return variants;
}
