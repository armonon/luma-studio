//! Pixel and buffer types.
//!
//! Everything is `f32` and **not** clamped at rest. This is the first hard
//! break from the web engine, where every layer is a `Uint8ClampedArray`
//! behind an `HTMLCanvasElement`: values are quantised to 8 bits and clipped
//! to [0,1] at every stage, so highlight headroom from a RAW develop is
//! destroyed before the first adjustment runs.

/// Straight (non-premultiplied) linear RGBA. Values may exceed 1.0 to carry
/// specular/highlight headroom, and may be negative in wide-gamut transforms.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Rgba {
    pub r: f32,
    pub g: f32,
    pub b: f32,
    pub a: f32,
}

impl Rgba {
    pub const TRANSPARENT: Rgba = Rgba { r: 0.0, g: 0.0, b: 0.0, a: 0.0 };

    #[inline]
    pub fn new(r: f32, g: f32, b: f32, a: f32) -> Self {
        Self { r, g, b, a }
    }

    #[inline]
    pub fn rgb(r: f32, g: f32, b: f32) -> Self {
        Self { r, g, b, a: 1.0 }
    }

    /// Rec.709 luminance, the weighting used for the non-separable blend modes.
    #[inline]
    pub fn luma(&self) -> f32 {
        0.2126 * self.r + 0.7152 * self.g + 0.0722 * self.b
    }
}

/// A planar f32 RGBA image. Storage is a flat `Vec<f32>` in RGBA order so it
/// can be handed to the GPU or memory-mapped without a repack.
#[derive(Debug, Clone)]
pub struct Surface {
    width: usize,
    height: usize,
    data: Vec<f32>,
}

impl Surface {
    pub fn new(width: usize, height: usize) -> Self {
        Self { width, height, data: vec![0.0; width * height * 4] }
    }

    pub fn filled(width: usize, height: usize, color: Rgba) -> Self {
        let mut s = Self::new(width, height);
        for px in s.data.chunks_exact_mut(4) {
            px[0] = color.r;
            px[1] = color.g;
            px[2] = color.b;
            px[3] = color.a;
        }
        s
    }

    #[inline]
    pub fn width(&self) -> usize { self.width }
    #[inline]
    pub fn height(&self) -> usize { self.height }
    #[inline]
    pub fn data(&self) -> &[f32] { &self.data }
    #[inline]
    pub fn data_mut(&mut self) -> &mut [f32] { &mut self.data }

    /// Bytes held by the pixel buffer. 16 per pixel vs the web engine's 4.
    pub fn byte_size(&self) -> usize {
        self.data.len() * std::mem::size_of::<f32>()
    }

    #[inline]
    pub fn get(&self, x: usize, y: usize) -> Rgba {
        let i = (y * self.width + x) * 4;
        Rgba::new(self.data[i], self.data[i + 1], self.data[i + 2], self.data[i + 3])
    }

    #[inline]
    pub fn set(&mut self, x: usize, y: usize, c: Rgba) {
        let i = (y * self.width + x) * 4;
        self.data[i] = c.r;
        self.data[i + 1] = c.g;
        self.data[i + 2] = c.b;
        self.data[i + 3] = c.a;
    }
}

/// sRGB transfer functions. The web CPU path blends on gamma-encoded values;
/// working in linear light is physically correct and is what makes highlight
/// falloff and wide-gamut conversion behave.
#[inline]
pub fn srgb_to_linear(c: f32) -> f32 {
    if c <= 0.04045 { c / 12.92 } else { ((c + 0.055) / 1.055).powf(2.4) }
}

#[inline]
pub fn linear_to_srgb(c: f32) -> f32 {
    if c <= 0.0031308 { c * 12.92 } else { 1.055 * c.powf(1.0 / 2.4) - 0.055 }
}
