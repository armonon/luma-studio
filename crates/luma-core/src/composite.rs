//! Parallel compositor.
//!
//! The web engine composites on the main thread, one `ImageData` round-trip per
//! layer per tile. Here each scanline is independent, so rayon fans the work
//! across every core with no copies and no GC.

use rayon::prelude::*;

use crate::blend::{blend, BlendMode};
use crate::pixel::{linear_to_srgb, srgb_to_linear, Rgba, Surface};

/// How a layer is mixed into the accumulating composite.
#[derive(Debug, Clone, Copy)]
pub struct LayerOptions {
    pub mode: BlendMode,
    /// 0..=1, multiplied with the per-pixel mask.
    pub opacity: f32,
    /// Blend in linear light rather than on gamma-encoded values.
    pub linear: bool,
}

impl Default for LayerOptions {
    fn default() -> Self {
        Self { mode: BlendMode::Normal, opacity: 1.0, linear: false }
    }
}

#[inline]
fn to_working(c: Rgba, linear: bool) -> Rgba {
    if linear {
        Rgba::new(srgb_to_linear(c.r), srgb_to_linear(c.g), srgb_to_linear(c.b), c.a)
    } else {
        c
    }
}

#[inline]
fn from_working(c: Rgba, linear: bool) -> Rgba {
    if linear {
        Rgba::new(linear_to_srgb(c.r), linear_to_srgb(c.g), linear_to_srgb(c.b), c.a)
    } else {
        c
    }
}

/// Porter-Duff source-over with a blend function, per the PDF/W3C model:
///   Co = (1-As)*Cb + As*((1-Ab)*Cs + Ab*B(Cb,Cs))
///   Ao = As + Ab*(1-As)
#[inline]
pub fn composite_pixel(base: Rgba, source: Rgba, opts: LayerOptions, mask: f32) -> Rgba {
    let src_a = source.a * opts.opacity * mask;
    if src_a <= 0.0 {
        return base;
    }
    let b = to_working(base, opts.linear);
    let s = to_working(source, opts.linear);
    let blended = blend(opts.mode, b, s);

    let dst_a = b.a;
    let out_a = src_a + dst_a * (1.0 - src_a);
    let mix = |cb: f32, cs: f32, bl: f32| {
        (1.0 - src_a) * cb + src_a * ((1.0 - dst_a) * cs + dst_a * bl)
    };
    let out = Rgba::new(
        mix(b.r, s.r, blended.r),
        mix(b.g, s.g, blended.g),
        mix(b.b, s.b, blended.b),
        out_a,
    );
    from_working(out, opts.linear)
}

/// Composite `source` onto `base` in place. Scanlines are processed in
/// parallel; `mask`, when present, supplies per-pixel coverage from its alpha.
pub fn composite_layer(
    base: &mut Surface,
    source: &Surface,
    mask: Option<&Surface>,
    opts: LayerOptions,
) {
    assert_eq!(base.width(), source.width(), "surface widths must match");
    assert_eq!(base.height(), source.height(), "surface heights must match");
    if let Some(m) = mask {
        assert_eq!(base.width(), m.width(), "mask width must match");
        assert_eq!(base.height(), m.height(), "mask height must match");
    }

    let width = base.width();
    let src = source.data();
    let mask_data = mask.map(|m| m.data());

    base.data_mut()
        .par_chunks_mut(width * 4)
        .enumerate()
        .for_each(|(row, dst_row)| {
            let offset = row * width * 4;
            for x in 0..width {
                let i = x * 4;
                let j = offset + i;
                let b = Rgba::new(dst_row[i], dst_row[i + 1], dst_row[i + 2], dst_row[i + 3]);
                let s = Rgba::new(src[j], src[j + 1], src[j + 2], src[j + 3]);
                // Mask coverage comes from alpha, matching the web engine's
                // destination-in masking.
                let cov = mask_data.map_or(1.0, |m| m[j + 3]);
                let out = composite_pixel(b, s, opts, cov);
                dst_row[i] = out.r;
                dst_row[i + 1] = out.g;
                dst_row[i + 2] = out.b;
                dst_row[i + 3] = out.a;
            }
        });
}

/// Flatten a stack bottom-up. Index 0 is the topmost layer, matching the
/// document model in `app/engine/document.ts`.
pub fn composite_stack(
    width: usize,
    height: usize,
    layers: &[(&Surface, Option<&Surface>, LayerOptions)],
) -> Surface {
    let mut out = Surface::new(width, height);
    for (surface, mask, opts) in layers.iter().rev() {
        composite_layer(&mut out, surface, *mask, *opts);
    }
    out
}
