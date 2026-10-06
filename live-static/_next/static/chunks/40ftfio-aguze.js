(globalThis.TURBOPACK||(globalThis.TURBOPACK=[])).push(["object"==typeof document?document.currentScript:void 0,90137,27501,17798,2009,68816,e=>{"use strict";var t=e.i(94285),r=e.i(51297);function a(e){let t=Math.round(e);return 1e-9>Math.abs(e-t)?t:e}function i(e,r,n,o=0){if(!r.bitmap)return;let l=r.bitmap.getContext("2d"),u=function(e,r,i=0){if(!r.bitmap)return null;let n=r.bitmap.width,o=r.bitmap.height;if(!e.selection)return{x:0,y:0,width:n,height:o};let l=e.selection.bounds;if(l.w<=0||l.h<=0)return null;let u=(0,t.inverseAffineForLayerTransform)(r.transform);if(!u)return null;let s=[(0,t.transformPoint)(u,l.x,l.y),(0,t.transformPoint)(u,l.x+l.w,l.y),(0,t.transformPoint)(u,l.x,l.y+l.h),(0,t.transformPoint)(u,l.x+l.w,l.y+l.h)],c=Math.max(0,Math.ceil(i)),f=Math.max(0,Math.floor(a(Math.min(...s.map(e=>e.x)))-c)),m=Math.max(0,Math.floor(a(Math.min(...s.map(e=>e.y)))-c)),d=Math.min(n,Math.ceil(a(Math.max(...s.map(e=>e.x)))+c)),p=Math.min(o,Math.ceil(a(Math.max(...s.map(e=>e.y)))+c));return d<=f||p<=m?null:{x:f,y:m,width:d-f,height:p-m}}(e,r,o);if(!u)return;let s=l.getImageData(u.x,u.y,u.width,u.height),c=n(s);if(e.selection){let a=(0,t.newCanvas)(u.width,u.height).getContext("2d"),i=(0,t.inverseAffineForLayerTransform)(r.transform);if(!i)return;a.setTransform(i.a,i.b,i.c,i.d,i.e-u.x,i.f-u.y),a.drawImage(e.selection.mask,0,0);let n=a.getImageData(0,0,u.width,u.height).data,o=c.data,f=s.data;for(let e=0;e<f.length;e+=4){let t=n[e+3]/255,r=1-t;f[e]=f[e]*r+o[e]*t,f[e+1]=f[e+1]*r+o[e+1]*t,f[e+2]=f[e+2]*r+o[e+2]*t,f[e+3]=Math.max(f[e+3],o[e+3]*t)}l.putImageData(s,u.x,u.y)}else l.putImageData(c,u.x,u.y)}function n(e,t,r){r<=0||i(e,t,e=>l(e,r),o(r))}function o(e){return u(e,3).reduce((e,t)=>e+t,0)}function l(e,t){let r=e.width,a=e.height,i=new Uint8ClampedArray(e.data),n=new Uint8ClampedArray(e.data.length);for(let e of u(t,3))(function(e,t,r,a,i){let n=Math.max(0,Math.floor(i)),o=1/(n+n+1),l=new Float64Array((r+1)*4);for(let i=0;i<a;i++){let a=i*r;l.fill(0);for(let t=0;t<r;t+=1){let r=(a+t)*4,i=4*t,n=(t+1)*4;for(let t=0;t<4;t+=1)l[n+t]=l[i+t]+e[r+t]}let u=4*a,s=(a+r-1)*4;for(let i=0;i<r;i+=1){let c=Math.max(0,i-n),f=Math.min(r-1,i+n),m=Math.max(0,n-i),d=Math.max(0,i+n-(r-1)),p=(a+i)*4;for(let r=0;r<4;r+=1){let a=l[(f+1)*4+r]-l[4*c+r];t[p+r]=(a+m*e[u+r]+d*e[s+r])*o}}}})(i,n,r,a,e),function(e,t,r,a,i){let n=Math.max(0,Math.floor(i)),o=1/(n+n+1),l=new Float64Array((a+1)*4);for(let i=0;i<r;i++){l.fill(0);for(let t=0;t<a;t+=1){let a=(t*r+i)*4,n=4*t,o=(t+1)*4;for(let t=0;t<4;t+=1)l[o+t]=l[n+t]+e[a+t]}let u=4*i,s=((a-1)*r+i)*4;for(let c=0;c<a;c+=1){let f=Math.max(0,c-n),m=Math.min(a-1,c+n),d=Math.max(0,n-c),p=Math.max(0,c+n-(a-1)),h=(c*r+i)*4;for(let r=0;r<4;r+=1){let a=l[(m+1)*4+r]-l[4*f+r];t[h+r]=(a+d*e[u+r]+p*e[s+r])*o}}}}(n,i,r,a,e);return new ImageData(i,r,a)}function u(e,t){let r=Math.floor(Math.sqrt(12*e*e/t+1));r%2==0&&r--;let a=r+2,i=Math.round((12*e*e-t*r*r-4*t*r-3*t)/(-4*r-4)),n=[];for(let e=0;e<t;e++)n.push(((e<i?r:a)-1)/2);return n.map(e=>Math.max(1,e))}function s(e,t,r,a){t.bitmap&&i(e,t,e=>{let t=l(new ImageData(new Uint8ClampedArray(e.data),e.width,e.height),r),i=new ImageData(new Uint8ClampedArray(e.data.length),e.width,e.height),n=e.data,o=t.data,u=i.data;for(let e=0;e<n.length;e+=4)u[e]=p(n[e]+a*(n[e]-o[e])),u[e+1]=p(n[e+1]+a*(n[e+1]-o[e+1])),u[e+2]=p(n[e+2]+a*(n[e+2]-o[e+2])),u[e+3]=n[e+3];return i},o(r))}function c(e,t){i(e,t,e=>{let t=new ImageData(new Uint8ClampedArray(e.data),e.width,e.height),r=t.data;for(let e=0;e<r.length;e+=4)r[e]=255-r[e],r[e+1]=255-r[e+1],r[e+2]=255-r[e+2];return t})}function f(e,r,a){r.bitmap&&i(e,r,e=>{let r=(0,t.newCanvas)(e.width,e.height);r.getContext("2d").putImageData(e,0,0);let i=(0,t.newCanvas)(e.width,e.height).getContext("2d");return i.filter=`hue-rotate(${a}deg)`,i.drawImage(r,0,0),i.getImageData(0,0,e.width,e.height)})}function m(e,t,r=1){i(e,t,e=>{let t=new ImageData(new Uint8ClampedArray(e.data),e.width,e.height),a=t.data;for(let e=0;e<a.length;e+=4){let t=.2126*a[e]+.7152*a[e+1]+.0722*a[e+2];a[e]=a[e]*(1-r)+t*r,a[e+1]=a[e+1]*(1-r)+t*r,a[e+2]=a[e+2]*(1-r)+t*r}return t})}function d(e,t,r=1){if(!t?.length)return;let a={id:"smart-filter-target",name:"Smart filter target",kind:"raster",visible:!0,opacity:1,blend:"source-over",transform:{tx:0,ty:0,sx:1,sy:1,rotation:0},bitmap:e},i={width:e.width,height:e.height,colorSpace:"srgb",bitDepth:8,resolution:{x:72,y:72,unit:"ppi"},guides:[],proofing:{profile:"none",intent:"relative-colorimetric",blackPointCompensation:!0,gamutWarning:!1},layers:[a],selection:null};for(let o of t){if(!o.enabled||o.opacity<=0)continue;let t=o.opacity<1?new Uint8ClampedArray(e.getContext("2d").getImageData(0,0,e.width,e.height).data):null,l=Math.max(0,Math.min(Math.max(1,Math.min(e.width,e.height)/4),(o.params.radius??("blur"===o.kind?8:2))*r));if("blur"===o.kind?n(i,a,l):"sharpen"===o.kind?s(i,a,l,o.params.amount??.6):"invert"===o.kind?c(i,a):"desaturate"===o.kind?m(i,a,o.params.amount??1):"hue"===o.kind&&f(i,a,o.params.degrees??45),t){let r=e.getContext("2d"),a=r.getImageData(0,0,e.width,e.height),i=o.opacity;for(let e=0;e<a.data.length;e++)a.data[e]=t[e]*(1-i)+a.data[e]*i;r.putImageData(a,0,0)}}}function p(e){return e<0?0:e>255?255:e}e.s(["applySmartFilters",0,d,"desaturate",0,m,"gaussianBlur",0,n,"hueRotate",0,f,"invertColors",0,c,"unsharpMask",0,s],27501);var h=e.i(1216);let g=`#version 300 es
in vec2 a_pos;
in vec2 a_uv;
out vec2 v_uv;
void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
  v_uv = a_uv;
}`,b=`#version 300 es
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
}`,v=`#version 300 es
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
}`,_=`#version 300 es
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
}`,x=`#version 300 es
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
}`,T=`#version 300 es
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
}`,y=`#version 300 es
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
}`,E=["source-over","dissolve","darken","multiply","color-burn","linear-burn","darker-color","lighten","screen","color-dodge","linear-dodge","lighter-color","overlay","soft-light","hard-light","vivid-light","linear-light","pin-light","hard-mix","difference","exclusion","subtract","divide","hue","saturation","color","luminosity"],w=0,C=0,k=0,R=0,A=null;function U(e,t,r){let a=e.createTexture();e.bindTexture(e.TEXTURE_2D,a),e.texImage2D(e.TEXTURE_2D,0,e.RGBA16F,t,r,0,e.RGBA,e.HALF_FLOAT,null),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MIN_FILTER,e.LINEAR),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MAG_FILTER,e.LINEAR),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_S,e.CLAMP_TO_EDGE),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_T,e.CLAMP_TO_EDGE);let i=e.createFramebuffer();e.bindFramebuffer(e.FRAMEBUFFER,i),e.framebufferTexture2D(e.FRAMEBUFFER,e.COLOR_ATTACHMENT0,e.TEXTURE_2D,a,0);let n=e.checkFramebufferStatus(e.FRAMEBUFFER);if(n!==e.FRAMEBUFFER_COMPLETE)throw Error("FBO incomplete: "+n);return e.bindFramebuffer(e.FRAMEBUFFER,null),{fb:i,tex:a,w:t,h:r}}function M(e,t,r,a,i){let n=(t,r)=>{let a=e.createShader(t);if(e.shaderSource(a,r),e.compileShader(a),!e.getShaderParameter(a,e.COMPILE_STATUS)){let t=e.getShaderInfoLog(a);throw e.deleteShader(a),Error("Shader compile failed: "+t)}return a},o=n(e.VERTEX_SHADER,t),l=n(e.FRAGMENT_SHADER,r),u=e.createProgram();if(e.attachShader(u,o),e.attachShader(u,l),e.linkProgram(u),!e.getProgramParameter(u,e.LINK_STATUS))throw Error("Link failed: "+e.getProgramInfoLog(u));let s={};for(let t of a)s[t]=e.getUniformLocation(u,t);let c={};for(let t of i)c[t]=e.getAttribLocation(u,t);return e.deleteShader(o),e.deleteShader(l),{program:u,uniforms:s,attribs:c}}function I(e,t,r){e.bindBuffer(e.ARRAY_BUFFER,t.quad);let a=r.attribs.a_pos,i=r.attribs.a_uv;e.enableVertexAttribArray(a),e.vertexAttribPointer(a,2,e.FLOAT,!1,16,0),e.enableVertexAttribArray(i),e.vertexAttribPointer(i,2,e.FLOAT,!1,16,8)}function P(e,t,r){e.bindTexture(e.TEXTURE_2D,t),e.pixelStorei(e.UNPACK_PREMULTIPLY_ALPHA_WEBGL,!0),e.pixelStorei(e.UNPACK_FLIP_Y_WEBGL,!0),e.texImage2D(e.TEXTURE_2D,0,e.RGBA,e.RGBA,e.UNSIGNED_BYTE,r),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MIN_FILTER,e.LINEAR),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MAG_FILTER,e.LINEAR),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_S,e.CLAMP_TO_EDGE),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_T,e.CLAMP_TO_EDGE),e.pixelStorei(e.UNPACK_FLIP_Y_WEBGL,!1),e.pixelStorei(e.UNPACK_PREMULTIPLY_ALPHA_WEBGL,!1)}function L(e,r){let a=e.transform;return!!e.surface&&e.surface.grid.width===r.width&&e.surface.grid.height===r.height&&0===a.tx&&0===a.ty&&1===a.sx&&1===a.sy&&0===a.rotation&&!e.filters?.length&&!e.effects?.length&&!e.clipping&&1===(0,t.resolvedFillOpacity)(e)}function B(e,t,r){if(!r.mask)return null;let a=`mask:${r.mask.__v??"0"}`,i=t.maskTex.get(r.id);if(w+=1,i&&i.version===a)return i.used=w,C+=1,i.tex;k+=1;let n=r.mask.width*r.mask.height*4,o=i?.tex??e.createTexture();return P(e,o,r.mask),i&&(t.maskTex.delete(r.id),t.textureBytes-=i.bytes),n<=0x10000000&&D(e,t,n)?(t.maskTex.set(r.id,{tex:o,version:a,bytes:n,used:w}),t.textureBytes+=n):t.transientTex.add(o),o}function D(e,t,r){for(;t.textureBytes+r>0x10000000;){let r=null;for(let e of[t.layerTex,t.maskTex])for(let[a,i]of e)t.pinnedTex.has(i.tex)||(!r||i.used<r.entry.used)&&(r={map:e,key:a,entry:i});if(!r)return!1;r.map.delete(r.key),t.textureBytes-=r.entry.bytes,e.deleteTexture(r.entry.tex),R+=1}return!0}function F(e,t){for(let r of t.transientTex)e.deleteTexture(r);t.transientTex.clear(),t.pinnedTex.clear()}function $(e){e.drawArrays(e.TRIANGLE_STRIP,0,4)}let S=new WeakMap;function X(e){if(S.has(e))return S.get(e)??null;let t=null;try{t=e.getContext("2d",{colorSpace:"display-p3"})}catch{t=null}return t||(t=e.getContext("2d")),S.set(e,t),t}e.s(["bumpBitmapVersion",0,function(e){e.__v=(e.__v??0)+1},"getDisplayCtx",0,X,"gpuTextureCacheStats",0,function(){return{budgetBytes:0x10000000,residentBytes:A?.textureBytes??0,residentTextures:(A?.layerTex.size??0)+(A?.maskTex.size??0),framebufferBytes:A?A.a.w*A.a.h*16:0,hits:C,misses:k,evictions:R}},"isGLSupported",0,function(){if("u"<typeof document)return!1;let e=document.createElement("canvas").getContext("webgl2");return!!e&&!!e.getExtension("EXT_color_buffer_float")},"renderGL",0,function(e,a,i=!0,n=!0){if(e.layers.some(e=>{if(!e.kind.startsWith("adjustment-"))return!1;let r=(0,t.resolvedBlendPasses)(e).filter(e=>e.enabled&&e.opacity>0);return 1!==r.length||"source-over"!==r[0].mode||1!==r[0].opacity||!(0,h.isNeutralBlendIf)((0,t.resolvedBlendIf)(e))}))return!1;let o=function(e,t){var r;let a,i;if(A&&A.a.w===e&&A.a.h===t)return A;A&&function(){if(!A)return;let{gl:e}=A;for(let t of(e.deleteBuffer(A.quad),e.deleteProgram(A.comp.program),e.deleteProgram(A.adj.program),e.deleteProgram(A.curves.program),e.deleteProgram(A.levels.program),e.deleteProgram(A.hsl.program),e.deleteProgram(A.blit.program),e.deleteTexture(A.curvesLut),e.deleteFramebuffer(A.a.fb),e.deleteTexture(A.a.tex),e.deleteFramebuffer(A.b.fb),e.deleteTexture(A.b.tex),A.layerTex.values()))e.deleteTexture(t.tex);for(let t of A.maskTex.values())e.deleteTexture(t.tex);for(let t of A.transientTex)e.deleteTexture(t);e.deleteTexture(A.neutralMask),A=null}();let n=document.createElement("canvas");n.width=e,n.height=t;let o=n.getContext("webgl2",{premultipliedAlpha:!0,antialias:!1});if(!o||!o.getExtension("EXT_color_buffer_float"))return null;let l=o.createBuffer();o.bindBuffer(o.ARRAY_BUFFER,l),o.bufferData(o.ARRAY_BUFFER,new Float32Array([-1,-1,0,0,1,-1,1,0,-1,1,0,1,1,1,1,1]),o.STATIC_DRAW);let u=M(o,g,b,["u_base","u_layer","u_mask","u_hasMask","u_opacity","u_mode","u_seed","u_linear","u_blend_if_enabled","u_source_ranges[0]","u_underlying_ranges[0]"],["a_pos","a_uv"]),s=M(o,g,v,["u_src","u_mask","u_hasMask","u_opacity","u_linear","u_exposure","u_contrast","u_highlights","u_shadows","u_temperature","u_vibrance"],["a_pos","a_uv"]),c=M(o,g,_,["u_src","u_lut","u_mask","u_hasMask","u_opacity"],["a_pos","a_uv"]),f=M(o,g,x,["u_src","u_mask","u_hasMask","u_opacity","u_inBlack","u_inWhite","u_gamma","u_outBlack","u_outWhite"],["a_pos","a_uv"]),m=M(o,g,T,["u_src","u_mask","u_hasMask","u_opacity","u_hueDeg","u_satAmt","u_lightAmt"],["a_pos","a_uv"]),d=M(o,g,y,["u_src","u_size","u_proof_mode","u_proof_intent","u_black_point_compensation","u_gamut_warning","u_checkerboard"],["a_pos","a_uv"]),p=o.createTexture();o.bindTexture(o.TEXTURE_2D,p),o.texImage2D(o.TEXTURE_2D,0,o.R8,256,4,0,o.RED,o.UNSIGNED_BYTE,new Uint8Array(1024)),o.texParameteri(o.TEXTURE_2D,o.TEXTURE_MIN_FILTER,o.LINEAR),o.texParameteri(o.TEXTURE_2D,o.TEXTURE_MAG_FILTER,o.LINEAR),o.texParameteri(o.TEXTURE_2D,o.TEXTURE_WRAP_S,o.CLAMP_TO_EDGE),o.texParameteri(o.TEXTURE_2D,o.TEXTURE_WRAP_T,o.CLAMP_TO_EDGE);let h=U(o,e,t),E=U(o,e,t),w=(a=(r=o).createTexture(),r.bindTexture(r.TEXTURE_2D,a),i=new Uint8Array(16).fill(255),r.texImage2D(r.TEXTURE_2D,0,r.RGBA,2,2,0,r.RGBA,r.UNSIGNED_BYTE,i),r.texParameteri(r.TEXTURE_2D,r.TEXTURE_MIN_FILTER,r.LINEAR),r.texParameteri(r.TEXTURE_2D,r.TEXTURE_MAG_FILTER,r.LINEAR),r.texParameteri(r.TEXTURE_2D,r.TEXTURE_WRAP_S,r.CLAMP_TO_EDGE),r.texParameteri(r.TEXTURE_2D,r.TEXTURE_WRAP_T,r.CLAMP_TO_EDGE),a);return A={gl:o,canvas:n,quad:l,comp:u,adj:s,curves:c,levels:f,hsl:m,blit:d,a:h,b:E,displayCanvas:null,layerTex:new Map,maskTex:new Map,textureBytes:0,transientTex:new Set,pinnedTex:new Set,neutralMask:w,curvesLut:p,curvesLutKey:""}}(e.width,e.height);if(!o)return!1;let{gl:l}=o;F(l,o);let u=new Set(e.layers.map(e=>e.id)),s=new Set(e.layers.filter(e=>!!e.mask).map(e=>e.id));for(let[e,t]of o.layerTex)u.has(e)||(o.layerTex.delete(e),o.textureBytes-=t.bytes,l.deleteTexture(t.tex));for(let[e,t]of o.maskTex)s.has(e)||(o.maskTex.delete(e),o.textureBytes-=t.bytes,l.deleteTexture(t.tex));l.disable(l.BLEND);let c=o.a,f=o.b;l.bindFramebuffer(l.FRAMEBUFFER,c.fb),l.viewport(0,0,e.width,e.height),l.clearColor(0,0,0,0),l.clear(l.COLOR_BUFFER_BIT);for(let a=e.layers.length-1;a>=0;a--){let i=e.layers[a];if("group"===i.kind||!(0,t.effectiveLayerVisible)(e,i))continue;let n=(0,t.effectiveLayerOpacity)(e,i);if(n<=0)continue;let u=n===i.opacity?i:{...i,opacity:n};if(l.bindFramebuffer(l.FRAMEBUFFER,f.fb),l.viewport(0,0,e.width,e.height),l.clearColor(0,0,0,0),l.clear(l.COLOR_BUFFER_BIT),"adjustment-levels"===u.kind&&u.levels){l.useProgram(o.levels.program),I(l,o,o.levels),l.activeTexture(l.TEXTURE0),l.bindTexture(l.TEXTURE_2D,c.tex),l.uniform1i(o.levels.uniforms.u_src,0);let e=B(l,o,u);l.activeTexture(l.TEXTURE1),l.bindTexture(l.TEXTURE_2D,e??o.neutralMask),l.uniform1i(o.levels.uniforms.u_mask,1),l.uniform1i(o.levels.uniforms.u_hasMask,+!!e),l.uniform1f(o.levels.uniforms.u_opacity,u.opacity*(0,t.resolvedFillOpacity)(u)),l.uniform1f(o.levels.uniforms.u_inBlack,u.levels.inBlack),l.uniform1f(o.levels.uniforms.u_inWhite,u.levels.inWhite),l.uniform1f(o.levels.uniforms.u_gamma,u.levels.gamma),l.uniform1f(o.levels.uniforms.u_outBlack,u.levels.outBlack),l.uniform1f(o.levels.uniforms.u_outWhite,u.levels.outWhite),$(l)}else if("adjustment-hsl"===u.kind&&u.hsl){l.useProgram(o.hsl.program),I(l,o,o.hsl),l.activeTexture(l.TEXTURE0),l.bindTexture(l.TEXTURE_2D,c.tex),l.uniform1i(o.hsl.uniforms.u_src,0);let e=B(l,o,u);l.activeTexture(l.TEXTURE1),l.bindTexture(l.TEXTURE_2D,e??o.neutralMask),l.uniform1i(o.hsl.uniforms.u_mask,1),l.uniform1i(o.hsl.uniforms.u_hasMask,+!!e),l.uniform1f(o.hsl.uniforms.u_opacity,u.opacity*(0,t.resolvedFillOpacity)(u)),l.uniform1f(o.hsl.uniforms.u_hueDeg,u.hsl.hue),l.uniform1f(o.hsl.uniforms.u_satAmt,u.hsl.saturation/100),l.uniform1f(o.hsl.uniforms.u_lightAmt,u.hsl.lightness/100),$(l)}else if("adjustment-curves"===u.kind&&u.curves){!function(e,r,a){let i,n,o=(i=a.curves,n=e=>e.map(e=>`${e.x.toFixed(3)},${e.y.toFixed(3)}`).join("|"),`${n(i.rgb)};${n(i.r)};${n(i.g)};${n(i.b)}`);if(o===r.curvesLutKey)return;let l=new Uint8Array(1024),u=(0,t.curveToLut)(a.curves.rgb),s=(0,t.curveToLut)(a.curves.r),c=(0,t.curveToLut)(a.curves.g),f=(0,t.curveToLut)(a.curves.b);l.set(u,0),l.set(s,256),l.set(c,512),l.set(f,768),e.bindTexture(e.TEXTURE_2D,r.curvesLut),e.texImage2D(e.TEXTURE_2D,0,e.R8,256,4,0,e.RED,e.UNSIGNED_BYTE,l),r.curvesLutKey=o}(l,o,u),l.useProgram(o.curves.program),I(l,o,o.curves),l.activeTexture(l.TEXTURE0),l.bindTexture(l.TEXTURE_2D,c.tex),l.uniform1i(o.curves.uniforms.u_src,0),l.activeTexture(l.TEXTURE1),l.bindTexture(l.TEXTURE_2D,o.curvesLut),l.uniform1i(o.curves.uniforms.u_lut,1);let e=B(l,o,u);l.activeTexture(l.TEXTURE2),l.bindTexture(l.TEXTURE_2D,e??o.neutralMask),l.uniform1i(o.curves.uniforms.u_mask,2),l.uniform1i(o.curves.uniforms.u_hasMask,+!!e),l.uniform1f(o.curves.uniforms.u_opacity,u.opacity*(0,t.resolvedFillOpacity)(u)),$(l)}else if("adjustment-tone"===u.kind&&u.tone){l.useProgram(o.adj.program),I(l,o,o.adj),l.activeTexture(l.TEXTURE0),l.bindTexture(l.TEXTURE_2D,c.tex),l.uniform1i(o.adj.uniforms.u_src,0);let e=B(l,o,u);l.activeTexture(l.TEXTURE1),l.bindTexture(l.TEXTURE_2D,e??o.neutralMask),l.uniform1i(o.adj.uniforms.u_mask,1),l.uniform1i(o.adj.uniforms.u_hasMask,+!!e),l.uniform1i(o.adj.uniforms.u_linear,1),l.uniform1f(o.adj.uniforms.u_opacity,u.opacity*(0,t.resolvedFillOpacity)(u)),l.uniform1f(o.adj.uniforms.u_exposure,u.tone.exposure),l.uniform1f(o.adj.uniforms.u_contrast,u.tone.contrast),l.uniform1f(o.adj.uniforms.u_highlights,u.tone.highlights),l.uniform1f(o.adj.uniforms.u_shadows,u.tone.shadows),l.uniform1f(o.adj.uniforms.u_temperature,u.tone.temperature),l.uniform1f(o.adj.uniforms.u_vibrance,u.tone.vibrance),$(l)}else{let a=function(e,a,i,n){let o=n.id,l=function(e){let r=e.transform,a=`${r.tx.toFixed(2)}|${r.ty.toFixed(2)}|${r.sx.toFixed(4)}|${r.sy.toFixed(4)}|${r.rotation.toFixed(4)}`,i=e.filters?.map(e=>`${e.id}:${+!!e.enabled}:${e.opacity}:${e.kind}:${JSON.stringify(e.params)}`).join("|")??"",n=e.effects?.map(e=>`${e.id}:${+!!e.enabled}:${e.opacity}:${e.kind}:${e.color}:${e.blur}:${e.offsetX}:${e.offsetY}`).join("|")??"",o=(0,t.resolvedFillOpacity)(e).toFixed(4);if("raster"===e.kind||"smart-object"===e.kind){let t=e.surface?.stats().revision??0;return`raster:${t}:${e.bitmap?.__v??"0"}:${a}:${i}:${n}:${o}`}if("text"===e.kind&&e.text){let t=e.text;return`text:${t.text}|${t.font}|${t.color}|${t.align}|${t.x}|${t.y}|${t.lineHeight}|${t.layout??"point"}|${t.boxWidth??""}|${t.boxHeight??""}|${JSON.stringify(t.path??null)}|${a}:${i}:${n}:${o}`}if("shape"===e.kind&&e.shape){let t=e.shape;return`shape:${t.kind}|${t.x}|${t.y}|${t.w}|${t.h}|${t.fill}|${t.stroke}|${t.strokeWidth}|${t.radius}|${a}:${i}:${n}:${o}`}if("path"===e.kind&&e.path){let t=e.path,r=t.anchors.map(e=>`${e.x.toFixed(1)},${e.y.toFixed(1)}|${e.hIn.dx.toFixed(1)},${e.hIn.dy.toFixed(1)}|${e.hOut.dx.toFixed(1)},${e.hOut.dy.toFixed(1)}`).join(";");return`path:${+!!t.closed}|${t.fill}|${t.stroke}|${t.strokeWidth}|${r}|${a}:${i}:${n}:${o}`}return`unknown:${a}:${o}`}(n),u=a.layerTex.get(o);if(w+=1,u&&u.version===l)return u.used=w,C+=1,u.tex;k+=1;let s=i.width*i.height*(L(n,i)?8:4),c=u?.tex??e.createTexture();if(L(n,i)){let t=n.surface;for(let{key:r}of(e.bindTexture(e.TEXTURE_2D,c),e.pixelStorei(e.UNPACK_PREMULTIPLY_ALPHA_WEBGL,!1),e.pixelStorei(e.UNPACK_FLIP_Y_WEBGL,!1),e.texImage2D(e.TEXTURE_2D,0,e.RGBA16F,i.width,i.height,0,e.RGBA,e.FLOAT,null),t.store.entries())){let a=t.grid.parseKey(r),n=t.tileToFloat32Display(r,!0,!0);e.texSubImage2D(e.TEXTURE_2D,0,a.x,i.height-a.y-a.height,a.width,a.height,e.RGBA,e.FLOAT,n)}e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MIN_FILTER,e.LINEAR),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MAG_FILTER,e.LINEAR),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_S,e.CLAMP_TO_EDGE),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_T,e.CLAMP_TO_EDGE)}else P(e,c,function(e,a){let i=(0,t.newCanvas)(e.width,e.height),n=i.getContext("2d"),o=(0,t.newCanvas)(e.width,e.height),l=o.getContext("2d");for(let i of((0,r.drawLayerContentManaged)(l,a),d(o,a.filters),a.effects??[])){if(!i.enabled||i.opacity<=0||"drop-shadow"!==i.kind)continue;let r=(0,t.newCanvas)(e.width,e.height),a=r.getContext("2d");a.globalAlpha=i.opacity,a.shadowColor=i.color,a.shadowBlur=i.blur,a.shadowOffsetX=i.offsetX,a.shadowOffsetY=i.offsetY,a.drawImage(o,0,0),a.shadowColor="transparent",a.globalCompositeOperation="destination-out",a.globalAlpha=1,a.drawImage(o,0,0),n.drawImage(r,0,0)}if(n.globalAlpha=(0,t.resolvedFillOpacity)(a),n.drawImage(o,0,0),n.globalAlpha=1,a.clipping){let i=(0,t.findClippingBase)(e,a);if(i){let a=(0,t.newCanvas)(e.width,e.height);(0,r.drawLayerContentManaged)(a.getContext("2d"),i),n.globalCompositeOperation="destination-in",n.drawImage(a,0,0),n.globalCompositeOperation="source-over"}}return i}(i,n));return u&&(a.layerTex.delete(o),a.textureBytes-=u.bytes),s<=0x10000000&&D(e,a,s)?(a.layerTex.set(o,{tex:c,version:l,bytes:s,used:w}),a.textureBytes+=s):a.transientTex.add(c),c}(l,o,e,u);o.pinnedTex.add(a);let i=B(l,o,u);i&&o.pinnedTex.add(i);let n=(0,t.resolvedBlendIf)(u),s=["gray","red","green","blue"].map(e=>n.channels[e]),m=new Float32Array(s.flatMap(({source:e})=>[e.black,e.blackFeather,e.whiteFeather,e.white])),p=new Float32Array(s.flatMap(({underlying:e})=>[e.black,e.blackFeather,e.whiteFeather,e.white]));for(let r of(0,t.resolvedBlendPasses)(u)){if(!r.enabled||r.opacity<=0)continue;l.bindFramebuffer(l.FRAMEBUFFER,f.fb),l.viewport(0,0,e.width,e.height),l.clearColor(0,0,0,0),l.clear(l.COLOR_BUFFER_BIT),l.useProgram(o.comp.program),I(l,o,o.comp),l.activeTexture(l.TEXTURE0),l.bindTexture(l.TEXTURE_2D,c.tex),l.uniform1i(o.comp.uniforms.u_base,0),l.activeTexture(l.TEXTURE1),l.bindTexture(l.TEXTURE_2D,a),l.uniform1i(o.comp.uniforms.u_layer,1),l.activeTexture(l.TEXTURE2),l.bindTexture(l.TEXTURE_2D,i??o.neutralMask),l.uniform1i(o.comp.uniforms.u_mask,2),l.uniform1i(o.comp.uniforms.u_hasMask,+!!i),l.uniform1f(o.comp.uniforms.u_opacity,u.opacity*r.opacity),l.uniform1i(o.comp.uniforms.u_linear,1),l.uniform1i(o.comp.uniforms.u_blend_if_enabled,+!(0,h.isNeutralBlendIf)(n)),l.uniform4fv(o.comp.uniforms["u_source_ranges[0]"],m),l.uniform4fv(o.comp.uniforms["u_underlying_ranges[0]"],p);let t=Math.max(0,E.indexOf(r.mode));l.uniform1i(o.comp.uniforms.u_mode,t),l.uniform1f(o.comp.uniforms.u_seed,(0,h.blendPassSeed)(r.id)/0x100000000),$(l);let s=c;c=f,f=s}o.pinnedTex.delete(a),i&&o.pinnedTex.delete(i);continue}let s=c;c=f,f=s}l.bindFramebuffer(l.FRAMEBUFFER,null),l.viewport(0,0,o.canvas.width,o.canvas.height),l.useProgram(o.blit.program),I(l,o,o.blit),l.activeTexture(l.TEXTURE0),l.bindTexture(l.TEXTURE_2D,c.tex),l.uniform1i(o.blit.uniforms.u_src,0),l.uniform2f(o.blit.uniforms.u_size,o.canvas.width,o.canvas.height);let m=i&&"none"!==e.proofing.profile?"srgb"===e.proofing.profile?1:"display-p3"===e.proofing.profile?2:3:0,p="perceptual"===e.proofing.intent?1:"absolute-colorimetric"===e.proofing.intent?2:3*("saturation"===e.proofing.intent);l.uniform1i(o.blit.uniforms.u_proof_mode,m),l.uniform1i(o.blit.uniforms.u_proof_intent,p),l.uniform1i(o.blit.uniforms.u_black_point_compensation,+!!e.proofing.blackPointCompensation),l.uniform1i(o.blit.uniforms.u_gamut_warning,i&&e.proofing.gamutWarning?1:0),l.uniform1i(o.blit.uniforms.u_checkerboard,+!!n),$(l),a.width!==e.width&&(a.width=e.width),a.height!==e.height&&(a.height=e.height);let R=X(a);return R&&(R.setTransform(1,0,0,1,0,0),R.clearRect(0,0,a.width,a.height),R.drawImage(o.canvas,0,0)),o.displayCanvas=a,F(l,o),!0}],17798);var W=e.i(88796),O=e.i(79207);let G=[.96422,1,.82521],H=[.95047,1,1.08883];function z(e,[t,r,a]){return[e[0]*t+e[1]*r+e[2]*a,e[3]*t+e[4]*r+e[5]*a,e[6]*t+e[7]*r+e[8]*a]}function N(e,t){let r=(r,a)=>e[3*r]*t[a]+e[3*r+1]*t[a+3]+e[3*r+2]*t[a+6];return[r(0,0),r(0,1),r(0,2),r(1,0),r(1,1),r(1,2),r(2,0),r(2,1),r(2,2)]}function j(e){let[t,r,a,i,n,o,l,u,s]=e,c=n*s-o*u,f=o*l-i*s,m=i*u-n*l,d=t*c+r*f+a*m;if(!Number.isFinite(d)||1e-12>Math.abs(d))throw Error("Color matrix is singular and cannot be inverted.");let p=1/d;return[c*p,(a*u-r*s)*p,(r*o-a*n)*p,f*p,(t*s-a*l)*p,(a*i-t*o)*p,m*p,(r*l-t*u)*p,(t*n-r*i)*p]}let Y=[.8951,.2664,-.1614,-.7502,1.7135,.0367,.0389,-.0685,1.0296],q=j(Y);function Z([e,t]){if(!(t>0))throw Error("Chromaticity y must be greater than zero.");return[e/t,1,(1-e-t)/t]}function V(e,t,r,a){let i=Z(e),n=Z(t),o=Z(r),l=[i[0],n[0],o[0],i[1],n[1],o[1],i[2],n[2],o[2]],u=z(j(l),a);return[l[0]*u[0],l[1]*u[1],l[2]*u[2],l[3]*u[0],l[4]*u[1],l[5]*u[2],l[6]*u[0],l[7]*u[1],l[8]*u[2]]}function K([e,t,r]){let a=216/24389,i=24389/27,n=e=>e>a?Math.cbrt(e):(i*e+16)/116,o=n(e/G[0]),l=n(t/G[1]);return[116*l-16,500*(o-l),200*(l-n(r/G[2]))]}let J={kind:"identity"};class Q extends Error{constructor(e){super(e),this.name="IccProfileParseError"}}let ee=[1,3,4,5,7],et=["perceptual","relative-colorimetric","saturation","absolute-colorimetric"];function er(e,t){return Number.isFinite(t)&&"identity"!==e.kind?t<0?en(e,0)+t*eo(e,0):t>1?en(e,1)+(t-1)*eo(e,1):en(e,t):t}function ea(e,t){if(!Number.isFinite(t)||"identity"===e.kind)return t;let r=en(e,0),a=en(e,1);return t<r?(t-r)/eo(e,0):t>a?1+(t-a)/eo(e,1):function(e,t){if("identity"===e.kind)return t;if("gamma"===e.kind)return t**(1/e.gamma);if("sampled"===e.kind){if(0===e.samples.length)return t;if(1===e.samples.length)return t**(1/e.samples[0]);let r=0,a=e.samples.length-1;for(;a-r>1;){let i=r+a>>1;e.samples[i]<t?r=i:a=i}let i=e.samples[a]-e.samples[r],n=i>1e-12?(t-e.samples[r])/i:0;return(r+n)/(e.samples.length-1)}let[r,a=1,i=0,n=0,o=0,l=0,u=0]=e.parameters;switch(e.functionType){case 0:return t**(1/r);case 1:return(t**(1/r)-i)/a;case 2:return((t-n)**(1/r)-i)/a;case 3:return t<n*o?t/n:(t**(1/r)-i)/a;case 4:return t<n*o+u?(t-u)/n:((t-l)**(1/r)-i)/a}}(e,t)}function ei(e){let t=en(e,0);if(!Number.isFinite(t))return!1;for(let r=1;r<=256;r+=1){let a=en(e,r/256);if(!Number.isFinite(a)||a+1e-10<t)return!1;t=a}return eo(e,0)>0&&eo(e,1)>0}function en(e,t){if("identity"===e.kind)return t;if("gamma"===e.kind)return t**e.gamma;if("sampled"===e.kind){if(0===e.samples.length)return t;if(1===e.samples.length)return t**e.samples[0];let r=t*(e.samples.length-1),a=Math.min(e.samples.length-1,Math.floor(r)),i=Math.min(e.samples.length-1,a+1),n=r-a;return e.samples[a]*(1-n)+e.samples[i]*n}let[r,a=1,i=0,n=0,o=0,l=0,u=0]=e.parameters;switch(e.functionType){case 0:return t**r;case 1:return t>=-i/a?(a*t+i)**r:0;case 2:return t>=-i/a?(a*t+i)**r+n:n;case 3:return t>=o?(a*t+i)**r:n*t;case 4:return t>=o?(a*t+i)**r+l:n*t+u}}function eo(e,t){let r=1/65535,a=0===t?(en(e,r)-en(e,0))/r:(en(e,1)-en(e,1-r))/r;return Number.isFinite(a)&&a>1e-7?a:1e-7}function el(e){let t=function(e,t){let r=z(Y,e),a=z(Y,t);if(r.some(e=>1e-12>Math.abs(e)))throw Error("Source white cannot be chromatically adapted.");return N(q,N([a[0]/r[0],0,0,0,a[1]/r[1],0,0,0,a[2]/r[2]],Y))}(e.referenceWhite,G),r=N(t,e.matrixToXyz),a="kind"in e.trc?[e.trc,e.trc,e.trc]:e.trc;return function(e,t){if(j(e),!t.every(ei))throw Error("Every profile tone curve must be monotonically invertible.")}(r,a),{id:e.id,name:e.name,source:e.source??"registered",description:e.description,deviceClass:"named-color-space",colorSpace:"RGB",connectionSpace:"XYZ",matrixToPcs:r,matrixFromPcs:j(r),trc:a,lutToPcs:{},lutFromPcs:{},mediaWhitePoint:e.mediaWhitePoint??G,mediaBlackPoint:e.mediaBlackPoint??[0,0,0],chromaticAdaptationMatrix:t,defaultRenderingIntent:"relative-colorimetric",tags:{},warnings:[],capabilities:ep()}}let eu={A2B:{perceptual:"A2B0","relative-colorimetric":"A2B1",saturation:"A2B2"},B2A:{perceptual:"B2A0","relative-colorimetric":"B2A1",saturation:"B2A2"}};function es(e,t,r,a){let i={};for(let[n,o]of Object.entries(eu[r])){let l=t[o];if(!l)continue;let u=function(e,t,r,a){if("mAB "===t.type||"mBA "===t.type){let i="A2B"===r?"mAB ":"mBA ";return t.type!==i?(a.push(`LUT tag ${t.signature} uses ${t.type.trim()} but ${r} requires ${i.trim()}.`),null):function(e,t,r){if(t.size<32)return r.push(`LUT tag ${t.signature} is shorter than its v4 multi-function header.`),null;let a=e.getUint8(t.offset+8),i=e.getUint8(t.offset+9);if(3!==a||3!==i)return r.push(`LUT tag ${t.signature} uses ${a}→${i} channels; the lightweight evaluator supports only 3→3 pipelines.`),null;let n={b:e.getUint32(t.offset+12,!1),matrix:e.getUint32(t.offset+16,!1),m:e.getUint32(t.offset+20,!1),clut:e.getUint32(t.offset+24,!1),a:e.getUint32(t.offset+28,!1)};for(let[e,a]of Object.entries(n))if(0!==a&&(a<32||a%4!=0||a>=t.size))return r.push(`LUT tag ${t.signature} has an invalid ${e} element offset.`),null;let o=n.a?ec(e,t,n.a,3,"A",r):null,l=n.b?ec(e,t,n.b,3,"B",r):null,u=n.m?ec(e,t,n.m,3,"M",r):null,s=n.matrix?function(e,t,r,a){let i=t.offset+r;if(i+48>t.offset+t.size)return a.push(`LUT tag ${t.signature} has a truncated 3\xd74 matrix.`),null;let n=Array.from({length:12},(t,r)=>ev(e,i+4*r));return{coefficients:n.slice(0,9),offset:n.slice(9,12)}}(e,t,n.matrix,r):null,c=n.clut?function(e,t,r,a){let i=t.offset+r,n=t.offset+t.size;if(i+20>n)return a.push(`LUT tag ${t.signature} has a truncated CLUT header.`),null;let o=[e.getUint8(i),e.getUint8(i+1),e.getUint8(i+2)];if(o.some(e=>e<2))return a.push(`LUT tag ${t.signature} CLUT dimensions require at least two grid points.`),null;let l=e.getUint8(i+16);if(1!==l&&2!==l)return a.push(`LUT tag ${t.signature} CLUT precision must be one or two bytes.`),null;let u=o[0]*o[1]*o[2]*3;if(u>2e7||i+20+u*l>n)return a.push(`LUT tag ${t.signature} CLUT is truncated or exceeds the safe table limit.`),null;let s=new Float32Array(u);for(let t=0;t<u;t+=1)s[t]=1===l?e.getUint8(i+20+t)/255:e.getUint16(i+20+2*t,!1)/65535;return{gridPoints:o,precision:l,values:s}}(e,t,n.clut,r):null;if(!n.b)return r.push(`LUT tag ${t.signature} omits the required B curve set.`),null;if(n.a&&!o||!l||n.m&&!u||n.matrix&&!s||n.clut&&!c)return null;let f=!!o,m=!!u,d=!!s,p=!!c;return!f&&!p&&!m&&!d||!f&&!p&&m&&d||f&&p&&!m&&!d||f&&p&&m&&d?{type:"mAB "===t.type?"mAB":"mBA",inputChannels:3,outputChannels:3,gridPoints:c?Math.max(...c.gridPoints):null,aCurves:o,bCurves:l,mCurves:u,matrix:s,clut:c}:(r.push(`LUT tag ${t.signature} uses a processing-element combination forbidden by ICC.1.`),null)}(e,t,a)}return function(e,t,r){if("mft1"!==t.type&&"mft2"!==t.type)return r.push(`LUT tag ${t.signature} uses unsupported type ${t.type}.`),null;let a="mft1"===t.type?48:52;if(t.size<a)return r.push(`LUT tag ${t.signature} is truncated.`),null;let i=e.getUint8(t.offset+8),n=e.getUint8(t.offset+9),o=e.getUint8(t.offset+10);if(3!==i||3!==n||o<2||o>65)return r.push(`LUT tag ${t.signature} must be a 3-channel RGB/XYZ table with 2–65 grid points.`),null;let l=Array.from({length:9},(r,a)=>ev(e,t.offset+12+4*a)),u="mft1"===t.type?256:e.getUint16(t.offset+48,!1),s="mft1"===t.type?256:e.getUint16(t.offset+50,!1);if(u<2||s<2||u>65536||s>65536)return r.push(`LUT tag ${t.signature} has invalid one-dimensional table sizes.`),null;let c="mft1"===t.type?1:2,f=o**i*n,m=i*u+f+n*s;if(m>2e7||a+m*c>t.size)return r.push(`LUT tag ${t.signature} is truncated or exceeds the safe table limit.`),null;let d=t.offset+a,p=r=>{let a=new Float32Array(r);for(let i=0;i<r;i+=1)a[i]="mft1"===t.type?e.getUint8(d++)/255:e.getUint16(d+2*i,!1)/65535;return"mft2"===t.type&&(d+=2*r),a},h=[p(u),p(u),p(u)],g=p(f),b=[p(s),p(s),p(s)];return{type:t.type,inputChannels:3,outputChannels:3,gridPoints:o,matrix:l,inputTables:h,clut:g,outputTables:b}}(e,t,a)}(e,l,r,a);u&&(i[n]=u)}return i}function ec(e,t,r,a,i,n){let o=[],l=t.offset+r,u=t.offset+t.size;for(let r=0;r<a;r+=1){var s,c;let a;if(l+12>u)return n.push(`LUT tag ${t.signature} has a truncated ${i} curve set.`),null;let f=(s=e,c=l,String.fromCharCode(s.getUint8(c),s.getUint8(c+1),s.getUint8(c+2),s.getUint8(c+3)));if("curv"===f){let r=e.getUint32(l+8,!1);if(r>1048576)return n.push(`LUT tag ${t.signature} has an oversized embedded curve.`),null;a=12+2*r}else{if("para"!==f)return n.push(`LUT tag ${t.signature} ${i} curve ${r+1} uses unsupported type ${f}.`),null;let o=e.getUint16(l+8,!1);if(o>4)return n.push(`LUT tag ${t.signature} has an unsupported embedded parametric curve.`),null;a=12+4*ee[o]}if(a>u-l)return n.push(`LUT tag ${t.signature} has a truncated ${i} curve set.`),null;let m=ef(e,{signature:`${i}${r+1}`,type:f,offset:l,size:a},n);if(!m)return null;o.push(m),l=l+a+3&-4}return o}function ef(e,t,r){if(!t)return null;if("curv"===t.type){if(t.size<12)return null;let a=e.getUint32(t.offset+8,!1);if(0===a)return J;if(1===a){if(t.size<14)return null;let r=e.getUint16(t.offset+12,!1)/256;return r>0?{kind:"gamma",gamma:r}:null}return a>1048576||12+2*a>t.size?(r.push(`Curve tag ${t.signature} has an invalid sample count.`),null):{kind:"sampled",samples:Array.from({length:a},(r,a)=>e.getUint16(t.offset+12+2*a,!1)/65535)}}if("para"===t.type){if(t.size<12)return null;let a=e.getUint16(t.offset+8,!1);if(a>4)return r.push(`Parametric curve ${t.signature} uses unsupported function type ${a}.`),null;let i=ee[a];return 12+4*i>t.size?null:{kind:"parametric",functionType:a,parameters:Array.from({length:i},(r,a)=>ev(e,t.offset+12+4*a))}}return r.push(`TRC tag ${t.signature} uses unsupported type ${t.type}.`),null}function em(e,t){return!t||"XYZ "!==t.type||t.size<20?null:[ev(e,t.offset+8),ev(e,t.offset+12),ev(e,t.offset+16)]}function ed(e,t,r){if(r){if("desc"===r.type&&r.size>=12){let a=Math.min(t.getUint32(r.offset+8,!1),r.size-12);return eb(e.subarray(r.offset+12,r.offset+12+Math.max(0,a-1))).trim()||void 0}if("mluc"===r.type&&r.size>=28){let a=t.getUint32(r.offset+8,!1),i=t.getUint32(r.offset+12,!1);if(0===a||i<12||16+a*i>r.size)return;let n=r.offset+16,o=t.getUint32(n+4,!1),l=t.getUint32(n+8,!1);if(l>r.size||o>r.size-l)return;return(function(e){let t="";for(let r=0;r+1<e.length;r+=2)t+=String.fromCharCode(e[r]<<8|e[r+1]);return t})(e.subarray(r.offset+l,r.offset+l+o)).trim()||void 0}}}function ep(){return{model:"matrix-trc",canTransform:!0,canUseAsSource:!0,canUseAsDestination:!0,renderingIntents:{perceptual:"fallback-relative","relative-colorimetric":"native",saturation:"fallback-relative","absolute-colorimetric":"approximate"},blackPointCompensation:"heuristic",extendedRange:"linear-extrapolated",fallback:null}}function eh(e,t){return eb(e.subarray(t,t+4))}function eg(e){return e.trim()||"unknown"}function eb(e){return String.fromCharCode(...e)}function ev(e,t){return e.getInt32(t,!1)/65536}let e_=65535/32768;function ex(e,t){if("mAB"===e.type||"mBA"===e.type){var r;let a;return r=e,a=t.map(eC),"mAB"===r.type?(r.aCurves&&(a=eT(r.aCurves,a)),r.clut&&(a=eE(r.clut.values,r.clut.gridPoints,a)),r.mCurves&&(a=eT(r.mCurves,a)),r.matrix&&(a=ey(r.matrix,a)),eT(r.bCurves,a)):(a=eT(r.bCurves,a),r.matrix&&(a=ey(r.matrix,a)),r.mCurves&&(a=eT(r.mCurves,a)),r.clut&&(a=eE(r.clut.values,r.clut.gridPoints,a)),r.aCurves&&(a=eT(r.aCurves,a)),a)}let a=z(e.matrix,t).map(eC).map((t,r)=>ew(e.inputTables[r],t));return eE(e.clut,[e.gridPoints,e.gridPoints,e.gridPoints],a).map((t,r)=>ew(e.outputTables[r],t))}function eT(e,t){return t.map((t,r)=>eC(er(e[r],eC(t))))}function ey(e,t){return z(e.coefficients,t).map((t,r)=>eC(t+e.offset[r]))}function eE(e,t,r){let a=r.map((e,r)=>eC(e)*(t[r]-1)),i=a.map((e,r)=>Math.min(t[r]-1,Math.floor(e))),n=i.map((e,r)=>Math.min(t[r]-1,e+1)),o=a.map((e,t)=>e-i[t]),l=[0,0,0];for(let r=0;r<=1;r+=1){let a=r?n[0]:i[0],u=r?o[0]:1-o[0];for(let r=0;r<=1;r+=1){let s=r?n[1]:i[1],c=r?o[1]:1-o[1];for(let r=0;r<=1;r+=1){let f=r?n[2]:i[2],m=u*c*(r?o[2]:1-o[2]),d=((a*t[1]+s)*t[2]+f)*3;for(let t=0;t<3;t+=1)l[t]+=e[d+t]*m}}}return l}function ew(e,t){let r=eC(t)*(e.length-1),a=Math.floor(r),i=Math.min(e.length-1,a+1),n=r-a;return e[a]*(1-n)+e[i]*n}function eC(e){return Math.max(0,Math.min(1,e))}e.s(["ICC_XYZ_LUT_SCALE",0,e_,"IDENTITY_TONE_CURVE",0,J,"createMatrixTrcProfile",0,el,"evaluateIccLut",0,ex,"evaluateToneCurve",0,er,"invertToneCurve",0,ea,"parseIccProfile",0,function(e){var t,r,a,i,n,o,l,u,s,c,f,m,d,p;let h,g,b,v,_,x,T,y,E=e instanceof ArrayBuffer?new Uint8Array(e):new Uint8Array(e.buffer,e.byteOffset,e.byteLength);if(E.byteLength<132)throw new Q("ICC profile is shorter than its 132-byte minimum structure.");let w=new DataView(E.buffer,E.byteOffset,E.byteLength),C=w.getUint32(0,!1);if(C<132||C>E.byteLength)throw new Q("ICC profile size is invalid or truncated.");if("acsp"!==eh(E,36))throw new Q("ICC profile signature 'acsp' is missing.");let k=[];C<E.byteLength&&k.push("Trailing bytes after the declared ICC profile were ignored.");let R=w.getUint32(128,!1);if(R>4096||132+12*R>C)throw new Q("ICC tag table is invalid or truncated.");let A={};for(let e=0;e<R;e+=1){let t=132+12*e,r=eh(E,t),a=w.getUint32(t+4,!1),i=w.getUint32(t+8,!1);if(a>C||i>C-a||i<8){k.push(`Tag ${r} was ignored because its payload is out of bounds.`);continue}let n=eh(E,a);A[r]??={signature:r,type:n,offset:a,size:i}}let U=eh(E,12),M=eh(E,16),I=eh(E,20),P="RGB "===M&&"XYZ "===I?(h=em(t=w,(r=A).rXYZ),g=em(t,r.gXYZ),b=em(t,r.bXYZ),h&&g&&b?[h[0],g[0],b[0],h[1],g[1],b[1],h[2],g[2],b[2]]:null):null,L="RGB "===M?(a=w,i=A,n=k,(v=[i.rTRC,i.gTRC,i.bTRC].map(e=>ef(a,e,n))).every(Boolean)?v:null):null,B=null;if(P)try{B=j(P)}catch{k.push("RGB colorant matrix is singular.")}let D=L?.every(ei)??!1;L&&!D&&k.push("At least one TRC is not monotonically invertible.");let F=["D2B0","D2B1","D2B2","D2B3","B2D0","B2D1","B2D2","B2D3"],$=F.some(e=>A[e]),S=["A2B0","A2B1","A2B2","B2A0","B2A1","B2A2",...F].some(e=>A[e]),X="link"===U,W="XYZ "!==I||X?{}:es(w,A,"A2B",k),O="XYZ "!==I||X?{}:es(w,A,"B2A",k),H=Object.keys(W).length>0||Object.keys(O).length>0,z=!X&&!!(P&&B&&L&&D);$&&k.push("Float DToB/BToD multi-process elements are not evaluated; ICC fallback precedence uses supported AToB/BToA or matrix/TRC data when present."),!S||H||z||k.push(X?"Device-link transforms connect two device encodings directly and cannot be treated as PCS transforms.":"No supported three-channel RGB-to-XYZ LUT transform could be decoded; unsupported profiles still require a full ICC CMM.");let N=Array.from(E.subarray(84,100),e=>e.toString(16).padStart(2,"0")).join(""),Y=/^0+$/.test(N)?void 0:N,q=Y??function(e){let t=0x811c9dc5;for(let r of e)t^=r,t=Math.imul(t,0x1000193);return(t>>>0).toString(16).padStart(8,"0")}(E.subarray(0,C)),Z=ed(E,w,A.desc)??ed(E,w,A.dscm),V=em(w,A.wtpt)??G,K=em(w,A.bkpt)??[0,0,0],J=function(e,t){if(t&&"sf32"===t.type&&!(t.size<44))return Array.from({length:9},(r,a)=>ev(e,t.offset+8+4*a))}(w,A.chad),ee=et[w.getUint32(64,!1)]??"perceptual",er=E[8],ea=E[9]>>4,en=15&E[9];return{id:`icc:${q}`,name:Z??`ICC ${q.slice(0,8)}`,source:"icc",description:Z,version:`${er}.${ea}.${en}`,deviceClass:eg(U),colorSpace:eg(M),connectionSpace:X?"unknown":"XYZ "===(o=I)?"XYZ":"Lab "===o?"Lab":"unknown",matrixToPcs:z?P:null,matrixFromPcs:z?B:null,trc:z?L:null,lutToPcs:W,lutFromPcs:O,mediaWhitePoint:V,mediaBlackPoint:K,chromaticAdaptationMatrix:J,defaultRenderingIntent:ee,tags:A,profileId:Y,warnings:k,capabilities:H?(l=W,u=O,s=z,_=e=>!!(l[e]||u[e]),x=s||Object.keys(l).length>0,T=s||Object.keys(u).length>0,{model:"lut",canTransform:x||T,canUseAsSource:x,canUseAsDestination:T,renderingIntents:{perceptual:_("perceptual")?"native":"fallback-relative","relative-colorimetric":_("relative-colorimetric")||s?"native":"unsupported",saturation:_("saturation")?"native":"fallback-relative","absolute-colorimetric":_("relative-colorimetric")||s?"approximate":"unsupported"},blackPointCompensation:"heuristic",extendedRange:"clamped",fallback:null}):z?ep():(c=S?"unsupported-lut":"metadata-only",f=U,m=M,d=I,p=S,y="link"===f?"Device-link profiles transform directly between two device encodings and cannot be inserted as a PCS source or destination profile.":p?"This profile requires an ICC LUT or multi-process model outside the lightweight ICC evaluator's supported subset.":`Only invertible RGB-to-XYZ matrix/TRC profiles are transformable; profile uses ${eg(m)} to ${eg(d)}.`,{model:c,canTransform:!1,canUseAsSource:!1,canUseAsDestination:!1,renderingIntents:Object.fromEntries(et.map(e=>[e,"unsupported"])),blackPointCompensation:"unavailable",extendedRange:"unavailable",fallback:{reason:y,suggestedEngine:"LittleCMS/WASM"}})}}],2009);class ek extends Error{profile;constructor(e){super(e.capabilities.fallback?.reason??`Profile ${e.name} cannot be transformed.`),this.name="UnsupportedColorProfileError",this.profile=e}}function eR(e,t,r={}){(function(e){if(!e.capabilities.canUseAsSource||(!e.matrixToPcs||!e.trc)&&0===Object.keys(e.lutToPcs).length)throw new ek(e)})(e),function(e){if(!e.capabilities.canUseAsDestination||(!e.matrixFromPcs||!e.trc)&&0===Object.keys(e.lutFromPcs).length)throw new ek(e)}(t);let a=r.renderingIntent??e.defaultRenderingIntent,i="absolute-colorimetric"===a,n=eA(e.lutToPcs,a,!!(e.matrixToPcs&&e.trc)),o=eA(t.lutFromPcs,a,!!(t.matrixFromPcs&&t.trc)),l="relative-colorimetric"===a?"relative-colorimetric"===n.intent||!n.lut:n.intent===a,u="relative-colorimetric"===a?"relative-colorimetric"===o.intent||!o.lut:o.intent===a,s=l&&u,c=i?"absolute-colorimetric":s?a:l||u?"mixed":"relative-colorimetric",f=[];"perceptual"!==a&&"saturation"!==a||s||f.push(`The ${l||u?l?"destination profile":"source profile":"source and destination profiles"} lacked native ${a} tables; those stages used media-relative colorimetric processing.`),n.lut&&n.intent!==(i?"relative-colorimetric":a)&&f.push(`The source profile used its ${n.intent} table.`),o.lut&&o.intent!==(i?"relative-colorimetric":a)&&f.push(`The destination profile used its ${o.intent} table.`),i&&f.push("Absolute colorimetry is derived from media-relative data using profile white points.");let m=f.length?f.join(" "):null,d=!!(r.blackPointCompensation&&!i),p=t=>n.lut?ex(n.lut,t).map(e=>e*e_):z(e.matrixToPcs,[er(e.trc[0],t[0]),er(e.trc[1],t[1]),er(e.trc[2],t[2])]),h=e=>{if(o.lut)return ex(o.lut,e.map(e=>e/e_));let r=z(t.matrixFromPcs,e);return[ea(t.trc[0],r[0]),ea(t.trc[1],r[1]),ea(t.trc[2],r[2])]},g=r=>{var a,n,o;let l=p(r);return i?(a=l,n=e.mediaWhitePoint,o=t.mediaWhitePoint,l=a.map((e,t)=>e*n[t]/G[t]*G[t]/Math.max(1e-9,o[t]))):d&&(l=function(e,t,r){let a=Math.max(0,Math.min(.999999,t[1])),i=Math.max(0,Math.min(.999999,r[1]));if(1e-9>Math.abs(a-i))return[...e];let n=i+(e[1]-a)/(1-a)*(1-i);if(1e-12>Math.abs(e[1]))return[e[0],n,e[2]];let o=n/e[1];return[e[0]*o,n,e[2]*o]}(l,e.mediaBlackPoint,t.mediaBlackPoint)),h(l)};return{metadata:{sourceProfileId:e.id,destinationProfileId:t.id,requestedIntent:a,effectiveIntent:c,intentFallback:m,blackPointCompensation:d?"heuristic":"disabled",extendedRange:n.lut||o.lut?"clamped":"linear-extrapolated",alpha:"preserved-straight"},applyRgb:g,applyRgba:e=>{let t=g([e[0],e[1],e[2]]);return[t[0],t[1],t[2],e[3]]},applyRgbaBuffer:(e,t=new Float32Array(e.length))=>{if(e.length%4!=0)throw Error("RGBA color buffers must contain a multiple of four values.");if(t.length<e.length)throw Error("Destination color buffer is too small.");for(let r=0;r<e.length;r+=4){let a=g([e[r],e[r+1],e[r+2]]);t[r]=a[0],t[r+1]=a[1],t[r+2]=a[2],t[r+3]=e[r+3]}return t},toPcs:p,fromPcs:h}}function eA(e,t,r){let a="absolute-colorimetric"===t?"relative-colorimetric":t;if(e[a])return{lut:e[a],intent:a};if(r)return{lut:null,intent:null};for(let t of["relative-colorimetric","perceptual","saturation"])if(e[t])return{lut:e[t],intent:t};return{lut:null,intent:null}}class eU{#e=new Map;#t=0;#r=0;get(e,t,r={}){var a,i,n;let o=(a=e,i=t,n=r,[a.id,i.id,n.renderingIntent??a.defaultRenderingIntent,n.blackPointCompensation?"bpc":"no-bpc"].join("\0")),l=this.#e.get(o);if(l)return this.#t+=1,l;this.#r+=1;let u=eR(e,t,r);return this.#e.set(o,u),u}clear(){this.#e.clear(),this.#t=0,this.#r=0}get stats(){return{size:this.#e.size,hits:this.#t,misses:this.#r}}}class eM{#a=new Map;transforms=new eU;constructor(e=e$){for(const t of e)this.#a.set(t.id,t)}register(e,t={}){if(this.#a.has(e.id)&&!t.replace)throw Error(`Color profile '${e.id}' is already registered.`);return this.#a.set(e.id,e),this.transforms.clear(),e}unregister(e){let t=this.#a.delete(e);return t&&this.transforms.clear(),t}get(e){return this.#a.get(e)}require(e){let t=this.get(e);if(!t)throw Error(`Unknown color profile '${e}'.`);return t}list(){return[...this.#a.values()]}createTransform(e,t,r={}){return this.transforms.get(this.require(e),this.require(t),r)}}function eI(e,t,r,a={}){let i=a.renderingIntent??"relative-colorimetric",n=eR(e,t,{...a,renderingIntent:i}),o=eR(t,r,{renderingIntent:"relative-colorimetric"}),l=a.gamutTolerance??1e-7;return{metadata:{sourceProfileId:e.id,proofProfileId:t.id,displayProfileId:r.id,renderingIntent:i,gamutCheck:"proof-device-domain-and-deltaE76",clipping:"proof-simulation-only"},applyRgba:e=>{let t,r,a=[e[0],e[1],e[2]],i=n.applyRgb(a),u=o.toPcs(i),s=i.some(e=>e<-l||e>1+l),c=i.map(eP),f=o.toPcs(c),m=o.applyRgb(c),d=(t=K(u),r=K(f),Math.hypot(t[0]-r[0],t[1]-r[1],t[2]-r[2]));return{rgba:[m[0],m[1],m[2],e[3]],proofDeviceRgb:i,outOfGamut:s||d>l,deltaE76:d}}}}function eP(e){return Math.min(1,Math.max(0,e))}let eL={kind:"parametric",functionType:4,parameters:[2.4,1/1.055,.055/1.055,1/12.92,.04045,0,0]},eB=el({id:"builtin:srgb",name:"sRGB IEC 61966-2-1",source:"builtin",description:"D65 sRGB primaries and transfer function, adapted to D50 PCS.",matrixToXyz:V([.64,.33],[.3,.6],[.15,.06],H),referenceWhite:H,trc:eL}),eD=el({id:"builtin:linear-srgb",name:"Linear sRGB",source:"builtin",matrixToXyz:V([.64,.33],[.3,.6],[.15,.06],H),referenceWhite:H,trc:J}),eF=el({id:"builtin:display-p3",name:"Display P3",source:"builtin",description:"Display-P3 D65 primaries with the sRGB transfer function, adapted to D50 PCS.",matrixToXyz:V([.68,.32],[.265,.69],[.15,.06],H),referenceWhite:H,trc:eL}),e$=[eB,eD,eF,el({id:"builtin:linear-display-p3",name:"Linear Display P3",source:"builtin",description:"Linear-light Display-P3 working space, adapted to D50 PCS.",matrixToXyz:V([.68,.32],[.265,.69],[.15,.06],H),referenceWhite:H,trc:J}),el({id:"builtin:adobe-rgb-1998",name:"Adobe RGB (1998)",source:"builtin",matrixToXyz:V([.64,.33],[.21,.71],[.15,.06],H),referenceWhite:H,trc:{kind:"gamma",gamma:563/256}}),el({id:"builtin:rec2020",name:"ITU-R BT.2020",source:"builtin",matrixToXyz:V([.708,.292],[.17,.797],[.131,.046],H),referenceWhite:H,trc:{kind:"parametric",functionType:4,parameters:[1/.45,.909672415686275,(1.09929682680944-1)/1.09929682680944,1/4.5,.08124285829863151,0,0]}}),el({id:"builtin:prophoto-rgb",name:"ProPhoto RGB",source:"builtin",matrixToXyz:V([.7347,.2653],[.1596,.8404],[.0366,1e-4],G),referenceWhite:G,trc:{kind:"parametric",functionType:3,parameters:[1.8,1,0,1/16,1/32]}})],eS=new eM;e.s(["DISPLAY_P3_PROFILE",0,eF,"SRGB_PROFILE",0,eB,"createProofingTransform",0,eI,"defaultColorProfileRegistry",0,eS],68816);let eX=new Map,eW=0,eO=0;function eG(e){for(;(eX.size>6||eW>0x2000000)&&eX.size>1;){let t="",r=1/0;for(let[a,i]of eX)a===e||i.used>=r||(t=a,r=i.used);if(!t)break;eW-=eX.get(t).bytes,eX.delete(t)}let t=eX.get(e);t&&t.bytes>0x2000000&&(eW-=t.bytes,eX.delete(e))}function eH(e,r,a,i){let n=e.groupBufs[r];if(!n){n=(0,t.newCanvas)(a,i),e.groupBufs[r]=n;let o=`${a}:${i}`,l=eX.get(o);if(l){let e=a*i*4;l.bytes+=e,eW+=e,eG(o)}}return eN(n.getContext("2d"),a,i),n}function ez(e){let t=new Set(e.layers.filter(e=>"group"===e.kind).map(e=>e.id)),r=new Map;for(let a of e.layers){let e=a.parentId&&t.has(a.parentId)?a.parentId:void 0,i=r.get(e);i?i.push(a):r.set(e,[a])}return r}function eN(e,t,r){e.save(),e.setTransform(1,0,0,1,0,0),e.globalCompositeOperation="source-over",e.globalAlpha=1,e.filter="none",e.clearRect(0,0,t,r),e.restore()}function ej(e){return{x:e.outputWidth/e.width,y:e.outputHeight/e.height}}function eY(e){let t=ej(e);return{a:t.x,b:0,c:0,d:t.y,e:-e.x*t.x,f:-e.y*t.y}}function eq(e,t,r){let a;e.save(),a=ej(r),e.setTransform(a.x,0,0,a.y,-r.x*a.x,-r.y*a.y),e.drawImage(t,0,0),e.restore()}function eZ(e){return e<0?0:e>255?255:e}let eV=0,eK={brushFrameMs:16.7,navigationFrameMs:33.3,maximumDocumentEdge:5e4},eJ=[],eQ=new WeakMap,e0=new WeakMap,e1=0,e2=0,e3=0,e5=0;function e4(e,r,a,i=ez(e)){let n=function(e,r){let a=`${e}:${r}`,i=eX.get(a);if(i)return i.used=++eO,i.buffers;let n={a:(0,t.newCanvas)(e,r),b:(0,t.newCanvas)(e,r),layerBuf:(0,t.newCanvas)(e,r),contentBuf:(0,t.newCanvas)(e,r),effectBuf:(0,t.newCanvas)(e,r),clipBuf:(0,t.newCanvas)(e,r),groupBufs:[]},o=e*r*24;return eX.set(a,{buffers:n,bytes:o,used:++eO}),eW+=o,eG(a),n}(r.outputWidth,r.outputHeight),o=n.a.getContext("2d");eN(o,r.outputWidth,r.outputHeight);let l=a.focus,u=l?e.layers.find(e=>e.id===l.layerId):null;if(l&&u&&"full"!==l.context)if("mask"===l.target&&u.mask){var s,c,f,m;let t;"ghost"===l.context?(e7(o,n,e,r,i,void 0,0),e6(o,n,r),e9(o,n,u,r,!0)):(s=o,c=n,f=u,m=r,s.save(),s.fillStyle="#24262c",s.fillRect(0,0,m.outputWidth,m.outputHeight),s.restore(),e8((t=eH(c,30,m.outputWidth,m.outputHeight)).getContext("2d"),f,m),s.drawImage(t,0,0))}else{let t=function(e,t){let r=new Map(e.layers.map(e=>[e.id,e])),a=new Set,i=r.get(t);if(!i)return a;if(a.add(i.id),"group"===i.kind){let t=!0;for(;t;)for(let r of(t=!1,e.layers))!r.parentId||!a.has(r.parentId)||a.has(r.id)||(a.add(r.id),t=!0)}let n=new Set,o=i.parentId;for(;o&&!n.has(o);)n.add(o),a.add(o),o=r.get(o)?.parentId;return a}(e,u.id);if("ghost"===l.context){e7(o,n,e,r,i,void 0,0),e6(o,n,r);let a=eH(n,31,r.outputWidth,r.outputHeight);e7(a.getContext("2d"),n,e,r,i,void 0,0,t),o.drawImage(a,0,0)}else e7(o,n,e,r,i,void 0,0,t)}else e7(o,n,e,r,i,void 0,0),l?.target==="mask"&&u?.mask&&e9(o,n,u,r,!1);return(a.proofing??!0)&&function(e,t,r,a){let i=t.proofing;if("none"===i.profile&&!i.gamutWarning)return;let n="srgb"===i.profile||"display-p3"===i.profile?eI(eB,"display-p3"===i.profile?eF:eB,eB,{renderingIntent:i.intent,blackPointCompensation:i.blackPointCompensation}):null;for(let t=0;t<a;t+=O.DEFAULT_TILE_SIZE)for(let o=0;o<r;o+=O.DEFAULT_TILE_SIZE){let l=Math.min(O.DEFAULT_TILE_SIZE,r-o),u=Math.min(O.DEFAULT_TILE_SIZE,a-t),s=e.getImageData(o,t,l,u);for(let e=0;e<s.data.length;e+=4){if(0===s.data[e+3])continue;let t=s.data[e+3]/255,r=[s.data[e]/255,s.data[e+1]/255,s.data[e+2]/255],a=n?.applyRgba([r[0],r[1],r[2],t]),o=a?{rgb:a.rgba.slice(0,3),outOfGamut:a.outOfGamut}:(0,W.softProofDisplayRgb)(r,i.profile,i.intent,i.blackPointCompensation);i.gamutWarning&&o.outOfGamut?(s.data[e]=255,s.data[e+1]=0,s.data[e+2]=255):"none"!==i.profile&&(s.data[e]=Math.round(255*o.rgb[0]),s.data[e+1]=Math.round(255*o.rgb[1]),s.data[e+2]=Math.round(255*o.rgb[2]))}e.putImageData(s,o,t)}}(o,e,r.outputWidth,r.outputHeight),function(e,t,r,a){if("rgb"===a)return;let i=e.getImageData(0,0,t,r),n="red"===a?0:"green"===a?1:"blue"===a?2:3;for(let e=0;e<i.data.length;e+=4){let t=i.data[e+n];i.data[e]=t,i.data[e+1]=t,i.data[e+2]=t,"alpha"===a&&(i.data[e+3]=255)}e.putImageData(i,0,0)}(o,r.outputWidth,r.outputHeight,a.channelView??"rgb"),n.a}function e6(e,t,r){let a=t.b.getContext("2d");eN(a,r.outputWidth,r.outputHeight),a.drawImage(e.canvas,0,0),eN(e,r.outputWidth,r.outputHeight),e.save(),e.globalAlpha=.34,e.filter="grayscale(72%) saturate(55%)",e.drawImage(a.canvas,0,0),e.restore()}function e8(e,t,r){t.mask&&(eq(e,t.mask,r),e.save(),e.globalCompositeOperation="source-in",e.fillStyle="white",e.fillRect(0,0,r.outputWidth,r.outputHeight),e.restore())}function e9(e,t,r,a,i){let n=eH(t,30,a.outputWidth,a.outputHeight),o=n.getContext("2d");e8(o,r,a),o.save(),o.globalCompositeOperation="source-in",o.fillStyle=i?"rgba(105,87,245,.58)":"rgba(105,87,245,.34)",o.fillRect(0,0,a.outputWidth,a.outputHeight),o.restore(),e.drawImage(n,0,0)}function e7(e,a,i,n,o,l,u,s){let c=o.get(l)??[];for(let l=c.length-1;l>=0;l--){let f=c[l];if((!s||s.has(f.id))&&f.visible&&!(f.opacity<=0)){if("group"===f.kind){if(function(e){let r=(0,t.resolvedBlendPasses)(e);return 1===e.opacity&&1===(0,t.resolvedFillOpacity)(e)&&!e.mask&&!e.effects?.some(e=>e.enabled)&&!e.filters?.some(e=>e.enabled)&&1===r.length&&r[0].enabled&&"source-over"===r[0].mode&&1===r[0].opacity}(f))e7(e,a,i,n,o,f.id,u,s);else{let r=eH(a,u,n.outputWidth,n.outputHeight),l=r.getContext("2d");e7(l,a,i,n,o,f.id,u+1,s),f.mask&&(l.globalCompositeOperation="destination-in",eq(l,f.mask,n),l.globalCompositeOperation="source-over"),(0,h.compositeBlendStack)(e,r,(0,t.resolvedBlendPasses)(f),f.opacity*(0,t.resolvedFillOpacity)(f),(0,t.resolvedBlendIf)(f))}continue}"adjustment-tone"===f.kind&&f.tone?function(e,t,r,a){var i;let n,o,l,u,s;if(!r.tone)return;let c=t.b,f=c.getContext("2d");eN(f,a.outputWidth,a.outputHeight),f.save(),n=1+.35*(i=r.tone).exposure,o=1+i.contrast/100,l=1+i.vibrance/200,u=-(.4*i.temperature),s=Math.max(0,i.temperature)/200,f.filter=`brightness(${n}) contrast(${o}) saturate(${l}) hue-rotate(${u}deg) sepia(${s})`,f.drawImage(e.canvas,0,0),f.filter="none",function(e,t,r,a,i){if(0===a&&0===i)return;let n=e.getImageData(0,0,t,r),o=n.data,l=a/100,u=i/100;for(let e=0;e<o.length;e+=4){let t=o[e]/255,r=o[e+1]/255,a=o[e+2]/255,i=.2126*t+.7152*r+.0722*a,n=u*Math.pow(1-i,2)*.6+-(l*Math.pow(i,2)*.6);o[e]=eZ((t+n)*255),o[e+1]=eZ((r+n)*255),o[e+2]=eZ((a+n)*255)}e.putImageData(n,0,0)}(f,a.outputWidth,a.outputHeight,r.tone.highlights,r.tone.shadows),f.restore(),tt(e,t,c,r,a)}(e,a,f,n):"adjustment-curves"===f.kind&&f.curves?te(e,a,f,n,e=>(0,t.applyCurvesToImageData)(e,f.curves)):"adjustment-levels"===f.kind&&f.levels?te(e,a,f,n,e=>(0,t.applyLevelsToImageData)(e,f.levels)):"adjustment-hsl"===f.kind&&f.hsl?te(e,a,f,n,e=>(0,t.applyHslToImageData)(e,f.hsl)):function(e,a,i,n,o){let{layerBuf:l,contentBuf:u,effectBuf:s,clipBuf:c}=a,f=l.getContext("2d"),m=u.getContext("2d");eN(f,o.outputWidth,o.outputHeight),eN(m,o.outputWidth,o.outputHeight),(0,r.drawLayerContentManaged)(m,n,eY(o));let p=ej(o);for(let e of(d(u,n.filters,Math.sqrt(p.x*p.y)),n.effects??[])){if(!e.enabled||e.opacity<=0||"drop-shadow"!==e.kind)continue;let t=s.getContext("2d");eN(t,o.outputWidth,o.outputHeight),t.save(),t.globalCompositeOperation="source-over",t.globalAlpha=e.opacity,t.shadowColor=e.color,t.shadowBlur=e.blur*Math.sqrt(p.x*p.y),t.shadowOffsetX=e.offsetX*p.x,t.shadowOffsetY=e.offsetY*p.y,t.drawImage(u,0,0),t.shadowColor="transparent",t.globalCompositeOperation="destination-out",t.globalAlpha=1,t.drawImage(u,0,0),t.restore(),f.drawImage(s,0,0)}if(f.globalAlpha=(0,t.resolvedFillOpacity)(n),f.drawImage(u,0,0),f.globalAlpha=1,n.clipping){let e=(0,t.findClippingBase)(i,n);if(e){let t=c.getContext("2d");eN(t,o.outputWidth,o.outputHeight),(0,r.drawLayerContentManaged)(t,e,eY(o)),f.globalCompositeOperation="destination-in",f.drawImage(c,0,0),f.globalCompositeOperation="source-over"}}n.mask&&(f.globalCompositeOperation="destination-in",eq(f,n.mask,o),f.globalCompositeOperation="source-over"),(0,h.compositeBlendStack)(e,l,(0,t.resolvedBlendPasses)(n),n.opacity,(0,t.resolvedBlendIf)(n))}(e,a,i,f,n)}}}function te(e,t,r,a,i){let n=t.b,o=n.getContext("2d");eN(o,a.outputWidth,a.outputHeight),o.drawImage(e.canvas,0,0);let l=o.getImageData(0,0,a.outputWidth,a.outputHeight);i(l),o.putImageData(l,0,0),tt(e,t,n,r,a)}function tt(e,r,a,i,n){let o=a;if(i.mask){let e=r.layerBuf.getContext("2d");eN(e,n.outputWidth,n.outputHeight),e.drawImage(a,0,0),e.globalCompositeOperation="destination-in",eq(e,i.mask,n),e.globalCompositeOperation="source-over",o=r.layerBuf}(0,h.compositeBlendStack)(e,o,(0,t.resolvedBlendPasses)(i),i.opacity*(0,t.resolvedFillOpacity)(i),(0,t.resolvedBlendIf)(i))}function tr(e,t,r){let a=ej(r),i=-r.x*a.x,n=-r.y*a.y,o=t.width*a.x,l=t.height*a.y;e.save(),e.beginPath(),e.rect(i,n,o,l),e.clip(),e.fillStyle="#e9eaed",e.fillRect(i,n,o,l),e.fillStyle="#dfe1e5";let u=16*Math.floor(i/16),s=16*Math.floor(n/16);for(let t=s;t<n+l;t+=16)for(let r=u;r<i+o;r+=16)(Math.floor((r-i)/16)^Math.floor((t-n)/16))&1&&e.fillRect(r,t,16,16);e.restore()}function ta(e,t,r){if(!t.selection)return;let a=ej(r),i=t.selection.bounds;eV=(eV+1)%20,e.save(),e.strokeStyle="rgba(255,255,255,0.95)",e.lineWidth=1,e.setLineDash([6,4]),e.lineDashOffset=-eV,e.strokeRect((i.x-r.x)*a.x+.5,(i.y-r.y)*a.y+.5,Math.max(1,i.w*a.x-1),Math.max(1,i.h*a.y-1)),e.restore()}e.s(["renderClean",0,function(e,t){!function(e,t,r={}){let a={x:0,y:0,width:e.width,height:e.height,outputWidth:e.width,outputHeight:e.height};t.width!==e.width&&(t.width=e.width),t.height!==e.height&&(t.height=e.height);let i=e4(e,a,r),n=X(t);eN(n,t.width,t.height),(r.checkerboard??!0)&&tr(n,e,a),n.drawImage(i,0,0),(r.selectionOverlay??!0)&&e.selection&&ta(n,e,a)}(e,t,{checkerboard:!1,selectionOverlay:!1,proofing:!1})},"renderViewport",0,function(e,r,a,i={}){var n;let o="u"<typeof performance?Date.now():performance.now(),l=[a.x.toFixed(5),a.y.toFixed(5),a.width.toFixed(5),a.height.toFixed(5),a.outputWidth,a.outputHeight].join(":"),u=eQ.get(r)===l,s=r.width!==a.outputWidth||r.height!==a.outputHeight;r.width!==a.outputWidth&&(r.width=a.outputWidth),r.height!==a.outputHeight&&(r.height=a.outputHeight);let c=X(r),f=null,m=()=>f??=ez(e),d=O.DEFAULT_TILE_SIZE,p=function(e,t){let r=2;for(let a of e.layers){for(let e of a.filters??[])e.enabled&&("blur"===e.kind||"sharpen"===e.kind)&&(r=Math.max(r,(e.params.radius??8)*t*3));for(let e of a.effects??[])e.enabled&&"drop-shadow"===e.kind&&(r=Math.max(r,(2*e.blur+Math.abs(e.offsetX)+Math.abs(e.offsetY))*t))}return Math.max(2,Math.min(96,Math.ceil(r)))}(e,a.zoom),h=a.outputWidth/a.width,g=a.outputHeight/a.height,b=Math.ceil(a.outputWidth/d)*Math.ceil(a.outputHeight/d),v=i.dirtyRegions?.length?function(e,t,r=0,a=O.DEFAULT_TILE_SIZE){let i=new Set,n=e.outputWidth/e.width,o=e.outputHeight/e.height,l=Math.ceil(e.outputWidth/a),u=Math.ceil(e.outputHeight/a);for(let s of t){if(s.width<=0||s.height<=0)continue;let t=(s.x-e.x)*n-r,c=(s.y-e.y)*o-r,f=(s.x+s.width-e.x)*n+r,m=(s.y+s.height-e.y)*o+r;if(f<=0||m<=0||t>=e.outputWidth||c>=e.outputHeight)continue;let d=Math.max(0,Math.floor(t/a)),p=Math.min(l-1,Math.floor(Math.max(0,f-1e-6)/a)),h=Math.max(0,Math.floor(c/a)),g=Math.min(u-1,Math.floor(Math.max(0,m-1e-6)/a));for(let e=h;e<=g;e+=1)for(let t=d;t<=p;t+=1)i.add(`${t}:${e}`)}return i}(a,i.dirtyRegions,p,d):null,_=!s&&u&&!e.selection&&!!v;!_&&(eN(c,a.outputWidth,a.outputHeight),(i.checkerboard??!0)&&tr(c,e,a));let x=0;for(let r=0,n=0;r<a.outputHeight;r+=d,n+=1){let o=Math.min(d,a.outputHeight-r);for(let l=0,u=0;l<a.outputWidth;l+=d,u+=1){if(_&&!v.has(`${u}:${n}`))continue;let s=Math.min(d,a.outputWidth-l);_&&(c.save(),c.beginPath(),c.rect(l,r,s,o),c.clip(),eN(c,a.outputWidth,a.outputHeight),(i.checkerboard??!0)&&tr(c,e,a));let f=Math.max(0,l-p),b=Math.max(0,r-p),T=Math.min(a.outputWidth,l+s+p),y=Math.min(a.outputHeight,r+o+p),E=T-f,w=y-b,C=function(e,r,a,i){if(void 0===a.cacheRevision)return e4(e,r,a,i());let n=e0.get(e);n||(n={tiles:new Map,bytes:0},e0.set(e,n));let o=n.tiles,l=[a.cacheRevision,r.x.toFixed(5),r.y.toFixed(5),r.width.toFixed(5),r.height.toFixed(5),r.outputWidth,r.outputHeight,a.proofing??!0,a.channelView??"rgb",a.focus?.layerId??"project",a.focus?.target??"pixels",a.focus?.context??"full"].join(":");e1+=1;let u=o.get(l);if(u)return u.used=e1,e2+=1,u.canvas;e3+=1;let s=e4(e,r,a,i()),c=(0,t.newCanvas)(r.outputWidth,r.outputHeight);c.getContext("2d").drawImage(s,0,0);let f=r.outputWidth*r.outputHeight*4;for(o.set(l,{canvas:c,used:e1,bytes:f}),n.bytes+=f;(o.size>96||n.bytes>0x2000000)&&o.size>1;){let e="",t=1/0;for(let[r,a]of o)r===l||a.used>=t||(e=r,t=a.used);if(e)n.bytes-=o.get(e).bytes,o.delete(e),e5+=1;else break}return c}(e,{x:a.x+f/h,y:a.y+b/g,width:E/h,height:w/g,outputWidth:E,outputHeight:w},i,m);c.drawImage(C,l-f,r-b,s,o,l,r,s,o),_&&c.restore(),x+=1}}(i.selectionOverlay??!0)&&e.selection&&ta(c,e,a),eQ.set(r,l),n={durationMs:Math.max(0,("u"<typeof performance?Date.now():performance.now())-o),renderedTiles:x,totalTiles:b,partial:_},eJ.push(n),eJ.length>120&&eJ.shift()},"viewportRenderCacheStats",0,function(){return{hits:e2,misses:e3,evictions:e5,maxTilesPerDocument:96,maxBytesPerDocument:0x2000000,scratchCacheEntries:eX.size,scratchCacheBytes:eW,maxScratchCacheBytes:0x2000000}},"viewportRenderPerformanceStats",0,function(){let e=eJ.map(e=>e.durationMs).sort((e,t)=>e-t),t=eJ.at(-1),r=e.length?e.reduce((e,t)=>e+t,0)/e.length:0,a=e.length?e[Math.min(e.length-1,Math.floor(.95*e.length))]:0;return{samples:e.length,latestMs:t?.durationMs??0,averageMs:r,p95Ms:a,latestRenderedTiles:t?.renderedTiles??0,latestTotalTiles:t?.totalTiles??0,latestPartial:t?.partial??!1,targets:eK}}],90137)}]);