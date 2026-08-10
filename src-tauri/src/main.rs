// Luma Studio — pro edition shell.
//
// The desktop build is deliberately thin: all editing lives in the shared
// engine (`app/engine`), which is DOM-optional and identical across editions.
// This process only owns the window and, later, the native capabilities the
// web edition cannot have (filesystem access, larger documents, native RAW).
// See `app/engine/edition.ts` for the capability matrix.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use luma_core::{composite_layer, BlendMode, LayerOptions, Surface};
use tauri::ipc::{InvokeBody, Request, Response};
use tauri_plugin_dialog::DialogExt;
use tauri::Manager;
use std::io::Write;
use std::sync::atomic::{AtomicU64, Ordering};

const NATIVE_TILE_MAGIC: &[u8; 4] = b"LUM1";
const MAX_NATIVE_TILE_PIXELS: usize = 2048 * 2048;
const MAX_NATIVE_TILE_LAYERS: usize = 128;

#[derive(Debug)]
struct NativeLayerRecord {
    mode: BlendMode,
    opacity: f32,
    linear: bool,
    pixels_offset: usize,
    mask_offset: Option<usize>,
}

fn read_u32(bytes: &[u8], offset: &mut usize) -> Result<u32, String> {
    let end = offset.checked_add(4).ok_or("native tile offset overflow")?;
    let input = bytes.get(*offset..end).ok_or("native tile payload is truncated")?;
    *offset = end;
    Ok(u32::from_le_bytes(input.try_into().expect("four byte slice")))
}

fn read_f32(bytes: &[u8], offset: &mut usize) -> Result<f32, String> {
    Ok(f32::from_bits(read_u32(bytes, offset)?))
}

fn read_float_buffer(bytes: &[u8], offset: usize, channels: usize) -> Result<Vec<f32>, String> {
    let byte_length = channels.checked_mul(4).ok_or("native tile byte length overflow")?;
    let input = bytes.get(offset..offset + byte_length).ok_or("native tile float data is truncated")?;
    Ok(input.chunks_exact(4).map(|chunk| {
        f32::from_le_bytes(chunk.try_into().expect("four byte float"))
    }).collect())
}

fn composite_native_payload(bytes: &[u8]) -> Result<Vec<u8>, String> {
    if bytes.get(0..4) != Some(NATIVE_TILE_MAGIC) {
        return Err("native tile payload has an invalid magic header".into());
    }
    let mut offset = 4;
    let width = read_u32(bytes, &mut offset)? as usize;
    let height = read_u32(bytes, &mut offset)? as usize;
    let layer_count = read_u32(bytes, &mut offset)? as usize;
    let pixels = width.checked_mul(height).ok_or("native tile dimensions overflow")?;
    if width == 0 || height == 0 || pixels > MAX_NATIVE_TILE_PIXELS {
        return Err(format!("native tiles must contain 1..={MAX_NATIVE_TILE_PIXELS} pixels"));
    }
    if layer_count > MAX_NATIVE_TILE_LAYERS {
        return Err(format!("native tiles support at most {MAX_NATIVE_TILE_LAYERS} blend passes"));
    }
    let channels = pixels.checked_mul(4).ok_or("native tile channel count overflow")?;
    let pixel_bytes = channels.checked_mul(4).ok_or("native tile pixel byte count overflow")?;
    let mask_bytes = pixels.checked_mul(4).ok_or("native tile mask byte count overflow")?;
    let mut records = Vec::with_capacity(layer_count);
    for _ in 0..layer_count {
        let mode_index = read_u32(bytes, &mut offset)? as usize;
        let opacity = read_f32(bytes, &mut offset)?;
        let flags = read_u32(bytes, &mut offset)?;
        let _reserved = read_u32(bytes, &mut offset)?;
        let mode = BlendMode::ALL.get(mode_index).copied().ok_or("native tile blend mode is invalid")?;
        if !opacity.is_finite() || !(0.0..=1.0).contains(&opacity) {
            return Err("native tile opacity must be finite and between zero and one".into());
        }
        let pixels_offset = offset;
        offset = offset.checked_add(pixel_bytes).ok_or("native tile layer offset overflow")?;
        let mask_offset = if flags & 2 != 0 {
            let current = offset;
            offset = offset.checked_add(mask_bytes).ok_or("native tile mask offset overflow")?;
            Some(current)
        } else {
            None
        };
        if offset > bytes.len() { return Err("native tile layer data is truncated".into()); }
        records.push(NativeLayerRecord {
            mode,
            opacity,
            linear: flags & 1 != 0,
            pixels_offset,
            mask_offset,
        });
    }
    if offset != bytes.len() { return Err("native tile payload contains trailing data".into()); }

    let mut output = Surface::new(width, height);
    for record in records.iter().rev() {
        let source_values = read_float_buffer(bytes, record.pixels_offset, channels)?;
        if source_values.iter().any(|value| !value.is_finite()) {
            return Err("native tile pixels must be finite".into());
        }
        let mut source = Surface::new(width, height);
        source.data_mut().copy_from_slice(&source_values);
        let mask = if let Some(mask_offset) = record.mask_offset {
            let alpha = read_float_buffer(bytes, mask_offset, pixels)?;
            if alpha.iter().any(|value| !value.is_finite()) {
                return Err("native tile mask values must be finite".into());
            }
            let mut surface = Surface::new(width, height);
            for (pixel, value) in alpha.into_iter().enumerate() {
                surface.data_mut()[pixel * 4 + 3] = value.clamp(0.0, 1.0);
            }
            Some(surface)
        } else {
            None
        };
        composite_layer(&mut output, &source, mask.as_ref(), LayerOptions {
            mode: record.mode,
            opacity: record.opacity,
            linear: record.linear,
        });
    }
    let mut result = Vec::with_capacity(channels * 4);
    for value in output.data() { result.extend_from_slice(&value.to_le_bytes()); }
    Ok(result)
}

#[tauri::command]
fn composite_native_tile(request: Request<'_>) -> Result<Response, String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("native compositing requires a raw binary request".into());
    };
    Ok(Response::new(composite_native_payload(bytes)?))
}

const MAX_NATIVE_FILE_BYTES: usize = 1024 * 1024 * 1024;
static SAVE_TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

fn atomic_write(path: &std::path::Path, data: &[u8]) -> Result<(), String> {
    let parent = path.parent().unwrap_or_else(|| std::path::Path::new("."));
    let file_name = path.file_name().and_then(|value| value.to_str()).unwrap_or("Untitled.luma");
    let counter = SAVE_TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
    let temp = parent.join(format!(".{file_name}.luma-tmp-{}-{counter}", std::process::id()));
    let result = (|| -> Result<(), String> {
        let mut file = std::fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temp)
            .map_err(|error| format!("Unable to create temporary save: {error}"))?;
        if let Ok(metadata) = std::fs::metadata(path) {
            file.set_permissions(metadata.permissions())
                .map_err(|error| format!("Unable to preserve save permissions: {error}"))?;
        }
        file.write_all(data).map_err(|error| format!("Unable to write temporary save: {error}"))?;
        file.sync_all().map_err(|error| format!("Unable to sync temporary save: {error}"))?;
        drop(file);
        std::fs::rename(&temp, path).map_err(|error| format!("Unable to replace save atomically: {error}"))?;
        if let Ok(directory) = std::fs::File::open(parent) {
            let _ = directory.sync_all();
        }
        Ok(())
    })();
    if result.is_err() { let _ = std::fs::remove_file(&temp); }
    result
}

#[tauri::command]
async fn open_native_file(app: tauri::AppHandle) -> Result<Response, String> {
    let selected = app.dialog().file()
        .add_filter("Luma, images, Photoshop, and RAW", &[
            "luma", "psd", "psb", "png", "jpg", "jpeg", "webp", "gif", "bmp", "tif", "tiff",
            "dng", "cr2", "cr3", "nef", "arw", "orf", "raf", "rw2", "pef", "srw",
        ])
        .blocking_pick_file();
    let Some(selected) = selected else { return Ok(Response::new(0u32.to_le_bytes().to_vec())); };
    let path = selected.into_path().map_err(|error| error.to_string())?;
    let metadata = std::fs::metadata(&path).map_err(|error| format!("Unable to inspect selected file: {error}"))?;
    if metadata.len() > MAX_NATIVE_FILE_BYTES as u64 {
        return Err(format!("Selected file exceeds the {} MB desktop limit", MAX_NATIVE_FILE_BYTES / 1024 / 1024));
    }
    let data = std::fs::read(&path).map_err(|error| format!("Unable to read selected file: {error}"))?;
    let name = path.file_name().and_then(|name| name.to_str()).unwrap_or("Untitled").as_bytes();
    let name_length = u32::try_from(name.len()).map_err(|_| "Selected file name is too long")?;
    let mut response = Vec::with_capacity(4 + name.len() + data.len());
    response.extend_from_slice(&name_length.to_le_bytes());
    response.extend_from_slice(name);
    response.extend_from_slice(&data);
    Ok(Response::new(response))
}

#[tauri::command]
async fn save_native_file(app: tauri::AppHandle, request: Request<'_>) -> Result<bool, String> {
    let InvokeBody::Raw(payload) = request.body() else {
        return Err("native save requires a raw binary request".into());
    };
    if payload.len() < 4 { return Err("native save payload is truncated".into()); }
    let name_length = u32::from_le_bytes(payload[0..4].try_into().expect("four byte name length")) as usize;
    let data_offset = 4usize.checked_add(name_length).ok_or("native save name length overflow")?;
    let name_bytes = payload.get(4..data_offset).ok_or("native save file name is truncated")?;
    let file_name = std::str::from_utf8(name_bytes).map_err(|_| "native save file name must be UTF-8")?;
    let file_name = std::path::Path::new(file_name).file_name()
        .and_then(|name| name.to_str()).filter(|name| !name.is_empty()).unwrap_or("Untitled.luma");
    let data = payload.get(data_offset..).ok_or("native save data is truncated")?;
    if data.len() > MAX_NATIVE_FILE_BYTES {
        return Err(format!("Save exceeds the {} MB desktop limit", MAX_NATIVE_FILE_BYTES / 1024 / 1024));
    }
    let extension = std::path::Path::new(file_name).extension().and_then(|value| value.to_str()).unwrap_or("luma");
    let selected = app.dialog().file()
        .set_file_name(file_name)
        .add_filter("Luma export", &[extension])
        .blocking_save_file();
    let Some(selected) = selected else { return Ok(false); };
    let path = selected.into_path().map_err(|error| error.to_string())?;
    atomic_write(&path, data)?;
    Ok(true)
}

#[tauri::command]
fn open_ai_sign_in(app: tauri::AppHandle) -> Result<(), String> {
    const LABEL: &str = "luma-ai-sign-in";
    if let Some(window) = app.get_webview_window(LABEL) {
        window.show().map_err(|error| error.to_string())?;
        window.set_focus().map_err(|error| error.to_string())?;
        return Ok(());
    }
    let url = "https://luma-studio-preview.armonon.chatgpt.site/signin-with-chatgpt?return_to=/studio"
        .parse().map_err(|error| format!("Invalid AI sign-in URL: {error}"))?;
    tauri::WebviewWindowBuilder::new(&app, LABEL, tauri::WebviewUrl::External(url))
        .title("Sign in to Luma AI")
        .inner_size(560.0, 760.0)
        .min_inner_size(440.0, 600.0)
        .build()
        .map_err(|error| format!("Unable to open AI sign-in: {error}"))?;
    Ok(())
}

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
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            core_info,
            composite_native_tile,
            open_native_file,
            save_native_file,
            open_ai_sign_in,
        ])
        .run(tauri::generate_context!())
        .expect("failed to start Luma Studio");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn push_f32(bytes: &mut Vec<u8>, value: f32) { bytes.extend_from_slice(&value.to_le_bytes()); }

    /// The other half of the TypeScript<->Rust protocol contract.
    ///
    /// `tests/fixtures/native-tile.bin` is produced by the real TypeScript
    /// encoder and committed. Previously each side was tested against its own
    /// hand-built bytes, so an encoder change could silently stop matching the
    /// decoder. If this fails, the wire format moved: regenerate with
    /// `npx tsx tests/fixtures/generate-native-tile.ts` and update both sides.
    #[test]
    fn decodes_the_committed_typescript_fixture() {
        let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../tests/fixtures/native-tile.bin");
        let payload = std::fs::read(path).expect("committed protocol fixture");

        let result = composite_native_payload(&payload).expect("fixture must decode");
        let values: Vec<f32> = result
            .chunks_exact(4)
            .map(|chunk| f32::from_le_bytes(chunk.try_into().unwrap()))
            .collect();

        // Mirrors NATIVE_TILE_EXPECTED in tests/fixtures/native-tile-input.ts.
        let expected = [0.75_f32, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 1.0];
        assert_eq!(values.len(), expected.len(), "fixture pixel count changed");
        for (i, (got, want)) in values.iter().zip(expected.iter()).enumerate() {
            assert!(
                (got - want).abs() < 1e-6,
                "channel {i}: expected {want}, got {got}"
            );
        }
    }

    #[test]
    fn native_tile_protocol_composites_float_layers_without_json() {
        let mut payload = NATIVE_TILE_MAGIC.to_vec();
        payload.extend_from_slice(&1u32.to_le_bytes());
        payload.extend_from_slice(&1u32.to_le_bytes());
        payload.extend_from_slice(&2u32.to_le_bytes());
        // Top: half-opacity blue, normal mode.
        payload.extend_from_slice(&0u32.to_le_bytes());
        push_f32(&mut payload, 0.5);
        payload.extend_from_slice(&0u32.to_le_bytes());
        payload.extend_from_slice(&0u32.to_le_bytes());
        for value in [0.0, 0.0, 1.0, 1.0] { push_f32(&mut payload, value); }
        // Bottom: opaque red.
        payload.extend_from_slice(&0u32.to_le_bytes());
        push_f32(&mut payload, 1.0);
        payload.extend_from_slice(&0u32.to_le_bytes());
        payload.extend_from_slice(&0u32.to_le_bytes());
        for value in [1.0, 0.0, 0.0, 1.0] { push_f32(&mut payload, value); }

        let result = composite_native_payload(&payload).expect("valid tile");
        let values: Vec<f32> = result.chunks_exact(4)
            .map(|chunk| f32::from_le_bytes(chunk.try_into().unwrap()))
            .collect();
        assert_eq!(values, vec![0.5, 0.0, 0.5, 1.0]);
    }

    #[test]
    fn native_tile_protocol_rejects_malformed_payloads() {
        assert!(composite_native_payload(b"bad").is_err());
        let mut payload = NATIVE_TILE_MAGIC.to_vec();
        payload.extend_from_slice(&0u32.to_le_bytes());
        payload.extend_from_slice(&1u32.to_le_bytes());
        payload.extend_from_slice(&0u32.to_le_bytes());
        assert!(composite_native_payload(&payload).is_err());
    }

    #[test]
    fn native_file_save_atomically_replaces_contents_without_temp_leaks() {
        let root = std::env::temp_dir().join(format!(
            "luma-atomic-save-{}-{}",
            std::process::id(),
            SAVE_TEMP_COUNTER.fetch_add(1, Ordering::Relaxed),
        ));
        std::fs::create_dir_all(&root).unwrap();
        let target = root.join("project.luma");
        std::fs::write(&target, b"old").unwrap();
        atomic_write(&target, b"new project").unwrap();
        assert_eq!(std::fs::read(&target).unwrap(), b"new project");
        assert_eq!(std::fs::read_dir(&root).unwrap().count(), 1);
        std::fs::remove_file(target).unwrap();
        std::fs::remove_dir(root).unwrap();
    }
}
