/** Pixel-only recoloring. All distances/edits use display-referred sRGB. */
export const RECOLOR_MAX_PIXELS = 50_000_000;
// Standalone preview/helper calls must not allocate full-size editing buffers.
export const RECOLOR_BUFFER_MAX_PIXELS = 4_000_000;
export type RecolorParams = {
  colors: string[]; protectedColors: string[];
  match: "perceptual" | "hue"; tolerance: number; softness: number; invert: boolean;
  saturationMin: number; saturationMax: number; lightnessMin: number; lightnessMax: number;
  mode: "replace" | "shift" | "desaturate" | "remove" | "isolate";
  replacement: string; preserveLightness: boolean; hue: number; saturation: number; lightness: number;
  amount: number; respectSelection: boolean;
};
export const DEFAULT_RECOLOR: RecolorParams = {
  colors: ["#ff0000"], protectedColors: [], match: "perceptual", tolerance: .12, softness: .08, invert: false,
  saturationMin: 0, saturationMax: 1, lightnessMin: 0, lightnessMax: 1,
  mode: "replace", replacement: "#4785ff", preserveLightness: true, hue: 0, saturation: 0, lightness: 0,
  amount: 1, respectSelection: true,
};

export function validateRecolor(value: RecolorParams): RecolorParams {
  if (!value || !Array.isArray(value.colors) || !Array.isArray(value.protectedColors) || value.colors.length < 1 || value.colors.length > 16 || value.protectedColors.length > 8 ||
      [...value.colors, ...value.protectedColors, value.replacement].some(color => typeof color !== "string" || !/^#[0-9a-f]{6}$/i.test(color)) ||
      !["perceptual", "hue"].includes(value.match) || !["replace", "shift", "desaturate", "remove", "isolate"].includes(value.mode) ||
      ["invert", "preserveLightness", "respectSelection"].some(key => typeof value[key as keyof RecolorParams] !== "boolean")) throw new Error("Invalid recolor configuration");
  for (const key of ["tolerance", "softness", "saturationMin", "saturationMax", "lightnessMin", "lightnessMax", "amount"] as const) {
    if (!Number.isFinite(value[key]) || value[key] < 0 || value[key] > 1) throw new Error(`Invalid recolor ${key}`);
  }
  for (const [key, max] of [["hue", 180], ["saturation", 1], ["lightness", 1]] as const) if (!Number.isFinite(value[key]) || Math.abs(value[key]) > max) throw new Error(`Invalid recolor ${key}`);
  if (value.saturationMin > value.saturationMax || value.lightnessMin > value.lightnessMax) throw new Error("Recolor range minimum must not exceed maximum");
  return { ...value, colors: [...value.colors], protectedColors: [...value.protectedColors] };
}

const clamp = (n: number) => Math.max(0, Math.min(1, n));
const linear = (n: number) => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4;
function lab(r: number, g: number, b: number) {
  r = linear(r); g = linear(g); b = linear(b);
  const l = Math.cbrt(.4122214708*r+.5363325363*g+.0514459929*b);
  const m = Math.cbrt(.2119034982*r+.6806995451*g+.1073969566*b);
  const s = Math.cbrt(.0883024619*r+.2817188376*g+.6299787005*b);
  return [.2104542553*l+.793617785*m-.0040720468*s,1.9779984951*l-2.428592205*m+.4505937099*s,.0259040371*l+.7827717662*m-.808675766*s];
}
function hsl(r: number, g: number, b: number) {
  const max = Math.max(r,g,b), min = Math.min(r,g,b), d = max-min, l = (max+min)/2;
  const h = d === 0 ? 0 : max === r ? ((g-b)/d+6)%6 : max === g ? (b-r)/d+2 : (r-g)/d+4;
  return [h/6, d === 0 ? 0 : d/(1-Math.abs(2*l-1)), l];
}
function rgb(h: number, s: number, l: number) {
  h = ((h%1)+1)%1;
  const c = (1-Math.abs(2*l-1))*s, x = c*(1-Math.abs((h*6)%2-1)), m = l-c/2;
  const v = h<1/6?[c,x,0]:h<2/6?[x,c,0]:h<3/6?[0,c,x]:h<4/6?[0,x,c]:h<5/6?[x,0,c]:[c,0,x];
  return v.map(n=>n+m);
}
function hex(value: string) { const n = parseInt(value.slice(1),16); return [(n>>16)/255,((n>>8)&255)/255,(n&255)/255] as const; }
function falloff(distance: number, tolerance: number, softness: number) {
  if (distance <= tolerance + 1e-8) return 1;
  if (softness === 0 || distance >= tolerance+softness) return 0;
  const t = (distance-tolerance)/softness; return 1-t*t*(3-2*t);
}

export function recolorProcessor(input: RecolorParams) {
  const p = validateRecolor(input);
  const targets = p.colors.map(color => { const v=hex(color); return { lab:lab(...v), hsl:hsl(...v) }; });
  const protect = p.protectedColors.map(color => { const v=hex(color); return { lab:lab(...v), hsl:hsl(...v) }; });
  const replacement = hex(p.replacement), replacementHsl = hsl(...replacement);
  function matching(r: number, g: number, b: number, hs: number[]) {
    const ls = p.match === "perceptual" ? lab(r,g,b) : [];
    const match = (colors: typeof targets) => colors.reduce((best, color) => {
      // Hue alone is undefined for grays. Keep neutral samples separate.
      const d = p.match === "perceptual" ? Math.hypot(ls[0]-color.lab[0],ls[1]-color.lab[1],ls[2]-color.lab[2]) :
        hs[1]<.03 || color.hsl[1]<.03 ? (hs[1]<.03 && color.hsl[1]<.03 ? Math.abs(hs[2]-color.hsl[2]) : 1) : Math.min(Math.abs(hs[0]-color.hsl[0]),1-Math.abs(hs[0]-color.hsl[0]))*2;
      return Math.max(best, falloff(d,p.tolerance,p.softness));
    },0);
    let weight = match(targets); if (p.invert) weight=1-weight;
    if (hs[1]<p.saturationMin || hs[1]>p.saturationMax || hs[2]<p.lightnessMin || hs[2]>p.lightnessMax) weight=0;
    const protection=match(protect);
    return { weight:weight*(1-protection), isolationRemoval:(1-weight)*(1-protection) };
  }
  return (data: Uint8ClampedArray, mask: Uint8Array, start = 0, end = mask.length, selection?: Uint8Array) => {
    for (let i=start; i<end; i++) {
      const at=i*4, alpha=data[at+3]; if (!alpha) { mask[i]=0; continue; }
      const r=data[at]/255,g=data[at+1]/255,b=data[at+2]/255, hs=hsl(r,g,b);
      const domain=p.respectSelection && selection ? selection[i]/255 : 1;
      const coverage=matching(r,g,b,hs),w=coverage.weight; mask[i]=Math.round(w*domain*255);
      const a=w*domain*p.amount;
      if (p.mode === "remove" || p.mode === "isolate") { data[at+3]=Math.round(alpha*(1-(p.mode==="remove"?w:coverage.isolationRemoval)*domain*p.amount)); continue; }
      const next = p.mode === "desaturate" ? rgb(hs[0],0,hs[2]) : p.mode === "shift" ? rgb(hs[0]+p.hue/360,clamp(hs[1]+p.saturation),clamp(hs[2]+p.lightness)) :
        p.preserveLightness ? rgb(replacementHsl[0],replacementHsl[1],hs[2]) : replacement;
      data[at]=Math.round((r+(next[0]-r)*a)*255); data[at+1]=Math.round((g+(next[1]-g)*a)*255); data[at+2]=Math.round((b+(next[2]-b)*a)*255);
    }
  };
}

export function recolorPixels(source: Uint8ClampedArray, params: RecolorParams, selection?: Uint8Array) {
  const count=source.length/4;
  if (!Number.isSafeInteger(count) || count>RECOLOR_BUFFER_MAX_PIXELS || (selection && selection.length!==count)) throw new Error("Recolor pixel bounds exceed the 4 MP buffer limit; use tiled processing");
  const pixels=source.slice(), mask=new Uint8Array(count); recolorProcessor(params)(pixels,mask,0,count,selection);
  return {pixels,mask};
}
