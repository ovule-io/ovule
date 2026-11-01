//! End-to-end encrypted Ovule Link transport over iroh QUIC.
//!
//! The host always dials out to discovery/relay infrastructure. QUIC attempts
//! a direct path first and uses the relay only when NAT traversal fails. The
//! relay sees encrypted packets; authorization remains an application-level
//! decision bound to the peer's iroh public key.

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, mpsc};
use std::thread;
use std::time::{Duration, Instant};

use async_trait::async_trait;
#[cfg(test)]
use iroh::{Endpoint, endpoint::presets};
use iroh::{EndpointAddr, SecretKey, TransportAddr};
use ovule_remoting::backend::RemotingInputEvent;
use ovule_remoting::{
    backend::ControlTransport,
    host::HostSessions,
    model::{HostUpdate, Signal, StartRequest, StartedSession},
};
use serde::{Deserialize, Serialize};
use sha2::{Digest as _, Sha256};
use tokio::io::{AsyncReadExt as _, AsyncWriteExt as _};

use crate::TransportKind;
use ovule_secrets::SecretStore;

use super::{
    ComputerUseMcpEndpoint, EntryStat, ExecOutcome, LocalTransport, RemotingSnapshot,
    TransportError, WorkspaceTransport,
};
use crate::external_path;
use ovule_remoting::backend::ComputerUseHost;

mod access;
mod protocol;
#[cfg(test)]
mod recovery_tests;
use access::{HostAccess, persist_access};
#[cfg(test)]
use ovule_link_protocol::ALPN;
use ovule_link_protocol::MAX_FRAME;
use protocol::{
    Capability, TunnelOperation, TunnelPayload, TunnelRequest, TunnelResponse, decode_request,
};
pub use protocol::{HostAgentDescriptor, HostHello, HostWorkspaceDescriptor};
const CLIENT_ONLINE_GRACE: Duration = Duration::from_secs(15);

pub use ovule_link_transport::LinkClientConfig as TunnelClientConfig;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TunnelShareStatus {
    pub requires_reset: bool,
    pub endpoint_addr_json: String,
    pub endpoint_id: String,
    pub share_id: String,
    pub root: String,
    pub alias: String,
    pub pending: Vec<TunnelPairingRequest>,
    pub devices: Vec<TunnelDeviceAccess>,
    pub workspaces: Vec<HostWorkspaceDescriptor>,
    pub agents: Vec<HostAgentDescriptor>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TunnelPairingRequest {
    pub client_id: String,
    pub name: String,
    pub code: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct TunnelDeviceAccess {
    pub client_id: String,
    #[serde(default)]
    pub name: String,
    pub workspace_ids: Vec<String>,
    pub agent_ids: Vec<String>,
    #[serde(default, skip)]
    pub online: bool,
}

#[derive(Clone, Debug)]
struct TunnelPendingClient {
    name: String,
    code: String,
}

pub struct NativeTunnelHost {
    handle: TunnelHostHandle,
    computer_use_mcp_endpoint: Option<ComputerUseMcpEndpoint>,
    shutdown: Option<tokio::sync::watch::Sender<bool>>,
    thread: Option<thread::JoinHandle<()>>,
}

impl Drop for NativeTunnelHost {
    fn drop(&mut self) {
        self.shutdown();
    }
}

#[derive(Clone)]
pub struct TunnelHostHandle {
    owner: std::sync::Weak<Mutex<Box<dyn crate::TunnelHost>>>,
    secrets: Arc<dyn SecretStore>,
    managed_toolchains: PathBuf,
    access_path: PathBuf,
    access: Arc<Mutex<HostAccess>>,
    endpoint_addr: Arc<Mutex<Option<EndpointAddr>>>,
    secret: Arc<Mutex<Option<SecretKey>>>,
    agent_runtime: Option<Arc<dyn HostAgentRuntime>>,
    remote_control: Arc<dyn ComputerUseHost>,
    control_sessions: Arc<dyn HostSessions>,
    online_clients: Arc<Mutex<BTreeMap<String, usize>>>,
    last_seen_clients: Arc<Mutex<BTreeMap<String, Instant>>>,
}

pub trait HostAgentRuntime: Send + Sync {
    fn prepare(
        &self,
        managed_toolchains: &std::path::Path,
        agent_id: &str,
        model_provider: Option<&str>,
        model_remote_id: Option<&str>,
    ) -> Result<(Vec<String>, BTreeMap<String, String>), String>;
    fn resolve_program(
        &self,
        program: &str,
        managed_toolchains: &std::path::Path,
    ) -> Option<PathBuf>;
    fn agent_id(&self, program: &str) -> Option<String>;
    fn agents(&self, managed_toolchains: &std::path::Path) -> Vec<HostAgentDescriptor>;
}

impl NativeTunnelHost {
    pub fn new(secrets: Arc<dyn SecretStore>) -> Self {
        let control = ovule_remoting::providers::unavailable_computer_use();
        let sessions = ovule_remoting::providers::host_sessions(
            ovule_remoting::providers::unavailable_desktop(),
            ovule_remoting::providers::host_ice_configuration(),
        );
        Self::with_ports(secrets, None, control, sessions)
    }
    pub fn with_ports(
        secrets: Arc<dyn SecretStore>,
        agent_runtime: Option<Arc<dyn HostAgentRuntime>>,
        remote_control: Arc<dyn ComputerUseHost>,
        control_sessions: Arc<dyn HostSessions>,
    ) -> Self {
        let access_path = secrets.root().join("workspace-link-access.json");
        let managed_toolchains = secrets.root().parent().map_or_else(
            || std::env::temp_dir().join("ovule-toolchains"),
            |root| root.join("toolchains"),
        );
        let access = HostAccess::load(&access_path);
        Self {
            handle: TunnelHostHandle {
                owner: std::sync::Weak::new(),
                secrets,
                managed_toolchains,
                access_path,
                access: Arc::new(Mutex::new(access)),
                endpoint_addr: Arc::new(Mutex::new(None)),
                secret: Arc::new(Mutex::new(None)),
                agent_runtime,
                remote_control,
                control_sessions,
                online_clients: Arc::new(Mutex::new(BTreeMap::new())),
                last_seen_clients: Arc::new(Mutex::new(BTreeMap::new())),
            },
            computer_use_mcp_endpoint: None,
            shutdown: None,
            thread: None,
        }
    }

    pub fn set_computer_use_mcp_endpoint(&mut self, endpoint: Option<ComputerUseMcpEndpoint>) {
        self.computer_use_mcp_endpoint = endpoint;
    }

    pub fn handle(&self) -> TunnelHostHandle {
        self.handle.clone()
    }

    #[allow(clippy::too_many_lines)]
    pub fn ensure_started(&mut self) -> Result<(), String> {
        if self.thread.is_some() {
            return Ok(());
        }
        let encoded = self
            .handle
            .secrets
            .load_or_create_workspace_identity("link-host")?;
        let secret: SecretKey = serde_json::from_str(&encoded)
            .map_err(|error| format!("decode Link identity: {error}"))?;
        let host_id = secret.public().to_string();
        *lock(&self.handle.secret) = Some(secret.clone());
        let access = Arc::clone(&self.handle.access);
        let access_path = self.handle.access_path.clone();
        let managed_toolchains = self.handle.managed_toolchains.clone();
        let endpoint_addr = Arc::clone(&self.handle.endpoint_addr);
        let agent_runtime = self.handle.agent_runtime.clone();
        let remote_control = Arc::clone(&self.handle.remote_control);
        let control_sessions = Arc::clone(&self.handle.control_sessions);
        let computer_use_mcp_endpoint = self.computer_use_mcp_endpoint.clone();
        let online_clients = Arc::clone(&self.handle.online_clients);
        let last_seen_clients = Arc::clone(&self.handle.last_seen_clients);
        let (ready_tx, ready_rx) = mpsc::sync_channel(1);
        let (shutdown_tx, shutdown_rx) = tokio::sync::watch::channel(false);
        let thread = thread::Builder::new()
            .name("ovule-workspace-link".to_owned())
            .spawn(move || {
                let runtime = tokio::runtime::Builder::new_multi_thread()
                    .enable_all()
                    .build();
                let Ok(runtime) = runtime else {
                    let _ = ready_tx.send(Err("create Ovule Link runtime".to_owned()));
                    return;
                };
                runtime.block_on(async move {
                    let server = ovule_link_transport::LinkServer::bind(secret)
                        .await
                        .map_err(|error| error.to_string());
                    let Ok(server) = server else {
                        let _ = ready_tx.send(server.map(|_| ()));
                        return;
                    };
                    *lock(&endpoint_addr) = Some(server.address());
                    let _ = ready_tx.send(Ok(()));
                    let reaper_sessions = Arc::clone(&control_sessions);
                    let reaper = tokio::spawn(async move {
                        loop {
                            tokio::time::sleep(Duration::from_millis(250)).await;
                            reaper_sessions.reap().await;
                        }
                    });
                    let dispatcher = Arc::new(HostDispatcher {
                        access,
                        access_path,
                        managed_toolchains,
                        agent_runtime,
                        remote_control,
                        control_sessions: Arc::clone(&control_sessions),
                        computer_use_mcp_endpoint,
                        host_id,
                        online_clients,
                        last_seen_clients,
                    });
                    server
                        .serve(dispatcher, shutdown_rx, move |address| {
                            *lock(&endpoint_addr) = Some(address);
                        })
                        .await;
                    control_sessions.revoke(None);
                    control_sessions.reap().await;
                    reaper.abort();
                });
            })
            .map_err(|error| format!("start Ovule Link thread: {error}"))?;
        self.shutdown = Some(shutdown_tx);
        self.thread = Some(thread);
        match ready_rx.recv_timeout(Duration::from_secs(30)) {
            Ok(Ok(())) => {}
            Ok(Err(error)) => {
                self.shutdown();
                return Err(error);
            }
            Err(_) => {
                self.shutdown();
                return Err("Ovule Link startup timed out".into());
            }
        }
        Ok(())
    }

    pub fn shutdown(&mut self) {
        if let Some(shutdown) = self.shutdown.take() {
            let _ = shutdown.send(true);
        }
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }

    pub fn reset_identity(&mut self) -> Result<(), String> {
        self.shutdown();
        self.handle.reset_access()?;
        if let Err(error) = self.handle.secrets.reset_workspace_identity("link-host") {
            let _ = self.ensure_started();
            return Err(error);
        }
        *lock(&self.handle.secret) = None;
        *lock(&self.handle.endpoint_addr) = None;
        lock(&self.handle.online_clients).clear();
        lock(&self.handle.last_seen_clients).clear();
        self.ensure_started()
    }
}

impl TunnelHostHandle {
    #[must_use]
    pub fn with_owner(mut self, owner: &Arc<Mutex<Box<dyn crate::TunnelHost>>>) -> Self {
        self.owner = Arc::downgrade(owner);
        self
    }
    pub fn ensure_started(&self) -> Result<(), String> {
        if lock(&self.endpoint_addr).is_some() {
            return Ok(());
        }
        let owner = self
            .owner
            .upgrade()
            .ok_or("Link runtime owner is unavailable")?;
        lock(&owner).ensure_started()
    }
    pub fn reset_identity(&self) -> Result<(), String> {
        let owner = self
            .owner
            .upgrade()
            .ok_or("Link runtime owner is unavailable")?;
        lock(&owner).reset_identity()
    }
    pub fn pairing_status(&self) -> Result<TunnelShareStatus, String> {
        let endpoint_addr = lock(&self.endpoint_addr)
            .clone()
            .ok_or_else(|| "Ovule Link is not online yet".to_owned())?;
        Ok(self.status_for(
            &endpoint_addr,
            std::path::Path::new(""),
            &local_device_name(),
        ))
    }

    pub fn regenerate_pairing_status(&self) -> Result<TunnelShareStatus, String> {
        self.update_access(|access| {
            access.pairing_token = random_pairing_token();
            access.pending_clients.clear();
            Ok(())
        })?;
        self.pairing_status()
    }

    pub fn share(&self, root: &std::path::Path, alias: &str) -> Result<TunnelShareStatus, String> {
        let canonical = std::fs::canonicalize(root)
            .map_err(|error| format!("open shared Workspace {}: {error}", root.display()))?;
        if !canonical.is_dir() {
            return Err("shared Workspace root is not a directory".to_owned());
        }
        let mut endpoint_addr = lock(&self.endpoint_addr)
            .clone()
            .ok_or_else(|| "Ovule Link is not online yet".to_owned())?;
        // Give relay discovery a short budget when the user explicitly asks
        // for a share link. Local/direct sharing remains immediately usable.
        for _ in 0..10 {
            if endpoint_addr.relay_urls().next().is_some() {
                break;
            }
            thread::sleep(Duration::from_millis(250));
            if let Some(updated) = lock(&self.endpoint_addr).clone() {
                endpoint_addr = updated;
            }
        }
        let share_id = share_id(&canonical);
        self.update_access(|access| {
            access
                .shares
                .insert(share_id.clone(), (canonical.clone(), alias.to_owned()));
            Ok(())
        })?;
        Ok(self.status_for(
            &endpoint_addr,
            std::path::Path::new(""),
            &local_device_name(),
        ))
    }

    pub fn set_device_access(
        &self,
        client_id: &str,
        workspace_ids: Vec<String>,
        agent_ids: Vec<String>,
    ) -> Result<(), String> {
        let available_agents = host_agents(self.agent_runtime.as_deref(), &self.managed_toolchains)
            .into_iter()
            .filter(|agent| agent.available)
            .map(|agent| agent.id)
            .collect::<Vec<_>>();
        self.update_access(|access| {
            if let Some(unknown) = workspace_ids
                .iter()
                .find(|workspace_id| !access.shares.contains_key(*workspace_id))
            {
                return Err(format!("unknown Host Workspace: {unknown}"));
            }
            if let Some(unknown) = agent_ids
                .iter()
                .find(|agent_id| !available_agents.contains(*agent_id))
            {
                return Err(format!("Agent is not available on this Host: {unknown}"));
            }
            let device = access
                .devices
                .get_mut(client_id)
                .ok_or_else(|| "paired device was not found".to_owned())?;
            device.workspace_ids = unique_sorted(workspace_ids);
            device.agent_ids = unique_sorted(agent_ids);
            Ok(())
        })
    }

    pub fn revoke(&self, client_id: &str) -> Result<(), String> {
        self.update_access(|access| {
            if access.devices.remove(client_id).is_none() {
                return Err("paired device was not found".to_owned());
            }
            Ok(())
        })?;
        self.control_sessions.revoke(Some(client_id));
        Ok(())
    }

    pub fn reset_access(&self) -> Result<(), String> {
        self.replace_access(false)
    }

    pub fn repair_access(&self) -> Result<(), String> {
        self.replace_access(true)
    }

    fn replace_access(&self, only_if_unreadable: bool) -> Result<(), String> {
        let mut access = lock(&self.access);
        if only_if_unreadable && !access.requires_reset() {
            return Ok(());
        }
        let replacement = HostAccess::default();
        persist_access(&self.access_path, &replacement)?;
        *access = replacement;
        self.control_sessions.revoke(None);
        Ok(())
    }

    fn update_access(
        &self,
        operation: impl FnOnce(&mut HostAccess) -> Result<(), String>,
    ) -> Result<(), String> {
        let mut access = lock(&self.access);
        access.ensure_ready()?;
        let mut candidate = access.clone();
        operation(&mut candidate)?;
        persist_access(&self.access_path, &candidate)?;
        *access = candidate;
        Ok(())
    }

    fn status_for(
        &self,
        endpoint_addr: &EndpointAddr,
        root: &std::path::Path,
        alias: &str,
    ) -> TunnelShareStatus {
        let access = lock(&self.access);
        let pending = access
            .pending_clients
            .iter()
            .map(|(client_id, pending)| TunnelPairingRequest {
                client_id: client_id.clone(),
                name: pending.name.clone(),
                code: pending.code.clone(),
            })
            .collect();
        let online_clients = lock(&self.online_clients);
        let last_seen_clients = lock(&self.last_seen_clients);
        let devices = access
            .devices
            .values()
            .cloned()
            .map(|mut device| {
                device.online = online_clients.contains_key(&device.client_id)
                    || last_seen_clients
                        .get(&device.client_id)
                        .is_some_and(|seen| seen.elapsed() <= CLIENT_ONLINE_GRACE);
                device
            })
            .collect();
        let workspaces = access
            .shares
            .iter()
            .map(|(id, (root, alias))| HostWorkspaceDescriptor {
                id: id.clone(),
                root: external_path(root),
                alias: alias.clone(),
            })
            .collect();
        let agents = host_agents(self.agent_runtime.as_deref(), &self.managed_toolchains)
            .into_iter()
            .filter(|agent| agent.available)
            .collect();
        // Do not pin the ticket to today's relay. Direct candidates keep LAN/offline
        // pairing fast; with no relay address present iroh's address lookup resolves
        // the Host's current relay and addresses from its stable public key.
        let durable_addr = EndpointAddr::from_parts(
            endpoint_addr.id,
            endpoint_addr.ip_addrs().copied().map(TransportAddr::Ip),
        );
        TunnelShareStatus {
            requires_reset: access.requires_reset(),
            endpoint_addr_json: serde_json::to_string(&durable_addr).unwrap_or_default(),
            endpoint_id: endpoint_addr.id.to_string(),
            share_id: access.pairing_token.clone(),
            root: external_path(root),
            alias: alias.to_owned(),
            pending,
            devices,
            workspaces,
            agents,
        }
    }
}

pub struct TunnelTransport {
    config: TunnelClientConfig,
    network: ovule_link_transport::LinkTransport,
}
impl TunnelTransport {
    pub fn new(config: TunnelClientConfig) -> Self {
        Self {
            network: ovule_link_transport::LinkTransport::new(config.clone()),
            config,
        }
    }
    async fn connection(&self) -> Result<iroh::endpoint::Connection, TransportError> {
        self.network.connection().await.map_err(|e| match e {
            ovule_link_transport::LinkError::Unavailable(s) => TransportError::Unavailable(s),
            ovule_link_transport::LinkError::Protocol(s) => TransportError::Protocol(s),
        })
    }
    async fn control_request(
        &self,
        operation: TunnelOperation,
    ) -> Result<TunnelPayload, TransportError> {
        let seconds = if matches!(&operation, TunnelOperation::RemoteControlStart(_)) {
            ovule_remoting::model::HOST_START_TIMEOUT_SECONDS
        } else {
            ovule_remoting::model::LINK_OPERATION_TIMEOUT_SECONDS
        };
        tokio::time::timeout(Duration::from_secs(seconds), self.request(operation))
            .await
            .map_err(|_| TransportError::Unavailable("Link request deadline exceeded".into()))?
    }

    async fn request(&self, operation: TunnelOperation) -> Result<TunnelPayload, TransportError> {
        let connection = self.connection().await?;
        let (mut send, mut recv) = connection
            .open_bi()
            .await
            .map_err(|error| TransportError::Unavailable(format!("open Link stream: {error}")))?;
        let request = TunnelRequest {
            share_id: self.config.share_id.clone(),
            client_name: local_device_name(),
            operation,
        };
        let bytes = serde_json::to_vec(&request)
            .map_err(|error| TransportError::Protocol(error.to_string()))?;
        ovule_link_transport::frame::write_frame(&mut send, &bytes)
            .await
            .map_err(TransportError::from)?;
        send.finish()
            .map_err(|error| TransportError::Io(error.to_string()))?;
        let bytes = recv
            .read_to_end(MAX_FRAME)
            .await
            .map_err(|error| TransportError::Io(error.to_string()))?;
        let response: TunnelResponse = serde_json::from_slice(&bytes)
            .map_err(|error| TransportError::Protocol(format!("decode Link response: {error}")))?;
        match response {
            TunnelResponse::Ok(payload) => Ok(payload),
            TunnelResponse::Pending => Err(TransportError::Unauthorized(
                "waiting for Host approval".to_owned(),
            )),
            TunnelResponse::Error(message) => {
                Err(TransportError::Protocol(actionable_link_error(message)))
            }
        }
    }

    pub async fn submit_pairing_code(&self, code: &str) -> Result<(), TransportError> {
        if code.len() != 6 || !code.bytes().all(|value| value.is_ascii_digit()) {
            return Err(TransportError::Unauthorized(
                "pairing code must be 6 digits".to_owned(),
            ));
        }
        self.request(TunnelOperation::Pair {
            code: code.to_owned(),
        })
        .await
        .map(|_| ())
    }

    pub async fn hello(&self) -> Result<HostHello, TransportError> {
        match self.control_request(TunnelOperation::Hello).await? {
            TunnelPayload::Hello(hello) => Ok(hello),
            _ => Err(protocol()),
        }
    }

    async fn computer_use_mcp_endpoint_request(
        &self,
    ) -> Result<ComputerUseMcpEndpoint, TransportError> {
        match self
            .request(TunnelOperation::ComputerUseMcpEndpoint)
            .await?
        {
            TunnelPayload::ComputerUseMcpEndpoint(endpoint) => Ok(endpoint),
            _ => Err(protocol()),
        }
    }

    async fn computer_use_snapshot_request(
        &self,
        screen_id: Option<i64>,
    ) -> Result<RemotingSnapshot, TransportError> {
        match self
            .request(TunnelOperation::ComputerUseSnapshot { screen_id })
            .await?
        {
            TunnelPayload::ComputerUseSnapshot(snapshot) => Ok(snapshot),
            _ => Err(protocol()),
        }
    }

    async fn computer_use_input_request(
        &self,
        event: RemotingInputEvent,
    ) -> Result<(), TransportError> {
        match self
            .request(TunnelOperation::ComputerUseInput { event })
            .await?
        {
            TunnelPayload::Empty => Ok(()),
            _ => Err(protocol()),
        }
    }

    async fn spawn_operation(
        &self,
        operation: TunnelOperation,
    ) -> Result<super::WorkspaceProcess, TransportError> {
        let connection = self.connection().await?;
        let (mut send, mut recv) = connection
            .open_bi()
            .await
            .map_err(|error| TransportError::Io(error.to_string()))?;
        let bytes = serde_json::to_vec(&TunnelRequest {
            share_id: self.config.share_id.clone(),
            client_name: local_device_name(),
            operation,
        })
        .map_err(|error| TransportError::Protocol(error.to_string()))?;
        ovule_link_transport::frame::write_frame(&mut send, &bytes)
            .await
            .map_err(TransportError::from)?;
        let response = ovule_link_transport::frame::read_frame(&mut recv)
            .await
            .map_err(TransportError::from)?;
        match serde_json::from_slice::<TunnelResponse>(&response)
            .map_err(|error| TransportError::Protocol(error.to_string()))?
        {
            TunnelResponse::Ok(_) => {}
            TunnelResponse::Pending => {
                return Err(TransportError::Unauthorized(
                    "waiting for Host approval".to_owned(),
                ));
            }
            TunnelResponse::Error(error) => return Err(TransportError::Protocol(error)),
        }
        let (stdin, mut input) = tokio::io::duplex(64 * 1024);
        let (mut output, stdout) = tokio::io::duplex(64 * 1024);
        let (mut errors, stderr) = tokio::io::duplex(64 * 1024);
        let (lifetime, stop) = tokio::sync::oneshot::channel();
        let (completed, completion) = tokio::sync::oneshot::channel();
        tokio::spawn(async move {
            let input_task = tokio::spawn(async move {
                let result = tokio::io::copy(&mut input, &mut send).await;
                let _ = send.finish();
                result
            });
            let output_task = tokio::spawn(async move {
                loop {
                    let kind = recv.read_u8().await?;
                    let length = recv.read_u32().await? as usize;
                    if length > MAX_FRAME {
                        return Err(std::io::Error::new(
                            std::io::ErrorKind::InvalidData,
                            "Link process frame exceeds limit",
                        ));
                    }
                    if kind == 0 {
                        return Ok(if length == 0 {
                            None
                        } else {
                            i32::try_from(length - 1).ok()
                        });
                    }
                    let mut bytes = vec![0_u8; length];
                    recv.read_exact(&mut bytes).await.map_err(|error| {
                        std::io::Error::new(std::io::ErrorKind::UnexpectedEof, error.to_string())
                    })?;
                    match kind {
                        1 => output.write_all(&bytes).await?,
                        2 => errors.write_all(&bytes).await?,
                        _ => {
                            return Err(std::io::Error::new(
                                std::io::ErrorKind::InvalidData,
                                "unknown Link process stream",
                            ));
                        }
                    }
                }
            });
            tokio::select! {
                _ = stop => {},
                result = output_task => {
                    let exit_code = result.ok().and_then(Result::ok).flatten();
                    let _ = completed.send(exit_code);
                },
            }
            input_task.abort();
            drop(connection);
        });
        Ok(super::WorkspaceProcess::new(
            stdin, stdout, stderr, lifetime, completion,
        ))
    }
}

#[async_trait]
impl WorkspaceTransport for TunnelTransport {
    async fn spawn_shell(&self, command: &str) -> Result<super::WorkspaceProcess, TransportError> {
        self.spawn_operation(TunnelOperation::SpawnShell(command.to_owned()))
            .await
    }

    async fn spawn(
        &self,
        argv: &[String],
        environment: &BTreeMap<String, String>,
    ) -> Result<super::WorkspaceProcess, TransportError> {
        self.spawn_operation(TunnelOperation::Spawn {
            argv: argv.to_vec(),
            environment: environment.clone(),
        })
        .await
    }

    async fn spawn_agent(
        &self,
        agent_id: &str,
        model_provider: Option<&str>,
        model_remote_id: Option<&str>,
    ) -> Result<super::WorkspaceProcess, TransportError> {
        self.spawn_operation(TunnelOperation::SpawnAgent {
            agent_id: agent_id.to_owned(),
            model_provider: model_provider.map(str::to_owned),
            model_remote_id: model_remote_id.map(str::to_owned),
        })
        .await
    }

    async fn computer_use_mcp_endpoint(&self) -> Result<ComputerUseMcpEndpoint, TransportError> {
        self.computer_use_mcp_endpoint_request().await
    }

    async fn computer_use_snapshot(
        &self,
        screen_id: Option<i64>,
    ) -> Result<RemotingSnapshot, TransportError> {
        self.computer_use_snapshot_request(screen_id).await
    }

    async fn computer_use_input(&self, event: RemotingInputEvent) -> Result<(), TransportError> {
        self.computer_use_input_request(event).await
    }
    fn kind(&self) -> TransportKind {
        TransportKind::Tunnel
    }
    async fn probe(&self) -> Result<(), TransportError> {
        match self.request(TunnelOperation::Probe).await? {
            TunnelPayload::Empty => Ok(()),
            _ => Err(protocol()),
        }
    }
    async fn stat(&self, relative: &str) -> Result<EntryStat, TransportError> {
        match self
            .request(TunnelOperation::Stat(relative.to_owned()))
            .await?
        {
            TunnelPayload::Stat(v) => Ok(v),
            _ => Err(protocol()),
        }
    }
    async fn list_directory(&self, relative: &str) -> Result<Vec<EntryStat>, TransportError> {
        match self
            .request(TunnelOperation::List(relative.to_owned()))
            .await?
        {
            TunnelPayload::Entries(v) => Ok(v),
            _ => Err(protocol()),
        }
    }
    async fn read_file(&self, relative: &str) -> Result<Vec<u8>, TransportError> {
        match self
            .request(TunnelOperation::Read(relative.to_owned()))
            .await?
        {
            TunnelPayload::Bytes(v) => Ok(v),
            _ => Err(protocol()),
        }
    }
    async fn write_file(&self, relative: &str, bytes: &[u8]) -> Result<(), TransportError> {
        self.request(TunnelOperation::Write(relative.to_owned(), bytes.to_vec()))
            .await
            .map(|_| ())
    }
    async fn exec(&self, argv: &[String]) -> Result<ExecOutcome, TransportError> {
        match self.request(TunnelOperation::Exec(argv.to_vec())).await? {
            TunnelPayload::Exec(v) => Ok(v),
            _ => Err(protocol()),
        }
    }
    async fn exec_shell(&self, command: &str) -> Result<ExecOutcome, TransportError> {
        match self
            .request(TunnelOperation::ExecShell(command.to_owned()))
            .await?
        {
            TunnelPayload::Exec(v) => Ok(v),
            _ => Err(protocol()),
        }
    }
}

struct HostDispatcher {
    access: Arc<Mutex<HostAccess>>,
    access_path: PathBuf,
    managed_toolchains: PathBuf,
    agent_runtime: Option<Arc<dyn HostAgentRuntime>>,
    remote_control: Arc<dyn ComputerUseHost>,
    control_sessions: Arc<dyn HostSessions>,
    computer_use_mcp_endpoint: Option<ComputerUseMcpEndpoint>,
    host_id: String,
    online_clients: Arc<Mutex<BTreeMap<String, usize>>>,
    last_seen_clients: Arc<Mutex<BTreeMap<String, Instant>>>,
}
#[async_trait]
impl ovule_link_transport::LinkHandler for HostDispatcher {
    fn connected(&self, peer: &str) {
        *lock(&self.online_clients)
            .entry(peer.to_owned())
            .or_default() += 1;
        lock(&self.last_seen_clients).insert(peer.to_owned(), Instant::now());
    }
    fn disconnected(&self, peer: &str) {
        let mut clients = lock(&self.online_clients);
        if let Some(count) = clients.get_mut(peer) {
            *count = count.saturating_sub(1);
            if *count == 0 {
                clients.remove(peer);
            }
        }
    }
    async fn handle(
        &self,
        peer: String,
        send: iroh::endpoint::SendStream,
        recv: iroh::endpoint::RecvStream,
    ) {
        handle_stream(
            self.access.clone(),
            self.access_path.clone(),
            self.managed_toolchains.clone(),
            self.agent_runtime.clone(),
            self.remote_control.clone(),
            self.control_sessions.clone(),
            self.computer_use_mcp_endpoint.clone(),
            self.host_id.clone(),
            peer,
            send,
            recv,
        )
        .await;
    }
}

#[allow(clippy::too_many_arguments, clippy::too_many_lines)]
async fn handle_stream(
    access: Arc<Mutex<HostAccess>>,
    access_path: PathBuf,
    managed_toolchains: PathBuf,
    agent_runtime: Option<Arc<dyn HostAgentRuntime>>,
    remote_control: Arc<dyn ComputerUseHost>,
    control_sessions: Arc<dyn HostSessions>,
    computer_use_mcp_endpoint: Option<ComputerUseMcpEndpoint>,
    host_id: String,
    remote: String,
    mut send: iroh::endpoint::SendStream,
    mut recv: iroh::endpoint::RecvStream,
) {
    let request = ovule_link_transport::frame::read_frame(&mut recv)
        .await
        .map_err(|error| error.to_string())
        .and_then(|bytes| {
            decode_request(&bytes).map_err(|error| format!("decode Link request: {error}"))
        });
    if request.as_ref().is_ok_and(|request| {
        matches!(
            request.operation,
            TunnelOperation::Spawn { .. }
                | TunnelOperation::SpawnAgent { .. }
                | TunnelOperation::SpawnShell(_)
        )
    }) {
        let Ok(TunnelRequest {
            share_id,
            operation,
            ..
        }) = request
        else {
            unreachable!("process request was decoded")
        };
        let early_authorization = {
            let access = lock(&access);
            access.ensure_ready().and_then(|()| {
                let device = access.devices.get(&remote).ok_or("device is not paired")?;
                if !device.workspace_ids.contains(&share_id) {
                    return Err("Workspace is not granted to this device".into());
                }
                if !access.shares.contains_key(&share_id) {
                    return Err("unknown Workspace share".into());
                }
                if let TunnelOperation::SpawnAgent { agent_id, .. } = &operation
                    && !device.agent_ids.contains(agent_id)
                {
                    return Err(format!("Agent {agent_id} is not granted to this device"));
                }
                Ok(())
            })
        };
        if let Err(error) = early_authorization {
            write_spawn_response(&mut send, TunnelResponse::Error(error)).await;
            return;
        }
        let (mut argv, environment, requested_agent) = match operation {
            TunnelOperation::Spawn { argv, environment } => (argv, environment, None),
            TunnelOperation::SpawnAgent {
                agent_id,
                model_provider,
                model_remote_id,
            } => match prepare_host_agent(
                agent_runtime.as_deref(),
                &managed_toolchains,
                &agent_id,
                model_provider.as_deref(),
                model_remote_id.as_deref(),
            ) {
                Ok((argv, environment)) => (argv, environment, Some(agent_id)),
                Err(error) => {
                    write_spawn_response(&mut send, TunnelResponse::Error(error)).await;
                    return;
                }
            },
            TunnelOperation::SpawnShell(command) => {
                let argv = if cfg!(windows) {
                    vec![
                        "powershell.exe".to_owned(),
                        "-NoProfile".to_owned(),
                        "-NonInteractive".to_owned(),
                        "-Command".to_owned(),
                        command,
                    ]
                } else {
                    vec!["sh".to_owned(), "-lc".to_owned(), command]
                };
                (argv, BTreeMap::new(), None)
            }
            _ => unreachable!("process operation matched above"),
        };
        let requested_agent = requested_agent.or_else(|| {
            argv.first().and_then(|program| {
                agent_runtime
                    .as_deref()
                    .and_then(|runtime| runtime.agent_id(program))
            })
        });
        let authorized_root = {
            let access = lock(&access);
            access.ensure_ready().and_then(|()| {
                access.devices.get(&remote).map_or_else(
                    || Err("device is not paired".to_owned()),
                    |device| {
                        if !device.workspace_ids.contains(&share_id) {
                            return Err("Workspace is not granted to this device".to_owned());
                        }
                        if let Some(agent_id) = requested_agent.as_ref()
                            && !device.agent_ids.iter().any(|granted| granted == agent_id)
                        {
                            return Err(format!("Agent {agent_id} is not granted to this device"));
                        }
                        access
                            .shares
                            .get(&share_id)
                            .map(|(root, _)| root.clone())
                            .ok_or_else(|| "unknown Workspace share".to_owned())
                    },
                )
            })
        };
        if let Some(program) = argv.first_mut()
            && let Some(resolved) = agent_runtime
                .as_deref()
                .and_then(|runtime| runtime.resolve_program(program, &managed_toolchains))
        {
            *program = resolved.to_string_lossy().into_owned();
        }
        let process = match authorized_root {
            Ok(root) => match LocalTransport::new(root) {
                Ok(local) => local.spawn(&argv, &environment).await,
                Err(error) => Err(error),
            },
            Err(error) => Err(TransportError::Unauthorized(error)),
        };
        let response = match &process {
            Ok(_) => TunnelResponse::Ok(TunnelPayload::Empty),
            Err(error) => TunnelResponse::Error(error.to_string()),
        };
        if !write_spawn_response(&mut send, response).await {
            return;
        }
        if let Ok(mut process) = process {
            let mut process_stdin =
                std::mem::replace(&mut process.stdin, Box::pin(tokio::io::sink()));
            let input_task = tokio::spawn(async move {
                let result = tokio::io::copy(&mut recv, &mut process_stdin).await;
                drop(process_stdin);
                result
            });
            let mut stdout_open = true;
            let mut stderr_open = true;
            let mut stdout_buffer = vec![0_u8; 16 * 1024];
            let mut stderr_buffer = vec![0_u8; 16 * 1024];
            while stdout_open || stderr_open {
                let (kind, bytes) = tokio::select! {
                    read = process.stdout.read(&mut stdout_buffer), if stdout_open => match read {
                        Ok(0) => { stdout_open = false; continue; }
                        Ok(length) => (1_u8, &stdout_buffer[..length]),
                        Err(_) => break,
                    },
                    read = process.stderr.read(&mut stderr_buffer), if stderr_open => match read {
                        Ok(0) => { stderr_open = false; continue; }
                        Ok(length) => (2_u8, &stderr_buffer[..length]),
                        Err(_) => break,
                    },
                };
                if send.write_u8(kind).await.is_err()
                    || send
                        .write_u32(u32::try_from(bytes.len()).unwrap_or_default())
                        .await
                        .is_err()
                    || send.write_all(bytes).await.is_err()
                {
                    break;
                }
            }
            let exit_code = process.wait().await;
            let encoded_exit_code = exit_code
                .and_then(|code| u32::try_from(code).ok())
                .and_then(|code| code.checked_add(1))
                .unwrap_or_default();
            let _ = send.write_u8(0).await;
            let _ = send.write_u32(encoded_exit_code).await;
            input_task.abort();
        }
        let _ = send.finish();
        return;
    }
    let response = match request {
        Ok(request) => {
            serve(
                TunnelServeContext {
                    access: &access,
                    access_path: &access_path,
                    managed_toolchains: &managed_toolchains,
                    remote_control: remote_control.as_ref(),
                    agent_runtime: agent_runtime.as_deref(),
                    control_sessions: control_sessions.as_ref(),
                    computer_use_mcp_endpoint: computer_use_mcp_endpoint.as_ref(),
                    host_id: &host_id,
                },
                &remote,
                request,
            )
            .await
        }
        Err(error) => TunnelResponse::Error(error),
    };
    if let Ok(bytes) = serde_json::to_vec(&response) {
        let _ = send.write_all(&bytes).await;
    }
    let _ = send.finish();
}

async fn write_spawn_response(
    send: &mut iroh::endpoint::SendStream,
    response: TunnelResponse,
) -> bool {
    let Ok(bytes) = serde_json::to_vec(&response) else {
        return false;
    };
    ovule_link_transport::frame::write_frame(send, &bytes)
        .await
        .is_ok()
}

fn prepare_host_agent(
    runtime: Option<&dyn HostAgentRuntime>,
    managed_toolchains: &std::path::Path,
    agent_id: &str,
    model_provider: Option<&str>,
    model_remote_id: Option<&str>,
) -> Result<(Vec<String>, BTreeMap<String, String>), String> {
    runtime
        .ok_or_else(|| "Host Agent runtime is unavailable".to_owned())?
        .prepare(
            managed_toolchains,
            agent_id,
            model_provider,
            model_remote_id,
        )
}

fn host_agents(
    runtime: Option<&dyn HostAgentRuntime>,
    managed_toolchains: &std::path::Path,
) -> Vec<HostAgentDescriptor> {
    runtime.map_or_else(
        || {
            vec![HostAgentDescriptor {
                id: "ovule".into(),
                available: true,
            }]
        },
        |runtime| runtime.agents(managed_toolchains),
    )
}

#[allow(clippy::too_many_arguments)]
fn host_hello_response(
    access: &Mutex<HostAccess>,
    managed_toolchains: &std::path::Path,
    remote_control: &dyn ComputerUseHost,
    agent_runtime: Option<&dyn HostAgentRuntime>,
    computer_use_mcp_endpoint: Option<&ComputerUseMcpEndpoint>,
    host_id: &str,
    remote: &str,
    requested_share: &str,
) -> TunnelResponse {
    let (workspace_ids, agent_ids) = lock(access)
        .devices
        .get(remote)
        .map(|device| (device.workspace_ids.clone(), device.agent_ids.clone()))
        .unwrap_or_default();
    let workspaces = {
        let access = lock(access);
        workspace_ids
            .iter()
            .filter_map(|id| {
                access
                    .shares
                    .get(id)
                    .map(|(root, alias)| HostWorkspaceDescriptor {
                        id: id.clone(),
                        root: external_path(root),
                        alias: alias.clone(),
                    })
            })
            .collect::<Vec<_>>()
    };
    let workspace_root = workspaces
        .iter()
        .find(|workspace| workspace.id == requested_share)
        .or_else(|| workspaces.first())
        .map_or_else(String::new, |workspace| workspace.root.clone());
    let mut capabilities = [
        Capability::WorkspaceFiles,
        Capability::WorkspaceProcess,
        Capability::AgentAcp,
    ]
    .into_iter()
    .map(|capability| capability.as_str().to_owned())
    .collect::<Vec<_>>();
    if remote_control.is_supported() {
        capabilities.extend([
            Capability::DesktopControl.as_str().to_owned(),
            Capability::PointerLatest.as_str().to_owned(),
            Capability::ClipboardText.as_str().to_owned(),
        ]);
        if computer_use_mcp_endpoint.is_some() {
            capabilities.push(Capability::ComputerUseMcp.as_str().to_owned());
        }
    }
    TunnelResponse::Ok(TunnelPayload::Hello(HostHello {
        host_id: host_id.to_owned(),
        platform: std::env::consts::OS.to_owned(),
        workspace_root,
        capabilities,
        agents: host_agents(agent_runtime, managed_toolchains)
            .into_iter()
            .filter(|agent| agent.available && agent_ids.contains(&agent.id))
            .collect(),
        workspaces,
    }))
}

struct TunnelServeContext<'a> {
    access: &'a Mutex<HostAccess>,
    access_path: &'a std::path::Path,
    managed_toolchains: &'a std::path::Path,
    remote_control: &'a dyn ComputerUseHost,
    agent_runtime: Option<&'a dyn HostAgentRuntime>,
    control_sessions: &'a dyn HostSessions,
    computer_use_mcp_endpoint: Option<&'a ComputerUseMcpEndpoint>,
    host_id: &'a str,
}

#[allow(clippy::too_many_lines)]
async fn serve(
    context: TunnelServeContext<'_>,
    remote: &str,
    request: TunnelRequest,
) -> TunnelResponse {
    let TunnelServeContext {
        access,
        access_path,
        managed_toolchains,
        remote_control,
        agent_runtime,
        control_sessions,
        computer_use_mcp_endpoint,
        host_id,
    } = context;
    if lock(access).requires_reset() {
        return TunnelResponse::Error(format!(
            "The receiving Host ({host_id}) cannot read its authorization data. Repair the local Host data on that device; resetting this Client cannot repair it."
        ));
    }
    let client_name = normalize_device_name(&request.client_name, remote);
    let (approved, pending_code) = {
        let mut access = lock(access);
        let approved = access.devices.contains_key(remote);
        let pending_code = (!approved).then(|| {
            let pending = access
                .pending_clients
                .entry(remote.to_owned())
                .or_insert_with(|| TunnelPendingClient {
                    name: client_name.clone(),
                    code: random_pairing_code(),
                });
            pending.name.clone_from(&client_name);
            pending.code.clone()
        });
        (approved, pending_code)
    };
    if !approved {
        let pairing_token_matches = lock(access).pairing_token == request.share_id;
        if !pairing_token_matches {
            return TunnelResponse::Error("pair link has expired; generate a new link".to_owned());
        }
        if let TunnelOperation::Pair { code } = &request.operation {
            if Some(code) != pending_code.as_ref() {
                return TunnelResponse::Error("pairing code is incorrect".to_owned());
            }
            let mut access = lock(access);
            let mut candidate = access.clone();
            candidate.pending_clients.remove(remote);
            candidate
                .devices
                .entry(remote.to_owned())
                .or_insert_with(|| TunnelDeviceAccess {
                    client_id: remote.to_owned(),
                    name: client_name.clone(),
                    workspace_ids: Vec::new(),
                    agent_ids: Vec::new(),
                    online: true,
                });
            if let Err(error) = persist_access(access_path, &candidate) {
                return TunnelResponse::Error(error);
            }
            *access = candidate;
            return TunnelResponse::Ok(TunnelPayload::Empty);
        }
        return TunnelResponse::Pending;
    }
    let rename = {
        let access = lock(access);
        access
            .devices
            .get(remote)
            .is_some_and(|device| device.name != client_name)
    };
    if rename {
        let mut access = lock(access);
        let mut candidate = access.clone();
        if let Some(device) = candidate.devices.get_mut(remote) {
            device.name.clone_from(&client_name);
        }
        if let Err(error) = persist_access(access_path, &candidate) {
            return TunnelResponse::Error(error);
        }
        *access = candidate;
    }
    if matches!(request.operation, TunnelOperation::Unsupported) {
        return TunnelResponse::Error("unsupported Link method".into());
    }
    if matches!(request.operation, TunnelOperation::Hello) {
        // Query native services after application initialization, on authenticated
        // discovery, rather than caching a premature startup failure.
        if !remote_control.is_supported() {
            remote_control.refresh_capabilities().await;
        }
        return host_hello_response(
            access,
            managed_toolchains,
            remote_control,
            agent_runtime,
            computer_use_mcp_endpoint,
            host_id,
            remote,
            &request.share_id,
        );
    }
    let remote_control_result = match &request.operation {
        TunnelOperation::RemoteControlStart(options) => {
            let started = control_sessions.start(remote, options.clone()).await;
            if let Ok(session) = started.as_ref() {
                let approved = lock(access).devices.contains_key(remote);
                if !approved {
                    let _ = control_sessions.stop(remote, session.id).await;
                    return TunnelResponse::Error(
                        "device was revoked during desktop startup".into(),
                    );
                }
            }
            Some(started.map(TunnelPayload::RemotingSession))
        }
        TunnelOperation::RemoteControlSignal { session_id, signal } => Some(
            control_sessions
                .signal(remote, *session_id, signal.clone())
                .await
                .map(|()| TunnelPayload::Empty),
        ),
        TunnelOperation::RemoteControlWatch {
            session_id,
            after_sequence,
        } => Some(
            control_sessions
                .watch(remote, *session_id, *after_sequence)
                .await
                .map(TunnelPayload::RemoteControlUpdate),
        ),
        TunnelOperation::RemoteControlClipboard { session_id, text } => Some(
            control_sessions
                .clipboard(remote, *session_id, text.clone())
                .await
                .map(|()| TunnelPayload::Empty),
        ),
        TunnelOperation::RemoteControlStop { session_id } => Some(
            control_sessions
                .stop(remote, *session_id)
                .await
                .map(|()| TunnelPayload::Empty),
        ),
        TunnelOperation::ComputerUseSnapshot { screen_id } => Some(
            remote_control
                .snapshot(*screen_id)
                .await
                .map(TunnelPayload::ComputerUseSnapshot),
        ),
        TunnelOperation::ComputerUseInput { event } => Some(
            remote_control
                .inject_input(event.clone())
                .await
                .map(|()| TunnelPayload::Empty),
        ),
        _ => None,
    };
    if let Some(result) = remote_control_result {
        return result.map_or_else(TunnelResponse::Error, TunnelResponse::Ok);
    }
    let root = {
        let access = lock(access);
        let Some(device) = access.devices.get(remote) else {
            return TunnelResponse::Error("device is not paired".to_owned());
        };
        if !device.workspace_ids.contains(&request.share_id) {
            return TunnelResponse::Error("Workspace is not granted to this device".to_owned());
        }
        let Some((root, _)) = access.shares.get(&request.share_id) else {
            return TunnelResponse::Error("unknown Workspace share".to_owned());
        };
        root.clone()
    };
    let Ok(local) = LocalTransport::new(root) else {
        return TunnelResponse::Error("shared Workspace is unavailable".to_owned());
    };
    let result = match request.operation {
        TunnelOperation::Unsupported => {
            Err(TransportError::Protocol("unsupported Link method".into()))
        }
        TunnelOperation::Spawn { .. }
        | TunnelOperation::SpawnAgent { .. }
        | TunnelOperation::SpawnShell(_) => Err(TransportError::Protocol(
            "process stream required".to_owned(),
        )),
        TunnelOperation::Hello => unreachable!("Host Hello returned before Workspace routing"),
        TunnelOperation::Pair { .. } | TunnelOperation::Probe => {
            local.probe().await.map(|()| TunnelPayload::Empty)
        }
        TunnelOperation::ComputerUseMcpEndpoint => computer_use_mcp_endpoint
            .cloned()
            .map(TunnelPayload::ComputerUseMcpEndpoint)
            .ok_or_else(|| {
                TransportError::Unavailable(
                    "Host CRD Computer Use MCP endpoint is unavailable".to_owned(),
                )
            }),
        TunnelOperation::Stat(path) => local.stat(&path).await.map(TunnelPayload::Stat),
        TunnelOperation::List(path) => local
            .list_directory(&path)
            .await
            .map(TunnelPayload::Entries),
        TunnelOperation::Read(path) => local.read_file(&path).await.map(TunnelPayload::Bytes),
        TunnelOperation::Write(path, bytes) => local
            .write_file(&path, &bytes)
            .await
            .map(|()| TunnelPayload::Empty),
        TunnelOperation::Exec(argv) => local.exec(&argv).await.map(TunnelPayload::Exec),
        TunnelOperation::ExecShell(command) => {
            local.exec_shell(&command).await.map(TunnelPayload::Exec)
        }
        TunnelOperation::RemoteControlStart(_)
        | TunnelOperation::RemoteControlSignal { .. }
        | TunnelOperation::RemoteControlWatch { .. }
        | TunnelOperation::RemoteControlClipboard { .. }
        | TunnelOperation::RemoteControlStop { .. } => {
            unreachable!("Remote Control returned before Workspace routing")
        }
        TunnelOperation::ComputerUseSnapshot { .. } | TunnelOperation::ComputerUseInput { .. } => {
            unreachable!("Computer Use returned before Workspace routing")
        }
    };
    result.map_or_else(
        |error| TunnelResponse::Error(error.to_string()),
        TunnelResponse::Ok,
    )
}

fn share_id(root: &std::path::Path) -> String {
    workspace_share_id(&external_path(root))
}

pub fn workspace_share_id(root: &str) -> String {
    format!("{:x}", Sha256::digest(root.as_bytes()))[..24].to_owned()
}
fn unique_sorted(mut values: Vec<String>) -> Vec<String> {
    values.sort();
    values.dedup();
    values
}
fn local_device_name() -> String {
    std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .map_or_else(
            |_| "Ovule Device".to_owned(),
            |name| normalize_device_name(&name, ""),
        )
}
fn normalize_device_name(name: &str, client_id: &str) -> String {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return format!("Device {}", client_id.chars().take(8).collect::<String>());
    }
    trimmed.chars().take(80).collect()
}
fn random_pairing_code() -> String {
    format!("{:06}", rand::random::<u32>() % 1_000_000)
}
fn random_pairing_token() -> String {
    format!(
        "{:016x}{:016x}",
        rand::random::<u64>(),
        rand::random::<u64>()
    )
}
fn protocol() -> TransportError {
    TransportError::Protocol("unexpected Ovule Link response".to_owned())
}
fn actionable_link_error(message: String) -> String {
    if message.contains("missing field `iceServers`")
        || message.contains("missing field `ice_servers`")
    {
        return "The receiving Host is still running an older Remote Control build. Close every old Ovule process on that device, launch the current build, then use Reset this Host Link identity and pair again. Resetting only this Client cannot update the Host.".into();
    }
    message
}
fn lock<T>(value: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    value
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

#[async_trait]
impl ControlTransport for TunnelTransport {
    async fn start(&self, request: StartRequest) -> Result<StartedSession, String> {
        self.hello()
            .await
            .map_err(|error| format!("Link authorization failed before desktop startup: {error}"))?
            .require(Capability::DesktopControl)?;
        match self
            .control_request(TunnelOperation::RemoteControlStart(request))
            .await
            .map_err(|e| format!("Host desktop startup failed before ICE configuration: {e}"))?
        {
            TunnelPayload::RemotingSession(session) => Ok(session),
            _ => Err("invalid Start response".into()),
        }
    }
    async fn signal(&self, session_id: u64, signal: Signal) -> Result<(), String> {
        match self
            .control_request(TunnelOperation::RemoteControlSignal { session_id, signal })
            .await
            .map_err(|e| e.to_string())?
        {
            TunnelPayload::Empty => Ok(()),
            _ => Err("invalid Signal response".into()),
        }
    }
    async fn watch(&self, session_id: u64, after_sequence: u64) -> Result<HostUpdate, String> {
        match self
            .control_request(TunnelOperation::RemoteControlWatch {
                session_id,
                after_sequence,
            })
            .await
            .map_err(|e| e.to_string())?
        {
            TunnelPayload::RemoteControlUpdate(update) => Ok(update),
            _ => Err("invalid Watch response".into()),
        }
    }
    async fn clipboard(&self, session_id: u64, text: String) -> Result<(), String> {
        self.hello()
            .await
            .map_err(|error| error.to_string())?
            .require(Capability::ClipboardText)?;
        match self
            .control_request(TunnelOperation::RemoteControlClipboard { session_id, text })
            .await
            .map_err(|e| e.to_string())?
        {
            TunnelPayload::Empty => Ok(()),
            _ => Err("invalid Clipboard response".into()),
        }
    }
    async fn stop(&self, session_id: u64) -> Result<(), String> {
        match self
            .control_request(TunnelOperation::RemoteControlStop { session_id })
            .await
            .map_err(|e| e.to_string())?
        {
            TunnelPayload::Empty => Ok(()),
            _ => Err("invalid Stop response".into()),
        }
    }
}

impl crate::TunnelHost for NativeTunnelHost {
    fn handle(&self) -> TunnelHostHandle {
        self.handle()
    }
    fn ensure_started(&mut self) -> Result<(), String> {
        self.ensure_started()
    }
    fn reset_identity(&mut self) -> Result<(), String> {
        self.reset_identity()
    }
    fn shutdown(&mut self) {
        self.shutdown();
    }
    fn set_computer_use_mcp_endpoint(&mut self, endpoint: Option<ComputerUseMcpEndpoint>) {
        self.set_computer_use_mcp_endpoint(endpoint);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use agent_client_protocol::Client;
    use agent_client_protocol::schema::ProtocolVersion;
    use agent_client_protocol::schema::v1::{
        ContentBlock, Implementation, InitializeRequest, NewSessionRequest, PromptRequest,
        StopReason, TextContent,
    };
    use iroh::RelayMode;
    use tokio_util::compat::{TokioAsyncReadCompatExt as _, TokioAsyncWriteCompatExt as _};

    struct TestHostAgentRuntime(Arc<std::sync::atomic::AtomicUsize>);

    impl HostAgentRuntime for TestHostAgentRuntime {
        fn resolve_program(&self, _: &str, _: &std::path::Path) -> Option<PathBuf> {
            None
        }
        fn agent_id(&self, program: &str) -> Option<String> {
            (program == "codex-acp").then(|| "codex".to_owned())
        }
        fn agents(&self, _: &std::path::Path) -> Vec<HostAgentDescriptor> {
            vec![HostAgentDescriptor {
                id: "ovule".into(),
                available: true,
            }]
        }
        fn prepare(
            &self,
            _managed_toolchains: &std::path::Path,
            agent_id: &str,
            _model_provider: Option<&str>,
            model_remote_id: Option<&str>,
        ) -> Result<(Vec<String>, BTreeMap<String, String>), String> {
            self.0.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            assert_eq!(model_remote_id, Some("remote-model"));
            if agent_id == "remote-acp" {
                let python = which::which("python3")
                    .or_else(|_| which::which("python"))
                    .map_err(|error| error.to_string())?;
                let script = r"import json,sys
for line in sys.stdin:
 r=json.loads(line); method=r.get('method'); ident=r.get('id')
 if method=='initialize': result={'protocolVersion':1,'agentCapabilities':{}}
 elif method=='session/new': result={'sessionId':'remote-session'}
 elif method=='session/prompt': result={'stopReason':'end_turn'}
 else: continue
 print(json.dumps({'jsonrpc':'2.0','id':ident,'result':result}), flush=True)
";
                return Ok((
                    vec![
                        python.to_string_lossy().into_owned(),
                        "-u".to_owned(),
                        "-c".to_owned(),
                        script.to_owned(),
                    ],
                    BTreeMap::new(),
                ));
            }
            assert_eq!(agent_id, "remote-only");
            let argv = if cfg!(windows) {
                vec![
                    "powershell.exe".to_owned(),
                    "-NoProfile".to_owned(),
                    "-Command".to_owned(),
                    "$line=[Console]::In.ReadLine(); [Console]::Out.Write('remote-agent:' + $line)"
                        .to_owned(),
                ]
            } else {
                vec![
                    "sh".to_owned(),
                    "-c".to_owned(),
                    "read line; printf 'remote-agent:%s' \"$line\"".to_owned(),
                ]
            };
            Ok((argv, BTreeMap::new()))
        }
    }

    #[test]
    fn regenerating_pair_link_rotates_token_and_clears_pending_requests() {
        let directory = tempfile::tempdir().unwrap();
        let secrets = Arc::new(ovule_secrets::providers::open(directory.path()).unwrap());
        let host = NativeTunnelHost::new(secrets);
        *lock(&host.handle.endpoint_addr) = Some(EndpointAddr::from_parts(
            SecretKey::generate().public(),
            std::iter::empty::<TransportAddr>(),
        ));
        lock(&host.handle.access).pending_clients.insert(
            "client".to_owned(),
            TunnelPendingClient {
                name: "Laptop".to_owned(),
                code: "123456".to_owned(),
            },
        );
        let before = host.handle.pairing_status().unwrap().share_id;
        let after = host.handle.regenerate_pairing_status().unwrap();
        assert_ne!(before, after.share_id);
        assert!(after.pending.is_empty());
        {
            let mut access = lock(&host.handle.access);
            access.devices.insert(
                "client".to_owned(),
                TunnelDeviceAccess {
                    client_id: "client".to_owned(),
                    name: "Laptop".to_owned(),
                    workspace_ids: vec!["workspace".to_owned()],
                    agent_ids: vec!["ovule".to_owned()],
                    online: false,
                },
            );
            access.shares.insert(
                "workspace".to_owned(),
                (directory.path().to_path_buf(), "workspace".to_owned()),
            );
        }
        lock(&host.handle.online_clients).insert("client".to_owned(), 1);
        assert!(host.handle.pairing_status().unwrap().devices[0].online);
        lock(&host.handle.online_clients).clear();
        assert!(!host.handle.pairing_status().unwrap().devices[0].online);
        let token = after.share_id;
        host.handle.reset_access().unwrap();
        let reset = host.handle.pairing_status().unwrap();
        assert_ne!(reset.share_id, token);
        assert!(reset.pending.is_empty());
        assert_eq!(reset.devices.len(), 0);
        assert_eq!(reset.workspaces.len(), 0);
    }

    #[tokio::test(flavor = "multi_thread")]
    #[allow(clippy::too_many_lines)]
    async fn link_requires_pairing_then_serves_workspace_operations() {
        let directory = tempfile::tempdir().unwrap();
        let second_directory = tempfile::tempdir().unwrap();
        std::fs::write(directory.path().join("hello.txt"), b"hello").unwrap();
        std::fs::write(second_directory.path().join("second.txt"), b"second").unwrap();
        let host = Endpoint::builder(presets::N0)
            .alpns(vec![ALPN.to_vec()])
            .relay_mode(RelayMode::Disabled)
            .bind()
            .await
            .unwrap();
        let client_secret = SecretKey::generate();
        let client_id = client_secret.public().to_string();
        let access = Arc::new(Mutex::new(HostAccess::default()));
        let pairing_token = lock(&access).pairing_token.clone();
        let first_share_id = share_id(directory.path());
        let second_share_id = share_id(second_directory.path());
        lock(&access).shares.insert(
            first_share_id.clone(),
            (directory.path().to_path_buf(), "test".to_owned()),
        );
        let test_access_path = directory.path().join("test-access.json");
        let test_toolchains = directory.path().join("toolchains");
        let prepare_calls = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let server = tokio::spawn({
            let prepare_calls = prepare_calls.clone();
            let host = host.clone();
            let access = Arc::clone(&access);
            let test_access_path = test_access_path.clone();
            let test_toolchains = test_toolchains.clone();
            async move {
                while let Some(incoming) = host.accept().await {
                    let connection = incoming.await.unwrap();
                    let remote = connection.remote_id().to_string();
                    let access = Arc::clone(&access);
                    let test_access_path = test_access_path.clone();
                    let test_toolchains = test_toolchains.clone();
                    let prepare_calls = prepare_calls.clone();
                    tokio::spawn(async move {
                        while let Ok((send, recv)) = connection.accept_bi().await {
                            tokio::spawn(handle_stream(
                                Arc::clone(&access),
                                test_access_path.clone(),
                                test_toolchains.clone(),
                                Some(Arc::new(TestHostAgentRuntime(prepare_calls.clone()))),
                                ovule_remoting::providers::unavailable_computer_use(),
                                ovule_remoting::providers::host_sessions(
                                    ovule_remoting::providers::unavailable_desktop(),
                                    ovule_remoting::providers::host_ice_configuration(),
                                ),
                                Some(ComputerUseMcpEndpoint {
                                    url: "http://127.0.0.1:43124/mcp".to_owned(),
                                    bearer_token: "host-secret".to_owned(),
                                }),
                                "test-host".to_owned(),
                                remote.clone(),
                                send,
                                recv,
                            ));
                        }
                    });
                }
            }
        });
        let expired = TunnelTransport::new(TunnelClientConfig {
            endpoint_addr: host.addr(),
            share_id: "expired-pair-token".to_owned(),
            client_secret: serde_json::to_string(&client_secret).unwrap(),
        });
        assert!(
            expired
                .hello()
                .await
                .unwrap_err()
                .to_string()
                .contains("pair link has expired")
        );
        let denied = expired
            .spawn_agent("remote-only", None, None)
            .await
            .err()
            .unwrap()
            .to_string();
        assert!(denied.contains("device is not paired"));
        assert_eq!(prepare_calls.load(std::sync::atomic::Ordering::Relaxed), 0);
        let pairing_transport = TunnelTransport::new(TunnelClientConfig {
            endpoint_addr: host.addr(),
            share_id: pairing_token,
            client_secret: serde_json::to_string(&client_secret).unwrap(),
        });
        let error = pairing_transport.hello().await.unwrap_err().to_string();
        assert!(error.contains("waiting for Host approval"));
        let code = lock(&access)
            .pending_clients
            .get(&client_id)
            .unwrap()
            .code
            .clone();
        assert!(
            pairing_transport
                .submit_pairing_code("000000")
                .await
                .is_err()
        );
        pairing_transport.submit_pairing_code(&code).await.unwrap();
        assert!(lock(&access).devices.contains_key(&client_id));
        assert_ne!(lock(&access).devices[&client_id].name, "");
        let denied = pairing_transport
            .spawn_agent("remote-only", None, None)
            .await
            .err()
            .unwrap()
            .to_string();
        assert!(denied.contains("Workspace is not granted"));
        assert_eq!(prepare_calls.load(std::sync::atomic::Ordering::Relaxed), 0);
        let hello = pairing_transport.hello().await.unwrap();
        assert!(hello.require(Capability::WorkspaceFiles).is_ok());
        assert_eq!(hello.host_id, "test-host");
        assert_eq!(hello.workspace_root, "");
        assert_eq!(hello.workspaces.len(), 0);
        assert!(hello.capabilities.iter().any(|value| value == "agent.acp"));
        assert!(
            !hello
                .capabilities
                .iter()
                .any(|value| value == ovule_remoting::model::CAPABILITY)
        );
        {
            let mut access = lock(&access);
            let device = access.devices.get_mut(&client_id).unwrap();
            device.workspace_ids.push(first_share_id.clone());
            device.agent_ids.push("ovule".to_owned());
            device.agent_ids.push("remote-only".to_owned());
            device.agent_ids.push("remote-acp".to_owned());
        }
        let hello = pairing_transport.hello().await.unwrap();
        assert_eq!(PathBuf::from(&hello.workspace_root), directory.path());
        assert_eq!(hello.workspaces.len(), 1);
        assert_eq!(hello.agents[0].id, "ovule");
        let transport = TunnelTransport::new(TunnelClientConfig {
            endpoint_addr: host.addr(),
            share_id: first_share_id,
            client_secret: serde_json::to_string(&client_secret).unwrap(),
        });
        assert_eq!(transport.read_file("hello.txt").await.unwrap(), b"hello");
        assert_eq!(
            transport.computer_use_mcp_endpoint().await.unwrap(),
            ComputerUseMcpEndpoint {
                url: "http://127.0.0.1:43124/mcp".to_owned(),
                bearer_token: "host-secret".to_owned(),
            }
        );
        transport
            .write_file("nested/world.txt", b"world")
            .await
            .unwrap();
        assert_eq!(
            std::fs::read(directory.path().join("nested/world.txt")).unwrap(),
            b"world"
        );
        let denied = transport
            .spawn(&["codex-acp".to_owned()], &BTreeMap::new())
            .await;
        assert!(
            matches!(denied, Err(TransportError::Protocol(ref error)) if error.contains("Agent codex is not granted"))
        );
        let argv = if cfg!(windows) {
            vec![
                "powershell.exe".to_owned(),
                "-NoProfile".to_owned(),
                "-Command".to_owned(),
                "$line=[Console]::In.ReadLine(); [Console]::Out.Write($env:OVULE_LINK_TEST + ':' + $line); [Console]::Error.Write('link-stderr')".to_owned(),
            ]
        } else {
            vec![
                "sh".to_owned(),
                "-c".to_owned(),
                "read line; printf '%s:%s' \"$OVULE_LINK_TEST\" \"$line\"; printf link-stderr >&2"
                    .to_owned(),
            ]
        };
        let mut process = transport
            .spawn(
                &argv,
                &BTreeMap::from([("OVULE_LINK_TEST".to_owned(), "link-env".to_owned())]),
            )
            .await
            .unwrap();
        process.stdin.write_all(b"link-stdin\n").await.unwrap();
        process.stdin.shutdown().await.unwrap();
        let mut stdout = String::new();
        let mut stderr = String::new();
        process.stdout.read_to_string(&mut stdout).await.unwrap();
        process.stderr.read_to_string(&mut stderr).await.unwrap();
        assert_eq!(stdout, "link-env:link-stdin");
        assert_eq!(stderr, "link-stderr");
        assert_eq!(process.wait().await, Some(0));
        let shell_command = if cfg!(windows) {
            "[Console]::Out.Write('first'); Start-Sleep -Milliseconds 50; [Console]::Out.Write('second'); exit 7"
        } else {
            "printf first; sleep 0.05; printf second; exit 7"
        };
        let mut shell = transport.spawn_shell(shell_command).await.unwrap();
        shell.stdin.shutdown().await.unwrap();
        let mut first = [0_u8; 5];
        shell.stdout.read_exact(&mut first).await.unwrap();
        assert_eq!(&first, b"first");
        let mut remainder = String::new();
        shell.stdout.read_to_string(&mut remainder).await.unwrap();
        assert_eq!(remainder, "second");
        assert_eq!(shell.wait().await, Some(7));
        let mut agent = transport
            .spawn_agent("remote-only", None, Some("remote-model"))
            .await
            .unwrap();
        agent.stdin.write_all(b"prompt\n").await.unwrap();
        agent.stdin.shutdown().await.unwrap();
        let mut agent_output = String::new();
        agent
            .stdout
            .read_to_string(&mut agent_output)
            .await
            .unwrap();
        assert_eq!(agent_output, "remote-agent:prompt");
        let mut acp = transport
            .spawn_agent("remote-acp", None, Some("remote-model"))
            .await
            .unwrap();
        let acp_stdin = std::mem::replace(&mut acp.stdin, Box::pin(tokio::io::sink()));
        let acp_stdout = std::mem::replace(&mut acp.stdout, Box::pin(tokio::io::empty()));
        Client
            .builder()
            .connect_with(
                agent_client_protocol::ByteStreams::new(
                    acp_stdin.compat_write(),
                    acp_stdout.compat(),
                ),
                async |connection| {
                    connection
                        .send_request(
                            InitializeRequest::new(ProtocolVersion::V1)
                                .client_info(Implementation::new("tunnel-test", "0.1.0")),
                        )
                        .block_task()
                        .await?;
                    let session = connection
                        .send_request(NewSessionRequest::new(directory.path().to_path_buf()))
                        .block_task()
                        .await?;
                    let response = connection
                        .send_request(PromptRequest::new(
                            session.session_id,
                            vec![ContentBlock::Text(TextContent::new("hello"))],
                        ))
                        .block_task()
                        .await?;
                    assert_eq!(response.stop_reason, StopReason::EndTurn);
                    Ok::<_, agent_client_protocol::Error>(())
                },
            )
            .await
            .unwrap();
        lock(&access).shares.insert(
            second_share_id.clone(),
            (second_directory.path().to_path_buf(), "second".to_owned()),
        );
        let second = TunnelTransport::new(TunnelClientConfig {
            endpoint_addr: host.addr(),
            share_id: second_share_id.clone(),
            client_secret: serde_json::to_string(&client_secret).unwrap(),
        });
        let error = second.probe().await.unwrap_err().to_string();
        assert!(error.contains("not granted"));
        lock(&access)
            .devices
            .get_mut(&client_id)
            .unwrap()
            .workspace_ids
            .push(second_share_id);
        second.probe().await.unwrap();
        assert_eq!(second.read_file("second.txt").await.unwrap(), b"second");
        assert_eq!(pairing_transport.hello().await.unwrap().workspaces.len(), 2);
        lock(&access).devices.remove(&client_id);
        let error = pairing_transport.hello().await.unwrap_err().to_string();
        assert!(error.contains("waiting for Host approval"));
        let replacement_code = lock(&access)
            .pending_clients
            .get(&client_id)
            .unwrap()
            .code
            .clone();
        pairing_transport
            .submit_pairing_code(&replacement_code)
            .await
            .unwrap();
        assert!(
            pairing_transport
                .hello()
                .await
                .unwrap()
                .require(Capability::WorkspaceFiles)
                .is_ok()
        );
        host.close().await;
        server.abort();
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn unrelated_alpn_is_not_treated_as_link() {
        let host = Endpoint::builder(presets::N0)
            .alpns(vec![b"unrelated/application".to_vec()])
            .relay_mode(RelayMode::Disabled)
            .bind()
            .await
            .unwrap();
        let server = tokio::spawn({
            let host = host.clone();
            async move {
                if let Some(incoming) = host.accept().await {
                    let _ = incoming.await;
                }
            }
        });
        let transport = TunnelTransport::new(TunnelClientConfig {
            endpoint_addr: host.addr(),
            share_id: String::new(),
            client_secret: serde_json::to_string(&SecretKey::generate()).unwrap(),
        });
        assert!(
            transport
                .hello()
                .await
                .unwrap_err()
                .to_string()
                .contains("connect Ovule Link Host")
        );
        host.close().await;
        server.abort();
    }
}
