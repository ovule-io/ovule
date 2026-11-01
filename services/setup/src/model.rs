use crate::settings::AgentView;
use ovule_toolchains::ToolchainView;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct IntegrationStatus {
    pub id: String,
    pub available: bool,
    pub authenticated: bool,
    pub detail: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OnboardingAgentInput {
    pub id: String,
    pub label: String,
    pub driver: String,
    pub model_id: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OnboardingInput {
    pub thread_id: Option<String>,
    pub agents: Vec<OnboardingAgentInput>,
    pub default_agent_id: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OnboardingModelOption {
    pub id: String,
    pub label: String,
    pub provider: String,
    pub remote_id: String,
    pub available: bool,
    pub recommended: bool,
    pub detail: String,
    pub agent_id: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OnboardingStatus {
    pub authorization_url: Option<String>,
    pub agents: Vec<AgentView>,
    pub models: Vec<OnboardingModelOption>,
    pub toolchains: Vec<ToolchainView>,
    pub setups: Vec<ExtensionOnboardingView>,
    pub default_agent_id: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ExtensionOnboardingView {
    pub tag: Option<String>,
    pub extension_id: String,
    pub id: String,
    pub label: String,
    pub description: String,
    pub icon: String,
    pub agent_ids: Vec<String>,
    pub model_provider: Option<String>,
    pub input_fields: Vec<String>,
    pub actions: Vec<ExtensionOnboardingActionView>,
    pub allowed_links: Vec<String>,
    pub status: IntegrationStatus,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ExtensionOnboardingActionView {
    pub requires_authentication: bool,

    pub id: String,
    pub required_toolchains: Vec<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ExtensionSetupActionInput {
    pub extension_id: String,
    pub setup_id: String,
    pub action_id: String,
    pub values: Vec<ExtensionSetupValue>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ExtensionSetupValue {
    pub id: String,
    pub value: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OllamaModelCatalog {
    pub models: Vec<OnboardingModelOption>,
    pub jobs: Vec<OllamaModelJobView>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OllamaModelJobView {
    pub model: String,
    pub status: String,
    pub detail: String,
    pub error: Option<String>,
}
