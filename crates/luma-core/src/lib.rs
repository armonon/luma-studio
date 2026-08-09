//! Luma native imaging core.
//!
//! This is the pro edition's engine. It is deliberately *not* a port of the
//! browser engine's plumbing — it exists to remove the browser's structural
//! limits:
//!
//! | | web engine | luma-core |
//! |---|---|---|
//! | Precision | `Uint8ClampedArray` (8-bit, clipped) | `f32`, unclamped at rest |
//! | Threading | main thread only | rayon, all cores |
//! | Blend space | gamma-encoded sRGB | sRGB or linear light |
//! | Headroom | none — clipped per stage | HDR values survive the pipeline |
//!
//! Blend maths is kept in lockstep with `app/engine/blend.ts` so the two
//! editions agree pixel for pixel; the parity tests assert against the same
//! hand-derived W3C reference values.

pub mod blend;
pub mod composite;
pub mod pixel;

pub use blend::{blend, BlendMode};
pub use composite::{composite_layer, composite_pixel, composite_stack, LayerOptions};
pub use pixel::{linear_to_srgb, srgb_to_linear, Rgba, Surface};
