//! Cocoa's predefined Quit (and Dock Quit) calls NSApplication terminate:
//! directly. Tao 0.35 does not implement applicationShouldTerminate:, so the
//! runtime ExitRequested hook alone cannot protect unsaved documents.
#[cfg(target_os = "macos")]
mod macos {
    use objc2::{class, msg_send, sel};
    use objc2::runtime::{AnyClass, AnyObject, Imp, Sel};
    use std::sync::{OnceLock, atomic::Ordering};

    static APP: OnceLock<tauri::AppHandle> = OnceLock::new();

    unsafe extern "C-unwind" fn should_terminate(_: &AnyObject, _: Sel, _: &AnyObject) -> usize {
        if super::termination_allowed(super::super::ALLOW_APP_EXIT.load(Ordering::SeqCst)) {
            return 1; // NSTerminateNow; only an explicit frontend confirmation sets this.
        }
        if let Some(app) = APP.get() { super::super::request_exit_confirmation(app); }
        0 // NSTerminateCancel. The asynchronous save/discard flow exits explicitly.
    }

    pub fn install(app: &tauri::AppHandle) -> Result<(), String> {
        // Called once from Tauri setup on the AppKit main thread. Extend the
        // existing delegate, preserving every launch/open/reopen handler.
        if objc2::MainThreadMarker::new().is_none() { return Err("Quit protection requires the main thread".into()); }
        unsafe {
            let application: *mut AnyObject = msg_send![class!(NSApplication), sharedApplication];
            let delegate: *mut AnyObject = msg_send![application, delegate];
            let delegate = delegate.as_ref().ok_or("Missing application delegate for quit protection")?;
            let class = delegate.class();
            let selector = sel!(applicationShouldTerminate:);
            // Do not replace a future framework's implementation silently.
            if class.instance_method(selector).is_some() {
                return Err("Application termination delegate changed; quit protection requires review".into());
            }
            APP.set(app.clone()).map_err(|_| "Quit protection was already initialized")?;
            let implementation: Imp = std::mem::transmute::<
                unsafe extern "C-unwind" fn(&AnyObject, Sel, &AnyObject) -> usize, Imp
            >(should_terminate);
            // NSApplicationTerminateReply is NSUInteger on supported 64-bit Macs.
            let installed = objc2::ffi::class_addMethod(
                class as *const AnyClass as *mut AnyClass, selector, implementation,
                b"Q@:@\0".as_ptr().cast(),
            );
            if !installed.as_bool() { return Err("Unable to install native quit protection".into()); }
        }
        Ok(())
    }
}

fn termination_allowed(confirmed: bool) -> bool { confirmed }

pub fn install(app: &tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    return macos::install(app);
    #[cfg(not(target_os = "macos"))]
    { let _ = app; Ok(()) }
}

#[cfg(test)]
mod tests {
    #[test]
    fn native_termination_requires_explicit_confirmation() {
        assert!(!super::termination_allowed(false));
        assert!(super::termination_allowed(true));
    }
}
