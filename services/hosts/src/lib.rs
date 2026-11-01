//! `WorkspaceTransport` abstracts Local and remote (SSH/Tunnel) execution roots.
//!
//! Consumer ports and provider factories expose execution and Host lifecycle
//! capabilities. Local, SSH, encrypted Link, process, and pairing implementations
//! remain private; binding metadata and native desktop hooks are injected ports.

pub mod execution;
mod sandbox;

use std::collections::BTreeMap;
use std::path::PathBuf;

use ovule_remoting::backend::RemotingInputEvent;
use serde::{Deserialize, Serialize};

mod extension_agents;
mod local;
mod power;
mod process;
pub use power::{HostPower, HostPowerService, HostPowerSettingsPath, HostPowerStatus};
pub use process::WorkspaceProcess;
mod router;
mod ssh;
mod tunnel;

#[cfg(test)]
mod tests;

use local::LocalTransport;
pub use ovule_remoting::backend::RemotingSnapshot;
use router::WorkspaceTransportRouter;
use ssh::SshTransport;
pub use ssh::{SshAuth, SshEndpointConfig};
pub use tunnel::{HostAgentDescriptor, HostAgentRuntime, TunnelHostHandle, TunnelShareStatus};
pub use tunnel::{HostWorkspaceDescriptor, TunnelClientConfig};
use tunnel::{NativeTunnelHost, TunnelTransport};

#[derive(Debug)]
pub enum TransportError {
    InvalidPath(String),
    Io(String),
    NotFound(String),
    Unauthorized(String),
    Unavailable(String),
    Protocol(String),
}

impl std::fmt::Display for TransportError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidPath(message) => write!(formatter, "invalid workspace path: {message}"),
            Self::Io(message) => write!(formatter, "workspace I/O error: {message}"),
            Self::NotFound(message) => write!(formatter, "workspace resource not found: {message}"),
            Self::Unauthorized(message) => {
                write!(formatter, "workspace access denied: {message}")
            }
            Self::Unavailable(message) => {
                write!(formatter, "workspace transport unavailable: {message}")
            }
            Self::Protocol(message) => write!(formatter, "workspace protocol error: {message}"),
        }
    }
}

impl std::error::Error for TransportError {}

#[derive(Clone, Copy, Debug, Eq, PartialEq, serde::Deserialize, serde::Serialize)]
pub enum EntryKind {
    File,
    Directory,
    Symlink,
    Other,
}

#[derive(Clone, Debug, Eq, PartialEq, serde::Deserialize, serde::Serialize)]
pub struct EntryStat {
    pub path: PathBuf,
    pub kind: EntryKind,
    pub size_bytes: u64,
}

#[derive(Clone, Debug, Eq, PartialEq, serde::Deserialize, serde::Serialize)]
pub struct ExecOutcome {
    pub exit_code: i32,
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputerUseMcpEndpoint {
    pub url: String,
    pub bearer_token: String,
}

/// Host-local endpoint supplied by the agent runtime's provider.
pub struct HostComputerUseEndpoint(pub Option<ComputerUseMcpEndpoint>);

#[async_trait::async_trait]
pub trait WorkspaceTransport: Send + Sync {
    fn kind(&self) -> TransportKind;

    /// Only a backend enforcing OS isolation may advertise availability.
    fn execution_sandbox(&self) -> execution::SandboxCapabilities {
        execution::SandboxCapabilities::unavailable(
            "Execution host has no qualified agent command sandbox",
        )
    }

    /// Reports whether the transport is currently reachable. Local is always
    /// available; remote transports resolve their connection here.
    async fn probe(&self) -> Result<(), TransportError>;

    async fn stat(&self, relative: &str) -> Result<EntryStat, TransportError>;

    async fn list_directory(&self, relative: &str) -> Result<Vec<EntryStat>, TransportError>;

    async fn read_file(&self, relative: &str) -> Result<Vec<u8>, TransportError>;

    async fn write_file(&self, relative: &str, bytes: &[u8]) -> Result<(), TransportError>;

    async fn exec(&self, argv: &[String]) -> Result<ExecOutcome, TransportError>;

    /// Agent commands must use a qualified OS sandbox; never fall back to exec.
    async fn exec_scoped(
        &self,
        argv: &[String],
        cancellation: processkit::CancellationToken,
    ) -> Result<ExecOutcome, TransportError> {
        let _ = (argv, cancellation);
        Err(TransportError::Unavailable(
            "transport has no qualified agent command sandbox".into(),
        ))
    }

    /// Extra permissions are accepted only after host admission. Remote transports fail closed.
    async fn exec_with_permissions(
        &self,
        argv: &[String],
        permissions: &execution::ExecutionPermissions,
        cancellation: processkit::CancellationToken,
    ) -> Result<ExecOutcome, TransportError> {
        if !permissions.is_empty() {
            return Err(TransportError::Unavailable(
                "transport does not support scoped permission requests".into(),
            ));
        }
        self.exec_scoped(argv, cancellation).await
    }

    async fn exec_shell(&self, command: &str) -> Result<ExecOutcome, TransportError>;

    /// Streams a shell command without waiting for the complete output buffer.
    async fn spawn_shell(&self, command: &str) -> Result<WorkspaceProcess, TransportError>;

    /// Bidirectional process stream. Dropping it revokes and terminates the process.
    async fn spawn(
        &self,
        argv: &[String],
        environment: &BTreeMap<String, String>,
    ) -> Result<WorkspaceProcess, TransportError>;

    /// Starts an Agent by its Host-owned Extension ID. Remote transports may
    /// override this so the execution Host, rather than the Client, resolves
    /// the executable and Extension launch plan.
    async fn spawn_agent(
        &self,
        agent_id: &str,
        model_provider: Option<&str>,
        model_remote_id: Option<&str>,
    ) -> Result<WorkspaceProcess, TransportError> {
        let _ = (agent_id, model_provider, model_remote_id);
        Err(TransportError::Protocol(
            "transport does not support Host-owned Agent launch".to_owned(),
        ))
    }

    /// Returns a Host-local MCP endpoint that may only be handed to an Agent
    /// process running on this same execution Host.
    async fn computer_use_mcp_endpoint(&self) -> Result<ComputerUseMcpEndpoint, TransportError> {
        Err(TransportError::Unavailable(
            "transport does not expose Host Computer Use".to_owned(),
        ))
    }

    async fn computer_use_snapshot(
        &self,
        screen_id: Option<i64>,
    ) -> Result<RemotingSnapshot, TransportError> {
        let _ = screen_id;
        Err(TransportError::Unavailable(
            "transport does not expose Host Computer Use".to_owned(),
        ))
    }

    async fn computer_use_input(&self, event: RemotingInputEvent) -> Result<(), TransportError> {
        let _ = event;
        Err(TransportError::Unavailable(
            "transport does not expose Host Computer Use".to_owned(),
        ))
    }
}

impl From<ovule_link_transport::LinkError> for TransportError {
    fn from(error: ovule_link_transport::LinkError) -> Self {
        match error {
            ovule_link_transport::LinkError::Unavailable(message) => Self::Unavailable(message),
            ovule_link_transport::LinkError::Protocol(message) => Self::Protocol(message),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub enum TransportKind {
    Local,
    Ssh,
    Tunnel,
}

pub struct TransportBinding {
    pub kind: TransportKind,
    pub root: String,
    pub endpoint_id: Option<String>,
    pub resource_id: Option<String>,
}
pub struct TransportEndpoint {
    pub host: Option<String>,
    pub port: Option<u16>,
    pub user: Option<String>,
    pub auth_kind: Option<String>,
    pub credential_ref: Option<String>,
    pub host_fingerprint: Option<String>,
}
/// Consumer supplies persisted binding metadata without exposing its state model.
pub trait BindingResolver: Send + Sync {
    fn binding(&self, id: &str) -> Option<TransportBinding>;
    fn endpoint(&self, id: &str) -> Option<TransportEndpoint>;
    fn tunnel_binding_ids(&self) -> Vec<String>;
}
pub trait WorkspaceTransportResolver: Send + Sync {
    fn resolve(
        &self,
        binding_id: Option<&str>,
        fallback_root: &str,
    ) -> Result<std::sync::Arc<dyn WorkspaceTransport>, TransportError>;
}
impl WorkspaceTransportResolver for WorkspaceTransportRouter {
    fn resolve(
        &self,
        binding_id: Option<&str>,
        fallback_root: &str,
    ) -> Result<std::sync::Arc<dyn WorkspaceTransport>, TransportError> {
        self.resolve(binding_id, fallback_root)
    }
}
fn external_path(path: &std::path::Path) -> String {
    let value = path.to_string_lossy();
    #[cfg(windows)]
    {
        if let Some(path) = value.strip_prefix(r"\\?\UNC\") {
            return format!(r"\\{path}");
        }
        if let Some(path) = value.strip_prefix(r"\\?\") {
            return path.to_owned();
        }
    }
    value.into_owned()
}

/// Host resource owner, constructed by its provider and stopped on Drop.
pub trait TunnelHost: Send {
    fn handle(&self) -> TunnelHostHandle;
    fn ensure_started(&mut self) -> Result<(), String>;
    fn reset_identity(&mut self) -> Result<(), String>;
    fn shutdown(&mut self);
    fn set_computer_use_mcp_endpoint(&mut self, endpoint: Option<ComputerUseMcpEndpoint>);
}
#[async_trait::async_trait]
pub trait TunnelClient: WorkspaceTransport + ovule_remoting::backend::ControlTransport {
    async fn hello(&self) -> Result<ovule_link_protocol::HostHello, TransportError>;
    async fn submit_pairing_code(&self, code: &str) -> Result<(), TransportError>;
}
#[async_trait::async_trait]
impl TunnelClient for TunnelTransport {
    async fn hello(&self) -> Result<ovule_link_protocol::HostHello, TransportError> {
        self.hello().await
    }
    async fn submit_pairing_code(&self, code: &str) -> Result<(), TransportError> {
        self.submit_pairing_code(code).await
    }
}

/// Owned Link listener lifecycle, independent of the transport resolver.
pub type TunnelHostService = tuffite_ioc::Service<std::sync::Mutex<Box<dyn TunnelHost>>>;

pub mod providers {
    /// Register transports and an eager host listener, configured through its dependencies.
    pub fn register<C: Send + Sync + 'static>(
        registrar: &mut impl tuffite_ioc::Registrar<C>,
    ) -> tuffite_ioc::Result<()> {
        use std::sync::{Arc, Mutex};
        use tuffite_ioc::Service;
        registrar.register_eager(tuffite_ioc::factory::<super::HostPowerService, _, _>(
            |deps| {
                let path = deps.depends_on::<Service<super::HostPowerSettingsPath>>()?;
                Ok(Arc::new(super::power::NativeHostPower::new(path.0.clone())))
            },
        ))?;
        registrar.register(tuffite_ioc::factory::<
            Service<dyn super::WorkspaceTransportResolver>,
            _,
            _,
        >(|deps| {
            Ok(router(
                deps.depends_on::<Service<dyn super::BindingResolver>>()?,
                deps.depends_on::<Service<dyn ovule_secrets::SecretStore>>()?,
            ))
        }))?;
        registrar.register(tuffite_ioc::factory::<
            Service<dyn super::HostAgentRuntime>,
            _,
            _,
        >(|deps| {
            Ok(extension_agents(deps.depends_on::<Service<
                dyn ovule_extensions::runtime::ExtensionAgentRuntime,
            >>()?))
        }))?;
        registrar.register_eager(tuffite_ioc::factory::<super::TunnelHostService, _, _>(
            |deps| {
                let endpoint = deps.depends_on::<Service<super::HostComputerUseEndpoint>>()?;
                let mut host = host_with_ports(
                    deps.depends_on::<Service<dyn ovule_secrets::SecretStore>>()?,
                    Some(deps.depends_on::<Service<dyn super::HostAgentRuntime>>()?),
                    deps.depends_on::<Service<dyn ovule_remoting::backend::ComputerUseHost>>()?,
                    deps.depends_on::<Service<dyn ovule_remoting::host::HostSessions>>()?,
                );
                host.set_computer_use_mcp_endpoint(endpoint.0.clone());
                // Link credentials/network may be unavailable while local work remains usable.
                // Explicit Link operations retry startup and return the original error to the UI.
                if let Err(error) = host.ensure_started() {
                    eprintln!("Ovule Link unavailable at startup: {error}");
                }
                Ok(Arc::new(Mutex::new(host)))
            },
        ))?;
        registrar.register(
            tuffite_ioc::factory::<Service<super::TunnelHostHandle>, _, _>(|deps| {
                let owner = deps.depends_on::<super::TunnelHostService>()?;
                let host = owner.lock().map_err(|_| "Tunnel lifecycle lock poisoned")?;
                Ok(Arc::new(host.handle().with_owner(&owner)))
            }),
        )?;

        Ok(())
    }

    #[must_use]
    pub fn extension_agents(
        runtime: std::sync::Arc<dyn ovule_extensions::runtime::ExtensionAgentRuntime>,
    ) -> std::sync::Arc<dyn super::HostAgentRuntime> {
        std::sync::Arc::new(super::extension_agents::ExtensionHostAgentRuntime(runtime))
    }
    #[must_use]
    pub fn host(
        secrets: std::sync::Arc<dyn ovule_secrets::SecretStore>,
    ) -> Box<dyn super::TunnelHost> {
        Box::new(super::NativeTunnelHost::new(secrets))
    }
    #[must_use]
    pub fn host_with_ports(
        secrets: std::sync::Arc<dyn ovule_secrets::SecretStore>,
        agents: Option<std::sync::Arc<dyn super::HostAgentRuntime>>,
        computer_use: std::sync::Arc<dyn ovule_remoting::backend::ComputerUseHost>,
        sessions: std::sync::Arc<dyn ovule_remoting::host::HostSessions>,
    ) -> Box<dyn super::TunnelHost> {
        Box::new(super::NativeTunnelHost::with_ports(
            secrets,
            agents,
            computer_use,
            sessions,
        ))
    }
    pub fn local(
        root: std::path::PathBuf,
    ) -> Result<std::sync::Arc<dyn super::WorkspaceTransport>, super::TransportError> {
        Ok(std::sync::Arc::new(super::LocalTransport::new(root)?))
    }
    pub fn ssh(
        config: super::SshEndpointConfig,
        root: String,
    ) -> Result<std::sync::Arc<dyn super::WorkspaceTransport>, super::TransportError> {
        Ok(std::sync::Arc::new(super::SshTransport::new(config, root)?))
    }
    #[must_use]
    pub fn tunnel(config: super::TunnelClientConfig) -> std::sync::Arc<dyn super::TunnelClient> {
        std::sync::Arc::new(super::TunnelTransport::new(config))
    }
    #[must_use]
    pub fn router(
        bindings: std::sync::Arc<dyn super::BindingResolver>,
        secrets: std::sync::Arc<dyn ovule_secrets::SecretStore>,
    ) -> std::sync::Arc<dyn super::WorkspaceTransportResolver> {
        std::sync::Arc::new(super::WorkspaceTransportRouter::new(bindings, secrets))
    }
}

pub mod capability;
pub mod mcp;
