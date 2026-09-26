//! Local qualification adapter for the actual native implementation. Bytes go
//! only to the caller's pipe, never into fixtures, documents or release assets.
#[path = "../src-tauri/src/font_face.rs"]
mod font_face;
fn main() {
    use std::io::Write;
    let name = std::env::args().nth(1).expect("Supply an installed PostScript face name");
    match font_face::exact_face(&name) {
        Ok(bytes) => std::io::stdout().write_all(&bytes).expect("font output pipe"),
        Err(error) => { eprintln!("{error}"); std::process::exit(1); }
    }
}
