//! Host-owned execution policy. Requests describe permissions; only host approval grants them.
use crate::{ExecOutcome, TransportError};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::path::PathBuf;

/// Reported by the execution host, never inferred from a remote transport name.
/// External ACP/MCP driver processes and user terminals are separate trust boundaries.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SandboxCapabilities {
    pub backend: String,
    pub available: bool,
    pub scoped_permissions: bool,
    pub reason: Option<String>,
}
impl SandboxCapabilities {
    #[must_use]
    pub fn unavailable(reason: impl Into<String>) -> Self {
        Self {
            backend: "unavailable".into(),
            available: false,
            scoped_permissions: false,
            reason: Some(reason.into()),
        }
    }
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
pub struct ExecutionPermissions {
    pub read_paths: Vec<PathBuf>,
    pub write_paths: Vec<PathBuf>,
    pub network: bool,
    pub process_info: bool,
}
impl ExecutionPermissions {
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.read_paths.is_empty()
            && self.write_paths.is_empty()
            && !self.network
            && !self.process_info
    }
    /// Keep approval paths identical to enforced paths. Never silently resolve a granted alias.
    pub fn validate(&self) -> Result<(), TransportError> {
        if self.read_paths.len() + self.write_paths.len() > 32 {
            return Err(TransportError::Unauthorized(
                "at most 32 permission paths are allowed".into(),
            ));
        }
        for path in self.read_paths.iter().chain(&self.write_paths) {
            if !path.is_absolute() || path.parent().is_none() || path.to_str().is_none() {
                return Err(TransportError::Unauthorized(
                    "permission paths must be absolute Unicode paths below filesystem root".into(),
                ));
            }
            let canonical = std::fs::canonicalize(path)
                .map_err(|error| TransportError::InvalidPath(error.to_string()))?;
            if canonical != *path {
                return Err(TransportError::InvalidPath(format!(
                    "use the exact canonical permission path: {}",
                    canonical.display()
                )));
            }
        }
        Ok(())
    }
    #[must_use]
    pub fn union(&self, request: &Self) -> Self {
        let mut result = self.clone();
        for path in &request.read_paths {
            if !result.read_paths.contains(path) {
                result.read_paths.push(path.clone());
            }
        }
        for path in &request.write_paths {
            if !result.write_paths.contains(path) {
                result.write_paths.push(path.clone());
            }
        }
        result.network |= request.network;
        result.process_info |= request.process_info;
        result
    }
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
pub struct ExecutionPolicy {
    pub baseline: ExecutionPermissions,
    pub allow_requests: bool,
}
impl Default for ExecutionPolicy {
    fn default() -> Self {
        Self {
            baseline: ExecutionPermissions::default(),
            allow_requests: true,
        }
    }
}
impl ExecutionPolicy {
    /// Load only from a trusted application configuration path, never from a Workspace.
    pub fn load(path: &std::path::Path) -> Result<Self, String> {
        let bytes = match std::fs::read(path) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(Self::default());
            }
            Err(error) => return Err(format!("read execution policy: {error}")),
        };
        if bytes.len() > 65_536 {
            return Err("execution policy exceeds 64 KiB".into());
        }
        let policy: Self = serde_json::from_slice(&bytes)
            .map_err(|error| format!("invalid execution policy: {error}"))?;
        policy
            .baseline
            .validate()
            .map_err(|error| error.to_string())?;
        Ok(policy)
    }
}
/// Preserve the transport wire contract; project bytes to text only at the tool boundary.
#[must_use]
pub fn tool_outcome(outcome: &ExecOutcome) -> Value {
    let stdout = String::from_utf8_lossy(&outcome.stdout);
    let stderr = String::from_utf8_lossy(&outcome.stderr);
    let denied = [&stdout, &stderr]
        .iter()
        .any(|text| text.contains("Operation not permitted") || text.contains("Permission denied"));
    let failure = if outcome.exit_code == 0 {
        None
    } else if denied {
        Some("permission_denied")
    } else if outcome.exit_code == -1 {
        Some("process_terminated")
    } else {
        Some("process_failed")
    };
    json!({"exit_code":outcome.exit_code,"stdout":stdout,"stderr":stderr,
        "isError":failure.is_some(),"failureKind":failure,
        "status":if failure.is_some(){"failed"}else if denied{"completed_with_warnings"}else{"completed"},
        "warnings":if denied{vec!["access_denial_observed: may come from the execution sandbox, filesystem permissions or macOS privacy controls; an empty result is not evidence of absence"]}else{vec![]},
        "outputEncoding":"utf-8-lossy",
        "permissionRequestHint":if denied{Some("Inspect ovule_workspace_policy. Request only needed permissions with a reason; approval applies to this call only. Do not automatically retry side effects.")}else{None}})
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn outcomes_preserve_text_and_separate_exit_failure_from_access_evidence() {
        let mut outcome = ExecOutcome {
            exit_code: 1,
            stdout: vec![],
            stderr: b"Permission denied".to_vec(),
        };
        assert_eq!(tool_outcome(&outcome)["failureKind"], "permission_denied");
        outcome.exit_code = 0;
        assert_eq!(tool_outcome(&outcome)["status"], "completed_with_warnings");
        assert_eq!(tool_outcome(&outcome)["isError"], false);
        outcome.exit_code = -1;
        outcome.stderr = b"rosetta error: Failed to open libRosettaRuntime".to_vec();
        assert_eq!(tool_outcome(&outcome)["failureKind"], "process_terminated");
        assert!(
            tool_outcome(&outcome)["stderr"]
                .as_str()
                .unwrap()
                .ends_with("Runtime")
        );
    }
    #[test]
    fn configuration_is_explicit_and_invalid_configuration_never_broadens_defaults() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("execution-policy.json");
        assert!(ExecutionPolicy::load(&path).unwrap().baseline.is_empty());
        std::fs::write(
            &path,
            r#"{"baseline":{"network":true},"allowRequests":false}"#,
        )
        .unwrap();
        let policy = ExecutionPolicy::load(&path).unwrap();
        assert!(policy.baseline.network);
        assert!(!policy.allow_requests);
        std::fs::write(&path, r#"{"allowAll":true}"#).unwrap();
        assert!(ExecutionPolicy::load(&path).is_err());
    }
    #[test]
    fn permission_paths_cannot_hide_aliases_or_grant_root() {
        for path in ["/", "relative", "/.."] {
            let permissions = ExecutionPermissions {
                read_paths: vec![path.into()],
                ..Default::default()
            };
            assert!(permissions.validate().is_err());
        }
        assert!(serde_json::from_value::<ExecutionPermissions>(json!({"readAll":true})).is_err());
    }
}

mod review;
pub use review::review_read_only;
