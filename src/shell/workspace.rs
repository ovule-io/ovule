use tuffite::CommandError;

use crate::runtime::App;
use crate::shell_api::{
    AppSnapshot, BindWorkspaceInput, BrowserSuggestion, CreateThreadInput, DiscoverSshHostResult,
    HostAgentResource, HostDeviceAccess, HostWorkspaceResource, RegisterEndpointInput,
    RegisterEndpointResult, SetHostDeviceAccessInput, ShareWorkspaceLinkResult,
    TestSshEndpointResult, TestWorkspaceLinkResult, WorkspaceLinkPairingRequest,
};
use ovule_workspace::WorkspaceServiceError;

use super::mapper;

fn map_workspace_service_error(error: WorkspaceServiceError) -> CommandError {
    match error {
        WorkspaceServiceError::InvalidArgument(message) => CommandError::InvalidArgument(message),
        WorkspaceServiceError::Persistence(message) => CommandError::Failed(message),
    }
}

fn map_host_power(value: ovule_hosts::HostPowerStatus) -> crate::shell_api::HostPowerStatus {
    crate::shell_api::HostPowerStatus {
        keep_awake: value.keep_awake,
        active: value.active,
        supported: value.supported,
        error: value.error,
    }
}

fn parse_ssh_port(value: f64) -> Result<u16, CommandError> {
    if !value.is_finite() || value.fract() != 0.0 || !(1.0..=65_535.0).contains(&value) {
        return Err(CommandError::InvalidArgument(
            "SSH port must be an integer between 1 and 65535".to_owned(),
        ));
    }
    value
        .to_string()
        .parse::<u16>()
        .map_err(|_| CommandError::InvalidArgument("SSH port is invalid".to_owned()))
}

fn map_tunnel_share(value: ovule_hosts::TunnelShareStatus) -> ShareWorkspaceLinkResult {
    ShareWorkspaceLinkResult {
        requires_reset: value.requires_reset,
        endpoint_addr_json: value.endpoint_addr_json,
        endpoint_id: value.endpoint_id,
        share_id: value.share_id,
        root: value.root,
        alias: value.alias,
        pending: value
            .pending
            .into_iter()
            .map(|item| WorkspaceLinkPairingRequest {
                client_id: item.client_id,
                name: item.name,
                code: item.code,
            })
            .collect(),
        devices: value
            .devices
            .into_iter()
            .map(|device| HostDeviceAccess {
                client_id: device.client_id,
                name: device.name,
                online: device.online,
                workspace_ids: device.workspace_ids,
                agent_ids: device.agent_ids,
            })
            .collect(),
        workspaces: value
            .workspaces
            .into_iter()
            .map(|workspace| HostWorkspaceResource {
                share_id: workspace.id,
                root: workspace.root,
                alias: workspace.alias,
            })
            .collect(),
        agents: value
            .agents
            .into_iter()
            .map(|agent| HostAgentResource {
                id: agent.id,
                available: agent.available,
            })
            .collect(),
    }
}

impl crate::shell_api::Workspace for App {
    #[allow(clippy::unnecessary_wraps)]
    fn snapshot(&self) -> Result<AppSnapshot, CommandError> {
        Ok(mapper::snapshot(
            self.service::<ovule_workspace::WorkspaceService>()?
                .snapshot(),
        ))
    }

    fn create_thread(&self, input: CreateThreadInput) -> Result<AppSnapshot, CommandError> {
        self.service::<ovule_workspace::WorkspaceService>()?
            .create_thread("New thread", input.workspace_path.as_deref())
            .map(mapper::snapshot)
            .map_err(map_workspace_service_error)
    }

    fn set_thread_workspace(
        &self,
        thread_id: String,
        workspace_path: String,
    ) -> Result<AppSnapshot, CommandError> {
        self.service::<ovule_workspace::WorkspaceService>()?
            .set_thread_workspace(&thread_id, &workspace_path)
            .map(mapper::snapshot)
            .map_err(map_workspace_service_error)
    }

    fn browser_suggestions(
        &self,
        thread_id: Option<String>,
        query: String,
    ) -> Result<Vec<BrowserSuggestion>, CommandError> {
        self.service::<ovule_workspace::WorkspaceService>()?
            .browser_suggestions(thread_id.as_deref(), &query)
            .map(mapper::browser_suggestions)
            .map_err(map_workspace_service_error)
    }

    fn desktop_permissions(&self) -> Result<crate::shell_api::DesktopPermissions, CommandError> {
        Ok(map_desktop_permissions(
            ovule_platform::permissions::status(),
        ))
    }

    fn request_desktop_permission(
        &self,
        permission: String,
    ) -> Result<crate::shell_api::DesktopPermissions, CommandError> {
        ovule_platform::permissions::request(&permission)
            .map(map_desktop_permissions)
            .map_err(CommandError::Failed)
    }

    fn host_power_status(&self) -> Result<crate::shell_api::HostPowerStatus, CommandError> {
        Ok(map_host_power(
            self.service::<ovule_hosts::HostPowerService>()?.status(),
        ))
    }

    fn set_host_keep_awake(
        &self,
        enabled: bool,
    ) -> Result<crate::shell_api::HostPowerStatus, CommandError> {
        self.service::<ovule_hosts::HostPowerService>()?
            .set_keep_awake(enabled)
            .map(map_host_power)
            .map_err(CommandError::Failed)
    }

    fn create_project(&self, name: String) -> Result<AppSnapshot, CommandError> {
        self.service::<ovule_workspace::WorkspaceService>()?
            .create_project(&name)
            .map(mapper::snapshot)
            .map_err(map_workspace_service_error)
    }

    fn rename_project(
        &self,
        project_id: String,
        name: String,
    ) -> Result<AppSnapshot, CommandError> {
        self.service::<ovule_workspace::WorkspaceService>()?
            .rename_project(&project_id, &name)
            .map(mapper::snapshot)
            .map_err(map_workspace_service_error)
    }

    fn move_thread_to_project(
        &self,
        thread_id: String,
        project_id: String,
    ) -> Result<AppSnapshot, CommandError> {
        self.service::<ovule_workspace::WorkspaceService>()?
            .move_thread_to_project(&thread_id, &project_id)
            .map(mapper::snapshot)
            .map_err(map_workspace_service_error)
    }

    fn bind_workspace(&self, input: BindWorkspaceInput) -> Result<AppSnapshot, CommandError> {
        self.service::<ovule_workspace::WorkspaceService>()?
            .bind_workspace(
                &input.thread_id,
                &input.kind,
                input.endpoint_id.as_deref(),
                input.resource_id.as_deref(),
                &input.root,
                &input.alias,
            )
            .map(mapper::snapshot)
            .map_err(map_workspace_service_error)
    }

    fn unbind_workspace(&self, binding_id: String) -> Result<AppSnapshot, CommandError> {
        self.service::<ovule_workspace::WorkspaceService>()?
            .unbind_workspace(&binding_id)
            .map(mapper::snapshot)
            .map_err(map_workspace_service_error)
    }

    fn unbind_remote_host(
        &self,
        thread_id: String,
        endpoint_id: String,
    ) -> Result<AppSnapshot, CommandError> {
        self.service::<ovule_workspace::WorkspaceService>()?
            .unbind_remote_host(&thread_id, &endpoint_id)
            .map(mapper::snapshot)
            .map_err(map_workspace_service_error)
    }

    fn remove_remote_host(&self, endpoint_id: String) -> Result<AppSnapshot, CommandError> {
        let remoting = self.service::<ovule_remoting::RemotingService>()?;
        self.service::<ovule_workspace::WorkspaceService>()?
            .remove_remote_host(&endpoint_id)
            .inspect(|_| remoting.close_host(&endpoint_id))
            .map(mapper::snapshot)
            .map_err(map_workspace_service_error)
    }

    fn configure_host_spice(
        &self,
        endpoint_id: String,
        websocket_url: Option<String>,
    ) -> Result<AppSnapshot, CommandError> {
        self.service::<ovule_workspace::WorkspaceService>()?
            .configure_host_spice(&endpoint_id, websocket_url)
            .map(mapper::snapshot)
            .map_err(map_workspace_service_error)
    }

    fn reset_link_hosts(&self) -> Result<AppSnapshot, CommandError> {
        let remoting = self.service::<ovule_remoting::RemotingService>()?;
        self.service::<ovule_workspace::WorkspaceService>()?
            .reset_link_hosts()
            .inspect(|_| remoting.shutdown())
            .map(mapper::snapshot)
            .map_err(map_workspace_service_error)
    }

    fn set_thread_workspace_bindings(
        &self,
        thread_id: String,
        binding_ids: Vec<String>,
    ) -> Result<AppSnapshot, CommandError> {
        self.service::<ovule_workspace::WorkspaceService>()?
            .set_thread_workspace_bindings(&thread_id, &binding_ids)
            .map(mapper::snapshot)
            .map_err(map_workspace_service_error)
    }

    fn register_endpoint(
        &self,
        input: RegisterEndpointInput,
    ) -> Result<RegisterEndpointResult, CommandError> {
        let (endpoint_id, snapshot) = self
            .service::<ovule_workspace::WorkspaceService>()?
            .register_endpoint(
                &input.display_name,
                &input.transport,
                input.host,
                input.port.map(parse_ssh_port).transpose()?,
                input.user,
                input.auth_kind,
                input.secret,
                input.host_fingerprint,
                input.agent_ids.unwrap_or_default(),
                input
                    .workspaces
                    .unwrap_or_default()
                    .into_iter()
                    .map(
                        |workspace| ovule_workspace::state::RemoteWorkspaceResource {
                            id: workspace.share_id,
                            root: workspace.root,
                            alias: workspace.alias,
                        },
                    )
                    .collect(),
            )
            .map_err(map_workspace_service_error)?;
        Ok(RegisterEndpointResult {
            endpoint_id,
            snapshot: mapper::snapshot(snapshot),
        })
    }

    fn test_ssh_endpoint(
        &self,
        input: RegisterEndpointInput,
        root: String,
    ) -> Result<TestSshEndpointResult, CommandError> {
        let detail = self
            .service::<ovule_workspace::WorkspaceService>()?
            .test_ssh_endpoint(
                input.host.unwrap_or_default(),
                input.port.map(parse_ssh_port).transpose()?.unwrap_or(22),
                input.user.unwrap_or_default(),
                input.auth_kind.unwrap_or_default(),
                input.secret.unwrap_or_default(),
                input.host_fingerprint.unwrap_or_default(),
                root,
            )
            .map_err(map_workspace_service_error)?;
        Ok(TestSshEndpointResult {
            reachable: true,
            detail,
        })
    }

    #[allow(clippy::unnecessary_wraps)]
    fn discover_ssh_host(&self) -> Result<DiscoverSshHostResult, CommandError> {
        let value = self
            .service::<ovule_workspace::WorkspaceService>()?
            .discover_ssh_host();
        Ok(DiscoverSshHostResult {
            ready: value.ready,
            host: value.host,
            port: f64::from(value.port),
            user: value.user,
            fingerprint: value.fingerprint,
            root: value.root,
            alias: value.alias,
            detail: value.detail,
        })
    }

    fn share_workspace_link(
        &self,
        root: String,
        alias: String,
    ) -> Result<ShareWorkspaceLinkResult, CommandError> {
        let value = self
            .service::<ovule_workspace::WorkspaceService>()?
            .share_workspace_link(&root, &alias)
            .map_err(map_workspace_service_error)?;
        Ok(map_tunnel_share(value))
    }

    fn share_host_link(&self) -> Result<ShareWorkspaceLinkResult, CommandError> {
        self.service::<ovule_workspace::WorkspaceService>()?
            .share_host_link()
            .map(map_tunnel_share)
            .map_err(map_workspace_service_error)
    }

    fn regenerate_host_link(&self) -> Result<ShareWorkspaceLinkResult, CommandError> {
        self.service::<ovule_workspace::WorkspaceService>()?
            .regenerate_host_link()
            .map(map_tunnel_share)
            .map_err(map_workspace_service_error)
    }

    fn share_current_workspace_link(
        &self,
        thread_id: String,
    ) -> Result<ShareWorkspaceLinkResult, CommandError> {
        let value = self
            .service::<ovule_workspace::WorkspaceService>()?
            .share_current_workspace_link(&thread_id)
            .map_err(map_workspace_service_error)?;
        Ok(map_tunnel_share(value))
    }

    fn repair_local_host_access(&self) -> Result<ShareWorkspaceLinkResult, CommandError> {
        self.service::<ovule_workspace::WorkspaceService>()?
            .repair_local_host_access()
            .map(map_tunnel_share)
            .map_err(map_workspace_service_error)
    }

    fn reset_local_host_link_identity(&self) -> Result<ShareWorkspaceLinkResult, CommandError> {
        self.service::<ovule_workspace::WorkspaceService>()?
            .reset_local_host_link_identity()
            .map(map_tunnel_share)
            .map_err(map_workspace_service_error)
    }

    fn set_workspace_link_access(
        &self,
        input: SetHostDeviceAccessInput,
    ) -> Result<bool, CommandError> {
        self.service::<ovule_workspace::WorkspaceService>()?
            .set_workspace_link_access(&input.client_id, input.workspace_ids, input.agent_ids)
            .map(|()| true)
            .map_err(map_workspace_service_error)
    }

    fn revoke_workspace_link(
        &self,
        share_id: String,
        client_id: String,
    ) -> Result<bool, CommandError> {
        self.service::<ovule_workspace::WorkspaceService>()?
            .revoke_workspace_link(&share_id, &client_id)
            .map(|()| true)
            .map_err(map_workspace_service_error)
    }

    fn submit_workspace_link_pairing(
        &self,
        endpoint_addr_json: String,
        share_id: String,
        code: String,
    ) -> Result<String, CommandError> {
        self.service::<ovule_workspace::WorkspaceService>()?
            .submit_workspace_link_pairing(&endpoint_addr_json, &share_id, &code)
            .map_err(map_workspace_service_error)
    }

    fn test_workspace_link(
        &self,
        endpoint_addr_json: String,
        share_id: String,
    ) -> Result<TestWorkspaceLinkResult, CommandError> {
        let client_id = self
            .service::<ovule_workspace::WorkspaceService>()?
            .workspace_link_client_id()
            .map_err(map_workspace_service_error)?;
        match self
            .service::<ovule_workspace::WorkspaceService>()?
            .test_tunnel_endpoint(&endpoint_addr_json, share_id)
        {
            Ok(tested) => Ok(TestWorkspaceLinkResult {
                connected: true,
                client_id,
                detail: tested.detail,
                root: Some(tested.root),
                agent_ids: tested.agent_ids,
                workspaces: tested
                    .workspaces
                    .into_iter()
                    .map(|workspace| crate::shell_api::HostWorkspaceResource {
                        share_id: workspace.id,
                        root: workspace.root,
                        alias: workspace.alias,
                    })
                    .collect(),
                capabilities: tested.capabilities,
            }),
            Err(WorkspaceServiceError::InvalidArgument(message))
                if message.contains("waiting for Host approval") =>
            {
                Ok(TestWorkspaceLinkResult {
                    connected: false,
                    client_id,
                    detail: message,
                    root: None,
                    agent_ids: Vec::new(),
                    workspaces: Vec::new(),
                    capabilities: Vec::new(),
                })
            }
            Err(error) => Err(map_workspace_service_error(error)),
        }
    }
}

fn map_desktop_permissions(
    value: ovule_platform::permissions::DesktopPermissions,
) -> crate::shell_api::DesktopPermissions {
    crate::shell_api::DesktopPermissions {
        app_version: value.app_version,
        bundle_path: value.bundle_path,
        executable_path: value.executable_path,
        signing_identity: value.signing_identity,
        other_bundle_paths: value.other_bundle_paths,
        screen_capture_verified: value.screen_capture_verified,
        input_monitoring: value.input_monitoring,
        managed: value.managed,
        screen_recording: value.screen_recording,
        accessibility: value.accessibility,
        bundle_id: value.bundle_id,
        expected_bundle_id: value.expected_bundle_id,
    }
}
