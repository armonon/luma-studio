import type { BlendMode, BlendPass } from "./document";

export type BlendRecipeId = "detail" | "glow" | "depth" | "color" | "cinematic";

export type BlendRecipe = {
  id: BlendRecipeId;
  label: string;
  description: string;
  passes: ReadonlyArray<{ mode: BlendMode; opacity: number }>;
};

export const BLEND_RECIPES: ReadonlyArray<BlendRecipe> = [
  { id: "detail", label: "Detail", description: "Crisp local contrast without a hard-edged sharpen", passes: [
    { mode: "overlay", opacity: 0.7 }, { mode: "soft-light", opacity: 0.28 },
  ] },
  { id: "glow", label: "Glow", description: "Broad luminous lift with a restrained highlight bloom", passes: [
    { mode: "screen", opacity: 0.62 }, { mode: "color-dodge", opacity: 0.16 },
  ] },
  { id: "depth", label: "Depth", description: "Deepen form while preserving highlight separation", passes: [
    { mode: "multiply", opacity: 0.48 }, { mode: "soft-light", opacity: 0.3 },
  ] },
  { id: "color", label: "Color", description: "Transfer chroma while retaining underlying luminosity", passes: [
    { mode: "color", opacity: 0.76 }, { mode: "luminosity", opacity: 0.18 },
  ] },
  { id: "cinematic", label: "Cinema", description: "Dense contrast, soft highlight rolloff, controlled color", passes: [
    { mode: "soft-light", opacity: 0.55 }, { mode: "color", opacity: 0.38 }, { mode: "screen", opacity: 0.12 },
  ] },
];

export function blendRecipePasses(id: BlendRecipeId): BlendPass[] | null {
  const recipe = BLEND_RECIPES.find((candidate) => candidate.id === id);
  return recipe?.passes.map((pass) => ({ id: "", ...pass, enabled: true })) ?? null;
}
