//! Consumer settings commands, parameterized by the composition snapshot DTO.
#[derive(Debug)]
pub enum SettingsError {
    InvalidArgument(String),
    Persistence(String),
}

pub trait Settings<Snapshot>: Send + Sync {
    fn clean_legacy_data(&self) -> Result<Snapshot, SettingsError>;
    fn import_skill(&self, path: &str, enabled: bool) -> Result<Snapshot, SettingsError>;
    fn install_bundled_skill(&self, skill_id: &str) -> Result<Snapshot, SettingsError>;
    fn set_skill_enabled(&self, skill_id: &str, enabled: bool) -> Result<Snapshot, SettingsError>;
    fn remove_skill(&self, skill_id: &str) -> Result<Snapshot, SettingsError>;
    #[allow(clippy::too_many_arguments)]
    fn upsert_tool(
        &self,
        id: &str,
        label: &str,
        transport: &str,
        target: &str,
        args: Vec<String>,
        enabled: bool,
        required: bool,
        credential_env: Option<String>,
    ) -> Result<Snapshot, SettingsError>;
    fn remove_tool(&self, tool_id: &str) -> Result<Snapshot, SettingsError>;
    fn upsert_model(
        &self,
        id: &str,
        label: &str,
        provider: &str,
        remote_id: &str,
        enabled: bool,
        agent_ids: Vec<String>,
    ) -> Result<Snapshot, SettingsError>;
    fn remove_model(&self, model_id: &str) -> Result<Snapshot, SettingsError>;
    #[allow(clippy::too_many_arguments)]
    fn upsert_agent(
        &self,
        id: &str,
        label: &str,
        driver: &str,
        model_id: Option<String>,
        skill_ids: Vec<String>,
        tool_ids: Vec<String>,
        instructions: &str,
        enabled: bool,
    ) -> Result<Snapshot, SettingsError>;
    fn remove_agent(&self, agent_id: &str) -> Result<Snapshot, SettingsError>;
}
pub type SettingsService<Snapshot> = tuffite_ioc::Service<dyn Settings<Snapshot>>;
