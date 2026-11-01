#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AgentContributionView {
    pub extension_id: String,
    pub id: String,
    pub label: String,
    pub executable_candidates: Vec<String>,
    pub mcp_config: bool,
    pub required_environment: Vec<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ModelContributionView {
    pub extension_id: String,
    pub id: String,
    pub label: String,
    pub provider: String,
    pub remote_id: String,
    pub agent_ids: Vec<String>,
    pub recommended: bool,
    pub description: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ExtensionCapabilityView {
    pub extension_id: String,
    pub id: String,
    pub label: String,
    pub description: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MessageBlockContributionView {
    pub ui_type: Option<String>,
    pub extension_id: String,
    pub kind: String,
    pub tag: Option<String>,
    pub module_url: Option<String>,
    pub style_url: Option<String>,
    pub host_renderer: Option<String>,
    pub capability: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SlashCommandContributionView {
    pub extension_id: String,
    pub id: String,
    pub label: String,
    pub description: String,
    pub skills: Vec<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ComputerUseContributionView {
    pub extension_id: String,
    pub id: String,
    pub label: String,
    pub provider: String,
    pub toolchain_id: Option<String>,
    pub capabilities: Vec<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FileEditorContributionView {
    pub extension_id: String,
    pub id: String,
    pub label: String,
    pub extensions: Vec<String>,
    pub mode: String,
    pub thread_presentation: Option<String>,
    pub tag: String,
    pub module_url: String,
    pub style_url: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ExtensionCatalogView {
    pub extensions: Vec<ExtensionPackageView>,
    pub agents: Vec<AgentContributionView>,
    pub models: Vec<ModelContributionView>,
    pub capabilities: Vec<ExtensionCapabilityView>,
    pub message_blocks: Vec<MessageBlockContributionView>,
    pub slash_commands: Vec<SlashCommandContributionView>,
    pub computer_use: Vec<ComputerUseContributionView>,
    pub file_editors: Vec<FileEditorContributionView>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ExtensionPackageView {
    pub install_path: String,
    pub id: String,
    pub version: String,
    pub source: String,
    pub enabled: bool,
    pub removable: bool,
}
