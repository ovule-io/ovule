use crate::WorkspaceSession;
use ovule_hosts::{BindingResolver, TransportBinding, TransportEndpoint, TransportKind};
use std::sync::Arc;
pub(crate) struct WorkspaceBindings(pub Arc<WorkspaceSession>);
impl BindingResolver for WorkspaceBindings {
    fn binding(&self, id: &str) -> Option<TransportBinding> {
        self.0
            .read(|state| state.workspace_binding(id))
            .map(|binding| TransportBinding {
                kind: match binding.kind {
                    crate::state::WorkspaceKind::Local => TransportKind::Local,
                    crate::state::WorkspaceKind::Ssh => TransportKind::Ssh,
                    crate::state::WorkspaceKind::Tunnel => TransportKind::Tunnel,
                },
                root: binding.root,
                endpoint_id: binding.endpoint_id,
                resource_id: binding.resource_id,
            })
    }
    fn endpoint(&self, id: &str) -> Option<TransportEndpoint> {
        self.0
            .read(|state| state.remote_endpoint(id))
            .map(|endpoint| TransportEndpoint {
                host: endpoint.host,
                port: endpoint.port,
                user: endpoint.user,
                auth_kind: endpoint.auth_kind,
                credential_ref: endpoint.credential_ref,
                host_fingerprint: endpoint.host_fingerprint,
            })
    }
    fn tunnel_binding_ids(&self) -> Vec<String> {
        self.0
            .read(crate::state::Workspace::tunnel_binding_ids)
            .into_iter()
            .collect()
    }
}
