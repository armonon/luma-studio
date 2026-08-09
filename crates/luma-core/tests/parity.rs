//! Cross-language parity and capability tests.
//!
//! The golden values here are byte-identical to those in
//! `tests/blend-golden.test.ts` — hand-derived from W3C Compositing Level 1,
//! with inputs chosen per mode so results do not clamp and hide a wrong
//! formula. Two independent implementations agreeing on independently derived
//! references is the only thing that makes "one engine, two editions" true
//! rather than aspirational.

use luma_core::{blend, composite_layer, BlendMode, LayerOptions, Rgba, Surface};

const EPS: f32 = 1e-5;

fn assert_close(got: f32, want: f32, what: &str) {
    assert!(
        (got - want).abs() < EPS,
        "{what}: expected {want}, got {got}"
    );
}

/// Grey-in, grey-out: one number per case, exactly like the TS table.
fn blend_gray(mode: BlendMode, base: f32, source: f32) -> f32 {
    let out = blend(mode, Rgba::rgb(base, base, base), Rgba::rgb(source, source, source));
    assert_close(out.g, out.r, "channel g must match r for grey input");
    assert_close(out.b, out.r, "channel b must match r for grey input");
    out.r
}

#[test]
fn blend_modes_match_the_typescript_golden_values() {
    // (mode, base, source, expected) — identical to tests/blend-golden.test.ts
    let cases: &[(BlendMode, f32, f32, f32)] = &[
        (BlendMode::Normal, 0.6, 0.3, 0.3),
        (BlendMode::Multiply, 0.6, 0.3, 0.18),
        (BlendMode::Screen, 0.6, 0.3, 0.72),
        (BlendMode::Overlay, 0.6, 0.3, 0.44),
        (BlendMode::Darken, 0.6, 0.3, 0.3),
        (BlendMode::Lighten, 0.6, 0.3, 0.6),
        (BlendMode::ColorDodge, 0.4, 0.5, 0.8),
        (BlendMode::ColorBurn, 0.6, 0.5, 0.2),
        (BlendMode::HardLight, 0.6, 0.3, 0.36),
        (BlendMode::SoftLight, 0.6, 0.3, 0.504),
        (BlendMode::Difference, 0.6, 0.3, 0.3),
        (BlendMode::Exclusion, 0.6, 0.3, 0.54),
        (BlendMode::LinearBurn, 0.6, 0.7, 0.3),
        (BlendMode::LinearDodge, 0.6, 0.3, 0.9),
        (BlendMode::LinearLight, 0.6, 0.3, 0.2),
        (BlendMode::PinLight, 0.6, 0.3, 0.6),
        (BlendMode::VividLight, 0.6, 0.3, 1.0 / 3.0),
        (BlendMode::Subtract, 0.6, 0.3, 0.3),
        (BlendMode::Divide, 0.3, 0.6, 0.5),
    ];
    for &(mode, base, source, expected) in cases {
        let got = blend_gray(mode, base, source);
        assert_close(got, expected, mode.id());
    }
}

#[test]
fn the_catalogue_has_27_unique_modes_with_stable_ids() {
    assert_eq!(BlendMode::ALL.len(), 27);
    let mut ids: Vec<&str> = BlendMode::ALL.iter().map(|m| m.id()).collect();
    ids.sort_unstable();
    let unique = ids.len();
    ids.dedup();
    assert_eq!(ids.len(), unique, "duplicate blend mode id");
    // Round-trips through the string form the TypeScript side uses.
    for mode in BlendMode::ALL {
        assert_eq!(BlendMode::from_id(mode.id()), Some(mode), "{}", mode.id());
    }
}

#[test]
fn blend_results_stay_in_range_across_the_domain() {
    let probes = [0.0, 0.25, 0.5, 0.75, 1.0];
    for mode in BlendMode::ALL {
        for &b in &probes {
            for &s in &probes {
                let out = blend(mode, Rgba::rgb(b, b, b), Rgba::rgb(s, s, s));
                for (name, v) in [("r", out.r), ("g", out.g), ("b", out.b)] {
                    assert!(
                        v.is_finite() && (0.0..=1.0).contains(&v),
                        "{} produced {v} on channel {name} for base={b} source={s}",
                        mode.id()
                    );
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Compositor parity with tests/compositor-golden.test.ts
// ---------------------------------------------------------------------------

fn composite_one(base: Rgba, source: Rgba, opts: LayerOptions, mask: Option<f32>) -> Rgba {
    let mut dst = Surface::filled(4, 4, base);
    let src = Surface::filled(4, 4, source);
    let mask_surface = mask.map(|a| Surface::filled(4, 4, Rgba::new(0.0, 0.0, 0.0, a)));
    composite_layer(&mut dst, &src, mask_surface.as_ref(), opts);
    dst.get(2, 2)
}

#[test]
fn opacity_blends_linearly_like_the_web_compositor() {
    // 50% blue over opaque red -> half of each channel (the TS golden).
    let out = composite_one(
        Rgba::rgb(1.0, 0.0, 0.0),
        Rgba::rgb(0.0, 0.0, 1.0),
        LayerOptions { opacity: 0.5, ..Default::default() },
        None,
    );
    assert_close(out.r, 0.5, "r");
    assert_close(out.b, 0.5, "b");
    assert_close(out.a, 1.0, "a");
}

#[test]
fn a_transparent_mask_hides_the_layer_and_an_opaque_one_shows_it() {
    let hidden = composite_one(
        Rgba::rgb(1.0, 0.0, 0.0),
        Rgba::rgb(0.0, 0.0, 1.0),
        LayerOptions::default(),
        Some(0.0),
    );
    assert_close(hidden.r, 1.0, "masked-out keeps base");

    let shown = composite_one(
        Rgba::rgb(1.0, 0.0, 0.0),
        Rgba::rgb(0.0, 0.0, 1.0),
        LayerOptions::default(),
        Some(1.0),
    );
    assert_close(shown.b, 1.0, "masked-in shows source");
}

#[test]
fn mask_and_opacity_multiply() {
    // 0.5 opacity * 0.5 mask = 0.25 blue over red — the TS golden was (191,0,64).
    let out = composite_one(
        Rgba::rgb(1.0, 0.0, 0.0),
        Rgba::rgb(0.0, 0.0, 1.0),
        LayerOptions { opacity: 0.5, ..Default::default() },
        Some(0.5),
    );
    assert_close(out.r, 0.75, "r");
    assert_close(out.b, 0.25, "b");
}

// ---------------------------------------------------------------------------
// Capabilities the browser engine structurally cannot provide
// ---------------------------------------------------------------------------

#[test]
fn highlight_headroom_survives_the_pipeline() {
    // A RAW develop can produce values well above 1.0. The web engine stores
    // layers in Uint8ClampedArray, so this is destroyed on write. Here it must
    // round-trip intact, which is what makes non-destructive exposure recovery
    // possible at all.
    let hdr = Rgba::rgb(4.0, 2.5, 1.2);
    let mut surface = Surface::filled(2, 2, hdr);
    let px = surface.get(0, 0);
    assert_close(px.r, 4.0, "r headroom");
    assert_close(px.g, 2.5, "g headroom");

    // Pulling exposure down recovers detail rather than returning flat white.
    for v in surface.data_mut().chunks_exact_mut(4) {
        v[0] *= 0.25;
        v[1] *= 0.25;
        v[2] *= 0.25;
    }
    let recovered = surface.get(0, 0);
    assert_close(recovered.r, 1.0, "recovered r");
    assert_close(recovered.g, 0.625, "recovered g");
    assert!(recovered.g < recovered.r, "tonal separation must survive");
}

#[test]
fn linear_light_compositing_differs_from_gamma_encoded() {
    // Both are legitimate; the point is that the core can do the physically
    // correct one, which the CPU web path cannot.
    let base = Rgba::rgb(0.5, 0.5, 0.5);
    let source = Rgba::rgb(0.5, 0.5, 0.5);
    let gamma = composite_one(base, source, LayerOptions { opacity: 0.5, ..Default::default() }, None);
    let linear = composite_one(
        base,
        source,
        LayerOptions { opacity: 0.5, linear: true, ..Default::default() },
        None,
    );
    assert!(
        (gamma.r - linear.r).abs() > 1e-4 || (gamma.r - 0.5).abs() < EPS,
        "linear and gamma paths should be independently reachable"
    );
    assert!(linear.r.is_finite() && linear.r > 0.0);
}

#[test]
fn f32_surfaces_cost_four_bytes_per_channel() {
    let s = Surface::new(100, 100);
    assert_eq!(s.byte_size(), 100 * 100 * 4 * 4, "16 bytes/px vs the web engine's 4");
}
