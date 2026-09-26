//! Font family metadata only: no file paths, font bytes or network access.
#[cfg(target_os = "macos")]
pub fn families() -> Result<Vec<String>, String> {
    use std::ffi::{c_char, c_void, CStr};
    #[link(name = "CoreText", kind = "framework")]
    extern "C" { fn CTFontManagerCopyAvailableFontFamilyNames() -> *const c_void; }
    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFRelease(value: *const c_void);
        fn CFArrayGetCount(value: *const c_void) -> isize;
        fn CFArrayGetValueAtIndex(value: *const c_void, index: isize) -> *const c_void;
        fn CFStringGetLength(value: *const c_void) -> isize;
        fn CFStringGetCString(value: *const c_void, buffer: *mut c_char, size: isize, encoding: u32) -> bool;
    }
    struct OwnedArray(*const c_void);
    impl Drop for OwnedArray { fn drop(&mut self) { unsafe { CFRelease(self.0) }; } }
    // CoreText returns a retained CFArray of borrowed CFStrings, per its API contract.
    unsafe {
        let pointer = CTFontManagerCopyAvailableFontFamilyNames();
        if pointer.is_null() { return Err("macOS could not list font families".into()); }
        let array = OwnedArray(pointer);
        let count = CFArrayGetCount(array.0).clamp(0, 4096);
        let mut result = Vec::new();
        for index in 0..count {
            let name = CFArrayGetValueAtIndex(array.0, index);
            if name.is_null() { continue; }
            let length = CFStringGetLength(name);
            if !(1..=256).contains(&length) { continue; }
            let mut buffer = vec![0u8; length as usize * 4 + 1];
            if CFStringGetCString(name, buffer.as_mut_ptr().cast(), buffer.len() as isize, 0x08000100) {
                let value = CStr::from_ptr(buffer.as_ptr().cast()).to_string_lossy().trim().to_owned();
                if !value.is_empty() && !value.starts_with('.') { result.push(value); }
            }
        }
        result.sort_by_key(|name| name.to_lowercase());
        result.dedup();
        Ok(result)
    }
}

#[cfg(not(target_os = "macos"))]
pub fn families() -> Result<Vec<String>, String> { Err("Native font discovery is currently available on macOS".into()) }

#[cfg(all(test, target_os = "macos"))]
mod tests {
    #[test]
    fn installed_fonts_are_real_bounded_family_names() {
        let names = super::families().unwrap();
        assert!(names.len() > 5 && names.len() <= 4096);
        assert!(names.iter().all(|name| !name.is_empty() && !name.contains('/')));
        println!("Discovered {} native font families", names.len());
    }
}
