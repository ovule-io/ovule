use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::Mutex;

use crate::BindingResolver;
use crate::TransportKind;
use ovule_secrets::SecretStore;

use super::{
    LocalTransport, SshAuth, SshEndpointConfig, SshTransport, TransportError, TunnelClientConfig,
    TunnelTransport, WorkspaceTransport,
};

/// Resolves a persisted Workspace binding into the execution-plane adapter.
/// Secrets stay in `SecretStore`; snapshots contain only opaque references.
pub struct WorkspaceTransportRouter {
    state: Arc<dyn BindingResolver>,
    secrets: Arc<dyn SecretStore>,
    tunnels: Mutex<HashMap<String, TunnelCacheEntry>>,
}

struct TunnelCacheEntry {
    signature: String,
    transport: Arc<dyn WorkspaceTransport>,
}

impl WorkspaceTransportRouter {
    pub fn new(state: Arc<dyn BindingResolver>, secrets: Arc<dyn SecretStore>) -> Self {
        Self {
            state,
            secrets,
            tunnels: Mutex::new(HashMap::new()),
        }
    }

    #[allow(clippy::too_many_lines)]
    pub fn resolve(
        &self,
        binding_id: Option<&str>,
        fallback_root: &str,
    ) -> Result<Arc<dyn WorkspaceTransport>, TransportError> {
        let valid_tunnel_bindings = self.state.tunnel_binding_ids();
        self.tunnels
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .retain(|id, _| valid_tunnel_bindings.contains(id));
        let Some(binding_id) = binding_id else {
            return LocalTransport::new(PathBuf::from(fallback_root))
                .map(|transport| Arc::new(transport) as Arc<dyn WorkspaceTransport>);
        };
        let binding = self
            .state
            .binding(binding_id)
            .ok_or_else(|| TransportError::NotFound(format!("Workspace binding {binding_id}")))?;
        match binding.kind {
            TransportKind::Local => LocalTransport::new(PathBuf::from(&binding.root))
                .map(|transport| Arc::new(transport) as Arc<dyn WorkspaceTransport>),
            TransportKind::Ssh => {
                let endpoint_id = binding.endpoint_id.as_deref().ok_or_else(|| {
                    TransportError::Protocol("SSH binding has no endpoint".to_owned())
                })?;
                let endpoint = self
                    .state
                    .endpoint(endpoint_id)
                    .ok_or_else(|| TransportError::NotFound(format!("Endpoint {endpoint_id}")))?;
                let reference = endpoint.credential_ref.as_deref().ok_or_else(|| {
                    TransportError::Unauthorized("SSH endpoint has no credential".to_owned())
                })?;
                let secret = self
                    .secrets
                    .load_workspace_credential(reference)
                    .map_err(TransportError::Unauthorized)?
                    .ok_or_else(|| {
                        TransportError::Unauthorized("SSH credential is unavailable".to_owned())
                    })?;
                let auth = match endpoint.auth_kind.as_deref() {
                    Some("private_key") => SshAuth::PrivateKey {
                        pem: secret,
                        passphrase: None,
                    },
                    Some("password") => SshAuth::Password { secret },
                    _ => {
                        return Err(TransportError::Protocol(
                            "unsupported SSH auth kind".to_owned(),
                        ));
                    }
                };
                let fingerprint = endpoint.host_fingerprint.into_iter().collect();
                SshTransport::new(
                    SshEndpointConfig {
                        host: endpoint.host.ok_or_else(|| {
                            TransportError::Protocol("SSH endpoint host is missing".to_owned())
                        })?,
                        port: endpoint.port.unwrap_or(22),
                        user: endpoint.user.ok_or_else(|| {
                            TransportError::Protocol("SSH endpoint user is missing".to_owned())
                        })?,
                        auth,
                        trusted_host_fingerprints: fingerprint,
                        allow_trust_on_first_use: false,
                    },
                    binding.root,
                )
                .map(|transport| Arc::new(transport) as Arc<dyn WorkspaceTransport>)
            }
            TransportKind::Tunnel => {
                let endpoint_id = binding.endpoint_id.as_deref().ok_or_else(|| {
                    TransportError::Protocol("Link binding has no endpoint".to_owned())
                })?;
                let endpoint = self
                    .state
                    .endpoint(endpoint_id)
                    .ok_or_else(|| TransportError::NotFound(format!("Endpoint {endpoint_id}")))?;
                let endpoint_addr =
                    serde_json::from_str(endpoint.host.as_deref().ok_or_else(|| {
                        TransportError::Protocol("Link endpoint address is missing".to_owned())
                    })?)
                    .map_err(|error| {
                        TransportError::Protocol(format!("invalid Link endpoint address: {error}"))
                    })?;
                let share_id = binding.resource_id.clone().ok_or_else(|| {
                    TransportError::Protocol("Link binding has no Host resource ID".to_owned())
                })?;
                let reference = endpoint.credential_ref.as_deref().ok_or_else(|| {
                    TransportError::Unauthorized("Link device identity is missing".to_owned())
                })?;
                let signature = format!(
                    "{}\0{}\0{}",
                    endpoint.host.as_deref().unwrap_or_default(),
                    share_id,
                    reference
                );
                if let Some(transport) = self
                    .tunnels
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner)
                    .get(binding_id)
                    .filter(|entry| entry.signature == signature)
                    .map(|entry| Arc::clone(&entry.transport))
                {
                    return Ok(transport);
                }
                let client_secret = self
                    .secrets
                    .load_workspace_credential(reference)
                    .map_err(TransportError::Unauthorized)?
                    .ok_or_else(|| {
                        TransportError::Unauthorized(
                            "Link device identity is unavailable".to_owned(),
                        )
                    })?;
                let transport = Arc::new(TunnelTransport::new(TunnelClientConfig {
                    endpoint_addr,
                    share_id,
                    client_secret,
                })) as Arc<dyn WorkspaceTransport>;
                self.tunnels
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner)
                    .insert(
                        binding_id.to_owned(),
                        TunnelCacheEntry {
                            signature,
                            transport: Arc::clone(&transport),
                        },
                    );
                Ok(transport)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{TransportBinding, TransportEndpoint};

    struct Bindings(Mutex<Option<PathBuf>>);
    impl BindingResolver for Bindings {
        fn binding(&self, id: &str) -> Option<TransportBinding> {
            if id != "bound" {
                return None;
            }
            self.0
                .lock()
                .unwrap()
                .as_ref()
                .map(|root| TransportBinding {
                    kind: TransportKind::Local,
                    root: root.to_string_lossy().into_owned(),
                    endpoint_id: None,
                    resource_id: None,
                })
        }
        fn endpoint(&self, _: &str) -> Option<TransportEndpoint> {
            None
        }
        fn tunnel_binding_ids(&self) -> Vec<String> {
            Vec::new()
        }
    }

    #[tokio::test]
    async fn resolver_reads_current_bindings_and_rejects_removed_bindings() {
        let first = tempfile::tempdir().unwrap();
        let second = tempfile::tempdir().unwrap();
        std::fs::write(first.path().join("value"), b"first").unwrap();
        std::fs::write(second.path().join("value"), b"second").unwrap();
        let bindings = Arc::new(Bindings(Mutex::new(Some(first.path().to_path_buf()))));
        let secrets = Arc::new(ovule_secrets::providers::open(first.path()).unwrap());
        let router = WorkspaceTransportRouter::new(bindings.clone(), secrets);
        assert_eq!(
            router
                .resolve(Some("bound"), "ignored")
                .unwrap()
                .read_file("value")
                .await
                .unwrap(),
            b"first"
        );
        *bindings.0.lock().unwrap() = Some(second.path().to_path_buf());
        assert_eq!(
            router
                .resolve(Some("bound"), "ignored")
                .unwrap()
                .read_file("value")
                .await
                .unwrap(),
            b"second"
        );
        *bindings.0.lock().unwrap() = None;
        assert!(matches!(
            router.resolve(Some("bound"), first.path().to_str().unwrap()),
            Err(TransportError::NotFound(_))
        ));
        assert_eq!(
            router
                .resolve(None, first.path().to_str().unwrap())
                .unwrap()
                .read_file("value")
                .await
                .unwrap(),
            b"first"
        );
    }
}
