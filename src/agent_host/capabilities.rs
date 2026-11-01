//! Application composition of domain-owned capability providers.
use super::{context::ContextTools, drivers::acp::AcpWorkspaceRoot};
use ovule_agent_api::CapabilityProvider;
use ovule_hosts::capability::computer::ComputerUse;
use ovule_settings::catalog::ToolRecord;
use std::{path::Path, sync::Arc};

pub(crate) struct ProviderAssembly {
    channels: Arc<dyn ovule_channels::ChannelToolHost>,
    browser: Arc<ovule_browser::BrowserBroker>,
    policy: Arc<ovule_hosts::execution::ExecutionPolicy>,
}
impl ProviderAssembly {
    pub fn new(
        channels: Arc<dyn ovule_channels::ChannelToolHost>,
        browser: Arc<ovule_browser::BrowserBroker>,
    ) -> Self {
        Self {
            channels,
            browser,
            policy: Arc::new(ovule_hosts::execution::ExecutionPolicy::default()),
        }
    }
    #[allow(clippy::too_many_arguments)]
    pub(in crate::agent_host) fn build(
        &self,
        context: &ContextTools,
        roots: &[AcpWorkspaceRoot],
        computer: Option<ComputerUse>,
        tools: &[ToolRecord],
        workspace: &Path,
        attempt_id: &str,
        thread_id: &str,
        local: bool,
    ) -> Vec<Arc<dyn CapabilityProvider>> {
        let mut providers = context.providers();
        providers.push(ovule_channels::capability::provider(
            self.channels.clone(),
            attempt_id.into(),
        ));
        if !roots.is_empty() {
            providers.push(ovule_hosts::capability::provider_with_policy(
                roots
                    .iter()
                    .map(|root| ovule_hosts::capability::WorkspaceCapability {
                        id: root.id.clone(),
                        transport: root.transport.clone(),
                    })
                    .collect(),
                (*self.policy).clone(),
            ));
        }
        if let Some(computer) = computer {
            providers.push(ovule_hosts::capability::computer::provider(computer));
        }
        if local {
            providers.push(ovule_browser::capability::provider(
                self.browser.clone(),
                attempt_id.into(),
                thread_id.into(),
            ));
        }
        let selected = tools
            .iter()
            .filter(|t| t.enabled && t.transport != "native-crd")
            .map(|t| ovule_hosts::mcp::McpProviderSpec {
                id: t.id.clone(),
                label: t.label.clone(),
                transport: t.transport.clone(),
                target: t.target.clone(),
                args: t.args.clone(),
                credential_env: t.credential_env.clone(),
            })
            .collect::<Vec<_>>();
        providers.extend(ovule_hosts::mcp::providers(&selected, workspace));
        providers
    }
}
pub fn register<C: Send + Sync + 'static>(
    r: &mut impl tuffite_ioc::Registrar<C>,
) -> tuffite_ioc::Result<()> {
    use tuffite_ioc::Service;
    r.register(tuffite_ioc::factory::<
        Service<ovule_hosts::execution::ExecutionPolicy>,
        _,
        _,
    >(|d| {
        let root = d.depends_on::<Service<ovule_workspace::WorkspaceDataRoot>>()?;
        let policy = ovule_hosts::execution::ExecutionPolicy::load(
            &root.0.join("agent/execution-policy.json"),
        )?;
        Ok(Arc::new(policy))
    }))?;
    r.register(tuffite_ioc::factory::<Service<ProviderAssembly>, _, _>(
        |d| {
            let mut assembly = ProviderAssembly::new(
                d.depends_on::<Service<dyn ovule_channels::ChannelToolHost>>()?,
                d.depends_on::<ovule_browser::BrowserRuntime>()?,
            );
            assembly.policy = d.depends_on::<Service<ovule_hosts::execution::ExecutionPolicy>>()?;
            Ok(Arc::new(assembly))
        },
    ))?;
    Ok(())
}
