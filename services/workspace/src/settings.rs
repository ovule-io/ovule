use std::sync::Arc;

use crate::state::AppSnapshot;
use crate::{MutationError, WorkspaceEventSink, WorkspaceSession};
use ovule_settings::{Settings, SettingsError};

pub(super) struct NativeSettingsService {
    state: Arc<WorkspaceSession>,
    events: Arc<dyn WorkspaceEventSink>,
}

impl NativeSettingsService {
    pub fn clean_legacy_data(&self) -> Result<AppSnapshot, SettingsError> {
        self.change(
            "settings/legacy-data-cleaned",
            None,
            &serde_json::json!({"issue": "retired-trycua-computer-use"}),
            crate::state::Workspace::clean_legacy_data,
        )
    }

    #[must_use]
    pub fn new(state: Arc<WorkspaceSession>, events: Arc<dyn WorkspaceEventSink>) -> Self {
        Self { state, events }
    }

    pub fn import_skill(&self, path: &str, enabled: bool) -> Result<AppSnapshot, SettingsError> {
        self.change(
            "settings/skill-imported",
            None,
            &serde_json::json!({"path": path, "enabled": enabled}),
            |workspace| workspace.import_skill(path, enabled),
        )
    }

    pub fn install_bundled_skill(&self, skill_id: &str) -> Result<AppSnapshot, SettingsError> {
        if skill_id != "onboarding" {
            return Err(SettingsError::InvalidArgument(format!(
                "unknown bundled Skill: {skill_id}"
            )));
        }
        let skill = self
            .state
            .read(|workspace| workspace.bundled_skill_path(skill_id))
            .map_err(SettingsError::Persistence)?;
        self.change(
            "settings/bundled-skill-installed",
            Some(skill_id),
            &serde_json::json!({"path": skill}),
            |workspace| workspace.import_skill(&skill.to_string_lossy(), true),
        )
    }

    pub fn set_skill_enabled(
        &self,
        skill_id: &str,
        enabled: bool,
    ) -> Result<AppSnapshot, SettingsError> {
        self.change(
            "settings/skill-enabled",
            Some(skill_id),
            &serde_json::json!({"enabled": enabled}),
            |workspace| workspace.set_skill_enabled(skill_id, enabled),
        )
    }

    pub fn remove_skill(&self, skill_id: &str) -> Result<AppSnapshot, SettingsError> {
        self.change(
            "settings/skill-removed",
            Some(skill_id),
            &serde_json::json!({}),
            |workspace| workspace.remove_skill(skill_id),
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn upsert_tool(
        &self,
        id: &str,
        label: &str,
        transport: &str,
        target: &str,
        args: Vec<String>,
        enabled: bool,
        required: bool,
        credential_env: Option<String>,
    ) -> Result<AppSnapshot, SettingsError> {
        self.change(
            "settings/tool-upserted",
            Some(id),
            &serde_json::json!({"transport": transport, "target": target, "enabled": enabled, "required": required, "credential_env": credential_env}),
            |workspace| {
                workspace.upsert_tool(
                    id,
                    label,
                    transport,
                    target,
                    args,
                    enabled,
                    required,
                    credential_env,
                )
            },
        )
    }

    pub fn remove_tool(&self, tool_id: &str) -> Result<AppSnapshot, SettingsError> {
        self.change(
            "settings/tool-removed",
            Some(tool_id),
            &serde_json::json!({}),
            |workspace| workspace.remove_tool(tool_id),
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn upsert_model(
        &self,
        id: &str,
        label: &str,
        provider: &str,
        remote_id: &str,
        enabled: bool,
        agent_ids: Vec<String>,
    ) -> Result<AppSnapshot, SettingsError> {
        self.change(
            "settings/model-upserted",
            Some(id),
            &serde_json::json!({"provider": provider, "remote_id": remote_id, "enabled": enabled}),
            |workspace| workspace.upsert_model(id, label, provider, remote_id, enabled, agent_ids),
        )
    }

    pub fn remove_model(&self, model_id: &str) -> Result<AppSnapshot, SettingsError> {
        self.change(
            "settings/model-removed",
            Some(model_id),
            &serde_json::json!({}),
            |workspace| workspace.remove_model(model_id),
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn upsert_agent(
        &self,
        id: &str,
        label: &str,
        driver: &str,
        model_id: Option<String>,
        skill_ids: Vec<String>,
        tool_ids: Vec<String>,
        instructions: &str,
        enabled: bool,
    ) -> Result<AppSnapshot, SettingsError> {
        self.change(
            "settings/agent-upserted",
            Some(id),
            &serde_json::json!({"driver": driver, "model_id": model_id, "skill_ids": skill_ids, "tool_ids": tool_ids, "enabled": enabled}),
            |workspace| {
                workspace.upsert_agent(
                    id,
                    label,
                    driver,
                    model_id,
                    skill_ids,
                    tool_ids,
                    instructions,
                    enabled,
                )
            },
        )
    }

    pub fn remove_agent(&self, agent_id: &str) -> Result<AppSnapshot, SettingsError> {
        self.change(
            "settings/agent-removed",
            Some(agent_id),
            &serde_json::json!({}),
            |workspace| workspace.remove_agent(agent_id),
        )
    }

    fn change(
        &self,
        kind: &str,
        subject_id: Option<&str>,
        payload: &serde_json::Value,
        operation: impl FnOnce(&mut crate::state::Workspace) -> Result<AppSnapshot, String>,
    ) -> Result<AppSnapshot, SettingsError> {
        let snapshot = self
            .state
            .transact(kind, subject_id, payload, operation)
            .map_err(|error| match error {
                MutationError::Domain(message) => SettingsError::InvalidArgument(message),
                MutationError::Repository(message) => SettingsError::Persistence(message),
            })?;
        self.events.revision_changed(snapshot.revision);
        Ok(snapshot)
    }
}

impl Settings<AppSnapshot> for NativeSettingsService {
    fn clean_legacy_data(&self) -> Result<AppSnapshot, SettingsError> {
        NativeSettingsService::clean_legacy_data(self)
    }
    fn import_skill(&self, path: &str, enabled: bool) -> Result<AppSnapshot, SettingsError> {
        NativeSettingsService::import_skill(self, path, enabled)
    }
    fn install_bundled_skill(&self, skill_id: &str) -> Result<AppSnapshot, SettingsError> {
        NativeSettingsService::install_bundled_skill(self, skill_id)
    }
    fn set_skill_enabled(
        &self,
        skill_id: &str,
        enabled: bool,
    ) -> Result<AppSnapshot, SettingsError> {
        NativeSettingsService::set_skill_enabled(self, skill_id, enabled)
    }
    fn remove_skill(&self, skill_id: &str) -> Result<AppSnapshot, SettingsError> {
        NativeSettingsService::remove_skill(self, skill_id)
    }
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
    ) -> Result<AppSnapshot, SettingsError> {
        NativeSettingsService::upsert_tool(
            self,
            id,
            label,
            transport,
            target,
            args,
            enabled,
            required,
            credential_env,
        )
    }
    fn remove_tool(&self, tool_id: &str) -> Result<AppSnapshot, SettingsError> {
        NativeSettingsService::remove_tool(self, tool_id)
    }
    fn upsert_model(
        &self,
        id: &str,
        label: &str,
        provider: &str,
        remote_id: &str,
        enabled: bool,
        agent_ids: Vec<String>,
    ) -> Result<AppSnapshot, SettingsError> {
        NativeSettingsService::upsert_model(
            self, id, label, provider, remote_id, enabled, agent_ids,
        )
    }
    fn remove_model(&self, model_id: &str) -> Result<AppSnapshot, SettingsError> {
        NativeSettingsService::remove_model(self, model_id)
    }
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
    ) -> Result<AppSnapshot, SettingsError> {
        NativeSettingsService::upsert_agent(
            self,
            id,
            label,
            driver,
            model_id,
            skill_ids,
            tool_ids,
            instructions,
            enabled,
        )
    }
    fn remove_agent(&self, agent_id: &str) -> Result<AppSnapshot, SettingsError> {
        NativeSettingsService::remove_agent(self, agent_id)
    }
}
