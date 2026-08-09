//! Flatten benchmark: N layers over a WxH document, reported in megapixels/sec.
use std::time::Instant;
use luma_core::{composite_stack, BlendMode, LayerOptions, Rgba, Surface};

fn main() {
    let (w, h, layers) = (2048usize, 1536usize, 8usize);
    let mp = (w * h) as f64 / 1_000_000.0;

    let surfaces: Vec<Surface> = (0..layers)
        .map(|i| {
            let v = 0.2 + (i as f32) * 0.08;
            Surface::filled(w, h, Rgba::new(v, 1.0 - v, 0.5, 1.0))
        })
        .collect();

    // Pick the mode from argv so the two paths can be compared directly:
    // `multiply` maps to a native canvas operator in the web engine, `subtract`
    // does not and forces its JS fallback.
    let mode_id = std::env::args().nth(1).unwrap_or_else(|| "subtract".into());
    let mode = BlendMode::from_id(&mode_id).unwrap_or(BlendMode::Subtract);
    let opts = LayerOptions { mode, opacity: 0.8, linear: false };
    let stack: Vec<(&Surface, Option<&Surface>, LayerOptions)> =
        surfaces.iter().map(|s| (s, None, opts)).collect();

    // Warm caches / let rayon spin up its pool.
    let _ = composite_stack(w, h, &stack);

    let runs = 5;
    let start = Instant::now();
    for _ in 0..runs {
        let out = composite_stack(w, h, &stack);
        std::hint::black_box(&out);
    }
    let elapsed = start.elapsed().as_secs_f64() / runs as f64;

    println!("rust   {} {w}x{h} x{layers} layers: {:.1} ms/flatten  ({:.1} MP/s composited)", mode.id(),
        elapsed * 1000.0, (mp * layers as f64) / elapsed);
    println!("rust   threads: {}", rayon::current_num_threads());
}
