//! User-initiated image clipboard only. No clipboard polling or file URL reads.
use std::io::{Cursor, Write};
use tauri::ipc::{InvokeBody, Request, Response};

const MAX_ENCODED: usize = 32 * 1024 * 1024;
const MAX_PIXELS: u64 = 16 * 1024 * 1024;
const MAX_EDGE: u32 = 16384;
static CLIPBOARD_OPERATION: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn dimensions(bytes: &[u8], format: image::ImageFormat) -> Result<(), String> {
    if bytes.is_empty() || bytes.len() > MAX_ENCODED { return Err("Clipboard image exceeds the 32 MiB encoded limit".into()); }
    let (w, h) = image::io::Reader::with_format(Cursor::new(bytes), format).into_dimensions().map_err(|e| e.to_string())?;
    if w == 0 || h == 0 || w > MAX_EDGE || h > MAX_EDGE || u64::from(w) * u64::from(h) > MAX_PIXELS {
        return Err("Clipboard image exceeds the 16-megapixel / 16384-edge limit".into());
    }
    Ok(())
}

struct BoundedBytes(Vec<u8>);
impl Write for BoundedBytes {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        if self.0.len().saturating_add(bytes.len()) > MAX_ENCODED {
            return Err(std::io::Error::new(std::io::ErrorKind::OutOfMemory, "Clipboard PNG exceeds 32 MiB"));
        }
        self.0.extend_from_slice(bytes); Ok(bytes.len())
    }
    fn flush(&mut self) -> std::io::Result<()> { Ok(()) }
}

fn to_png(bytes: &[u8], format: image::ImageFormat) -> Result<Vec<u8>, String> {
    dimensions(bytes, format)?;
    let mut reader = image::io::Reader::with_format(Cursor::new(bytes), format);
    let mut limits = image::io::Limits::default();
    limits.max_image_width = Some(MAX_EDGE);
    limits.max_image_height = Some(MAX_EDGE);
    limits.max_alloc = Some(128 * 1024 * 1024);
    reader.limits(limits);
    let decoded = reader.decode().map_err(|e| format!("Clipboard decode failed: {e}"))?;
    let rgba = decoded.into_rgba8();
    let mut output = BoundedBytes(Vec::new());
    image::ImageEncoder::write_image(image::codecs::png::PngEncoder::new(&mut output), &rgba, rgba.width(), rgba.height(), image::ColorType::Rgba8).map_err(|e| e.to_string())?;
    Ok(output.0)
}

#[cfg(target_os = "macos")]
mod platform {
    use super::*;
    use objc2::runtime::ProtocolObject;
    use objc2_app_kit::{NSPasteboard, NSPasteboardItem, NSPasteboardWriting};
    use objc2_foundation::{NSArray, NSData, NSString};
    const MARKER: &str = "app.luma.studio.pixel-clipboard";

    pub fn info_on(board: &NSPasteboard) -> serde_json::Value {
        let count = board.changeCount();
        let marker = board.dataForType(&NSString::from_str(MARKER))
            .filter(|data| data.length() <= 128)
            .and_then(|data| String::from_utf8(data.to_vec()).ok()).unwrap_or_default();
        serde_json::json!({"changeCount": count, "marker": marker})
    }
    pub fn write_on(board: &NSPasteboard, bytes: &[u8], marker: &str, expected: isize) -> Result<(), String> {
        dimensions(bytes, image::ImageFormat::Png)?;
        if marker.is_empty() || marker.len() > 128 { return Err("Invalid clipboard marker".into()); }
        let item = NSPasteboardItem::new();
        if !item.setData_forType(&NSData::with_bytes(bytes), &NSString::from_str("public.png"))
            || !item.setData_forType(&NSData::with_bytes(marker.as_bytes()), &NSString::from_str(MARKER)) {
            return Err("Could not prepare clipboard image".into());
        }
        if board.changeCount() != expected { return Err("Clipboard changed while encoding; newer clipboard preserved".into()); }
        board.clearContents();
        let objects = NSArray::from_slice(&[ProtocolObject::<dyn NSPasteboardWriting>::from_ref(&*item)]);
        if !board.writeObjects(&objects) { return Err("macOS refused the clipboard image".into()); }
        Ok(())
    }
    pub fn read_on(board: &NSPasteboard, expected: isize) -> Result<Vec<u8>, String> {
        if board.changeCount() != expected { return Err("Clipboard changed; paste again".into()); }
        for (name, format) in [("public.png", image::ImageFormat::Png), ("public.tiff", image::ImageFormat::Tiff)] {
            if let Some(data) = board.dataForType(&NSString::from_str(name)) {
                if data.length() > MAX_ENCODED { return Err("Clipboard image exceeds the 32 MiB encoded limit".into()); }
                if board.changeCount() != expected { return Err("Clipboard changed; paste again".into()); }
                return to_png(&data.to_vec(), format);
            }
        }
        Err("The system clipboard does not contain a PNG or TIFF image".into())
    }
    pub fn info() -> serde_json::Value { objc2::rc::autoreleasepool(|_| info_on(&NSPasteboard::generalPasteboard())) }
    pub fn write(bytes: &[u8], marker: &str, expected: isize) -> Result<(), String> {
        objc2::rc::autoreleasepool(|_| write_on(&NSPasteboard::generalPasteboard(), bytes, marker, expected))
    }
    pub fn read(expected: isize) -> Result<Vec<u8>, String> {
        objc2::rc::autoreleasepool(|_| read_on(&NSPasteboard::generalPasteboard(), expected))
    }
}

#[tauri::command]
pub fn native_clipboard_info() -> Result<serde_json::Value, String> {
    #[cfg(target_os = "macos")] { Ok(platform::info()) }
    #[cfg(not(target_os = "macos"))] { Err("Native image clipboard is currently macOS-only".into()) }
}

#[tauri::command]
pub fn write_native_clipboard(request: Request<'_>) -> Result<(), String> {
    let _operation = CLIPBOARD_OPERATION.try_lock().map_err(|_| "Clipboard operation already running")?;
    let bytes = match request.body() { InvokeBody::Raw(bytes) => bytes, _ => return Err("Binary clipboard image required".into()) };
    let marker = request.headers().get("x-luma-marker").and_then(|v| v.to_str().ok()).ok_or("Missing clipboard marker")?;
    let expected: isize = request.headers().get("x-luma-change-count").and_then(|v| v.to_str().ok()).and_then(|v| v.parse().ok()).ok_or("Missing clipboard revision")?;
    #[cfg(target_os = "macos")] { platform::write(bytes, marker, expected) }
    #[cfg(not(target_os = "macos"))] { let _ = (bytes, marker, expected); Err("Native image clipboard is currently macOS-only".into()) }
}

#[tauri::command]
pub async fn read_native_clipboard(change_count: isize) -> Result<Response, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _operation = CLIPBOARD_OPERATION.try_lock().map_err(|_| "Clipboard operation already running")?;
        #[cfg(target_os = "macos")] { platform::read(change_count).map(Response::new) }
        #[cfg(not(target_os = "macos"))] { let _ = change_count; Err("Native image clipboard is currently macOS-only".into()) }
    }).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture(format: image::ImageOutputFormat) -> Vec<u8> {
        let pixels = image::RgbaImage::from_raw(2, 1, vec![255, 40, 10, 128, 10, 50, 255, 0]).unwrap();
        let mut output = Cursor::new(Vec::new());
        image::DynamicImage::ImageRgba8(pixels).write_to(&mut output, format).unwrap(); output.into_inner()
    }
    #[test]
    fn png_and_tiff_preserve_alpha() {
        for (output, input) in [(image::ImageOutputFormat::Png, image::ImageFormat::Png), (image::ImageOutputFormat::Tiff, image::ImageFormat::Tiff)] {
            let png = to_png(&fixture(output), input).unwrap();
            let rgba = image::load_from_memory(&png).unwrap().into_rgba8();
            assert_eq!(rgba.get_pixel(0, 0).0, [255, 40, 10, 128]);
            assert_eq!(rgba.get_pixel(1, 0).0[3], 0);
        }
    }
    #[test]
    fn corrupt_and_oversized_input_refused() {
        assert!(to_png(b"broken", image::ImageFormat::Png).is_err());
        assert!(dimensions(&vec![0; MAX_ENCODED + 1], image::ImageFormat::Png).is_err());
        assert!(BoundedBytes(vec![0; MAX_ENCODED]).write(&[1]).is_err());
    }
    #[cfg(target_os = "macos")]
    #[test]
    fn private_pasteboard_roundtrip_and_revision_protection() {
        use objc2_app_kit::NSPasteboard;
        objc2::rc::autoreleasepool(|_| {
            // Never modify the user's general clipboard during automated tests.
            let board = NSPasteboard::pasteboardWithUniqueName();
            let png = fixture(image::ImageOutputFormat::Png);
            let initial = board.changeCount();
            platform::write_on(&board, &png, "test-marker", initial).unwrap();
            assert_eq!(platform::info_on(&board)["marker"], "test-marker");
            assert!(platform::read_on(&board, board.changeCount()).is_ok());
            assert!(platform::write_on(&board, &png, "stale", initial).is_err());
            assert!(platform::read_on(&board, initial).is_err());
            assert_eq!(platform::info_on(&board)["marker"], "test-marker");
            board.clearContents();
        });
    }
}
