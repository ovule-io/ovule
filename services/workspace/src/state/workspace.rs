use serde::{Deserialize, Serialize};

/// Persisted state owned by the workspace capability.
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub(super) struct WorkspaceInventory {
    #[serde(default)]
    pub(super) projects: Vec<Project>,
    #[serde(default)]
    pub(super) bindings: Vec<WorkspaceBinding>,
}

use super::{
    AppSnapshot, Project, RemoteEndpoint, Thread, Workspace, WorkspaceBinding, WorkspaceKind,
    WorkspaceTrust, attempt_view, canonical_workspace, goal_view, host_views, message_view,
    node_view, now_millis, project_view, remote_endpoint_view, required, terminal_run_view,
    thread_view, workspace_binding_view,
};

impl Workspace {
    #[must_use]
    pub fn workspace_binding(&self, id: &str) -> Option<WorkspaceBinding> {
        self.inventory
            .bindings
            .iter()
            .find(|binding| binding.id == id)
            .cloned()
    }

    #[must_use]
    pub fn tunnel_binding_ids(&self) -> std::collections::BTreeSet<String> {
        self.inventory
            .bindings
            .iter()
            .filter(|binding| binding.kind == WorkspaceKind::Tunnel)
            .map(|binding| binding.id.clone())
            .collect()
    }

    #[must_use]
    pub fn remote_endpoint(&self, id: &str) -> Option<RemoteEndpoint> {
        self.hosts
            .endpoints
            .iter()
            .find(|endpoint| endpoint.id == id)
            .cloned()
    }
    #[must_use]
    pub const fn revision(&self) -> i64 {
        self.revision
    }

    #[must_use]
    pub fn default_agent_id(&self) -> Option<String> {
        self.settings.default_agent_id.clone()
    }

    #[must_use]
    pub fn response_content_for_attempt(&self, attempt_id: &str) -> Option<String> {
        let response_message_id = self
            .conversation
            .attempts
            .iter()
            .find(|attempt| attempt.id == attempt_id)?
            .response_message_id
            .as_deref()?;
        self.conversation
            .messages
            .iter()
            .find(|message| message.id == response_message_id)
            .map(|message| message.content.clone())
    }

    #[must_use]
    pub fn snapshot(&self) -> AppSnapshot {
        let local_agents = self.settings.catalog.agent_views();
        let tools = self.settings.catalog.tool_views();
        let capabilities = crate::state::capabilities::capability_views(&tools, &local_agents);
        let mut legacy_data_issues = crate::state::capabilities::legacy_data_issues(&tools);
        let missing_context = self
            .workflow
            .nodes
            .iter()
            .filter(|node| {
                matches!(node.kind, super::NodeKind::Task { .. })
                    && node.thread_id.is_empty()
                    && node.execution.is_none()
                    && node.status != "superseded"
            })
            .map(|node| node.id.clone())
            .collect::<Vec<_>>();
        if !missing_context.is_empty() {
            legacy_data_issues.push(crate::state::capabilities::LegacyDataIssueView {
                id: "workflow-missing-execution-context".to_owned(),
                title: "Workflow execution context is missing".to_owned(),
                detail: "These Task nodes have neither a Thread nor a saved execution context."
                    .to_owned(),
                affected_ids: missing_context,
                cleanup_action: "resetWorkflows".to_owned(),
            });
        }
        AppSnapshot {
            revision: self.revision,
            agents: super::agent_views(&local_agents, &self.hosts.endpoints),
            skills: self.settings.catalog.skill_views(),
            tools,
            capabilities,
            legacy_data_issues,
            models: self.settings.catalog.model_views(),
            projects: self.inventory.projects.iter().map(project_view).collect(),
            hosts: host_views(
                &self.hosts.endpoints,
                &self.inventory.bindings,
                &local_agents,
            ),
            endpoints: self
                .hosts
                .endpoints
                .iter()
                .map(remote_endpoint_view)
                .collect(),
            bindings: self
                .inventory
                .bindings
                .iter()
                .map(workspace_binding_view)
                .collect(),
            threads: self.conversation.threads.iter().map(thread_view).collect(),
            messages: self
                .conversation
                .messages
                .iter()
                .map(message_view)
                .collect(),
            goals: self.workflow.goals.iter().map(goal_view).collect(),
            nodes: self
                .workflow
                .nodes
                .iter()
                .map(|node| node_view(node, &self.conversation.threads))
                .collect(),
            attempts: self
                .conversation
                .attempts
                .iter()
                .map(attempt_view)
                .collect(),
            terminal_runs: self
                .terminal
                .terminal_runs
                .iter()
                .map(terminal_run_view)
                .collect(),
        }
    }

    pub fn create_thread(
        &mut self,
        title: &str,
        workspace_path: &str,
    ) -> Result<AppSnapshot, String> {
        let title = required(title, "thread title")?;
        let workspace_path = canonical_workspace(self.files.as_ref(), workspace_path)?;
        let project_id = self.ensure_default_project_id();
        let id = self.allocate_id("thread");
        self.conversation.threads.push(Thread {
            id,
            title,
            agent: self
                .settings
                .default_agent_id
                .clone()
                .unwrap_or_else(|| self.settings.catalog.default_agent_id()),
            host_id: super::local_host_id(),
            workspace_path,
            model_id: self.settings.default_model_id.clone(),
            project_id: Some(project_id),
            workspace_binding_ids: Vec::new(),
        });
        self.changed();
        Ok(self.snapshot())
    }

    pub fn select_agent(&mut self, thread_id: &str, agent: &str) -> Result<AppSnapshot, String> {
        self.require_agent_for_thread(thread_id, agent)?;
        if !self
            .conversation
            .threads
            .iter()
            .any(|thread| thread.id == thread_id)
        {
            return Err(format!("unknown Thread: {thread_id}"));
        }
        let thread = self
            .conversation
            .threads
            .iter_mut()
            .find(|thread| thread.id == thread_id)
            .ok_or_else(|| format!("unknown Thread: {thread_id}"))?;
        agent.clone_into(&mut thread.agent);
        thread.model_id = None;
        self.changed();
        Ok(self.snapshot())
    }

    pub fn select_host(&mut self, thread_id: &str, host_id: &str) -> Result<AppSnapshot, String> {
        if host_id != "local" && !self.hosts.endpoints.iter().any(|host| host.id == host_id) {
            return Err(format!("unknown Host: {host_id}"));
        }
        if !self
            .conversation
            .threads
            .iter()
            .any(|thread| thread.id == thread_id)
        {
            return Err(format!("unknown Thread: {thread_id}"));
        }
        let thread = self
            .conversation
            .threads
            .iter_mut()
            .find(|thread| thread.id == thread_id)
            .ok_or_else(|| format!("unknown Thread: {thread_id}"))?;
        host_id.clone_into(&mut thread.host_id);
        thread.model_id = None;
        self.changed();
        Ok(self.snapshot())
    }

    pub fn set_thread_workspace(
        &mut self,
        thread_id: &str,
        workspace_path: &str,
    ) -> Result<AppSnapshot, String> {
        let workspace_path = canonical_workspace(self.files.as_ref(), workspace_path)?;
        if !self
            .conversation
            .threads
            .iter()
            .any(|thread| thread.id == thread_id)
        {
            return Err(format!("unknown Thread: {thread_id}"));
        }
        let thread = self
            .conversation
            .threads
            .iter_mut()
            .find(|thread| thread.id == thread_id)
            .ok_or_else(|| format!("unknown Thread: {thread_id}"))?;
        thread.workspace_path = workspace_path;
        self.changed();
        Ok(self.snapshot())
    }

    pub fn configure_thread(
        &mut self,
        thread_id: &str,
        agent: &str,
        model_id: Option<String>,
    ) -> Result<AppSnapshot, String> {
        self.require_agent_for_thread(thread_id, agent)?;
        if let Some(model_id) = model_id.as_deref() {
            self.settings
                .catalog
                .require_model_for_agent(model_id, agent)?;
        }
        let thread = self
            .conversation
            .threads
            .iter_mut()
            .find(|thread| thread.id == thread_id)
            .ok_or_else(|| format!("unknown Thread: {thread_id}"))?;
        agent.clone_into(&mut thread.agent);
        thread.model_id = model_id;
        self.changed();
        Ok(self.snapshot())
    }

    pub fn configure_defaults(
        &mut self,
        agent: &str,
        model_id: Option<String>,
        thread_id: Option<&str>,
    ) -> Result<AppSnapshot, String> {
        if let Some(thread_id) = thread_id {
            self.require_agent_for_thread(thread_id, agent)?;
        } else {
            self.require_available_agent(agent)?;
        }
        if let Some(model_id) = model_id.as_deref() {
            self.settings
                .catalog
                .require_model_for_agent(model_id, agent)?;
        }
        self.settings.default_agent_id = Some(agent.to_owned());
        self.settings.default_model_id.clone_from(&model_id);
        if let Some(thread_id) = thread_id {
            self.configure_thread(thread_id, agent, model_id)?;
        } else {
            self.changed();
        }
        Ok(self.snapshot())
    }

    #[allow(dead_code)]
    pub fn create_project(&mut self, name: &str) -> Result<AppSnapshot, String> {
        let name = required(name, "project name")?;
        if self
            .inventory
            .projects
            .iter()
            .any(|project| project.name.eq_ignore_ascii_case(&name))
        {
            return Err(format!("project already exists: {name}"));
        }
        let sort_order = self
            .inventory
            .projects
            .iter()
            .map(|project| project.sort_order)
            .max()
            .map_or(0, |max| max + 1);
        let id = self.allocate_id("project");
        self.inventory.projects.push(Project {
            id,
            name,
            sort_order,
            created_at_ms: now_millis(),
        });
        self.changed();
        Ok(self.snapshot())
    }

    #[allow(dead_code)]
    pub fn rename_project(&mut self, project_id: &str, name: &str) -> Result<AppSnapshot, String> {
        let name = required(name, "project name")?;
        if self
            .inventory
            .projects
            .iter()
            .any(|project| project.id != project_id && project.name.eq_ignore_ascii_case(&name))
        {
            return Err(format!("project already exists: {name}"));
        }
        let project = self
            .inventory
            .projects
            .iter_mut()
            .find(|project| project.id == project_id)
            .ok_or_else(|| format!("unknown Project: {project_id}"))?;
        project.name = name;
        self.changed();
        Ok(self.snapshot())
    }

    #[allow(dead_code)]
    pub fn move_thread_to_project(
        &mut self,
        thread_id: &str,
        project_id: &str,
    ) -> Result<AppSnapshot, String> {
        if !self
            .inventory
            .projects
            .iter()
            .any(|project| project.id == project_id)
        {
            return Err(format!("unknown Project: {project_id}"));
        }
        let thread = self
            .conversation
            .threads
            .iter_mut()
            .find(|thread| thread.id == thread_id)
            .ok_or_else(|| format!("unknown Thread: {thread_id}"))?;
        thread.project_id = Some(project_id.to_owned());
        self.changed();
        Ok(self.snapshot())
    }

    #[allow(dead_code)]
    pub fn bind_workspace(
        &mut self,
        thread_id: &str,
        kind: WorkspaceKind,
        endpoint_id: Option<&str>,
        root: &str,
        alias: &str,
    ) -> Result<AppSnapshot, String> {
        self.bind_workspace_resource(thread_id, kind, endpoint_id, None, root, alias)
    }

    pub fn bind_workspace_resource(
        &mut self,
        thread_id: &str,
        kind: WorkspaceKind,
        endpoint_id: Option<&str>,
        resource_id: Option<&str>,
        root: &str,
        alias: &str,
    ) -> Result<AppSnapshot, String> {
        let root = required(root, "workspace root")?;
        let alias = required(alias, "workspace alias")?;
        if kind != WorkspaceKind::Local && !is_host_absolute_path(&root) {
            return Err(format!("Remote Workspace root must be absolute: {root}"));
        }
        match (kind, endpoint_id) {
            (WorkspaceKind::Local, Some(_)) => {
                return Err("Local Workspace must belong to Local Host".to_owned());
            }
            (WorkspaceKind::Local, None) => {
                if resource_id.is_some() {
                    return Err("Local Workspace cannot have a Host resource ID".to_owned());
                }
            }
            (_, None) => return Err("Remote Workspace requires a Host".to_owned()),
            (remote_kind, Some(host_id)) => {
                let host = self
                    .hosts
                    .endpoints
                    .iter()
                    .find(|host| host.id == host_id)
                    .ok_or_else(|| format!("unknown Host: {host_id}"))?;
                if host.transport != remote_kind {
                    return Err(format!(
                        "Workspace transport {} does not match Host connector {}",
                        remote_kind.as_str(),
                        host.transport.as_str()
                    ));
                }
                if remote_kind == WorkspaceKind::Tunnel {
                    let resource_id = resource_id
                        .filter(|value| !value.trim().is_empty())
                        .ok_or_else(|| "Link Workspace requires a Host resource ID".to_owned())?;
                    let resource = host
                        .workspaces
                        .iter()
                        .find(|workspace| workspace.id == resource_id)
                        .ok_or_else(|| format!("unknown Host Workspace resource: {resource_id}"))?;
                    if !same_host_path(&resource.root, &root) {
                        return Err(format!(
                            "Host Workspace resource {resource_id} belongs to {}, not {root}",
                            resource.root
                        ));
                    }
                } else if resource_id.is_some() {
                    return Err("SSH Workspace cannot have a Link resource ID".to_owned());
                }
            }
        }
        if !self
            .conversation
            .threads
            .iter()
            .any(|thread| thread.id == thread_id)
        {
            return Err(format!("unknown Thread: {thread_id}"));
        }
        if kind == WorkspaceKind::Tunnel
            && self.inventory.bindings.iter().any(|binding| {
                binding.thread_id == thread_id
                    && binding.endpoint_id.as_deref() == endpoint_id
                    && binding.resource_id.as_deref() == resource_id
            })
        {
            return Ok(self.snapshot());
        }
        let sort_order = self
            .inventory
            .bindings
            .iter()
            .filter(|binding| binding.thread_id == thread_id)
            .map(|binding| binding.sort_order)
            .max()
            .map_or(0, |max| max + 1);
        let id = self.allocate_id("binding");
        self.inventory.bindings.push(WorkspaceBinding {
            id: id.clone(),
            thread_id: thread_id.to_owned(),
            host_id: endpoint_id.unwrap_or("local").to_owned(),
            kind,
            endpoint_id: endpoint_id.map(str::to_owned),
            resource_id: resource_id.map(str::to_owned),
            root,
            alias,
            sort_order,
            trust: WorkspaceTrust::Restricted,
        });
        if let Some(thread) = self
            .conversation
            .threads
            .iter_mut()
            .find(|thread| thread.id == thread_id)
            && !thread.workspace_binding_ids.contains(&id)
        {
            thread.workspace_binding_ids.push(id);
        }
        self.changed();
        Ok(self.snapshot())
    }

    #[allow(dead_code)]
    pub fn unbind_workspace(&mut self, binding_id: &str) -> Result<AppSnapshot, String> {
        let index = self
            .inventory
            .bindings
            .iter()
            .position(|binding| binding.id == binding_id)
            .ok_or_else(|| format!("unknown WorkspaceBinding: {binding_id}"))?;
        let removed = self.inventory.bindings.remove(index);
        if let Some(thread) = self
            .conversation
            .threads
            .iter_mut()
            .find(|thread| thread.id == removed.thread_id)
        {
            thread.workspace_binding_ids.retain(|id| id != binding_id);
        }
        self.changed();
        Ok(self.snapshot())
    }

    pub fn unbind_remote_host(
        &mut self,
        thread_id: &str,
        endpoint_id: &str,
    ) -> Result<AppSnapshot, String> {
        if !self
            .hosts
            .endpoints
            .iter()
            .any(|endpoint| endpoint.id == endpoint_id)
        {
            return Err(format!("unknown Host: {endpoint_id}"));
        }
        if !self
            .conversation
            .threads
            .iter()
            .any(|thread| thread.id == thread_id)
        {
            return Err(format!("unknown Thread: {thread_id}"));
        }
        let removed = self
            .inventory
            .bindings
            .iter()
            .filter(|binding| binding.thread_id == thread_id && binding.host_id == endpoint_id)
            .map(|binding| binding.id.clone())
            .collect::<std::collections::BTreeSet<_>>();
        self.inventory
            .bindings
            .retain(|binding| !removed.contains(&binding.id));
        let thread = self
            .conversation
            .threads
            .iter_mut()
            .find(|thread| thread.id == thread_id)
            .ok_or_else(|| format!("unknown Thread: {thread_id}"))?;
        thread
            .workspace_binding_ids
            .retain(|binding_id| !removed.contains(binding_id));
        if thread.host_id == endpoint_id {
            thread.host_id = super::local_host_id();
            thread.model_id = None;
        }
        self.changed();
        Ok(self.snapshot())
    }

    pub fn remove_remote_host(&mut self, endpoint_id: &str) -> Result<AppSnapshot, String> {
        let index = self
            .hosts
            .endpoints
            .iter()
            .position(|endpoint| endpoint.id == endpoint_id)
            .ok_or_else(|| format!("unknown Host: {endpoint_id}"))?;
        self.hosts.endpoints.remove(index);
        self.remove_remote_bindings(&std::collections::BTreeSet::from([endpoint_id.to_owned()]));
        self.changed();
        Ok(self.snapshot())
    }

    pub fn reset_link_hosts(&mut self) -> AppSnapshot {
        let removed = self
            .hosts
            .endpoints
            .iter()
            .filter(|endpoint| endpoint.transport == WorkspaceKind::Tunnel)
            .map(|endpoint| endpoint.id.clone())
            .collect::<std::collections::BTreeSet<_>>();
        self.hosts
            .endpoints
            .retain(|endpoint| endpoint.transport != WorkspaceKind::Tunnel);
        self.remove_remote_bindings(&removed);
        self.changed();
        self.snapshot()
    }

    fn remove_remote_bindings(&mut self, host_ids: &std::collections::BTreeSet<String>) {
        let binding_ids = self
            .inventory
            .bindings
            .iter()
            .filter(|binding| host_ids.contains(&binding.host_id))
            .map(|binding| binding.id.clone())
            .collect::<std::collections::BTreeSet<_>>();
        self.inventory
            .bindings
            .retain(|binding| !binding_ids.contains(&binding.id));
        for thread in &mut self.conversation.threads {
            thread
                .workspace_binding_ids
                .retain(|binding_id| !binding_ids.contains(binding_id));
            if host_ids.contains(&thread.host_id) {
                thread.host_id = super::local_host_id();
                thread.model_id = None;
            }
        }
    }

    pub fn set_thread_workspace_bindings(
        &mut self,
        thread_id: &str,
        binding_ids: &[String],
    ) -> Result<AppSnapshot, String> {
        let host_id = self
            .conversation
            .threads
            .iter()
            .find(|thread| thread.id == thread_id)
            .map(|thread| thread.host_id.clone())
            .ok_or_else(|| format!("unknown Thread: {thread_id}"))?;
        let mut unique = std::collections::BTreeSet::new();
        let mut selected = self
            .conversation
            .threads
            .iter()
            .find(|thread| thread.id == thread_id)
            .into_iter()
            .flat_map(|thread| thread.workspace_binding_ids.iter())
            .filter(|id| {
                self.workspace_binding(id)
                    .is_some_and(|binding| binding.host_id != host_id)
            })
            .cloned()
            .collect::<Vec<_>>();
        for id in binding_ids {
            if !unique.insert(id) {
                return Err(format!("duplicate WorkspaceBinding: {id}"));
            }
            let binding = self
                .inventory
                .bindings
                .iter()
                .find(|binding| binding.id == *id)
                .cloned()
                .ok_or_else(|| format!("unknown WorkspaceBinding: {id}"))?;
            if binding.host_id != host_id {
                return Err(format!(
                    "WorkspaceBinding {id} belongs to Host {}, not selected Host {host_id}",
                    binding.host_id
                ));
            }
            if binding.thread_id == thread_id {
                selected.push(binding.id);
            } else if let Some(existing) = self.inventory.bindings.iter().find(|candidate| {
                candidate.thread_id == thread_id
                    && candidate.kind == binding.kind
                    && candidate.endpoint_id == binding.endpoint_id
                    && candidate.root == binding.root
            }) {
                selected.push(existing.id.clone());
            } else {
                let cloned_id = self.allocate_id("binding");
                let sort_order = self
                    .inventory
                    .bindings
                    .iter()
                    .filter(|candidate| candidate.thread_id == thread_id)
                    .map(|candidate| candidate.sort_order)
                    .max()
                    .map_or(0, |max| max + 1);
                self.inventory.bindings.push(WorkspaceBinding {
                    id: cloned_id.clone(),
                    thread_id: thread_id.to_owned(),
                    host_id: binding.host_id,
                    kind: binding.kind,
                    endpoint_id: binding.endpoint_id,
                    resource_id: binding.resource_id,
                    root: binding.root,
                    alias: binding.alias,
                    sort_order,
                    trust: binding.trust,
                });
                selected.push(cloned_id);
            }
        }
        let thread = self
            .conversation
            .threads
            .iter_mut()
            .find(|thread| thread.id == thread_id)
            .ok_or_else(|| format!("unknown Thread: {thread_id}"))?;
        thread.workspace_binding_ids = selected;
        self.changed();
        Ok(self.snapshot())
    }

    #[allow(dead_code)]
    #[allow(clippy::too_many_arguments)]
    pub fn register_endpoint(
        &mut self,
        display_name: &str,
        transport: WorkspaceKind,
        credential_ref: Option<String>,
        host: Option<String>,
        port: Option<u16>,
        user: Option<String>,
        auth_kind: Option<String>,
        host_fingerprint: Option<String>,
        agent_ids: Vec<String>,
    ) -> Result<(String, AppSnapshot), String> {
        let remote_id = matches!(transport, WorkspaceKind::Tunnel)
            .then(|| host.clone())
            .flatten();
        self.register_endpoint_inventory(
            display_name,
            transport,
            credential_ref,
            host,
            remote_id,
            port,
            user,
            auth_kind,
            host_fingerprint,
            agent_ids,
            Vec::new(),
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn register_endpoint_inventory(
        &mut self,
        display_name: &str,
        transport: WorkspaceKind,
        credential_ref: Option<String>,
        host: Option<String>,
        remote_id: Option<String>,
        port: Option<u16>,
        user: Option<String>,
        auth_kind: Option<String>,
        host_fingerprint: Option<String>,
        agent_ids: Vec<String>,
        workspaces: Vec<super::RemoteWorkspaceResource>,
    ) -> Result<(String, AppSnapshot), String> {
        let display_name = required(display_name, "endpoint display name")?;
        if matches!(transport, WorkspaceKind::Local) {
            return Err("Local Workspace does not require a registered Endpoint".to_owned());
        }
        if matches!(transport, WorkspaceKind::Tunnel) && remote_id.is_none() {
            return Err("Link Host identity is required".to_owned());
        }
        validate_host_inventory(transport, &agent_ids, &workspaces)?;
        if matches!(transport, WorkspaceKind::Tunnel)
            && let Some(existing) =
                self.hosts.endpoints.iter_mut().find(|endpoint| {
                    endpoint.transport == transport && endpoint.remote_id == remote_id
                })
        {
            existing.display_name = display_name;
            existing.credential_ref = credential_ref;
            existing.host = host;
            existing.remote_id = remote_id;
            existing.user = user;
            existing.agent_ids = agent_ids;
            existing.workspaces = workspaces;
            existing.last_seen_ms = Some(now_millis());
            let id = existing.id.clone();
            self.reconcile_endpoint_inventory(&id);
            self.changed();
            return Ok((id, self.snapshot()));
        }
        let id = self.allocate_id("endpoint");
        self.hosts.endpoints.push(RemoteEndpoint {
            id: id.clone(),
            display_name,
            transport,
            credential_ref,
            host,
            remote_id,
            port,
            user,
            auth_kind,
            host_fingerprint,
            spice_websocket_url: None,
            last_seen_ms: matches!(transport, WorkspaceKind::Tunnel).then(now_millis),
            agent_ids,
            workspaces,
        });
        self.changed();
        Ok((id, self.snapshot()))
    }

    pub fn configure_host_spice(
        &mut self,
        endpoint_id: &str,
        websocket_url: Option<String>,
    ) -> Result<AppSnapshot, String> {
        let websocket_url = websocket_url
            .map(|value| validate_spice_websocket_url(&value))
            .transpose()?;
        let endpoint = self
            .hosts
            .endpoints
            .iter_mut()
            .find(|endpoint| endpoint.id == endpoint_id)
            .ok_or_else(|| format!("unknown remote Host: {endpoint_id}"))?;
        endpoint.spice_websocket_url = websocket_url;
        self.changed();
        Ok(self.snapshot())
    }

    fn reconcile_endpoint_inventory(&mut self, endpoint_id: &str) {
        let Some(endpoint) = self
            .hosts
            .endpoints
            .iter()
            .find(|endpoint| endpoint.id == endpoint_id)
            .cloned()
        else {
            return;
        };
        let valid_resources = endpoint
            .workspaces
            .iter()
            .map(|workspace| workspace.id.as_str())
            .collect::<std::collections::BTreeSet<_>>();
        let removed_bindings = self
            .inventory
            .bindings
            .iter()
            .filter(|binding| {
                binding.host_id == endpoint_id
                    && binding
                        .resource_id
                        .as_deref()
                        .is_none_or(|resource_id| !valid_resources.contains(resource_id))
            })
            .map(|binding| binding.id.clone())
            .collect::<std::collections::BTreeSet<_>>();
        self.inventory
            .bindings
            .retain(|binding| !removed_bindings.contains(&binding.id));

        let agent_views = self.settings.catalog.agent_views();
        let fallback_agent = agent_views
            .iter()
            .find(|agent| agent.enabled && endpoint.agent_ids.contains(&agent.driver))
            .map(|agent| agent.id.clone())
            .or_else(|| endpoint.agent_ids.first().cloned());
        for thread in &mut self.conversation.threads {
            thread
                .workspace_binding_ids
                .retain(|binding_id| !removed_bindings.contains(binding_id));
            if thread.host_id != endpoint_id {
                continue;
            }
            let current_is_granted = agent_views
                .iter()
                .find(|agent| agent.id == thread.agent)
                .is_some_and(|agent| endpoint.agent_ids.contains(&agent.driver))
                || endpoint.agent_ids.contains(&thread.agent);
            if !current_is_granted && let Some(fallback) = &fallback_agent {
                thread.agent.clone_from(fallback);
                thread.model_id = None;
            }
        }
    }

    pub fn ensure_default_project_id(&mut self) -> String {
        if let Some(project) = self
            .inventory
            .projects
            .iter()
            .min_by_key(|project| (project.sort_order, project.created_at_ms))
        {
            return project.id.clone();
        }
        let id = self.allocate_id("project");
        self.inventory.projects.push(Project {
            id: id.clone(),
            name: "Default project".to_owned(),
            sort_order: 0,
            created_at_ms: now_millis(),
        });
        id
    }

    pub fn apply_projects_migration(&mut self) -> bool {
        let mut mutated = false;
        let has_threads_without_project = self
            .conversation
            .threads
            .iter()
            .any(|thread| thread.project_id.is_none());
        if self.inventory.projects.is_empty()
            && (has_threads_without_project || !self.conversation.threads.is_empty())
        {
            let _ = self.ensure_default_project_id();
            mutated = true;
        }
        if has_threads_without_project {
            let default_id = self.ensure_default_project_id();
            for thread in &mut self.conversation.threads {
                if thread.project_id.is_none() {
                    thread.project_id = Some(default_id.clone());
                    mutated = true;
                }
            }
        }
        mutated
    }
}

fn validate_spice_websocket_url(value: &str) -> Result<String, String> {
    let value = required(value, "SPICE WebSocket URL")?;
    let url =
        url::Url::parse(&value).map_err(|error| format!("invalid SPICE WebSocket URL: {error}"))?;
    let host = url
        .host_str()
        .ok_or_else(|| "SPICE WebSocket URL must include a host".to_owned())?;
    let secure = url.scheme() == "wss";
    let loopback = url.scheme() == "ws"
        && (host.eq_ignore_ascii_case("localhost")
            || host
                .parse::<std::net::IpAddr>()
                .is_ok_and(|address| address.is_loopback()));
    if !secure && !loopback {
        return Err("Remote SPICE sessions require wss://; ws:// is allowed only for loopback local validation".to_owned());
    }
    if !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(
            "SPICE WebSocket URLs cannot contain credentials, query parameters, or fragments"
                .to_owned(),
        );
    }
    Ok(url.to_string())
}

fn is_host_absolute_path(value: &str) -> bool {
    value.starts_with('/')
        || value.starts_with("\\\\")
        || value.as_bytes().get(1) == Some(&b':')
            && value
                .as_bytes()
                .first()
                .is_some_and(u8::is_ascii_alphabetic)
            && matches!(value.as_bytes().get(2), Some(b'\\' | b'/'))
}

fn same_host_path(left: &str, right: &str) -> bool {
    left.replace('\\', "/")
        .eq_ignore_ascii_case(&right.replace('\\', "/"))
}

fn validate_host_inventory(
    transport: WorkspaceKind,
    agent_ids: &[String],
    workspaces: &[super::RemoteWorkspaceResource],
) -> Result<(), String> {
    let mut unique_agents = std::collections::BTreeSet::new();
    for agent_id in agent_ids {
        let id = required(agent_id, "Host Agent ID")?;
        if !unique_agents.insert(id.clone()) {
            return Err(format!("duplicate Host Agent ID: {id}"));
        }
    }
    if transport != WorkspaceKind::Tunnel && !workspaces.is_empty() {
        return Err("only Link Hosts can publish Workspace resources".to_owned());
    }
    let mut unique_workspaces = std::collections::BTreeSet::new();
    for workspace in workspaces {
        let id = required(&workspace.id, "Host Workspace resource ID")?;
        let root = required(&workspace.root, "Host Workspace root")?;
        required(&workspace.alias, "Host Workspace alias")?;
        if !is_host_absolute_path(&root) {
            return Err(format!("Host Workspace root must be absolute: {root}"));
        }
        if !unique_workspaces.insert(id.clone()) {
            return Err(format!("duplicate Host Workspace resource ID: {id}"));
        }
    }
    Ok(())
}

#[cfg(test)]
mod spice_tests {
    use super::{Workspace, WorkspaceKind, validate_spice_websocket_url};

    #[test]
    fn spice_websocket_requires_tls_except_on_loopback() {
        assert!(validate_spice_websocket_url("wss://desktop.example.com/spice").is_ok());
        assert!(validate_spice_websocket_url("ws://127.0.0.1:5959").is_ok());
        assert!(validate_spice_websocket_url("ws://remote.example.com:5959").is_err());
    }

    #[test]
    fn spice_websocket_rejects_credentials_and_query_state() {
        assert!(validate_spice_websocket_url("wss://user:pass@example.com/spice").is_err());
        assert!(validate_spice_websocket_url("wss://example.com/spice?ticket=secret").is_err());
        assert!(validate_spice_websocket_url("wss://example.com/spice#session").is_err());
    }

    #[test]
    fn host_spice_configuration_round_trips_through_the_snapshot() {
        let mut workspace = Workspace::default();
        let (endpoint_id, _) = workspace
            .register_endpoint_inventory(
                "Remote desktop Host",
                WorkspaceKind::Tunnel,
                None,
                Some("route".to_owned()),
                Some("host-public-key".to_owned()),
                None,
                Some("pair-token".to_owned()),
                None,
                None,
                Vec::new(),
                Vec::new(),
            )
            .unwrap();

        let configured = workspace
            .configure_host_spice(
                &endpoint_id,
                Some("wss://desktop.example.com/spice".to_owned()),
            )
            .unwrap();
        assert_eq!(
            configured.endpoints[0].spice_websocket_url.as_deref(),
            Some("wss://desktop.example.com/spice")
        );

        let cleared = workspace.configure_host_spice(&endpoint_id, None).unwrap();
        assert!(cleared.endpoints[0].spice_websocket_url.is_none());
    }
}
