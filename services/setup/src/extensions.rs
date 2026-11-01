use std::path::PathBuf;

use crate::state::AppSnapshot;

use super::{NativeSetupService, OnboardingStatus, SetupError};

impl NativeSetupService {
    pub fn install_extension(&self, source: &str) -> Result<AppSnapshot, SetupError> {
        let source = PathBuf::from(source);
        if !source.is_absolute() {
            return Err(SetupError::InvalidArgument(
                "Extension package path must be absolute".to_owned(),
            ));
        }
        ovule_extensions::providers::install_extension_package(&source)
            .map_err(|error| SetupError::Persistence(error.to_string()))?;
        let snapshot = super::support::transact(
            &self.state,
            "extension/installed",
            None,
            &serde_json::json!({"installed": true}),
            |workspace| {
                workspace.reconcile_extensions()?;
                Ok(workspace.snapshot())
            },
        )?;
        self.emit_revision();
        Ok(snapshot)
    }

    pub fn clean_onboarding_state(&self) -> Result<OnboardingStatus, SetupError> {
        super::support::transact(
            &self.state,
            "onboarding/cleaned",
            None,
            &serde_json::json!({}),
            crate::state::Workspace::clean_onboarding_state,
        )?;
        self.emit_revision();
        self.onboarding_status()
    }

    pub fn set_extension_enabled(
        &self,
        extension_id: &str,
        enabled: bool,
    ) -> Result<AppSnapshot, SetupError> {
        ovule_extensions::providers::set_third_party_extension_enabled(extension_id, enabled)
            .map_err(|error| SetupError::Persistence(error.to_string()))?;
        self.reconcile_after_extension_change("extension/enabled")
    }

    pub fn remove_extension(&self, extension_id: &str) -> Result<AppSnapshot, SetupError> {
        ovule_extensions::providers::remove_third_party_extension(extension_id)
            .map_err(|error| SetupError::Persistence(error.to_string()))?;
        self.reconcile_after_extension_change("extension/removed")
    }

    fn reconcile_after_extension_change(&self, kind: &str) -> Result<AppSnapshot, SetupError> {
        let snapshot = super::support::transact(
            &self.state,
            kind,
            None,
            &serde_json::json!({}),
            |workspace| {
                workspace.reconcile_extensions()?;
                workspace.clean_onboarding_state()
            },
        )?;
        self.emit_revision();
        Ok(snapshot)
    }

    fn emit_revision(&self) {
        super::support::emit_revision(
            self.events.as_ref(),
            self.state.read(crate::state::Workspace::revision),
        );
    }
}
