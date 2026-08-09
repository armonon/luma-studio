// Luma Studio — pro edition shell.
//
// The desktop build is deliberately thin: all editing lives in the shared
// engine (`app/engine`), which is DOM-optional and identical across editions.
// This process only owns the window and, later, the native capabilities the
// web edition cannot have (filesystem access, larger documents, native RAW).
// See `app/engine/edition.ts` for the capability matrix.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

/// Diagnostics for the native core, surfaced so the edition system can report
/// what the desktop build actually has rather than assuming.
#[tauri::command]
fn core_info() -> serde_json::Value {
    serde_json::json!({
        "threads": rayon::current_num_threads(),
        "precision": "f32",
        "blendModes": luma_core::BlendMode::ALL.iter().map(|m| m.id()).collect::<Vec<_>>(),
    })
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![core_info])
        .run(tauri::generate_context!())
        .expect("failed to start Luma Studio");
}
