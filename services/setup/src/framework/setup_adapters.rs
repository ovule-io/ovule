use super::ollama::OllamaHandle;
use super::toolchain_jobs::ToolchainJobs;
use ovule_toolchains::ToolchainView;

use crate::{OllamaModelJobView, SetupModels, SetupToolchains};

impl SetupModels for OllamaHandle {
    fn discover_models(&self) -> Result<Vec<String>, String> {
        OllamaHandle::discover_models(self)
    }

    fn jobs(&self) -> Vec<OllamaModelJobView> {
        OllamaHandle::jobs(self)
    }

    fn start_pull(&self, model: &str) -> Result<OllamaModelJobView, String> {
        OllamaHandle::start_pull(self, model)
    }
}

impl SetupToolchains for ToolchainJobs {
    fn status(&self) -> Result<Vec<ToolchainView>, String> {
        ToolchainJobs::status(self)
    }

    fn onboarding_status(&self) -> Result<Vec<ToolchainView>, String> {
        ToolchainJobs::onboarding_status(self)
    }

    fn start_install(&self, id: &str) -> Result<Vec<ToolchainView>, String> {
        ToolchainJobs::start_install(self, id)
    }
}
