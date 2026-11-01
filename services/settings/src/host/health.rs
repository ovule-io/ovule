use std::path::PathBuf;

use crate::catalog::{AgentProfile, Catalog, ToolRecord, validate_http_url};
use ovule_extensions::providers::{resolve_extension_agent, resolve_extension_model_provider};

pub(super) fn agent_health(catalog: &Catalog, agent: &AgentProfile) -> (bool, String) {
    let driver = if agent.driver == "ovule" {
        agent
            .model_id
            .as_deref()
            .and_then(|id| {
                catalog
                    .models
                    .iter()
                    .find(|model| model.id == id && model.enabled)
            })
            .map_or_else(
                || {
                    (
                        false,
                        "Select an OpenAI, DeepSeek, or Ollama model".to_owned(),
                    )
                },
                |model| match model.provider.as_str() {
                    "openai" => driver_health("codex"),
                    "ollama" if model.remote_id.starts_with("ollama:") => {
                        driver_health(&agent.driver)
                    }
                    provider
                        if resolve_extension_model_provider(provider)
                            .is_ok_and(|resolved| resolved.is_some()) =>
                    {
                        model_provider_health(provider, &model.remote_id)
                    }
                    _ => (
                        false,
                        "Ovule supports OpenAI, DeepSeek, or Ollama models".to_owned(),
                    ),
                },
            )
    } else {
        driver_health(&agent.driver)
    };
    if !driver.0 {
        return driver;
    }
    if let Some(missing) = agent.model_id.as_deref().filter(|id| {
        !catalog
            .models
            .iter()
            .any(|model| model.id == *id && model.enabled)
    }) {
        return (false, format!("Model unavailable: {missing}"));
    }
    if let Some(missing) = agent
        .skill_ids
        .iter()
        .find(|id| !catalog.skills.iter().any(|skill| skill.id == id.as_str()))
    {
        return (false, format!("Skill unavailable: {missing}"));
    }
    if let Some(missing) = agent
        .tool_ids
        .iter()
        .find(|id| !catalog.tools.iter().any(|tool| tool.id == id.as_str()))
    {
        return (false, format!("Tool unavailable: {missing}"));
    }
    if let Some(tool) = agent
        .tool_ids
        .iter()
        .filter_map(|id| catalog.tools.iter().find(|tool| tool.id == *id))
        .find(|tool| tool.required && (!tool.enabled || !tool_health(tool).0))
    {
        return (false, format!("Required Tool unavailable: {}", tool.id));
    }
    (true, driver.1)
}

pub(super) fn driver_health(driver: &str) -> (bool, String) {
    let commands = match driver {
        "ovule" => {
            return ovule_toolchains::resolve(
                "ollama",
                &super::environment::managed_toolchains_path(),
            )
            .map_or_else(
                || (false, "Ollama is not installed".to_owned()),
                |path| (true, format!("Ollama · {}", path.display())),
            );
        }
        #[cfg(any(test, feature = "test-driver"))]
        "test" => return (true, "Test AgentDriver".to_owned()),
        _ => match resolve_extension_agent(driver) {
            Ok(Some(resolved)) => {
                if let Some(missing) = resolved
                    .contribution
                    .required_environment
                    .iter()
                    .find(|name| !super::environment::provider_credential_available(name))
                {
                    return (
                        false,
                        format!("Required provider credential is not configured: {missing}"),
                    );
                }
                resolved.contribution.executable_candidates
            }
            _ => return (false, format!("Unsupported AgentDriver: {driver}")),
        },
    };
    let managed = resolve_extension_agent(driver)
        .ok()
        .flatten()
        .and_then(|resolved| resolved.contribution.toolchain)
        .and_then(|toolchain| {
            ovule_toolchains::resolve(&toolchain, &super::environment::managed_toolchains_path())
        });
    managed
        .or_else(|| {
            commands
                .iter()
                .find_map(|command| which::which(command).ok())
        })
        .map_or_else(
            || {
                (
                    false,
                    format!("Executable not found: {}", commands.join(" or ")),
                )
            },
            |path| (true, path.display().to_string()),
        )
}

fn model_provider_health(provider: &str, remote_id: &str) -> (bool, String) {
    let Ok(Some(package)) = resolve_extension_model_provider(provider) else {
        return (false, format!("Unsupported Model provider: {provider}"));
    };
    if let Some(missing) = package
        .manifest
        .permissions
        .secrets
        .iter()
        .find(|name| !super::environment::provider_credential_available(name))
    {
        return (
            false,
            format!("Provider credential is not configured: {missing}"),
        );
    }
    (
        true,
        format!("{provider} provider extension is ready for {remote_id}"),
    )
}

pub(super) fn is_supported_driver(driver: &str) -> bool {
    if driver == "ovule" || resolve_extension_agent(driver).is_ok_and(|value| value.is_some()) {
        return true;
    }
    #[cfg(any(test, feature = "test-driver"))]
    if driver == "test" {
        return true;
    }
    false
}

pub(super) fn tool_health(tool: &ToolRecord) -> (bool, String) {
    if !tool.enabled {
        return (false, "Disabled".to_owned());
    }
    if let Some(name) = &tool.credential_env
        && std::env::var_os(name).is_none()
    {
        return (
            false,
            format!("Credential environment variable is not set: {name}"),
        );
    }
    if tool.transport == "http" {
        return validate_http_url(&tool.target).map_or_else(
            |error| (false, error),
            |()| (true, "Streamable HTTP MCP server".to_owned()),
        );
    }
    if tool.transport == "native-crd" {
        return (true, "Native CRD Computer Use".to_owned());
    }
    resolved_tool_target(tool)
        .or_else(|| which::which(&tool.target).ok())
        .map_or_else(
            || (false, format!("Executable not found: {}", tool.target)),
            |path| (true, path.display().to_string()),
        )
}

pub(super) fn resolved_tool_target(tool: &ToolRecord) -> Option<PathBuf> {
    tool.toolchain_id.as_deref().and_then(|toolchain| {
        ovule_toolchains::resolve(toolchain, &super::environment::managed_toolchains_path())
    })
}
