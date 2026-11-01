use crate::state::settings::{
    AgentProfile, Catalog, Contribution, ContributionSnapshot, SettingsSource, ToolRecord,
};
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
impl crate::state::paths::WorkspacePaths for TestHost {
    fn home_directory(&self) -> Result<PathBuf, String> {
        std::env::var_os("HOME")
            .or_else(|| std::env::var_os("USERPROFILE"))
            .filter(|v| !v.is_empty())
            .map(PathBuf::from)
            .ok_or_else(|| "Terminal HOME directory is unavailable".into())
    }
    fn canonicalize(&self, path: &Path) -> Result<PathBuf, String> {
        std::fs::canonicalize(path).map_err(|e| e.to_string())
    }
    fn is_directory(&self, path: &Path) -> bool {
        path.is_dir()
    }
    fn is_file(&self, path: &Path) -> bool {
        path.is_file()
    }
    fn exists(&self, path: &Path) -> bool {
        path.exists()
    }
    fn entries(&self, path: &Path) -> Result<Vec<PathBuf>, String> {
        std::fs::read_dir(path)
            .map_err(|e| e.to_string())?
            .map(|e| e.map(|e| e.path()).map_err(|e| e.to_string()))
            .collect()
    }
}
/// # Panics
/// Panics if the test fixture or native contribution packages are invalid.
#[must_use]
pub fn catalog() -> Catalog {
    let mut c = Catalog::default();
    c.attach_source(Arc::new(TestHost));
    c.reconcile_extensions().unwrap();
    c.tools.clear();
    c
}
/// # Panics
/// Panics if the test fixture or native contribution packages are invalid.
#[must_use]
pub fn workspace() -> crate::state::Workspace {
    let mut w = crate::state::Workspace::default();
    attach(&mut w);
    w.reconcile_extensions().unwrap();
    w
}
pub fn attach(w: &mut crate::state::Workspace) {
    w.attach_paths(Arc::new(TestHost));
    w.attach_settings(Arc::new(TestHost));
}

/// Real package discovery with deterministic filesystem operations for adapter/persistence tests.
/// # Panics
/// Panics if the test fixture or native contribution packages are invalid.
#[must_use]
pub fn native_workspace() -> crate::state::Workspace {
    let mut workspace = crate::state::Workspace::default();
    workspace.attach_paths(std::sync::Arc::new(TestHost));
    workspace.attach_settings(ovule_settings::providers::source());
    workspace.reconcile_extensions().unwrap();
    workspace
}
