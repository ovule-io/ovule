#[path = "support/ioc.rs"]
mod ioc_support;
use ovule_channels::ChannelToolHost;
use ovule_conversation::AgentSessionService;
use ovule_extensions::runtime::ExtensionAgentRuntime;
use ovule_hosts::WorkspaceTransportResolver;
use ovule_secrets::SecretStore;
use serde_json::Value;
use std::{path::Path, sync::Arc, time::Duration};
struct NoChannelTools;
impl ChannelToolHost for NoChannelTools {
    fn invoke(&self, _: &str, _: &str, _: &Value) -> Result<Value, String> {
        Err("channel tools unavailable".into())
    }
}

struct NoExtensions;
impl ovule_extensions::runtime::ExtensionAgentRuntime for NoExtensions {
    fn prepare_agent(
        &self,
        _: &ovule_extensions::protocol::ValidatedExtensionPackage,
        _: &ovule_extensions::protocol::AgentContribution,
        _: Value,
    ) -> Result<ovule_extensions::protocol::SpawnPlan, String> {
        Err("extension runtime unavailable".into())
    }
    fn prepare_model_provider(
        &self,
        _: &ovule_extensions::protocol::ValidatedExtensionPackage,
        _: &str,
        _: Value,
    ) -> Result<ovule_extensions::runtime::ModelProviderPlan, String> {
        Err("extension runtime unavailable".into())
    }
}

struct NoTransports;
impl ovule_hosts::WorkspaceTransportResolver for NoTransports {
    fn resolve(
        &self,
        _: Option<&str>,
        _: &str,
    ) -> Result<Arc<dyn ovule_hosts::WorkspaceTransport>, ovule_hosts::TransportError> {
        Err(ovule_hosts::TransportError::Protocol(
            "transport unavailable".into(),
        ))
    }
}

#[test]
fn domain_factory_shares_sessions_and_shutdown_with_consumer_ports() {
    use ovule::agent_host::{AgentRuntimeService, AgentRuntimeSession};
    use tuffite_ioc::Service;
    let root = tempfile::tempdir().unwrap();
    let mut registry = tuffite_ioc::Registry::new(Arc::new(()));
    ovule::agent_host::providers::register(&mut registry).unwrap();
    registry
        .inject(Arc::new(ovule_workspace::WorkspaceDataRoot(
            root.path().into(),
        )))
        .unwrap();
    registry
        .inject(ovule_browser::providers::unavailable())
        .unwrap();
    registry
        .inject(Arc::new(
            ovule_memory::MemoryService::open(&root.path().join("memory.sqlite")).unwrap(),
        ))
        .unwrap();
    registry
        .inject(Arc::new(ovule_toolchains::ToolchainRoot(
            root.path().into(),
        )))
        .unwrap();
    registry
        .inject::<dyn SecretStore>(Arc::new(
            ovule_secrets::providers::open(&root.path().join("secrets.db")).unwrap(),
        ))
        .unwrap();
    registry
        .inject::<dyn ChannelToolHost>(Arc::new(NoChannelTools))
        .unwrap();
    registry
        .inject::<dyn WorkspaceTransportResolver>(Arc::new(NoTransports))
        .unwrap();
    registry
        .inject::<dyn ExtensionAgentRuntime>(Arc::new(NoExtensions))
        .unwrap();
    registry
        .inject(ovule_remoting::providers::unavailable_computer_use())
        .unwrap();
    registry.freeze();
    registry.initialize().unwrap();
    assert!(root.path().join("agent/execution.sqlite").is_file());
    let context = registry;
    let conversation = context.get::<Service<dyn AgentSessionService>>().unwrap();
    let setup = context
        .get::<Service<dyn ovule_setup::SetupAgentCommands>>()
        .unwrap();
    let sessions = context.get::<Service<dyn AgentRuntimeSession>>().unwrap();
    let expected_conversation: Arc<dyn AgentSessionService> = sessions.clone();
    let expected_setup: Arc<dyn ovule_setup::SetupAgentCommands> = sessions;
    assert!(Arc::ptr_eq(&conversation, &expected_conversation));
    assert!(Arc::ptr_eq(&setup, &expected_setup));
    let kernel = context
        .cached::<Service<ovule_agent::AgentKernel>>()
        .expect("host consumes the injected execution kernel");
    assert!(Arc::ptr_eq(
        &kernel,
        &context.get::<Service<ovule_agent::AgentKernel>>().unwrap()
    ));
    let owner = context.cached::<AgentRuntimeService>().unwrap();
    assert!(Arc::ptr_eq(
        &owner,
        &context.get::<AgentRuntimeService>().unwrap()
    ));
    owner.lock().unwrap().stop(Duration::from_secs(1));
    let error = setup
        .probe_executable(Path::new("unused"), &[])
        .unwrap_err();
    assert!(error.contains("shutting down"));
}

struct NoEvents;
impl ovule_workspace::WorkspaceEventSink for NoEvents {
    fn revision_changed(&self, _: i64) {}
}
impl ovule_conversation::ConversationEventSink for NoEvents {
    fn agent_output(&self, _: &str, _: u64, _: &str, _: i64) -> Result<(), String> {
        Ok(())
    }
}
impl ovule_channels::ChannelEvents for NoEvents {
    fn status_changed(&self, _: &[u8]) -> Result<(), String> {
        Ok(())
    }
}
impl ovule_terminal::TerminalEventSink for NoEvents {
    fn output(&self, _: &ovule_terminal::TerminalOutput) -> Result<(), String> {
        Ok(())
    }
}
impl ovule_remoting::backend::SessionEvents for NoEvents {
    fn changed(&self, _: &ovule_remoting::model::SessionUpdate) {}
}
struct NoPrerequisites;
impl ovule_conversation::AttemptPrerequisites for NoPrerequisites {
    fn prepare(&self, _: &ovule_conversation::state::AttemptSpec) -> Result<(), String> {
        Ok(())
    }
}
struct NoWorkers;
impl ovule_channels::ChannelWorkerSource for NoWorkers {
    fn prepare_channel_worker(
        &self,
        _: &str,
    ) -> Result<ovule_channels::ResolvedChannelWorker, String> {
        Err("no channel workers".into())
    }
}

// The graph test exercises ownership without opening a real network listener.
struct TestTunnelHost(Box<dyn ovule_hosts::TunnelHost>);
impl ovule_hosts::TunnelHost for TestTunnelHost {
    fn handle(&self) -> ovule_hosts::TunnelHostHandle {
        self.0.handle()
    }
    fn ensure_started(&mut self) -> Result<(), String> {
        Ok(())
    }
    fn reset_identity(&mut self) -> Result<(), String> {
        Ok(())
    }
    fn shutdown(&mut self) {
        self.0.shutdown();
    }
    fn set_computer_use_mcp_endpoint(
        &mut self,
        endpoint: Option<ovule_hosts::ComputerUseMcpEndpoint>,
    ) {
        self.0.set_computer_use_mcp_endpoint(endpoint);
    }
}

fn domain_registry(root: &Path) -> tuffite_ioc::Registry<()> {
    use ovule_workspace::{WorkspaceDataRoot, WorkspaceSession};
    let mut registry = tuffite_ioc::Registry::new(Arc::new(()));
    let mut selected = ioc_support::SelectedProviders::new(
        &mut registry,
        vec![
            std::any::TypeId::of::<ovule_hosts::TunnelHostService>(),
            std::any::TypeId::of::<tuffite_ioc::Service<WorkspaceDataRoot>>(),
            std::any::TypeId::of::<tuffite_ioc::Service<dyn ovule_channels::ChannelWorkerSource>>(),
        ],
    );
    ovule::agent_host::providers::register(&mut selected).unwrap();
    ovule_conversation::providers::register(&mut selected).unwrap();
    ovule_channels::providers::register_runtime(&mut selected).unwrap();
    ovule_channels::providers::register(&mut selected).unwrap();
    ovule_hosts::providers::register(&mut selected).unwrap();
    ovule_remoting::providers::register_host(&mut selected).unwrap();
    ovule_workspace::providers::register_management(&mut selected).unwrap();
    ovule_workspace::providers::register_host(&mut selected).unwrap();
    ovule_secrets::providers::register(&mut selected).unwrap();
    ovule_files::providers::register(&mut selected).unwrap();
    ovule_files::providers::register_host(&mut selected).unwrap();
    ovule_files::providers::register_runtime(&mut selected).unwrap();
    ovule_terminal::providers::register(&mut selected).unwrap();
    ovule_terminal::providers::register_runtime(&mut selected).unwrap();
    ovule_remoting::providers::register(&mut selected).unwrap();
    ovule_remoting::providers::register_runtime(&mut selected).unwrap();
    drop(selected);
    registry
        .register(
            tuffite_ioc::factory::<ovule_hosts::TunnelHostService, _, _>(|deps| {
                let secrets = deps.depends_on::<ovule_secrets::Secrets>()?;
                Ok(Arc::new(std::sync::Mutex::new(Box::new(TestTunnelHost(
                    ovule_hosts::providers::host(secrets),
                )))))
            }),
        )
        .unwrap();
    // Core Host sessions can use a provider without installing any vendor plugin.
    registry
        .inject::<dyn ovule_remoting::backend::IceConfigProvider>(
            ovule_remoting::providers::host_ice_configuration(),
        )
        .unwrap();
    let data_root = Arc::new(WorkspaceDataRoot(root.into()));
    registry
        .register(tuffite_ioc::factory::<
            tuffite_ioc::Service<WorkspaceDataRoot>,
            _,
            _,
        >(move |_| Ok(Arc::clone(&data_root))))
        .unwrap();
    registry
        .inject(Arc::new(WorkspaceSession::new(
            ovule_workspace::state::Workspace::default(),
            ovule_workspace::providers::open(&root.join("state.sqlite")).unwrap(),
        )))
        .unwrap();
    registry
        .inject::<dyn ExtensionAgentRuntime>(Arc::new(NoExtensions))
        .unwrap();
    registry
        .inject(ovule_remoting::providers::unavailable_computer_use())
        .unwrap();
    registry
        .inject(ovule_remoting::providers::unavailable_desktop())
        .unwrap();
    registry
        .inject::<dyn ovule_conversation::AttemptPrerequisites>(Arc::new(NoPrerequisites))
        .unwrap();
    registry
        .inject::<dyn ovule_workspace::WorkspaceEventSink>(Arc::new(NoEvents))
        .unwrap();
    registry
        .inject::<dyn ovule_conversation::ConversationEventSink>(Arc::new(NoEvents))
        .unwrap();
    registry
        .inject::<dyn ovule_channels::ChannelEvents>(Arc::new(NoEvents))
        .unwrap();
    registry
        .inject::<dyn ovule_terminal::TerminalEventSink>(Arc::new(NoEvents))
        .unwrap();
    registry
        .inject::<dyn ovule_remoting::backend::SessionEvents>(Arc::new(NoEvents))
        .unwrap();
    let workers: Arc<dyn ovule_channels::ChannelWorkerSource> = Arc::new(NoWorkers);
    registry
        .register(tuffite_ioc::factory::<
            tuffite_ioc::Service<dyn ovule_channels::ChannelWorkerSource>,
            _,
            _,
        >(move |_| Ok(Arc::clone(&workers))))
        .unwrap();
    registry
}

#[test]
fn domain_graph_constructs_runtime_capabilities_without_cycles_or_duplicate_conversations() {
    use tuffite_ioc::Service;
    let root = tempfile::tempdir().unwrap();
    let mut registry = domain_registry(root.path());
    registry
        .inject(Arc::new(
            ovule_memory::MemoryService::open(&root.path().join("memory.sqlite")).unwrap(),
        ))
        .unwrap();
    registry
        .inject(ovule_browser::providers::unavailable())
        .unwrap();
    registry.freeze();
    registry.initialize().unwrap();
    let context = registry;
    let channel = context
        .get::<ovule_channels::ChannelRuntimeService>()
        .unwrap();
    let conversation = context
        .get::<ovule_conversation::ConversationService>()
        .unwrap();
    let ingress = context
        .get::<Service<dyn ovule_conversation::ConversationIngress>>()
        .unwrap();
    let expected_ingress: Arc<dyn ovule_conversation::ConversationIngress> = conversation;
    assert!(Arc::ptr_eq(&ingress, &expected_ingress));
    context.get::<ovule_workspace::WorkspaceService>().unwrap();
    assert!(
        context
            .cached::<ovule::agent_host::AgentRuntimeService>()
            .is_some()
    );
    assert!(context.cached::<ovule_hosts::TunnelHostService>().is_some());
    let tools = context.get::<Service<dyn ChannelToolHost>>().unwrap();
    assert!(
        tools
            .invoke("missing-attempt", "status", &serde_json::json!({}))
            .unwrap_err()
            .contains("unknown Attempt")
    );
    context.get::<ovule_files::FilesService>().unwrap();
    context.get::<ovule_terminal::TerminalService>().unwrap();
    let remoting = context.get::<ovule_remoting::RemotingService>().unwrap();
    let bindings = context
        .get::<Service<dyn ovule_hosts::BindingResolver>>()
        .unwrap();
    assert!(bindings.tunnel_binding_ids().is_empty());
    let hosts = context
        .get::<Service<dyn ovule_remoting::backend::HostDirectory>>()
        .unwrap();
    assert!(
        hosts
            .connect("missing-host")
            .err()
            .unwrap()
            .contains("does not exist")
    );
    // Releasing consumer Arcs then the scope exercises RAII teardown.
    drop((
        channel,
        ingress,
        expected_ingress,
        tools,
        remoting,
        bindings,
        hosts,
    ));
    drop(context);
}
