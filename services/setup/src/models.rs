use crate::OllamaModelJobView;
use crate::settings::{AgentView, ModelView};
use crate::state::Workspace;

use super::extension_onboarding::extension_onboarding;
use super::support::sanitize_id;
use super::{NativeSetupService, OllamaModelCatalog, OnboardingModelOption, SetupError};

pub(crate) fn get_ollama_model_jobs(service: &NativeSetupService) -> Vec<OllamaModelJobView> {
    service.models.jobs()
}

pub(crate) fn get_ollama_models(service: &NativeSetupService) -> OllamaModelCatalog {
    let snapshot = service.state.read(Workspace::snapshot);
    OllamaModelCatalog {
        models: discover_models(service, &snapshot.agents, &snapshot.models)
            .into_iter()
            .filter(|model| model.provider == "ollama")
            .collect(),
        jobs: service.models.jobs(),
    }
}

pub(crate) fn pull_ollama_model(
    service: &NativeSetupService,
    model: &str,
) -> Result<OllamaModelJobView, SetupError> {
    service
        .models
        .start_pull(model)
        .map_err(SetupError::Persistence)
}

#[allow(clippy::too_many_lines)]
pub(super) fn discover_models(
    service: &NativeSetupService,
    agents: &[AgentView],
    catalog: &[ModelView],
) -> Vec<OnboardingModelOption> {
    let setup_status = extension_onboarding(service)
        .unwrap_or_default()
        .into_iter()
        .filter_map(|setup| {
            setup
                .model_provider
                .map(|provider| (provider, setup.status))
        })
        .collect::<std::collections::BTreeMap<_, _>>();
    let ollama =
        if ovule_toolchains::resolve("ollama", service.managed_toolchains.as_path()).is_some() {
            Some(service.models.discover_models())
        } else {
            None
        };
    let mut options = catalog
        .iter()
        .filter(|model| model.enabled)
        .map(|model| {
            let agent_id = agents
                .iter()
                .find(|agent| agent.model_id.as_deref() == Some(model.id.as_str()))
                .map(|agent| agent.id.as_str())
                .or_else(|| {
                    model.agent_ids.iter().find_map(|driver| {
                        agents
                            .iter()
                            .find(|agent| agent.driver == *driver)
                            .map(|agent| agent.id.as_str())
                    })
                });
            let agent_available = agent_id.is_some_and(|id| {
                agents
                    .iter()
                    .any(|agent| agent.id == id && (agent.available || id == "ovule"))
            });
            let available = if model.provider == "ollama" {
                let name = model.remote_id.strip_prefix("ollama:");
                agent_available
                    && name.is_some_and(|name| {
                        ollama
                            .as_ref()
                            .and_then(|result| result.as_ref().ok())
                            .is_some_and(|models| models.iter().any(|candidate| candidate == name))
                    })
            } else if agent_id == Some("ovule")
                && let Some(status) = setup_status.get(&model.provider)
            {
                status.available && status.authenticated
            } else {
                agent_available
            };
            OnboardingModelOption {
                id: model.id.clone(),
                label: model.label.clone(),
                provider: model.provider.clone(),
                remote_id: model.remote_id.clone(),
                available,
                recommended: model.recommended,
                detail: if !model.description.is_empty() {
                    model.description.clone()
                } else if available {
                    "Configured in the Ovule Model catalog".to_owned()
                } else if model.provider == "ollama" {
                    "Configured Ollama model is not present in the local runtime".to_owned()
                } else {
                    "Configured model has no compatible installed Agent".to_owned()
                },
                agent_id: agent_id.map(str::to_owned),
            }
        })
        .collect::<Vec<_>>();
    for (agent_id, label, commands, args) in [(
        "codex",
        "Codex default",
        &["codex"][..],
        &["login", "status"][..],
    )] {
        if agents
            .iter()
            .any(|agent| agent.id == agent_id && agent.available)
            && commands
                .iter()
                .find_map(|command| {
                    ovule_toolchains::resolve(command, service.managed_toolchains.as_path())
                        .or_else(|| which::which(command).ok())
                })
                .is_some_and(|executable| {
                    service
                        .agent_commands
                        .probe_executable(&executable, args)
                        .is_ok()
                })
        {
            options.push(OnboardingModelOption {
                id: format!("default:{agent_id}"),
                label: label.to_owned(),
                provider: agent_id.to_owned(),
                remote_id: String::new(),
                available: true,
                recommended: false,
                detail: format!("Use the authenticated model selected by {label}."),
                agent_id: Some(agent_id.to_owned()),
            });
        }
    }
    // Ovule's OpenAI provider is configured independently from whether the
    // user selected the standalone Codex Agent profile. A Codex Toolchain may
    // have been installed and authenticated during this onboarding session,
    // after the Agent catalog snapshot was created. Surface its discovered
    // model immediately so provider setup can proceed to model selection.
    if setup_status
        .get("openai")
        .is_some_and(|status| status.authenticated)
        && !options.iter().any(|model| {
            model.agent_id.as_deref() == Some("ovule")
                && model.provider == "openai"
                && model.remote_id == "gpt-6-astra"
        })
    {
        options.push(OnboardingModelOption {
            id: "openai:gpt-6-astra".to_owned(),
            label: "GPT-6 Astra".to_owned(),
            provider: "openai".to_owned(),
            remote_id: "gpt-6-astra".to_owned(),
            available: true,
            recommended: false,
            detail: "Current OpenAI flagship model through authenticated Codex.".to_owned(),
            agent_id: Some("ovule".to_owned()),
        });
    }
    let online_available = options
        .iter()
        .any(|model| model.available && model.provider != "ollama");
    match ollama {
        Some(Ok(names)) => {
            if names.is_empty() {
                options.push(OnboardingModelOption {
                    id: "ollama-empty".to_owned(),
                    label: "Ollama · no model installed".to_owned(),
                    provider: "ollama".to_owned(),
                    remote_id: String::new(),
                    available: false,
                    recommended: !online_available,
                    detail: "Run `ollama pull qwen3-coder` to install a local fallback.".to_owned(),
                    agent_id: Some("ovule".to_owned()),
                });
            } else {
                for name in names {
                    if options.iter().any(|model| {
                        model.provider == "ollama" && model.remote_id == format!("ollama:{name}")
                    }) {
                        continue;
                    }
                    options.push(OnboardingModelOption {
                        id: format!("ollama:{}", sanitize_id(&name)),
                        label: format!("{name} · local"),
                        provider: "ollama".to_owned(),
                        remote_id: format!("ollama:{name}"),
                        available: true,
                        recommended: !online_available,
                        detail: "Local Ollama model; no online model account required.".to_owned(),
                        agent_id: Some("ovule".to_owned()),
                    });
                }
            }
        }
        Some(Err(error)) => options.push(OnboardingModelOption {
            id: "ollama-stopped".to_owned(),
            label: "Ollama · service unavailable".to_owned(),
            provider: "ollama".to_owned(),
            remote_id: String::new(),
            available: false,
            recommended: !online_available,
            detail: format!("Start Ollama and refresh. {error}"),
            agent_id: Some("ovule".to_owned()),
        }),
        None => options.push(OnboardingModelOption {
            id: "ollama-missing".to_owned(),
            label: "Install Ollama for local fallback".to_owned(),
            provider: "ollama".to_owned(),
            remote_id: String::new(),
            available: false,
            recommended: true,
            detail: "Install Ollama, pull a model, then refresh discovery.".to_owned(),
            agent_id: Some("ovule".to_owned()),
        }),
    }
    if options.iter().any(|model| model.available)
        && !options.iter().any(|model| model.recommended)
        && let Some(first) = options.iter_mut().find(|model| model.available)
    {
        first.recommended = true;
    }
    options
}
