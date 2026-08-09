import {
  BlendMode,
  Document,
  Layer,
  curveToLut,
  effectiveLayerOpacity,
  effectiveLayerVisible,
  findClippingBase,
  newCanvas,
  resolvedBlendIf,
  resolvedBlendPasses,
  resolvedFillOpacity,
} from "./document";
import { drawLayerContentManaged } from "./precision-renderer";
import { applySmartFilters } from "./filters";
import { blendPassSeed, isNeutralBlendIf } from "./blend";
import { ADJUST_FS, BLIT_FS, COMPOSITE_FS, CURVES_FS, GL_BLEND_ORDER, HSL_FS, LEVELS_FS, VS } from "./gl-shaders";

// A single-doc-size WebGL2 float compositor.
// Design: ping-pong RGBA16F FBOs `A`/`B`. Bottom-up over layers, each pass
// renders into whichever isn't currently the composite. Final result is
// blitted to `target` (an on-screen 2D canvas) via drawImage.

type Program = {
  program: WebGLProgram;
  uniforms: Record<string, WebGLUniformLocation | null>;
  attribs: Record<string, number>;
};

type FBO = { fb: WebGLFramebuffer; tex: WebGLTexture; w: number; h: number };
type TextureCacheEntry = { tex: WebGLTexture; version: string; bytes: number; used: number };

export const GPU_TEXTURE_CACHE_BUDGET_BYTES = 256 * 1024 * 1024;
let gpuTextureClock = 0;
let gpuTextureHits = 0;
let gpuTextureMisses = 0;
let gpuTextureEvictions = 0;

type Cache = {
  gl: WebGL2RenderingContext;
  canvas: HTMLCanvasElement; // hidden offscreen GL surface
  quad: WebGLBuffer;
  comp: Program;
  adj: Program;
  curves: Program;
  levels: Program;
  hsl: Program;
  blit: Program;
  curvesLut: WebGLTexture;
  curvesLutKey: string;
  a: FBO;
  b: FBO;
  displayCanvas: HTMLCanvasElement | null; // last blit target
  // Per-layer content textures (keyed by layer.id + version tag)
  layerTex: Map<string, TextureCacheEntry>;
  maskTex: Map<string, TextureCacheEntry>;
  textureBytes: number;
  transientTex: Set<WebGLTexture>;
  pinnedTex: Set<WebGLTexture>;
  neutralMask: WebGLTexture;
};

let cache: Cache | null = null;

export function isGLSupported(): boolean {
  if (typeof document === "undefined") return false;
  const c = document.createElement("canvas");
  const gl = c.getContext("webgl2");
  if (!gl) return false;
  // Float rendering requires this extension for RGBA16F FBOs.
  return !!gl.getExtension("EXT_color_buffer_float");
}

function ensureCache(width: number, height: number): Cache | null {
  if (cache && cache.a.w === width && cache.a.h === height) return cache;
  if (cache) disposeCache();
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const gl = canvas.getContext("webgl2", { premultipliedAlpha: true, antialias: false });
  if (!gl) return null;
  const ext = gl.getExtension("EXT_color_buffer_float");
  if (!ext) return null;

  const quad = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  // Full-screen triangle strip: pos.xy, uv.xy
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([
      -1, -1, 0, 0,
       1, -1, 1, 0,
      -1,  1, 0, 1,
       1,  1, 1, 1,
    ]),
    gl.STATIC_DRAW,
  );

  const comp = compileProgram(gl, VS, COMPOSITE_FS, [
    "u_base", "u_layer", "u_mask", "u_hasMask", "u_opacity", "u_mode", "u_seed", "u_linear",
    "u_blend_if_enabled", "u_source_ranges[0]", "u_underlying_ranges[0]",
  ], ["a_pos", "a_uv"]);
  const adj = compileProgram(gl, VS, ADJUST_FS, [
    "u_src", "u_mask", "u_hasMask", "u_opacity", "u_linear",
    "u_exposure", "u_contrast", "u_highlights", "u_shadows", "u_temperature", "u_vibrance",
  ], ["a_pos", "a_uv"]);
  const curves = compileProgram(gl, VS, CURVES_FS, [
    "u_src", "u_lut", "u_mask", "u_hasMask", "u_opacity",
  ], ["a_pos", "a_uv"]);
  const levels = compileProgram(gl, VS, LEVELS_FS, [
    "u_src", "u_mask", "u_hasMask", "u_opacity",
    "u_inBlack", "u_inWhite", "u_gamma", "u_outBlack", "u_outWhite",
  ], ["a_pos", "a_uv"]);
  const hsl = compileProgram(gl, VS, HSL_FS, [
    "u_src", "u_mask", "u_hasMask", "u_opacity",
    "u_hueDeg", "u_satAmt", "u_lightAmt",
  ], ["a_pos", "a_uv"]);
  const blit = compileProgram(gl, VS, BLIT_FS, [
    "u_src", "u_size", "u_proof_mode", "u_proof_intent", "u_black_point_compensation", "u_gamut_warning", "u_checkerboard",
  ], ["a_pos", "a_uv"]);
  const curvesLut = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, curvesLut);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 256, 4, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array(256 * 4));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const a = makeFBO(gl, width, height);
  const b = makeFBO(gl, width, height);
  const neutralMask = whiteTex(gl, 2, 2);

  cache = {
    gl, canvas, quad, comp, adj, curves, levels, hsl, blit, a, b,
    displayCanvas: null,
    layerTex: new Map(),
    maskTex: new Map(),
    textureBytes: 0,
    transientTex: new Set(),
    pinnedTex: new Set(),
    neutralMask,
    curvesLut,
    curvesLutKey: "",
  };
  return cache;
}

function disposeCache() {
  if (!cache) return;
  const { gl } = cache;
  gl.deleteBuffer(cache.quad);
  gl.deleteProgram(cache.comp.program);
  gl.deleteProgram(cache.adj.program);
  gl.deleteProgram(cache.curves.program);
  gl.deleteProgram(cache.levels.program);
  gl.deleteProgram(cache.hsl.program);
  gl.deleteProgram(cache.blit.program);
  gl.deleteTexture(cache.curvesLut);
  gl.deleteFramebuffer(cache.a.fb);
  gl.deleteTexture(cache.a.tex);
  gl.deleteFramebuffer(cache.b.fb);
  gl.deleteTexture(cache.b.tex);
  for (const v of cache.layerTex.values()) gl.deleteTexture(v.tex);
  for (const v of cache.maskTex.values()) gl.deleteTexture(v.tex);
  for (const tex of cache.transientTex) gl.deleteTexture(tex);
  gl.deleteTexture(cache.neutralMask);
  cache = null;
}

function makeFBO(gl: WebGL2RenderingContext, w: number, h: number): FBO {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fb = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  const st = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  if (st !== gl.FRAMEBUFFER_COMPLETE) throw new Error("FBO incomplete: " + st);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { fb, tex, w, h };
}

function whiteTex(gl: WebGL2RenderingContext, w: number, h: number): WebGLTexture {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  const data = new Uint8Array(w * h * 4).fill(255);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

function compileProgram(
  gl: WebGL2RenderingContext,
  vsSrc: string,
  fsSrc: string,
  uniformNames: string[],
  attribNames: string[],
): Program {
  const compile = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(s);
      gl.deleteShader(s);
      throw new Error("Shader compile failed: " + log);
    }
    return s;
  };
  const vs = compile(gl.VERTEX_SHADER, vsSrc);
  const fs = compile(gl.FRAGMENT_SHADER, fsSrc);
  const p = gl.createProgram()!;
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error("Link failed: " + gl.getProgramInfoLog(p));
  }
  const uniforms: Record<string, WebGLUniformLocation | null> = {};
  for (const n of uniformNames) uniforms[n] = gl.getUniformLocation(p, n);
  const attribs: Record<string, number> = {};
  for (const n of attribNames) attribs[n] = gl.getAttribLocation(p, n);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  return { program: p, uniforms, attribs };
}

function bindQuad(gl: WebGL2RenderingContext, cache: Cache, program: Program) {
  gl.bindBuffer(gl.ARRAY_BUFFER, cache.quad);
  const pos = program.attribs["a_pos"];
  const uv = program.attribs["a_uv"];
  gl.enableVertexAttribArray(pos);
  gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 16, 0);
  gl.enableVertexAttribArray(uv);
  gl.vertexAttribPointer(uv, 2, gl.FLOAT, false, 16, 8);
}

function uploadCanvasTex(
  gl: WebGL2RenderingContext,
  tex: WebGLTexture,
  src: HTMLCanvasElement,
) {
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
}

function canUploadPrecisionDirect(layer: Layer, doc: Document) {
  const t = layer.transform;
  return !!layer.surface && layer.surface.grid.width === doc.width && layer.surface.grid.height === doc.height &&
    t.tx === 0 && t.ty === 0 && t.sx === 1 && t.sy === 1 && t.rotation === 0 &&
    !layer.filters?.length && !layer.effects?.length && !layer.clipping && resolvedFillOpacity(layer) === 1;
}

function uploadPrecisionTex(
  gl: WebGL2RenderingContext,
  tex: WebGLTexture,
  doc: Document,
  layer: Layer,
) {
  const surface = layer.surface!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, doc.width, doc.height, 0, gl.RGBA, gl.FLOAT, null);
  for (const { key } of surface.store.entries()) {
    const address = surface.grid.parseKey(key);
    const pixels = surface.tileToFloat32Display(key, true, true);
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      address.x,
      doc.height - address.y - address.height,
      address.width,
      address.height,
      gl.RGBA,
      gl.FLOAT,
      pixels,
    );
  }
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}

// Rasterize a layer's transformed content into a doc-sized canvas, so the GPU
// can treat all layer kinds (raster/text/shape) uniformly as a source texture.
function rasterizeLayer(doc: Document, layer: Layer): HTMLCanvasElement {
  const c = newCanvas(doc.width, doc.height);
  const ctx = c.getContext("2d")!;
  const content = newCanvas(doc.width, doc.height);
  const contentCtx = content.getContext("2d")!;
  drawLayerContentManaged(contentCtx, layer);
  applySmartFilters(content, layer.filters);
  for (const effect of layer.effects ?? []) {
    if (!effect.enabled || effect.opacity <= 0 || effect.kind !== "drop-shadow") continue;
    const effectCanvas = newCanvas(doc.width, doc.height);
    const effectCtx = effectCanvas.getContext("2d")!;
    effectCtx.globalAlpha = effect.opacity;
    effectCtx.shadowColor = effect.color;
    effectCtx.shadowBlur = effect.blur;
    effectCtx.shadowOffsetX = effect.offsetX;
    effectCtx.shadowOffsetY = effect.offsetY;
    effectCtx.drawImage(content, 0, 0);
    effectCtx.shadowColor = "transparent";
    effectCtx.globalCompositeOperation = "destination-out";
    effectCtx.globalAlpha = 1;
    effectCtx.drawImage(content, 0, 0);
    ctx.drawImage(effectCanvas, 0, 0);
  }
  ctx.globalAlpha = resolvedFillOpacity(layer);
  ctx.drawImage(content, 0, 0);
  ctx.globalAlpha = 1;
  if (layer.clipping) {
    const base = findClippingBase(doc, layer);
    if (base) {
      const clip = newCanvas(doc.width, doc.height);
      drawLayerContentManaged(clip.getContext("2d")!, base);
      ctx.globalCompositeOperation = "destination-in";
      ctx.drawImage(clip, 0, 0);
      ctx.globalCompositeOperation = "source-over";
    }
  }
  return c;
}

// Layer versioning key — used to invalidate the GPU cache when the layer's
// bitmap, shape, text, or transform changed since the last render.
function layerVersion(layer: Layer): string {
  const t = layer.transform;
  const tKey = `${t.tx.toFixed(2)}|${t.ty.toFixed(2)}|${t.sx.toFixed(4)}|${t.sy.toFixed(4)}|${t.rotation.toFixed(4)}`;
  const filterKey = layer.filters?.map((filter) => `${filter.id}:${filter.enabled ? 1 : 0}:${filter.opacity}:${filter.kind}:${JSON.stringify(filter.params)}`).join("|") ?? "";
  const effectKey = layer.effects?.map((effect) => `${effect.id}:${effect.enabled ? 1 : 0}:${effect.opacity}:${effect.kind}:${effect.color}:${effect.blur}:${effect.offsetX}:${effect.offsetY}`).join("|") ?? "";
  const fillKey = resolvedFillOpacity(layer).toFixed(4);
  if (layer.kind === "raster" || layer.kind === "smart-object") {
    const surfaceVersion = layer.surface?.stats().revision ?? 0;
    return `raster:${surfaceVersion}:${(layer.bitmap as unknown as { __v?: number } | undefined)?.__v ?? "0"}:${tKey}:${filterKey}:${effectKey}:${fillKey}`;
  }
  if (layer.kind === "text" && layer.text) {
    const s = layer.text;
    return `text:${s.text}|${s.font}|${s.color}|${s.align}|${s.x}|${s.y}|${s.lineHeight}|${s.layout ?? "point"}|${s.boxWidth ?? ""}|${s.boxHeight ?? ""}|${JSON.stringify(s.path ?? null)}|${tKey}:${filterKey}:${effectKey}:${fillKey}`;
  }
  if (layer.kind === "shape" && layer.shape) {
    const sh = layer.shape;
    return `shape:${sh.kind}|${sh.x}|${sh.y}|${sh.w}|${sh.h}|${sh.fill}|${sh.stroke}|${sh.strokeWidth}|${sh.radius}|${tKey}:${filterKey}:${effectKey}:${fillKey}`;
  }
  if (layer.kind === "path" && layer.path) {
    const p = layer.path;
    const anchorsKey = p.anchors
      .map((a) => `${a.x.toFixed(1)},${a.y.toFixed(1)}|${a.hIn.dx.toFixed(1)},${a.hIn.dy.toFixed(1)}|${a.hOut.dx.toFixed(1)},${a.hOut.dy.toFixed(1)}`)
      .join(";");
    return `path:${p.closed ? 1 : 0}|${p.fill}|${p.stroke}|${p.strokeWidth}|${anchorsKey}|${tKey}:${filterKey}:${effectKey}:${fillKey}`;
  }
  return `unknown:${tKey}:${fillKey}`;
}

function curvesKey(layer: Layer): string {
  const c = layer.curves!;
  const enc = (pts: { x: number; y: number }[]) => pts.map((p) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`).join("|");
  return `${enc(c.rgb)};${enc(c.r)};${enc(c.g)};${enc(c.b)}`;
}

function updateCurvesLut(gl: WebGL2RenderingContext, c: Cache, layer: Layer): boolean {
  const key = curvesKey(layer);
  if (key === c.curvesLutKey) return true;
  const lut = new Uint8Array(256 * 4);
  const rowRgb = curveToLut(layer.curves!.rgb);
  const rowR = curveToLut(layer.curves!.r);
  const rowG = curveToLut(layer.curves!.g);
  const rowB = curveToLut(layer.curves!.b);
  lut.set(rowRgb, 0);
  lut.set(rowR, 256);
  lut.set(rowG, 512);
  lut.set(rowB, 768);
  gl.bindTexture(gl.TEXTURE_2D, c.curvesLut);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 256, 4, 0, gl.RED, gl.UNSIGNED_BYTE, lut);
  c.curvesLutKey = key;
  return true;
}

// Bump a hidden version tag on the raster canvas whenever its pixels change.
// The renderer.ts hot paths mutate the bitmap in place; we tag from the outside
// by exposing this stamp function.
export function bumpBitmapVersion(canvas: HTMLCanvasElement) {
  const c = canvas as unknown as { __v: number };
  c.__v = (c.__v ?? 0) + 1;
}

function ensureLayerTex(
  gl: WebGL2RenderingContext,
  c: Cache,
  doc: Document,
  layer: Layer,
): WebGLTexture {
  const key = layer.id;
  const version = layerVersion(layer);
  const cached = c.layerTex.get(key);
  gpuTextureClock += 1;
  if (cached && cached.version === version) {
    cached.used = gpuTextureClock;
    gpuTextureHits += 1;
    return cached.tex;
  }
  gpuTextureMisses += 1;
  const bytes = doc.width * doc.height * (canUploadPrecisionDirect(layer, doc) ? 8 : 4);
  const tex = cached?.tex ?? gl.createTexture()!;
  if (canUploadPrecisionDirect(layer, doc)) uploadPrecisionTex(gl, tex, doc, layer);
  else uploadCanvasTex(gl, tex, rasterizeLayer(doc, layer));
  if (cached) {
    c.layerTex.delete(key);
    c.textureBytes -= cached.bytes;
  }
  if (bytes <= GPU_TEXTURE_CACHE_BUDGET_BYTES) {
    if (evictGpuTextures(gl, c, bytes)) {
      c.layerTex.set(key, { tex, version, bytes, used: gpuTextureClock });
      c.textureBytes += bytes;
    } else {
      c.transientTex.add(tex);
    }
  } else {
    c.transientTex.add(tex);
  }
  return tex;
}

function ensureMaskTex(
  gl: WebGL2RenderingContext,
  c: Cache,
  layer: Layer,
): WebGLTexture | null {
  if (!layer.mask) return null;
  const version = `mask:${(layer.mask as unknown as { __v?: number }).__v ?? "0"}`;
  const cached = c.maskTex.get(layer.id);
  gpuTextureClock += 1;
  if (cached && cached.version === version) {
    cached.used = gpuTextureClock;
    gpuTextureHits += 1;
    return cached.tex;
  }
  gpuTextureMisses += 1;
  const bytes = layer.mask.width * layer.mask.height * 4;
  const tex = cached?.tex ?? gl.createTexture()!;
  uploadCanvasTex(gl, tex, layer.mask);
  if (cached) {
    c.maskTex.delete(layer.id);
    c.textureBytes -= cached.bytes;
  }
  if (bytes <= GPU_TEXTURE_CACHE_BUDGET_BYTES) {
    if (evictGpuTextures(gl, c, bytes)) {
      c.maskTex.set(layer.id, { tex, version, bytes, used: gpuTextureClock });
      c.textureBytes += bytes;
    } else {
      c.transientTex.add(tex);
    }
  } else {
    c.transientTex.add(tex);
  }
  return tex;
}

function evictGpuTextures(gl: WebGL2RenderingContext, c: Cache, requiredBytes: number) {
  while (c.textureBytes + requiredBytes > GPU_TEXTURE_CACHE_BUDGET_BYTES) {
    let oldest: { map: Map<string, TextureCacheEntry>; key: string; entry: TextureCacheEntry } | null = null;
    for (const map of [c.layerTex, c.maskTex]) {
      for (const [key, entry] of map) {
        if (c.pinnedTex.has(entry.tex)) continue;
        if (!oldest || entry.used < oldest.entry.used) oldest = { map, key, entry };
      }
    }
    if (!oldest) return false;
    oldest.map.delete(oldest.key);
    c.textureBytes -= oldest.entry.bytes;
    gl.deleteTexture(oldest.entry.tex);
    gpuTextureEvictions += 1;
  }
  return true;
}

function pruneGpuTextures(gl: WebGL2RenderingContext, c: Cache, doc: Document) {
  const liveLayers = new Set(doc.layers.map((layer) => layer.id));
  const liveMasks = new Set(doc.layers.filter((layer) => !!layer.mask).map((layer) => layer.id));
  for (const [key, entry] of c.layerTex) {
    if (liveLayers.has(key)) continue;
    c.layerTex.delete(key);
    c.textureBytes -= entry.bytes;
    gl.deleteTexture(entry.tex);
  }
  for (const [key, entry] of c.maskTex) {
    if (liveMasks.has(key)) continue;
    c.maskTex.delete(key);
    c.textureBytes -= entry.bytes;
    gl.deleteTexture(entry.tex);
  }
}

function clearTransientGpuTextures(gl: WebGL2RenderingContext, c: Cache) {
  for (const tex of c.transientTex) gl.deleteTexture(tex);
  c.transientTex.clear();
  c.pinnedTex.clear();
}

export function gpuTextureCacheStats() {
  return {
    budgetBytes: GPU_TEXTURE_CACHE_BUDGET_BYTES,
    residentBytes: cache?.textureBytes ?? 0,
    residentTextures: (cache?.layerTex.size ?? 0) + (cache?.maskTex.size ?? 0),
    framebufferBytes: cache ? cache.a.w * cache.a.h * 8 * 2 : 0,
    hits: gpuTextureHits,
    misses: gpuTextureMisses,
    evictions: gpuTextureEvictions,
  };
}

function drawFullscreen(gl: WebGL2RenderingContext) {
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

// Global switch for gamma-correct linear compositing (sRGB <-> linear around
// blend math). Off by default to match legacy Photoshop pixel behavior; on
// gives physically correct light mixing (especially visible in soft-light,
// screen, and adjustment stacks).
let linearCompositing = true;
export function setLinearCompositing(on: boolean) { linearCompositing = on; }
export function isLinearCompositing() { return linearCompositing; }

export function renderGL(doc: Document, target: HTMLCanvasElement, proofing = true, checkerboard = true): boolean {
  // Adjustment programs transform the current composite directly. Route
  // adjustment layers with custom blend passes through the exact CPU path.
  if (doc.layers.some((layer) => {
    if (!layer.kind.startsWith("adjustment-")) return false;
    const enabled = resolvedBlendPasses(layer).filter((pass) => pass.enabled && pass.opacity > 0);
    return enabled.length !== 1 || enabled[0].mode !== "source-over" || enabled[0].opacity !== 1
      || !isNeutralBlendIf(resolvedBlendIf(layer));
  })) return false;
  const c = ensureCache(doc.width, doc.height);
  if (!c) return false;
  const { gl } = c;
  clearTransientGpuTextures(gl, c);
  pruneGpuTextures(gl, c, doc);
  gl.disable(gl.BLEND);

  // Start with the composite (A) cleared to transparent.
  let composite = c.a;
  let scratch = c.b;
  gl.bindFramebuffer(gl.FRAMEBUFFER, composite.fb);
  gl.viewport(0, 0, doc.width, doc.height);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);

  for (let i = doc.layers.length - 1; i >= 0; i--) {
    const sourceLayer = doc.layers[i];
    if (sourceLayer.kind === "group" || !effectiveLayerVisible(doc, sourceLayer)) continue;
    const opacity = effectiveLayerOpacity(doc, sourceLayer);
    if (opacity <= 0) continue;
    const layer = opacity === sourceLayer.opacity ? sourceLayer : { ...sourceLayer, opacity };

    // Render into `scratch`, sampling from `composite` as base.
    gl.bindFramebuffer(gl.FRAMEBUFFER, scratch.fb);
    gl.viewport(0, 0, doc.width, doc.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    if (layer.kind === "adjustment-levels" && layer.levels) {
      gl.useProgram(c.levels.program);
      bindQuad(gl, c, c.levels);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, composite.tex);
      gl.uniform1i(c.levels.uniforms["u_src"], 0);
      const maskTex = ensureMaskTex(gl, c, layer);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, maskTex ?? c.neutralMask);
      gl.uniform1i(c.levels.uniforms["u_mask"], 1);
      gl.uniform1i(c.levels.uniforms["u_hasMask"], maskTex ? 1 : 0);
      gl.uniform1f(c.levels.uniforms["u_opacity"], layer.opacity * resolvedFillOpacity(layer));
      gl.uniform1f(c.levels.uniforms["u_inBlack"], layer.levels.inBlack);
      gl.uniform1f(c.levels.uniforms["u_inWhite"], layer.levels.inWhite);
      gl.uniform1f(c.levels.uniforms["u_gamma"], layer.levels.gamma);
      gl.uniform1f(c.levels.uniforms["u_outBlack"], layer.levels.outBlack);
      gl.uniform1f(c.levels.uniforms["u_outWhite"], layer.levels.outWhite);
      drawFullscreen(gl);
    } else if (layer.kind === "adjustment-hsl" && layer.hsl) {
      gl.useProgram(c.hsl.program);
      bindQuad(gl, c, c.hsl);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, composite.tex);
      gl.uniform1i(c.hsl.uniforms["u_src"], 0);
      const maskTex = ensureMaskTex(gl, c, layer);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, maskTex ?? c.neutralMask);
      gl.uniform1i(c.hsl.uniforms["u_mask"], 1);
      gl.uniform1i(c.hsl.uniforms["u_hasMask"], maskTex ? 1 : 0);
      gl.uniform1f(c.hsl.uniforms["u_opacity"], layer.opacity * resolvedFillOpacity(layer));
      gl.uniform1f(c.hsl.uniforms["u_hueDeg"], layer.hsl.hue);
      gl.uniform1f(c.hsl.uniforms["u_satAmt"], layer.hsl.saturation / 100);
      gl.uniform1f(c.hsl.uniforms["u_lightAmt"], layer.hsl.lightness / 100);
      drawFullscreen(gl);
    } else if (layer.kind === "adjustment-curves" && layer.curves) {
      updateCurvesLut(gl, c, layer);
      gl.useProgram(c.curves.program);
      bindQuad(gl, c, c.curves);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, composite.tex);
      gl.uniform1i(c.curves.uniforms["u_src"], 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, c.curvesLut);
      gl.uniform1i(c.curves.uniforms["u_lut"], 1);
      const maskTex = ensureMaskTex(gl, c, layer);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, maskTex ?? c.neutralMask);
      gl.uniform1i(c.curves.uniforms["u_mask"], 2);
      gl.uniform1i(c.curves.uniforms["u_hasMask"], maskTex ? 1 : 0);
      gl.uniform1f(c.curves.uniforms["u_opacity"], layer.opacity * resolvedFillOpacity(layer));
      drawFullscreen(gl);
    } else if (layer.kind === "adjustment-tone" && layer.tone) {
      gl.useProgram(c.adj.program);
      bindQuad(gl, c, c.adj);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, composite.tex);
      gl.uniform1i(c.adj.uniforms["u_src"], 0);
      const maskTex = ensureMaskTex(gl, c, layer);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, maskTex ?? c.neutralMask);
      gl.uniform1i(c.adj.uniforms["u_mask"], 1);
      gl.uniform1i(c.adj.uniforms["u_hasMask"], maskTex ? 1 : 0);
      gl.uniform1i(c.adj.uniforms["u_linear"], linearCompositing ? 1 : 0);
      gl.uniform1f(c.adj.uniforms["u_opacity"], layer.opacity * resolvedFillOpacity(layer));
      gl.uniform1f(c.adj.uniforms["u_exposure"], layer.tone.exposure);
      gl.uniform1f(c.adj.uniforms["u_contrast"], layer.tone.contrast);
      gl.uniform1f(c.adj.uniforms["u_highlights"], layer.tone.highlights);
      gl.uniform1f(c.adj.uniforms["u_shadows"], layer.tone.shadows);
      gl.uniform1f(c.adj.uniforms["u_temperature"], layer.tone.temperature);
      gl.uniform1f(c.adj.uniforms["u_vibrance"], layer.tone.vibrance);
      drawFullscreen(gl);
    } else {
      const layerTex = ensureLayerTex(gl, c, doc, layer);
      c.pinnedTex.add(layerTex);
      const maskTex = ensureMaskTex(gl, c, layer);
      if (maskTex) c.pinnedTex.add(maskTex);
      const blendIf = resolvedBlendIf(layer);
      const blendIfChannels = (["gray", "red", "green", "blue"] as const).map((channel) => blendIf.channels[channel]);
      const sourceRanges = new Float32Array(blendIfChannels.flatMap(({ source }) => [source.black, source.blackFeather, source.whiteFeather, source.white]));
      const underlyingRanges = new Float32Array(blendIfChannels.flatMap(({ underlying }) => [underlying.black, underlying.blackFeather, underlying.whiteFeather, underlying.white]));
      for (const pass of resolvedBlendPasses(layer)) {
        if (!pass.enabled || pass.opacity <= 0) continue;
        gl.bindFramebuffer(gl.FRAMEBUFFER, scratch.fb);
        gl.viewport(0, 0, doc.width, doc.height);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.useProgram(c.comp.program);
        bindQuad(gl, c, c.comp);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, composite.tex);
        gl.uniform1i(c.comp.uniforms["u_base"], 0);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, layerTex);
        gl.uniform1i(c.comp.uniforms["u_layer"], 1);
        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, maskTex ?? c.neutralMask);
        gl.uniform1i(c.comp.uniforms["u_mask"], 2);
        gl.uniform1i(c.comp.uniforms["u_hasMask"], maskTex ? 1 : 0);
        gl.uniform1f(c.comp.uniforms["u_opacity"], layer.opacity * pass.opacity);
        gl.uniform1i(c.comp.uniforms["u_linear"], linearCompositing ? 1 : 0);
        gl.uniform1i(c.comp.uniforms["u_blend_if_enabled"], isNeutralBlendIf(blendIf) ? 0 : 1);
        gl.uniform4fv(c.comp.uniforms["u_source_ranges[0]"], sourceRanges);
        gl.uniform4fv(c.comp.uniforms["u_underlying_ranges[0]"], underlyingRanges);
        const modeIndex = Math.max(0, GL_BLEND_ORDER.indexOf(pass.mode as BlendMode));
        gl.uniform1i(c.comp.uniforms["u_mode"], modeIndex);
        gl.uniform1f(c.comp.uniforms["u_seed"], blendPassSeed(pass.id) / 4294967296);
        drawFullscreen(gl);
        const tmp = composite;
        composite = scratch;
        scratch = tmp;
      }
      c.pinnedTex.delete(layerTex);
      if (maskTex) c.pinnedTex.delete(maskTex);
      continue;
    }

    // Swap composite <-> scratch.
    const tmp = composite;
    composite = scratch;
    scratch = tmp;
  }

  // Blit composite -> internal GL canvas (default framebuffer).
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, c.canvas.width, c.canvas.height);
  gl.useProgram(c.blit.program);
  bindQuad(gl, c, c.blit);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, composite.tex);
  gl.uniform1i(c.blit.uniforms["u_src"], 0);
  gl.uniform2f(c.blit.uniforms["u_size"], c.canvas.width, c.canvas.height);
  const proofMode = !proofing || doc.proofing.profile === "none" ? 0
    : doc.proofing.profile === "srgb" ? 1
    : doc.proofing.profile === "display-p3" ? 2 : 3;
  const proofIntent = doc.proofing.intent === "perceptual" ? 1
    : doc.proofing.intent === "absolute-colorimetric" ? 2
    : doc.proofing.intent === "saturation" ? 3 : 0;
  gl.uniform1i(c.blit.uniforms["u_proof_mode"], proofMode);
  gl.uniform1i(c.blit.uniforms["u_proof_intent"], proofIntent);
  gl.uniform1i(c.blit.uniforms["u_black_point_compensation"], doc.proofing.blackPointCompensation ? 1 : 0);
  gl.uniform1i(c.blit.uniforms["u_gamut_warning"], proofing && doc.proofing.gamutWarning ? 1 : 0);
  gl.uniform1i(c.blit.uniforms["u_checkerboard"], checkerboard ? 1 : 0);
  drawFullscreen(gl);

  // Blit GL result to the display 2D canvas.
  if (target.width !== doc.width) target.width = doc.width;
  if (target.height !== doc.height) target.height = doc.height;
  const dctx = getDisplayCtx(target);
  if (dctx) {
    dctx.setTransform(1, 0, 0, 1, 0, 0);
    dctx.clearRect(0, 0, target.width, target.height);
    dctx.drawImage(c.canvas, 0, 0);
  }
  c.displayCanvas = target;
  clearTransientGpuTextures(gl, c);
  return true;
}

// Cache the display context so we don't re-request a different color space on
// every frame (which would fail after the first getContext call anyway).
const displayCtxMap = new WeakMap<HTMLCanvasElement, CanvasRenderingContext2D | null>();
export function getDisplayCtx(target: HTMLCanvasElement): CanvasRenderingContext2D | null {
  if (displayCtxMap.has(target)) return displayCtxMap.get(target) ?? null;
  let ctx: CanvasRenderingContext2D | null = null;
  try {
    // Newer browsers accept a colorSpace hint. Silently fall back on error.
    ctx = target.getContext("2d", { colorSpace: "display-p3" }) as CanvasRenderingContext2D | null;
  } catch {
    ctx = null;
  }
  if (!ctx) ctx = target.getContext("2d");
  displayCtxMap.set(target, ctx);
  return ctx;
}

export function displayColorSpace(target: HTMLCanvasElement): string {
  const ctx = getDisplayCtx(target);
  if (!ctx) return "unknown";
  try {
    // ContextAttributes reports the actual granted color space.
    const settings = ctx.getContextAttributes?.() as { colorSpace?: string } | null;
    if (settings?.colorSpace) return settings.colorSpace;
  } catch {
    /* ignore */
  }
  return "srgb";
}

export function disposeGL() {
  disposeCache();
}
