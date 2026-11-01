//! Canonical runtime capability registry.
//!
//! A capability describes one implementation and the projections through which
//! it is actually reachable. High-volume surfaces (PTY, browser pixels and CRD
//! video) stay on their native transports; this registry only owns discovery,
//! health and authorization metadata.

use crate::state::settings::{AgentView, ToolView};

mod builtins;

/// Capability responsibility, independent of distribution and transport.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CapabilityKind {
    AgentTool,
    AppSurface,
    AppAction,
    ExecutionDependency,
    Orchestration,
    Persistence,
    InstructionContext,
    ControlTransfer,
}
impl CapabilityKind {
    const fn as_str(self) -> &'static str {
        match self {
            Self::AgentTool => "agent_tool",
            Self::AppSurface => "app_surface",
            Self::AppAction => "app_action",
            Self::ExecutionDependency => "execution_dependency",
            Self::Orchestration => "orchestration",
            Self::Persistence => "persistence",
            Self::InstructionContext => "instruction_context",
            Self::ControlTransfer => "control_transfer",
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CapabilityBackend {
    Crd,
    Browser,
    Workspace,
    Terminal,
    Host,
    App,
    Extension,
    ExternalMcp,
    Workflow,
    Toolchains,
    Storage,
    Skills,
    Memory,
}

impl CapabilityBackend {
    const fn as_str(self) -> &'static str {
        match self {
            Self::Crd => "crd",
            Self::Browser => "browser",
            Self::Workspace => "workspace",
            Self::Terminal => "terminal",
            Self::Host => "host",
            Self::App => "app",
            Self::Extension => "extension",
            Self::ExternalMcp => "external_mcp",
            Self::Workflow => "workflow",
            Self::Toolchains => "toolchains",
            Self::Storage => "storage",
            Self::Skills => "skills",
            Self::Memory => "memory",
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CapabilityProjection {
    RigDirect,
    AcpClient,
    LoopbackHttpMcp,
    ShellApi,
    ExtensionApi,
    ExternalMcp,
    PromptContext,
    HostService,
}

impl CapabilityProjection {
    const fn as_str(self) -> &'static str {
        match self {
            Self::RigDirect => "rig_direct",
            Self::AcpClient => "acp_client",
            Self::LoopbackHttpMcp => "loopback_http_mcp",
            Self::ShellApi => "shell_api",
            Self::ExtensionApi => "extension_api",
            Self::ExternalMcp => "external_mcp",
            Self::PromptContext => "prompt_context",
            Self::HostService => "host_service",
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CapabilityAgentExposureView {
    pub agent_id: String,
    pub projection: String,
    pub available: bool,
    pub detail: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CapabilityView {
    pub id: String,
    pub label: String,
    pub kind: String,
    pub provider: String,
    pub backend: String,
    pub operations: Vec<String>,
    pub scopes: Vec<String>,
    pub permissions: Vec<String>,
    pub health: String,
    pub detail: String,
    pub projections: Vec<String>,
    pub agent_exposures: Vec<CapabilityAgentExposureView>,
    pub toolchain_id: Option<String>,
    pub source: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LegacyDataIssueView {
    pub id: String,
    pub title: String,
    pub detail: String,
    pub affected_ids: Vec<String>,
    pub cleanup_action: String,
}

#[must_use]
pub fn legacy_data_issues(tools: &[ToolView]) -> Vec<LegacyDataIssueView> {
    let retired = tools
        .iter()
        .filter(|tool| {
            tool.extension_id.as_deref() == Some("io.ovule.computer-use.trycua")
                || tool.transport == "stdio" && tool.target == "cua-driver"
        })
        .map(|tool| tool.id.clone())
        .collect::<Vec<_>>();
    if retired.is_empty() {
        Vec::new()
    } else {
        vec![LegacyDataIssueView {
            id: "retired-trycua-computer-use".to_owned(),
            title: "Retired TryCua Computer Use data".to_owned(),
            detail: "This record is quarantined and cannot run. Clean it to activate the built-in CRD Computer Use capability.".to_owned(),
            affected_ids: retired,
            cleanup_action: "cleanLegacyData".to_owned(),
        }]
    }
}

#[allow(clippy::too_many_lines)]
#[must_use]
pub fn capability_views(tools: &[ToolView], agents: &[AgentView]) -> Vec<CapabilityView> {
    let legacy = !legacy_data_issues(tools).is_empty();
    let mut capabilities = builtins::views();

    if let Some(tool) = tools.iter().find(|tool| tool.id == "computer-use") {
        let is_crd = tool.transport == "native-crd"
            && tool.target == "tuffite.remoting"
            && tool.extension_id.as_deref() == Some(ovule_extension_api::host::OWNER)
            && !legacy;
        let available = is_crd && tool.enabled && tool.available;
        capabilities.push(CapabilityView {
            id: "computer-use".to_owned(),
            label: "CRD Computer Use".to_owned(),
            kind: CapabilityKind::AgentTool.as_str().to_owned(),
            provider: "Tuffite RemotingService".to_owned(),
            backend: CapabilityBackend::Crd.as_str().to_owned(),
            operations: vec!["snapshot", "mouse", "keyboard", "clipboard"]
                .into_iter()
                .map(str::to_owned)
                .collect(),
            scopes: vec!["physical_desktop".to_owned()],
            permissions: vec![
                "desktop.capture".to_owned(),
                "desktop.input".to_owned(),
                "clipboard.write".to_owned(),
            ],
            health: if available {
                "ready"
            } else if !tool.enabled {
                "disabled"
            } else if legacy {
                "cleanup_required"
            } else {
                "unavailable"
            }
            .to_owned(),
            detail: if legacy {
                "A retired TryCua record is quarantined; clean legacy data to enable CRD."
                    .to_owned()
            } else {
                tool.detail.clone()
            },
            projections: vec![
                CapabilityProjection::RigDirect.as_str().to_owned(),
                CapabilityProjection::LoopbackHttpMcp.as_str().to_owned(),
                CapabilityProjection::ShellApi.as_str().to_owned(),
            ],
            agent_exposures: agents
                .iter()
                .filter(|agent| agent.tool_ids.iter().any(|id| id == "computer-use"))
                .map(|agent| {
                    let projection = if agent.driver == "ovule" {
                        CapabilityProjection::RigDirect
                    } else {
                        CapabilityProjection::LoopbackHttpMcp
                    };
                    CapabilityAgentExposureView {
                        agent_id: agent.id.clone(),
                        projection: projection.as_str().to_owned(),
                        available: available && agent.enabled && agent.available,
                        detail: if projection == CapabilityProjection::RigDirect {
                            "In-process CRD facade"
                        } else {
                            "Authenticated loopback Streamable HTTP MCP"
                        }
                        .to_owned(),
                    }
                })
                .collect(),
            toolchain_id: None,
            source: "built_in".to_owned(),
        });
    }

    for tool in tools.iter().filter(|tool| tool.id != "computer-use") {
        let backend = if tool.extension_id.is_some() {
            CapabilityBackend::Extension
        } else {
            CapabilityBackend::ExternalMcp
        };
        capabilities.push(CapabilityView {
            id: format!("mcp:{}", tool.id),
            label: tool.label.clone(),
            kind: CapabilityKind::AgentTool.as_str().to_owned(),
            provider: tool
                .extension_id
                .clone()
                .unwrap_or_else(|| "User configured".to_owned()),
            backend: backend.as_str().to_owned(),
            operations: tool.capabilities.clone(),
            scopes: vec!["agent_session".to_owned()],
            permissions: tool
                .credential_env
                .iter()
                .map(|_| "credential.use".to_owned())
                .collect(),
            health: if tool.enabled && tool.available {
                "ready"
            } else if !tool.enabled {
                "disabled"
            } else {
                "unavailable"
            }
            .to_owned(),
            detail: tool.detail.clone(),
            projections: vec![CapabilityProjection::ExternalMcp.as_str().to_owned()],
            agent_exposures: agents
                .iter()
                .filter(|agent| agent.tool_ids.contains(&tool.id))
                .map(|agent| CapabilityAgentExposureView {
                    agent_id: agent.id.clone(),
                    projection: CapabilityProjection::ExternalMcp.as_str().to_owned(),
                    available: tool.enabled && tool.available && agent.enabled && agent.available,
                    detail: format!("{} MCP", tool.transport),
                })
                .collect(),
            toolchain_id: tool.toolchain_id.clone(),
            source: if tool.extension_id.is_some() {
                "extension"
            } else {
                "external_mcp"
            }
            .to_owned(),
        });
    }
    // Workspace is an unconditional driver contract. Context/browser exposure needs
    // Attempt route/scope/host data and is reported by AssemblyManifest instead.
    // Never infer terminal model tools from a visible PTY surface.
    if let Some(workspace) = capabilities
        .iter_mut()
        .find(|item| item.id == "workspace-operations")
    {
        workspace.agent_exposures = agents.iter().map(|agent| CapabilityAgentExposureView {
            agent_id: agent.id.clone(),
            projection: if agent.driver == "ovule" { CapabilityProjection::RigDirect } else { CapabilityProjection::AcpClient }.as_str().to_owned(),
            available: agent.enabled && agent.available,
            detail: "Workspace access is further bounded by Attempt workspace selection and transport policy.".to_owned(),
        }).collect();
    }
    capabilities
}

#[allow(clippy::too_many_arguments)]
fn builtin(
    id: &str,
    label: &str,
    kind: CapabilityKind,
    provider: &str,
    backend: CapabilityBackend,
    operations: &[&str],
    scopes: &[&str],
    permissions: &[&str],
    projections: &[CapabilityProjection],
    detail: &str,
) -> CapabilityView {
    CapabilityView {
        id: id.to_owned(),
        label: label.to_owned(),
        kind: kind.as_str().to_owned(),
        provider: provider.to_owned(),
        backend: backend.as_str().to_owned(),
        operations: operations.iter().map(|value| (*value).to_owned()).collect(),
        scopes: scopes.iter().map(|value| (*value).to_owned()).collect(),
        permissions: permissions
            .iter()
            .map(|value| (*value).to_owned())
            .collect(),
        health: "ready".to_owned(),
        detail: detail.to_owned(),
        projections: projections
            .iter()
            .map(|value| value.as_str().to_owned())
            .collect(),
        agent_exposures: Vec::new(),
        toolchain_id: None,
        source: "built_in".to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tool(owner: &str, transport: &str, target: &str) -> ToolView {
        ToolView {
            id: "computer-use".to_owned(),
            label: "Computer Use".to_owned(),
            transport: transport.to_owned(),
            target: target.to_owned(),
            args: Vec::new(),
            enabled: true,
            required: false,
            available: true,
            detail: "ready".to_owned(),
            credential_env: None,
            extension_id: Some(owner.to_owned()),
            toolchain_id: None,
            capabilities: Vec::new(),
        }
    }

    #[test]
    fn retired_trycua_is_reported_and_quarantines_computer_use() {
        let tools = vec![tool("io.ovule.computer-use.trycua", "stdio", "cua-driver")];
        assert_eq!(legacy_data_issues(&tools).len(), 1);
        let capabilities = capability_views(&tools, &[]);
        let computer_use = capabilities
            .iter()
            .find(|capability| capability.id == "computer-use")
            .unwrap();
        assert_eq!(computer_use.backend, "crd");
        assert_eq!(computer_use.health, "cleanup_required");
    }

    #[test]
    fn crd_uses_direct_for_native_agent_and_loopback_mcp_for_external_agent() {
        let tools = vec![tool("io.ovule.host", "native-crd", "tuffite.remoting")];
        let agents = ["ovule", "sample"]
            .into_iter()
            .map(|driver| AgentView {
                id: driver.to_owned(),
                label: driver.to_owned(),
                driver: driver.to_owned(),
                available: true,
                enabled: true,
                detail: "ready".to_owned(),
                model_id: None,
                skill_ids: Vec::new(),
                tool_ids: vec!["computer-use".to_owned()],
                instructions: String::new(),
                extension_id: None,
            })
            .collect::<Vec<_>>();
        let capabilities = capability_views(&tools, &agents);
        let computer_use = capabilities
            .iter()
            .find(|capability| capability.id == "computer-use")
            .unwrap();
        assert_eq!(computer_use.health, "ready");
        assert_eq!(computer_use.agent_exposures[0].projection, "rig_direct");
        assert_eq!(
            computer_use.agent_exposures[1].projection,
            "loopback_http_mcp"
        );
    }
    #[test]
    fn host_services_do_not_claim_model_tool_projections() {
        let capabilities = capability_views(&[], &[]);
        for id in [
            "toolchain-runtime",
            "workflow-orchestration",
            "durable-storage",
        ] {
            let capability = capabilities.iter().find(|item| item.id == id).unwrap();
            assert_eq!(capability.source, "built_in");
            assert_eq!(
                capability.agent_exposures,
                Vec::<CapabilityAgentExposureView>::new()
            );
            assert!(!capability.projections.iter().any(|projection| matches!(
                projection.as_str(),
                "rig_direct" | "loopback_http_mcp" | "external_mcp"
            )));
        }
        assert!(capabilities.iter().any(|item| item.id == "memory"));
    }

    #[test]
    fn disabled_computer_use_is_not_reported_as_ready() {
        let mut tool = tool(
            ovule_extension_api::host::OWNER,
            "native-crd",
            "tuffite.remoting",
        );
        tool.enabled = false;
        let capabilities = capability_views(&[tool], &[]);
        assert_eq!(
            capabilities
                .iter()
                .find(|item| item.id == "computer-use")
                .unwrap()
                .health,
            "disabled"
        );
    }
}
