// Luma Studio — pro edition shell.
//
// The desktop build is deliberately thin: all editing lives in the shared
// engine (`app/engine`), which is DOM-optional and identical across editions.
// This process only owns the window and, later, the native capabilities the
// web edition cannot have (filesystem access, larger documents, native RAW).
// See `app/engine/edition.ts` for the capability matrix.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use luma_core::{composite_layer, BlendMode, LayerOptions, Surface};
mod fonts;
mod font_face;
mod clipboard;
mod print_color;
mod update_ticket;
mod update_download;
mod termination;
mod atomic_save;
use atomic_save::atomic_write;

#[tauri::command]
async fn list_font_families() -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(fonts::families).await.map_err(|error| error.to_string())?
}

#[tauri::command]
async fn read_installed_font(postscript_name: String) -> Result<tauri::ipc::Response, String> {
    tauri::async_runtime::spawn_blocking(move || font_face::exact_face(&postscript_name))
        .await.map_err(|error| error.to_string())?.map(tauri::ipc::Response::new)
}
use tauri::ipc::{InvokeBody, Request, Response};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_updater::UpdaterExt;
use tauri::menu::{Menu, MenuBuilder, MenuItem, MenuItemKind, SubmenuBuilder};
use tauri::{Emitter, Manager};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};

/// Mirrors MENU_COMMAND_EVENT in app/desktop/menu-model.ts.
const MENU_COMMAND_EVENT: &str = "luma://menu-command";

/// Mirrors OPEN_FILE_EVENT in app/desktop/menu-model.ts.
const OPEN_FILE_EVENT: &str = "luma://open-file";
const CLOSE_REQUEST_EVENT: &str = "luma://close-requested";
static ALLOW_APP_EXIT: AtomicBool = AtomicBool::new(false);
static EXIT_PROMPT_PENDING: AtomicBool = AtomicBool::new(false);
static MENU_STATES: std::sync::Mutex<Option<std::collections::HashMap<String, bool>>> = std::sync::Mutex::new(None);
static UPDATE_RUNNING: AtomicBool = AtomicBool::new(false);
static VERIFIED_UPDATE: std::sync::Mutex<update_ticket::UpdateTicket<(tauri_plugin_updater::Update, Vec<u8>)>> = std::sync::Mutex::new(update_ticket::UpdateTicket::new());

struct UpdateLease;
impl UpdateLease {
    fn acquire() -> Result<Self, String> {
        UPDATE_RUNNING.compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .map(|_| Self).map_err(|_| "An update operation is already running".into())
    }
}
impl Drop for UpdateLease { fn drop(&mut self) { UPDATE_RUNNING.store(false, Ordering::SeqCst); } }

fn apply_menu_states(items: Vec<MenuItemKind<tauri::Wry>>, states: &std::collections::HashMap<String, bool>) -> tauri::Result<()> {
    for item in items {
        match item {
            MenuItemKind::Submenu(menu) => apply_menu_states(menu.items()?, states)?,
            MenuItemKind::MenuItem(item) => {
                if let Some(enabled) = states.get(item.id().0.as_str()) { item.set_enabled(*enabled)?; }
            }
            _ => {}
        }
    }
    Ok(())
}

#[tauri::command]
fn set_menu_command_states(app: tauri::AppHandle, states: std::collections::HashMap<String, bool>) -> Result<(), String> {
    if states.len() > 256 || states.keys().any(|key| key.len() > 80) { return Err("Invalid menu state payload".into()); }
    *MENU_STATES.lock().map_err(|_| "menu state lock poisoned")? = Some(states.clone());
    if let Some(menu) = app.menu() {
        apply_menu_states(menu.items().map_err(|error| error.to_string())?, &states).map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[derive(Default)]
struct OpenFileBridge {
    frontend_ready: bool,
    pending: Vec<String>,
}

impl OpenFileBridge {
    fn route(&mut self, path: String) -> Option<String> {
        if self.frontend_ready {
            Some(path)
        } else {
            self.pending.push(path);
            None
        }
    }

    fn mark_ready_and_take_pending(&mut self) -> Vec<String> {
        self.frontend_ready = true;
        std::mem::take(&mut self.pending)
    }
}

/// A macOS open-document event may arrive before the webview has mounted.
/// The readiness bit and queue share one lock so draining cannot race an event
/// into a permanently stranded queue.
static OPEN_FILE_BRIDGE: std::sync::Mutex<OpenFileBridge> =
    std::sync::Mutex::new(OpenFileBridge { frontend_ready: false, pending: Vec::new() });

/// The most recent files, newest first. Rebuilt into the File menu on demand.
static RECENT_FILES: std::sync::Mutex<Vec<String>> = std::sync::Mutex::new(Vec::new());

/// Cap on the Open Recent submenu. Long enough to be useful, short enough that
/// the menu stays a menu.
const MAX_RECENT_FILES: usize = 10;

/// Recent-file menu ids carry their path after this prefix, so the handler can
/// tell them apart from the fixed commands without a second lookup table.
const RECENT_FILE_PREFIX: &str = "recent:";

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

fn parse_named_payload(payload: &[u8]) -> Result<(&str, &[u8]), String> {
    if payload.len() < 4 { return Err("named binary payload is truncated".into()); }
    let name_length = u32::from_le_bytes(payload[0..4].try_into().expect("four byte name length")) as usize;
    let data_offset = 4usize.checked_add(name_length).ok_or("named binary name length overflow")?;
    let name_bytes = payload.get(4..data_offset).ok_or("named binary file name is truncated")?;
    let file_name = std::str::from_utf8(name_bytes).map_err(|_| "named binary file name must be UTF-8")?;
    let data = payload.get(data_offset..).ok_or("named binary data is truncated")?;
    Ok((file_name, data))
}

/// Develop proprietary camera RAW through macOS ImageIO (via the system sips
/// frontend). No shell is involved, names are stripped to a known extension,
/// and the isolated temporary directory is always removed. The returned PNG
/// is a real OS RAW development; callers retain the tagged embedded preview as
/// a fallback when the installed macOS release does not support that camera.
#[tauri::command]
fn develop_native_raw(request: Request<'_>) -> Result<Response, String> {
    let InvokeBody::Raw(payload) = request.body() else {
        return Err("native RAW development requires a raw binary request".into());
    };
    let (file_name, data) = parse_named_payload(payload)?;
    if data.is_empty() || data.len() > MAX_NATIVE_FILE_BYTES {
        return Err(format!("RAW source must contain 1..={} MB", MAX_NATIVE_FILE_BYTES / 1024 / 1024));
    }
    let extension = std::path::Path::new(file_name).extension()
        .and_then(|value| value.to_str()).unwrap_or("").to_ascii_lowercase();
    const RAW_EXTENSIONS: &[&str] = &["dng", "cr2", "cr3", "nef", "nrw", "arw", "raf", "orf", "rw2", "pef"];
    if !RAW_EXTENSIONS.contains(&extension.as_str()) {
        return Err("native RAW development received an unsupported extension".into());
    }
    #[cfg(not(target_os = "macos"))]
    return Err("native RAW development currently requires macOS ImageIO".into());
    #[cfg(target_os = "macos")]
    {
        let counter = SAVE_TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
        let temp = std::env::temp_dir().join(format!("luma-raw-{}-{counter}", std::process::id()));
        std::fs::create_dir(&temp).map_err(|error| format!("Unable to create RAW workspace: {error}"))?;
        let input = temp.join(format!("source.{extension}"));
        let output = temp.join("developed.png");
        let result = (|| -> Result<Vec<u8>, String> {
            std::fs::write(&input, data).map_err(|error| format!("Unable to stage RAW source: {error}"))?;
            let conversion = std::process::Command::new("/usr/bin/sips")
                .args(["-s", "format", "png"])
                .arg(&input)
                .arg("--out")
                .arg(&output)
                .output()
                .map_err(|error| format!("Unable to start macOS RAW developer: {error}"))?;
            if !conversion.status.success() {
                let detail = String::from_utf8_lossy(&conversion.stderr).trim().to_owned();
                return Err(if detail.is_empty() {
                    "macOS ImageIO could not develop this camera RAW".into()
                } else {
                    format!("macOS ImageIO could not develop this camera RAW: {detail}")
                });
            }
            let developed = std::fs::read(&output).map_err(|error| format!("Unable to read developed RAW: {error}"))?;
            if developed.len() < 8 || developed.get(0..8) != Some(b"\x89PNG\r\n\x1a\n") {
                return Err("macOS RAW developer returned an invalid PNG".into());
            }
            Ok(developed)
        })();
        let _ = std::fs::remove_dir_all(&temp);
        result.map(Response::new)
    }
}

#[tauri::command]
async fn open_native_file(app: tauri::AppHandle) -> Result<Response, String> {
    let selected = app.dialog().file()
        .add_filter("Luma, SVG, images, Photoshop, and RAW", &[
            "luma", "svg", "pdf", "lumaformtext", "lumaformmesh", "psd", "psb", "png", "jpg", "jpeg", "webp", "gif", "bmp", "tif", "tiff",
            "dng", "cr2", "cr3", "nef", "nrw", "arw", "orf", "raf", "rw2", "pef",
        ])
        .blocking_pick_file();
    let Some(selected) = selected else { return Ok(Response::new(0u32.to_le_bytes().to_vec())); };
    let path = selected.into_path().map_err(|error| error.to_string())?;
    let metadata = std::fs::metadata(&path).map_err(|error| format!("Unable to inspect selected file: {error}"))?;
    if metadata.len() > MAX_NATIVE_FILE_BYTES as u64 {
        return Err(format!("Selected file exceeds the {} MB desktop limit", MAX_NATIVE_FILE_BYTES / 1024 / 1024));
    }
    read_framed_file(&path)
}

/// Read a file and frame it as `[name length][name][bytes]`.
///
/// Shared by the dialog and by open-by-path so the two cannot come to disagree
/// about the size limit or the wire shape.
fn read_framed_file(path: &std::path::Path) -> Result<Response, String> {
    let metadata = std::fs::metadata(path).map_err(|error| format!("Unable to inspect file: {error}"))?;
    let limit = native_input_byte_limit(path);
    if metadata.len() > limit as u64 {
        return Err(format!("File exceeds the {} MB desktop limit for this format", limit / 1024 / 1024));
    }
    use std::io::Read;
    let framed_path = path.to_string_lossy();
    let name = framed_path.as_bytes();
    let name_length = u32::try_from(name.len()).map_err(|_| "File name is too long")?;
    let data_length = usize::try_from(metadata.len()).map_err(|_| "File is too large for this platform")?;
    let mut response = Vec::with_capacity(4 + name.len() + data_length);
    response.extend_from_slice(&name_length.to_le_bytes());
    response.extend_from_slice(name);
    let start = response.len();
    response.resize(start + data_length, 0);
    std::fs::File::open(path)
        .and_then(|mut file| file.read_exact(&mut response[start..]))
        .map_err(|error| format!("Unable to read file: {error}"))?;
    Ok(Response::new(response))
}

fn native_input_byte_limit(path: &std::path::Path) -> usize {
    match path.extension().and_then(|value| value.to_str()).unwrap_or("").to_ascii_lowercase().as_str() {
        "svg" => 2 * 1024 * 1024,
        "pdf" => 8 * 1024 * 1024,
        "lumaformtext" => 4 * 1024 * 1024,
        "lumaformmesh" => 8 * 1024 * 1024,
        _ => MAX_NATIVE_FILE_BYTES,
    }
}

/// Read a document the OS asked us to open, by absolute path.
///
/// Unlike the dialog, nothing here has been through a file picker, so the path
/// is whatever the OS or an Open Recent entry supplied. It has to be a file
/// that exists — a stale recent entry pointing at a deleted document must fail
/// with a message rather than opening something unexpected.
#[tauri::command]
async fn read_native_path(path: String) -> Result<Response, String> {
    let path = std::path::PathBuf::from(path);
    if !path.is_file() {
        return Err("That document is no longer where it was.".into());
    }
    read_framed_file(&path)
}

#[tauri::command]
fn take_pending_open_files() -> Result<Vec<String>, String> {
    let mut bridge = OPEN_FILE_BRIDGE.lock().map_err(|_| "open-file bridge lock poisoned")?;
    Ok(bridge.mark_ready_and_take_pending())
}

#[tauri::command]
fn confirm_native_exit(app: tauri::AppHandle) {
    ALLOW_APP_EXIT.store(true, Ordering::SeqCst);
    EXIT_PROMPT_PENDING.store(false, Ordering::SeqCst);
    app.exit(0);
}

#[tauri::command]
fn cancel_native_exit() {
    EXIT_PROMPT_PENDING.store(false, Ordering::SeqCst);
}

/// Ask the signed updater endpoint whether this build has a newer release.
///
/// The update object intentionally never crosses IPC: it owns native resources
/// and a verified download URL. The frontend receives only display metadata,
/// then installation checks the endpoint again and refuses a changed version.
#[tauri::command]
async fn check_desktop_update(app: tauri::AppHandle) -> Result<Option<serde_json::Value>, String> {
    let updater = app.updater_builder().timeout(std::time::Duration::from_secs(30)).build().map_err(|error| format!("Update service unavailable: {error}"))?;
    let update = updater.check().await.map_err(|error| format!("Unable to check for updates: {error}"))?;
    Ok(update.map(|candidate| serde_json::json!({
        "currentVersion": candidate.current_version,
        "version": candidate.version,
        "date": candidate.date.map(|date| date.to_string()),
        "body": candidate.body,
    })))
}

/// Download and signature-check only. No executable is replaced here.
#[tauri::command]
async fn prepare_desktop_update(app: tauri::AppHandle, expected_version: String) -> Result<String, String> {
    let _lease = UpdateLease::acquire()?;
    VERIFIED_UPDATE.lock().map_err(|_| "update ticket lock poisoned")?.clear();
    let updater = app.updater_builder().timeout(std::time::Duration::from_secs(30)).build().map_err(|error| format!("Update service unavailable: {error}"))?;
    let update = updater
        .check()
        .await
        .map_err(|error| format!("Unable to refresh the update: {error}"))?
        .ok_or_else(|| "The update is no longer available.".to_string())?;
    if update.version != expected_version {
        return Err(format!(
            "The available update changed from {expected_version} to {}. Check again before installing.",
            update.version
        ));
    }
    let public_key = app.config().plugins.0.get("updater").and_then(|config| config.get("pubkey")).and_then(|key| key.as_str())
        .ok_or("Updater public key is not configured")?;
    let bytes = update_download::download(&update, public_key).await?;
    Ok(VERIFIED_UPDATE.lock().map_err(|_| "update ticket lock poisoned")?.stage((update, bytes)))
}

#[tauri::command]
fn discard_desktop_update(token: String) -> Result<(), String> {
    VERIFIED_UPDATE.lock().map_err(|_| "update ticket lock poisoned")?.discard(&token);
    Ok(())
}

/// Consume the exact verified bytes, with no second network wait after the
/// frontend has checkpointed and revalidated all documents. Failure never exits.
#[tauri::command]
fn install_desktop_update(app: tauri::AppHandle, token: String) -> Result<(), String> {
    let _lease = UpdateLease::acquire()?;
    let (update, bytes) = VERIFIED_UPDATE.lock().map_err(|_| "update ticket lock poisoned")?.take(&token)?;
    update.install(bytes).map_err(|error| format!("The signed update could not be installed: {error}"))?;
    app.restart();
}

fn request_exit_confirmation(app: &tauri::AppHandle) {
    // Re-emit on every exit request rather than latching on the first.
    //
    // The latch assumed the first emit always reached a listener. It does not:
    // the frontend subscribes from an effect gated on `studio`, which is null
    // until the engine resolves, so a Cmd+Q during boot emitted into a void
    // while both exit paths kept calling prevent_close()/prevent_exit(). With
    // the flag stuck true nothing ever re-emitted, so every subsequent quit,
    // window close and Dock > Quit was silently refused for the rest of the
    // session and Force Quit was the only way out — losing exactly the unsaved
    // work this confirmation exists to protect.
    //
    // Emitting again is safe: the handler either sets a React boolean that is
    // already true or calls confirm_native_exit, both idempotent.
    EXIT_PROMPT_PENDING.store(true, Ordering::SeqCst);
    let _ = app.emit(CLOSE_REQUEST_EVENT, ());
}

fn route_open_file(app: &tauri::AppHandle, path: String) {
    let immediate = match OPEN_FILE_BRIDGE.lock() {
        Ok(mut bridge) => bridge.route(path),
        // A poisoned convenience queue must not make all future document opens
        // inert. Emitting is the safest degradation once the process is alive.
        Err(_) => Some(path),
    };
    if let Some(path) = immediate {
        let _ = app.emit(OPEN_FILE_EVENT, path);
    }
}

#[tauri::command]
async fn save_native_file(app: tauri::AppHandle, request: Request<'_>) -> Result<bool, String> {
    let InvokeBody::Raw(payload) = request.body() else {
        return Err("native save requires a raw binary request".into());
    };
    let (file_name, data) = parse_named_payload(payload)?;
    let file_name = std::path::Path::new(file_name).file_name()
        .and_then(|name| name.to_str()).filter(|name| !name.is_empty()).unwrap_or("Untitled.luma");
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
async fn save_native_file_as(app: tauri::AppHandle, request: Request<'_>) -> Result<Option<String>, String> {
    let InvokeBody::Raw(payload) = request.body() else {
        return Err("native save requires a raw binary request".into());
    };
    let (file_name, data) = parse_named_payload(payload)?;
    let file_name = std::path::Path::new(file_name).file_name()
        .and_then(|name| name.to_str()).filter(|name| !name.is_empty()).unwrap_or("Untitled.luma");
    if data.len() > MAX_NATIVE_FILE_BYTES {
        return Err(format!("Save exceeds the {} MB desktop limit", MAX_NATIVE_FILE_BYTES / 1024 / 1024));
    }
    let selected = app.dialog().file().set_file_name(file_name).add_filter("Luma project", &["luma"]).blocking_save_file();
    let Some(selected) = selected else { return Ok(None); };
    let path = selected.into_path().map_err(|error| error.to_string())?;
    atomic_write(&path, data)?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

#[tauri::command]
async fn save_native_path(request: Request<'_>) -> Result<bool, String> {
    let InvokeBody::Raw(payload) = request.body() else {
        return Err("native save requires a raw binary request".into());
    };
    let (path, data) = parse_named_payload(payload)?;
    if data.len() > MAX_NATIVE_FILE_BYTES {
        return Err(format!("Save exceeds the {} MB desktop limit", MAX_NATIVE_FILE_BYTES / 1024 / 1024));
    }
    let path = std::path::PathBuf::from(path);
    if !path.is_absolute() || path.extension().and_then(|value| value.to_str()).map(|value| !value.eq_ignore_ascii_case("luma")).unwrap_or(true) {
        return Err("A remembered project save must target an absolute .luma path".into());
    }
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
/// Replace the Open Recent list and rebuild the menu around it.
///
/// The frontend owns the list — it knows which opens succeeded, and it already
/// persists preferences — so this takes the whole list rather than trying to
/// track it here. Paths are truncated for display only; the full path is what
/// travels back when an item is chosen.
#[tauri::command]
fn set_recent_files(app: tauri::AppHandle, files: Vec<String>) -> Result<(), String> {
    {
        let mut recent = RECENT_FILES.lock().map_err(|_| "recent files lock poisoned")?;
        recent.clear();
        recent.extend(files.into_iter().take(MAX_RECENT_FILES));
    }
    let menu = build_menu(&app).map_err(|error| error.to_string())?;
    app.set_menu(menu).map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn core_info() -> serde_json::Value {
    serde_json::json!({
        "threads": rayon::current_num_threads(),
        "precision": "f32",
        "blendModes": luma_core::BlendMode::ALL.iter().map(|m| m.id()).collect::<Vec<_>>(),
    })
}

/// The application menu.
///
/// `app/desktop/menu-model.ts` is the canonical definition and
/// `tests/desktop-menu.test.ts` asserts this file agrees with it, item for
/// item. Two hand-maintained lists would drift, and a menu entry wired on one
/// side only is a dead entry the user still sees.
///
/// Every id here reaches a real studio command. Nothing is laid out because
/// Photoshop has it; an item Luma cannot perform is absent rather than present
/// and inert.
fn build_menu(app: &tauri::AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let states = MENU_STATES.lock().ok().and_then(|states| states.clone()).unwrap_or_default();
    let item = |id: &str, label: &str, accelerator: Option<&str>| {
        MenuItem::with_id(app, id, label, states.get(id).copied().unwrap_or(false), accelerator)
    };

    let app_menu = SubmenuBuilder::new(app, "Luma Studio")
        .about(None)
        .separator()
        .item(&item("check-for-updates", "Check for Updates…", None)?)
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()?;

    // Open Recent is built from RECENT_FILES rather than declared in the model,
    // because its items are paths rather than commands. Choosing one emits the
    // open-file event, the same one a double-clicked document arrives on.
    let recent = RECENT_FILES.lock().map_err(|_| tauri::Error::FailedToReceiveMessage)?;
    let mut recent_menu = SubmenuBuilder::new(app, "Open Recent");
    for path in recent.iter() {
        let label = std::path::Path::new(path)
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or(path.as_str());
        recent_menu = recent_menu.item(&MenuItem::with_id(
            app,
            format!("{RECENT_FILE_PREFIX}{path}"),
            label,
            true,
            None::<&str>,
        )?);
    }
    if recent.is_empty() {
        recent_menu = recent_menu.item(&MenuItem::with_id(
            app, "recent-empty", "No Recent Documents", false, None::<&str>,
        )?);
    }
    drop(recent);
    let recent_submenu = recent_menu.build()?;

    let file = SubmenuBuilder::new(app, "File")
        .item(&item("new-document", "New…", Some("CmdOrCtrl+N"))?)
        .item(&item("open", "Open…", Some("CmdOrCtrl+O"))?)
        .item(&recent_submenu)
        .item(&item("save", "Save", Some("CmdOrCtrl+S"))?)
        .item(&item("save-as", "Save As…", Some("CmdOrCtrl+Shift+S"))?)
        .separator()
        .item(&item("export", "Export…", Some("CmdOrCtrl+Shift+E"))?)
        .item(&item("export-print", "CMYK Print PDF…", None)?)
        .item(&item("batch", "Batch Process…", None)?)
        .separator()
        .item(&item("close-document", "Close Document", Some("CmdOrCtrl+W"))?)
        .build()?;

    let edit = SubmenuBuilder::new(app, "Edit")
        .item(&item("undo", "Undo", Some("CmdOrCtrl+Z"))?)
        .item(&item("redo", "Redo", Some("CmdOrCtrl+Shift+Z"))?)
        .separator()
        // The text roles are what make copy and paste work inside the studio's
        // own inputs; canvas clipboard events route to pixel commands instead.
        .cut()
        .copy()
        .paste()
        .separator()
        .item(&item("copy-pixels", "Copy Selected Pixels", None)?)
        .item(&item("copy-merged", "Copy Merged", Some("CmdOrCtrl+Shift+C"))?)
        .item(&item("cut-pixels", "Cut Selected Pixels", None)?)
        .item(&item("paste-pixels", "Paste Pixels as Layer", None)?)
        .item(&item("paste-in-place", "Paste in Place", Some("CmdOrCtrl+Shift+V"))?)
        .item(&item("delete-pixels", "Delete Selected Pixels", None)?)
        .item(&item("selection-to-layer", "Layer via Copy", Some("CmdOrCtrl+Alt+J"))?)
        .separator()
        .item(&item("copy-layer-style", "Copy Layer Style", None)?)
        .item(&item("define-custom-shape", "Define Custom Shape", None)?)
        .item(&item("paste-layer-style", "Paste Layer Style", None)?)
        .separator()
        .item(&item("history", "Version History…", None)?)
        .build()?;

    let image = SubmenuBuilder::new(app, "Image")
        .item(&item("document-properties", "Document Properties…", None)?)
        .separator()
        .item(&item("crop-selection", "Crop to Selection", None)?)
        .build()?;

    let layer = SubmenuBuilder::new(app, "Layer")
        .item(&item("new-layer", "New Layer", Some("CmdOrCtrl+Shift+N"))?)
        .item(&item("duplicate-layer", "Duplicate Layer", Some("CmdOrCtrl+J"))?)
        .item(&item("group-layer", "Group Selected Layers", Some("CmdOrCtrl+G"))?)
        .item(&item("ungroup-layers", "Ungroup Selected Layers", Some("CmdOrCtrl+Shift+G"))?)
        .item(&item("merge-layers", "Merge Selected Layers", Some("CmdOrCtrl+E"))?)
        .item(&item("rename-layer", "Rename Layer…", None)?)
        .item(&item("toggle-layer-lock", "Lock / Unlock Selected Layers", None)?)
        .item(&item("toggle-layer-visibility", "Show / Hide Selected Layers", None)?)
        .item(&item("delete-layer", "Delete Layer", None)?)
        .item(&item("convert-smart-object", "Convert to Smart Object", None)?)
        .item(&item("replace-smart-content", "Replace Raster Contents…", None)?)
        .item(&item("edit-smart-content", "Edit Smart Contents…", None)?)
        .item(&item("apply-smart-content", "Apply Contents to Parent", None)?)
        .separator()
        .item(&item("bring-forward", "Bring Forward", Some("CmdOrCtrl+]"))?)
        .item(&item("send-backward", "Send Backward", Some("CmdOrCtrl+["))?)
        .separator()
        .item(&item("layer-style", "Layer Style…", None)?)
        .item(&item("recolor", "Recolor…", Some("CmdOrCtrl+Alt+R"))?)
        .separator()
        .item(&item("curves", "New Curves Adjustment", None)?)
        .item(&item("levels", "New Levels Adjustment", None)?)
        .item(&item("hsl", "New HSL Adjustment", None)?)
        .build()?;

    let select = SubmenuBuilder::new(app, "Select")
        .item(&item("select-all", "All", Some("CmdOrCtrl+A"))?)
        .item(&item("deselect", "Deselect", Some("CmdOrCtrl+D"))?)
        .item(&item("invert-selection", "Inverse", Some("CmdOrCtrl+Shift+I"))?)
        .separator()
        .item(&item("select-subject", "Subject", None)?)
        .item(&item("select-channel", "Load Composite Channel", Some("CmdOrCtrl+Alt+2"))?)
        .item(&item("channel-save", "Save Selection as Alpha Channel", Some("CmdOrCtrl+Shift+Alt+2"))?)
        .item(&item("channel-load", "Load Saved Alpha Channel", None)?)
        .item(&item("channel-update", "Replace Alpha with Selection", None)?)
        .item(&item("channel-rename", "Rename Alpha Channel", None)?)
        .item(&item("channel-invert", "Invert Alpha Channel", None)?)
        .item(&item("channel-calculate", "Calculate Alpha Channels", None)?)
        .item(&item("channel-delete", "Delete Alpha Channel", None)?)
        .build()?;

    let filter = SubmenuBuilder::new(app, "Filter")
        .item(&item("filter-gallery", "Filter Gallery…", None)?)
        .separator()
        .item(&item("filter-invert", "Invert Pixels", None)?)
        .item(&item("filter-blur", "Gaussian Blur", None)?)
        .item(&item("filter-sharpen", "Sharpen", None)?)
        .item(&item("filter-desaturate", "Desaturate", None)?)
        .build()?;

    let view = SubmenuBuilder::new(app, "View")
        .item(&item("zoom-in", "Zoom In", Some("CmdOrCtrl+Plus"))?)
        .item(&item("zoom-out", "Zoom Out", Some("CmdOrCtrl+-"))?)
        .separator()
        .item(&item("zoom-fit", "Fit on Screen", Some("CmdOrCtrl+0"))?)
        .item(&item("zoom-actual", "Actual Size", Some("CmdOrCtrl+1"))?)
        .separator()
        .item(&item("toggle-guides", "Show Guides", None)?)
        .item(&item("toggle-rulers", "Show Rulers", Some("CmdOrCtrl+R"))?)
        .separator()
        .fullscreen()
        .minimize()
        .build()?;

    let window = SubmenuBuilder::new(app, "Window")
        .item(&item("panel-layers", "Layers", None)?)
        .item(&item("panel-properties", "Properties", None)?)
        .item(&item("panel-selection", "Selection", None)?)
        .item(&item("panel-mask", "Masks", None)?)
        .item(&item("panel-raw", "RAW Develop", None)?)
        .item(&item("panel-paint", "Brushes", None)?)
        .item(&item("panel-vector", "Type & Vector", None)?)
        .item(&item("panel-transform", "Transform", None)?)
        .item(&item("panel-measure", "Measure", None)?)
        .item(&item("panel-document", "Document & Color", None)?)
        .item(&item("panel-channels", "Channels", None)?)
        .item(&item("panel-comps", "Layer Comps & Artboards", None)?)
        .item(&item("panel-campaign", "Campaign", Some("CmdOrCtrl+Alt+K"))?)
        .item(&item("panel-assets", "Plugins & Assets", None)?)
        .item(&item("panel-neural", "Neural Lab", None)?)
        .item(&item("panel-actions", "Actions", None)?)
        .separator()
        .item(&item("workspace-settings", "Workspace Settings…", None)?)
        .build()?;

    MenuBuilder::new(app)
        .items(&[&app_menu, &file, &edit, &image, &layer, &select, &filter, &view, &window])
        .build()
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        // Restores window size, position and maximised state between launches.
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            print_color::convert_print_cmyk,
            clipboard::native_clipboard_info,
            clipboard::write_native_clipboard,
            clipboard::read_native_clipboard,
            list_font_families,
            read_installed_font,
            core_info,
            composite_native_tile,
            develop_native_raw,
            open_native_file,
            save_native_file,
            save_native_file_as,
            save_native_path,
            open_ai_sign_in,
            set_recent_files,
            set_menu_command_states,
            read_native_path,
            take_pending_open_files,
            confirm_native_exit,
            cancel_native_exit,
            check_desktop_update,
            prepare_desktop_update,
            discard_desktop_update,
            install_desktop_update,
        ])
        .setup(|app| {
            termination::install(app.handle()).map_err(std::io::Error::other)?;
            let menu = build_menu(app.handle())?;
            app.set_menu(menu)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if !ALLOW_APP_EXIT.load(Ordering::SeqCst) {
                    api.prevent_close();
                    request_exit_confirmation(window.app_handle());
                }
            }
        })
        // The frontend owns what a command means; this only carries the id
        // across. Keeping the behaviour on the TypeScript side is what lets
        // one implementation serve the menu and the keyboard listener.
        .on_menu_event(|app, event| {
            let id = event.id().0.as_str();
            if let Some(path) = id.strip_prefix(RECENT_FILE_PREFIX) {
                route_open_file(app, path.to_owned());
            } else {
                let _ = app.emit(MENU_COMMAND_EVENT, id);
            }
        })
        .build(tauri::generate_context!())
        .expect("failed to start Luma Studio")
        // Documents opened from the Finder or the shell arrive here rather than
        // as arguments — on macOS the OS delivers them after launch, and for an
        // already-running instance there is no argv to read at all. The
        // frontend decides what to do with the path; this only relays it.
        .run(|app, event| {
            match event {
                tauri::RunEvent::Opened { urls } => {
                    for url in urls {
                        let path = url
                            .to_file_path()
                            .ok()
                            .and_then(|path| path.to_str().map(str::to_owned))
                            .unwrap_or_else(|| url.to_string());
                        route_open_file(app, path);
                    }
                }
                tauri::RunEvent::ExitRequested { api, .. } if !ALLOW_APP_EXIT.load(Ordering::SeqCst) => {
                    api.prevent_exit();
                    request_exit_confirmation(app);
                }
                _ => {}
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn svg_input_limit_is_applied_before_native_buffer_allocation() {
        assert_eq!(native_input_byte_limit(std::path::Path::new("drawing.SVG")), 2 * 1024 * 1024);
        assert_eq!(native_input_byte_limit(std::path::Path::new("drawing.PDF")), 8 * 1024 * 1024);
        assert_eq!(native_input_byte_limit(std::path::Path::new("return.LUMAFORMTEXT")), 4 * 1024 * 1024);
        assert_eq!(native_input_byte_limit(std::path::Path::new("drawing.psd")), MAX_NATIVE_FILE_BYTES);
        let path = std::env::temp_dir().join(format!("luma-oversized-svg-{}.svg", std::process::id()));
        let file = std::fs::File::create(&path).unwrap();
        file.set_len(2 * 1024 * 1024 + 1).unwrap();
        let result = read_framed_file(&path);
        drop(file);
        std::fs::remove_file(path).unwrap();
        assert!(matches!(result, Err(message) if message.contains("2 MB")));
    }

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

    #[test]
    fn cold_launch_files_are_buffered_then_live_files_route_immediately() {
        let mut bridge = OpenFileBridge::default();
        assert_eq!(bridge.route("/tmp/first.psd".into()), None);
        assert_eq!(bridge.route("/tmp/second.luma".into()), None);
        assert_eq!(
            bridge.mark_ready_and_take_pending(),
            vec!["/tmp/first.psd", "/tmp/second.luma"],
        );
        assert!(bridge.pending.is_empty());
        assert_eq!(bridge.route("/tmp/live.psb".into()), Some("/tmp/live.psb".into()));
    }
}
