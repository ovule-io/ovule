use std::ffi::{c_char, c_void};

use super::DesktopPermissions;

#[link(name = "CoreGraphics", kind = "framework")]
unsafe extern "C" {
    fn CGPreflightScreenCaptureAccess() -> bool;
    fn CGRequestScreenCaptureAccess() -> bool;
    fn CGPreflightListenEventAccess() -> bool;
    fn CGRequestListenEventAccess() -> bool;
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
    fn CFArrayGetCount(array: *const c_void) -> isize;
    fn CFArrayGetValueAtIndex(array: *const c_void, index: isize) -> *const c_void;
    fn CFURLGetFileSystemRepresentation(
        url: *const c_void,
        resolve: bool,
        buffer: *mut u8,
        size: isize,
    ) -> bool;
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

#[link(name = "CoreServices", kind = "framework")]
unsafe extern "C" {
    fn LSCopyApplicationURLsForBundleIdentifier(
        identifier: *const c_void,
        error: *mut i32,
    ) -> *const c_void;
}
fn application_copies(current: Option<&str>) -> Vec<String> {
    // SAFETY: Main bundle and its identifier are borrowed process-lifetime CF objects.
    // Launch Services returns a retained array; its URL elements are borrowed.
    unsafe {
        let bundle = CFBundleGetMainBundle();
        if bundle.is_null() {
            return Vec::new();
        }
        let identifier = CFBundleGetIdentifier(bundle);
        if identifier.is_null() {
            return Vec::new();
        }
        let array = LSCopyApplicationURLsForBundleIdentifier(identifier, std::ptr::null_mut());
        if array.is_null() {
            return Vec::new();
        }
        let mut paths = Vec::new();
        for index in 0..CFArrayGetCount(array).min(128) {
            let url = CFArrayGetValueAtIndex(array, index);
            let mut buffer = [0_u8; 4096];
            if !url.is_null()
                && CFURLGetFileSystemRepresentation(url, true, buffer.as_mut_ptr(), 4096)
            {
                let length = buffer
                    .iter()
                    .position(|byte| *byte == 0)
                    .unwrap_or(buffer.len());
                let path = String::from_utf8_lossy(&buffer[..length]).into_owned();
                if Some(path.as_str()) != current && !paths.contains(&path) {
                    paths.push(path);
                }
            }
        }
        CFRelease(array);
        paths
    }
}

pub(super) fn status() -> DesktopPermissions {
    let executable = std::env::current_exe().ok();
    let bundle_path = executable
        .as_deref()
        .and_then(|path| {
            path.ancestors()
                .find(|path| path.extension().is_some_and(|extension| extension == "app"))
        })
        .map(|path| path.to_string_lossy().into_owned());
    static SIGNATURE: std::sync::OnceLock<Option<String>> = std::sync::OnceLock::new();
    let signing_identity = SIGNATURE
        .get_or_init(|| {
            let output = std::process::Command::new("/usr/bin/codesign")
                .args(["-d", "-r-", "--verbose=4"])
                .arg(bundle_path.as_deref()?)
                .output()
                .ok()?;
            let text = format!(
                "{}{}",
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr)
            );
            Some(
                text.lines()
                    .map(|line| line.trim_start_matches("# "))
                    .filter(|line| {
                        line.starts_with("TeamIdentifier=")
                            || line.starts_with("CDHash=")
                            || line.starts_with("Signature=")
                            || line.starts_with("designated =>")
                    })
                    .collect::<Vec<_>>()
                    .join("\n"),
            )
        })
        .clone();
    DesktopPermissions {
        app_version: env!("CARGO_PKG_VERSION").into(),
        other_bundle_paths: application_copies(bundle_path.as_deref()),
        bundle_path,
        executable_path: executable.map(|path| path.to_string_lossy().into_owned()),
        signing_identity,
        screen_capture_verified: super::recent_screen_capture_succeeded(),
        // SAFETY: Read-only preflight, without prompting for Input Monitoring.
        input_monitoring: unsafe { CGPreflightListenEventAccess() },
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
    // Explicit repair only. TCC grants for an earlier ad-hoc code requirement
    // cannot be repaired by another preflight or by opening System Settings.
    if let Some((service, request_name)) = super::reset_request(permission) {
        let output = std::process::Command::new("/usr/bin/tccutil")
            .args(["reset", service, &current.expected_bundle_id])
            .output()
            .map_err(|error| format!("Reset Ovule permission: {error}"))?;
        if !output.status.success() {
            return Err(format!(
                "Could not reset Ovule permission: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            ));
        }
        return request(request_name);
    }
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
        "inputMonitoring" => {
            // SAFETY: Only called after an explicit Request access click. This
            // registers this process with TCC; opening Settings alone does not.
            if !current.input_monitoring && unsafe { CGRequestListenEventAccess() } {
                return Ok(status());
            }
            "Privacy_ListenEvent"
        }
        "automation" => "Privacy_Automation",
        "filesAndFolders" => "Privacy_FilesAndFolders",
        "fullDiskAccess" => "Privacy_AllFiles",
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
