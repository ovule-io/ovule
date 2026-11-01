use std::sync::Arc;
/// Register the lifecycle owner and consumer capabilities independently.
pub fn register<C: Send + Sync + 'static>(
    registrar: &mut impl tuffite_ioc::Registrar<C>,
) -> tuffite_ioc::Result<()> {
    use tuffite_ioc::Service;
    ovule_agent::providers::register(registrar)?;
    super::capabilities::register(registrar)?;
    #[cfg(not(feature = "native-framework"))]
    ovule_agent::execution::approval::register_unavailable_events(registrar)?;
    registrar.register(tuffite_ioc::factory::<
        ovule_agent::execution::approval::ApprovalRuntime,
        _,
        _,
    >(|deps| {
        Ok(Arc::new(
            ovule_agent::execution::approval::ApprovalBroker::new(
                deps.depends_on::<Service<dyn ovule_agent::execution::approval::ApprovalEvents>>()?,
            )
            .with_reviewer(Arc::new(super::approval::HostReviewer)),
        ))
    }))?;
    registrar.register(tuffite_ioc::factory::<
        crate::agent_host::ExecutionJournalRuntime,
        _,
        _,
    >(|deps| {
        let root = deps.depends_on::<Service<ovule_workspace::WorkspaceDataRoot>>()?;
        Ok(Arc::new(std::sync::Mutex::new(
            ovule_storage::journal::CallJournal::open(
                &root.0.join("agent").join("execution.sqlite"),
            )?,
        )))
    }))?;
    registrar.register_eager(tuffite_ioc::factory::<
        crate::agent_host::AgentRuntimeService,
        _,
        _,
    >(|deps| {
        let root = deps.depends_on::<Service<ovule_toolchains::ToolchainRoot>>()?;
        let runtime = super::DriverHost::new_with_journal(
            root.0.clone(),
            deps.depends_on::<ovule_memory::MemoryRuntime>()?,
            deps.depends_on::<ovule_browser::BrowserRuntime>()?,
            deps.depends_on::<Service<dyn ovule_secrets::SecretStore>>()?,
            deps.depends_on::<Service<super::capabilities::ProviderAssembly>>()?,
            deps.depends_on::<Service<ovule_agent::AgentKernel>>()?,
            deps.depends_on::<Service<dyn ovule_hosts::WorkspaceTransportResolver>>()?,
            deps.depends_on::<Service<dyn ovule_extensions::runtime::ExtensionAgentRuntime>>()?,
            deps.depends_on::<Service<dyn ovule_remoting::backend::ComputerUseHost>>()?,
            deps.depends_on::<crate::agent_host::ExecutionJournalRuntime>()?,
        )?
        .with_approvals(deps.depends_on::<ovule_agent::execution::approval::ApprovalRuntime>()?);
        let runtime: Box<dyn crate::agent_host::AgentRuntime> = Box::new(runtime);
        Ok(Arc::new(std::sync::Mutex::new(runtime)))
    }))?;
    registrar.register(tuffite_ioc::factory::<
        Service<ovule_hosts::HostComputerUseEndpoint>,
        _,
        _,
    >(|deps| {
        let owner = deps.depends_on::<crate::agent_host::AgentRuntimeService>()?;
        let owner = owner.lock().map_err(|_| "Agent lifecycle lock poisoned")?;
        Ok(Arc::new(ovule_hosts::HostComputerUseEndpoint(
            owner.computer_use_mcp_endpoint(),
        )))
    }))?;
    registrar.register(tuffite_ioc::factory::<
        Service<dyn crate::agent_host::AgentRuntimeSession>,
        _,
        _,
    >(|deps| {
        let owner = deps.depends_on::<crate::agent_host::AgentRuntimeService>()?;
        let owner = owner
            .lock()
            .map_err(|_| "Agent runtime lifecycle lock poisoned".to_owned())?;
        Ok(owner.sessions())
    }))?;
    registrar.register(tuffite_ioc::factory::<
        Service<dyn ovule_conversation::AgentSessionService>,
        _,
        _,
    >(|deps| {
        Ok(deps.depends_on::<Service<dyn crate::agent_host::AgentRuntimeSession>>()?)
    }))?;
    registrar.register(tuffite_ioc::factory::<
        Service<dyn ovule_setup::SetupAgentCommands>,
        _,
        _,
    >(|deps| {
        Ok(deps.depends_on::<Service<dyn crate::agent_host::AgentRuntimeSession>>()?)
    }))?;

    Ok(())
}

#[cfg(feature = "native-framework")]
pub fn register_framework<
    C: AsRef<crate::agent_host::framework::Context> + Send + Sync + 'static,
>(
    registrar: &mut impl tuffite_ioc::Registrar<C>,
) -> tuffite_ioc::Result<()> {
    crate::agent_host::framework::register(registrar)
}
