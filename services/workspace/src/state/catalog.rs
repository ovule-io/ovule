use super::settings::Catalog;
use serde::{Deserialize, Serialize};

/// Persisted state owned by the catalog capability.
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub(super) struct SettingsState {
    #[serde(default)]
    pub(super) catalog: Catalog,
    #[serde(default)]
    pub(super) default_agent_id: Option<String>,
    #[serde(default)]
    pub(super) default_model_id: Option<String>,
}

use super::{AppSnapshot, NodeKind, Workspace};

impl Workspace {
    pub fn clean_legacy_data(&mut self) -> Result<AppSnapshot, String> {
        if !self.settings.catalog.clean_legacy_data() {
            return Ok(self.snapshot());
        }
        self.settings.catalog.reconcile_extensions()?;
        self.changed();
        Ok(self.snapshot())
    }

    pub fn clean_onboarding_state(&mut self) -> Result<AppSnapshot, String> {
        let removed_agents = self
            .settings
            .catalog
            .clean_unavailable_extension_drivers()?;
        self.repair_removed_agents(&removed_agents);
        self.changed();
        Ok(self.snapshot())
    }

    fn repair_removed_agents(&mut self, removed_agents: &std::collections::HashSet<String>) {
        let fallback = self.settings.catalog.default_agent_id();
        if self
            .settings
            .default_agent_id
            .as_deref()
            .is_some_and(|id| removed_agents.contains(id))
        {
            self.settings.default_agent_id = Some(fallback.clone());
            self.settings.default_model_id = None;
        }
        for thread in &mut self.conversation.threads {
            if removed_agents.contains(&thread.agent) {
                thread.agent.clone_from(&fallback);
                thread.model_id = None;
            }
        }
        for node in &mut self.workflow.nodes {
            if let NodeKind::Task { agent } = &mut node.kind
                && removed_agents.contains(agent)
            {
                agent.clone_from(&fallback);
            }
        }
    }

    pub fn import_skill(&mut self, path: &str, enabled: bool) -> Result<AppSnapshot, String> {
        self.settings.catalog.import_skill(path, enabled)?;
        self.changed();
        Ok(self.snapshot())
    }

    pub fn import_extension_skill(
        &mut self,
        path: &str,
        enabled: bool,
        extension_id: &str,
    ) -> Result<AppSnapshot, String> {
        self.settings
            .catalog
            .import_extension_skill(path, enabled, extension_id)?;
        self.changed();
        Ok(self.snapshot())
    }

    pub fn set_skill_enabled(
        &mut self,
        skill_id: &str,
        enabled: bool,
    ) -> Result<AppSnapshot, String> {
        self.settings.catalog.set_skill_enabled(skill_id, enabled)?;
        self.changed();
        Ok(self.snapshot())
    }

    pub fn remove_skill(&mut self, skill_id: &str) -> Result<AppSnapshot, String> {
        self.settings.catalog.remove_skill(skill_id)?;
        self.changed();
        Ok(self.snapshot())
    }

    #[allow(clippy::too_many_arguments)]
    pub fn upsert_tool(
        &mut self,
        tool_id: &str,
        label: &str,
        transport: &str,
        target: &str,
        args: Vec<String>,
        enabled: bool,
        required: bool,
        credential_env: Option<String>,
    ) -> Result<AppSnapshot, String> {
        self.settings.catalog.upsert_tool(
            tool_id,
            label,
            transport,
            target,
            args,
            enabled,
            required,
            credential_env,
        )?;
        self.changed();
        Ok(self.snapshot())
    }

    pub fn remove_tool(&mut self, tool_id: &str) -> Result<AppSnapshot, String> {
        self.settings.catalog.remove_tool(tool_id)?;
        self.changed();
        Ok(self.snapshot())
    }

    pub fn upsert_model(
        &mut self,
        model_id: &str,
        label: &str,
        provider: &str,
        remote_id: &str,
        enabled: bool,
        agent_ids: Vec<String>,
    ) -> Result<AppSnapshot, String> {
        self.settings
            .catalog
            .upsert_model(model_id, label, provider, remote_id, enabled, agent_ids)?;
        self.changed();
        Ok(self.snapshot())
    }

    pub fn remove_model(&mut self, model_id: &str) -> Result<AppSnapshot, String> {
        self.settings.catalog.remove_model(model_id)?;
        self.changed();
        Ok(self.snapshot())
    }

    #[allow(clippy::too_many_arguments)]
    pub fn upsert_agent(
        &mut self,
        agent_id: &str,
        label: &str,
        driver: &str,
        model_id: Option<String>,
        skill_ids: Vec<String>,
        tool_ids: Vec<String>,
        instructions: &str,
        enabled: bool,
    ) -> Result<AppSnapshot, String> {
        self.settings.catalog.upsert_agent(
            agent_id,
            label,
            driver,
            model_id,
            skill_ids,
            tool_ids,
            instructions,
            enabled,
        )?;
        self.changed();
        Ok(self.snapshot())
    }

    pub fn remove_agent(&mut self, agent_id: &str) -> Result<AppSnapshot, String> {
        if self
            .conversation
            .threads
            .iter()
            .any(|thread| thread.agent == agent_id)
            || self
                .workflow
                .nodes
                .iter()
                .any(|node| matches!(&node.kind, NodeKind::Task { agent } if agent == agent_id))
        {
            return Err(format!(
                "Agent is still referenced by a Thread or Task: {agent_id}"
            ));
        }
        self.settings.catalog.remove_agent(agent_id)?;
        self.changed();
        Ok(self.snapshot())
    }

    pub fn reconcile_extensions(&mut self) -> Result<bool, String> {
        let mut changed = self.settings.catalog.reconcile_extensions()?;
        let removed_agents = self.settings.catalog.prune_missing_extension_agents()?;
        if !removed_agents.is_empty() {
            self.repair_removed_agents(&removed_agents);
            changed = true;
        }
        if changed {
            self.changed();
            Ok(true)
        } else {
            Ok(false)
        }
    }
}

impl super::Workspace {
    pub fn enabled_skill_path(&self, id: &str) -> Result<String, String> {
        self.settings.catalog.enabled_skill_path(id)
    }

    pub fn bundled_skill_path(&self, id: &str) -> Result<std::path::PathBuf, String> {
        self.settings.catalog.bundled_skill_path(id)
    }
}

impl super::Workspace {
    pub fn resolve_command(
        &self,
        id: &str,
    ) -> Result<Option<ovule_settings::catalog::CommandPlan>, String> {
        self.settings.catalog.resolve_command(id)
    }
}
