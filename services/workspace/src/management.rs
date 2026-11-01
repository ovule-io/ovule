use std::path::PathBuf;
use std::sync::Arc;

use crate::state::{AppSnapshot, BrowserSuggestion, WorkspaceKind};
use ovule_secrets::SecretStore;

use crate::{MutationError, WorkspaceSession};
use ovule_hosts::{EntryKind, SshAuth, SshEndpointConfig, TunnelHostHandle};
use ovule_platform::resources::ensure_default_workspace_path;

use crate::{WorkspaceEventSink, WorkspaceManagement};

#[derive(Debug)]
pub enum WorkspaceServiceError {
    InvalidArgument(String),
    Persistence(String),
}

pub struct TunnelEndpointTest {
    pub detail: String,
    pub root: String,
    pub agent_ids: Vec<String>,
    pub workspaces: Vec<ovule_hosts::HostWorkspaceDescriptor>,
    pub capabilities: Vec<String>,
}

impl From<MutationError> for WorkspaceServiceError {
    fn from(error: MutationError) -> Self {
        match error {
            MutationError::Domain(message) => Self::InvalidArgument(message),
            MutationError::Repository(message) => Self::Persistence(message),
        }
    }
}

pub(crate) struct WorkspaceCommands {
    state: Arc<WorkspaceSession>,
    events: Arc<dyn WorkspaceEventSink>,
    data_root: PathBuf,
    secrets: Arc<dyn SecretStore>,
    tunnel_host: Arc<TunnelHostHandle>,
}

impl WorkspaceCommands {
    pub fn share_host_link(&self) -> Result<ovule_hosts::TunnelShareStatus, WorkspaceServiceError> {
        let host = self.tunnel_host.as_ref();
        host.ensure_started()
            .map_err(WorkspaceServiceError::Persistence)?;
        host.pairing_status()
            .map_err(WorkspaceServiceError::InvalidArgument)
    }

    pub fn regenerate_host_link(
        &self,
    ) -> Result<ovule_hosts::TunnelShareStatus, WorkspaceServiceError> {
        let host = self.tunnel_host.as_ref();
        host.ensure_started()
            .map_err(WorkspaceServiceError::Persistence)?;
        host.regenerate_pairing_status()
            .map_err(WorkspaceServiceError::InvalidArgument)
    }

    pub fn workspace_link_client_id(&self) -> Result<String, WorkspaceServiceError> {
        let encoded = self
            .secrets
            .load_or_create_workspace_identity("link-client")
            .map_err(WorkspaceServiceError::Persistence)?;
        let secret: iroh::SecretKey = serde_json::from_str(&encoded).map_err(|error| {
            WorkspaceServiceError::Persistence(format!("decode Link identity: {error}"))
        })?;
        Ok(secret.public().to_string())
    }

    pub fn share_workspace_link(
        &self,
        root: &str,
        alias: &str,
    ) -> Result<ovule_hosts::TunnelShareStatus, WorkspaceServiceError> {
        let host = self.tunnel_host.as_ref();
        host.ensure_started()
            .map_err(WorkspaceServiceError::Persistence)?;
        host.share(std::path::Path::new(root), alias)
            .map_err(WorkspaceServiceError::InvalidArgument)
    }

    pub fn set_workspace_link_access(
        &self,
        client_id: &str,
        workspace_ids: Vec<String>,
        agent_ids: Vec<String>,
    ) -> Result<(), WorkspaceServiceError> {
        self.tunnel_host
            .set_device_access(client_id, workspace_ids, agent_ids)
            .map_err(WorkspaceServiceError::InvalidArgument)
    }

    pub fn submit_workspace_link_pairing(
        &self,
        endpoint_addr_json: &str,
        share_id: &str,
        code: &str,
    ) -> Result<String, WorkspaceServiceError> {
        let client_secret = self
            .secrets
            .load_or_create_workspace_identity("link-client")
            .map_err(WorkspaceServiceError::Persistence)?;
        let endpoint_addr = serde_json::from_str(endpoint_addr_json).map_err(|error| {
            WorkspaceServiceError::InvalidArgument(format!(
                "invalid Link endpoint address: {error}"
            ))
        })?;
        let transport = ovule_hosts::providers::tunnel(ovule_hosts::TunnelClientConfig {
            endpoint_addr,
            share_id: share_id.to_owned(),
            client_secret,
        });
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .map_err(|error| {
                WorkspaceServiceError::Persistence(format!("create Link runtime: {error}"))
            })?;
        runtime
            .block_on(transport.submit_pairing_code(code))
            .map(|()| "Pairing approved by the Host.".to_owned())
            .map_err(|error| WorkspaceServiceError::InvalidArgument(error.to_string()))
    }

    pub fn share_current_workspace_link(
        &self,
        thread_id: &str,
    ) -> Result<ovule_hosts::TunnelShareStatus, WorkspaceServiceError> {
        let root = self
            .state
            .read(|workspace| {
                workspace
                    .snapshot()
                    .threads
                    .into_iter()
                    .find(|thread| thread.id == thread_id)
                    .map(|thread| thread.workspace_path)
            })
            .ok_or_else(|| {
                WorkspaceServiceError::InvalidArgument(format!("unknown Thread: {thread_id}"))
            })?;
        let canonical = std::fs::canonicalize(&root).map_err(|error| {
            WorkspaceServiceError::InvalidArgument(format!(
                "resolve current Workspace {root}: {error}"
            ))
        })?;
        let alias = canonical
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("workspace");
        self.share_workspace_link(&canonical.to_string_lossy(), alias)
    }

    pub fn revoke_workspace_link(
        &self,
        _share_id: &str,
        client_id: &str,
    ) -> Result<(), WorkspaceServiceError> {
        self.tunnel_host
            .revoke(client_id)
            .map_err(WorkspaceServiceError::InvalidArgument)
    }

    pub fn test_tunnel_endpoint(
        &self,
        endpoint_addr_json: &str,
        share_id: String,
    ) -> Result<TunnelEndpointTest, WorkspaceServiceError> {
        let id = "link-client";
        let client_secret = self
            .secrets
            .load_or_create_workspace_identity(id)
            .map_err(WorkspaceServiceError::Persistence)?;
        let endpoint_addr = serde_json::from_str(endpoint_addr_json).map_err(|error| {
            WorkspaceServiceError::InvalidArgument(format!(
                "invalid Link endpoint address: {error}"
            ))
        })?;
        let transport = ovule_hosts::providers::tunnel(ovule_hosts::TunnelClientConfig {
            endpoint_addr,
            share_id,
            client_secret,
        });
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .map_err(|error| {
                WorkspaceServiceError::Persistence(format!("create Link runtime: {error}"))
            })?;
        runtime
            .block_on(transport.hello())
            .map(|hello| TunnelEndpointTest {
                detail: "Connected securely with Ovule Link.".to_owned(),
                root: hello.workspace_root,
                agent_ids: hello
                    .agents
                    .into_iter()
                    .filter(|agent| agent.available)
                    .map(|agent| agent.id)
                    .collect(),
                workspaces: hello.workspaces,
                capabilities: hello.capabilities,
            })
            .map_err(|error| WorkspaceServiceError::InvalidArgument(error.to_string()))
    }
    #[allow(clippy::unused_self)]
    #[must_use]
    pub fn discover_ssh_host(&self) -> SshHostDiscovery {
        discover_ssh_host()
    }
    pub fn new(
        state: Arc<WorkspaceSession>,
        events: Arc<dyn WorkspaceEventSink>,
        data_root: PathBuf,
        secrets: Arc<dyn SecretStore>,
        tunnel_host: Arc<TunnelHostHandle>,
    ) -> Self {
        Self {
            state,
            events,
            data_root,
            secrets,
            tunnel_host,
        }
    }

    pub fn snapshot(&self) -> AppSnapshot {
        self.state.read(crate::state::Workspace::snapshot)
    }

    pub fn prepare_shutdown(&self) -> Result<(), WorkspaceServiceError> {
        self.state.prepare_shutdown().map_err(Into::into)
    }

    pub fn create_thread(
        &self,
        title: &str,
        workspace_path: Option<&str>,
    ) -> Result<AppSnapshot, WorkspaceServiceError> {
        let workspace_path = workspace_path
            .filter(|path| !path.trim().is_empty())
            .map(str::to_owned)
            .map_or_else(
                || ensure_default_workspace_path(&self.data_root),
                Result::Ok,
            )
            .map_err(WorkspaceServiceError::Persistence)?;
        self.change(
            "thread/created",
            None,
            &serde_json::json!({"workspace_path": workspace_path}),
            |workspace| workspace.create_thread(title, &workspace_path),
        )
    }

    pub fn browser_suggestions(
        &self,
        thread_id: Option<&str>,
        query: &str,
    ) -> Result<Vec<BrowserSuggestion>, WorkspaceServiceError> {
        self.state
            .read(|workspace| workspace.browser_suggestions(thread_id, query))
            .map_err(WorkspaceServiceError::InvalidArgument)
    }

    pub fn set_thread_workspace(
        &self,
        thread_id: &str,
        workspace_path: &str,
    ) -> Result<AppSnapshot, WorkspaceServiceError> {
        self.change(
            "thread/workspace-bound",
            Some(thread_id),
            &serde_json::json!({"workspace_path": workspace_path}),
            |workspace| workspace.set_thread_workspace(thread_id, workspace_path),
        )
    }

    pub fn create_project(&self, name: &str) -> Result<AppSnapshot, WorkspaceServiceError> {
        self.change(
            "project/created",
            None,
            &serde_json::json!({"name": name}),
            |workspace| workspace.create_project(name),
        )
    }

    pub fn rename_project(
        &self,
        project_id: &str,
        name: &str,
    ) -> Result<AppSnapshot, WorkspaceServiceError> {
        self.change(
            "project/renamed",
            Some(project_id),
            &serde_json::json!({"name": name}),
            |workspace| workspace.rename_project(project_id, name),
        )
    }

    pub fn move_thread_to_project(
        &self,
        thread_id: &str,
        project_id: &str,
    ) -> Result<AppSnapshot, WorkspaceServiceError> {
        self.change(
            "thread/project-changed",
            Some(thread_id),
            &serde_json::json!({"project_id": project_id}),
            |workspace| workspace.move_thread_to_project(thread_id, project_id),
        )
    }

    pub fn bind_workspace(
        &self,
        thread_id: &str,
        kind: &str,
        endpoint_id: Option<&str>,
        resource_id: Option<&str>,
        root: &str,
        alias: &str,
    ) -> Result<AppSnapshot, WorkspaceServiceError> {
        let kind = parse_workspace_kind(kind)?;
        self.change(
            "workspace/bound",
            Some(thread_id),
            &serde_json::json!({
                "kind": kind.as_str(),
                "endpoint_id": endpoint_id,
                "resource_id": resource_id,
                "root": root,
                "alias": alias,
            }),
            |workspace| {
                workspace.bind_workspace_resource(
                    thread_id,
                    kind,
                    endpoint_id,
                    resource_id,
                    root,
                    alias,
                )
            },
        )
    }

    pub fn unbind_workspace(&self, binding_id: &str) -> Result<AppSnapshot, WorkspaceServiceError> {
        self.change(
            "workspace/unbound",
            Some(binding_id),
            &serde_json::json!({}),
            |workspace| workspace.unbind_workspace(binding_id),
        )
    }

    pub fn unbind_remote_host(
        &self,
        thread_id: &str,
        endpoint_id: &str,
    ) -> Result<AppSnapshot, WorkspaceServiceError> {
        self.change(
            "host/unbound",
            Some(endpoint_id),
            &serde_json::json!({"thread_id": thread_id}),
            |workspace| workspace.unbind_remote_host(thread_id, endpoint_id),
        )
    }

    pub fn remove_remote_host(
        &self,
        endpoint_id: &str,
    ) -> Result<AppSnapshot, WorkspaceServiceError> {
        self.change(
            "host/removed",
            Some(endpoint_id),
            &serde_json::json!({}),
            |workspace| workspace.remove_remote_host(endpoint_id),
        )
    }

    pub fn reset_link_hosts(&self) -> Result<AppSnapshot, WorkspaceServiceError> {
        let host = self.tunnel_host.as_ref();
        host.ensure_started()
            .map_err(WorkspaceServiceError::Persistence)?;
        host.reset_access()
            .map_err(WorkspaceServiceError::Persistence)?;
        self.change(
            "host/link-data-reset",
            None,
            &serde_json::json!({}),
            |workspace| Ok(workspace.reset_link_hosts()),
        )
    }

    pub fn repair_local_host_access(
        &self,
    ) -> Result<ovule_hosts::TunnelShareStatus, WorkspaceServiceError> {
        let host = self.tunnel_host.as_ref();
        host.ensure_started()
            .map_err(WorkspaceServiceError::Persistence)?;
        let handle = host;
        handle
            .repair_access()
            .map_err(WorkspaceServiceError::Persistence)?;
        handle
            .pairing_status()
            .map_err(WorkspaceServiceError::Persistence)
    }

    pub fn reset_local_host_link_identity(
        &self,
    ) -> Result<ovule_hosts::TunnelShareStatus, WorkspaceServiceError> {
        let host = self.tunnel_host.as_ref();
        host.reset_identity()
            .map_err(WorkspaceServiceError::Persistence)?;
        host.pairing_status()
            .map_err(WorkspaceServiceError::Persistence)
    }

    pub fn set_thread_workspace_bindings(
        &self,
        thread_id: &str,
        binding_ids: &[String],
    ) -> Result<AppSnapshot, WorkspaceServiceError> {
        self.change(
            "workspace/selection-changed",
            Some(thread_id),
            &serde_json::json!({"binding_ids": binding_ids}),
            |workspace| workspace.set_thread_workspace_bindings(thread_id, binding_ids),
        )
    }

    pub fn configure_host_spice(
        &self,
        endpoint_id: &str,
        websocket_url: Option<String>,
    ) -> Result<AppSnapshot, WorkspaceServiceError> {
        self.change(
            "endpoint/spice-configured",
            None,
            &serde_json::json!({
                "endpoint_id": endpoint_id,
                "enabled": websocket_url.is_some(),
            }),
            |workspace| workspace.configure_host_spice(endpoint_id, websocket_url),
        )
    }

    #[allow(
        clippy::too_many_arguments,
        clippy::needless_pass_by_value,
        clippy::unused_self
    )]
    pub fn register_endpoint(
        &self,
        display_name: &str,
        transport: &str,
        host: Option<String>,
        port: Option<u16>,
        user: Option<String>,
        auth_kind: Option<String>,
        secret: Option<String>,
        host_fingerprint: Option<String>,
        agent_ids: Vec<String>,
        workspaces: Vec<crate::state::RemoteWorkspaceResource>,
    ) -> Result<(String, AppSnapshot), WorkspaceServiceError> {
        let transport = parse_workspace_kind(transport)?;
        let remote_id = if matches!(transport, WorkspaceKind::Tunnel) {
            let address: iroh::EndpointAddr =
                serde_json::from_str(host.as_deref().ok_or_else(|| {
                    WorkspaceServiceError::InvalidArgument(
                        "Link endpoint address is required".to_owned(),
                    )
                })?)
                .map_err(|error| {
                    WorkspaceServiceError::InvalidArgument(format!(
                        "invalid Link endpoint address: {error}"
                    ))
                })?;
            Some(address.id.to_string())
        } else {
            None
        };
        let credential_ref = if matches!(transport, WorkspaceKind::Ssh) {
            let secret = secret.filter(|value| !value.is_empty()).ok_or_else(|| {
                WorkspaceServiceError::InvalidArgument("SSH credential is required".to_owned())
            })?;
            let id = format!(
                "endpoint-{}",
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map_err(|error| WorkspaceServiceError::Persistence(error.to_string()))?
                    .as_millis()
            );
            Some(
                self.secrets
                    .save_workspace_credential(&id, &secret)
                    .map_err(WorkspaceServiceError::Persistence)?,
            )
        } else if matches!(transport, WorkspaceKind::Tunnel) {
            let id = "link-client";
            let identity = self
                .secrets
                .load_or_create_workspace_identity(id)
                .map_err(WorkspaceServiceError::Persistence)?;
            let _ = identity;
            Some(format!("workspace:{id}"))
        } else {
            None
        };
        let mut endpoint_id_slot: Option<String> = None;
        let snapshot = self.change(
            "endpoint/registered",
            None,
            &serde_json::json!({
                "display_name": display_name,
                "transport": transport.as_str(),
                "host": host.as_deref(),
                "port": port,
                "user": user.as_deref(),
                "auth_kind": auth_kind.as_deref(),
                "host_fingerprint": host_fingerprint.as_deref(),
            }),
            |workspace| {
                let (id, snapshot) = workspace.register_endpoint_inventory(
                    display_name,
                    transport,
                    credential_ref.clone(),
                    host.clone(),
                    remote_id.clone(),
                    port,
                    user.clone(),
                    auth_kind.clone(),
                    host_fingerprint.clone(),
                    agent_ids.clone(),
                    workspaces.clone(),
                )?;
                endpoint_id_slot = Some(id);
                Ok(snapshot)
            },
        )?;
        let endpoint_id = endpoint_id_slot.ok_or_else(|| {
            WorkspaceServiceError::Persistence("endpoint id was not captured".to_owned())
        })?;
        Ok((endpoint_id, snapshot))
    }

    #[allow(
        clippy::too_many_arguments,
        clippy::needless_pass_by_value,
        clippy::unused_self
    )]
    pub fn test_ssh_endpoint(
        &self,
        host: String,
        port: u16,
        user: String,
        auth_kind: String,
        secret: String,
        host_fingerprint: String,
        root: String,
    ) -> Result<String, WorkspaceServiceError> {
        let loopback = matches!(host.as_str(), "127.0.0.1" | "localhost" | "::1");
        let auth = match auth_kind.as_str() {
            "password" => SshAuth::Password { secret },
            "private_key" => SshAuth::PrivateKey {
                pem: secret,
                passphrase: None,
            },
            _ => {
                return Err(WorkspaceServiceError::InvalidArgument(
                    "unsupported SSH auth kind".to_owned(),
                ));
            }
        };
        let transport = ovule_hosts::providers::ssh(
            SshEndpointConfig {
                host,
                port,
                user,
                auth,
                trusted_host_fingerprints: vec![host_fingerprint],
                allow_trust_on_first_use: false,
            },
            root,
        )
        .map_err(|error| WorkspaceServiceError::InvalidArgument(error.to_string()))?;
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .map_err(|error| {
                WorkspaceServiceError::Persistence(format!("create SSH probe runtime: {error}"))
            })?;
        runtime
            .block_on(async {
                transport.probe().await?;
                let stat = transport.stat(".").await?;
                if stat.kind != EntryKind::Directory {
                    return Err(ovule_hosts::TransportError::InvalidPath(
                        "SSH workspace root is not a directory".to_owned(),
                    ));
                }
                Ok(format!(
                    "Connected; remote root {} is available",
                    stat.path.display()
                ))
            })
            .map_err(|error| {
                let message = error.to_string();
                let actionable = if cfg!(windows)
                    && loopback
                    && (message.contains("10061") || message.contains("actively refused"))
                {
                    "Local OpenSSH is installed but is not accepting connections. Start the Windows sshd service in an Administrator terminal (`Start-Service sshd`), then retry Discover this host or Test & connect.".to_owned()
                } else {
                    message
                };
                WorkspaceServiceError::InvalidArgument(actionable)
            })
    }

    fn change(
        &self,
        kind: &str,
        subject_id: Option<&str>,
        payload: &serde_json::Value,
        operation: impl FnOnce(&mut crate::state::Workspace) -> Result<AppSnapshot, String>,
    ) -> Result<AppSnapshot, WorkspaceServiceError> {
        let snapshot = self
            .state
            .transact(kind, subject_id, payload, operation)
            .map_err(WorkspaceServiceError::from)?;
        self.events.revision_changed(snapshot.revision);
        Ok(snapshot)
    }
}

pub struct SshHostDiscovery {
    pub ready: bool,
    pub host: String,
    pub port: u16,
    pub user: String,
    pub fingerprint: String,
    pub root: String,
    pub alias: String,
    pub detail: String,
}

#[cfg(windows)]
fn discover_ssh_host() -> SshHostDiscovery {
    use std::os::windows::process::CommandExt;
    let script = "set -eu; key=/etc/ssh/ssh_host_ed25519_key.pub; test -r $key; user=$(id -un); home=$(getent passwd $user | cut -d: -f6); printf '%s\n%s\n' \"$user\" \"$home\"; cat $key";
    let output = std::process::Command::new("wsl.exe")
        .args(["-e", "sh", "-lc", script])
        .creation_flags(0x0800_0000)
        .output();
    if let Ok(output) = output
        && output.status.success()
    {
        let text = String::from_utf8_lossy(&output.stdout);
        let mut lines = text.lines();
        let user = lines.next().unwrap_or_default().trim().to_owned();
        let root = lines.next().unwrap_or_default().trim().to_owned();
        let key = lines.collect::<Vec<_>>().join("\n");
        if let Ok(public_key) = russh::keys::ssh_key::PublicKey::from_openssh(&key) {
            let ready = loopback_ssh_ready();
            return SshHostDiscovery {
                ready,
                host: "127.0.0.1".to_owned(),
                port: 22,
                user,
                fingerprint: format!("{}", public_key.fingerprint(russh::keys::HashAlg::Sha256)),
                root,
                alias: "local-wsl".to_owned(),
                detail: if ready {
                    "WSL OpenSSH is ready."
                } else {
                    "WSL host key found; start sshd in WSL, then discover again."
                }
                .to_owned(),
            };
        }
    }
    let native_key = std::path::Path::new(r"C:\ProgramData\ssh\ssh_host_ed25519_key.pub");
    let fingerprint = russh::keys::load_public_key(native_key)
        .map(|key| format!("{}", key.fingerprint(russh::keys::HashAlg::Sha256)))
        .unwrap_or_default();
    let ready = !fingerprint.is_empty() && loopback_ssh_ready();
    SshHostDiscovery {
        ready,
        host: local_network_address().unwrap_or_else(|| "127.0.0.1".to_owned()),
        port: 22,
        user: std::env::var("USERNAME").unwrap_or_default(),
        fingerprint,
        root: std::env::var("USERPROFILE").unwrap_or_default(),
        alias: "this-computer".to_owned(),
        detail: if ready {
            "Windows OpenSSH is ready.".to_owned()
        } else if native_key.is_file() {
            "Windows OpenSSH host key was found; start the sshd service, then discover again."
                .to_owned()
        } else {
            "Windows OpenSSH Server is not installed or has no host key.".to_owned()
        },
    }
}

#[cfg(not(windows))]
fn discover_ssh_host() -> SshHostDiscovery {
    let fingerprint = russh::keys::load_public_key("/etc/ssh/ssh_host_ed25519_key.pub")
        .map(|key| format!("{}", key.fingerprint(russh::keys::HashAlg::Sha256)))
        .unwrap_or_default();
    let ready = !fingerprint.is_empty() && loopback_ssh_ready();
    SshHostDiscovery {
        ready,
        host: local_network_address().unwrap_or_else(|| "127.0.0.1".to_owned()),
        port: 22,
        user: std::env::var("USER").unwrap_or_default(),
        fingerprint,
        root: std::env::var("HOME").unwrap_or_default(),
        alias: "this-computer".to_owned(),
        detail: if ready {
            "Local OpenSSH is ready."
        } else {
            "OpenSSH host key or listening service was not found."
        }
        .to_owned(),
    }
}

fn loopback_ssh_ready() -> bool {
    std::net::TcpStream::connect_timeout(
        &std::net::SocketAddr::from(([127, 0, 0, 1], 22)),
        std::time::Duration::from_millis(300),
    )
    .is_ok()
}

fn local_network_address() -> Option<String> {
    let socket = std::net::UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("192.0.2.1:9").ok()?;
    Some(socket.local_addr().ok()?.ip().to_string())
}

fn parse_workspace_kind(value: &str) -> Result<WorkspaceKind, WorkspaceServiceError> {
    match value {
        "local" => Ok(WorkspaceKind::Local),
        "ssh" => Ok(WorkspaceKind::Ssh),
        "tunnel" => Ok(WorkspaceKind::Tunnel),
        other => Err(WorkspaceServiceError::InvalidArgument(format!(
            "unknown Workspace kind: {other}"
        ))),
    }
}

impl WorkspaceManagement for WorkspaceCommands {
    fn share_host_link(&self) -> Result<ovule_hosts::TunnelShareStatus, WorkspaceServiceError> {
        WorkspaceCommands::share_host_link(self)
    }
    fn regenerate_host_link(
        &self,
    ) -> Result<ovule_hosts::TunnelShareStatus, WorkspaceServiceError> {
        WorkspaceCommands::regenerate_host_link(self)
    }
    fn workspace_link_client_id(&self) -> Result<String, WorkspaceServiceError> {
        WorkspaceCommands::workspace_link_client_id(self)
    }
    fn share_workspace_link(
        &self,
        root: &str,
        alias: &str,
    ) -> Result<ovule_hosts::TunnelShareStatus, WorkspaceServiceError> {
        WorkspaceCommands::share_workspace_link(self, root, alias)
    }
    fn set_workspace_link_access(
        &self,
        client_id: &str,
        workspace_ids: Vec<String>,
        agent_ids: Vec<String>,
    ) -> Result<(), WorkspaceServiceError> {
        WorkspaceCommands::set_workspace_link_access(self, client_id, workspace_ids, agent_ids)
    }
    fn submit_workspace_link_pairing(
        &self,
        endpoint_addr_json: &str,
        share_id: &str,
        code: &str,
    ) -> Result<String, WorkspaceServiceError> {
        WorkspaceCommands::submit_workspace_link_pairing(self, endpoint_addr_json, share_id, code)
    }
    fn share_current_workspace_link(
        &self,
        thread_id: &str,
    ) -> Result<ovule_hosts::TunnelShareStatus, WorkspaceServiceError> {
        WorkspaceCommands::share_current_workspace_link(self, thread_id)
    }
    fn revoke_workspace_link(
        &self,
        share_id: &str,
        client_id: &str,
    ) -> Result<(), WorkspaceServiceError> {
        WorkspaceCommands::revoke_workspace_link(self, share_id, client_id)
    }
    fn test_tunnel_endpoint(
        &self,
        endpoint_addr_json: &str,
        share_id: String,
    ) -> Result<TunnelEndpointTest, WorkspaceServiceError> {
        WorkspaceCommands::test_tunnel_endpoint(self, endpoint_addr_json, share_id)
    }
    fn discover_ssh_host(&self) -> SshHostDiscovery {
        WorkspaceCommands::discover_ssh_host(self)
    }
    fn snapshot(&self) -> AppSnapshot {
        WorkspaceCommands::snapshot(self)
    }
    fn prepare_shutdown(&self) -> Result<(), WorkspaceServiceError> {
        WorkspaceCommands::prepare_shutdown(self)
    }
    fn create_thread(
        &self,
        title: &str,
        workspace_path: Option<&str>,
    ) -> Result<AppSnapshot, WorkspaceServiceError> {
        WorkspaceCommands::create_thread(self, title, workspace_path)
    }
    fn browser_suggestions(
        &self,
        thread_id: Option<&str>,
        query: &str,
    ) -> Result<Vec<BrowserSuggestion>, WorkspaceServiceError> {
        WorkspaceCommands::browser_suggestions(self, thread_id, query)
    }
    fn set_thread_workspace(
        &self,
        thread_id: &str,
        workspace_path: &str,
    ) -> Result<AppSnapshot, WorkspaceServiceError> {
        WorkspaceCommands::set_thread_workspace(self, thread_id, workspace_path)
    }
    fn create_project(&self, name: &str) -> Result<AppSnapshot, WorkspaceServiceError> {
        WorkspaceCommands::create_project(self, name)
    }
    fn rename_project(
        &self,
        project_id: &str,
        name: &str,
    ) -> Result<AppSnapshot, WorkspaceServiceError> {
        WorkspaceCommands::rename_project(self, project_id, name)
    }
    fn move_thread_to_project(
        &self,
        thread_id: &str,
        project_id: &str,
    ) -> Result<AppSnapshot, WorkspaceServiceError> {
        WorkspaceCommands::move_thread_to_project(self, thread_id, project_id)
    }
    fn bind_workspace(
        &self,
        thread_id: &str,
        kind: &str,
        endpoint_id: Option<&str>,
        resource_id: Option<&str>,
        root: &str,
        alias: &str,
    ) -> Result<AppSnapshot, WorkspaceServiceError> {
        WorkspaceCommands::bind_workspace(
            self,
            thread_id,
            kind,
            endpoint_id,
            resource_id,
            root,
            alias,
        )
    }
    fn unbind_workspace(&self, binding_id: &str) -> Result<AppSnapshot, WorkspaceServiceError> {
        WorkspaceCommands::unbind_workspace(self, binding_id)
    }
    fn unbind_remote_host(
        &self,
        thread_id: &str,
        endpoint_id: &str,
    ) -> Result<AppSnapshot, WorkspaceServiceError> {
        WorkspaceCommands::unbind_remote_host(self, thread_id, endpoint_id)
    }
    fn remove_remote_host(&self, endpoint_id: &str) -> Result<AppSnapshot, WorkspaceServiceError> {
        WorkspaceCommands::remove_remote_host(self, endpoint_id)
    }
    fn reset_link_hosts(&self) -> Result<AppSnapshot, WorkspaceServiceError> {
        WorkspaceCommands::reset_link_hosts(self)
    }
    fn repair_local_host_access(
        &self,
    ) -> Result<ovule_hosts::TunnelShareStatus, WorkspaceServiceError> {
        WorkspaceCommands::repair_local_host_access(self)
    }
    fn reset_local_host_link_identity(
        &self,
    ) -> Result<ovule_hosts::TunnelShareStatus, WorkspaceServiceError> {
        WorkspaceCommands::reset_local_host_link_identity(self)
    }
    fn set_thread_workspace_bindings(
        &self,
        thread_id: &str,
        binding_ids: &[String],
    ) -> Result<AppSnapshot, WorkspaceServiceError> {
        WorkspaceCommands::set_thread_workspace_bindings(self, thread_id, binding_ids)
    }
    fn configure_host_spice(
        &self,
        endpoint_id: &str,
        websocket_url: Option<String>,
    ) -> Result<AppSnapshot, WorkspaceServiceError> {
        WorkspaceCommands::configure_host_spice(self, endpoint_id, websocket_url)
    }
    fn register_endpoint(
        &self,
        display_name: &str,
        transport: &str,
        host: Option<String>,
        port: Option<u16>,
        user: Option<String>,
        auth_kind: Option<String>,
        secret: Option<String>,
        host_fingerprint: Option<String>,
        agent_ids: Vec<String>,
        workspaces: Vec<crate::state::RemoteWorkspaceResource>,
    ) -> Result<(String, AppSnapshot), WorkspaceServiceError> {
        WorkspaceCommands::register_endpoint(
            self,
            display_name,
            transport,
            host,
            port,
            user,
            auth_kind,
            secret,
            host_fingerprint,
            agent_ids,
            workspaces,
        )
    }
    fn test_ssh_endpoint(
        &self,
        host: String,
        port: u16,
        user: String,
        auth_kind: String,
        secret: String,
        host_fingerprint: String,
        root: String,
    ) -> Result<String, WorkspaceServiceError> {
        WorkspaceCommands::test_ssh_endpoint(
            self,
            host,
            port,
            user,
            auth_kind,
            secret,
            host_fingerprint,
            root,
        )
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use tempfile::tempdir;

    use super::*;
    use crate::WorkspaceSession;

    #[derive(Default)]
    struct RecordingEvents {
        revisions: Mutex<Vec<i64>>,
    }

    impl WorkspaceEventSink for RecordingEvents {
        fn revision_changed(&self, revision: i64) {
            self.revisions.lock().unwrap().push(revision);
        }
    }

    #[test]
    fn thread_change_commits_and_publishes_the_committed_revision() {
        let directory = tempdir().unwrap();
        let database = directory.path().join("workspace.sqlite3");
        let state = Arc::new(WorkspaceSession::new(
            {
                let mut workspace = crate::state::Workspace::default();
                workspace.attach_paths(crate::providers::native_paths());
                workspace
            },
            crate::providers::open(&database).unwrap(),
        ));
        let events = Arc::new(RecordingEvents::default());
        let secrets: Arc<dyn SecretStore> =
            Arc::new(ovule_secrets::providers::open(directory.path()).unwrap());
        let owner = Arc::new(std::sync::Mutex::new(ovule_hosts::providers::host(
            Arc::clone(&secrets),
        )));
        let tunnel_host = Arc::new(owner.lock().unwrap().handle().with_owner(&owner));
        let service = WorkspaceCommands::new(
            state,
            Arc::clone(&events) as Arc<dyn WorkspaceEventSink>,
            directory.path().to_path_buf(),
            secrets,
            tunnel_host,
        );

        let snapshot = service
            .create_thread("New thread", Some(directory.path().to_str().unwrap()))
            .unwrap();

        assert_eq!(*events.revisions.lock().unwrap(), [snapshot.revision]);
        assert_eq!(service.snapshot().threads.len(), 1);
    }
}
