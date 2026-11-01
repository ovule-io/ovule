use std::ffi::OsStr;
use std::path::Path;

use crate::OllamaModelJobView;
use ovule_toolchains::ToolchainView;

pub trait SetupAgentCommands: Send + Sync {
    fn probe_executable(&self, executable: &Path, args: &[&str]) -> Result<String, String>;

    fn run_authorization(
        &self,
        executable: &Path,
        args: &[&str],
        stdin: Option<String>,
        path: Option<&OsStr>,
    ) -> Result<String, String>;

    fn launch_authorization(
        &self,
        executable: &Path,
        args: &[&str],
        path: Option<&OsStr>,
        protocol: ovule_extensions::protocol::AuthorizationProtocol,
    ) -> Result<Option<String>, String>;
}

pub trait SetupModels: Send + Sync {
    fn discover_models(&self) -> Result<Vec<String>, String>;
    fn jobs(&self) -> Vec<OllamaModelJobView>;
    fn start_pull(&self, model: &str) -> Result<OllamaModelJobView, String>;
}

pub trait SetupToolchains: Send + Sync {
    fn status(&self) -> Result<Vec<ToolchainView>, String>;
    fn onboarding_status(&self) -> Result<Vec<ToolchainView>, String>;
    fn start_install(&self, id: &str) -> Result<Vec<ToolchainView>, String>;
}
