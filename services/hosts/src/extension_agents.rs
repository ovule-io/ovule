use crate::{HostAgentDescriptor, HostAgentRuntime};
use ovule_extensions::runtime::ExtensionAgentRuntime;
use std::{collections::BTreeMap, path::PathBuf, sync::Arc};
pub(crate) fn prepare_extension_host_agent(
    extensions: &dyn ExtensionAgentRuntime,
    managed_toolchains: &std::path::Path,
    agent_id: &str,
    model_provider: Option<&str>,
    model_remote_id: Option<&str>,
) -> Result<(Vec<String>, BTreeMap<String, String>), String> {
    let resolved = ovule_extensions::providers::resolve_extension_agent(agent_id)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| format!("Agent is not installed on this Host: {agent_id}"))?;
    let plan = extensions.prepare_agent(
        &resolved.package,
        &resolved.contribution,
        serde_json::json!({
            "agent": { "id": agent_id },
            "model": model_remote_id.map(|remote_id| serde_json::json!({
                "remoteId": remote_id,
                "provider": model_provider,
            })),
        }),
    )?;
    let command = resolved
        .contribution
        .toolchain
        .as_deref()
        .and_then(|toolchain| ovule_toolchains::resolve(toolchain, managed_toolchains))
        .or_else(|| {
            plan.executable_candidates
                .iter()
                .find_map(|candidate| which::which(candidate).ok())
        })
        .ok_or_else(|| {
            format!(
                "ACP server is not installed on this Host: {}",
                plan.executable_candidates.join(" or ")
            )
        })?;
    let mut argv = vec![command.to_string_lossy().into_owned()];
    argv.extend(plan.args);
    let environment = plan
        .environment
        .into_iter()
        .map(|entry| (entry.name, entry.value))
        .collect();
    Ok((argv, environment))
}

fn resolve_host_program(program: &str, managed_toolchains: &std::path::Path) -> Option<PathBuf> {
    let agent = ovule_extensions::providers::resolve_extension_agent_for_executable(program)
        .ok()
        .flatten()?;
    agent
        .toolchain
        .as_deref()
        .and_then(|toolchain| ovule_toolchains::resolve(toolchain, managed_toolchains))
        .or_else(|| which::which(program).ok())
}

fn host_agent_id(program: &str) -> Option<String> {
    ovule_extensions::providers::resolve_extension_agent_for_executable(program)
        .ok()
        .flatten()
        .map(|agent| agent.id)
}

fn host_agents(managed_toolchains: &std::path::Path) -> Vec<HostAgentDescriptor> {
    std::iter::once(HostAgentDescriptor {
        id: "ovule".to_owned(),
        available: true,
    })
    .chain(
        ovule_extensions::providers::resolved_extension_agents()
            .unwrap_or_default()
            .into_iter()
            .map(|resolved| {
                let available = resolved
                    .contribution
                    .toolchain
                    .as_deref()
                    .and_then(|toolchain| ovule_toolchains::resolve(toolchain, managed_toolchains))
                    .or_else(|| {
                        resolved
                            .contribution
                            .executable_candidates
                            .iter()
                            .find_map(|candidate| which::which(candidate).ok())
                    })
                    .is_some();
                HostAgentDescriptor {
                    id: resolved.contribution.id,
                    available,
                }
            }),
    )
    .collect()
}

pub(crate) struct ExtensionHostAgentRuntime(pub Arc<dyn ExtensionAgentRuntime>);
impl HostAgentRuntime for ExtensionHostAgentRuntime {
    fn prepare(
        &self,
        root: &std::path::Path,
        agent: &str,
        provider: Option<&str>,
        model: Option<&str>,
    ) -> Result<(Vec<String>, BTreeMap<String, String>), String> {
        prepare_extension_host_agent(self.0.as_ref(), root, agent, provider, model)
    }
    fn resolve_program(&self, program: &str, root: &std::path::Path) -> Option<PathBuf> {
        resolve_host_program(program, root)
    }
    fn agent_id(&self, program: &str) -> Option<String> {
        host_agent_id(program)
    }
    fn agents(&self, root: &std::path::Path) -> Vec<HostAgentDescriptor> {
        host_agents(root)
    }
}
