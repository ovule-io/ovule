//! OS grants belong to the running application, never to its persisted profile.
#[cfg(target_os = "macos")]
mod macos;

#[derive(Clone, Debug, Default)]
pub struct DesktopPermissions {
    pub app_version: String,
    pub bundle_path: Option<String>,
    pub executable_path: Option<String>,
    pub signing_identity: Option<String>,
    pub other_bundle_paths: Vec<String>,
    pub screen_capture_verified: bool,
    pub input_monitoring: bool,
    pub managed: bool,
    pub screen_recording: bool,
    pub accessibility: bool,
    pub bundle_id: Option<String>,
    pub expected_bundle_id: String,
}

#[must_use]
pub fn status() -> DesktopPermissions {
    #[cfg(target_os = "macos")]
    return macos::status();
    #[cfg(not(target_os = "macos"))]
    DesktopPermissions {
        app_version: env!("CARGO_PKG_VERSION").into(),
        managed: false,
        screen_recording: false,
        accessibility: false,
        bundle_id: None,
        expected_bundle_id: crate::identity::APPLICATION_ID.into(),
        ..DesktopPermissions::default()
    }
}

pub fn request(permission: &str) -> Result<DesktopPermissions, String> {
    if !matches!(
        permission,
        "screenRecording"
            | "resetScreenRecording"
            | "resetAccessibility"
            | "accessibility"
            | "inputMonitoring"
            | "automation"
            | "filesAndFolders"
            | "fullDiskAccess"
    ) {
        return Err("Unknown desktop permission".into());
    }
    #[cfg(target_os = "macos")]
    return macos::request(permission);
    #[cfg(not(target_os = "macos"))]
    Err("Permission management is not available on this platform".into())
}

#[cfg(any(target_os = "macos", test))]
fn reset_request(permission: &str) -> Option<(&'static str, &'static str)> {
    match permission {
        "resetScreenRecording" => Some(("ScreenCapture", "screenRecording")),
        "resetAccessibility" => Some(("Accessibility", "accessibility")),
        _ => None,
    }
}

impl DesktopPermissions {
    #[cfg(any(target_os = "macos", test))]
    fn require_current_bundle(&self) -> Result<(), String> {
        if self.bundle_id.as_deref() != Some(self.expected_bundle_id.as_str()) {
            return Err(format!(
                "Launch the {} application bundle to manage its permissions (current: {})",
                self.expected_bundle_id,
                self.bundle_id.as_deref().unwrap_or("unbundled process"),
            ));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn grant_requests_require_the_running_build_identity() {
        for expected in ["io.ovule.desktop", "io.ovule.desktop.debug"] {
            for actual in [
                None,
                Some("io.ovule.desktop"),
                Some("io.ovule.desktop.debug"),
            ] {
                let status = DesktopPermissions {
                    managed: true,
                    screen_recording: true,
                    accessibility: true,
                    bundle_id: actual.map(str::to_owned),
                    expected_bundle_id: expected.into(),
                    ..DesktopPermissions::default()
                };
                assert_eq!(
                    status.require_current_bundle().is_ok(),
                    actual == Some(expected)
                );
            }
        }
    }

    #[test]
    fn repair_scope_is_limited_to_the_two_explicit_app_permissions() {
        assert_eq!(
            reset_request("resetScreenRecording"),
            Some(("ScreenCapture", "screenRecording"))
        );
        assert_eq!(
            reset_request("resetAccessibility"),
            Some(("Accessibility", "accessibility"))
        );
        for permission in [
            "All",
            "resetAll",
            "resetFullDiskAccess",
            "resetScreenRecording; echo no",
        ] {
            assert_eq!(reset_request(permission), None);
            assert!(request(permission).is_err());
        }
    }

    #[test]
    fn unknown_permissions_never_prompt_or_open_settings() {
        assert!(request("Privacy_All").is_err());
        assert!(request("screenRecording; open https://example.com").is_err());
    }
}

static LAST_CAPTURE: std::sync::Mutex<Option<std::time::Instant>> = std::sync::Mutex::new(None);

/// Evidence of a real local capture, never a persisted grant or a remote host result.
pub fn record_screen_capture_success() {
    *LAST_CAPTURE
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(std::time::Instant::now());
}
#[must_use]
pub fn recent_screen_capture_succeeded() -> bool {
    LAST_CAPTURE
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .is_some_and(|time| time.elapsed() < std::time::Duration::from_secs(60))
}
