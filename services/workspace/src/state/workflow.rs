use serde::{Deserialize, Serialize};

/// Persisted state owned by the workflow capability.
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub(super) struct WorkflowState {
    pub(super) goals: Vec<Goal>,
    pub(super) nodes: Vec<Node>,
}

use super::{
    AppSnapshot, Attempt, AttemptEvent, AttemptSpec, BrowserSuggestion, Goal, Node, NodeKind,
    Thread, ThreadMessage, Workspace, WorkspaceBinding, WorkspaceTrust, markdown_part,
    normalized_remote_target, now_millis, required, required_text,
};

#[derive(Clone, Copy)]
pub struct WorkflowNodeOptions<'a> {
    pub requested_host_id: Option<&'a str>,
    pub requested_workspace_ids: &'a [String],
    pub dependency_ids: &'a [String],
    pub created_at_ms: i64,
}

impl Workspace {
    #[must_use]
    pub fn workflow_host_context(&self) -> String {
        let agents = self.settings.catalog.agent_views();
        let local_workspaces = self
            .inventory
            .bindings
            .iter()
            .filter(|binding| binding.host_id == "local")
            .map(|binding| {
                serde_json::json!({
                    "id": binding.id,
                    "alias": binding.alias,
                    "root": binding.root,
                })
            })
            .collect::<Vec<_>>();
        let mut hosts = vec![serde_json::json!({
            "id": "local",
            "name": "Local Host",
            "agents": agents
                .iter()
                .filter(|agent| agent.enabled && agent.available)
                .map(|agent| agent.id.as_str())
                .collect::<Vec<_>>(),
            "workspaces": local_workspaces,
        })];
        hosts.extend(self.hosts.endpoints.iter().map(|endpoint| {
            serde_json::json!({
                "id": endpoint.id,
                "name": endpoint.display_name,
                "agents": agents
                    .iter()
                    .filter(|agent| agent.enabled && endpoint.agent_ids.contains(&agent.driver))
                    .map(|agent| agent.id.as_str())
                    .collect::<Vec<_>>(),
                "workspaces": endpoint.workspaces.iter().map(|workspace| serde_json::json!({
                    "id": workspace.id,
                    "alias": workspace.alias,
                    "root": workspace.root,
                })).collect::<Vec<_>>(),
            })
        }));
        serde_json::to_string_pretty(&serde_json::json!({ "hosts": hosts }))
            .unwrap_or_else(|_| "{\"hosts\":[]}".to_owned())
    }

    pub fn create_goal(
        &mut self,
        thread_id: &str,
        title: &str,
        intent: &str,
    ) -> Result<AppSnapshot, String> {
        if !self
            .conversation
            .threads
            .iter()
            .any(|thread| thread.id == thread_id)
        {
            return Err(format!("unknown Thread: {thread_id}"));
        }
        let title = required(title, "goal title")?;
        let intent = required_text(intent, "goal intent", 16_384)?;
        let id = self.allocate_id("goal");
        self.workflow.goals.push(Goal {
            id,
            thread_id: thread_id.to_owned(),
            title,
            intent,
            status: "active".to_owned(),
            progress: "No nodes yet".to_owned(),
            created_at_ms: now_millis(),
        });
        self.changed();
        Ok(self.snapshot())
    }

    pub fn browser_suggestions(
        &self,
        thread_id: Option<&str>,
        query: &str,
    ) -> Result<Vec<BrowserSuggestion>, String> {
        let query = query.trim();
        if query.len() > 2_048 {
            return Err("browser query is too long".to_owned());
        }
        let mut suggestions = Vec::new();
        if !query.is_empty() {
            if let Some(target) = normalized_remote_target(query) {
                suggestions.push(BrowserSuggestion {
                    id: "open-url".to_owned(),
                    kind: "url".to_owned(),
                    title: format!("Open {target}"),
                    detail: "Navigate in the isolated Explorer WebContents".to_owned(),
                    target,
                });
            }
            suggestions.push(BrowserSuggestion {
                id: "search-web".to_owned(),
                kind: "search".to_owned(),
                title: format!("Search for {query}"),
                detail: "Search the web with the configured provider".to_owned(),
                target: query.to_owned(),
            });
        }
        if let Some(thread_id) = thread_id {
            let thread = self
                .conversation
                .threads
                .iter()
                .find(|thread| thread.id == thread_id)
                .ok_or_else(|| format!("unknown Thread: {thread_id}"))?;
            if let Ok(entries) = self
                .files
                .entries(std::path::Path::new(&thread.workspace_path))
            {
                let query_lower = query.to_lowercase();
                for entry in entries.into_iter().take(256) {
                    let path = entry;
                    let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
                        continue;
                    };
                    if !self.files.is_file(&path)
                        || !matches!(
                            path.extension().and_then(|value| value.to_str()),
                            Some("html" | "htm")
                        )
                        || (!query_lower.is_empty() && !name.to_lowercase().contains(&query_lower))
                    {
                        continue;
                    }
                    suggestions.push(BrowserSuggestion {
                        id: format!("workspace-{name}"),
                        kind: "file".to_owned(),
                        title: name.to_owned(),
                        detail: "Preview HTML from the Thread workspace".to_owned(),
                        target: name.to_owned(),
                    });
                    if suggestions.len() >= 8 {
                        break;
                    }
                }
            }
        }
        suggestions.truncate(8);
        Ok(suggestions)
    }

    pub fn add_task(
        &mut self,
        goal_id: &str,
        title: &str,
        agent: Option<String>,
    ) -> Result<AppSnapshot, String> {
        self.goal(goal_id)?;
        let title = required(title, "task title")?;
        let selected = match agent {
            Some(agent) if !agent.trim().is_empty() => agent,
            _ => self.default_agent_for_goal(goal_id)?.to_owned(),
        };
        let thread_id = self.goal(goal_id)?.thread_id.clone();
        self.require_agent_for_thread(&thread_id, &selected)?;
        let dependency_ids = self.default_node_dependencies(goal_id);
        self.append_workflow_node(
            goal_id,
            title,
            NodeKind::Task { agent: selected },
            WorkflowNodeOptions {
                requested_host_id: None,
                requested_workspace_ids: &[],
                dependency_ids: &dependency_ids,
                created_at_ms: now_millis(),
            },
        )?;
        self.update_goal_progress(goal_id);
        self.changed();
        Ok(self.snapshot())
    }

    pub fn add_gate(&mut self, goal_id: &str, title: &str) -> Result<AppSnapshot, String> {
        self.goal(goal_id)?;
        let title = required(title, "gate title")?;
        let dependency_ids = self.default_node_dependencies(goal_id);
        self.append_workflow_node(
            goal_id,
            title,
            NodeKind::Gate,
            WorkflowNodeOptions {
                requested_host_id: None,
                requested_workspace_ids: &[],
                dependency_ids: &dependency_ids,
                created_at_ms: now_millis(),
            },
        )?;
        self.update_goal_progress(goal_id);
        self.changed();
        Ok(self.snapshot())
    }

    #[allow(clippy::too_many_lines)]
    pub fn append_workflow_node(
        &mut self,
        goal_id: &str,
        title: String,
        kind: NodeKind,
        options: WorkflowNodeOptions<'_>,
    ) -> Result<String, String> {
        let WorkflowNodeOptions {
            requested_host_id,
            requested_workspace_ids,
            dependency_ids,
            created_at_ms,
        } = options;
        let goal = self.goal(goal_id)?.clone();
        let parent = self
            .conversation
            .threads
            .iter()
            .find(|thread| thread.id == goal.thread_id)
            .cloned()
            .ok_or_else(|| format!("Goal {goal_id} has no Thread"))?;
        let host_id = requested_host_id.unwrap_or(&parent.host_id).to_owned();
        let agent = match &kind {
            NodeKind::Task { agent } => agent.clone(),
            NodeKind::Gate => parent.agent.clone(),
        };
        let resolved_agent = self.resolve_agent_for_host(&host_id, &agent)?;
        let remote = (host_id != "local")
            .then(|| {
                self.hosts
                    .endpoints
                    .iter()
                    .find(|endpoint| endpoint.id == host_id)
                    .cloned()
                    .ok_or_else(|| format!("unknown Host: {host_id}"))
            })
            .transpose()?;
        if let Some(endpoint) = &remote
            && !endpoint.agent_ids.contains(&resolved_agent.driver)
        {
            return Err(format!(
                "Agent {agent} is not available on Host {}",
                endpoint.display_name
            ));
        }

        let mut bindings = Vec::<WorkspaceBinding>::new();
        if requested_workspace_ids.is_empty() {
            for binding_id in &parent.workspace_binding_ids {
                if let Some(binding) = self
                    .inventory
                    .bindings
                    .iter()
                    .find(|binding| binding.id == *binding_id && binding.host_id == host_id)
                {
                    bindings.push(binding.clone());
                }
            }
            if bindings.is_empty()
                && let Some(endpoint) = &remote
            {
                let resource = endpoint.workspaces.first().ok_or_else(|| {
                    format!("Host {} has no granted Workspace", endpoint.display_name)
                })?;
                bindings.push(WorkspaceBinding {
                    id: String::new(),
                    thread_id: String::new(),
                    host_id: endpoint.id.clone(),
                    kind: endpoint.transport,
                    endpoint_id: Some(endpoint.id.clone()),
                    resource_id: Some(resource.id.clone()),
                    root: resource.root.clone(),
                    alias: resource.alias.clone(),
                    sort_order: 0,
                    trust: WorkspaceTrust::Restricted,
                });
            }
        } else if let Some(endpoint) = &remote {
            for (index, resource_id) in requested_workspace_ids.iter().enumerate() {
                let resource = endpoint
                    .workspaces
                    .iter()
                    .find(|workspace| workspace.id == *resource_id)
                    .ok_or_else(|| {
                        format!(
                            "Host {} does not expose Workspace {resource_id}",
                            endpoint.display_name
                        )
                    })?;
                bindings.push(WorkspaceBinding {
                    id: String::new(),
                    thread_id: String::new(),
                    host_id: endpoint.id.clone(),
                    kind: endpoint.transport,
                    endpoint_id: Some(endpoint.id.clone()),
                    resource_id: Some(resource.id.clone()),
                    root: resource.root.clone(),
                    alias: resource.alias.clone(),
                    sort_order: i32::try_from(index).unwrap_or(i32::MAX),
                    trust: WorkspaceTrust::Restricted,
                });
            }
        } else {
            for (index, binding_id) in requested_workspace_ids.iter().enumerate() {
                let binding = self
                    .inventory
                    .bindings
                    .iter()
                    .find(|binding| binding.id == *binding_id && binding.host_id == "local")
                    .cloned()
                    .ok_or_else(|| format!("unknown Local Workspace: {binding_id}"))?;
                bindings.push(WorkspaceBinding {
                    sort_order: i32::try_from(index).unwrap_or(i32::MAX),
                    ..binding
                });
            }
        }

        let workspace_path = bindings.first().map_or_else(
            || parent.workspace_path.clone(),
            |binding| binding.root.clone(),
        );
        let execution = matches!(kind, NodeKind::Task { .. }).then_some(super::NodeExecution {
            thread: Thread {
                id: String::new(),
                title: title.clone(),
                agent: agent.clone(),
                host_id,
                workspace_path,
                model_id: (agent == parent.agent).then_some(parent.model_id).flatten(),
                project_id: parent.project_id,
                workspace_binding_ids: Vec::new(),
            },
            bindings,
        });
        let node_id = self.allocate_id("node");
        let dependencies_ready = dependency_ids.iter().all(|dependency_id| {
            self.workflow.nodes.iter().any(|node| {
                node.id == *dependency_id
                    && matches!(node.status.as_str(), "succeeded" | "approved")
            })
        });
        self.workflow.nodes.push(Node {
            id: node_id.clone(),
            goal_id: goal_id.to_owned(),
            thread_id: String::new(),
            execution,
            initial_parts: Vec::new(),
            title,
            status: if matches!(kind, NodeKind::Gate) && dependencies_ready {
                "waiting"
            } else {
                "pending"
            }
            .to_owned(),
            kind,
            dependency_ids: dependency_ids.to_vec(),
            created_at_ms,
        });
        Ok(node_id)
    }

    pub fn ready_pending_tasks(&mut self, thread_id: &str) -> Vec<String> {
        let active_goal_ids = self
            .workflow
            .goals
            .iter()
            .filter(|goal| goal.thread_id == thread_id && goal.status == "active")
            .map(|goal| goal.id.clone())
            .collect::<std::collections::BTreeSet<_>>();
        let succeeded = self
            .workflow
            .nodes
            .iter()
            .filter(|node| matches!(node.status.as_str(), "succeeded" | "approved"))
            .map(|node| node.id.clone())
            .collect::<std::collections::BTreeSet<_>>();
        let mut changed = false;
        for node in &mut self.workflow.nodes {
            if active_goal_ids.contains(&node.goal_id)
                && node.kind == NodeKind::Gate
                && node.status == "pending"
                && node
                    .dependency_ids
                    .iter()
                    .all(|dependency| succeeded.contains(dependency))
            {
                "waiting".clone_into(&mut node.status);
                changed = true;
            }
        }
        for goal_id in &active_goal_ids {
            self.update_goal_progress(goal_id);
        }
        if changed {
            self.changed();
        }
        self.workflow
            .nodes
            .iter()
            .filter(|node| {
                active_goal_ids.contains(&node.goal_id)
                    && matches!(node.kind, NodeKind::Task { .. })
                    && node.status == "pending"
                    && node
                        .dependency_ids
                        .iter()
                        .all(|dependency| succeeded.contains(dependency))
            })
            .map(|node| node.id.clone())
            .collect()
    }

    #[must_use]
    pub fn workflow_parent_thread(&self, node_id: &str) -> Option<String> {
        let node = self.workflow.nodes.iter().find(|node| node.id == node_id)?;
        self.workflow
            .goals
            .iter()
            .find(|goal| goal.id == node.goal_id)
            .map(|goal| goal.thread_id.clone())
    }

    #[must_use]
    pub fn goal_has_active_tasks_for_node(&self, node_id: &str) -> bool {
        let Some(goal_id) = self
            .workflow
            .nodes
            .iter()
            .find(|node| node.id == node_id)
            .map(|node| node.goal_id.as_str())
        else {
            return false;
        };
        self.workflow.nodes.iter().any(|node| {
            node.goal_id == goal_id
                && matches!(
                    node.status.as_str(),
                    "queued" | "dispatched" | "running" | "cancelling"
                )
        })
    }

    fn default_node_dependencies(&self, goal_id: &str) -> Vec<String> {
        self.workflow
            .nodes
            .iter()
            .rev()
            .find(|node| node.goal_id == goal_id && node.status != "superseded")
            .map(|node| vec![node.id.clone()])
            .unwrap_or_default()
    }

    fn materialize_node_thread(&mut self, index: usize) -> Result<String, String> {
        let mut execution = self.workflow.nodes[index]
            .execution
            .take()
            .ok_or("Workflow Node has no execution context; replan the Workflow")?;
        let thread_id = self.allocate_id("thread");
        execution.thread.id.clone_from(&thread_id);
        for mut binding in execution.bindings {
            binding.id = self.allocate_id("binding");
            binding.thread_id.clone_from(&thread_id);
            execution
                .thread
                .workspace_binding_ids
                .push(binding.id.clone());
            self.inventory.bindings.push(binding);
        }
        self.conversation.threads.push(execution.thread);
        self.workflow.nodes[index].thread_id.clone_from(&thread_id);
        Ok(thread_id)
    }

    #[allow(clippy::too_many_lines)]
    pub fn prepare_attempt(&mut self, task_id: &str) -> Result<AttemptSpec, String> {
        let index = self
            .workflow
            .nodes
            .iter()
            .position(|node| node.id == task_id)
            .ok_or_else(|| format!("unknown Node: {task_id}"))?;
        let (goal_id, node_thread_id, agent, task_title) = match &self.workflow.nodes[index].kind {
            NodeKind::Task { agent } => (
                self.workflow.nodes[index].goal_id.clone(),
                self.workflow.nodes[index].thread_id.clone(),
                agent.clone(),
                self.workflow.nodes[index].title.clone(),
            ),
            NodeKind::Gate => return Err("a Gate cannot be delegated".to_owned()),
        };
        if !matches!(
            self.workflow.nodes[index].status.as_str(),
            "pending" | "failed" | "cancelled" | "blocked"
        ) {
            return Err("Task already has an active or successful Attempt".to_owned());
        }
        if !self.workflow.nodes[index]
            .dependency_ids
            .iter()
            .all(|dependency_id| {
                self.workflow.nodes.iter().any(|node| {
                    node.id == *dependency_id
                        && matches!(node.status.as_str(), "succeeded" | "approved")
                })
            })
        {
            return Err("Task dependencies are not complete".to_owned());
        }
        let resolved_agent = if node_thread_id.is_empty() {
            let execution = self.workflow.nodes[index]
                .execution
                .as_ref()
                .ok_or("Workflow Node has no execution context; replan the Workflow")?;
            self.resolve_agent_for_host(&execution.thread.host_id, &agent)?
        } else {
            self.resolve_agent_for_thread(&node_thread_id, &agent)?
        };
        let node_thread_id = if node_thread_id.is_empty() {
            self.materialize_node_thread(index)?
        } else {
            node_thread_id
        };
        let goal = self.goal(&goal_id)?.clone();
        let prompt = format!(
            "You are executing one Task in an observable Ovule workflow.\n\nGoal: {}\nIntent: {}\nTask: {}\n\nWork only in the provided workspace. Complete the Task, verify material changes, and finish with a concise result summary.",
            goal.title, goal.intent, task_title
        );
        let thread = self
            .conversation
            .threads
            .iter()
            .find(|thread| thread.id == node_thread_id)
            .cloned()
            .ok_or_else(|| format!("Node {} has no Thread", self.workflow.nodes[index].id))?;
        let workspace_path = thread.workspace_path.clone();
        let attempt_id = self.allocate_id("attempt");
        let source_message_id = self.allocate_id("message");
        let response_message_id = self.allocate_id("message");
        let created_at_ms = now_millis();
        "running".clone_into(&mut self.workflow.nodes[index].status);
        self.conversation.messages.push(ThreadMessage {
            id: source_message_id.clone(),
            thread_id: node_thread_id.clone(),
            role: "user".to_owned(),
            content: task_title.clone(),
            parts: vec![markdown_part(&source_message_id, task_title.clone())],
            status: "complete".to_owned(),
            stream_sequence: 0,
            created_at_ms,
            attempt_id: Some(attempt_id.clone()),
        });
        self.conversation.messages.push(ThreadMessage {
            id: response_message_id.clone(),
            thread_id: node_thread_id.clone(),
            role: "assistant".to_owned(),
            content: String::new(),
            parts: std::iter::once(markdown_part(&response_message_id, String::new()))
                .chain(self.workflow.nodes[index].initial_parts.clone())
                .collect(),
            status: "streaming".to_owned(),
            stream_sequence: 0,
            created_at_ms,
            attempt_id: Some(attempt_id.clone()),
        });
        self.conversation.attempts.push(Attempt {
            id: attempt_id.clone(),
            thread_id: node_thread_id.clone(),
            task_id: Some(task_id.to_owned()),
            source_message_id: Some(source_message_id.clone()),
            response_message_id: Some(response_message_id),
            output_sequence: 0,
            output: String::new(),
            structured_fallback: None,
            purpose: "task".to_owned(),
            agent: agent.clone(),
            host_id: thread.host_id.clone(),
            driver: Some(resolved_agent.driver.clone()),
            model_provider: resolved_agent
                .model
                .as_ref()
                .map(|model| model.provider.clone()),
            model_remote_id: resolved_agent
                .model
                .as_ref()
                .map(|model| model.remote_id.clone()),
            status: "queued".to_owned(),
            summary: "Waiting for AgentDriver".to_owned(),
            created_at_ms,
            started_at_ms: None,
            finished_at_ms: None,
            events: vec![AttemptEvent {
                kind: "attempt/created".to_owned(),
                occurred_at_ms: created_at_ms,
                detail: "Task delegated to an Agent".to_owned(),
            }],
        });
        self.update_goal_progress(&goal_id);
        self.changed();
        Ok(AttemptSpec {
            project_id: thread.project_id.clone(),
            id: attempt_id,
            thread_id: node_thread_id,
            task_id: Some(task_id.to_owned()),
            source_message_id: Some(source_message_id),
            agent,
            host_id: thread.host_id.clone(),
            prompt,
            workspace_path,
            workspaces: thread
                .workspace_binding_ids
                .iter()
                .filter_map(|id| self.workspace_binding(id))
                .filter(|binding| binding.host_id == thread.host_id)
                .collect(),
            workspace_binding_id: thread
                .workspace_binding_ids
                .iter()
                .find(|id| {
                    self.workspace_binding(id)
                        .is_some_and(|binding| binding.host_id == thread.host_id)
                })
                .cloned(),
            driver: resolved_agent.driver,
            model_provider: resolved_agent
                .model
                .as_ref()
                .map(|model| model.provider.clone()),
            model_remote_id: resolved_agent.model.map(|model| model.remote_id),
            skill_paths: resolved_agent
                .skills
                .into_iter()
                .map(|skill| skill.path)
                .collect(),
            tools: resolved_agent.tools,
            instructions: resolved_agent.instructions,
            structured_goal: false,
            local_images: Vec::new(),
        })
    }

    pub fn resolve_gate(&mut self, node_id: &str, approved: bool) -> Result<AppSnapshot, String> {
        let node = self
            .workflow
            .nodes
            .iter_mut()
            .find(|node| node.id == node_id)
            .ok_or_else(|| format!("unknown Node: {node_id}"))?;
        if node.kind != NodeKind::Gate {
            return Err("only a Gate can be resolved".to_owned());
        }
        if node.status == "pending" {
            return Err("Gate dependencies are not complete".to_owned());
        }
        if node.status != "waiting" {
            return Err("Gate has already been resolved".to_owned());
        }
        if approved { "approved" } else { "rejected" }.clone_into(&mut node.status);
        let goal_id = node.goal_id.clone();
        self.update_goal_progress(&goal_id);
        self.changed();
        Ok(self.snapshot())
    }

    pub fn reset_workflows(&mut self) -> AppSnapshot {
        let node_thread_ids = self
            .workflow
            .nodes
            .iter()
            .filter_map(|node| (!node.thread_id.is_empty()).then_some(node.thread_id.clone()))
            .collect::<std::collections::BTreeSet<_>>();
        let node_ids = self
            .workflow
            .nodes
            .iter()
            .map(|node| node.id.clone())
            .collect::<std::collections::BTreeSet<_>>();
        self.workflow.goals.clear();
        self.workflow.nodes.clear();
        self.conversation.attempts.retain(|attempt| {
            !attempt
                .task_id
                .as_ref()
                .is_some_and(|task_id| node_ids.contains(task_id))
        });
        self.conversation
            .messages
            .retain(|message| !node_thread_ids.contains(&message.thread_id));
        self.inventory
            .bindings
            .retain(|binding| !node_thread_ids.contains(&binding.thread_id));
        self.terminal
            .terminal_runs
            .retain(|run| !node_thread_ids.contains(&run.thread_id));
        self.conversation
            .threads
            .retain(|thread| !node_thread_ids.contains(&thread.id));
        self.changed();
        self.snapshot()
    }
}
