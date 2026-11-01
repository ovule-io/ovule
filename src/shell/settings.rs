use tuffite::CommandError;

use crate::runtime::App;
use crate::shell_api::{AgentInput, AppSnapshot, ModelInput, ToolInput};
use ovule_settings::SettingsError;

use super::mapper;

fn map_catalog_error(error: SettingsError) -> CommandError {
    match error {
        SettingsError::InvalidArgument(message) => CommandError::InvalidArgument(message),
        SettingsError::Persistence(message) => CommandError::Failed(message),
    }
}

impl crate::shell_api::Settings for App {
    fn open_system_url(&self, url: String) -> Result<bool, CommandError> {
        if !(url.starts_with("https://") || url.starts_with("http://"))
            || url.chars().any(char::is_control)
        {
            return Err(CommandError::InvalidArgument(
                "Expected an HTTP(S) URL".into(),
            ));
        }
        #[cfg(target_os = "macos")]
        let mut command = std::process::Command::new("open");
        #[cfg(target_os = "windows")]
        let mut command = std::process::Command::new("explorer.exe");
        let status = command
            .arg(url)
            .status()
            .map_err(|error| CommandError::Failed(format!("Open system browser: {error}")))?;
        if status.success() {
            Ok(true)
        } else {
            Err(CommandError::Failed(format!(
                "System browser launcher exited with {status}"
            )))
        }
    }

    fn clean_legacy_data(&self) -> Result<AppSnapshot, CommandError> {
        self.service::<ovule_settings::SettingsService<ovule_workspace::state::AppSnapshot>>()?
            .clean_legacy_data()
            .map(mapper::snapshot)
            .map_err(map_catalog_error)
    }

    fn import_skill(&self, path: String, enabled: bool) -> Result<AppSnapshot, CommandError> {
        self.service::<ovule_settings::SettingsService<ovule_workspace::state::AppSnapshot>>()?
            .import_skill(&path, enabled)
            .map(mapper::snapshot)
            .map_err(map_catalog_error)
    }

    fn install_bundled_skill(&self, skill_id: String) -> Result<AppSnapshot, CommandError> {
        self.service::<ovule_settings::SettingsService<ovule_workspace::state::AppSnapshot>>()?
            .install_bundled_skill(&skill_id)
            .map(mapper::snapshot)
            .map_err(map_catalog_error)
    }

    fn set_skill_enabled(
        &self,
        skill_id: String,
        enabled: bool,
    ) -> Result<AppSnapshot, CommandError> {
        self.service::<ovule_settings::SettingsService<ovule_workspace::state::AppSnapshot>>()?
            .set_skill_enabled(&skill_id, enabled)
            .map(mapper::snapshot)
            .map_err(map_catalog_error)
    }

    fn remove_skill(&self, skill_id: String) -> Result<AppSnapshot, CommandError> {
        self.service::<ovule_settings::SettingsService<ovule_workspace::state::AppSnapshot>>()?
            .remove_skill(&skill_id)
            .map(mapper::snapshot)
            .map_err(map_catalog_error)
    }

    fn upsert_tool(&self, input: ToolInput) -> Result<AppSnapshot, CommandError> {
        self.service::<ovule_settings::SettingsService<ovule_workspace::state::AppSnapshot>>()?
            .upsert_tool(
                &input.id,
                &input.label,
                &input.transport,
                &input.target,
                input.args,
                input.enabled,
                input.required,
                input.credential_env,
            )
            .map(mapper::snapshot)
            .map_err(map_catalog_error)
    }

    fn remove_tool(&self, tool_id: String) -> Result<AppSnapshot, CommandError> {
        self.service::<ovule_settings::SettingsService<ovule_workspace::state::AppSnapshot>>()?
            .remove_tool(&tool_id)
            .map(mapper::snapshot)
            .map_err(map_catalog_error)
    }

    fn upsert_model(&self, input: ModelInput) -> Result<AppSnapshot, CommandError> {
        self.service::<ovule_settings::SettingsService<ovule_workspace::state::AppSnapshot>>()?
            .upsert_model(
                &input.id,
                &input.label,
                &input.provider,
                &input.remote_id,
                input.enabled,
                input.agent_ids,
            )
            .map(mapper::snapshot)
            .map_err(map_catalog_error)
    }

    fn remove_model(&self, model_id: String) -> Result<AppSnapshot, CommandError> {
        self.service::<ovule_settings::SettingsService<ovule_workspace::state::AppSnapshot>>()?
            .remove_model(&model_id)
            .map(mapper::snapshot)
            .map_err(map_catalog_error)
    }

    fn upsert_agent(&self, input: AgentInput) -> Result<AppSnapshot, CommandError> {
        self.service::<ovule_settings::SettingsService<ovule_workspace::state::AppSnapshot>>()?
            .upsert_agent(
                &input.id,
                &input.label,
                &input.driver,
                input.model_id,
                input.skill_ids,
                input.tool_ids,
                &input.instructions,
                input.enabled,
            )
            .map(mapper::snapshot)
            .map_err(map_catalog_error)
    }

    fn remove_agent(&self, agent_id: String) -> Result<AppSnapshot, CommandError> {
        self.service::<ovule_settings::SettingsService<ovule_workspace::state::AppSnapshot>>()?
            .remove_agent(&agent_id)
            .map(mapper::snapshot)
            .map_err(map_catalog_error)
    }
}
