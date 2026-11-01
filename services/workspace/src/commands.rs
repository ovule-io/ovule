//! Consumer workspace commands. Native transport details are supplied through transport capabilities.
use crate::management::{SshHostDiscovery, TunnelEndpointTest, WorkspaceServiceError};
use crate::state::{AppSnapshot, BrowserSuggestion};
pub trait WorkspaceManagement: Send + Sync {
    fn share_host_link(&self) -> Result<ovule_hosts::TunnelShareStatus, WorkspaceServiceError>;
    fn regenerate_host_link(&self)
    -> Result<ovule_hosts::TunnelShareStatus, WorkspaceServiceError>;
    fn workspace_link_client_id(&self) -> Result<String, WorkspaceServiceError>;
    fn share_workspace_link(
        &self,
        root: &str,
        alias: &str,
    ) -> Result<ovule_hosts::TunnelShareStatus, WorkspaceServiceError>;
    fn set_workspace_link_access(
        &self,
        client_id: &str,
        workspace_ids: Vec<String>,
        agent_ids: Vec<String>,
    ) -> Result<(), WorkspaceServiceError>;
    fn submit_workspace_link_pairing(
        &self,
        endpoint_addr_json: &str,
        share_id: &str,
        code: &str,
    ) -> Result<String, WorkspaceServiceError>;
    fn share_current_workspace_link(
        &self,
        thread_id: &str,
    ) -> Result<ovule_hosts::TunnelShareStatus, WorkspaceServiceError>;
    fn revoke_workspace_link(
        &self,
        _share_id: &str,
        client_id: &str,
    ) -> Result<(), WorkspaceServiceError>;
    fn test_tunnel_endpoint(
        &self,
        endpoint_addr_json: &str,
        share_id: String,
    ) -> Result<TunnelEndpointTest, WorkspaceServiceError>;
    fn discover_ssh_host(&self) -> SshHostDiscovery;
    fn snapshot(&self) -> AppSnapshot;
    fn prepare_shutdown(&self) -> Result<(), WorkspaceServiceError>;
    fn create_thread(
        &self,
        title: &str,
        workspace_path: Option<&str>,
    ) -> Result<AppSnapshot, WorkspaceServiceError>;
    fn browser_suggestions(
        &self,
        thread_id: Option<&str>,
        query: &str,
    ) -> Result<Vec<BrowserSuggestion>, WorkspaceServiceError>;
    fn set_thread_workspace(
        &self,
        thread_id: &str,
        workspace_path: &str,
    ) -> Result<AppSnapshot, WorkspaceServiceError>;
    fn create_project(&self, name: &str) -> Result<AppSnapshot, WorkspaceServiceError>;
    fn rename_project(
        &self,
        project_id: &str,
        name: &str,
    ) -> Result<AppSnapshot, WorkspaceServiceError>;
    fn move_thread_to_project(
        &self,
        thread_id: &str,
        project_id: &str,
    ) -> Result<AppSnapshot, WorkspaceServiceError>;
    fn bind_workspace(
        &self,
        thread_id: &str,
        kind: &str,
        endpoint_id: Option<&str>,
        resource_id: Option<&str>,
        root: &str,
        alias: &str,
    ) -> Result<AppSnapshot, WorkspaceServiceError>;
    fn unbind_workspace(&self, binding_id: &str) -> Result<AppSnapshot, WorkspaceServiceError>;
    fn unbind_remote_host(
        &self,
        thread_id: &str,
        endpoint_id: &str,
    ) -> Result<AppSnapshot, WorkspaceServiceError>;
    fn remove_remote_host(&self, endpoint_id: &str) -> Result<AppSnapshot, WorkspaceServiceError>;
    fn reset_link_hosts(&self) -> Result<AppSnapshot, WorkspaceServiceError>;
    fn repair_local_host_access(
        &self,
    ) -> Result<ovule_hosts::TunnelShareStatus, WorkspaceServiceError>;
    fn reset_local_host_link_identity(
        &self,
    ) -> Result<ovule_hosts::TunnelShareStatus, WorkspaceServiceError>;
    fn set_thread_workspace_bindings(
        &self,
        thread_id: &str,
        binding_ids: &[String],
    ) -> Result<AppSnapshot, WorkspaceServiceError>;
    fn configure_host_spice(
        &self,
        endpoint_id: &str,
        websocket_url: Option<String>,
    ) -> Result<AppSnapshot, WorkspaceServiceError>;
    #[allow(clippy::too_many_arguments)]
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
    ) -> Result<(String, AppSnapshot), WorkspaceServiceError>;
    #[allow(clippy::too_many_arguments)]
    fn test_ssh_endpoint(
        &self,
        host: String,
        port: u16,
        user: String,
        auth_kind: String,
        secret: String,
        host_fingerprint: String,
        root: String,
    ) -> Result<String, WorkspaceServiceError>;
}
pub type WorkspaceService = tuffite_ioc::Service<dyn WorkspaceManagement>;
