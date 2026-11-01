use super::{AgentProfile, ToolRecord};
use ovule_extension_api::{
    AgentContribution, ComputerUseContribution, ExtensionSkillContribution, ModelContribution,
};
use std::path::{Path, PathBuf};
use std::sync::Arc;
#[derive(Clone, Debug)]
pub struct Contribution<T> {
    pub extension_id: String,
    pub extension_root: PathBuf,
    pub contribution: T,
}
#[derive(Clone, Debug, Default)]
pub struct ContributionSnapshot {
    pub agents: Vec<Contribution<AgentContribution>>,
    pub models: Vec<Contribution<ModelContribution>>,
    pub skills: Vec<Contribution<ExtensionSkillContribution>>,
    pub computer_use: Vec<Contribution<ComputerUseContribution>>,
    pub known_agents: Vec<AgentContribution>,
}
/// Consumer-owned settings discovery. Bootstrap selects the host implementation.
pub trait SettingsSource: Send + Sync + std::fmt::Debug {
    fn resolve_command(&self, _id: &str) -> Result<Option<crate::catalog::CommandPlan>, String> {
        Ok(None)
    }
    fn contributions(&self) -> Result<ContributionSnapshot, String>;
    fn agent_health(&self, catalog: &super::Catalog, agent: &AgentProfile) -> (bool, String);
    fn tool_health(&self, tool: &ToolRecord) -> (bool, String);
    fn supported_driver(&self, id: &str) -> bool;
    fn tool_target(&self, tool: &ToolRecord) -> Option<PathBuf>;
    fn skill_source(&self, path: &Path) -> Result<String, String>;
    fn bundled_skill_path(&self, _id: &str) -> Result<PathBuf, String> {
        Err("bundled Skill source is unavailable".into())
    }
    fn skill_path(&self, value: &str) -> Result<PathBuf, String>;
}
#[derive(Debug)]
struct EmptySource;
impl SettingsSource for EmptySource {
    fn contributions(&self) -> Result<ContributionSnapshot, String> {
        Ok(ContributionSnapshot::default())
    }
    fn agent_health(&self, _: &super::Catalog, _agent: &AgentProfile) -> (bool, String) {
        (false, "No host provider attached".into())
    }
    fn tool_health(&self, _: &ToolRecord) -> (bool, String) {
        (false, "No host provider attached".into())
    }
    fn supported_driver(&self, id: &str) -> bool {
        id == "ovule"
    }
    fn tool_target(&self, _: &ToolRecord) -> Option<PathBuf> {
        None
    }
    fn skill_source(&self, _: &Path) -> Result<String, String> {
        Err("No skill source attached".into())
    }
    fn skill_path(&self, _: &str) -> Result<PathBuf, String> {
        Err("No skill source attached".into())
    }
}
#[must_use]
pub fn empty_source() -> Arc<dyn SettingsSource> {
    Arc::new(EmptySource)
}
