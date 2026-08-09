//! Blend modes in f32.
//!
//! These mirror `app/engine/blend.ts` exactly — same 27 modes, same formulas —
//! so the native core and the web engine agree pixel for pixel. The parity
//! tests assert against the *same* hand-derived W3C reference values used by
//! `tests/blend-golden.test.ts`.

use crate::pixel::Rgba;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum BlendMode {
    Normal,
    Dissolve,
    Darken,
    Multiply,
    ColorBurn,
    LinearBurn,
    DarkerColor,
    Lighten,
    Screen,
    ColorDodge,
    LinearDodge,
    LighterColor,
    Overlay,
    SoftLight,
    HardLight,
    VividLight,
    LinearLight,
    PinLight,
    HardMix,
    Difference,
    Exclusion,
    Subtract,
    Divide,
    Hue,
    Saturation,
    Color,
    Luminosity,
}

impl BlendMode {
    /// Every mode, in the same order as the TypeScript catalogue.
    pub const ALL: [BlendMode; 27] = [
        BlendMode::Normal, BlendMode::Dissolve, BlendMode::Darken, BlendMode::Multiply,
        BlendMode::ColorBurn, BlendMode::LinearBurn, BlendMode::DarkerColor, BlendMode::Lighten,
        BlendMode::Screen, BlendMode::ColorDodge, BlendMode::LinearDodge, BlendMode::LighterColor,
        BlendMode::Overlay, BlendMode::SoftLight, BlendMode::HardLight, BlendMode::VividLight,
        BlendMode::LinearLight, BlendMode::PinLight, BlendMode::HardMix, BlendMode::Difference,
        BlendMode::Exclusion, BlendMode::Subtract, BlendMode::Divide, BlendMode::Hue,
        BlendMode::Saturation, BlendMode::Color, BlendMode::Luminosity,
    ];

    /// Canonical id, matching the TypeScript `BlendMode` union strings.
    pub fn id(&self) -> &'static str {
        match self {
            BlendMode::Normal => "source-over",
            BlendMode::Dissolve => "dissolve",
            BlendMode::Darken => "darken",
            BlendMode::Multiply => "multiply",
            BlendMode::ColorBurn => "color-burn",
            BlendMode::LinearBurn => "linear-burn",
            BlendMode::DarkerColor => "darker-color",
            BlendMode::Lighten => "lighten",
            BlendMode::Screen => "screen",
            BlendMode::ColorDodge => "color-dodge",
            BlendMode::LinearDodge => "linear-dodge",
            BlendMode::LighterColor => "lighter-color",
            BlendMode::Overlay => "overlay",
            BlendMode::SoftLight => "soft-light",
            BlendMode::HardLight => "hard-light",
            BlendMode::VividLight => "vivid-light",
            BlendMode::LinearLight => "linear-light",
            BlendMode::PinLight => "pin-light",
            BlendMode::HardMix => "hard-mix",
            BlendMode::Difference => "difference",
            BlendMode::Exclusion => "exclusion",
            BlendMode::Subtract => "subtract",
            BlendMode::Divide => "divide",
            BlendMode::Hue => "hue",
            BlendMode::Saturation => "saturation",
            BlendMode::Color => "color",
            BlendMode::Luminosity => "luminosity",
        }
    }

    pub fn from_id(id: &str) -> Option<BlendMode> {
        BlendMode::ALL.iter().copied().find(|m| m.id() == id)
    }

    /// Non-separable modes mix channels and cannot be evaluated per-channel.
    pub fn is_non_separable(&self) -> bool {
        matches!(
            self,
            BlendMode::Hue | BlendMode::Saturation | BlendMode::Color
                | BlendMode::Luminosity | BlendMode::DarkerColor | BlendMode::LighterColor
        )
    }
}

#[inline]
fn clamp01(x: f32) -> f32 { x.clamp(0.0, 1.0) }

// ---- separable channel functions (W3C Compositing Level 1) ----

#[inline]
fn overlay_ch(b: f32, s: f32) -> f32 { hard_light_ch(s, b) }

#[inline]
fn hard_light_ch(b: f32, s: f32) -> f32 {
    if s <= 0.5 { 2.0 * s * b } else { 1.0 - 2.0 * (1.0 - s) * (1.0 - b) }
}

#[inline]
fn soft_light_ch(b: f32, s: f32) -> f32 {
    if s <= 0.5 {
        b - (1.0 - 2.0 * s) * b * (1.0 - b)
    } else {
        let d = if b <= 0.25 { ((16.0 * b - 12.0) * b + 4.0) * b } else { b.sqrt() };
        b + (2.0 * s - 1.0) * (d - b)
    }
}

#[inline]
fn color_dodge_ch(b: f32, s: f32) -> f32 {
    if b <= 0.0 { 0.0 } else if s >= 1.0 { 1.0 } else { (b / (1.0 - s)).min(1.0) }
}

#[inline]
fn color_burn_ch(b: f32, s: f32) -> f32 {
    if b >= 1.0 { 1.0 } else if s <= 0.0 { 0.0 } else { 1.0 - ((1.0 - b) / s).min(1.0) }
}

#[inline]
fn vivid_light_ch(b: f32, s: f32) -> f32 {
    if s <= 0.5 { color_burn_ch(b, 2.0 * s) } else { color_dodge_ch(b, 2.0 * (s - 0.5)) }
}

#[inline]
fn pin_light_ch(b: f32, s: f32) -> f32 {
    if s <= 0.5 { b.min(2.0 * s) } else { b.max(2.0 * s - 1.0) }
}

// ---- non-separable helpers ----

fn lum(c: Rgba) -> f32 { c.luma() }

fn clip_color(mut c: Rgba) -> Rgba {
    let l = lum(c);
    let n = c.r.min(c.g).min(c.b);
    let x = c.r.max(c.g).max(c.b);
    if n < 0.0 {
        let d = l - n;
        if d > 0.0 {
            c.r = l + (c.r - l) * l / d;
            c.g = l + (c.g - l) * l / d;
            c.b = l + (c.b - l) * l / d;
        }
    }
    if x > 1.0 {
        let d = x - l;
        if d > 0.0 {
            c.r = l + (c.r - l) * (1.0 - l) / d;
            c.g = l + (c.g - l) * (1.0 - l) / d;
            c.b = l + (c.b - l) * (1.0 - l) / d;
        }
    }
    c
}

fn set_lum(c: Rgba, l: f32) -> Rgba {
    let d = l - lum(c);
    clip_color(Rgba::rgb(c.r + d, c.g + d, c.b + d))
}

fn sat(c: Rgba) -> f32 {
    c.r.max(c.g).max(c.b) - c.r.min(c.g).min(c.b)
}

fn set_sat(c: Rgba, s: f32) -> Rgba {
    let mx = c.r.max(c.g).max(c.b);
    let mn = c.r.min(c.g).min(c.b);
    if mx > mn {
        let scale = s / (mx - mn);
        Rgba::rgb((c.r - mn) * scale, (c.g - mn) * scale, (c.b - mn) * scale)
    } else {
        Rgba::rgb(0.0, 0.0, 0.0)
    }
}

/// Blend `source` over `base`, both straight-alpha colour only (alpha handled
/// by the compositor). Results are clamped to [0,1] per spec.
pub fn blend(mode: BlendMode, base: Rgba, source: Rgba) -> Rgba {
    use BlendMode::*;
    let per = |f: fn(f32, f32) -> f32| {
        Rgba::rgb(
            clamp01(f(base.r, source.r)),
            clamp01(f(base.g, source.g)),
            clamp01(f(base.b, source.b)),
        )
    };
    match mode {
        // Dissolve is a stochastic per-pixel choice handled by the compositor;
        // as a colour function it is Normal.
        Normal | Dissolve => Rgba::rgb(source.r, source.g, source.b),
        Darken => per(|b, s| b.min(s)),
        Lighten => per(|b, s| b.max(s)),
        Multiply => per(|b, s| b * s),
        Screen => per(|b, s| b + s - b * s),
        Overlay => per(overlay_ch),
        HardLight => per(hard_light_ch),
        SoftLight => per(soft_light_ch),
        ColorDodge => per(color_dodge_ch),
        ColorBurn => per(color_burn_ch),
        LinearBurn => per(|b, s| b + s - 1.0),
        LinearDodge => per(|b, s| b + s),
        LinearLight => per(|b, s| b + 2.0 * s - 1.0),
        VividLight => per(vivid_light_ch),
        PinLight => per(pin_light_ch),
        HardMix => per(|b, s| if vivid_light_ch(b, s) >= 0.5 { 1.0 } else { 0.0 }),
        Difference => per(|b, s| (b - s).abs()),
        Exclusion => per(|b, s| b + s - 2.0 * b * s),
        Subtract => per(|b, s| b - s),
        Divide => per(|b, s| if s <= 0.0 { 1.0 } else { b / s }),
        DarkerColor => if lum(source) < lum(base) { source } else { base },
        LighterColor => if lum(source) > lum(base) { source } else { base },
        Hue => set_lum(set_sat(source, sat(base)), lum(base)),
        Saturation => set_lum(set_sat(base, sat(source)), lum(base)),
        Color => set_lum(source, lum(base)),
        Luminosity => set_lum(base, lum(source)),
    }
}
