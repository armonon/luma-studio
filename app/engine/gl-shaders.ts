// GLSL 3.00 (WebGL2) sources for the float compositor.
// Blend-mode formulas follow the W3C Compositing and Blending Level 1 spec.

export const VS = `#version 300 es
in vec2 a_pos;
in vec2 a_uv;
out vec2 v_uv;
void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
  v_uv = a_uv;
}`;

// Full-screen pass that composites a layer texture onto a base texture,
// with optional mask, opacity, and a blend mode selected by uniform u_mode.
// When u_linear is true, colors are converted sRGB -> linear before blending
// and back to sRGB after, so blend modes operate in physically-correct light.
export const COMPOSITE_FS = `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_base;
uniform sampler2D u_layer;
uniform sampler2D u_mask;
uniform bool u_hasMask;
uniform float u_opacity;
uniform int u_mode;
uniform float u_seed;
uniform bool u_linear;
uniform bool u_blend_if_enabled;
uniform vec4 u_source_ranges[4];
uniform vec4 u_underlying_ranges[4];

// ---- color space (piecewise sRGB transfer) ----
vec3 srgbToLinear(vec3 c) {
  vec3 magnitude = abs(c);
  bvec3 cutoff = lessThanEqual(magnitude, vec3(0.04045));
  vec3 lo = magnitude / 12.92;
  vec3 hi = pow((magnitude + 0.055) / 1.055, vec3(2.4));
  return sign(c) * mix(hi, lo, vec3(cutoff));
}
vec3 linearToSrgb(vec3 c) {
  vec3 magnitude = abs(c);
  bvec3 cutoff = lessThanEqual(magnitude, vec3(0.0031308));
  vec3 lo = magnitude * 12.92;
  vec3 hi = 1.055 * pow(magnitude, vec3(1.0 / 2.4)) - 0.055;
  return sign(c) * mix(hi, lo, vec3(cutoff));
}

// ---- separable blend helpers (W3C spec) ----
float b_overlay(float b, float s) {
  return b < 0.5 ? 2.0 * b * s : 1.0 - 2.0 * (1.0 - b) * (1.0 - s);
}
float b_softLight(float b, float s) {
  float d;
  if (b <= 0.25) d = ((16.0 * b - 12.0) * b + 4.0) * b;
  else d = sqrt(b);
  if (s <= 0.5) return b - (1.0 - 2.0 * s) * b * (1.0 - b);
  return b + (2.0 * s - 1.0) * (d - b);
}
float b_colorDodge(float b, float s) {
  if (b <= 0.0) return 0.0;
  if (s >= 1.0) return 1.0;
  return min(1.0, b / (1.0 - s));
}
float b_colorBurn(float b, float s) {
  if (b >= 1.0) return 1.0;
  if (s <= 0.0) return 0.0;
  return 1.0 - min(1.0, (1.0 - b) / s);
}
float b_vividLight(float b, float s) {
  return s <= 0.5 ? b_colorBurn(b, 2.0 * s) : b_colorDodge(b, 2.0 * (s - 0.5));
}

// ---- non-separable (HSL) helpers ----
float sat(vec3 c) { return max(max(c.r, c.g), c.b) - min(min(c.r, c.g), c.b); }
float lum(vec3 c) { return dot(c, vec3(0.3, 0.59, 0.11)); }

vec3 clipColor(vec3 c) {
  float l = lum(c);
  float n = min(min(c.r, c.g), c.b);
  float x = max(max(c.r, c.g), c.b);
  if (n < 0.0) c = l + (c - l) * l / (l - n);
  if (x > 1.0) c = l + (c - l) * (1.0 - l) / (x - l);
  return c;
}
vec3 setLum(vec3 c, float l) { return clipColor(c + (l - lum(c))); }

// Apply saturation s to color c by finding the current min/mid/max
// channels and remapping them to preserve hue/luminance ratios.
vec3 setSat(vec3 c, float s) {
  float cmax = max(max(c.r, c.g), c.b);
  float cmin = min(min(c.r, c.g), c.b);
  if (cmax > cmin) return (c - cmin) * s / (cmax - cmin);
  return vec3(0.0);
}

float blendIfValue(vec3 c, int channel) {
  if (channel == 1) return c.r;
  if (channel == 2) return c.g;
  if (channel == 3) return c.b;
  return lum(c);
}

float blendIfGate(float value, vec4 range) {
  if (value < range.x || value > range.w) return 0.0;
  if (value < range.y) return (value - range.x) / max(0.00001, range.y - range.x);
  if (value <= range.z) return 1.0;
  return (range.w - value) / max(0.00001, range.w - range.z);
}

vec3 blend(vec3 b, vec3 s, int mode) {
  if (mode <= 1) return s;                                    // normal, dissolve
  if (mode == 2) return min(b, s);                            // darken
  if (mode == 3) return b * s;                                // multiply
  if (mode == 4) return vec3(b_colorBurn(b.r,s.r), b_colorBurn(b.g,s.g), b_colorBurn(b.b,s.b));
  if (mode == 5) return max(vec3(0.0), b + s - 1.0);           // linear burn
  if (mode == 6) return lum(s) < lum(b) ? s : b;               // darker color
  if (mode == 7) return max(b, s);                             // lighten
  if (mode == 8) return b + s - b * s;                         // screen
  if (mode == 9) return vec3(b_colorDodge(b.r,s.r), b_colorDodge(b.g,s.g), b_colorDodge(b.b,s.b));
  if (mode == 10) return min(vec3(1.0), b + s);                // linear dodge
  if (mode == 11) return lum(s) > lum(b) ? s : b;              // lighter color
  if (mode == 12) return vec3(b_overlay(b.r,s.r), b_overlay(b.g,s.g), b_overlay(b.b,s.b));
  if (mode == 13) return vec3(b_softLight(b.r,s.r), b_softLight(b.g,s.g), b_softLight(b.b,s.b));
  if (mode == 14) return vec3(b_overlay(s.r,b.r), b_overlay(s.g,b.g), b_overlay(s.b,b.b));
  if (mode == 15) return vec3(b_vividLight(b.r,s.r), b_vividLight(b.g,s.g), b_vividLight(b.b,s.b));
  if (mode == 16) return clamp(b + 2.0 * s - 1.0, vec3(0.0), vec3(1.0));
  if (mode == 17) return mix(min(b, 2.0 * s), max(b, 2.0 * (s - 0.5)), step(vec3(0.5), s));
  if (mode == 18) return step(vec3(0.5), vec3(b_vividLight(b.r,s.r), b_vividLight(b.g,s.g), b_vividLight(b.b,s.b)));
  if (mode == 19) return abs(b - s);                           // difference
  if (mode == 20) return b + s - 2.0 * b * s;                 // exclusion
  if (mode == 21) return max(vec3(0.0), b - s);                // subtract
  if (mode == 22) return min(vec3(1.0), b / max(s, vec3(0.00001))); // divide
  if (mode == 23) return setLum(setSat(s, sat(b)), lum(b));    // hue
  if (mode == 24) return setLum(setSat(b, sat(s)), lum(b));    // saturation
  if (mode == 25) return setLum(s, lum(b));                    // color
  if (mode == 26) return setLum(b, lum(s));                    // luminosity
  return s;
}

void main() {
  vec4 base = texture(u_base, v_uv);
  vec4 layer = texture(u_layer, v_uv);
  float m = u_hasMask ? texture(u_mask, v_uv).a : 1.0;
  float alpha = layer.a * u_opacity * m;

  // Unpremultiply for blend math, and optionally convert to linear light.
  vec3 baseColor = base.a > 0.0 ? base.rgb / base.a : vec3(0.0);
  vec3 layerColor = layer.a > 0.0 ? layer.rgb / layer.a : vec3(0.0);
  if (u_blend_if_enabled) {
    for (int channel = 0; channel < 4; channel++) {
      alpha *= blendIfGate(blendIfValue(layerColor, channel), u_source_ranges[channel])
        * blendIfGate(blendIfValue(baseColor, channel), u_underlying_ranges[channel]);
    }
  }
  if (u_mode == 1) {
    float randomValue = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233)) + u_seed) * 43758.5453);
    alpha = randomValue < alpha ? 1.0 : 0.0;
  }
  if (u_linear) {
    baseColor = srgbToLinear(baseColor);
    layerColor = srgbToLinear(layerColor);
  }

  vec3 blended = blend(baseColor, layerColor, u_mode);

  // Porter–Duff over with in-place blend result (PDF/W3C compositing spec):
  //   Cout = (1 - As) * Cbase + As * ((1 - Ad) * Cs + Ad * B(Cd, Cs))
  //   Aout = As + Ad - As * Ad
  float srcA = alpha;
  float dstA = base.a;
  float outA = srcA + dstA * (1.0 - srcA);
  vec3 outPremult = (1.0 - srcA) * dstA * baseColor
    + srcA * ((1.0 - dstA) * layerColor + dstA * blended);
  if (u_linear && outA > 0.0) outPremult = linearToSrgb(outPremult / outA) * outA;
  outColor = vec4(outPremult, outA);
}`;

// Adjustment pass: samples the current composite and applies tone params in
// a single shader. Matches the CSS-filter chain the 2D renderer uses so both
// paths look similar; the GPU path stays in float precision throughout.
export const ADJUST_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform sampler2D u_src;
uniform sampler2D u_mask;
uniform bool u_hasMask;
uniform bool u_linear;
uniform float u_opacity;
uniform float u_exposure;
uniform float u_contrast;
uniform float u_highlights;
uniform float u_shadows;
uniform float u_temperature;
uniform float u_vibrance;

vec3 _srgbToLinear(vec3 c) {
  vec3 magnitude = abs(c);
  bvec3 cutoff = lessThanEqual(magnitude, vec3(0.04045));
  vec3 lo = magnitude / 12.92;
  vec3 hi = pow((magnitude + 0.055) / 1.055, vec3(2.4));
  return sign(c) * mix(hi, lo, vec3(cutoff));
}
vec3 _linearToSrgb(vec3 c) {
  vec3 magnitude = abs(c);
  bvec3 cutoff = lessThanEqual(magnitude, vec3(0.0031308));
  vec3 lo = magnitude * 12.92;
  vec3 hi = 1.055 * pow(magnitude, vec3(1.0 / 2.4)) - 0.055;
  return sign(c) * mix(hi, lo, vec3(cutoff));
}

vec3 applyContrast(vec3 c, float amt) {
  return (c - 0.5) * (1.0 + amt) + 0.5;
}
vec3 applyTemperature(vec3 c, float t) {
  // Warm > 0: shift toward red/yellow; cool < 0: shift toward blue.
  float k = t / 100.0;
  return c + vec3(k * 0.10, k * 0.04, -k * 0.10);
}
vec3 applyVibrance(vec3 c, float v) {
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  return mix(vec3(l), c, 1.0 + v / 200.0);
}
vec3 applyHiShadow(vec3 c, float hi, float sh) {
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float wS = (1.0 - l) * (1.0 - l);
  float wH = l * l;
  float shift = sh * wS * 0.6 - hi * wH * 0.6;
  return c + vec3(shift);
}

void main() {
  vec4 src = texture(u_src, v_uv);
  vec3 baseColor = src.a > 0.0 ? src.rgb / src.a : vec3(0.0);
  vec3 c = baseColor;
  if (u_linear) c = _srgbToLinear(c);
  c *= pow(2.0, u_exposure);                          // exposure in stops
  if (u_linear) c = _linearToSrgb(c);                 // rest of the chain is
                                                       // perceptual on sRGB
  c = applyContrast(c, u_contrast / 100.0);
  c = applyHiShadow(c, u_highlights / 100.0, u_shadows / 100.0);
  c = applyTemperature(c, u_temperature);
  c = applyVibrance(c, u_vibrance);
  float m = u_hasMask ? texture(u_mask, v_uv).a : 1.0;
  float mix_amt = u_opacity * m;
  vec3 finalC = mix(baseColor, c, mix_amt);
  outColor = vec4(finalC * src.a, src.a);
}`;

// Curves adjustment: samples the current composite and remaps each channel
// through a 256-tap LUT stored as a 256x4 luminance texture (rows = rgb/r/g/b).
export const CURVES_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform sampler2D u_src;
uniform sampler2D u_lut; // 256 wide, 4 tall; row 0 = rgb, 1 = r, 2 = g, 3 = b
uniform sampler2D u_mask;
uniform bool u_hasMask;
uniform float u_opacity;

float sampleLut(int row, float v) {
  float y = (float(row) + 0.5) / 4.0;
  float x = clamp(v, 0.0, 1.0);
  return texture(u_lut, vec2(x, y)).r;
}

void main() {
  vec4 src = texture(u_src, v_uv);
  vec3 c = src.a > 0.0 ? src.rgb / src.a : vec3(0.0);
  vec3 mapped = vec3(
    sampleLut(0, sampleLut(1, c.r)),
    sampleLut(0, sampleLut(2, c.g)),
    sampleLut(0, sampleLut(3, c.b))
  );
  float m = u_hasMask ? texture(u_mask, v_uv).a : 1.0;
  float amt = u_opacity * m;
  vec3 finalC = mix(c, mapped, amt);
  outColor = vec4(finalC * src.a, src.a);
}`;

export const LEVELS_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform sampler2D u_src;
uniform sampler2D u_mask;
uniform bool u_hasMask;
uniform float u_opacity;
uniform float u_inBlack;
uniform float u_inWhite;
uniform float u_gamma;
uniform float u_outBlack;
uniform float u_outWhite;

void main() {
  vec4 src = texture(u_src, v_uv);
  vec3 c = src.a > 0.0 ? src.rgb / src.a : vec3(0.0);
  float inSpan = max(0.001, u_inWhite - u_inBlack);
  float outSpan = u_outWhite - u_outBlack;
  float invGamma = 1.0 / max(0.01, u_gamma);
  vec3 remapped = clamp((c - vec3(u_inBlack)) / inSpan, vec3(0.0), vec3(1.0));
  remapped = pow(remapped, vec3(invGamma));
  remapped = vec3(u_outBlack) + remapped * outSpan;
  float m = u_hasMask ? texture(u_mask, v_uv).a : 1.0;
  vec3 finalC = mix(c, remapped, u_opacity * m);
  outColor = vec4(finalC * src.a, src.a);
}`;

export const HSL_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform sampler2D u_src;
uniform sampler2D u_mask;
uniform bool u_hasMask;
uniform float u_opacity;
uniform float u_hueDeg;
uniform float u_satAmt;   // -1..+1 scaling around neutral
uniform float u_lightAmt; // -1..+1 additive on L

vec3 rgb2hsl(vec3 c) {
  float mx = max(max(c.r, c.g), c.b);
  float mn = min(min(c.r, c.g), c.b);
  float d = mx - mn;
  float l = (mx + mn) * 0.5;
  float h = 0.0, s = 0.0;
  if (d > 0.0) {
    s = l > 0.5 ? d / (2.0 - mx - mn) : d / (mx + mn);
    if (mx == c.r) h = mod((c.g - c.b) / d + (c.g < c.b ? 6.0 : 0.0), 6.0);
    else if (mx == c.g) h = (c.b - c.r) / d + 2.0;
    else h = (c.r - c.g) / d + 4.0;
    h /= 6.0;
  }
  return vec3(h, s, l);
}

float hue2rgb(float p, float q, float t) {
  if (t < 0.0) t += 1.0;
  if (t > 1.0) t -= 1.0;
  if (t < 1.0/6.0) return p + (q - p) * 6.0 * t;
  if (t < 1.0/2.0) return q;
  if (t < 2.0/3.0) return p + (q - p) * (2.0/3.0 - t) * 6.0;
  return p;
}
vec3 hsl2rgb(vec3 hsl) {
  float h = hsl.x, s = hsl.y, l = hsl.z;
  if (s == 0.0) return vec3(l);
  float q = l < 0.5 ? l * (1.0 + s) : l + s - l * s;
  float p = 2.0 * l - q;
  return vec3(
    hue2rgb(p, q, h + 1.0/3.0),
    hue2rgb(p, q, h),
    hue2rgb(p, q, h - 1.0/3.0)
  );
}

void main() {
  vec4 src = texture(u_src, v_uv);
  vec3 c = src.a > 0.0 ? src.rgb / src.a : vec3(0.0);
  vec3 hsl = rgb2hsl(c);
  hsl.x = mod(hsl.x + u_hueDeg / 360.0 + 1.0, 1.0);
  hsl.y = clamp(hsl.y * (1.0 + u_satAmt), 0.0, 1.0);
  hsl.z = clamp(hsl.z + u_lightAmt, 0.0, 1.0);
  vec3 mapped = hsl2rgb(hsl);
  float m = u_hasMask ? texture(u_mask, v_uv).a : 1.0;
  vec3 finalC = mix(c, mapped, u_opacity * m);
  outColor = vec4(finalC * src.a, src.a);
}`;

// Final blit: takes the float composite and writes to the display canvas
// with a checkerboard behind transparent regions.
// Readback pass: turn the float composite into exactly the bytes ImageData
// wants, so the CPU side is a memcpy instead of a per-pixel loop.
//
// Three things happen here that used to happen in JavaScript over every pixel:
// the row flip (GL's origin is bottom-left), the unpremultiply, and the
// quantise to 8 bits. Doing them in the shader also cuts the transfer from
// four floats a pixel to four bytes.
export const READBACK_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform sampler2D u_src;
void main() {
  vec4 premultiplied = texture(u_src, vec2(v_uv.x, 1.0 - v_uv.y));
  float alpha = premultiplied.a;
  vec3 straight = alpha > 0.0 ? premultiplied.rgb / alpha : vec3(0.0);
  outColor = vec4(clamp(straight, 0.0, 1.0), clamp(alpha, 0.0, 1.0));
}`;

export const BLIT_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform sampler2D u_src;
uniform vec2 u_size;
uniform int u_proof_mode;
uniform int u_proof_intent;
uniform bool u_black_point_compensation;
uniform bool u_gamut_warning;
uniform bool u_checkerboard;

vec3 proofCmyk(vec3 rgb) {
  vec3 clipped = clamp(rgb, vec3(0.0), vec3(1.0));
  float k = 1.0 - max(max(clipped.r, clipped.g), clipped.b);
  vec3 cmy = k >= 0.99999 ? vec3(0.0) : (vec3(1.0) - clipped - k) / (1.0 - k);
  float total = cmy.r + cmy.g + cmy.b + k;
  if (total > 2.8) cmy *= max(0.0, (2.8 - k) / max(0.0001, cmy.r + cmy.g + cmy.b));
  cmy = pow(cmy, vec3(0.9));
  k = pow(k, 0.82);
  vec3 proofed = (vec3(1.0) - cmy) * (1.0 - k);
  if (u_proof_intent == 1) proofed = 0.02 + proofed * 0.94;
  if (u_proof_intent == 3) {
    float luma = dot(proofed, vec3(0.2126, 0.7152, 0.0722));
    proofed = clamp(vec3(luma) + (proofed - luma) * 1.08, vec3(0.0), vec3(1.0));
  }
  float black = u_black_point_compensation ? 0.025 : 0.055;
  vec3 paper = u_proof_intent == 2 ? vec3(0.94, 0.93, 0.89) : vec3(1.0);
  return vec3(black) + proofed * (paper - black);
}

void main() {
  vec4 c = texture(u_src, v_uv);
  if (!u_checkerboard) {
    outColor = c;
    return;
  }
  // Checkerboard
  float tile = 16.0;
  vec2 px = v_uv * u_size;
  float cb = mod(floor(px.x / tile) + floor(px.y / tile), 2.0);
  vec3 bg = mix(vec3(0.109, 0.109, 0.132), vec3(0.149, 0.149, 0.180), cb);
  vec3 fg = c.a > 0.0 ? c.rgb / c.a : bg;
  vec3 proofed = u_proof_mode == 3 ? proofCmyk(fg) : clamp(fg, vec3(0.0), vec3(1.0));
  bool outside = any(lessThan(fg, vec3(0.0))) || any(greaterThan(fg, vec3(1.0)));
  if (u_proof_mode == 3) outside = outside || distance(proofed, clamp(fg, vec3(0.0), vec3(1.0))) > 0.085;
  if (u_gamut_warning && outside) proofed = vec3(1.0, 0.0, 1.0);
  vec3 outC = mix(bg, proofed, c.a);
  outColor = vec4(outC, 1.0);
}`;

// Ordered blend modes exactly matching the shader's int enum above.
export const GL_BLEND_ORDER = [
  "source-over",   // 0
  "dissolve",      // 1
  "darken",        // 2
  "multiply",      // 3
  "color-burn",    // 4
  "linear-burn",   // 5
  "darker-color",  // 6
  "lighten",       // 7
  "screen",        // 8
  "color-dodge",   // 9
  "linear-dodge",  // 10
  "lighter-color", // 11
  "overlay",       // 12
  "soft-light",    // 13
  "hard-light",    // 14
  "vivid-light",   // 15
  "linear-light",  // 16
  "pin-light",     // 17
  "hard-mix",      // 18
  "difference",    // 19
  "exclusion",     // 20
  "subtract",      // 21
  "divide",        // 22
  "hue",           // 23
  "saturation",    // 24
  "color",         // 25
  "luminosity",    // 26
] as const;
