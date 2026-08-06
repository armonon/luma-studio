import { BlendIf, BlendIfChannel, BlendIfRange, BlendMode, BlendPass } from "./document";

const NATIVE_CANVAS_MODES: Partial<Record<BlendMode, GlobalCompositeOperation>> = {
  "source-over": "source-over",
  darken: "darken",
  multiply: "multiply",
  "color-burn": "color-burn",
  lighten: "lighten",
  screen: "screen",
  "color-dodge": "color-dodge",
  overlay: "overlay",
  "soft-light": "soft-light",
  "hard-light": "hard-light",
  difference: "difference",
  exclusion: "exclusion",
  hue: "hue",
  saturation: "saturation",
  color: "color",
  luminosity: "luminosity",
};

type Rgb = readonly [number, number, number];

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const luminosity = (color: Rgb) => 0.3 * color[0] + 0.59 * color[1] + 0.11 * color[2];
const saturation = (color: Rgb) => Math.max(...color) - Math.min(...color);

export function blendIfFactor(value: number, range: BlendIfRange) {
  const v = clamp01(value);
  if (v < range.black || v > range.white) return 0;
  if (v < range.blackFeather) {
    const span = range.blackFeather - range.black;
    return span > 0 ? (v - range.black) / span : 1;
  }
  if (v <= range.whiteFeather) return 1;
  const span = range.white - range.whiteFeather;
  return span > 0 ? (range.white - v) / span : 1;
}

function channelValue(color: Rgb, channel: BlendIfChannel) {
  if (channel === "red") return color[0];
  if (channel === "green") return color[1];
  if (channel === "blue") return color[2];
  return luminosity(color);
}

export function blendIfOpacity(base: Rgb, source: Rgb, settings: BlendIf) {
  return (["gray", "red", "green", "blue"] as const).reduce((opacity, channel) => {
    const ranges = settings.channels[channel];
    return opacity
      * blendIfFactor(channelValue(source, channel), ranges.source)
      * blendIfFactor(channelValue(base, channel), ranges.underlying);
  }, 1);
}

export function isNeutralBlendIf(settings: BlendIf) {
  const neutral = (range: BlendIfRange) => range.black === 0
    && range.blackFeather === 0
    && range.whiteFeather === 1
    && range.white === 1;
  return (["gray", "red", "green", "blue"] as const).every((channel) => {
    const ranges = settings.channels[channel];
    return neutral(ranges.source) && neutral(ranges.underlying);
  });
}

function colorDodge(base: number, source: number) {
  if (base <= 0) return 0;
  if (source >= 1) return 1;
  return Math.min(1, base / (1 - source));
}

function colorBurn(base: number, source: number) {
  if (base >= 1) return 1;
  if (source <= 0) return 0;
  return 1 - Math.min(1, (1 - base) / source);
}

function overlay(base: number, source: number) {
  return base < 0.5
    ? 2 * base * source
    : 1 - 2 * (1 - base) * (1 - source);
}

function softLight(base: number, source: number) {
  const d = base <= 0.25
    ? ((16 * base - 12) * base + 4) * base
    : Math.sqrt(base);
  return source <= 0.5
    ? base - (1 - 2 * source) * base * (1 - base)
    : base + (2 * source - 1) * (d - base);
}

function clipColor(input: Rgb): Rgb {
  const light = luminosity(input);
  const low = Math.min(...input);
  const high = Math.max(...input);
  let color = [...input] as [number, number, number];
  if (low < 0) color = color.map((channel) => light + ((channel - light) * light) / (light - low)) as [number, number, number];
  if (high > 1) color = color.map((channel) => light + ((channel - light) * (1 - light)) / (high - light)) as [number, number, number];
  return color.map(clamp01) as [number, number, number];
}

function setLum(input: Rgb, light: number): Rgb {
  const delta = light - luminosity(input);
  return clipColor(input.map((channel) => channel + delta) as [number, number, number]);
}

function setSat(input: Rgb, amount: number): Rgb {
  const indexed = input.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
  const result: [number, number, number] = [0, 0, 0];
  const [low, middle, high] = indexed;
  if (high.value > low.value) {
    result[middle.index] = ((middle.value - low.value) * amount) / (high.value - low.value);
    result[high.index] = amount;
  }
  return result;
}

/** Pure blend math used by the CPU fallback and engine tests. */
export function blendRgb(mode: BlendMode, base: Rgb, source: Rgb): Rgb {
  const channel = (fn: (b: number, s: number) => number): Rgb => [
    clamp01(fn(base[0], source[0])),
    clamp01(fn(base[1], source[1])),
    clamp01(fn(base[2], source[2])),
  ];
  switch (mode) {
    case "source-over":
    case "dissolve": return source;
    case "darken": return channel(Math.min);
    case "multiply": return channel((b, s) => b * s);
    case "color-burn": return channel(colorBurn);
    case "linear-burn": return channel((b, s) => b + s - 1);
    case "darker-color": return luminosity(source) < luminosity(base) ? source : base;
    case "lighten": return channel(Math.max);
    case "screen": return channel((b, s) => b + s - b * s);
    case "color-dodge": return channel(colorDodge);
    case "linear-dodge": return channel((b, s) => b + s);
    case "lighter-color": return luminosity(source) > luminosity(base) ? source : base;
    case "overlay": return channel(overlay);
    case "soft-light": return channel(softLight);
    case "hard-light": return channel((b, s) => overlay(s, b));
    case "vivid-light": return channel((b, s) => s <= 0.5 ? colorBurn(b, 2 * s) : colorDodge(b, 2 * (s - 0.5)));
    case "linear-light": return channel((b, s) => b + 2 * s - 1);
    case "pin-light": return channel((b, s) => s <= 0.5 ? Math.min(b, 2 * s) : Math.max(b, 2 * (s - 0.5)));
    case "hard-mix": return channel((b, s) => {
      const vivid = s <= 0.5 ? colorBurn(b, 2 * s) : colorDodge(b, 2 * (s - 0.5));
      return vivid < 0.5 ? 0 : 1;
    });
    case "difference": return channel((b, s) => Math.abs(b - s));
    case "exclusion": return channel((b, s) => b + s - 2 * b * s);
    case "subtract": return channel((b, s) => b - s);
    case "divide": return channel((b, s) => s <= 0 ? 1 : b / s);
    case "hue": return setLum(setSat(source, saturation(base)), luminosity(base));
    case "saturation": return setLum(setSat(base, saturation(source)), luminosity(base));
    case "color": return setLum(source, luminosity(base));
    case "luminosity": return setLum(base, luminosity(source));
  }
}

export function blendPassSeed(value: string) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function noise01(x: number, y: number, seed: number) {
  let hash = Math.imul(x + 1, 374761393) ^ Math.imul(y + 1, 668265263) ^ seed;
  hash = Math.imul(hash ^ (hash >>> 13), 1274126177);
  return ((hash ^ (hash >>> 16)) >>> 0) / 4294967296;
}

function compositeCustom(
  composite: CanvasRenderingContext2D,
  source: HTMLCanvasElement,
  mode: BlendMode,
  opacity: number,
  seed: number,
  blendIf: BlendIf,
) {
  const width = source.width;
  const height = source.height;
  const baseImage = composite.getImageData(0, 0, width, height);
  const sourceImage = source.getContext("2d")!.getImageData(0, 0, width, height);
  const baseData = baseImage.data;
  const sourceData = sourceImage.data;
  for (let offset = 0; offset < baseData.length; offset += 4) {
    const pixel = offset / 4;
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    const baseAlpha = baseData[offset + 3] / 255;
    const rawSourceAlpha = sourceData[offset + 3] / 255;
    const base: Rgb = [baseData[offset] / 255, baseData[offset + 1] / 255, baseData[offset + 2] / 255];
    const layer: Rgb = [sourceData[offset] / 255, sourceData[offset + 1] / 255, sourceData[offset + 2] / 255];
    let sourceAlpha = rawSourceAlpha * opacity * blendIfOpacity(base, layer, blendIf);
    if (mode === "dissolve") sourceAlpha = noise01(x, y, seed) < sourceAlpha ? 1 : 0;
    if (sourceAlpha <= 0) continue;
    const blended = blendRgb(mode, base, layer);
    const outAlpha = sourceAlpha + baseAlpha * (1 - sourceAlpha);
    for (let channelIndex = 0; channelIndex < 3; channelIndex++) {
      const premultiplied =
        (1 - sourceAlpha) * baseAlpha * base[channelIndex]
        + sourceAlpha * ((1 - baseAlpha) * layer[channelIndex] + baseAlpha * blended[channelIndex]);
      baseData[offset + channelIndex] = Math.round(clamp01(outAlpha > 0 ? premultiplied / outAlpha : 0) * 255);
    }
    baseData[offset + 3] = Math.round(clamp01(outAlpha) * 255);
  }
  composite.putImageData(baseImage, 0, 0);
}

/** Composite one source repeatedly using the ordered, independently opaque pass stack. */
export function compositeBlendStack(
  composite: CanvasRenderingContext2D,
  source: HTMLCanvasElement,
  passes: ReadonlyArray<BlendPass>,
  masterOpacity: number,
  blendIf: BlendIf,
) {
  for (const pass of passes) {
    if (!pass.enabled) continue;
    const opacity = clamp01(masterOpacity * pass.opacity);
    if (opacity <= 0) continue;
    const nativeMode = NATIVE_CANVAS_MODES[pass.mode];
    if (nativeMode && isNeutralBlendIf(blendIf)) {
      composite.save();
      composite.globalCompositeOperation = nativeMode;
      composite.globalAlpha = opacity;
      composite.drawImage(source, 0, 0);
      composite.restore();
    } else {
      compositeCustom(composite, source, pass.mode, opacity, blendPassSeed(pass.id), blendIf);
    }
  }
}
