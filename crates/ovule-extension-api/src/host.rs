//! Host-owned declarations. These are compiled into Ovule, never installed as an extension.
//! Shared contribution DTOs keep setup and message rendering on the same contracts.
use crate::ExtensionContributions;

/// Routing principal for host contributions in legacy `extension_id` wire fields.
pub const OWNER: &str = "io.ovule.host";

/// Returns a copy of the compiled host contribution catalog.
///
/// # Panics
/// Panics if the embedded declarations violate their schema; validated by the contract test.
#[must_use]
pub fn contributions() -> ExtensionContributions {
    serde_json::from_str(include_str!("host.json")).expect("valid compiled host declarations")
}

#[cfg(test)]
mod tests {
    #[test]
    fn compiled_declarations_satisfy_the_shared_contract() {
        let manifest = crate::ExtensionManifest {
            schema_version: 1,
            id: super::OWNER.to_owned(),
            private: true,
            version: "0.1.0".to_owned(),
            module_type: "module".to_owned(),
            api_version: 1,
            runtime: None,
            ui: None,
            contributes: super::contributions(),
            permissions: serde_json::from_value(serde_json::json!({"process": ["ollama"]}))
                .unwrap(),
        };
        manifest.validate().unwrap();
        assert_eq!(
            manifest.contributes.agents,
            Vec::<crate::AgentContribution>::new()
        );
        assert_eq!(
            manifest.contributes.file_editors,
            Vec::<crate::FileEditorContribution>::new()
        );
        assert!(
            manifest
                .contributes
                .message_blocks
                .iter()
                .all(|block| block.module.is_none())
        );
    }
}
