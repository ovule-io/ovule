use std::collections::BTreeSet;
use std::sync::Arc;

use super::{
    AgentContributionView, ComputerUseContributionView, ExtensionCapabilityView,
    ExtensionCatalogView, ExtensionPackageView, FileEditorContributionView,
    MessageBlockContributionView, ModelContributionView, SlashCommandContributionView,
};
use crate::protocol::{
    self as extension_protocol, ExtensionActionHandler, FileEditorMode, HostMessageBlockRenderer,
    ThreadFilePresentation,
};

pub struct ExtensionChannelResult {
    pub data_json: String,
    pub open_url: Option<String>,
}

pub trait ExtensionChannelActions: Send + Sync {
    fn bind_thread(
        &self,
        target: &str,
        connection_id: &str,
        thread_id: Option<&str>,
    ) -> Result<ExtensionChannelResult, String>;

    fn read_status(
        &self,
        _target: &str,
        _connection_id: &str,
    ) -> Result<ExtensionChannelResult, String> {
        Err("Channel status reading is unavailable".to_owned())
    }

    fn refresh(&self, target: &str, connection_id: &str) -> Result<ExtensionChannelResult, String>;

    fn start_registration(
        &self,
        target: &str,
        connection_id: &str,
        reuse_existing: bool,
    ) -> Result<ExtensionChannelResult, String>;
}

pub trait ExtensionConnectivityActions: Send + Sync {
    fn run(
        &self,
        action: ExtensionActionHandler,
        account: Option<&str>,
    ) -> Result<ExtensionActionOutcome, String>;
}

pub struct ExtensionActionOutcome {
    pub data_json: String,
    pub open_url: Option<String>,
}

pub(super) struct NativeExtensionService {
    channels: Arc<dyn ExtensionChannelActions>,
    connectivity: Arc<dyn ExtensionConnectivityActions>,
}

impl NativeExtensionService {
    pub const fn new(
        channels: Arc<dyn ExtensionChannelActions>,
        connectivity: Arc<dyn ExtensionConnectivityActions>,
    ) -> Self {
        Self {
            channels,
            connectivity,
        }
    }

    /// Build the current extension catalog.
    ///
    /// # Panics
    /// Panics if a validated File Editor contribution unexpectedly has no Web assets.
    #[allow(clippy::too_many_lines)]
    pub fn catalog() -> Result<ExtensionCatalogView, String> {
        let packages = crate::providers::load_extensions().map_err(|error| error.to_string())?;
        let extension_packages = crate::providers::extension_packages()
            .map_err(|error| error.to_string())?
            .into_iter()
            .map(|package| ExtensionPackageView {
                install_path: package.install_path.to_string_lossy().into_owned(),
                id: package.id,
                version: package.version,
                source: match package.source {
                    extension_protocol::ExtensionPackageSource::BuiltIn => "built-in",
                    extension_protocol::ExtensionPackageSource::InstalledThirdParty => "installed",
                }
                .to_owned(),
                enabled: package.enabled,
                removable: package.removable,
            })
            .collect();
        let mut capabilities = Vec::new();
        let mut agents = Vec::new();
        let mut models = Vec::new();
        let mut message_blocks = Vec::new();
        let mut slash_commands = Vec::new();
        let mut computer_use = Vec::new();
        let mut file_editors = Vec::new();
        let mut kinds = BTreeSet::new();
        for package in packages {
            let extension_id = package.manifest.id.clone();
            let directory = package
                .root
                .file_name()
                .and_then(|value| value.to_str())
                .ok_or_else(|| "invalid extension directory".to_owned())?;
            let has_web_assets = !package.manifest.contributes.file_editors.is_empty()
                || package
                    .manifest
                    .contributes
                    .message_blocks
                    .iter()
                    .any(|block| block.module.is_some());
            let asset_prefix = if has_web_assets {
                let bundled_root = std::fs::canonicalize(
                    crate::providers::extension_asset_root()
                        .map_err(|error| error.to_string())?
                        .join("extensions"),
                )
                .map_err(|_| "invalid bundled extension root".to_owned())?;
                if !package.root.starts_with(&bundled_root) {
                    return Err(
                        "installed Extensions cannot contribute executable Web assets".to_owned(),
                    );
                }
                Some(format!("/extensions/{directory}"))
            } else {
                None
            };
            agents.extend(package.manifest.contributes.agents.iter().map(|agent| {
                AgentContributionView {
                    extension_id: extension_id.clone(),
                    id: agent.id.clone(),
                    label: agent.label.clone(),
                    executable_candidates: agent.executable_candidates.clone(),
                    mcp_config: agent.mcp_config,
                    required_environment: agent.required_environment.clone(),
                }
            }));
            models.extend(package.manifest.contributes.models.iter().map(|model| {
                ModelContributionView {
                    extension_id: extension_id.clone(),
                    id: model.id.clone(),
                    label: model.label.clone(),
                    provider: model.provider.clone(),
                    remote_id: model.remote_id.clone(),
                    agent_ids: model.agents.clone(),
                    recommended: model.recommended,
                    description: model.description.clone(),
                }
            }));
            capabilities.extend(package.manifest.contributes.capabilities.into_iter().map(
                |capability| ExtensionCapabilityView {
                    extension_id: extension_id.clone(),
                    id: capability.id,
                    label: capability.label,
                    description: capability.description,
                },
            ));
            slash_commands.extend(package.manifest.contributes.slash_commands.into_iter().map(
                |command| SlashCommandContributionView {
                    extension_id: extension_id.clone(),
                    id: command.id,
                    label: command.label,
                    description: command.description,
                    skills: command.skills,
                },
            ));
            computer_use.extend(
                package
                    .manifest
                    .contributes
                    .computer_use
                    .iter()
                    .map(|item| ComputerUseContributionView {
                        extension_id: extension_id.clone(),
                        id: item.id.clone(),
                        label: item.label.clone(),
                        provider: item.provider.clone(),
                        toolchain_id: item.toolchain.clone(),
                        capabilities: item.capabilities.clone(),
                    }),
            );
            file_editors.extend(
                package
                    .manifest
                    .contributes
                    .file_editors
                    .iter()
                    .map(|editor| FileEditorContributionView {
                        extension_id: extension_id.clone(),
                        id: editor.id.clone(),
                        label: editor.label.clone(),
                        extensions: editor.extensions.clone(),
                        mode: match editor.mode {
                            FileEditorMode::ReadOnly => "read-only".to_owned(),
                            FileEditorMode::Editable => "editable".to_owned(),
                        },
                        thread_presentation: editor.thread_presentation.map(|presentation| {
                            match presentation {
                                ThreadFilePresentation::Link => "link".to_owned(),
                                ThreadFilePresentation::Card => "card".to_owned(),
                            }
                        }),
                        tag: editor.tag.clone(),
                        module_url: format!(
                            "{}/{}",
                            asset_prefix.as_deref().expect("File Editor has Web assets"),
                            editor.module
                        ),
                        style_url: editor.style.as_ref().map(|style| {
                            format!(
                                "{}/{style}",
                                asset_prefix.as_deref().expect("File Editor has Web assets")
                            )
                        }),
                    }),
            );
            for block in package.manifest.contributes.message_blocks {
                if !kinds.insert(block.kind.clone()) {
                    return Err(format!(
                        "duplicate extension Message Block kind: {}",
                        block.kind
                    ));
                }
                let ui_type = block.ui.as_ref().map(|ui| ui.kind().to_owned());
                let tag = block
                    .ui
                    .as_ref()
                    .and_then(extension_protocol::UiContribution::tag)
                    .map(str::to_owned)
                    .or(block.tag);
                message_blocks.push(MessageBlockContributionView {
                    ui_type,
                    extension_id: extension_id.clone(),
                    kind: block.kind,
                    tag,
                    module_url: block.module.map(|module| {
                        format!(
                            "{}/{module}",
                            asset_prefix
                                .as_deref()
                                .expect("Message Block has Web assets")
                        )
                    }),
                    style_url: block.style.map(|style| {
                        format!(
                            "{}/{style}",
                            asset_prefix
                                .as_deref()
                                .expect("Message Block has Web assets")
                        )
                    }),
                    host_renderer: block.host_renderer.map(|renderer| match renderer {
                        HostMessageBlockRenderer::ChannelSetup => "channel-setup".to_owned(),
                        HostMessageBlockRenderer::HumanHandoff => "human-handoff".to_owned(),
                    }),
                    capability: block.capability,
                });
            }
        }
        let host = ovule_extension_api::host::contributions();
        let owner = ovule_extension_api::host::OWNER;
        capabilities.extend(
            host.capabilities
                .into_iter()
                .map(|item| ExtensionCapabilityView {
                    extension_id: owner.to_owned(),
                    id: item.id,
                    label: item.label,
                    description: item.description,
                }),
        );
        computer_use.extend(host.computer_use.into_iter().map(|item| {
            ComputerUseContributionView {
                extension_id: owner.to_owned(),
                id: item.id,
                label: item.label,
                provider: item.provider,
                toolchain_id: item.toolchain,
                capabilities: item.capabilities,
            }
        }));
        message_blocks.extend(host.message_blocks.into_iter().map(|item| {
            MessageBlockContributionView {
                ui_type: None,
                extension_id: owner.to_owned(),
                kind: item.kind,
                capability: item.capability,
                tag: None,
                module_url: None,
                style_url: None,
                host_renderer: item.host_renderer.map(|renderer| match renderer {
                    HostMessageBlockRenderer::ChannelSetup => "channel-setup".to_owned(),
                    HostMessageBlockRenderer::HumanHandoff => "human-handoff".to_owned(),
                }),
            }
        }));
        Ok(ExtensionCatalogView {
            extensions: extension_packages,
            agents,
            models,
            capabilities,
            message_blocks,
            slash_commands,
            computer_use,
            file_editors,
        })
    }

    pub fn run_action(
        &self,
        extension_id: &str,
        action_id: &str,
        connection_id: Option<&str>,
        thread_id: Option<&str>,
    ) -> Result<ExtensionActionOutcome, String> {
        let resolved = crate::providers::resolve_extension_action(extension_id, action_id)
            .map_err(|error| error.to_string())?
            .ok_or_else(|| "unknown extension action".to_owned())?;
        if !matches!(
            resolved.contribution.handler,
            ExtensionActionHandler::ChannelStatus
                | ExtensionActionHandler::ChannelStatusRead
                | ExtensionActionHandler::ChannelRegistrationStart
                | ExtensionActionHandler::ChannelThreadBind
        ) {
            return self
                .connectivity
                .run(resolved.contribution.handler, connection_id);
        }
        let connection_id = connection_id.unwrap_or("default");
        let result = match resolved.contribution.handler {
            ExtensionActionHandler::ChannelStatusRead => self
                .channels
                .read_status(&resolved.contribution.target, connection_id)?,
            ExtensionActionHandler::ChannelStatus => self
                .channels
                .refresh(&resolved.contribution.target, connection_id)?,
            ExtensionActionHandler::ChannelRegistrationStart => self.channels.start_registration(
                &resolved.contribution.target,
                connection_id,
                resolved.contribution.reuse_existing,
            )?,
            ExtensionActionHandler::ChannelThreadBind => self.channels.bind_thread(
                &resolved.contribution.target,
                connection_id,
                thread_id.filter(|id| !id.is_empty()),
            )?,
            _ => unreachable!("connectivity actions are dispatched above"),
        };
        Ok(ExtensionActionOutcome {
            data_json: result.data_json,
            open_url: result.open_url,
        })
    }
}

pub trait Extensions: Send + Sync {
    fn run_action(
        &self,
        extension_id: &str,
        action_id: &str,
        connection_id: Option<&str>,
        thread_id: Option<&str>,
    ) -> Result<ExtensionActionOutcome, String>;
}

/// Typed identity consumed by shells and domain factories.
pub type ExtensionService = tuffite_ioc::Service<dyn Extensions>;

impl Extensions for NativeExtensionService {
    fn run_action(
        &self,
        extension_id: &str,
        action_id: &str,
        connection_id: Option<&str>,
        thread_id: Option<&str>,
    ) -> Result<ExtensionActionOutcome, String> {
        NativeExtensionService::run_action(self, extension_id, action_id, connection_id, thread_id)
    }
}
