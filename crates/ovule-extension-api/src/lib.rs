//! Trusted Host side of the JavaScript extension protocol.
//!
//! A Utility session binds [`ExtensionPrincipal`] out of band. JavaScript sends
//! only [`HostRequest`] values and therefore cannot forge identity or grants.

use std::collections::BTreeSet;

use std::path::{Component, Path};

use serde::{Deserialize, Serialize};

const MAX_REQUEST_ID_BYTES: usize = 128;
const MAX_STRING_BYTES: usize = 4 * 1024;
const MAX_ARGUMENTS: usize = 256;

/// Rust-authoritative manifest for one immutable JS/TS extension package.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExtensionManifest {
    pub schema_version: u32,
    pub id: String,
    pub private: bool,
    pub version: String,
    #[serde(rename = "type")]
    pub module_type: String,
    pub api_version: u32,
    #[serde(default)]
    pub runtime: Option<ExtensionRuntime>,
    #[serde(default)]
    pub ui: Option<ExtensionUi>,
    pub contributes: ExtensionContributions,
    pub permissions: ExtensionPermissions,
}

/// A self-contained classic UI script evaluated only in a managed DOM world.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExtensionUi {
    pub entry: String,
}

/// Execution backend selected by one extension package.
///
/// JavaScript extensions run inside Tuffite's restricted V8 Utility realm.
/// Native Utility extensions are statically linked into the application cdylib
/// and addressed by their registered service name; the manifest never names an
/// arbitrary library path.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
pub enum ExtensionRuntime {
    #[serde(rename = "javascript")]
    JavaScript { entry: String },
    #[serde(rename = "utility")]
    Utility { service: String },
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExtensionContributions {
    #[serde(default)]
    pub agents: Vec<AgentContribution>,
    #[serde(default)]
    pub channels: Vec<ExtensionContribution>,
    #[serde(default)]
    pub skills: Vec<ExtensionSkillContribution>,
    #[serde(default)]
    pub models: Vec<ModelContribution>,
    #[serde(default)]
    pub capabilities: Vec<ExtensionCapabilityContribution>,
    #[serde(default)]
    pub message_blocks: Vec<MessageBlockContribution>,
    #[serde(default)]
    pub slash_commands: Vec<SlashCommandContribution>,
    #[serde(default)]
    pub actions: Vec<ExtensionActionContribution>,
    #[serde(default)]
    pub computer_use: Vec<ComputerUseContribution>,
    #[serde(default)]
    pub toolchains: Vec<ToolchainDefinition>,
    #[serde(default)]
    pub file_editors: Vec<FileEditorContribution>,
    #[serde(default)]
    pub onboarding: Vec<OnboardingContribution>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OnboardingContribution {
    #[serde(default)]
    pub tag: Option<String>,
    pub id: String,
    pub label: String,
    pub description: String,
    pub icon: String,
    #[serde(default)]
    pub agent_ids: Vec<String>,
    #[serde(default)]
    pub model_provider: Option<String>,
    #[serde(default)]
    pub fields: Vec<OnboardingField>,
    pub actions: Vec<OnboardingAction>,
    #[serde(default)]
    pub links: Vec<OnboardingLink>,
    pub status: OnboardingStatusProbe,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OnboardingField {
    pub id: String,
    #[serde(default)]
    pub label: String,
    pub kind: OnboardingFieldKind,
    #[serde(default)]
    pub required: bool,
    #[serde(default)]
    pub placeholder: String,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub enum OnboardingFieldKind {
    Secret,
    Text,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OnboardingLink {
    #[serde(default)]
    pub label: String,
    pub url: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OnboardingAction {
    pub id: String,
    #[serde(default)]
    pub label: String,
    pub handler: OnboardingActionHandler,
    #[serde(default)]
    pub toolchains: Vec<String>,
    #[serde(default)]
    pub toolchain: Option<String>,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub field: Option<String>,
    #[serde(default)]
    pub key_field: Option<String>,
    #[serde(default)]
    pub provider: Option<String>,
    #[serde(default)]
    pub credential_reference: Option<String>,
    #[serde(default)]
    pub endpoint: Option<String>,
    #[serde(default)]
    pub authorization: Option<AuthorizationProtocol>,
}

/// Extension-owned JSONL handshake; the host retains process and credential ownership.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AuthorizationProtocol {
    pub initialize: serde_json::Value,
    pub after_initialize: Vec<serde_json::Value>,
    pub authorization_response_id: u64,
    pub url_pointer: String,
    pub completion_method: String,
    pub success_pointer: String,
}
impl AuthorizationProtocol {
    pub fn validate(&self) -> Result<(), String> {
        let init = self
            .initialize
            .get("id")
            .and_then(serde_json::Value::as_u64);
        if init.is_none()
            || init == Some(self.authorization_response_id)
            || self
                .initialize
                .get("method")
                .and_then(serde_json::Value::as_str)
                .is_none_or(str::is_empty)
            || self.after_initialize.is_empty()
            || self.after_initialize.len() > 8
            || self.after_initialize.iter().any(|v| {
                v.get("method")
                    .and_then(serde_json::Value::as_str)
                    .is_none_or(str::is_empty)
            })
            || self
                .after_initialize
                .iter()
                .filter(|v| {
                    v.get("id").and_then(serde_json::Value::as_u64)
                        == Some(self.authorization_response_id)
                })
                .count()
                != 1
            || self.initialize.to_string().len()
                + self
                    .after_initialize
                    .iter()
                    .map(|v| v.to_string().len())
                    .sum::<usize>()
                > 16_384
            || [&self.url_pointer, &self.success_pointer]
                .iter()
                .any(|p| !p.starts_with('/') || p.len() > 256)
            || self.completion_method.is_empty()
            || self.completion_method.len() > 128
        {
            return Err("Invalid authorization protocol declaration".into());
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq)]
pub enum OnboardingActionHandler {
    #[serde(rename = "connectivity.configure")]
    ConnectivityConfigure,
    #[serde(rename = "connectivity.test")]
    ConnectivityTest,
    #[serde(rename = "connectivity.disable")]
    ConnectivityDisable,
    #[serde(rename = "toolchain.install")]
    ToolchainInstall,
    #[serde(rename = "authorization.launch")]
    AuthorizationLaunch,
    #[serde(rename = "authorization.stdin")]
    AuthorizationStdin,
    #[serde(rename = "model-provider.configure")]
    ModelProviderConfigure,
    #[serde(rename = "model-provider.refresh")]
    ModelProviderRefresh,
    #[serde(rename = "model-provider.pull")]
    ModelProviderPull,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OnboardingStatusProbe {
    pub handler: OnboardingStatusHandler,
    #[serde(default)]
    pub toolchain: Option<String>,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub credential_reference: Option<String>,
    pub ready_detail: String,
    pub missing_detail: String,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq)]
pub enum OnboardingStatusHandler {
    #[serde(rename = "connectivity.configured")]
    ConnectivityConfigured,
    #[serde(rename = "command.probe")]
    CommandProbe,
    #[serde(rename = "secret.configured")]
    SecretConfigured,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct ExtensionContribution {
    pub id: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ComputerUseContribution {
    pub id: String,
    pub label: String,
    pub provider: String,
    pub backend: ComputerUseBackend,
    #[serde(default)]
    pub toolchain: Option<String>,
    #[serde(default)]
    pub args: Vec<String>,
    pub capabilities: Vec<String>,
    #[serde(default)]
    pub agents: Vec<String>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub enum ComputerUseBackend {
    NativeCrd,
    McpStdio,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub enum FileEditorMode {
    ReadOnly,
    Editable,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub enum ThreadFilePresentation {
    Link,
    Card,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FileEditorContribution {
    pub id: String,
    pub label: String,
    pub extensions: Vec<String>,
    pub mode: FileEditorMode,
    #[serde(default)]
    pub thread_presentation: Option<ThreadFilePresentation>,
    pub tag: String,
    pub module: String,
    #[serde(default)]
    pub style: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentContribution {
    pub id: String,
    pub label: String,
    pub executable_candidates: Vec<String>,
    #[serde(default)]
    pub toolchain: Option<String>,
    #[serde(default)]
    pub mcp_config: bool,
    #[serde(default)]
    pub required_environment: Vec<String>,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq)]
pub enum AgentOutput {
    #[default]
    #[serde(rename = "final-message")]
    FinalMessage,
    #[serde(rename = "claude-json")]
    ClaudeJson,
    #[serde(rename = "plain")]
    Plain,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ModelContribution {
    pub id: String,
    pub label: String,
    pub provider: String,
    pub remote_id: String,
    pub agents: Vec<String>,
    #[serde(default)]
    pub recommended: bool,
    #[serde(default)]
    pub description: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExtensionSkillContribution {
    pub id: String,
    pub path: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExtensionCapabilityContribution {
    pub id: String,
    pub label: String,
    pub description: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MessageBlockContribution {
    #[serde(default)]
    pub ui: Option<UiContribution>,
    pub kind: String,
    #[serde(default)]
    pub tag: Option<String>,
    #[serde(default)]
    pub module: Option<String>,
    #[serde(default)]
    pub style: Option<String>,
    #[serde(default)]
    pub host_renderer: Option<HostMessageBlockRenderer>,
    #[serde(default)]
    pub capability: Option<String>,
    pub agent_instructions: String,
    pub example: serde_json::Value,
}

/// Transport for an extension-owned UI contribution, independent of its business kind.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(tag = "type", rename_all = "kebab-case", deny_unknown_fields)]
pub enum UiContribution {
    Iframe,
    Isolated { tag: String },
}
impl UiContribution {
    #[must_use]
    pub const fn kind(&self) -> &'static str {
        match self {
            Self::Iframe => "iframe",
            Self::Isolated { .. } => "isolated",
        }
    }
    #[must_use]
    pub fn tag(&self) -> Option<&str> {
        match self {
            Self::Isolated { tag } => Some(tag),
            Self::Iframe => None,
        }
    }
}
impl MessageBlockContribution {
    #[must_use]
    pub const fn requires_isolated_ui(&self) -> bool {
        self.host_renderer.is_none() && !matches!(self.ui, Some(UiContribution::Iframe))
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq)]
pub enum HostMessageBlockRenderer {
    #[serde(rename = "channel-setup")]
    ChannelSetup,
    #[serde(rename = "human-handoff")]
    HumanHandoff,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SlashCommandContribution {
    pub id: String,
    pub label: String,
    pub description: String,
    pub handler: SlashCommandHandler,
    pub target: String,
    pub skills: Vec<String>,
    pub workflow: String,
    pub status_block: String,
    pub fallback: ExtensionWorkflowFallback,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExtensionWorkflowFallback {
    pub title: String,
    pub intent: String,
    pub response: String,
    pub nodes: Vec<ExtensionWorkflowNode>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExtensionWorkflowNode {
    pub id: String,
    pub kind: ExtensionWorkflowNodeKind,
    pub title: String,
    #[serde(default)]
    pub agent: Option<String>,
    #[serde(default)]
    pub host: Option<String>,
    #[serde(default)]
    pub workspaces: Vec<String>,
    #[serde(default)]
    pub depends_on: Vec<String>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ExtensionWorkflowNodeKind {
    Task,
    Gate,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
pub enum SlashCommandHandler {
    #[serde(rename = "channel.setup")]
    ChannelSetup,
    #[serde(rename = "connectivity.setup")]
    ConnectivitySetup,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExtensionActionContribution {
    pub id: String,
    pub handler: ExtensionActionHandler,
    pub target: String,
    #[serde(default)]
    pub reuse_existing: bool,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
pub enum ExtensionActionHandler {
    #[serde(rename = "connectivity.status")]
    ConnectivityStatus,
    #[serde(rename = "connectivity.login")]
    ConnectivityLogin,
    #[serde(rename = "connectivity.accounts")]
    ConnectivityAccounts,
    #[serde(rename = "connectivity.create")]
    ConnectivityCreate,
    #[serde(rename = "connectivity.open")]
    ConnectivityOpen,
    #[serde(rename = "connectivity.open-external")]
    ConnectivityOpenExternal,
    #[serde(rename = "connectivity.cancel")]
    ConnectivityCancel,
    #[serde(rename = "channel.status")]
    ChannelStatus,
    #[serde(rename = "channel.status.read")]
    ChannelStatusRead,
    #[serde(rename = "channel.registration.start")]
    ChannelRegistrationStart,
    #[serde(rename = "channel.thread.bind")]
    ChannelThreadBind,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct ExtensionPermissions {
    #[serde(default)]
    pub process: Vec<String>,
    #[serde(default)]
    pub workspace: bool,
    #[serde(default)]
    pub network: Vec<String>,
    #[serde(default)]
    pub secrets: Vec<String>,
    #[serde(default)]
    pub environment: Vec<String>,
}
impl ExtensionManifest {
    #[allow(clippy::too_many_lines)] // One fail-closed pass validates cross-contribution references.
    pub fn validate(&self) -> Result<(), HostProtocolError> {
        if self.schema_version != 1
            || self.api_version != 1
            || !self.private
            || self.module_type != "module"
            || !valid_extension_id(&self.id)
            || !valid_version(&self.version)
            || self
                .permissions
                .process
                .iter()
                .any(|value| !valid_executable(value))
            || self
                .permissions
                .secrets
                .iter()
                .any(|value| !valid_token(value))
            || self
                .permissions
                .environment
                .iter()
                .any(|value| !valid_environment_name(value))
            || self
                .permissions
                .network
                .iter()
                .any(|value| !valid_network_pattern(value))
            || (!self.contributes.agents.is_empty()
                || !self.contributes.channels.is_empty()
                || !self.contributes.models.is_empty())
                && self.runtime.is_none()
        {
            return Err(HostProtocolError::InvalidManifest);
        }
        if self.ui.as_ref().is_some_and(|ui| {
            !ui.entry.starts_with("dist/") || !valid_relative_asset(&ui.entry, "js")
        }) {
            return Err(HostProtocolError::InvalidManifest);
        }
        let toolchain_ids = self
            .contributes
            .toolchains
            .iter()
            .map(|toolchain| toolchain.id.as_str())
            .collect::<BTreeSet<_>>();
        if self.contributes.agents.is_empty()
            && self.contributes.channels.is_empty()
            && self.contributes.models.is_empty()
            && self.contributes.capabilities.is_empty()
            && self.contributes.message_blocks.is_empty()
            && self.contributes.slash_commands.is_empty()
            && self.contributes.computer_use.is_empty()
            && self.contributes.toolchains.is_empty()
            && self.contributes.file_editors.is_empty()
            && self.contributes.onboarding.is_empty()
            || self.contributes.agents.iter().any(|agent| {
                !valid_token(&agent.id)
                    || !valid_display_text(&agent.label, 128)
                    || agent.executable_candidates.is_empty()
                    || agent.executable_candidates.len() > 16
                    || agent
                        .executable_candidates
                        .iter()
                        .collect::<BTreeSet<_>>()
                        .len()
                        != agent.executable_candidates.len()
                    || agent.executable_candidates.iter().any(|executable| {
                        !valid_executable(executable)
                            || !self.permissions.process.contains(executable)
                    })
                    || agent
                        .toolchain
                        .as_deref()
                        .is_some_and(|id| !valid_token(id))
                    || agent.required_environment.len() > 32
                    || agent
                        .required_environment
                        .iter()
                        .collect::<BTreeSet<_>>()
                        .len()
                        != agent.required_environment.len()
                    || agent
                        .required_environment
                        .iter()
                        .any(|name| !valid_environment_name(name))
            })
            || self
                .contributes
                .channels
                .iter()
                .any(|channel| !valid_token(&channel.id))
            || self.contributes.models.iter().any(|model| {
                !valid_token(&model.id)
                    || !valid_display_text(&model.label, 128)
                    || !valid_token(&model.provider)
                    || !valid_display_text(&model.remote_id, 256)
                    || model.agents.is_empty()
                    || model.agents.len() > 16
                    || model.agents.iter().any(|agent| !valid_token(agent))
                    || model.agents.iter().collect::<BTreeSet<_>>().len() != model.agents.len()
                    || (!model.description.is_empty()
                        && !valid_display_text(&model.description, 1024))
            })
            || self.contributes.skills.iter().any(|skill| {
                !valid_token(&skill.id)
                    || !skill.path.starts_with("skills/")
                    || !valid_relative_asset(&skill.path, "md")
            })
            || self.contributes.computer_use.iter().any(|computer_use| {
                !valid_token(&computer_use.id)
                    || !valid_display_text(&computer_use.label, 128)
                    || !valid_token(&computer_use.provider)
                    || match computer_use.backend {
                        ComputerUseBackend::NativeCrd => {
                            computer_use.toolchain.is_some() || !computer_use.args.is_empty()
                        }
                        ComputerUseBackend::McpStdio => {
                            computer_use.toolchain.as_ref().is_none_or(|toolchain| {
                                !valid_token(toolchain)
                                    || !toolchain_ids.contains(toolchain.as_str())
                            })
                        }
                    }
                    || computer_use.args.len() > 64
                    || computer_use.args.iter().any(|arg| {
                        arg.is_empty() || arg.len() > MAX_STRING_BYTES || arg.contains('\0')
                    })
                    || computer_use.capabilities.is_empty()
                    || computer_use.capabilities.len() > 32
                    || computer_use
                        .capabilities
                        .iter()
                        .any(|capability| !valid_token(capability))
                    || computer_use
                        .capabilities
                        .iter()
                        .collect::<BTreeSet<_>>()
                        .len()
                        != computer_use.capabilities.len()
                    || computer_use.agents.len() > 16
                    || computer_use.agents.iter().any(|agent| !valid_token(agent))
                    || computer_use.agents.iter().collect::<BTreeSet<_>>().len()
                        != computer_use.agents.len()
            })
            || self
                .contributes
                .toolchains
                .iter()
                .any(|toolchain| validate_definition(toolchain).is_err())
            || self.contributes.file_editors.iter().any(|editor| {
                !valid_token(&editor.id)
                    || !valid_display_text(&editor.label, 128)
                    || editor.extensions.is_empty()
                    || editor.extensions.len() > 32
                    || editor.extensions.iter().any(|extension| {
                        extension.is_empty()
                            || extension.len() > 16
                            || !extension
                                .bytes()
                                .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit())
                    })
                    || editor.extensions.iter().collect::<BTreeSet<_>>().len()
                        != editor.extensions.len()
                    || !valid_custom_element_name(&editor.tag)
                    || !(self.ui.as_ref().is_some_and(|ui| ui.entry == editor.module)
                        || (editor.module.starts_with("dist/web/")
                            && valid_relative_asset(&editor.module, "mjs")))
                    || editor.style.as_deref().is_some_and(|style| {
                        !style.starts_with("dist/web/") || !valid_relative_asset(style, "css")
                    })
            })
        {
            return Err(HostProtocolError::InvalidManifest);
        }
        if self
            .contributes
            .agents
            .iter()
            .map(|item| item.id.as_str())
            .collect::<BTreeSet<_>>()
            .len()
            != self.contributes.agents.len()
            || self
                .contributes
                .channels
                .iter()
                .map(|item| item.id.as_str())
                .collect::<BTreeSet<_>>()
                .len()
                != self.contributes.channels.len()
            || self
                .contributes
                .models
                .iter()
                .map(|item| item.id.as_str())
                .collect::<BTreeSet<_>>()
                .len()
                != self.contributes.models.len()
            || self
                .contributes
                .skills
                .iter()
                .map(|item| item.id.as_str())
                .collect::<BTreeSet<_>>()
                .len()
                != self.contributes.skills.len()
            || toolchain_ids.len() != self.contributes.toolchains.len()
        {
            return Err(HostProtocolError::InvalidManifest);
        }
        if self.contributes.capabilities.iter().any(|capability| {
            !valid_token(&capability.id)
                || !valid_display_text(&capability.label, 128)
                || !valid_display_text(&capability.description, 1024)
        }) || self.contributes.capabilities.len() > 64
            || self.contributes.message_blocks.len() > 64
        {
            return Err(HostProtocolError::InvalidManifest);
        }
        let capability_ids = self
            .contributes
            .capabilities
            .iter()
            .map(|capability| capability.id.as_str())
            .collect::<BTreeSet<_>>();
        if capability_ids.len() != self.contributes.capabilities.len() {
            return Err(HostProtocolError::InvalidManifest);
        }
        let mut block_kinds = BTreeSet::new();
        let mut block_tags = BTreeSet::new();
        for block in &self.contributes.message_blocks {
            let renderer_valid = if let Some(ui) = &block.ui {
                block.tag.is_none()
                    && block.module.is_none()
                    && block.style.is_none()
                    && block.host_renderer.is_none()
                    && match ui {
                        UiContribution::Iframe => true,
                        UiContribution::Isolated { tag } => {
                            self.ui.is_some()
                                && valid_custom_element_name(tag)
                                && block_tags.insert(tag.as_str())
                        }
                    }
            } else {
                match (&block.tag, &block.module, block.host_renderer) {
                    (Some(tag), Some(module), None) => {
                        valid_custom_element_name(tag)
                            && block_tags.insert(tag.as_str())
                            && (self.ui.as_ref().is_some_and(|ui| &ui.entry == module)
                                || (module.starts_with("dist/web/")
                                    && valid_relative_asset(module, "mjs")))
                            && block.style.as_deref().is_none_or(|style| {
                                style.starts_with("dist/web/") && valid_relative_asset(style, "css")
                            })
                    }
                    (None, None, Some(HostMessageBlockRenderer::ChannelSetup)) => {
                        block.style.is_none() && !self.contributes.channels.is_empty()
                    }
                    (None, None, Some(HostMessageBlockRenderer::HumanHandoff)) => {
                        block.style.is_none()
                    }
                    _ => false,
                }
            };
            if !valid_token(&block.kind)
                || !renderer_valid
                || block
                    .capability
                    .as_deref()
                    .is_some_and(|id| !capability_ids.contains(id))
                || !valid_display_text(&block.agent_instructions, 4 * 1024)
                || serde_json::to_vec(&block.example)
                    .map_or(true, |encoded| encoded.len() > 64 * 1024)
                || !block_kinds.insert(block.kind.as_str())
            {
                return Err(HostProtocolError::InvalidManifest);
            }
        }
        let channel_ids = self
            .contributes
            .channels
            .iter()
            .map(|channel| channel.id.as_str())
            .collect::<BTreeSet<_>>();
        let skill_ids = self
            .contributes
            .skills
            .iter()
            .map(|skill| skill.id.as_str())
            .collect::<BTreeSet<_>>();
        let action_ids = self
            .contributes
            .actions
            .iter()
            .map(|action| action.id.as_str())
            .collect::<BTreeSet<_>>();
        if self.contributes.actions.len() > 64
            || action_ids.len() != self.contributes.actions.len()
            || self.contributes.actions.iter().any(|action| {
                !valid_token(&action.id)
                    || (match action.handler {
                        ExtensionActionHandler::ChannelStatus
                        | ExtensionActionHandler::ChannelStatusRead
                        | ExtensionActionHandler::ChannelRegistrationStart
                        | ExtensionActionHandler::ChannelThreadBind => {
                            !channel_ids.contains(action.target.as_str())
                        }
                        _ => {
                            action.target != "cloudflare-turn"
                                || !valid_connectivity_permissions(self)
                        }
                    })
                    || (action.reuse_existing
                        && action.handler != ExtensionActionHandler::ChannelRegistrationStart)
            })
        {
            return Err(HostProtocolError::InvalidManifest);
        }
        let mut slash_ids = BTreeSet::new();
        if self.contributes.slash_commands.len() > 64
            || self.contributes.slash_commands.iter().any(|command| {
                !valid_token(&command.id)
                    || command.id == "onboarding"
                    || !valid_display_text(&command.label, 128)
                    || !valid_display_text(&command.description, 1024)
                    || (match command.handler {
                        SlashCommandHandler::ChannelSetup => {
                            !channel_ids.contains(command.target.as_str())
                        }
                        SlashCommandHandler::ConnectivitySetup => {
                            command.target != "cloudflare-turn"
                                || !valid_connectivity_permissions(self)
                        }
                    })
                    || command.skills.is_empty()
                    || command.skills.len() > 16
                    || command
                        .skills
                        .iter()
                        .any(|skill| !skill_ids.contains(skill.as_str()))
                    || command.skills.iter().collect::<BTreeSet<_>>().len() != command.skills.len()
                    || !command.workflow.starts_with("workflows/")
                    || !valid_relative_asset(&command.workflow, "md")
                    || !block_kinds.contains(command.status_block.as_str())
                    || !valid_extension_workflow_fallback(&command.fallback)
                    || !slash_ids.insert(command.id.as_str())
            })
        {
            return Err(HostProtocolError::InvalidManifest);
        }
        validate_onboarding(self)?;
        Ok(())
    }
}
#[allow(clippy::too_many_lines)] // Validates references across the complete onboarding contribution.
fn valid_connectivity_permissions(manifest: &ExtensionManifest) -> bool {
    manifest
        .permissions
        .secrets
        .iter()
        .any(|s| s == "OVULE_CLOUDFLARE_TURN")
        && manifest.permissions.process.iter().any(|s| s == "cf-cli")
        && manifest.permissions.network.iter().any(|p| {
            NetworkPattern::parse(p).is_ok_and(|p| {
                p.matches("https://api.cloudflare.com/client/v4/accounts/test/calls/turn_keys")
            })
        })
        && manifest.permissions.network.iter().any(|p| {
            NetworkPattern::parse(p)
                .is_ok_and(|p| p.matches("https://dash.cloudflare.com/oauth2/token"))
        })
}

#[allow(clippy::too_many_lines)]
fn validate_onboarding(manifest: &ExtensionManifest) -> Result<(), HostProtocolError> {
    if manifest.contributes.onboarding.len() > 16 {
        return Err(HostProtocolError::InvalidManifest);
    }
    let mut ids = BTreeSet::new();
    for setup in &manifest.contributes.onboarding {
        let field_ids = setup
            .fields
            .iter()
            .map(|field| field.id.as_str())
            .collect::<BTreeSet<_>>();
        let action_ids = setup
            .actions
            .iter()
            .map(|action| action.id.as_str())
            .collect::<BTreeSet<_>>();
        if setup
            .tag
            .as_ref()
            .is_some_and(|tag| manifest.ui.is_none() || !valid_custom_element_name(tag))
            || !ids.insert(setup.id.as_str())
            || !valid_token(&setup.id)
            || !valid_display_text(&setup.label, 128)
            || !valid_display_text(&setup.description, 1024)
            || !valid_token(&setup.icon)
            || setup.agent_ids.len() > 16
            || setup.agent_ids.iter().any(|id| !valid_token(id))
            || setup
                .model_provider
                .as_deref()
                .is_some_and(|id| !valid_token(id))
            || setup.fields.len() > 16
            || field_ids.len() != setup.fields.len()
            || setup.fields.iter().any(|field| {
                !valid_token(&field.id)
                    || (!field.label.is_empty() && !valid_display_text(&field.label, 128))
                    || (!field.placeholder.is_empty()
                        && !valid_display_text(&field.placeholder, 256))
            })
            || setup.actions.is_empty()
            || setup.actions.len() > 16
            || action_ids.len() != setup.actions.len()
            || setup.links.len() > 8
            || setup.links.iter().any(|link| {
                (!link.label.is_empty() && !valid_display_text(&link.label, 128))
                    || !url::Url::parse(&link.url).is_ok_and(|url| {
                        url.scheme() == "https"
                            && url.username().is_empty()
                            && url.password().is_none()
                    })
            })
            || !valid_display_text(&setup.status.ready_detail, 512)
            || !valid_display_text(&setup.status.missing_detail, 512)
        {
            return Err(HostProtocolError::InvalidManifest);
        }
        match setup.status.handler {
            OnboardingStatusHandler::CommandProbe => {
                if setup
                    .status
                    .toolchain
                    .as_deref()
                    .is_none_or(|id| !valid_token(id))
                    || setup.status.toolchain.as_deref().is_some_and(|id| {
                        !manifest
                            .permissions
                            .process
                            .iter()
                            .any(|allowed| allowed == id)
                    })
                    || setup.status.args.len() > 16
                    || setup
                        .status
                        .args
                        .iter()
                        .any(|arg| arg.is_empty() || arg.len() > 256)
                    || setup.status.credential_reference.is_some()
                {
                    return Err(HostProtocolError::InvalidManifest);
                }
            }
            OnboardingStatusHandler::SecretConfigured
            | OnboardingStatusHandler::ConnectivityConfigured => {
                if setup
                    .status
                    .credential_reference
                    .as_deref()
                    .is_none_or(|id| {
                        !manifest
                            .permissions
                            .secrets
                            .iter()
                            .any(|allowed| allowed == id)
                    })
                    || (setup.status.handler == OnboardingStatusHandler::ConnectivityConfigured
                        && setup.status.credential_reference.as_deref()
                            != Some("OVULE_CLOUDFLARE_TURN"))
                    || setup.status.toolchain.is_some()
                    || !setup.status.args.is_empty()
                {
                    return Err(HostProtocolError::InvalidManifest);
                }
            }
        }
        for action in &setup.actions {
            let action_field = action
                .field
                .as_deref()
                .and_then(|id| setup.fields.iter().find(|field| field.id == id));
            let field_valid = action
                .field
                .as_deref()
                .is_none_or(|id| field_ids.contains(id));
            if !valid_token(&action.id)
                || (action.handler == OnboardingActionHandler::AuthorizationLaunch
                    && action
                        .authorization
                        .as_ref()
                        .is_none_or(|p| p.validate().is_err()))
                || (action.handler != OnboardingActionHandler::AuthorizationLaunch
                    && action.authorization.is_some())
                || (action.handler != OnboardingActionHandler::ConnectivityConfigure
                    && action.key_field.is_some())
                || (!action.label.is_empty() && !valid_display_text(&action.label, 128))
                || action.toolchains.len() > 8
                || action.toolchains.iter().any(|id| !valid_token(id))
                || action.toolchains.iter().collect::<BTreeSet<_>>().len()
                    != action.toolchains.len()
                || action.args.len() > 16
                || action
                    .args
                    .iter()
                    .any(|arg| arg.is_empty() || arg.len() > 256)
                || !field_valid
            {
                return Err(HostProtocolError::InvalidManifest);
            }
            match action.handler {
                OnboardingActionHandler::ConnectivityConfigure
                | OnboardingActionHandler::ConnectivityTest
                | OnboardingActionHandler::ConnectivityDisable => {
                    if action.provider.as_deref() != Some("cloudflare-turn")
                        || setup.status.handler != OnboardingStatusHandler::ConnectivityConfigured
                        || action.credential_reference.as_deref() != Some("OVULE_CLOUDFLARE_TURN")
                        || !manifest.permissions.secrets.iter().any(|id| id == "OVULE_CLOUDFLARE_TURN")
                        || action.endpoint.as_deref() != Some("https://rtc.live.cloudflare.com/v1/turn/keys")
                        || !manifest.permissions.network.iter().any(|pattern|
                            NetworkPattern::parse(pattern).is_ok_and(|p| p.matches("https://rtc.live.cloudflare.com/v1/turn/keys/test/credentials/generate-ice-servers")))
                        || action.toolchain.is_some() || !action.toolchains.is_empty() || !action.args.is_empty()
                        || setup.model_provider.is_some() || !setup.agent_ids.is_empty()
                        || (action.handler == OnboardingActionHandler::ConnectivityConfigure &&
                            (!action_field.is_some_and(|f| f.kind == OnboardingFieldKind::Secret) ||
                             !action.key_field.as_deref().is_some_and(|id| setup.fields.iter().any(|f| f.id == id && f.kind == OnboardingFieldKind::Text))))
                        || (action.handler != OnboardingActionHandler::ConnectivityConfigure && action.field.is_some()) {
                        return Err(HostProtocolError::InvalidManifest);
                    }
                }
                OnboardingActionHandler::ToolchainInstall => {
                    if action.toolchains.is_empty()
                        || action.toolchain.is_some()
                        || !action.args.is_empty()
                        || action.field.is_some()
                        || action.provider.is_some()
                        || action.credential_reference.is_some()
                        || action.endpoint.is_some()
                        || action
                            .toolchains
                            .iter()
                            .any(|id| !manifest.permissions.process.contains(id))
                    {
                        return Err(HostProtocolError::InvalidManifest);
                    }
                }
                OnboardingActionHandler::AuthorizationLaunch
                | OnboardingActionHandler::AuthorizationStdin => {
                    if action
                        .toolchain
                        .as_deref()
                        .is_none_or(|id| !valid_token(id))
                        || action
                            .toolchain
                            .as_deref()
                            .is_some_and(|id| !action.toolchains.iter().any(|item| item == id))
                        || action.toolchain.as_deref().is_some_and(|id| {
                            !manifest
                                .permissions
                                .process
                                .iter()
                                .any(|allowed| allowed == id)
                        })
                        || action.args.is_empty()
                        || action.provider.is_some()
                        || action.credential_reference.is_some()
                        || action.endpoint.is_some()
                        || (action.handler == OnboardingActionHandler::AuthorizationStdin
                            && action.field.is_none())
                    {
                        return Err(HostProtocolError::InvalidManifest);
                    }
                }
                OnboardingActionHandler::ModelProviderConfigure | OnboardingActionHandler::ModelProviderRefresh => {
                    let endpoint_allowed = action.endpoint.as_deref().is_some_and(|endpoint| {
                        manifest.permissions.network.iter().any(|pattern| {
                            NetworkPattern::parse(pattern)
                                .is_ok_and(|pattern| pattern.matches(endpoint))
                        })
                    });
                    if action.provider.as_deref() != setup.model_provider.as_deref()
                        || (action.handler == OnboardingActionHandler::ModelProviderConfigure
                            && !action_field.is_some_and(|field| field.kind == OnboardingFieldKind::Secret))
                        || (action.handler == OnboardingActionHandler::ModelProviderRefresh && action.field.is_some())
                        || action.credential_reference.as_deref().is_none_or(|id| {
                            !manifest
                                .permissions
                                .secrets
                                .iter()
                                .any(|allowed| allowed == id)
                        })
                        || !endpoint_allowed
                        || action.toolchain.is_some()
                        || !action.args.is_empty()
                    {
                        return Err(HostProtocolError::InvalidManifest);
                    }
                }
                OnboardingActionHandler::ModelProviderPull => {
                    if action.provider.as_deref() != setup.model_provider.as_deref()
                        || action.field.is_none()
                        || !action_field
                            .is_some_and(|field| field.kind == OnboardingFieldKind::Text)
                        || action
                            .toolchain
                            .as_deref()
                            .is_none_or(|id| !valid_token(id))
                        || action
                            .toolchain
                            .as_deref()
                            .is_some_and(|id| !action.toolchains.iter().any(|item| item == id))
                        || action.credential_reference.is_some()
                        || action.endpoint.is_some()
                        || !action.args.is_empty()
                    {
                        return Err(HostProtocolError::InvalidManifest);
                    }
                }
            }
        }
    }
    Ok(())
}
#[must_use]
pub fn valid_extension_workflow_fallback(fallback: &ExtensionWorkflowFallback) -> bool {
    valid_display_text(&fallback.title, 256)
        && valid_display_text(&fallback.intent, 4_096)
        && valid_display_text(&fallback.response, 4_096)
        && (1..=6).contains(&fallback.nodes.len())
        && fallback.nodes.iter().enumerate().all(|(index, node)| {
            valid_token(&node.id)
                && valid_display_text(&node.title, 256)
                && node.agent.as_deref().is_none_or(valid_token)
                && node.host.as_deref().is_none_or(valid_token)
                && node.workspaces.len() <= 16
                && node
                    .workspaces
                    .iter()
                    .all(|workspace| valid_token(workspace))
                && node.workspaces.iter().collect::<BTreeSet<_>>().len() == node.workspaces.len()
                && node.depends_on.len() <= 6
                && node.depends_on.iter().collect::<BTreeSet<_>>().len() == node.depends_on.len()
                && node.depends_on.iter().all(|dependency| {
                    fallback.nodes[..index]
                        .iter()
                        .any(|candidate| candidate.id == *dependency)
                })
        })
        && fallback
            .nodes
            .iter()
            .map(|node| node.id.as_str())
            .collect::<BTreeSet<_>>()
            .len()
            == fallback.nodes.len()
}
#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ToolchainDefinition {
    pub id: String,
    pub label: String,
    pub kind: String,
    #[serde(default = "default_true")]
    pub onboarding: bool,
    pub executable: String,
    pub candidates: Vec<String>,
    #[serde(default)]
    pub version_args: Vec<String>,
    #[serde(default)]
    pub locations: std::collections::HashMap<String, Vec<String>>,
    #[serde(default)]
    pub required_toolchain_ids: Vec<String>,
    pub provider: ToolchainProvider,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(tag = "type", rename_all = "kebab-case", deny_unknown_fields)]
pub enum ToolchainProvider {
    External,
    Npm {
        package: String,
        version: String,
        integrity: String,
        registry: String,
        #[serde(default, rename = "allowScripts")]
        allow_scripts: bool,
    },
    Archive {
        version: String,
        artifacts: std::collections::HashMap<String, ArchiveArtifact>,
    },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ArchiveArtifact {
    pub url: String,
    pub sha256: String,
    pub format: String,
    pub size: u64,
    pub max_extracted_bytes: u64,
    #[serde(default)]
    pub strip_components: usize,
}

const fn default_true() -> bool {
    true
}
pub fn validate_definition(definition: &ToolchainDefinition) -> Result<(), String> {
    if definition.id.is_empty()
        || !definition
            .id
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
        || definition.label.trim().is_empty()
        || definition.executable.trim().is_empty()
        || definition.candidates.is_empty()
        || definition.version_args.len() > 16
        || definition
            .version_args
            .iter()
            .any(|arg| arg.is_empty() || arg.len() > 256 || arg.contains('\0'))
    {
        return Err(format!("invalid Toolchain definition: {}", definition.id));
    }
    if let ToolchainProvider::Npm {
        package,
        version,
        integrity,
        registry,
        ..
    } = &definition.provider
        && (package.is_empty()
            || version.is_empty()
            || version == "latest"
            || !integrity.starts_with("sha512-")
            || !registry.starts_with("https://"))
    {
        return Err(format!(
            "unsafe npm Toolchain definition: {}",
            definition.id
        ));
    }
    if let ToolchainProvider::Archive { version, artifacts } = &definition.provider {
        if version.is_empty() || version == "latest" || artifacts.is_empty() {
            return Err(format!(
                "unsafe archive Toolchain definition: {}",
                definition.id
            ));
        }
        for artifact in artifacts.values() {
            if !artifact.url.starts_with("https://")
                || artifact.sha256.len() != 64
                || !artifact
                    .sha256
                    .chars()
                    .all(|character| character.is_ascii_hexdigit())
                || !matches!(artifact.format.as_str(), "zip" | "tar.gz")
                || artifact.size == 0
                || artifact.max_extracted_bytes < artifact.size
            {
                return Err(format!(
                    "unsafe archive Toolchain artifact: {}",
                    definition.id
                ));
            }
        }
    }
    Ok(())
}
mod runtime;
pub use runtime::*;

/// Built-in host declarations, independent of the extension package lifecycle.
pub mod host;
