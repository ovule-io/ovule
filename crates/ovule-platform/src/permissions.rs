//! OS grants belong to the running application, never to its persisted profile.
#[cfg(target_os = "macos")]
mod macos;

#[derive(Clone, Debug)]
pub struct DesktopPermissions {
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
        managed: false,
        screen_recording: false,
        accessibility: false,
        bundle_id: None,
        expected_bundle_id: crate::identity::APPLICATION_ID.into(),
    }
}

pub fn request(permission: &str) -> Result<DesktopPermissions, String> {
    if !matches!(permission, "screenRecording" | "accessibility") {
        return Err("Unknown desktop permission".into());
    }
    #[cfg(target_os = "macos")]
    return macos::request(permission);
    #[cfg(not(target_os = "macos"))]
    Err("Permission management is not available on this platform".into())
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
                };
                assert_eq!(
                    status.require_current_bundle().is_ok(),
                    actual == Some(expected)
                );
            }
        }
    }

    #[test]
    fn unknown_permissions_never_prompt_or_open_settings() {
        assert!(request("Privacy_All").is_err());
        assert!(request("screenRecording; open https://example.com").is_err());
    }
}
