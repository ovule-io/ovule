use std::ffi::{c_char, c_void};

use super::DesktopPermissions;

#[link(name = "CoreGraphics", kind = "framework")]
unsafe extern "C" {
    fn CGPreflightScreenCaptureAccess() -> bool;
    fn CGRequestScreenCaptureAccess() -> bool;
}
#[link(name = "ApplicationServices", kind = "framework")]
unsafe extern "C" {
    fn AXIsProcessTrusted() -> bool;
    fn AXIsProcessTrustedWithOptions(options: *const c_void) -> bool;
    static kAXTrustedCheckOptionPrompt: *const c_void;
}
#[link(name = "CoreFoundation", kind = "framework")]
unsafe extern "C" {
    static kCFBooleanTrue: *const c_void;
    fn CFDictionaryCreate(
        allocator: *const c_void,
        keys: *const *const c_void,
        values: *const *const c_void,
        count: isize,
        key_callbacks: *const c_void,
        value_callbacks: *const c_void,
    ) -> *const c_void;
    fn CFRelease(value: *const c_void);
    fn CFBundleGetMainBundle() -> *const c_void;
    fn CFBundleGetIdentifier(bundle: *const c_void) -> *const c_void;
    fn CFStringGetCString(
        string: *const c_void,
        buffer: *mut c_char,
        size: isize,
        encoding: u32,
    ) -> bool;
}

fn bundle_id() -> Option<String> {
    // SAFETY: Get functions return borrowed references. The main bundle remains
    // alive for the process; the fixed output buffer is writable for its length.
    unsafe {
        let bundle = CFBundleGetMainBundle();
        if bundle.is_null() {
            return None;
        }
        let identifier = CFBundleGetIdentifier(bundle);
        if identifier.is_null() {
            return None;
        }
        let mut buffer = [0_u8; 1024];
        if !CFStringGetCString(identifier, buffer.as_mut_ptr().cast(), 1024, 0x0800_0100) {
            return None;
        }
        let end = buffer.iter().position(|byte| *byte == 0)?;
        String::from_utf8(buffer[..end].to_vec()).ok()
    }
}

pub(super) fn status() -> DesktopPermissions {
    DesktopPermissions {
        managed: true,
        // SAFETY: These read-only system queries take no pointers and do not
        // prompt. TCC evaluates the current process, including its code identity.
        screen_recording: unsafe { CGPreflightScreenCaptureAccess() },
        accessibility: unsafe { AXIsProcessTrusted() },
        bundle_id: bundle_id(),
        expected_bundle_id: crate::identity::APPLICATION_ID.into(),
    }
}

pub(super) fn request(permission: &str) -> Result<DesktopPermissions, String> {
    let current = status();
    current.require_current_bundle()?;
    let pane = match permission {
        "screenRecording" => {
            // SAFETY: This explicit user action requests capture permission for
            // this running process. macOS owns the prompt and the decision.
            if !current.screen_recording && unsafe { CGRequestScreenCaptureAccess() } {
                return Ok(status());
            }
            "Privacy_ScreenCapture"
        }
        "accessibility" => {
            if !current.accessibility {
                // SAFETY: The key and boolean are process-lifetime CF constants.
                // The one-entry dictionary borrows them with null callbacks;
                // AX reads it synchronously and we release the retained result.
                unsafe {
                    let keys = [kAXTrustedCheckOptionPrompt];
                    let values = [kCFBooleanTrue];
                    let options = CFDictionaryCreate(
                        std::ptr::null(),
                        keys.as_ptr(),
                        values.as_ptr(),
                        1,
                        std::ptr::null(),
                        std::ptr::null(),
                    );
                    if options.is_null() {
                        return Err("Could not create Accessibility permission request".into());
                    }
                    AXIsProcessTrustedWithOptions(options);
                    CFRelease(options);
                }
            }
            "Privacy_Accessibility"
        }
        _ => return Err("Unknown desktop permission".into()),
    };
    // Only fixed System Settings destinations are accepted, without a shell.
    let result = std::process::Command::new("/usr/bin/open")
        .arg(format!(
            "x-apple.systempreferences:com.apple.preference.security?{pane}"
        ))
        .status()
        .map_err(|error| format!("Open macOS permission settings: {error}"))?;
    if !result.success() {
        return Err("Could not open macOS permission settings".into());
    }
    Ok(status())
}
