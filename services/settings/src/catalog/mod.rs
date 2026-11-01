//! Settings catalog rules, contribution DTOs, and discovery port.
mod model;
mod source;
pub use model::{
    AgentProfile, AgentView, Catalog, ModelRecord, ModelView, ResolvedAgent, SkillRecord,
    SkillView, ToolRecord, ToolView, validate_http_url,
};
use source::empty_source;
pub use source::{Contribution, ContributionSnapshot, SettingsSource};
#[derive(Clone, Debug)]
pub struct CommandPlan {
    pub extension_id: String,
    pub contribution: ovule_extension_api::SlashCommandContribution,
    pub skill_paths: Vec<(String, std::path::PathBuf)>,
    pub workflow: String,
    pub fallback: String,
}

#[cfg(test)]
mod test_support;
