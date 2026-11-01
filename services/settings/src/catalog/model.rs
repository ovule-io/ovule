use std::collections::HashSet;
use std::path::Path;

use serde::{Deserialize, Serialize};

use super::{SettingsSource, empty_source};
use ovule_extension_api::{AgentContribution, ModelContribution};
use std::sync::Arc;

const MAX_INSTRUCTIONS_BYTES: usize = 32 * 1024;
const MAX_TOOL_ARGS: usize = 64;

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Catalog {
    #[serde(skip, default = "empty_source")]
    source: Arc<dyn SettingsSource>,
    #[serde(default = "default_agents")]
    pub agents: Vec<AgentProfile>,
    #[serde(default)]
    pub skills: Vec<SkillRecord>,
    #[serde(default)]
    pub tools: Vec<ToolRecord>,
    #[serde(default)]
    pub models: Vec<ModelRecord>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct AgentProfile {
    pub id: String,
    pub label: String,
    pub driver: String,
    pub model_id: Option<String>,
    pub skill_ids: Vec<String>,
    pub tool_ids: Vec<String>,
    pub instructions: String,
    pub enabled: bool,
    #[serde(default)]
    pub extension_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct SkillRecord {
    pub id: String,
    pub name: String,
    pub description: String,
    pub path: String,
    pub enabled: bool,
    #[serde(default)]
    pub extension_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ToolRecord {
    pub id: String,
    pub label: String,
    pub transport: String,
    pub target: String,
    pub args: Vec<String>,
    pub enabled: bool,
    pub required: bool,
    pub credential_env: Option<String>,
    #[serde(default)]
    pub extension_id: Option<String>,
    #[serde(default)]
    pub toolchain_id: Option<String>,
    #[serde(default)]
    pub capabilities: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ModelRecord {
    pub id: String,
    pub label: String,
    pub provider: String,
    pub remote_id: String,
    pub enabled: bool,
    #[serde(default)]
    pub agent_ids: Vec<String>,
    #[serde(default)]
    pub extension_id: Option<String>,
    #[serde(default)]
    pub recommended: bool,
    #[serde(default)]
    pub description: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AgentView {
    pub id: String,
    pub label: String,
    pub driver: String,
    pub available: bool,
    pub enabled: bool,
    pub detail: String,
    pub model_id: Option<String>,
    pub skill_ids: Vec<String>,
    pub tool_ids: Vec<String>,
    pub instructions: String,
    pub extension_id: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SkillView {
    pub id: String,
    pub name: String,
    pub description: String,
    pub path: String,
    pub enabled: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ToolView {
    pub id: String,
    pub label: String,
    pub transport: String,
    pub target: String,
    pub args: Vec<String>,
    pub enabled: bool,
    pub required: bool,
    pub available: bool,
    pub detail: String,
    pub credential_env: Option<String>,
    pub extension_id: Option<String>,
    pub toolchain_id: Option<String>,
    pub capabilities: Vec<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ModelView {
    pub id: String,
    pub label: String,
    pub provider: String,
    pub remote_id: String,
    pub enabled: bool,
    pub agent_ids: Vec<String>,
    pub extension_id: Option<String>,
    pub recommended: bool,
    pub description: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ResolvedAgent {
    pub id: String,
    pub driver: String,
    pub model: Option<ModelRecord>,
    pub skills: Vec<SkillRecord>,
    pub tools: Vec<ToolRecord>,
    pub instructions: String,
}

impl Default for Catalog {
    fn default() -> Self {
        Self {
            agents: default_agents(),
            source: empty_source(),
            skills: Vec::new(),
            tools: Vec::new(),
            models: default_models(),
        }
    }
}

impl Catalog {
    pub fn attach_source(&mut self, source: Arc<dyn SettingsSource>) {
        self.source = source;
    }
    fn available_extension_driver_ids(&self) -> Result<HashSet<String>, String> {
        Ok(self
            .source
            .contributions()?
            .known_agents
            .into_iter()
            .map(|agent| agent.id)
            .chain(std::iter::once("ovule".into()))
            .collect())
    }

    pub fn prune_missing_extension_agents(&mut self) -> Result<HashSet<String>, String> {
        let valid_drivers = self.available_extension_driver_ids()?;
        let removed = self
            .agents
            .iter()
            .filter(|agent| agent.extension_id.is_some() && !valid_drivers.contains(&agent.driver))
            .map(|agent| agent.id.clone())
            .collect::<HashSet<_>>();
        self.agents.retain(|agent| !removed.contains(&agent.id));
        self.prune_invalid_model_drivers(&valid_drivers);
        Ok(removed)
    }

    pub fn clean_unavailable_extension_drivers(&mut self) -> Result<HashSet<String>, String> {
        self.reconcile_extensions()?;
        let valid_drivers = self.available_extension_driver_ids()?;
        let removed = self
            .agents
            .iter()
            .filter(|agent| !valid_drivers.contains(&agent.driver))
            .map(|agent| agent.id.clone())
            .collect::<HashSet<_>>();
        self.agents
            .retain(|agent| valid_drivers.contains(&agent.driver));
        self.prune_invalid_model_drivers(&valid_drivers);
        Ok(removed)
    }

    fn prune_invalid_model_drivers(&mut self, valid_drivers: &HashSet<String>) {
        for model in &mut self.models {
            model
                .agent_ids
                .retain(|driver| valid_drivers.contains(driver));
        }
        self.models.retain(|model| !model.agent_ids.is_empty());
        let model_ids = self
            .models
            .iter()
            .map(|model| model.id.as_str())
            .collect::<HashSet<_>>();
        for agent in &mut self.agents {
            if agent
                .model_id
                .as_deref()
                .is_some_and(|id| !model_ids.contains(id))
            {
                agent.model_id = None;
            }
        }
    }

    #[allow(clippy::too_many_lines)]
    pub fn reconcile_extensions(&mut self) -> Result<bool, String> {
        let snapshot = self.source.contributions()?;
        let mut changed = false;
        let skill_contributions = snapshot.skills;
        let active_skill_owners = skill_contributions
            .iter()
            .map(|resolved| {
                (
                    resolved.contribution.id.clone(),
                    resolved.extension_id.clone(),
                )
            })
            .collect::<std::collections::HashMap<_, _>>();
        for skill in &mut self.skills {
            if skill.extension_id.is_none()
                && let Some(owner) = active_skill_owners.get(&skill.id)
            {
                skill.extension_id = Some(owner.clone());
                changed = true;
            }
        }
        let removed_skill_ids = self
            .skills
            .iter()
            .filter(|skill| {
                skill
                    .extension_id
                    .as_ref()
                    .is_some_and(|owner| active_skill_owners.get(&skill.id) != Some(owner))
            })
            .map(|skill| skill.id.clone())
            .collect::<HashSet<_>>();
        if !removed_skill_ids.is_empty() {
            self.skills
                .retain(|skill| !removed_skill_ids.contains(&skill.id));
            for agent in &mut self.agents {
                agent
                    .skill_ids
                    .retain(|skill_id| !removed_skill_ids.contains(skill_id));
            }
            changed = true;
        }
        for resolved in skill_contributions {
            let path = resolved.extension_root.join(&resolved.contribution.path);
            let mut record = skill_record(
                self.source.as_ref(),
                &path,
                true,
                Some(resolved.extension_id.clone()),
            )?;
            if let Some(skill) = self
                .skills
                .iter_mut()
                .find(|skill| skill.id == resolved.contribution.id)
            {
                if skill.extension_id.as_deref() != Some(&resolved.extension_id) {
                    return Err(format!(
                        "Skill {} conflicts with Extension {}",
                        resolved.contribution.id, resolved.extension_id
                    ));
                }
                record.enabled = skill.enabled;
                if *skill != record {
                    *skill = record;
                    changed = true;
                }
            } else {
                self.skills.push(record);
                changed = true;
            }
        }
        let contributions = snapshot.agents;
        for resolved in contributions {
            let contribution = resolved.contribution;
            if let Some(agent) = self
                .agents
                .iter_mut()
                .find(|agent| agent.id == contribution.id)
            {
                if let Some(owner) = &agent.extension_id
                    && owner != &resolved.extension_id
                {
                    return Err(format!(
                        "Agent {} is owned by both {} and {}",
                        contribution.id, owner, resolved.extension_id
                    ));
                }
                // Profiles created before Agent ownership was persisted are
                // migrated by their already-reserved bundled ID. Preserve
                // user-editable bindings below while restoring identity.
                if agent.driver != contribution.id || agent.label != contribution.label {
                    contribution.id.clone_into(&mut agent.driver);
                    contribution.label.clone_into(&mut agent.label);
                    changed = true;
                }
                if agent.extension_id.as_deref() != Some(&resolved.extension_id) {
                    agent.extension_id = Some(resolved.extension_id);
                    changed = true;
                }
            } else {
                self.agents
                    .push(agent_profile(contribution, Some(resolved.extension_id)));
                changed = true;
            }
        }
        if !self.agents.iter().any(|agent| agent.id == "ovule") {
            self.agents.push(ovule_agent());
            changed = true;
        }
        // DeepSeek used to be shipped as an AgentDriver. It is now a provider
        // for Ovule profiles. Remove the obsolete unreferenced built-in
        // profile during reconciliation; referenced legacy workspaces keep it
        // visible so the user can migrate deliberately.
        if let Some(index) = self.agents.iter().position(|agent| {
            agent.id == "deepseek"
                && agent.extension_id.as_deref() == Some("io.ovule.agent.deepseek")
        }) && !self.agents[index].enabled
        {
            self.agents.remove(index);
            changed = true;
        }
        let contributions = snapshot.models;
        for resolved in contributions {
            let contribution = resolved.contribution;
            if let Some(model) = self
                .models
                .iter_mut()
                .find(|model| model.id == contribution.id)
            {
                if model.extension_id.is_none() {
                    return Err(format!(
                        "extension Model conflicts with a user Model: {}",
                        contribution.id
                    ));
                }
                if model.extension_id.as_deref() != Some(&resolved.extension_id)
                    && !is_legacy_extension_owner(
                        model.extension_id.as_deref(),
                        &resolved.extension_id,
                    )
                {
                    return Err(format!(
                        "Model {} is owned by both {} and {}",
                        contribution.id,
                        model.extension_id.as_deref().unwrap_or_default(),
                        resolved.extension_id
                    ));
                }
                let enabled = model.enabled;
                let replacement = model_record(contribution, enabled, Some(resolved.extension_id));
                if *model != replacement {
                    *model = replacement;
                    changed = true;
                }
            } else {
                self.models.push(model_record(
                    contribution,
                    true,
                    Some(resolved.extension_id),
                ));
                changed = true;
            }
        }
        for (legacy_id, replacement_id) in [
            ("deepseek-chat", "deepseek-flash"),
            ("deepseek-reasoner", "deepseek-v4-pro"),
        ] {
            let legacy_owned = self.models.iter().any(|model| {
                model.id == legacy_id
                    && matches!(
                        model.extension_id.as_deref(),
                        Some("io.ovule.provider.deepseek" | "io.ovule.agent.deepseek")
                    )
            });
            if !legacy_owned {
                continue;
            }
            for agent in &mut self.agents {
                if agent.model_id.as_deref() == Some(legacy_id) {
                    agent.model_id = Some(replacement_id.to_owned());
                }
            }
            self.models.retain(|model| model.id != legacy_id);
            changed = true;
        }
        for model in &mut self.models {
            if model.agent_ids.is_empty()
                && let Some(agent) = legacy_model_agent(&model.provider)
            {
                model.agent_ids.push(agent.to_owned());
                changed = true;
            }
        }
        let contributions = ovule_extension_api::host::contributions()
            .computer_use
            .into_iter()
            .map(|contribution| super::Contribution {
                extension_id: ovule_extension_api::host::OWNER.to_owned(),
                extension_root: std::path::PathBuf::new(),
                contribution,
            })
            .chain(snapshot.computer_use);
        for resolved in contributions {
            let contribution = resolved.contribution;
            let (transport, target, toolchain_id) = match contribution.backend {
                ovule_extension_api::ComputerUseBackend::NativeCrd => {
                    ("native-crd".to_owned(), "tuffite.remoting".to_owned(), None)
                }
                ovule_extension_api::ComputerUseBackend::McpStdio => {
                    let toolchain = contribution.toolchain.clone().ok_or_else(|| {
                        format!("Computer Use Tool {} requires a Toolchain", contribution.id)
                    })?;
                    ("stdio".to_owned(), toolchain.clone(), Some(toolchain))
                }
            };
            let replacement = ToolRecord {
                id: contribution.id.clone(),
                label: contribution.label,
                transport,
                target,
                args: contribution.args,
                enabled: true,
                required: false,
                credential_env: None,
                extension_id: Some(resolved.extension_id.clone()),
                toolchain_id,
                capabilities: contribution.capabilities,
            };
            if let Some(tool) = self
                .tools
                .iter_mut()
                .find(|tool| tool.id == contribution.id)
            {
                // Retired TryCua state is intentionally not migrated in place.
                // Keep it visible as quarantined legacy data until the user
                // explicitly invokes the cleanup action from Manage > Tools.
                if tool.extension_id.as_deref() == Some("io.ovule.computer-use.trycua") {
                    continue;
                }
                if let Some(owner) = &tool.extension_id
                    && owner != &resolved.extension_id
                    // Migrate only the retired native CRD declarations to the host.
                    && !(contribution.id == "computer-use"
                        && matches!(owner.as_str(), "io.ovule.computer-use.crd" | "io.ovule.essentials")
                        && resolved.extension_id == ovule_extension_api::host::OWNER
                        && tool.transport == "native-crd"
                        && tool.target == "tuffite.remoting"
                        && replacement.transport == "native-crd")
                {
                    return Err(format!(
                        "Tool {} is owned by both {} and {}",
                        contribution.id, owner, resolved.extension_id
                    ));
                }
                if tool.extension_id.is_none() {
                    return Err(format!(
                        "extension Tool conflicts with a user Tool: {}",
                        contribution.id
                    ));
                }
                let enabled = tool.enabled;
                let replacement = ToolRecord {
                    enabled,
                    ..replacement
                };
                if *tool != replacement {
                    *tool = replacement;
                    changed = true;
                }
            } else {
                self.tools.push(replacement);
                changed = true;
            }
            // An omitted/empty allowlist exposes the capability to all installed agents.
            // Explicit entries still restrict it to the selected IDs or drivers.
            for agent in self.agents.iter_mut().filter(|agent| {
                contribution.agents.is_empty()
                    || contribution
                        .agents
                        .iter()
                        .any(|id| id == &agent.id || id == &agent.driver)
            }) {
                if !agent.tool_ids.contains(&contribution.id) {
                    agent.tool_ids.push(contribution.id.clone());
                    changed = true;
                }
            }
        }
        Ok(changed)
    }

    #[must_use]
    pub fn agent_views(&self) -> Vec<AgentView> {
        self.agents
            .iter()
            .map(|agent| {
                let (available, detail) = self.source.agent_health(self, agent);
                AgentView {
                    id: agent.id.clone(),
                    label: agent.label.clone(),
                    driver: agent.driver.clone(),
                    available,
                    enabled: agent.enabled,
                    detail,
                    model_id: agent.model_id.clone(),
                    skill_ids: agent.skill_ids.clone(),
                    tool_ids: agent.tool_ids.clone(),
                    instructions: agent.instructions.clone(),
                    extension_id: agent.extension_id.clone(),
                }
            })
            .collect()
    }

    #[must_use]
    pub fn skill_views(&self) -> Vec<SkillView> {
        self.skills
            .iter()
            .map(|skill| SkillView {
                id: skill.id.clone(),
                name: skill.name.clone(),
                description: skill.description.clone(),
                path: skill.path.clone(),
                enabled: skill.enabled,
            })
            .collect()
    }

    #[must_use]
    pub fn tool_views(&self) -> Vec<ToolView> {
        self.tools
            .iter()
            .map(|tool| {
                let (available, detail) = self.source.tool_health(tool);
                ToolView {
                    id: tool.id.clone(),
                    label: tool.label.clone(),
                    transport: tool.transport.clone(),
                    target: tool.target.clone(),
                    args: tool.args.clone(),
                    enabled: tool.enabled,
                    required: tool.required,
                    available,
                    detail,
                    credential_env: tool.credential_env.clone(),
                    extension_id: tool.extension_id.clone(),
                    toolchain_id: tool.toolchain_id.clone(),
                    capabilities: tool.capabilities.clone(),
                }
            })
            .collect()
    }

    pub fn clean_legacy_data(&mut self) -> bool {
        let before = self.tools.len();
        self.tools.retain(|tool| {
            tool.extension_id.as_deref() != Some("io.ovule.computer-use.trycua")
                && !(tool.transport == "stdio" && tool.target == "cua-driver")
        });
        before != self.tools.len()
    }

    #[must_use]
    pub fn model_views(&self) -> Vec<ModelView> {
        self.models
            .iter()
            .map(|model| ModelView {
                id: model.id.clone(),
                label: model.label.clone(),
                provider: model.provider.clone(),
                remote_id: model.remote_id.clone(),
                enabled: model.enabled,
                agent_ids: model.agent_ids.clone(),
                extension_id: model.extension_id.clone(),
                recommended: model.recommended,
                description: model.description.clone(),
            })
            .collect()
    }

    pub fn enabled_model(&self, id: &str) -> Result<ModelRecord, String> {
        self.models
            .iter()
            .find(|model| model.id == id && model.enabled)
            .cloned()
            .ok_or_else(|| format!("Model is unavailable: {id}"))
    }

    pub fn require_model_for_agent(&self, id: &str, agent_id: &str) -> Result<(), String> {
        let model = self.enabled_model(id)?;
        let driver = self
            .agents
            .iter()
            .find(|agent| agent.id == agent_id)
            .map(|agent| agent.driver.as_str())
            .ok_or_else(|| format!("unknown Agent: {agent_id}"))?;
        model
            .agent_ids
            .iter()
            .any(|agent_id| agent_id == driver)
            .then_some(())
            .ok_or_else(|| format!("Model {id} is not compatible with AgentDriver {driver}"))
    }

    #[must_use]
    pub fn default_agent_id(&self) -> String {
        self.agent_views()
            .into_iter()
            .find(|agent| agent.enabled && agent.available)
            .or_else(|| self.agent_views().into_iter().find(|agent| agent.enabled))
            .map_or_else(|| "ovule".to_owned(), |agent| agent.id)
    }

    pub fn resolve_agent(&self, agent_id: &str) -> Result<ResolvedAgent, String> {
        self.resolve_agent_for_target(agent_id, false)
    }

    pub fn resolve_agent_for_target(
        &self,
        agent_id: &str,
        remote_host: bool,
    ) -> Result<ResolvedAgent, String> {
        let agent = self
            .agents
            .iter()
            .find(|agent| agent.id == agent_id)
            .ok_or_else(|| format!("unknown Agent: {agent_id}"))?;
        if !agent.enabled {
            return Err(format!("Agent is unavailable: {agent_id} (Disabled)"));
        }
        let process_runs_on_remote_host = remote_host && agent.driver != "ovule";
        if !process_runs_on_remote_host {
            let (available, detail) = self.source.agent_health(self, agent);
            if !available {
                return Err(format!("Agent is unavailable: {agent_id} ({detail})"));
            }
        }
        let model = agent
            .model_id
            .as_deref()
            .map(|model_id| {
                self.models
                    .iter()
                    .find(|model| model.id == model_id && model.enabled)
                    .cloned()
                    .ok_or_else(|| format!("Agent references unavailable Model: {model_id}"))
            })
            .transpose()?;
        if let Some(model) = &model
            && !model.agent_ids.iter().any(|driver| driver == &agent.driver)
        {
            return Err(format!(
                "Agent {} references incompatible Model {}",
                agent.id, model.id
            ));
        }
        let skills = agent
            .skill_ids
            .iter()
            .map(|skill_id| {
                self.skills
                    .iter()
                    .find(|skill| skill.id == *skill_id)
                    .ok_or_else(|| format!("Agent references unknown Skill: {skill_id}"))
            })
            .collect::<Result<Vec<_>, _>>()?
            .into_iter()
            .filter(|skill| skill.enabled)
            .cloned()
            .collect();
        let tools = agent
            .tool_ids
            .iter()
            .map(|tool_id| {
                self.tools
                    .iter()
                    .find(|tool| tool.id == *tool_id)
                    .ok_or_else(|| format!("Agent references unknown Tool: {tool_id}"))
            })
            .collect::<Result<Vec<_>, _>>()?
            .into_iter()
            .filter_map(|tool| {
                if process_runs_on_remote_host {
                    return if tool.enabled {
                        Some(Ok(tool.clone()))
                    } else if tool.required {
                        Some(Err(format!("Required Tool is disabled: {}", tool.id)))
                    } else {
                        None
                    };
                }
                let healthy = self.source.tool_health(tool).0;
                if tool.required && !healthy {
                    Some(Err(format!("Required Tool is unavailable: {}", tool.id)))
                } else if healthy {
                    let mut resolved = tool.clone();
                    if let Some(target) = self.source.tool_target(tool) {
                        resolved.target = target.display().to_string();
                    }
                    Some(Ok(resolved))
                } else {
                    None
                }
            })
            .collect::<Result<Vec<_>, _>>()?;
        Ok(ResolvedAgent {
            id: agent.id.clone(),
            driver: agent.driver.clone(),
            model,
            skills,
            tools,
            instructions: agent.instructions.clone(),
        })
    }

    pub fn import_skill(&mut self, path: &str, enabled: bool) -> Result<(), String> {
        let record = skill_record(
            self.source.as_ref(),
            &self.source.skill_path(path)?,
            enabled,
            None,
        )?;
        upsert(&mut self.skills, record, |entry| entry.id.as_str());
        Ok(())
    }

    pub fn import_extension_skill(
        &mut self,
        path: &str,
        enabled: bool,
        extension_id: &str,
    ) -> Result<(), String> {
        let record = skill_record(
            self.source.as_ref(),
            &self.source.skill_path(path)?,
            enabled,
            Some(extension_id.to_owned()),
        )?;
        if let Some(existing) = self.skills.iter().find(|skill| skill.id == record.id)
            && existing.extension_id.as_deref() != Some(extension_id)
        {
            return Err(format!(
                "Skill {} conflicts with Extension {extension_id}",
                record.id
            ));
        }
        upsert(&mut self.skills, record, |entry| entry.id.as_str());
        Ok(())
    }

    pub fn enabled_skill_path(&self, skill_id: &str) -> Result<String, String> {
        self.skills
            .iter()
            .find(|skill| skill.id == skill_id && skill.enabled)
            .map(|skill| skill.path.clone())
            .ok_or_else(|| format!("Skill is unavailable: {skill_id}"))
    }

    pub fn set_skill_enabled(&mut self, skill_id: &str, enabled: bool) -> Result<(), String> {
        let skill = self
            .skills
            .iter_mut()
            .find(|skill| skill.id == skill_id)
            .ok_or_else(|| format!("unknown Skill: {skill_id}"))?;
        skill.enabled = enabled;
        Ok(())
    }

    pub fn remove_skill(&mut self, skill_id: &str) -> Result<(), String> {
        ensure_unreferenced(&self.agents, skill_id, ReferenceKind::Skill)?;
        remove(
            &mut self.skills,
            skill_id,
            |entry| entry.id.as_str(),
            "Skill",
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn upsert_tool(
        &mut self,
        id: &str,
        label: &str,
        transport: &str,
        target: &str,
        args: Vec<String>,
        enabled: bool,
        required_tool: bool,
        credential_env: Option<String>,
    ) -> Result<(), String> {
        validate_id(id, "Tool ID")?;
        let label = required(label, "Tool label", 128)?;
        let target = required(target, "Tool target", 2_048)?;
        if args.len() > MAX_TOOL_ARGS || args.iter().any(|arg| arg.len() > 4_096) {
            return Err("Tool arguments exceed the configured limits".to_owned());
        }
        match transport {
            "stdio" => {}
            "http" => {
                if !args.is_empty() {
                    return Err("HTTP MCP Tools cannot have process arguments".to_owned());
                }
                validate_http_url(&target)?;
            }
            _ => return Err("Tool transport must be stdio or http".to_owned()),
        }
        let credential_env = optional(credential_env);
        if let Some(name) = &credential_env {
            validate_environment_name(name)?;
        }
        let extension = self
            .tools
            .iter()
            .find(|tool| tool.id == id)
            .and_then(|tool| {
                tool.extension_id.as_ref().map(|extension_id| {
                    (
                        extension_id.clone(),
                        tool.toolchain_id.clone(),
                        tool.capabilities.clone(),
                        tool.clone(),
                    )
                })
            });
        if let Some((_, _, _, existing)) = &extension
            && (existing.label != label
                || existing.transport != transport
                || existing.target != target
                || existing.args != args
                || existing.required != required_tool
                || existing.credential_env != credential_env)
        {
            return Err("extension Tool metadata is immutable".to_owned());
        }
        let record = ToolRecord {
            id: id.to_owned(),
            label,
            transport: transport.to_owned(),
            target,
            args,
            enabled,
            required: required_tool,
            credential_env,
            extension_id: extension.as_ref().map(|value| value.0.clone()),
            toolchain_id: extension.as_ref().and_then(|value| value.1.clone()),
            capabilities: extension.map_or_else(Vec::new, |value| value.2),
        };
        upsert(&mut self.tools, record, |entry| entry.id.as_str());
        Ok(())
    }

    pub fn remove_tool(&mut self, tool_id: &str) -> Result<(), String> {
        if self
            .tools
            .iter()
            .find(|tool| tool.id == tool_id)
            .is_some_and(|tool| tool.extension_id.is_some())
        {
            return Err("extension Tools cannot be removed".to_owned());
        }
        ensure_unreferenced(&self.agents, tool_id, ReferenceKind::Tool)?;
        remove(&mut self.tools, tool_id, |entry| entry.id.as_str(), "Tool")
    }

    pub fn upsert_model(
        &mut self,
        id: &str,
        label: &str,
        provider: &str,
        remote_id: &str,
        enabled: bool,
        agent_ids: Vec<String>,
    ) -> Result<(), String> {
        validate_id(id, "Model ID")?;
        validate_agent_ids(&agent_ids)?;
        for agent_id in &agent_ids {
            if !self.source.supported_driver(agent_id) {
                return Err(format!("unknown Model AgentDriver: {agent_id}"));
            }
        }
        let extension_id = self
            .models
            .iter()
            .find(|model| model.id == id)
            .and_then(|model| model.extension_id.clone());
        let (recommended, description) = self
            .models
            .iter()
            .find(|model| model.id == id)
            .map_or((false, String::new()), |model| {
                (model.recommended, model.description.clone())
            });
        if let Some(existing) = self.models.iter().find(|model| model.id == id)
            && existing.extension_id.is_some()
            && (existing.label != label
                || existing.provider != provider
                || existing.remote_id != remote_id
                || existing.agent_ids != agent_ids)
        {
            return Err("extension Model metadata is immutable".to_owned());
        }
        let record = ModelRecord {
            id: id.to_owned(),
            label: required(label, "Model label", 128)?,
            provider: required(provider, "Model provider", 128)?,
            remote_id: required(remote_id, "Remote model ID", 256)?,
            enabled,
            agent_ids,
            extension_id,
            recommended,
            description,
        };
        upsert(&mut self.models, record, |entry| entry.id.as_str());
        Ok(())
    }

    pub fn remove_model(&mut self, model_id: &str) -> Result<(), String> {
        if self
            .models
            .iter()
            .any(|model| model.id == model_id && model.extension_id.is_some())
        {
            return Err("extension Models can be disabled but not removed".to_owned());
        }
        ensure_unreferenced(&self.agents, model_id, ReferenceKind::Model)?;
        remove(
            &mut self.models,
            model_id,
            |entry| entry.id.as_str(),
            "Model",
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn upsert_agent(
        &mut self,
        id: &str,
        label: &str,
        driver: &str,
        model_id: Option<String>,
        skill_ids: Vec<String>,
        tool_ids: Vec<String>,
        instructions: &str,
        enabled: bool,
    ) -> Result<(), String> {
        validate_id(id, "Agent ID")?;
        if !self.source.supported_driver(driver) {
            return Err(format!("unsupported AgentDriver: {driver}"));
        }
        let model_id = optional(model_id);
        if let Some(model_id) = &model_id {
            self.require_model(model_id)?;
            let model = self
                .models
                .iter()
                .find(|model| model.id == *model_id)
                .ok_or_else(|| format!("unknown Model: {model_id}"))?;
            if !model.agent_ids.iter().any(|agent_id| agent_id == driver) {
                return Err(format!(
                    "Model {model_id} is not compatible with AgentDriver {driver}"
                ));
            }
        }
        unique_refs(&skill_ids, "Skill")?;
        unique_refs(&tool_ids, "Tool")?;
        for skill_id in &skill_ids {
            self.require_skill(skill_id)?;
        }
        for tool_id in &tool_ids {
            self.require_tool(tool_id)?;
        }
        let profile = AgentProfile {
            id: id.to_owned(),
            label: required(label, "Agent label", 128)?,
            driver: driver.to_owned(),
            model_id,
            skill_ids,
            tool_ids,
            instructions: required_optional_text(instructions, MAX_INSTRUCTIONS_BYTES)?,
            enabled,
            extension_id: self
                .agents
                .iter()
                .find(|agent| agent.id == id)
                .and_then(|agent| agent.extension_id.clone()),
        };
        if let Some(existing) = self.agents.iter().find(|agent| agent.id == id)
            && existing.extension_id.is_some()
            && (existing.label != profile.label || existing.driver != profile.driver)
        {
            return Err("extension Agent identity is immutable".to_owned());
        }
        upsert(&mut self.agents, profile, |entry| entry.id.as_str());
        Ok(())
    }

    pub fn remove_agent(&mut self, agent_id: &str) -> Result<(), String> {
        if agent_id == "ovule"
            || self
                .agents
                .iter()
                .any(|agent| agent.id == agent_id && agent.extension_id.is_some())
        {
            return Err("built-in Agent profiles can be disabled but not removed".to_owned());
        }
        remove(
            &mut self.agents,
            agent_id,
            |entry| entry.id.as_str(),
            "Agent",
        )
    }

    fn require_skill(&self, id: &str) -> Result<(), String> {
        self.skills
            .iter()
            .any(|entry| entry.id == id)
            .then_some(())
            .ok_or_else(|| format!("unknown Skill: {id}"))
    }

    fn require_tool(&self, id: &str) -> Result<(), String> {
        self.tools
            .iter()
            .any(|entry| entry.id == id)
            .then_some(())
            .ok_or_else(|| format!("unknown Tool: {id}"))
    }

    fn require_model(&self, id: &str) -> Result<(), String> {
        self.models
            .iter()
            .any(|entry| entry.id == id)
            .then_some(())
            .ok_or_else(|| format!("unknown Model: {id}"))
    }
}

fn skill_record(
    settings_source: &dyn SettingsSource,
    path: &Path,
    enabled: bool,
    extension_id: Option<String>,
) -> Result<SkillRecord, String> {
    let source = settings_source.skill_source(path)?;
    let (frontmatter, _) = ovule_skills::parse(&source)?;
    let parent_name = path
        .parent()
        .and_then(std::path::Path::file_name)
        .and_then(|name| name.to_str())
        .ok_or_else(|| "SKILL.md must have a named parent directory".to_owned())?;
    if parent_name != frontmatter.name {
        return Err(format!(
            "Skill name '{}' must match parent directory '{parent_name}'",
            frontmatter.name
        ));
    }
    required(&frontmatter.description, "Skill description", 1_024)?;
    Ok(SkillRecord {
        id: frontmatter.name.clone(),
        name: frontmatter.name,
        description: frontmatter.description.trim().to_owned(),
        path: path.to_string_lossy().into_owned(),
        enabled,
        extension_id,
    })
}

fn default_agents() -> Vec<AgentProfile> {
    vec![ovule_agent()]
}

fn agent_profile(agent: AgentContribution, extension_id: Option<String>) -> AgentProfile {
    AgentProfile {
        driver: agent.id.clone(),
        id: agent.id,
        label: agent.label,
        model_id: None,
        skill_ids: Vec::new(),
        tool_ids: Vec::new(),
        instructions: String::new(),
        enabled: true,
        extension_id,
    }
}

fn ovule_agent() -> AgentProfile {
    AgentProfile {
        id: "ovule".to_owned(),
        label: "Ovule".to_owned(),
        driver: "ovule".to_owned(),
        model_id: None,
        skill_ids: Vec::new(),
        tool_ids: Vec::new(),
        instructions: String::new(),
        enabled: true,
        extension_id: None,
    }
}

fn default_models() -> Vec<ModelRecord> {
    Vec::new()
}

fn model_record(
    model: ModelContribution,
    enabled: bool,
    extension_id: Option<String>,
) -> ModelRecord {
    ModelRecord {
        id: model.id,
        label: model.label,
        provider: model.provider,
        remote_id: model.remote_id,
        enabled,
        agent_ids: model.agents,
        extension_id,
        recommended: model.recommended,
        description: model.description,
    }
}

fn validate_agent_ids(agent_ids: &[String]) -> Result<(), String> {
    if agent_ids.is_empty() {
        return Err("Model must support at least one AgentDriver".to_owned());
    }
    unique_refs(agent_ids, "Model AgentDriver")
}

fn legacy_model_agent(provider: &str) -> Option<&'static str> {
    match provider {
        "ollama" | "openai" | "deepseek" => Some("ovule"),
        "codex" => Some("codex"),
        "anthropic" | "claude" => Some("claude"),
        _ => None,
    }
}

fn is_legacy_extension_owner(existing: Option<&str>, replacement: &str) -> bool {
    matches!(
        (existing, replacement),
        (
            Some("io.ovule.agent.deepseek"),
            "io.ovule.provider.deepseek"
        )
    )
}

pub fn validate_http_url(value: &str) -> Result<(), String> {
    let url = url::Url::parse(value).map_err(|error| format!("invalid MCP URL: {error}"))?;
    if matches!(url.scheme(), "http" | "https")
        && url.host_str().is_some()
        && url.username().is_empty()
        && url.password().is_none()
    {
        Ok(())
    } else {
        Err("MCP URL must use http or https, include a host, and not embed credentials".to_owned())
    }
}

fn validate_id(value: &str, label: &str) -> Result<(), String> {
    let valid = !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'));
    if valid {
        Ok(())
    } else {
        Err(format!(
            "{label} must use 1-128 letters, digits, '.', '_' or '-'"
        ))
    }
}

fn validate_environment_name(value: &str) -> Result<(), String> {
    let mut bytes = value.bytes();
    let valid_start = bytes
        .next()
        .is_some_and(|byte| byte.is_ascii_alphabetic() || byte == b'_');
    if valid_start && bytes.all(|byte| byte.is_ascii_alphanumeric() || byte == b'_') {
        Ok(())
    } else {
        Err("credential environment variable name is invalid".to_owned())
    }
}

fn required(value: &str, label: &str, max_len: usize) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() {
        Err(format!("{label} is required"))
    } else if value.len() > max_len {
        Err(format!("{label} is too long"))
    } else {
        Ok(value.to_owned())
    }
}

fn optional(value: Option<String>) -> Option<String> {
    value.and_then(|value| {
        let value = value.trim().to_owned();
        (!value.is_empty()).then_some(value)
    })
}

fn required_optional_text(value: &str, max_len: usize) -> Result<String, String> {
    let value = value.trim();
    if value.len() > max_len {
        Err("Agent instructions are too long".to_owned())
    } else {
        Ok(value.to_owned())
    }
}

fn unique_refs(values: &[String], label: &str) -> Result<(), String> {
    let mut unique = HashSet::new();
    if values.iter().all(|value| unique.insert(value)) {
        Ok(())
    } else {
        Err(format!("{label} references must be unique"))
    }
}

fn upsert<T>(items: &mut Vec<T>, value: T, id: impl Fn(&T) -> &str) {
    let value_id = id(&value).to_owned();
    if let Some(index) = items.iter().position(|item| id(item) == value_id) {
        items[index] = value;
    } else {
        items.push(value);
    }
}

fn remove<T>(
    items: &mut Vec<T>,
    value_id: &str,
    id: impl Fn(&T) -> &str,
    label: &str,
) -> Result<(), String> {
    let before = items.len();
    items.retain(|item| id(item) != value_id);
    if items.len() == before {
        Err(format!("unknown {label}: {value_id}"))
    } else {
        Ok(())
    }
}

#[derive(Clone, Copy)]
enum ReferenceKind {
    Skill,
    Tool,
    Model,
}

fn ensure_unreferenced(
    agents: &[AgentProfile],
    target: &str,
    kind: ReferenceKind,
) -> Result<(), String> {
    let referencing = agents.iter().find(|agent| match kind {
        ReferenceKind::Skill => agent.skill_ids.iter().any(|id| id == target),
        ReferenceKind::Tool => agent.tool_ids.iter().any(|id| id == target),
        ReferenceKind::Model => agent.model_id.as_deref() == Some(target),
    });
    referencing.map_or(Ok(()), |agent| {
        Err(format!(
            "{} is still referenced by Agent {}",
            match kind {
                ReferenceKind::Skill => "Skill",
                ReferenceKind::Tool => "Tool",
                ReferenceKind::Model => "Model",
            },
            agent.id
        ))
    })
}

#[cfg(test)]
#[path = "tests.rs"]
mod tests;

impl Catalog {
    pub fn bundled_skill_path(&self, id: &str) -> Result<std::path::PathBuf, String> {
        self.source.bundled_skill_path(id)
    }
}

impl Catalog {
    pub fn resolve_command(&self, id: &str) -> Result<Option<crate::catalog::CommandPlan>, String> {
        self.source.resolve_command(id)
    }
}
