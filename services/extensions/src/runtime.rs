use crate::protocol::{AgentContribution, SpawnPlan, ValidatedExtensionPackage};
use serde_json::Value;

#[derive(Clone, Debug, serde::Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ModelProviderPlan {
    pub provider: String,
    pub api_base: String,
    pub credential_reference: String,
    pub model: String,
}

/// Consumer port for executing validated extension hooks.
pub trait ExtensionAgentRuntime: Send + Sync {
    fn prepare_agent(
        &self,
        package: &ValidatedExtensionPackage,
        agent: &AgentContribution,
        input: Value,
    ) -> Result<SpawnPlan, String>;
    fn prepare_model_provider(
        &self,
        package: &ValidatedExtensionPackage,
        provider: &str,
        input: Value,
    ) -> Result<ModelProviderPlan, String>;
}

/// Module plan authorized by the extension host before a channel worker is launched.
pub struct ResolvedChannelWorker {
    pub module: std::path::PathBuf,
    pub executable_candidates: Vec<String>,
    pub toolchain: Option<String>,
}

/// Extension execution port for consumers that launch channel workers.
pub trait ExtensionWorkerRuntime: Send + Sync {
    fn prepare_channel_worker(&self, channel_type: &str) -> Result<ResolvedChannelWorker, String>;
}
