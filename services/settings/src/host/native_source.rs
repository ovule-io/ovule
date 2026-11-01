use crate::catalog::{
    AgentProfile, Catalog, Contribution, ContributionSnapshot, SettingsSource, ToolRecord,
};
use ovule_extensions::providers as packages;
use std::path::{Path, PathBuf};
#[derive(Debug)]
pub(crate) struct NativeSettingsSource;
impl SettingsSource for NativeSettingsSource {
    fn resolve_command(&self, id: &str) -> Result<Option<crate::catalog::CommandPlan>, String> {
        packages::resolve_extension_slash_command(id)
            .map_err(|e| e.to_string())?
            .map(|resolved| {
                Ok(crate::catalog::CommandPlan {
                    skill_paths: resolved.skill_paths().map_err(|e| e.to_string())?,
                    workflow: resolved
                        .workflow_instructions()
                        .map_err(|e| e.to_string())?,
                    fallback: resolved.fallback_json().map_err(|e| e.to_string())?,
                    extension_id: resolved.extension_id,
                    contribution: resolved.contribution,
                })
            })
            .transpose()
    }
    fn contributions(&self) -> Result<ContributionSnapshot, String> {
        let agents = packages::resolved_extension_agents()
            .map_err(|e| e.to_string())?
            .into_iter()
            .map(|v| Contribution {
                extension_id: v.extension_id,
                extension_root: v.package.root,
                contribution: v.contribution,
            })
            .collect();
        let models = packages::resolved_extension_models()
            .map_err(|e| e.to_string())?
            .into_iter()
            .map(|v| Contribution {
                extension_id: v.extension_id,
                extension_root: PathBuf::new(),
                contribution: v.contribution,
            })
            .collect();
        let skills = packages::resolved_extension_skills()
            .map_err(|e| e.to_string())?
            .into_iter()
            .map(|v| Contribution {
                extension_id: v.extension_id,
                extension_root: v.extension_root,
                contribution: v.contribution,
            })
            .collect();
        let computer_use = packages::resolved_extension_computer_use()
            .map_err(|e| e.to_string())?
            .into_iter()
            .map(|v| Contribution {
                extension_id: v.extension_id,
                extension_root: PathBuf::new(),
                contribution: v.contribution,
            })
            .collect();
        let known_agents =
            packages::known_extension_agent_contributions().map_err(|e| e.to_string())?;
        Ok(ContributionSnapshot {
            agents,
            models,
            skills,
            computer_use,
            known_agents,
        })
    }
    fn agent_health(&self, catalog: &Catalog, agent: &AgentProfile) -> (bool, String) {
        super::health::agent_health(catalog, agent)
    }
    fn tool_health(&self, tool: &ToolRecord) -> (bool, String) {
        super::health::tool_health(tool)
    }
    fn supported_driver(&self, id: &str) -> bool {
        super::health::is_supported_driver(id)
    }
    fn tool_target(&self, tool: &ToolRecord) -> Option<PathBuf> {
        super::health::resolved_tool_target(tool)
    }
    fn skill_source(&self, path: &Path) -> Result<String, String> {
        let size = std::fs::metadata(path).map_err(|e| e.to_string())?.len();
        if size > 1024 * 1024 {
            return Err("SKILL.md exceeds the 1 MiB import limit".into());
        }
        std::fs::read_to_string(path).map_err(|e| e.to_string())
    }
    fn bundled_skill_path(&self, id: &str) -> Result<PathBuf, String> {
        ovule_platform::resources::bundled_skill_path(id)
    }
    fn skill_path(&self, value: &str) -> Result<PathBuf, String> {
        let mut path = PathBuf::from(value.trim());
        if path.is_dir() {
            path.push("SKILL.md");
        }
        let path = std::fs::canonicalize(path).map_err(|e| e.to_string())?;
        if path.file_name().and_then(|v| v.to_str()) != Some("SKILL.md") {
            return Err("a Skill import must point to SKILL.md or its directory".into());
        }
        Ok(path)
    }
}
