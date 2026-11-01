use crate::resources;
use crate::state::{AppSnapshot, Workspace};

use super::extension_onboarding::extension_onboarding;
use super::models::discover_models;
use super::support::{emit_revision, sanitize_id, transact};
use super::{NativeSetupService, OnboardingInput, OnboardingStatus, SetupError};

pub(crate) fn get_onboarding_status(
    service: &NativeSetupService,
) -> Result<OnboardingStatus, SetupError> {
    collect_onboarding_status(service)
}

fn collect_onboarding_status(service: &NativeSetupService) -> Result<OnboardingStatus, SetupError> {
    let snapshot = service.state.read(Workspace::snapshot);
    let models = discover_models(service, &snapshot.agents, &snapshot.models);
    let default_agent_id = service.state.read(Workspace::default_agent_id);
    Ok(OnboardingStatus {
        authorization_url: None,
        agents: snapshot.agents,
        models,
        toolchains: service
            .toolchains
            .onboarding_status()
            .map_err(SetupError::Persistence)?,
        setups: extension_onboarding(service)?,
        default_agent_id,
    })
}

#[allow(clippy::too_many_lines)]
pub(crate) fn complete_onboarding(
    service: &NativeSetupService,
    input: &OnboardingInput,
) -> Result<AppSnapshot, SetupError> {
    if input.agents.is_empty() || input.agents.len() > 16 {
        return Err(SetupError::InvalidArgument(
            "Select between one and sixteen Agents".to_owned(),
        ));
    }
    let selected_agents = input
        .agents
        .iter()
        .map(|agent| agent.id.as_str())
        .collect::<std::collections::BTreeSet<_>>();
    if selected_agents.len() != input.agents.len()
        || !selected_agents.contains(input.default_agent_id.as_str())
    {
        return Err(SetupError::InvalidArgument(
            "Selected Agents must be unique and include the default Agent".to_owned(),
        ));
    }
    let status = collect_onboarding_status(service)?;
    let mut configured_agents = Vec::with_capacity(input.agents.len());
    let mut ovule_models = std::collections::BTreeMap::new();
    for selection in &input.agents {
        let existing = status.agents.iter().find(|agent| agent.id == selection.id);
        let profile_template = existing.or_else(|| {
            (selection.driver == "ovule")
                .then(|| status.agents.iter().find(|agent| agent.id == "ovule"))
                .flatten()
        });
        if existing.is_none() && selection.driver != "ovule" {
            return Err(SetupError::InvalidArgument(format!(
                "Only Ovule profiles can be created during onboarding: {}",
                selection.id
            )));
        }
        if let Some(existing) = existing
            && existing.driver != selection.driver
        {
            return Err(SetupError::InvalidArgument(format!(
                "AgentDriver cannot be changed during onboarding: {}",
                selection.id
            )));
        }
        if selection.driver != "ovule" && !existing.is_some_and(|agent| agent.available) {
            return Err(SetupError::InvalidArgument(format!(
                "Agent is unavailable: {}",
                selection.id
            )));
        }
        let model_id = match selection.driver.as_str() {
            "ovule" => {
                let selected_id = selection.model_id.as_deref().ok_or_else(|| {
                    SetupError::InvalidArgument(format!(
                        "Ovule profile {} requires an OpenAI, DeepSeek, or Ollama model",
                        selection.id
                    ))
                })?;
                let model = status
                    .models
                    .iter()
                    .find(|model| {
                        model.id == selected_id
                            && model.available
                            && matches!(model.provider.as_str(), "openai" | "deepseek" | "ollama")
                    })
                    .ok_or_else(|| {
                        SetupError::InvalidArgument(format!("Model is unavailable: {selected_id}"))
                    })?
                    .clone();
                let persisted_id = format!(
                    "onboarding-{}",
                    sanitize_id(&format!("{}-{}", model.provider, model.remote_id))
                );
                ovule_models.insert(persisted_id.clone(), model);
                Some(persisted_id)
            }
            _ => existing.and_then(|agent| agent.model_id.clone()),
        };
        configured_agents.push((
            selection.id.clone(),
            selection.label.clone(),
            selection.driver.clone(),
            model_id,
            profile_template.map_or_else(Vec::new, |agent| agent.skill_ids.clone()),
            profile_template.map_or_else(Vec::new, |agent| agent.tool_ids.clone()),
            profile_template.map_or_else(String::new, |agent| agent.instructions.clone()),
        ));
    }
    let default_model_id = configured_agents
        .iter()
        .find(|agent| agent.0 == input.default_agent_id)
        .and_then(|agent| agent.3.clone());
    let default_agent_id = input.default_agent_id.clone();
    let selected_agent_ids = input
        .agents
        .iter()
        .map(|agent| agent.id.clone())
        .collect::<Vec<_>>();
    let existing_agents = status.agents;
    let onboarding_skill =
        resources::bundled_skill_path("onboarding").map_err(SetupError::Persistence)?;
    let snapshot = transact(
        &service.state,
        "onboarding/completed",
        None,
        &serde_json::json!({"agents": selected_agent_ids, "default_agent": default_agent_id, "thread_id": input.thread_id}),
        |workspace| {
            workspace.import_skill(&onboarding_skill.to_string_lossy(), true)?;
            for (model_id, selected_model) in &ovule_models {
                workspace.upsert_model(
                    model_id,
                    &selected_model.label,
                    &selected_model.provider,
                    &selected_model.remote_id,
                    true,
                    vec!["ovule".to_owned()],
                )?;
            }
            for agent in &existing_agents {
                if !selected_agents.contains(agent.id.as_str()) {
                    workspace.upsert_agent(
                        &agent.id,
                        &agent.label,
                        &agent.driver,
                        agent.model_id.clone(),
                        agent.skill_ids.clone(),
                        agent.tool_ids.clone(),
                        &agent.instructions,
                        false,
                    )?;
                }
            }
            for (id, label, driver, model_id, skill_ids, tool_ids, instructions) in
                &configured_agents
            {
                workspace.upsert_agent(
                    id,
                    label,
                    driver,
                    model_id.clone(),
                    skill_ids.clone(),
                    tool_ids.clone(),
                    instructions,
                    true,
                )?;
            }
            workspace.configure_defaults(
                &default_agent_id,
                default_model_id,
                input.thread_id.as_deref(),
            )
        },
    )?;
    emit_revision(
        service.events.as_ref(),
        service.state.read(Workspace::revision),
    );
    Ok(snapshot)
}
