use super::*;
use std::path::{Path, PathBuf};
use std::sync::Arc;
#[derive(Debug)]
pub struct TestHost;
#[must_use]
pub fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .join("tests/fixtures")
}
impl SettingsSource for TestHost {
    fn contributions(&self) -> Result<ContributionSnapshot, String> {
        let mut result = ContributionSnapshot::default();
        for id in ["agent-codex", "agent-deepseek"] {
            let directory = root().join("extensions").join(id);
            let manifest: ovule_extension_api::ExtensionManifest = serde_json::from_str(
                &std::fs::read_to_string(directory.join("extension.json"))
                    .map_err(|e| e.to_string())?,
            )
            .map_err(|e| e.to_string())?;
            result
                .known_agents
                .extend(manifest.contributes.agents.clone());
            result
                .agents
                .extend(
                    manifest
                        .contributes
                        .agents
                        .into_iter()
                        .map(|contribution| Contribution {
                            extension_id: manifest.id.clone(),
                            extension_root: directory.clone(),
                            contribution,
                        }),
                );
            result
                .models
                .extend(
                    manifest
                        .contributes
                        .models
                        .into_iter()
                        .map(|contribution| Contribution {
                            extension_id: manifest.id.clone(),
                            extension_root: directory.clone(),
                            contribution,
                        }),
                );
            result
                .computer_use
                .extend(
                    manifest
                        .contributes
                        .computer_use
                        .into_iter()
                        .map(|contribution| Contribution {
                            extension_id: manifest.id.clone(),
                            extension_root: directory.clone(),
                            contribution,
                        }),
                );
        }
        Ok(result)
    }
    fn agent_health(&self, catalog: &Catalog, agent: &AgentProfile) -> (bool, String) {
        let missing = agent
            .tool_ids
            .iter()
            .filter_map(|id| catalog.tools.iter().find(|t| t.id == *id))
            .any(|tool| tool.required && (!tool.enabled || !self.tool_health(tool).0));
        (agent.driver == "test" && !missing, "Test host".into())
    }
    fn tool_health(&self, tool: &ToolRecord) -> (bool, String) {
        (
            tool.transport == "native-crd",
            if tool.transport == "native-crd" {
                "Native CRD Computer Use"
            } else {
                "Test tool unavailable"
            }
            .into(),
        )
    }
    fn supported_driver(&self, id: &str) -> bool {
        matches!(id, "ovule" | "codex" | "test")
    }
    fn tool_target(&self, tool: &ToolRecord) -> Option<PathBuf> {
        Some(PathBuf::from(&tool.target))
    }
    fn skill_source(&self, path: &Path) -> Result<String, String> {
        let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
        if bytes.len() > 1024 * 1024 {
            return Err("SKILL.md exceeds the 1 MiB import limit".into());
        }
        String::from_utf8(bytes).map_err(|e| e.to_string())
    }
    fn skill_path(&self, value: &str) -> Result<PathBuf, String> {
        let mut p = PathBuf::from(value.trim());
        if p.is_dir() {
            p.push("SKILL.md");
        }
        let p = std::fs::canonicalize(p).map_err(|e| e.to_string())?;
        if p.file_name().and_then(|v| v.to_str()) != Some("SKILL.md") {
            return Err("a Skill import must point to SKILL.md or its directory".into());
        }
        Ok(p)
    }
    fn bundled_skill_path(&self, id: &str) -> Result<PathBuf, String> {
        Ok(root().join("skills").join(id).join("SKILL.md"))
    }
}

#[must_use]
pub fn catalog() -> Catalog {
    let mut c = Catalog::default();
    c.attach_source(Arc::new(TestHost));
    c.reconcile_extensions().unwrap();
    c.tools.clear();
    c
}
