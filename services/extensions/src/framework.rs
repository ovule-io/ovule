pub(crate) type Context = tuffite::ApplicationContext;
use std::sync::Arc;
use tuffite_ioc::Service;

pub(crate) fn register<C: AsRef<Context> + Send + Sync + 'static>(
    registrar: &mut impl tuffite_ioc::Registrar<C>,
) -> tuffite_ioc::Result<()> {
    registrar.register(tuffite_ioc::factory::<Service<ExtensionRuntimeHost>, _, _>(
        |build| {
            let context: &C = build.context();
            let browser = context.as_ref();
            Ok(Arc::new(ExtensionRuntimeHost::new(
                browser.javascript_extensions(),
                browser.utility_sessions(),
            )))
        },
    ))?;
    registrar.register(tuffite_ioc::factory::<
        Service<dyn crate::runtime::ExtensionAgentRuntime>,
        _,
        _,
    >(|deps| {
        Ok(deps.depends_on::<Service<ExtensionRuntimeHost>>()?)
    }))?;
    registrar.register(tuffite_ioc::factory::<
        Service<dyn ExtensionWorkerRuntime>,
        _,
        _,
    >(|deps| {
        Ok(deps.depends_on::<Service<ExtensionRuntimeHost>>()?)
    }))?;

    Ok(())
}

use std::collections::BTreeSet;
use std::sync::mpsc;
use std::time::Duration;

use serde::Deserialize;
use serde::de::DeserializeOwned;
use serde_json::Value;
use tuffite::{
    JavaScriptExtensionHost, UtilitySessionHost, UtilitySessionHostError, UtilitySessionOptions,
};

use crate::protocol::{AgentContribution, ExtensionRuntime, SpawnPlan, ValidatedExtensionPackage};

const EXTENSION_OPEN_TIMEOUT: Duration = Duration::from_secs(10);
const EXTENSION_CALL_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ExtensionDescriptor {
    pub(crate) id: String,
    pub(crate) api_version: u32,
    pub(crate) capabilities: Vec<String>,
    pub(crate) handlers: ExtensionHandlers,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ExtensionHandlers {
    pub(crate) agents: Vec<String>,
    pub(crate) model_providers: Vec<String>,
    pub(crate) channels: Vec<String>,
}

use crate::runtime::ModelProviderPlan;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ChannelSetupPlan {
    regions: Vec<String>,
    secret_fields: Vec<String>,
    transport: String,
    worker: ChannelWorkerPlan,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ChannelWorkerPlan {
    module: String,
    executable_candidates: Vec<String>,
    toolchain: Option<String>,
    protocol: String,
}

use crate::runtime::{ExtensionWorkerRuntime, ResolvedChannelWorker};

/// Executes extension hooks through a Tuffite-managed Utility boundary.
///
/// JavaScript packages use the restricted V8 service. Native extensions use a
/// statically registered Rust `UtilityService` selected by manifest service name;
/// arbitrary libraries are never loaded into the browser process.
#[derive(Clone, Debug)]
pub(crate) struct ExtensionRuntimeHost {
    javascript: JavaScriptExtensionHost,
    utility: UtilitySessionHost,
}

impl ExtensionRuntimeHost {
    pub(crate) const fn new(
        javascript: JavaScriptExtensionHost,
        utility: UtilitySessionHost,
    ) -> Self {
        Self {
            javascript,
            utility,
        }
    }

    pub(crate) fn describe(
        &self,
        package: &ValidatedExtensionPackage,
    ) -> Result<ExtensionDescriptor, String> {
        let descriptor: ExtensionDescriptor = self.call(package, "describe", &[])?;
        if descriptor.id != package.manifest.id || descriptor.api_version != 1 {
            return Err(format!(
                "extension descriptor does not match manifest: {}",
                package.manifest.id
            ));
        }
        let declared_agents = package
            .manifest
            .contributes
            .agents
            .iter()
            .map(|item| item.id.as_str())
            .collect::<BTreeSet<_>>();
        let declared_providers = package
            .manifest
            .contributes
            .models
            .iter()
            .map(|item| item.provider.as_str())
            .collect::<BTreeSet<_>>();
        let declared_channels = package
            .manifest
            .contributes
            .channels
            .iter()
            .map(|item| item.id.as_str())
            .collect::<BTreeSet<_>>();
        let handled_agents = descriptor
            .handlers
            .agents
            .iter()
            .map(String::as_str)
            .collect::<BTreeSet<_>>();
        let handled_providers = descriptor
            .handlers
            .model_providers
            .iter()
            .map(String::as_str)
            .collect::<BTreeSet<_>>();
        let handled_channels = descriptor
            .handlers
            .channels
            .iter()
            .map(String::as_str)
            .collect::<BTreeSet<_>>();
        if handled_agents.len() != descriptor.handlers.agents.len()
            || handled_providers.len() != descriptor.handlers.model_providers.len()
            || handled_channels.len() != descriptor.handlers.channels.len()
            || handled_agents != declared_agents
            || handled_providers != declared_providers
            || handled_channels != declared_channels
        {
            return Err(format!(
                "extension runtime handlers do not match manifest: {}",
                package.manifest.id
            ));
        }
        Ok(descriptor)
    }

    pub(crate) fn prepare_agent(
        &self,
        package: &ValidatedExtensionPackage,
        agent: &AgentContribution,
        input: Value,
    ) -> Result<SpawnPlan, String> {
        let descriptor = self.describe(package)?;
        if !descriptor
            .capabilities
            .iter()
            .any(|capability| capability == "agent-driver")
            || !descriptor.handlers.agents.iter().any(|id| id == &agent.id)
        {
            return Err(format!(
                "extension descriptor does not expose AgentDriver {}",
                agent.id
            ));
        }
        let plan: SpawnPlan = self.call(
            package,
            "prepareAgent",
            &[Value::String(agent.id.clone()), input],
        )?;
        plan.validate_for(&package.manifest, agent)
            .map_err(|error| error.to_string())?;
        Ok(plan)
    }

    pub(crate) fn prepare_model_provider(
        &self,
        package: &ValidatedExtensionPackage,
        provider: &str,
        input: Value,
    ) -> Result<ModelProviderPlan, String> {
        let requested_model = input
            .as_object()
            .and_then(|value| value.get("model"))
            .and_then(Value::as_str)
            .filter(|value| {
                !value.is_empty() && value.len() <= 160 && !value.chars().any(char::is_control)
            })
            .map(str::to_owned)
            .ok_or_else(|| "model-provider request has an invalid model id".to_owned())?;
        let descriptor = self.describe(package)?;
        if !descriptor
            .capabilities
            .iter()
            .any(|capability| capability == "model-provider")
        {
            return Err("extension descriptor does not expose a model provider".to_owned());
        }
        if !descriptor
            .handlers
            .model_providers
            .iter()
            .any(|id| id == provider)
        {
            return Err(format!(
                "extension descriptor does not expose Model Provider {provider}"
            ));
        }
        let plan: ModelProviderPlan = self.call(
            package,
            "prepareModelProvider",
            &[Value::String(provider.to_owned()), input],
        )?;
        if plan.provider != provider
            || plan.model != requested_model
            || !package
                .manifest
                .permissions
                .secrets
                .contains(&plan.credential_reference)
        {
            return Err("model-provider extension returned an invalid provider plan".to_owned());
        }
        Ok(plan)
    }

    pub(crate) fn prepare_channel_worker(
        &self,
        channel_id: &str,
    ) -> Result<ResolvedChannelWorker, String> {
        let package = crate::providers::resolve_extension_channel(channel_id)
            .map_err(|error| error.to_string())?
            .ok_or_else(|| format!("channel extension is unavailable: {channel_id}"))?;
        let descriptor = self.describe(&package)?;
        if !descriptor
            .capabilities
            .iter()
            .any(|capability| capability == "long-connection")
        {
            return Err("channel extension does not expose long-connection".to_owned());
        }
        if !descriptor
            .handlers
            .channels
            .iter()
            .any(|id| id == channel_id)
        {
            return Err(format!(
                "extension descriptor does not expose Channel {channel_id}"
            ));
        }
        let plan: ChannelSetupPlan = self.call(
            &package,
            "setupChannel",
            &[Value::String(channel_id.to_owned()), Value::Null],
        )?;
        // The selected Channel ID can be a logical alias (e.g. `channel`).
        // Regional endpoints are independently declared channel contributions.
        if plan.regions.is_empty()
            || !plan.regions.iter().all(|region| {
                package
                    .manifest
                    .contributes
                    .channels
                    .iter()
                    .any(|channel| &channel.id == region)
            })
            || plan.secret_fields.is_empty()
            || plan
                .secret_fields
                .iter()
                .any(|field| !package.manifest.permissions.secrets.contains(field))
            || plan.transport != "websocket"
            || plan.worker.protocol != "jsonl-rpc"
            || plan.worker.executable_candidates.is_empty()
            || plan.worker.toolchain.as_deref().is_some_and(|id| {
                id.is_empty()
                    || !id.bytes().all(|byte| {
                        byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-')
                    })
            })
            || plan
                .worker
                .executable_candidates
                .iter()
                .any(|candidate| !package.manifest.permissions.process.contains(candidate))
        {
            return Err(format!(
                "channel extension returned an invalid worker plan: {channel_id}"
            ));
        }
        let module = package.root.join(&plan.worker.module);
        let metadata = std::fs::symlink_metadata(&module)
            .map_err(|error| format!("inspect channel worker module: {error}"))?;
        if !metadata.is_file()
            || metadata.file_type().is_symlink()
            || metadata.len() > 8 * 1024 * 1024
        {
            return Err("channel extension worker module is invalid".to_owned());
        }
        let canonical = std::fs::canonicalize(&module)
            .map_err(|error| format!("resolve channel worker module: {error}"))?;
        if !canonical.starts_with(&package.root)
            || canonical.extension().and_then(|value| value.to_str()) != Some("mjs")
        {
            return Err("channel extension worker module escapes its package".to_owned());
        }
        Ok(ResolvedChannelWorker {
            module: canonical,
            executable_candidates: plan.worker.executable_candidates,
            toolchain: plan.worker.toolchain,
        })
    }

    fn call<T: DeserializeOwned>(
        &self,
        package: &ValidatedExtensionPackage,
        method: &str,
        arguments: &[Value],
    ) -> Result<T, String> {
        let value = match &package.manifest.runtime {
            Some(ExtensionRuntime::JavaScript { .. }) => {
                let graph = package
                    .javascript_package()
                    .map_err(|error| error.to_string())?;
                let graph = tuffite::JavaScriptExtensionPackage::new(graph.entry.clone())
                    .and_then(|package| package.add_module(graph.entry, graph.source))
                    .map_err(|error| error.to_string())?;
                let (opened_sender, opened_receiver) = mpsc::sync_channel(1);
                let session = self
                    .javascript
                    .create(
                        &graph,
                        |_| {},
                        move |opened| {
                            let _ = opened_sender.send(opened.map_err(|error| error.to_string()));
                        },
                    )
                    .map_err(|error| error.to_string())?;
                opened_receiver
                    .recv_timeout(EXTENSION_OPEN_TIMEOUT)
                    .map_err(|_| "timed out opening JavaScript extension".to_owned())??;
                let (reply_sender, reply_receiver) = mpsc::sync_channel(1);
                session
                    .call(method, arguments, move |reply| {
                        let _ = reply_sender.send(reply.map_err(|error| error.to_string()));
                    })
                    .map_err(|error| error.to_string())?;
                let reply = reply_receiver
                    .recv_timeout(EXTENSION_CALL_TIMEOUT)
                    .map_err(|_| format!("extension method timed out: {method}"))??;
                let _ = session.close(0, |_| {});
                reply
            }
            Some(ExtensionRuntime::Utility { service }) => {
                let init = serde_json::to_vec(&serde_json::json!({
                    "schemaVersion": 1,
                    "extensionId": package.manifest.id,
                    "apiVersion": package.manifest.api_version,
                }))
                .map_err(|error| format!("encode Utility extension init: {error}"))?;
                let (opened_sender, opened_receiver) = mpsc::sync_channel(1);
                let session = self
                    .utility
                    .create(
                        service,
                        &UtilitySessionOptions {
                            init,
                            initial_event_credits: 1,
                            max_event_bytes: 256 * 1024,
                        },
                        |_| false,
                        |_| {},
                        move |opened| {
                            let _ = opened_sender.send(opened.map_err(|error| error.to_string()));
                        },
                    )
                    .map_err(|error| error.to_string())?;
                opened_receiver
                    .recv_timeout(EXTENSION_OPEN_TIMEOUT)
                    .map_err(|_| "timed out opening Utility extension".to_owned())??;
                let command = serde_json::to_vec(&serde_json::json!({
                    "method": method,
                    "args": arguments,
                }))
                .map_err(|error| format!("encode Utility extension call: {error}"))?;
                let (reply_sender, reply_receiver) = mpsc::sync_channel(1);
                session
                    .send(&command, move |reply| {
                        let reply = reply
                            .map_err(|error: UtilitySessionHostError| error.to_string())
                            .and_then(|bytes| {
                                serde_json::from_slice(&bytes).map_err(|error| {
                                    format!("decode Utility extension reply: {error}")
                                })
                            });
                        let _ = reply_sender.send(reply);
                    })
                    .map_err(|error| error.to_string())?;
                let reply = reply_receiver
                    .recv_timeout(EXTENSION_CALL_TIMEOUT)
                    .map_err(|_| format!("Utility extension method timed out: {method}"))??;
                let _ = session.close(0, |_| {});
                reply
            }
            None => return Err("declarative extension has no Host runtime".to_owned()),
        };
        serde_json::from_value(value).map_err(|error| {
            format!("extension method {method} returned an invalid value: {error}")
        })
    }
}

impl ExtensionWorkerRuntime for ExtensionRuntimeHost {
    fn prepare_channel_worker(&self, channel_type: &str) -> Result<ResolvedChannelWorker, String> {
        ExtensionRuntimeHost::prepare_channel_worker(self, channel_type)
    }
}

impl crate::runtime::ExtensionAgentRuntime for ExtensionRuntimeHost {
    fn prepare_agent(
        &self,
        package: &ValidatedExtensionPackage,
        agent: &AgentContribution,
        input: Value,
    ) -> Result<SpawnPlan, String> {
        Self::prepare_agent(self, package, agent, input)
    }
    fn prepare_model_provider(
        &self,
        package: &ValidatedExtensionPackage,
        provider: &str,
        input: Value,
    ) -> Result<ModelProviderPlan, String> {
        Self::prepare_model_provider(self, package, provider, input)
    }
}
