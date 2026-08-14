import assert from "node:assert/strict";
import test from "node:test";
import {
  nativeCanUseSurfaceDirectly,
  nativeFlattenRefusal,
  tileFromContext,
} from "../app/engine/native-flatten.ts";
import {
  createCurvesLayer,
  createDocument,
  createGroupLayer,
  createRasterLayer,
  newCanvas,
} from "../app/engine/document.ts";
import type { BlendMode, Document, Layer } from "../app/engine/document.ts";
import { NATIVE_WIRE_BLEND_MODES } from "../app/engine/native-core.ts";
import { blendRgb } from "../app/engine/blend.ts";

/** blend.ts keeps Rgb internal; the wire is plain triples either way. */
type Rgb = [number, number, number];
import { renderClean } from "../app/engine/renderer.ts";
import { Studio } from "../app/engine/studio.ts";
import { pixelAt, testCanvas } from "./canvas-harness.ts";

// ---------------------------------------------------------------------------
// The native compositor used to refuse nearly every real document: groups,
// clipping, smart filters, ANY enabled effect, non-neutral Blend If, and any
// non-identity transform. It fired only on flat stacks of untransformed raster
// layers, which made the pro edition's headline feature close to inert.
//
// Most of that was never Rust's limitation — transforms, filters and effects
// happen before a layer reaches any compositor. These tests pin what is now
// accepted, what is still refused, and *why*, because "returns null" cannot
// tell a refusal apart from an absent Rust binary.
// ---------------------------------------------------------------------------

function docWith(...layers: Layer[]): Document {
  const doc = createDocument(64, 48);
  doc.layers = layers;
  return doc;
}

function raster(name = "layer"): Layer {
  return createRasterLayer(name, newCanvas(64, 48));
}

// --- what the native path now accepts ---------------------------------------

test("a transformed layer no longer sinks the document", () => {
  const moved = raster();
  moved.transform = { ...moved.transform, tx: 12, ty: -4, rotation: 0.3, sx: 1.5, sy: 1.5 };
  assert.equal(nativeFlattenRefusal(docWith(moved)), null);
  assert.equal(nativeCanUseSurfaceDirectly(moved, docWith(moved)), false,
    "but it has to be rasterized rather than sent as a raw surface");
});

test("smart filters and self-contained effects are accepted", () => {
  const filtered = raster();
  filtered.filters = [{ id: "f1", kind: "blur", enabled: true, opacity: 1, params: { radius: 3 } }];
  assert.equal(nativeFlattenRefusal(docWith(filtered)), null);

  const styled = raster();
  styled.effects = [{
    id: "e1", kind: "drop-shadow", enabled: true, opacity: 1,
    color: "#000000", blur: 4, offsetX: 3, offsetY: 3,
  }];
  assert.equal(nativeFlattenRefusal(docWith(styled)), null);
});

test("a clipped layer is accepted, because its base bakes in when it rasterizes", () => {
  const base = raster("base");
  // Clipped-as-group off: the base is not asking for a nested composite.
  base.blendClippedAsGroup = false;
  const clipped = { ...raster("clipped"), clipping: true };
  assert.equal(nativeFlattenRefusal(docWith(clipped, base)), null);
});

test("masks, fill opacity and multiple blend passes are all accepted", () => {
  const layer = raster();
  layer.mask = newCanvas(64, 48);
  layer.fillOpacity = 0.4;
  layer.blendStack = [
    { id: "p1", mode: "multiply", opacity: 1, enabled: true },
    { id: "p2", mode: "screen", opacity: 0.5, enabled: true },
  ];
  assert.equal(nativeFlattenRefusal(docWith(layer)), null);
});

// --- what is still refused, and why -----------------------------------------

test("each remaining refusal names its own reason", () => {
  const group = createGroupLayer("group");
  assert.equal(nativeFlattenRefusal(docWith(group)), "group");

  const child = { ...raster(), parentId: "some-group" };
  assert.equal(nativeFlattenRefusal(docWith(child)), "group");

  assert.equal(nativeFlattenRefusal(docWith(createCurvesLayer("curves"))), "adjustment-layer");

  const knocked = { ...raster(), knockout: "deep" as const };
  assert.equal(nativeFlattenRefusal(docWith(knocked)), "knockout");

  const gated = raster();
  gated.blendIf = {
    activeChannel: "gray",
    channels: {
      gray: { source: { black: 0.3, blackFeather: 0.3, whiteFeather: 1, white: 1 }, underlying: { black: 0, blackFeather: 0, whiteFeather: 1, white: 1 } },
      red: { source: { black: 0, blackFeather: 0, whiteFeather: 1, white: 1 }, underlying: { black: 0, blackFeather: 0, whiteFeather: 1, white: 1 } },
      green: { source: { black: 0, blackFeather: 0, whiteFeather: 1, white: 1 }, underlying: { black: 0, blackFeather: 0, whiteFeather: 1, white: 1 } },
      blue: { source: { black: 0, blackFeather: 0, whiteFeather: 1, white: 1 }, underlying: { black: 0, blackFeather: 0, whiteFeather: 1, white: 1 } },
    },
  };
  assert.equal(nativeFlattenRefusal(docWith(gated)), "blend-if");

  const oneChannel = { ...raster(), blendChannels: { r: true, g: false, b: true } };
  assert.equal(nativeFlattenRefusal(docWith(oneChannel)), "channel-mask");

  const frosted = raster();
  frosted.effects = [{
    id: "e1", kind: "backdrop-blur", enabled: true, opacity: 1,
    color: "#000000", blur: 6, offsetX: 0, offsetY: 0,
  }];
  assert.equal(nativeFlattenRefusal(docWith(frosted)), "backdrop-effect");

  const wide = docWith(raster());
  wide.colorSpace = "display-p3";
  assert.equal(nativeFlattenRefusal(wide), "color-space");
});

test("clipped-as-group is refused, but only when the base actually asks for it", () => {
  const clipped = { ...raster("clipped"), clipping: true };
  const grouping = raster("base");
  grouping.blendClippedAsGroup = true;
  assert.equal(nativeFlattenRefusal(docWith(clipped, grouping)), "clipped-group");

  // The default is on, so an unset base groups too — this is the common case
  // and getting the default backwards would silently change every export.
  const defaulted = raster("base");
  assert.equal(nativeFlattenRefusal(docWith({ ...raster("c"), clipping: true }, defaulted)), "clipped-group");
});

test("hidden layers cannot refuse a document they do not appear in", () => {
  const hidden = { ...createGroupLayer("group"), visible: false };
  assert.equal(nativeFlattenRefusal(docWith(hidden, raster())), null);

  const transparent = { ...createCurvesLayer("curves"), opacity: 0 };
  assert.equal(nativeFlattenRefusal(docWith(transparent, raster())), null);
});

// --- the direct-surface fast path -------------------------------------------

test("an untouched layer goes across as a precision surface", () => {
  const doc = createDocument(64, 48);
  const plain = raster();
  plain.surface = { grid: { width: 64, height: 48 } } as unknown as Layer["surface"];
  assert.equal(nativeCanUseSurfaceDirectly(plain, doc), true);
});

test("anything standing between the stored pixels and the composite forces a rasterize", () => {
  const doc = createDocument(64, 48);
  const surface = { grid: { width: 64, height: 48 } } as unknown as Layer["surface"];
  const variants: Array<[string, Partial<Layer>]> = [
    ["a transform", { transform: { tx: 5, ty: 0, sx: 1, sy: 1, rotation: 0 } }],
    ["a scale", { transform: { tx: 0, ty: 0, sx: 2, sy: 1, rotation: 0 } }],
    ["a rotation", { transform: { tx: 0, ty: 0, sx: 1, sy: 1, rotation: 0.1 } }],
    ["a smart filter", { filters: [{ id: "f", kind: "blur", enabled: true, opacity: 1, params: {} }] }],
    ["an effect", { effects: [{ id: "e", kind: "stroke", enabled: true, opacity: 1, color: "#fff", blur: 0, offsetX: 0, offsetY: 0 }] }],
    ["clipping", { clipping: true }],
    ["a vector mask", { vectorMask: { anchors: [], closed: true, fill: "#fff", stroke: "none", strokeWidth: 0 } }],
    ["transparency shapes layer off", { transparencyShapesLayer: false }],
  ];
  for (const [what, patch] of variants) {
    const layer = { ...raster(), surface, ...patch } as Layer;
    assert.equal(nativeCanUseSurfaceDirectly(layer, doc), false, `${what} must force a rasterize`);
  }

  // A disabled filter or effect changes nothing, so it must not cost the fast path.
  const inert = {
    ...raster(),
    surface,
    filters: [{ id: "f", kind: "blur" as const, enabled: false, opacity: 1, params: {} }],
    effects: [{ id: "e", kind: "stroke" as const, enabled: false, opacity: 1, color: "#fff", blur: 0, offsetX: 0, offsetY: 0 }],
  } as Layer;
  assert.equal(nativeCanUseSurfaceDirectly(inert, doc), true);
});

test("a layer with no surface at all cannot use the direct path", () => {
  assert.equal(nativeCanUseSurfaceDirectly(raster(), createDocument(64, 48)), false);
});

// --- the tile reader --------------------------------------------------------

test("a rasterized tile arrives as normalised floats in the right place", () => {
  const canvas = newCanvas(64, 48);
  const context = canvas.getContext("2d")!;
  context.fillStyle = "rgba(255, 128, 0, 1)";
  context.fillRect(32, 0, 32, 48);

  const right = tileFromContext(context, { x: 32, y: 0, width: 8, height: 4 });
  assert.equal(right.length, 8 * 4 * 4);
  assert.ok(Math.abs(right[0] - 1) < 0.01, `red should be 1.0, got ${right[0]}`);
  assert.ok(Math.abs(right[1] - 128 / 255) < 0.01, `green should be ~0.5, got ${right[1]}`);
  assert.equal(right[2], 0);
  assert.equal(right[3], 1);

  // The left half was never painted, so the tile offset has to be honoured or
  // every rasterized layer would composite the wrong region.
  const left = tileFromContext(context, { x: 0, y: 0, width: 8, height: 4 });
  assert.equal(left[3], 0, "the unpainted half should still be transparent");
});

// --- end to end against the portable renderer -------------------------------
//
// The Rust binary is not present under `node --test`, so the compositor itself
// is stood in for — by decoding the real wire payload and running the same
// Porter-Duff maths the TypeScript engine uses. luma-core and app/engine/blend
// are already proven equal against shared W3C reference values, so agreement
// here means the parts this change actually touched are right: the tile loop,
// the per-layer rasterize/direct decision, and the double-application traps
// around masks and fill opacity.

/** Decode a native tile request and composite it the way luma-core would. */
function fakeNativeCompositor(payload: Uint8Array): Uint8Array {
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const width = view.getUint32(4, true);
  const height = view.getUint32(8, true);
  const count = view.getUint32(12, true);
  const pixels = width * height;

  const out = new Float32Array(pixels * 4);
  type Entry = { mode: BlendMode; opacity: number; pixels: Float32Array; mask: Float32Array | null };
  const entries: Entry[] = [];
  let offset = 16;
  for (let index = 0; index < count; index += 1) {
    const mode = NATIVE_WIRE_BLEND_MODES[view.getUint32(offset, true)];
    const opacity = view.getFloat32(offset + 4, true);
    const flags = view.getUint32(offset + 8, true);
    offset += 16;
    const layerPixels = new Float32Array(payload.buffer.slice(
      payload.byteOffset + offset, payload.byteOffset + offset + pixels * 16));
    offset += pixels * 16;
    let mask: Float32Array | null = null;
    if (flags & 2) {
      mask = new Float32Array(payload.buffer.slice(
        payload.byteOffset + offset, payload.byteOffset + offset + pixels * 4));
      offset += pixels * 4;
    }
    entries.push({ mode, opacity, pixels: layerPixels, mask });
  }

  // The wire order is top-down; compositing runs bottom-up.
  for (const entry of [...entries].reverse()) {
    for (let pixel = 0; pixel < pixels; pixel += 1) {
      const i = pixel * 4;
      const srcA = entry.pixels[i + 3] * entry.opacity * (entry.mask ? entry.mask[pixel] : 1);
      if (srcA <= 0) continue;
      const dstA = out[i + 3];
      const outA = srcA + dstA * (1 - srcA);
      const base: Rgb = [out[i], out[i + 1], out[i + 2]];
      const source: Rgb = [entry.pixels[i], entry.pixels[i + 1], entry.pixels[i + 2]];
      const blended = blendRgb(entry.mode, base, source);
      for (let channel = 0; channel < 3; channel += 1) {
        out[i + channel] = (1 - srcA) * base[channel]
          + srcA * ((1 - dstA) * source[channel] + dstA * blended[channel]);
      }
      out[i + 3] = outA;
    }
  }
  return new Uint8Array(out.buffer);
}

/** Install the fake as `window.__TAURI__.core.invoke` for the duration. */
function withFakeNative<T>(body: () => T): T {
  const globalWindow = globalThis as unknown as { window?: unknown };
  const previous = globalWindow.window;
  globalWindow.window = {
    __TAURI__: {
      core: {
        invoke: async (command: string, request: unknown) => {
          assert.equal(command, "composite_native_tile");
          return fakeNativeCompositor(request as Uint8Array);
        },
      },
    },
  };
  try {
    return body();
  } finally {
    globalWindow.window = previous;
  }
}

function paint(studio: Studio, layer: Layer, draw: (context: CanvasRenderingContext2D) => void) {
  draw(layer.bitmap!.getContext("2d")!);
  (studio as unknown as { syncLayerSurface(layer: Layer): void }).syncLayerSurface(layer);
}

async function nativeAgainstPortable(build: (studio: Studio) => void) {
  const studio = new Studio(64, 48, newCanvas(64, 48));
  build(studio);

  const portable = testCanvas(64, 48);
  renderClean(studio.doc, portable);

  const native = await withFakeNative(() => studio.flattenNative());
  assert.ok(native, "the native path should have accepted this document");

  let worst = 0;
  for (let y = 0; y < 48; y += 1) {
    for (let x = 0; x < 64; x += 1) {
      const a = pixelAt(portable, x, y);
      const b = pixelAt(native as unknown as ReturnType<typeof testCanvas>, x, y);
      worst = Math.max(worst, Math.abs(a.r - b.r), Math.abs(a.g - b.g), Math.abs(a.b - b.b), Math.abs(a.a - b.a));
    }
  }
  return worst;
}

test("a plain stack flattens natively to the same pixels as the portable renderer", async () => {
  const worst = await nativeAgainstPortable((studio) => {
    const bottom = studio.addBlankRaster("bottom");
    paint(studio, bottom, (context) => {
      context.fillStyle = "#3060c0";
      context.fillRect(0, 0, 64, 48);
    });
    const top = studio.addBlankRaster("top");
    paint(studio, top, (context) => {
      context.fillStyle = "rgba(240,180,60,0.7)";
      context.fillRect(10, 8, 30, 24);
    });
  });
  assert.ok(worst <= 2, `native and portable disagree by ${worst}`);
});

test("a transformed layer — which used to be refused outright — matches too", async () => {
  const worst = await nativeAgainstPortable((studio) => {
    const bottom = studio.addBlankRaster("bottom");
    paint(studio, bottom, (context) => {
      context.fillStyle = "#202020";
      context.fillRect(0, 0, 64, 48);
    });
    const moved = studio.addBlankRaster("moved");
    paint(studio, moved, (context) => {
      context.fillStyle = "#e0d0a0";
      context.fillRect(0, 0, 24, 20);
    });
    studio.updateTransform(moved.id, { tx: 18, ty: 10, sx: 1.4, sy: 1.4, rotation: 0 });
  });
  assert.ok(worst <= 3, `native and portable disagree by ${worst}`);
});

test("fill opacity is applied once, not twice, on a rasterized layer", async () => {
  // The effect pipeline already folds fill opacity in when a layer rasterizes.
  // Multiplying it into the native layer options as well would darken every
  // styled layer, and the error compounds with the mask.
  const worst = await nativeAgainstPortable((studio) => {
    const bottom = studio.addBlankRaster("bottom");
    paint(studio, bottom, (context) => {
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, 64, 48);
    });
    const styled = studio.addBlankRaster("styled");
    paint(studio, styled, (context) => {
      context.fillStyle = "#4020a0";
      context.fillRect(12, 10, 32, 26);
    });
    styled.fillOpacity = 0.5;
    studio.addLayerEffect(styled.id, "stroke");
  });
  assert.ok(worst <= 3, `native and portable disagree by ${worst}`);
});

test("a mask on a rasterized layer is applied once, not squared", async () => {
  const worst = await nativeAgainstPortable((studio) => {
    const bottom = studio.addBlankRaster("bottom");
    paint(studio, bottom, (context) => {
      context.fillStyle = "#106040";
      context.fillRect(0, 0, 64, 48);
    });
    const masked = studio.addBlankRaster("masked");
    paint(studio, masked, (context) => {
      context.fillStyle = "#f0a020";
      context.fillRect(0, 0, 64, 48);
    });
    const mask = newCanvas(64, 48);
    const maskContext = mask.getContext("2d")!;
    // A soft ramp: squaring the coverage is invisible at 0 and 1 and obvious
    // everywhere between.
    const ramp = maskContext.createLinearGradient(0, 0, 64, 0);
    ramp.addColorStop(0, "rgba(255,255,255,0)");
    ramp.addColorStop(1, "rgba(255,255,255,1)");
    maskContext.fillStyle = ramp;
    maskContext.fillRect(0, 0, 64, 48);
    masked.mask = mask;
    // A transform forces the rasterized path, where the double-apply lives.
    studio.updateTransform(masked.id, { tx: 2, ty: 0, sx: 1, sy: 1, rotation: 0 });
  });
  assert.ok(worst <= 3, `native and portable disagree by ${worst}`);
});

test("a mask lets the shadow fall outside it, the way the CPU renderer does", async () => {
  // "Layer Mask Hides Effects" is off by default: the mask shapes the pixels
  // and the drop shadow still falls beyond it. Both accelerated paths used to
  // mask the *finished* result instead, which is the "on" behaviour, so every
  // masked layer with an effect exported differently from how it previewed.
  const worst = await nativeAgainstPortable((studio) => {
    const bottom = studio.addBlankRaster("bottom");
    paint(studio, bottom, (context) => {
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, 64, 48);
    });
    const shaped = studio.addBlankRaster("shaped");
    paint(studio, shaped, (context) => {
      context.fillStyle = "#204080";
      context.fillRect(0, 0, 64, 48);
    });
    // The mask keeps only a square in the middle; the shadow must escape it.
    const mask = newCanvas(64, 48);
    const maskContext = mask.getContext("2d")!;
    maskContext.fillStyle = "#ffffff";
    maskContext.fillRect(16, 12, 24, 20);
    shaped.mask = mask;
    studio.addLayerEffect(shaped.id, "drop-shadow");
    const effect = studio.doc.layers.find((layer) => layer.id === shaped.id)!.effects![0];
    studio.updateLayerEffect(shaped.id, effect.id, {
      color: "#000000", blur: 3, offsetX: 8, offsetY: 8, opacity: 1, useGlobalLight: false,
    });
  });
  assert.ok(worst <= 3, `native and portable disagree by ${worst}`);
});
