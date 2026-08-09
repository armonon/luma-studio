// Luma Studio — pro edition shell.
//
// The desktop build is deliberately thin: all editing lives in the shared
// engine (`app/engine`), which is DOM-optional and identical across editions.
// This process only owns the window and, later, the native capabilities the
// web edition cannot have (filesystem access, larger documents, native RAW).
// See `app/engine/edition.ts` for the capability matrix.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("failed to start Luma Studio");
}
