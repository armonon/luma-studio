//! Bounded, statically linked ICC conversion. This is output preparation, not
//! PDF/X certification, nor a CMYK document editing model.
use lcms2::{Flags, Intent, PixelFormat, Profile, Transform};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::ipc::{InvokeBody, Request, Response};

const MAX_PIXELS: usize = 4_000_000;
const MAX_PROFILE: usize = 4 * 1024 * 1024;
static BUSY: AtomicBool = AtomicBool::new(false);
struct Permit;
impl Drop for Permit { fn drop(&mut self) { BUSY.store(false, Ordering::Release); } }

fn be32(data: &[u8], at: usize) -> usize {
    u32::from_be_bytes(data[at..at + 4].try_into().unwrap()) as usize
}

fn validate_profile(profile: &[u8]) -> Result<(), String> {
    if profile.len() < 132 || profile.len() > MAX_PROFILE || be32(profile, 0) != profile.len()
        || &profile[36..40] != b"acsp" || &profile[12..16] != b"prtr" || &profile[16..20] != b"CMYK"
        || (&profile[20..24] != b"XYZ " && &profile[20..24] != b"Lab ") {
        return Err("Choose a valid CMYK printer ICC profile (up to 4 MiB), not a display or device-link profile".into());
    }
    let tags = be32(profile, 128);
    if tags > 4096 || 132 + tags * 12 > profile.len() { return Err("Invalid ICC tag table".into()); }
    for index in 0..tags {
        let at = 132 + index * 12;
        let start = be32(profile, at + 4);
        let size = be32(profile, at + 8);
        if start < 132 + tags * 12 || size < 8 || start.checked_add(size).map_or(true, |end| end > profile.len()) {
            return Err("Invalid ICC tag bounds".into());
        }
    }
    Ok(())
}

fn convert(payload: &[u8]) -> Result<Vec<u8>, String> {
    if payload.len() < 24 || &payload[..4] != b"LCP1" { return Err("Invalid print color request".into()); }
    let width = be32(payload, 4); let height = be32(payload, 8);
    let intent_code = be32(payload, 12); let bpc = be32(payload, 16); let profile_len = be32(payload, 20);
    let count = width.checked_mul(height).ok_or("Print dimensions overflow")?;
    if width == 0 || height == 0 || width > 16384 || height > 16384 || count > MAX_PIXELS || profile_len > MAX_PROFILE
        || bpc > 1 || payload.len() != 24 + profile_len + count * 3 {
        return Err("CMYK output is bounded to 4 megapixels and a 4 MiB profile".into());
    }
    let intent = match intent_code { 0 => Intent::Perceptual, 1 => Intent::RelativeColorimetric,
        2 => Intent::Saturation, 3 => Intent::AbsoluteColorimetric, _ => return Err("Invalid rendering intent".into()) };
    if intent_code == 3 && bpc != 0 { return Err("Absolute colorimetric output does not apply black-point compensation".into()); }
    let profile_bytes = &payload[24..24 + profile_len]; validate_profile(profile_bytes)?;
    let profile = Profile::new_icc(profile_bytes).map_err(|error| format!("ICC profile cannot be opened: {error}"))?;
    if !profile.is_intent_supported(intent, 1) { return Err("The printer profile does not support the selected output intent".into()); }
    // Avoid optimizer-built CLUT expansions; use the profile's admitted tables.
    let flags = if bpc == 1 { Flags::NO_OPTIMIZE | Flags::BLACKPOINT_COMPENSATION } else { Flags::NO_OPTIMIZE };
    let transform = Transform::<u8, u8>::new_flags(&Profile::new_srgb(), PixelFormat::RGB_8, &profile, PixelFormat::CMYK_8, intent, flags)
        .map_err(|error| format!("Cannot construct printer conversion: {error}"))?;
    let mut output = vec![0_u8; count * 4];
    transform.transform_pixels(&payload[24 + profile_len..], &mut output);
    Ok(output)
}

#[tauri::command]
pub async fn convert_print_cmyk(request: Request<'_>) -> Result<Response, String> {
    BUSY.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire).map_err(|_| "Another print conversion is running")?;
    let permit = Permit;
    let InvokeBody::Raw(bytes) = request.body() else { return Err("Print conversion requires binary IPC".into()); };
    if bytes.len() > 24 + MAX_PROFILE + MAX_PIXELS * 3 { return Err("Print payload exceeds its memory bound".into()); }
    let owned = bytes.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _permit = permit;
        convert(&owned).map(Response::new)
    }).await.map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn malformed_and_oversized_requests_fail_before_conversion() {
        assert!(convert(b"bad").is_err());
        let mut data = vec![0; 24]; data[..4].copy_from_slice(b"LCP1");
        data[4..8].copy_from_slice(&50_000_u32.to_be_bytes()); data[8..12].copy_from_slice(&50_000_u32.to_be_bytes());
        assert!(convert(&data).is_err());
        assert!(validate_profile(&vec![0; 132]).is_err());
        assert!(validate_profile(&Profile::new_srgb().icc().unwrap()).is_err());
    }
    #[cfg(target_os = "macos")]
    #[test]
    fn system_cmyk_profile_converts_white_black_and_color() {
        let profile = std::fs::read("/System/Library/ColorSync/Profiles/Generic CMYK Profile.icc").unwrap();
        let mut payload = Vec::from(*b"LCP1");
        for value in [3, 1, 1, 1, profile.len() as u32] { payload.extend(value.to_be_bytes()); }
        payload.extend(profile); payload.extend([255,255,255, 0,0,0, 255,0,0]);
        let result = convert(&payload).unwrap();
        assert_eq!(result.len(), 12);
        assert!(result[..4].iter().all(|&v| v < 10));
        assert!(result[7] > 100);
        assert!(result[8] < result[9]);
        assert!(result[10] > 100);
    }
}
