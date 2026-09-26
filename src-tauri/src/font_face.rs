//! Exact installed faces for local WebView rendering, never arbitrary file IO.
//! Font bytes are transient: callers must not persist/embed them in documents.
const LIMIT: usize = 16 * 1024 * 1024;

fn checksum(bytes: &[u8]) -> u32 {
    bytes.chunks(4).fold(0u32, |sum, part| {
        let mut word = [0u8; 4]; word[..part.len()].copy_from_slice(part);
        sum.wrapping_add(u32::from_be_bytes(word))
    })
}

fn sfnt(mut tables: Vec<(u32, Vec<u8>)>) -> Result<Vec<u8>, String> {
    let tag = |s: &[u8; 4]| u32::from_be_bytes(*s);
    tables.retain(|(id, _)| *id != tag(b"DSIG")); // Repackaged directory has a new checksum.
    tables.sort_by_key(|(id, _)| *id);
    if tables.is_empty() || tables.len() > 128 || tables.windows(2).any(|p| p[0].0 == p[1].0) {
        return Err("Invalid installed-font table directory".into());
    }
    if tables.iter().any(|(id, _)| *id == tag(b"fvar") || *id == tag(b"CFF2")) {
        return Err("Exact native variable-font loading is not qualified; choose a bundled font".into());
    }
    if let Some((_, os2)) = tables.iter().find(|(id, _)| *id == tag(b"OS/2")) {
        if os2.len() < 10 { return Err("Truncated font permissions".into()); }
        let flags = u16::from_be_bytes([os2[8], os2[9]]);
        if flags & 0x0202 != 0 { return Err("Font permissions restrict outline loading; choose another face".into()); }
    }
    for required in [b"head", b"hhea", b"hmtx", b"maxp", b"name", b"cmap"] {
        if !tables.iter().any(|(id, _)| *id == tag(required)) { return Err("Incomplete installed font".into()); }
    }
    let cff = tables.iter().any(|(id, _)| *id == tag(b"CFF "));
    if !cff && [b"glyf", b"loca"].iter().any(|required| !tables.iter().any(|(id, _)| *id == tag(required))) { return Err("Unsupported installed-font outlines".into()); }
    let head = tables.iter_mut().find(|(id, _)| *id == tag(b"head")).unwrap();
    if head.1.len() < 54 { return Err("Truncated font header".into()); }
    head.1[8..12].fill(0);
    let size = tables.iter().try_fold(12 + tables.len() * 16, |size, (_, bytes)| {
        size.checked_add((bytes.len() + 3) & !3).filter(|size| *size <= LIMIT)
    }).ok_or("Installed font exceeds the 16 MiB working limit")?;
    let mut output = vec![0u8; size];
    output[..4].copy_from_slice(if cff { b"OTTO" } else { &[0, 1, 0, 0] });
    let count = tables.len() as u16;
    let power = count.ilog2() as u16;
    let search = (1u16 << power) * 16;
    for (offset, value) in [(4, count), (6, search), (8, power), (10, count * 16 - search)] {
        output[offset..offset + 2].copy_from_slice(&value.to_be_bytes());
    }
    let mut offset = 12 + tables.len() * 16;
    let mut head_offset = 0;
    for (index, (id, bytes)) in tables.iter().enumerate() {
        let record = 12 + index * 16;
        for (slot, value) in [*id, checksum(bytes), offset as u32, bytes.len() as u32].iter().enumerate() {
            output[record + slot * 4..record + slot * 4 + 4].copy_from_slice(&value.to_be_bytes());
        }
        output[offset..offset + bytes.len()].copy_from_slice(bytes);
        if *id == tag(b"head") { head_offset = offset; }
        offset += (bytes.len() + 3) & !3;
    }
    let adjustment = 0xb1b0afbau32.wrapping_sub(checksum(&output));
    output[head_offset + 8..head_offset + 12].copy_from_slice(&adjustment.to_be_bytes());
    Ok(output)
}

#[cfg(target_os = "macos")]
pub fn exact_face(name: &str) -> Result<Vec<u8>, String> {
    use std::ffi::{c_void, c_char, CStr};
    use std::sync::atomic::{AtomicBool, Ordering};
    static BUSY: AtomicBool = AtomicBool::new(false);
    if name.is_empty() || name.len() > 256 || name.chars().any(|c| c.is_control() || c == '/' || c == '\\') {
        return Err("Invalid PostScript font name".into());
    }
    if BUSY.swap(true, Ordering::AcqRel) { return Err("Another native font is loading; retry after it finishes".into()); }
    struct Admission;
    impl Drop for Admission { fn drop(&mut self) { BUSY.store(false, Ordering::Release); } }
    let _admission = Admission;
    #[link(name = "CoreText", kind = "framework")]
    extern "C" {
        fn CTFontCreateWithName(name: *const c_void, size: f64, matrix: *const c_void) -> *const c_void;
        fn CTFontCopyPostScriptName(font: *const c_void) -> *const c_void;
        fn CTFontCopyAvailableTables(font: *const c_void, options: u32) -> *const c_void;
        fn CTFontCopyTable(font: *const c_void, tag: u32, options: u32) -> *const c_void;
    }
    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFRelease(value: *const c_void);
        fn CFStringCreateWithBytes(allocator: *const c_void, bytes: *const u8, length: isize, encoding: u32, external: bool) -> *const c_void;
        fn CFStringGetCString(value: *const c_void, buffer: *mut c_char, size: isize, encoding: u32) -> bool;
        fn CFArrayGetCount(value: *const c_void) -> isize;
        fn CFArrayGetValueAtIndex(value: *const c_void, index: isize) -> *const c_void;
        fn CFDataGetLength(value: *const c_void) -> isize;
        fn CFDataGetBytePtr(value: *const c_void) -> *const u8;
    }
    struct Owned(*const c_void);
    impl Drop for Owned { fn drop(&mut self) { unsafe { CFRelease(self.0); } } }
    fn owned(value: *const c_void) -> Result<Owned, String> {
        if value.is_null() { Err("macOS could not resolve the exact font".into()) } else { Ok(Owned(value)) }
    }
    unsafe {
        let input = owned(CFStringCreateWithBytes(std::ptr::null(), name.as_ptr(), name.len() as isize, 0x08000100, false))?;
        let font = owned(CTFontCreateWithName(input.0, 12., std::ptr::null()))?;
        let actual = owned(CTFontCopyPostScriptName(font.0))?;
        let mut resolved = [0u8; 1025];
        if !CFStringGetCString(actual.0, resolved.as_mut_ptr().cast(), resolved.len() as isize, 0x08000100)
            || CStr::from_ptr(resolved.as_ptr().cast()).to_bytes() != name.as_bytes() {
            return Err(format!("The exact font '{name}' is not installed; no substitute was loaded"));
        }
        let tags = owned(CTFontCopyAvailableTables(font.0, 0))?;
        let count = CFArrayGetCount(tags.0);
        if !(1..=128).contains(&count) { return Err("Installed-font table count exceeds its limit".into()); }
        let mut total = 12 + count as usize * 16;
        let mut tables = Vec::new();
        for index in 0..count {
            // Apple documents these entries as unboxed CTFontTableTag values.
            let tag = CFArrayGetValueAtIndex(tags.0, index) as usize as u32;
            let table = owned(CTFontCopyTable(font.0, tag, 0))?;
            let size = CFDataGetLength(table.0);
            if size < 0 || size as usize > LIMIT { return Err("Installed-font table exceeds its limit".into()); }
            total = total.checked_add((size as usize + 3) & !3).filter(|n| *n <= LIMIT).ok_or("Installed font exceeds the 16 MiB limit")?;
            let pointer = CFDataGetBytePtr(table.0);
            if size > 0 && pointer.is_null() { return Err("Unreadable installed-font table".into()); }
            let bytes = if size == 0 { Vec::new() } else { std::slice::from_raw_parts(pointer, size as usize).to_vec() };
            tables.push((tag, bytes));
        }
        sfnt(tables)
    }
}

#[cfg(not(target_os = "macos"))]
pub fn exact_face(_: &str) -> Result<Vec<u8>, String> { Err("Exact installed fonts require macOS".into()) }

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn directory_rejects_malformed_and_restricted_fonts() {
        assert!(sfnt(vec![]).is_err());
        assert!(sfnt(vec![(u32::from_be_bytes(*b"fvar"), vec![])]).is_err());
        assert!(sfnt(vec![(u32::from_be_bytes(*b"OS/2"), vec![0,0,0,0,0,0,0,0,0,2])]).is_err());
    }
    #[cfg(target_os = "macos")]
    #[test]
    fn exact_system_face_has_valid_checksum_and_missing_face_never_substitutes() {
        let bytes = exact_face("Helvetica").unwrap();
        assert!(bytes.len() < LIMIT);
        assert_eq!(checksum(&bytes), 0xb1b0afba);
        assert!(exact_face("LumaNonexistentFont-6fc59e28").unwrap_err().contains("no substitute"));
        assert!(exact_face("../private/file").is_err());
    }
}
