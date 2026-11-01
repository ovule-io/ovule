use tuffite::CommandError;

use crate::runtime::App;
use crate::shell_api::{
    AppSnapshot, ExtensionSetupActionInput, OllamaModelCatalog, OllamaModelJobView,
    OnboardingInput, OnboardingStatus, ToolchainView,
};
use ovule_setup::SetupError;

use super::mapper;

fn map_setup_error(error: SetupError) -> CommandError {
    match error {
        SetupError::InvalidArgument(message) => CommandError::InvalidArgument(message),
        SetupError::Persistence(message) => CommandError::Failed(message),
    }
}

impl crate::shell_api::Setup for App {
    fn onboarding_status(&self) -> Result<OnboardingStatus, CommandError> {
        self.service::<ovule_setup::SetupService>()?
            .onboarding_status()
            .map(mapper::onboarding_status)
            .map_err(map_setup_error)
    }

    fn toolchain_status(&self) -> Result<Vec<ToolchainView>, CommandError> {
        self.service::<ovule_setup::SetupService>()?
            .toolchain_status()
            .map(mapper::toolchains)
            .map_err(map_setup_error)
    }

    fn install_toolchain(&self, toolchain_id: String) -> Result<Vec<ToolchainView>, CommandError> {
        self.service::<ovule_setup::SetupService>()?
            .install_toolchain(&toolchain_id)
            .map(mapper::toolchains)
            .map_err(map_setup_error)
    }

    fn ollama_model_jobs(&self) -> Result<Vec<OllamaModelJobView>, CommandError> {
        Ok(mapper::ollama_jobs(
            self.service::<ovule_setup::SetupService>()?
                .ollama_model_jobs(),
        ))
    }

    fn ollama_models(&self) -> Result<OllamaModelCatalog, CommandError> {
        Ok(mapper::ollama_catalog(
            self.service::<ovule_setup::SetupService>()?.ollama_models(),
        ))
    }

    fn pull_ollama_model(&self, model: String) -> Result<OllamaModelJobView, CommandError> {
        self.service::<ovule_setup::SetupService>()?
            .pull_ollama_model(&model)
            .map(mapper::ollama_job)
            .map_err(map_setup_error)
    }

    fn complete_onboarding(&self, input: OnboardingInput) -> Result<AppSnapshot, CommandError> {
        let input = mapper::onboarding_input(input);
        self.service::<ovule_setup::SetupService>()?
            .complete_onboarding(&input)
            .map(mapper::snapshot)
            .map_err(map_setup_error)
    }

    fn run_extension_setup_action(
        &self,
        input: ExtensionSetupActionInput,
    ) -> Result<OnboardingStatus, CommandError> {
        let input = mapper::extension_setup_action_input(input);
        self.service::<ovule_setup::SetupService>()?
            .run_extension_setup_action(&input)
            .map(mapper::onboarding_status)
            .map_err(map_setup_error)
    }

    fn install_extension(&self, path: String) -> Result<AppSnapshot, CommandError> {
        self.service::<ovule_setup::SetupService>()?
            .install_extension(&path)
            .map(mapper::snapshot)
            .map_err(map_setup_error)
    }

    fn clean_onboarding_state(&self) -> Result<OnboardingStatus, CommandError> {
        self.service::<ovule_setup::SetupService>()?
            .clean_onboarding_state()
            .map(mapper::onboarding_status)
            .map_err(map_setup_error)
    }

    fn set_extension_enabled(
        &self,
        extension_id: String,
        enabled: bool,
    ) -> Result<AppSnapshot, CommandError> {
        self.service::<ovule_setup::SetupService>()?
            .set_extension_enabled(&extension_id, enabled)
            .map(mapper::snapshot)
            .map_err(map_setup_error)
    }

    fn remove_extension(&self, extension_id: String) -> Result<AppSnapshot, CommandError> {
        self.service::<ovule_setup::SetupService>()?
            .remove_extension(&extension_id)
            .map(mapper::snapshot)
            .map_err(map_setup_error)
    }
}
