//! Persisted Host inventory -> authenticated desktop transport adapter.
use crate::WorkspaceSession;
use crate::state::WorkspaceKind;
use ovule_hosts::TunnelClientConfig;
use ovule_remoting::backend::{ControlTransport, HostDirectory};
use ovule_secrets::SecretStore;
use sha2::{Digest as _, Sha256};
use std::collections::HashMap;
use std::sync::{Arc, Mutex, Weak};

pub(crate) struct DesktopHostDirectory {
    state: Arc<WorkspaceSession>,
    secrets: Arc<dyn SecretStore>,
    connections: Mutex<HashMap<[u8; 32], Weak<dyn ControlTransport>>>,
}
impl DesktopHostDirectory {
    pub(crate) fn new(state: Arc<WorkspaceSession>, secrets: Arc<dyn SecretStore>) -> Self {
        Self {
            state,
            secrets,
            connections: Mutex::new(HashMap::new()),
        }
    }
}
impl HostDirectory for DesktopHostDirectory {
    fn connect(&self, endpoint_id: &str) -> Result<Arc<dyn ControlTransport>, String> {
        let endpoint = self
            .state
            .read(|workspace| workspace.remote_endpoint(endpoint_id))
            .ok_or("remote Host does not exist")?;
        if endpoint.transport != WorkspaceKind::Tunnel {
            return Err("desktop control requires a Link Host".into());
        }
        let endpoint_addr =
            serde_json::from_str(endpoint.host.as_deref().ok_or("Host address missing")?)
                .map_err(|e| format!("invalid Host address: {e}"))?;
        let client_secret = self
            .secrets
            .load_workspace_credential(
                endpoint
                    .credential_ref
                    .as_deref()
                    .ok_or("Host identity missing")?,
            )?
            .ok_or("Host identity unavailable")?;
        // Resolve credentials only on session creation. Hash the actual identity so
        // rotation under the same credential reference cannot reuse an old connection.
        let mut digest = Sha256::new();
        digest.update(endpoint.host.as_deref().unwrap_or_default().as_bytes());
        digest.update([0]);
        digest.update(client_secret.as_bytes());
        let key: [u8; 32] = digest.finalize().into();
        let mut connections = self
            .connections
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        connections.retain(|_, connection| connection.strong_count() > 0);
        if let Some(connection) = connections.get(&key).and_then(Weak::upgrade) {
            return Ok(connection);
        }
        let transport: Arc<dyn ControlTransport> =
            ovule_hosts::providers::tunnel(TunnelClientConfig {
                endpoint_addr,
                share_id: String::new(),
                client_secret,
            });
        connections.insert(key, Arc::downgrade(&transport));
        Ok(transport)
    }
}
