use async_trait::async_trait;
use ovule_agent_api::{
    CancellationToken, CapabilityDefinition, CapabilityLease, CapabilityProvider,
    ProviderDescriptor, ProviderError, ToolEffect,
};
use serde_json::Value;
use std::sync::Arc;
pub mod computer;
#[derive(Clone)]
pub struct WorkspaceCapability {
    pub id: String,
    pub transport: Arc<dyn crate::WorkspaceTransport>,
}
#[must_use]
pub fn provider(roots: Vec<WorkspaceCapability>) -> Arc<dyn CapabilityProvider> {
    provider_with_policy(roots, crate::execution::ExecutionPolicy::default())
}
#[must_use]
pub fn provider_with_policy(
    roots: Vec<WorkspaceCapability>,
    policy: crate::execution::ExecutionPolicy,
) -> Arc<dyn CapabilityProvider> {
    Arc::new(WorkspaceLease(roots, policy))
}
#[derive(Clone)]
struct WorkspaceLease(Vec<WorkspaceCapability>, crate::execution::ExecutionPolicy);
#[async_trait]
impl CapabilityLease for WorkspaceLease {
    fn definitions(&self) -> Vec<CapabilityDefinition> {
        if self.0.is_empty() {
            Vec::new()
        } else {
            let ids = self
                .0
                .iter()
                .map(|root| root.id.clone())
                .collect::<Vec<_>>();
            workspace_definitions()
                .into_iter()
                .map(|mut definition| {
                    definition.input_schema["properties"]["bindingId"]["enum"] =
                        serde_json::json!(ids);
                    definition
                })
                .collect()
        }
    }
    async fn invoke(
        &mut self,
        name: &str,
        args: &Value,
        cancel: CancellationToken,
    ) -> Result<Value, ProviderError> {
        invoke_workspace_tool(&self.0, &self.1, name, args, cancel).await
    }
    async fn close(&mut self) -> Result<(), String> {
        Ok(())
    }
}
#[async_trait]
impl CapabilityProvider for WorkspaceLease {
    fn descriptor(&self) -> ProviderDescriptor {
        ProviderDescriptor {
            id: "workspace".into(),
            description: "Files and commands in selected or thread-default Workspace roots; use only bindingId values enumerated in the loaded schema".into(),
        }
    }
    fn effect(&self, name: &str, args: &Value) -> ToolEffect {
        if name == "ovule_workspace_exec" && args.get("permissions").is_some() {
            return ToolEffect::ExternalOnce;
        }
        ToolEffect::Workspace
    }
    fn preflight(&self, name: &str, args: &Value) -> Result<(), String> {
        if name != "ovule_workspace_exec" {
            return Ok(());
        }
        let binding = args
            .get("bindingId")
            .and_then(Value::as_str)
            .and_then(|id| self.0.iter().find(|root| root.id == id))
            .ok_or("Unknown Workspace binding")?;
        let sandbox = binding.transport.execution_sandbox();
        if !sandbox.available {
            return Err(sandbox
                .reason
                .unwrap_or_else(|| "Agent command sandbox is unavailable".into()));
        }
        if let Some(value) = args.get("permissions") {
            if !self.1.allow_requests {
                return Err("Permission requests are disabled by host policy".into());
            }
            if !sandbox.scoped_permissions
                || binding.transport.kind() != crate::TransportKind::Local
            {
                return Err("Remote transport does not support scoped permission requests".into());
            }
            let permissions: crate::execution::ExecutionPermissions =
                serde_json::from_value(value.clone())
                    .map_err(|error| format!("Invalid permission request: {error}"))?;
            permissions.validate().map_err(|error| error.to_string())?;
            if !args
                .get("reason")
                .and_then(Value::as_str)
                .is_some_and(|reason| !reason.trim().is_empty() && reason.chars().count() <= 1024)
            {
                return Err("Permission requests require a reason of 1 to 1024 characters".into());
            }
        }
        Ok(())
    }
    fn definitions(&self) -> Vec<CapabilityDefinition> {
        CapabilityLease::definitions(self)
    }
    async fn acquire(
        &self,
        _cancel: CancellationToken,
    ) -> Result<Box<dyn CapabilityLease>, String> {
        Ok(Box::new(self.clone()))
    }
}
#[must_use]
pub fn workspace_definitions() -> Vec<CapabilityDefinition> {
    [
        (
            "ovule_workspace_policy",
            "Inspect this binding's effective execution boundaries before diagnosing the host. Local execution is on the real host with a private temporary HOME, not a separate machine. Query extra read/write paths, network and process inspection permissions, and whether per-call requests are supported.",
            serde_json::json!({"type":"object","additionalProperties":false,"required":["bindingId"],"properties":{"bindingId":{"type":"string"}}}),
        ),
        (
            "ovule_workspace_list",
            "List entries in a selected local or remote Workspace directory.",
            serde_json::json!({
                "type": "object", "additionalProperties": false,
                "required": ["bindingId"],
                "properties": {
                    "bindingId": {"type": "string"},
                    "path": {"type": "string", "default": "."}
                }
            }),
        ),
        (
            "ovule_workspace_read",
            "Read a UTF-8 text file from a selected local or remote Workspace.",
            serde_json::json!({
                "type": "object", "additionalProperties": false,
                "required": ["bindingId", "path"],
                "properties": {
                    "bindingId": {"type": "string"},
                    "path": {"type": "string"}
                }
            }),
        ),
        (
            "ovule_workspace_write",
            "Write a UTF-8 text file inside a selected local or remote Workspace.",
            serde_json::json!({
                "type": "object", "additionalProperties": false,
                "required": ["bindingId", "path", "content"],
                "properties": {
                    "bindingId": {"type": "string"},
                    "path": {"type": "string"},
                    "content": {"type": "string", "maxLength": 2_097_152}
                }
            }),
        ),
        (
            "ovule_workspace_exec",
            "Run argv within this binding's execution policy. Inspect ovule_workspace_policy first. Extra permissions require an explicit reason and approval for this exact call. Request minimal permissions: app metadata reads need narrow readPaths, while processInfo is only for actual process inspection; denial never triggers an automatic retry. A temporary HOME is isolation on the same host. Nonzero exit status is a command failure; permission-denied output is not evidence a path is absent.",
            serde_json::json!({
                "type": "object", "additionalProperties": false,
                "required": ["bindingId", "argv"],
                "properties": {
                    "bindingId": {"type": "string"},
                    "argv": {"type": "array", "minItems": 1, "maxItems": 64, "items": {"type": "string"}},
                    "reason":{"type":"string","minLength":1,"maxLength":1024},
                    "permissions":{"type":"object","additionalProperties":false,"properties":{
                        "readPaths":{"type":"array","maxItems":32,"items":{"type":"string"}},
                        "writePaths":{"type":"array","maxItems":32,"items":{"type":"string"}},
                        "network":{"type":"boolean"},"processInfo":{"type":"boolean"}
                    }}
                }
            }),
        ),
    ]
    .into_iter()
    .map(|(name, description, input_schema)| CapabilityDefinition {
        name: name.to_owned(),
        description: description.to_owned(),
        input_schema,
    })
    .collect()
}

async fn invoke_workspace_tool(
    roots: &[WorkspaceCapability],
    policy: &crate::execution::ExecutionPolicy,
    name: &str,
    arguments: &Value,
    cancellation: CancellationToken,
) -> Result<Value, ProviderError> {
    let binding_id = arguments
        .get("bindingId")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let Some(workspace) = roots.iter().find(|workspace| workspace.id == binding_id) else {
        return Err(ProviderError::Tool(format!(
            "Unknown or unselected Workspace binding; use one of these exact bindingId values: {}",
            roots
                .iter()
                .map(|root| root.id.as_str())
                .collect::<Vec<_>>()
                .join(", ")
        )));
    };
    if name == "ovule_workspace_policy" {
        return Ok(policy_info(workspace, policy));
    }
    let result = match name {
        "ovule_workspace_list" => {
            let path = arguments.get("path").and_then(Value::as_str).unwrap_or(".");
            workspace
                .transport
                .list_directory(path)
                .await
                .and_then(|entries| {
                    serde_json::to_string(&entries)
                        .map_err(|error| crate::TransportError::Protocol(error.to_string()))
                })
        }
        "ovule_workspace_read" => {
            let Some(path) = arguments.get("path").and_then(Value::as_str) else {
                return Err(ProviderError::Tool("Workspace path is required".into()));
            };
            workspace.transport.read_file(path).await.and_then(|bytes| {
                if bytes.len() > 2 * 1024 * 1024 {
                    return Err(crate::TransportError::Protocol(
                        "Workspace text file exceeds the 2 MiB limit".to_owned(),
                    ));
                }
                String::from_utf8(bytes).map_err(|_| {
                    crate::TransportError::Protocol("Workspace text file is not UTF-8".to_owned())
                })
            })
        }
        "ovule_workspace_write" => {
            let (Some(path), Some(content)) = (
                arguments.get("path").and_then(Value::as_str),
                arguments.get("content").and_then(Value::as_str),
            ) else {
                return Err(ProviderError::Tool(
                    "Workspace path and content are required".into(),
                ));
            };
            workspace
                .transport
                .write_file(path, content.as_bytes())
                .await
                .map(|()| serde_json::json!({"written": content.len()}).to_string())
        }
        "ovule_workspace_exec" => {
            let Some(argv) = arguments.get("argv").and_then(Value::as_array) else {
                return Err(ProviderError::Tool("Workspace argv is required".into()));
            };
            let argv = argv
                .iter()
                .map(|value| value.as_str().map(str::to_owned))
                .collect::<Option<Vec<_>>>();
            let Some(argv) = argv.filter(|argv| !argv.is_empty() && argv.len() <= 64) else {
                return Err(ProviderError::Tool(
                    "Workspace argv must contain 1 to 64 strings".into(),
                ));
            };
            execute_command(workspace, policy, &argv, arguments, cancellation).await
        }
        _ => return Err(ProviderError::Tool("Unsupported Workspace tool".into())),
    };
    result
        .map(|text| {
            if name == "ovule_workspace_read" {
                Value::String(text)
            } else {
                serde_json::from_str(&text).unwrap_or(Value::String(text))
            }
        })
        .map_err(|error| {
            let kind = match &error {
                crate::TransportError::Unauthorized(_) => "permission_denied",
                crate::TransportError::Unavailable(_) => "execution_unavailable",
                _ => "backend",
            };
            ProviderError::Tool(
                serde_json::json!({"isError":true,"failureKind":kind,"error":error.to_string()})
                    .to_string(),
            )
        })
}

fn policy_info(
    workspace: &WorkspaceCapability,
    policy: &crate::execution::ExecutionPolicy,
) -> Value {
    let local = workspace.transport.kind() == crate::TransportKind::Local;
    let sandbox = workspace.transport.execution_sandbox();
    serde_json::json!({
        "bindingId":workspace.id,"executionLocation":if local{"local_host"}else{"remote_host"},
        "sandbox":sandbox.backend,
        "sandboxCapabilities":sandbox,
        "driverProcessesSandboxedByThisTool":false,
        "hostIsVirtualizedByThisTool":false,
        "baseline":if local{serde_json::to_value(&policy.baseline).unwrap_or_default()}else{Value::Null},
        "supportsPermissionRequests":local && sandbox.available && sandbox.scoped_permissions && policy.allow_requests,
        "defaultRead":if local{Some("Workspace, private temporary directory and system runtime paths; other paths require an approved request")}else{None},
        "defaultWrite":if local{Some("Workspace and private temporary directory")}else{None},
        "network":if local{Some(policy.baseline.network)}else{None},
        "processInfo":if local{Some(if policy.baseline.process_info{"all accessible processes"}else{"self only"})}else{None},
        "home":if local{Some("private temporary directory; this does not change the execution host")}else{None},
        "approvalScope":"one exact call; no automatic replay or permission reuse",
        "limitations":"Remote policy is owned by the transport. OS permissions and macOS privacy controls still apply. macOS may reject set-id executables such as /bin/ps even when processInfo is approved; this does not indicate a different execution host. Access denial is not evidence of an empty or missing directory. Shell pipelines may mask individual command failure."
    })
}

async fn execute_command(
    workspace: &WorkspaceCapability,
    policy: &crate::execution::ExecutionPolicy,
    argv: &[String],
    arguments: &Value,
    cancellation: CancellationToken,
) -> Result<String, crate::TransportError> {
    let sandbox = workspace.transport.execution_sandbox();
    if !sandbox.available {
        return Err(crate::TransportError::Unavailable(
            sandbox.reason.unwrap_or_default(),
        ));
    }
    let request = arguments
        .get("permissions")
        .map(|value| {
            serde_json::from_value::<crate::execution::ExecutionPermissions>(value.clone())
        })
        .transpose()
        .map_err(|error| {
            crate::TransportError::Unauthorized(format!("Invalid permission request: {error}"))
        })?;
    if request.is_some() {
        if !policy.allow_requests {
            return Err(crate::TransportError::Unauthorized(
                "Permission requests are disabled by host policy".into(),
            ));
        }
        if !arguments
            .get("reason")
            .and_then(Value::as_str)
            .is_some_and(|reason| !reason.trim().is_empty() && reason.chars().count() <= 1024)
        {
            return Err(crate::TransportError::Unauthorized(
                "Permission requests require a reason of 1 to 1024 characters".into(),
            ));
        }
    }
    let baseline = if workspace.transport.kind() == crate::TransportKind::Local {
        policy.baseline.clone()
    } else {
        if request.is_some() {
            return Err(crate::TransportError::Unavailable(
                "remote transport does not support scoped permission requests".into(),
            ));
        }
        crate::execution::ExecutionPermissions::default()
    };
    let permissions = baseline.union(&request.unwrap_or_default());
    workspace
        .transport
        .exec_with_permissions(argv, &permissions, cancellation)
        .await
        .and_then(|outcome| {
            serde_json::to_string(&crate::execution::tool_outcome(&outcome))
                .map_err(|error| crate::TransportError::Protocol(error.to_string()))
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(not(target_os = "macos"))]
    #[tokio::test]
    async fn unavailable_sandbox_is_reported_and_rejected_before_permission_review() {
        let root = tempfile::tempdir().unwrap();
        let transport = Arc::new(crate::LocalTransport::new(root.path().into()).unwrap());
        let provider = provider(vec![WorkspaceCapability {
            id: "local".into(),
            transport,
        }]);
        let args = serde_json::json!({"bindingId":"local", "argv":["echo","must not execute"],
            "permissions":{"network":true},"reason":"test unavailable isolation"});
        assert!(
            provider
                .preflight("ovule_workspace_exec", &args)
                .unwrap_err()
                .contains("sandbox")
        );
        let mut lease = provider.acquire(CancellationToken::new()).await.unwrap();
        let info = lease
            .invoke(
                "ovule_workspace_policy",
                &serde_json::json!({"bindingId":"local"}),
                CancellationToken::new(),
            )
            .await
            .unwrap();
        assert_eq!(info["sandboxCapabilities"]["available"], false);
        assert_eq!(info["supportsPermissionRequests"], false);
        assert!(
            lease
                .invoke("ovule_workspace_exec", &args, CancellationToken::new())
                .await
                .is_err()
        );
    }
    #[test]
    fn schemas_advertise_the_exact_thread_default_binding() {
        let root = std::env::temp_dir();
        let transport = Arc::new(crate::LocalTransport::new(root).unwrap());
        let provider = provider(vec![WorkspaceCapability {
            id: "thread-default".into(),
            transport,
        }]);
        for definition in provider.definitions() {
            assert_eq!(
                definition.input_schema["properties"]["bindingId"]["enum"],
                serde_json::json!(["thread-default"])
            );
        }
    }
    #[tokio::test]
    async fn empty_workspace_provider_exposes_no_tools() {
        let provider = provider(Vec::new());
        assert!(provider.definitions().is_empty());
        let lease = provider.acquire(CancellationToken::new()).await.unwrap();
        assert!(lease.definitions().is_empty());
    }
}
