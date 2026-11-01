use std::path::PathBuf;
use std::sync::Arc;

use crate::OllamaModelJobView;
use crate::secret_store::SecretStore;
use crate::state::AppSnapshot;
use crate::workspace::{WorkspaceEventSink, WorkspaceSession};
use ovule_toolchains::ToolchainView;

use super::{
    ExtensionSetupActionInput, OllamaModelCatalog, OnboardingInput, OnboardingStatus,
    SetupAgentCommands, SetupModels, SetupToolchains,
};

#[derive(Debug)]
pub enum SetupError {
    InvalidArgument(String),
    Persistence(String),
}

pub(super) struct NativeSetupService {
    pub(super) state: Arc<WorkspaceSession>,
    pub(super) events: Arc<dyn WorkspaceEventSink>,
    pub(super) agent_commands: Arc<dyn SetupAgentCommands>,
    pub(super) models: Arc<dyn SetupModels>,
    pub(super) toolchains: Arc<dyn SetupToolchains>,
    pub(super) secrets: Arc<dyn SecretStore>,
    pub(super) managed_toolchains: PathBuf,
}

impl NativeSetupService {
    #[must_use]
    pub fn new(
        state: Arc<WorkspaceSession>,
        events: Arc<dyn WorkspaceEventSink>,
        agent_commands: Arc<dyn SetupAgentCommands>,
        models: Arc<dyn SetupModels>,
        toolchains: Arc<dyn SetupToolchains>,
        secrets: Arc<dyn SecretStore>,
        managed_toolchains: PathBuf,
    ) -> Self {
        Self {
            state,
            events,
            agent_commands,
            models,
            toolchains,
            secrets,
            managed_toolchains,
        }
    }

    pub fn onboarding_status(&self) -> Result<OnboardingStatus, SetupError> {
        super::onboarding::get_onboarding_status(self)
    }

    pub fn toolchain_status(&self) -> Result<Vec<ToolchainView>, SetupError> {
        super::toolchains::get_toolchain_status(self)
    }

    pub fn install_toolchain(&self, id: &str) -> Result<Vec<ToolchainView>, SetupError> {
        super::toolchains::install_toolchain(self, id)
    }

    #[must_use]
    pub fn ollama_model_jobs(&self) -> Vec<OllamaModelJobView> {
        super::models::get_ollama_model_jobs(self)
    }

    #[must_use]
    pub fn ollama_models(&self) -> OllamaModelCatalog {
        super::models::get_ollama_models(self)
    }

    pub fn pull_ollama_model(&self, model: &str) -> Result<OllamaModelJobView, SetupError> {
        super::models::pull_ollama_model(self, model)
    }

    pub fn complete_onboarding(&self, input: &OnboardingInput) -> Result<AppSnapshot, SetupError> {
        super::onboarding::complete_onboarding(self, input)
    }

    pub fn run_extension_setup_action(
        &self,
        input: &ExtensionSetupActionInput,
    ) -> Result<OnboardingStatus, SetupError> {
        let authorization_url =
            super::extension_onboarding::run_extension_setup_action(self, input)?;
        let mut status = self.onboarding_status()?;
        status.authorization_url = authorization_url;
        Ok(status)
    }
}

pub trait Setup: Send + Sync {
    fn onboarding_status(&self) -> Result<OnboardingStatus, SetupError>;
    fn toolchain_status(&self) -> Result<Vec<ToolchainView>, SetupError>;
    fn install_toolchain(&self, id: &str) -> Result<Vec<ToolchainView>, SetupError>;
    fn ollama_model_jobs(&self) -> Vec<OllamaModelJobView>;
    fn ollama_models(&self) -> OllamaModelCatalog;
    fn pull_ollama_model(&self, model: &str) -> Result<OllamaModelJobView, SetupError>;
    fn complete_onboarding(&self, input: &OnboardingInput) -> Result<AppSnapshot, SetupError>;
    fn run_extension_setup_action(
        &self,
        input: &ExtensionSetupActionInput,
    ) -> Result<OnboardingStatus, SetupError>;
    fn install_extension(&self, source: &str) -> Result<AppSnapshot, SetupError>;
    fn clean_onboarding_state(&self) -> Result<OnboardingStatus, SetupError>;
    fn set_extension_enabled(
        &self,
        extension_id: &str,
        enabled: bool,
    ) -> Result<AppSnapshot, SetupError>;
    fn remove_extension(&self, extension_id: &str) -> Result<AppSnapshot, SetupError>;
}
pub type SetupService = tuffite_ioc::Service<dyn Setup>;
impl Setup for NativeSetupService {
    fn onboarding_status(&self) -> Result<OnboardingStatus, SetupError> {
        NativeSetupService::onboarding_status(self)
    }
    fn toolchain_status(&self) -> Result<Vec<ToolchainView>, SetupError> {
        NativeSetupService::toolchain_status(self)
    }
    fn install_toolchain(&self, id: &str) -> Result<Vec<ToolchainView>, SetupError> {
        NativeSetupService::install_toolchain(self, id)
    }
    fn ollama_model_jobs(&self) -> Vec<OllamaModelJobView> {
        NativeSetupService::ollama_model_jobs(self)
    }
    fn ollama_models(&self) -> OllamaModelCatalog {
        NativeSetupService::ollama_models(self)
    }
    fn pull_ollama_model(&self, model: &str) -> Result<OllamaModelJobView, SetupError> {
        NativeSetupService::pull_ollama_model(self, model)
    }
    fn complete_onboarding(&self, input: &OnboardingInput) -> Result<AppSnapshot, SetupError> {
        NativeSetupService::complete_onboarding(self, input)
    }
    fn run_extension_setup_action(
        &self,
        input: &ExtensionSetupActionInput,
    ) -> Result<OnboardingStatus, SetupError> {
        NativeSetupService::run_extension_setup_action(self, input)
    }
    fn install_extension(&self, source: &str) -> Result<AppSnapshot, SetupError> {
        NativeSetupService::install_extension(self, source)
    }
    fn clean_onboarding_state(&self) -> Result<OnboardingStatus, SetupError> {
        NativeSetupService::clean_onboarding_state(self)
    }
    fn set_extension_enabled(
        &self,
        extension_id: &str,
        enabled: bool,
    ) -> Result<AppSnapshot, SetupError> {
        NativeSetupService::set_extension_enabled(self, extension_id, enabled)
    }
    fn remove_extension(&self, extension_id: &str) -> Result<AppSnapshot, SetupError> {
        NativeSetupService::remove_extension(self, extension_id)
    }
}
