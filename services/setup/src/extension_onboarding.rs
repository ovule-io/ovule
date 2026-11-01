use std::time::Duration;

use serde_json::Value;

use crate::state::Workspace;
use ovule_extensions::protocol::{
    OnboardingActionHandler, OnboardingContribution, OnboardingStatusHandler,
};
use ovule_extensions::providers::{load_extensions, resolve_extension_onboarding};

use super::support::{emit_revision, sanitize_id, transact};
use super::{
    ExtensionOnboardingActionView, ExtensionOnboardingView, ExtensionSetupActionInput,
    IntegrationStatus, NativeSetupService, SetupError,
};

pub(crate) fn extension_onboarding(
    service: &NativeSetupService,
) -> Result<Vec<ExtensionOnboardingView>, SetupError> {
    let packages = load_extensions().map_err(|error| SetupError::Persistence(error.to_string()))?;
    let mut views = Vec::new();
    let sources = std::iter::once((
        ovule_extensions::protocol::host::OWNER.to_owned(),
        ovule_extensions::protocol::host::contributions().onboarding,
    ))
    .chain(
        packages
            .into_iter()
            .map(|package| (package.manifest.id, package.manifest.contributes.onboarding)),
    );
    for (owner, setups) in sources {
        for setup in setups {
            let status = setup_status(service, &setup);
            views.push(ExtensionOnboardingView {
                tag: setup.tag.clone().or_else(|| {
                    (owner == ovule_extensions::protocol::host::OWNER)
                        .then(|| "ovule-onboarding".to_owned())
                }),
                extension_id: owner.clone(),
                id: setup.id.clone(),
                label: setup.label.clone(),
                description: setup.description.clone(),
                icon: setup.icon.clone(),
                agent_ids: setup.agent_ids.clone(),
                model_provider: setup.model_provider.clone(),
                input_fields: setup.fields.iter().map(|field| field.id.clone()).collect(),
                actions: setup
                    .actions
                    .iter()
                    .map(|action| ExtensionOnboardingActionView {
                        requires_authentication: !matches!(
                            action.handler,
                            OnboardingActionHandler::ToolchainInstall
                                | OnboardingActionHandler::ConnectivityDisable
                        ),
                        id: action.id.clone(),
                        required_toolchains: action.toolchains.clone(),
                    })
                    .collect(),
                allowed_links: setup.links.iter().map(|link| link.url.clone()).collect(),
                status,
            });
        }
    }
    Ok(views)
}

#[allow(clippy::too_many_lines)] // Dispatch remains centralized so secrets never cross into Extension JavaScript.
pub(crate) fn run_extension_setup_action(
    service: &NativeSetupService,
    input: &ExtensionSetupActionInput,
) -> Result<Option<String>, SetupError> {
    let resolved = resolve_extension_onboarding(&input.extension_id, &input.setup_id)
        .map_err(|error| SetupError::Persistence(error.to_string()))?
        .ok_or_else(|| SetupError::InvalidArgument("unknown Extension setup".to_owned()))?;
    let setup = resolved.contribution;
    let action = setup
        .actions
        .iter()
        .find(|action| action.id == input.action_id)
        .ok_or_else(|| SetupError::InvalidArgument("unknown Extension setup action".to_owned()))?;
    let values = input
        .values
        .iter()
        .map(|item| (item.id.as_str(), item.value.as_str()))
        .collect::<std::collections::BTreeMap<_, _>>();
    if values.len() != input.values.len()
        || values
            .keys()
            .any(|id| !setup.fields.iter().any(|field| field.id == *id))
    {
        return Err(SetupError::InvalidArgument(
            "invalid Extension setup values".to_owned(),
        ));
    }
    let mut authorization_url = None;
    match action.handler {
        OnboardingActionHandler::ConnectivityConfigure => {
            let key_field = action.key_field.as_deref().expect("validated key field");
            let token_field = action.field.as_deref().expect("validated token field");
            let config = ovule_cloudflare_connectivity::CloudflareTurnConfig {
                key_id: values
                    .get(key_field)
                    .copied()
                    .unwrap_or_default()
                    .trim()
                    .to_owned(),
                api_token: valid_secret(values.get(token_field).copied().unwrap_or_default())?
                    .to_owned(),
            };
            config.validate().map_err(SetupError::InvalidArgument)?;
            // Verify before replacing the saved configuration. This validates
            // credentials; the desktop connection separately validates ICE.
            config.probe().map_err(SetupError::Persistence)?;
            let encoded = serde_json::to_string(&config)
                .map_err(|_| SetupError::Persistence("encode connection configuration".into()))?;
            service
                .secrets
                .save_provider_credential(ovule_cloudflare_connectivity::CONFIG_REFERENCE, &encoded)
                .map_err(SetupError::Persistence)?;
        }
        OnboardingActionHandler::ConnectivityTest => {
            let encoded = service
                .secrets
                .load_provider_credential(ovule_cloudflare_connectivity::CONFIG_REFERENCE)
                .map_err(SetupError::Persistence)?
                .ok_or_else(|| {
                    SetupError::InvalidArgument(
                        "Configure the connection service on this Host first".into(),
                    )
                })?;
            let config: ovule_cloudflare_connectivity::CloudflareTurnConfig =
                serde_json::from_str(&encoded.to_string_lossy()).map_err(|_| {
                    SetupError::InvalidArgument("Run connection setup again".into())
                })?;
            config.probe().map_err(SetupError::Persistence)?;
        }
        OnboardingActionHandler::ConnectivityDisable => {
            service
                .secrets
                .save_provider_credential(ovule_cloudflare_connectivity::CONFIG_REFERENCE, "")
                .map_err(SetupError::Persistence)?;
        }
        OnboardingActionHandler::ToolchainInstall => {
            for id in &action.toolchains {
                if ovule_toolchains::resolve(id, service.managed_toolchains.as_path()).is_none() {
                    return Err(SetupError::Persistence(format!("Install {id} first")));
                }
            }
        }

        OnboardingActionHandler::AuthorizationLaunch
        | OnboardingActionHandler::AuthorizationStdin => {
            let toolchain = action
                .toolchain
                .as_deref()
                .expect("validated setup toolchain");
            let executable =
                ovule_toolchains::resolve(toolchain, service.managed_toolchains.as_path())
                    .ok_or_else(|| SetupError::Persistence(format!("Install {toolchain} first")))?;
            let args = action.args.iter().map(String::as_str).collect::<Vec<_>>();
            let execution_path =
                ovule_toolchains::execution_path(service.managed_toolchains.as_path())
                    .map_err(SetupError::Persistence)?;
            if action.handler == OnboardingActionHandler::AuthorizationLaunch {
                authorization_url = service
                    .agent_commands
                    .launch_authorization(
                        &executable,
                        &args,
                        Some(&execution_path),
                        action.authorization.clone().ok_or_else(|| {
                            SetupError::InvalidArgument("Missing authorization protocol".into())
                        })?,
                    )
                    .map_err(SetupError::Persistence)?;
            } else {
                let field = action.field.as_deref().expect("validated setup field");
                let secret = valid_secret(values.get(field).copied().unwrap_or_default())?;
                service
                    .agent_commands
                    .run_authorization(
                        &executable,
                        &args,
                        Some(format!("{secret}\n")),
                        Some(&execution_path),
                    )
                    .map_err(SetupError::Persistence)?;
            }
        }
        OnboardingActionHandler::ModelProviderConfigure
        | OnboardingActionHandler::ModelProviderRefresh => {
            let provider = action
                .provider
                .as_deref()
                .expect("validated setup provider");
            let credential = action
                .credential_reference
                .as_deref()
                .expect("validated setup credential");
            let saved_secret;
            let secret = if action.handler == OnboardingActionHandler::ModelProviderRefresh {
                saved_secret = service
                    .secrets
                    .load_provider_credential(credential)
                    .map_err(SetupError::Persistence)?
                    .ok_or_else(|| {
                        SetupError::InvalidArgument(
                            "Configure provider credentials before refreshing models".to_owned(),
                        )
                    })?;
                valid_secret(saved_secret.to_str().ok_or_else(|| {
                    SetupError::InvalidArgument(
                        "Stored provider credential is not valid UTF-8".to_owned(),
                    )
                })?)?
            } else {
                let field = action.field.as_deref().expect("validated setup field");
                valid_secret(values.get(field).copied().unwrap_or_default())?
            };
            let endpoint = action
                .endpoint
                .as_deref()
                .expect("validated setup endpoint");
            let grant = resolved
                .package
                .as_ref()
                .ok_or_else(|| {
                    SetupError::InvalidArgument(
                        "Host setup does not grant remote model discovery".to_owned(),
                    )
                })?
                .declared_grant()
                .map_err(|error| SetupError::Persistence(error.to_string()))?;
            grant
                .authorize(&ovule_extensions::protocol::HostRequest {
                    id: "provider-model-discovery".to_owned(),
                    operation: ovule_extensions::protocol::HostOperation::HttpRequest {
                        method: "GET".to_owned(),
                        endpoint: endpoint.to_owned(),
                        body: Vec::new(),
                    },
                })
                .map_err(|error| SetupError::Persistence(error.to_string()))?;
            let endpoint = test_models_endpoint(provider, endpoint)?;
            let remote_models =
                fetch_models(secret, &endpoint, provider).map_err(SetupError::Persistence)?;
            if action.handler == OnboardingActionHandler::ModelProviderConfigure {
                service
                    .secrets
                    .save_provider_credential(credential, secret)
                    .map_err(SetupError::Persistence)?;
            }
            persist_provider_models(service, provider, &remote_models)?;
        }
        OnboardingActionHandler::ModelProviderPull => {
            let field = action.field.as_deref().expect("validated setup field");
            let model = values.get(field).copied().unwrap_or_default().trim();
            if model.is_empty() || model.len() > 256 || model.chars().any(char::is_control) {
                return Err(SetupError::InvalidArgument(
                    "Local model name is missing or invalid".to_owned(),
                ));
            }
            service
                .models
                .start_pull(model)
                .map_err(SetupError::Persistence)?;
        }
    }
    Ok(authorization_url)
}

fn fetch_models(api_key: &str, endpoint: &str, provider: &str) -> Result<Vec<String>, String> {
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_connect(Some(Duration::from_secs(5)))
        .timeout_recv_response(Some(Duration::from_secs(15)))
        .timeout_recv_body(Some(Duration::from_secs(15)))
        .build()
        .into();
    let mut response = agent
        .get(endpoint)
        .header("Authorization", &format!("Bearer {api_key}"))
        .call()
        .map_err(|error| format!("{provider} rejected the API key or model request: {error}"))?;
    let body = response
        .body_mut()
        .with_config()
        .limit(1024 * 1024)
        .read_to_string()
        .map_err(|error| format!("read {provider} model catalog: {error}"))?;
    parse_models(&body, provider)
}

fn test_models_endpoint(provider: &str, endpoint: &str) -> Result<String, SetupError> {
    const TEST_MODE_ENV: &str = "OVULE_TEST_MODE";
    const TEST_ENDPOINT_ENV: &str = "OVULE_TEST_DEEPSEEK_MODELS_ENDPOINT";

    if provider != "deepseek" {
        return Ok(endpoint.to_owned());
    }
    let Ok(candidate) = std::env::var(TEST_ENDPOINT_ENV) else {
        return Ok(endpoint.to_owned());
    };
    if std::env::var(TEST_MODE_ENV).as_deref() != Ok("1") {
        return Err(SetupError::Persistence(format!(
            "{TEST_ENDPOINT_ENV} requires {TEST_MODE_ENV}=1"
        )));
    }
    let endpoint = url::Url::parse(&candidate)
        .map_err(|error| SetupError::Persistence(format!("parse test model endpoint: {error}")))?;
    let is_loopback = match endpoint.host() {
        Some(url::Host::Domain(host)) => host.eq_ignore_ascii_case("localhost"),
        Some(url::Host::Ipv4(ip)) => ip.is_loopback(),
        Some(url::Host::Ipv6(ip)) => ip.is_loopback(),
        None => false,
    };
    if endpoint.scheme() != "http"
        || !is_loopback
        || !endpoint.username().is_empty()
        || endpoint.password().is_some()
        || endpoint.query().is_some()
        || endpoint.fragment().is_some()
    {
        return Err(SetupError::Persistence(format!(
            "{TEST_ENDPOINT_ENV} must be a loopback HTTP URL without credentials, query, or fragment"
        )));
    }
    Ok(endpoint.to_string())
}

fn parse_models(source: &str, provider: &str) -> Result<Vec<String>, String> {
    let value: serde_json::Value = serde_json::from_str(source)
        .map_err(|error| format!("parse {provider} model catalog: {error}"))?;
    let mut models = value
        .get("data")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|model| model.get("id").and_then(Value::as_str))
        .filter(|id| !id.is_empty() && id.len() <= 160)
        .map(str::to_owned)
        .collect::<Vec<_>>();
    models.sort();
    models.dedup();
    if models.is_empty() {
        return Err(format!("{provider} returned no usable models"));
    }
    Ok(models)
}

fn provider_model_label(remote_id: &str) -> String {
    match remote_id {
        "deepseek-flash" => "DeepSeek Flash".to_owned(),
        "deepseek-v4-pro" => "DeepSeek V4 Pro".to_owned(),
        _ => remote_id.to_owned(),
    }
}

fn persist_provider_models(
    service: &NativeSetupService,
    provider: &str,
    remote_models: &[String],
) -> Result<(), SetupError> {
    let existing = service.state.read(Workspace::snapshot).models;
    let additions = remote_models
        .iter()
        .filter(|remote_id| {
            !existing
                .iter()
                .any(|model| model.provider == provider && model.remote_id == **remote_id)
        })
        .cloned()
        .collect::<Vec<_>>();
    if additions.is_empty() {
        return Ok(());
    }
    transact(
        &service.state,
        "provider/models-discovered",
        Some(provider),
        &serde_json::json!({"provider": provider, "count": remote_models.len()}),
        |workspace| {
            for remote_id in &additions {
                workspace.upsert_model(
                    &format!("{}-api-{}", sanitize_id(provider), sanitize_id(remote_id)),
                    &provider_model_label(remote_id),
                    provider,
                    remote_id,
                    true,
                    vec!["ovule".to_owned()],
                )?;
            }
            Ok(())
        },
    )?;
    emit_revision(
        service.events.as_ref(),
        service.state.read(Workspace::revision),
    );
    Ok(())
}

fn setup_status(service: &NativeSetupService, setup: &OnboardingContribution) -> IntegrationStatus {
    match setup.status.handler {
        OnboardingStatusHandler::ConnectivityConfigured => {
            let authenticated = service
                .secrets
                .load_provider_credential(ovule_cloudflare_connectivity::CONFIG_REFERENCE)
                .ok()
                .flatten()
                .and_then(|value| {
                    serde_json::from_str::<ovule_cloudflare_connectivity::CloudflareTurnConfig>(
                        &value.to_string_lossy(),
                    )
                    .ok()
                })
                .is_some_and(|config| config.validate().is_ok());
            IntegrationStatus {
                id: setup.id.clone(),
                available: true,
                authenticated,
                detail: if authenticated {
                    setup.status.ready_detail.clone()
                } else {
                    setup.status.missing_detail.clone()
                },
            }
        }
        OnboardingStatusHandler::SecretConfigured => {
            let credential = setup
                .status
                .credential_reference
                .as_deref()
                .expect("validated setup credential");
            let authenticated = std::env::var_os(credential).is_some()
                || service
                    .secrets
                    .has_provider_credential(credential)
                    .unwrap_or(false);
            IntegrationStatus {
                id: setup.id.clone(),
                available: true,
                authenticated,
                detail: if authenticated {
                    setup.status.ready_detail.clone()
                } else {
                    setup.status.missing_detail.clone()
                },
            }
        }
        OnboardingStatusHandler::CommandProbe => {
            let toolchain = setup
                .status
                .toolchain
                .as_deref()
                .expect("validated toolchain");
            let Some(executable) =
                ovule_toolchains::resolve(toolchain, service.managed_toolchains.as_path())
            else {
                return IntegrationStatus {
                    id: setup.id.clone(),
                    available: false,
                    authenticated: false,
                    detail: setup.status.missing_detail.clone(),
                };
            };
            let args = setup
                .status
                .args
                .iter()
                .map(String::as_str)
                .collect::<Vec<_>>();
            match service.agent_commands.probe_executable(&executable, &args) {
                Ok(_) => IntegrationStatus {
                    id: setup.id.clone(),
                    available: true,
                    authenticated: true,
                    detail: setup.status.ready_detail.clone(),
                },
                Err(_) => IntegrationStatus {
                    id: setup.id.clone(),
                    available: true,
                    authenticated: false,
                    detail: setup.status.missing_detail.clone(),
                },
            }
        }
    }
}

fn valid_secret(value: &str) -> Result<&str, SetupError> {
    let value = value.trim();
    if value.len() < 20 || value.len() > 8_192 || value.chars().any(char::is_whitespace) {
        Err(SetupError::InvalidArgument(
            "Provider credential is missing or invalid".to_owned(),
        ))
    } else {
        Ok(value)
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn parses_deep_seek_model_catalog() {
        assert_eq!(
            super::parse_models(
                r#"{"data":[{"id":"deepseek-v4-pro"},{"id":"deepseek-flash"},{"id":"deepseek-v4-special"}]}"#,
                "deepseek",
            )
            .unwrap(),
            ["deepseek-flash", "deepseek-v4-pro", "deepseek-v4-special"]
        );
        assert!(super::parse_models(r#"{"data":[]}"#, "deepseek").is_err());
    }
}
