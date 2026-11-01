//! Workspace state transitions and projection DTOs. No native runtime or persistence.
pub mod capabilities;
pub mod paths;
pub use ovule_settings::catalog as settings;
#[cfg(any(test, feature = "test-support"))]
pub mod test_support;

use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Deserializer, Serialize};

use crate::state::settings::ToolRecord;

pub use projection::{
    AppSnapshot, AttemptEventView, AttemptView, BrowserSuggestion, GoalView, HostView,
    MessagePartView, NodeView, ProjectView, RemoteEndpointView, RemoteWorkspaceResourceView,
    TerminalRunView, ThreadMessageView, ThreadView, WorkspaceBindingView,
};

const MAX_STREAMED_OUTPUT_BYTES: usize = 2 * 1024 * 1024;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum NodeKind {
    Task { agent: String },
    Gate,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct Node {
    pub id: String,
    pub goal_id: String,
    #[serde(default)]
    pub thread_id: String,
    #[serde(default)]
    pub execution: Option<NodeExecution>,
    #[serde(default)]
    pub initial_parts: Vec<MessagePart>,
    pub title: String,
    pub status: String,
    pub kind: NodeKind,
    #[serde(default)]
    pub dependency_ids: Vec<String>,
    #[serde(default)]
    pub created_at_ms: i64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct NodeExecution {
    pub thread: Thread,
    pub bindings: Vec<WorkspaceBinding>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct Attempt {
    pub id: String,
    #[serde(default)]
    pub thread_id: String,
    #[serde(default)]
    pub task_id: Option<String>,
    #[serde(default)]
    pub source_message_id: Option<String>,
    #[serde(default)]
    pub response_message_id: Option<String>,
    #[serde(default)]
    pub output_sequence: u64,
    #[serde(default)]
    pub output: String,
    #[serde(default)]
    pub structured_fallback: Option<String>,
    #[serde(default = "conversation_attempt_purpose")]
    pub purpose: String,
    pub agent: String,
    #[serde(default = "local_host_id")]
    pub host_id: String,
    #[serde(default)]
    pub driver: Option<String>,
    #[serde(default)]
    pub model_provider: Option<String>,
    #[serde(default)]
    pub model_remote_id: Option<String>,
    pub status: String,
    pub summary: String,
    #[serde(default)]
    pub created_at_ms: i64,
    #[serde(default)]
    pub started_at_ms: Option<i64>,
    #[serde(default)]
    pub finished_at_ms: Option<i64>,
    #[serde(default, deserialize_with = "deserialize_attempt_events")]
    pub events: Vec<AttemptEvent>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct AttemptEvent {
    pub kind: String,
    pub occurred_at_ms: i64,
    pub detail: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AttemptSpec {
    pub project_id: Option<String>,
    pub id: String,
    pub thread_id: String,
    pub task_id: Option<String>,
    pub source_message_id: Option<String>,
    pub agent: String,
    pub host_id: String,
    pub prompt: String,
    pub workspace_path: String,
    pub workspace_binding_id: Option<String>,
    pub workspaces: Vec<WorkspaceBinding>,
    pub driver: String,
    pub model_provider: Option<String>,
    pub model_remote_id: Option<String>,
    pub skill_paths: Vec<String>,
    pub tools: Vec<ToolRecord>,
    pub instructions: String,
    pub structured_goal: bool,
    pub local_images: Vec<LocalImageAttachment>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LocalImageAttachment {
    pub id: String,
    pub name: String,
    pub media_type: String,
    pub size_bytes: i64,
    pub path: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct Thread {
    pub id: String,
    pub title: String,
    pub agent: String,
    #[serde(default = "local_host_id")]
    pub host_id: String,
    pub workspace_path: String,
    #[serde(default)]
    pub model_id: Option<String>,
    #[serde(default)]
    pub project_id: Option<String>,
    #[serde(default)]
    pub workspace_binding_ids: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ThreadMessage {
    pub id: String,
    pub thread_id: String,
    pub role: String,
    pub content: String,
    #[serde(default)]
    pub parts: Vec<MessagePart>,
    #[serde(default = "complete_message_status")]
    pub status: String,
    #[serde(default)]
    pub stream_sequence: u64,
    pub created_at_ms: i64,
    pub attempt_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct MessagePart {
    pub id: String,
    pub kind: String,
    pub text: Option<String>,
    pub url: Option<String>,
    pub name: Option<String>,
    pub media_type: Option<String>,
    pub size_bytes: Option<i64>,
    #[serde(default)]
    pub data_json: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct TerminalRun {
    pub id: String,
    pub thread_id: String,
    #[serde(default)]
    pub owner_id: Option<String>,
    pub command: String,
    pub status: String,
    pub stdout: String,
    pub stderr: String,
    pub exit_code: Option<i32>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TerminalSpec {
    pub id: String,
    pub owner_id: Option<String>,
    pub workspace_path: String,
    pub workspace_binding_id: Option<String>,
    pub command: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct Goal {
    pub id: String,
    pub thread_id: String,
    pub title: String,
    pub intent: String,
    pub status: String,
    pub progress: String,
    #[serde(default)]
    pub created_at_ms: i64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub sort_order: i32,
    #[serde(default)]
    pub created_at_ms: i64,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkspaceKind {
    Local,
    Ssh,
    Tunnel,
}

impl WorkspaceKind {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Local => "local",
            Self::Ssh => "ssh",
            Self::Tunnel => "tunnel",
        }
    }
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkspaceTrust {
    #[default]
    Restricted,
    Trusted,
}

impl WorkspaceTrust {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Restricted => "restricted",
            Self::Trusted => "trusted",
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct RemoteEndpoint {
    pub id: String,
    pub display_name: String,
    pub transport: WorkspaceKind,
    #[serde(default)]
    pub credential_ref: Option<String>,
    #[serde(default)]
    pub host: Option<String>,
    #[serde(default)]
    pub remote_id: Option<String>,
    #[serde(default)]
    pub port: Option<u16>,
    #[serde(default)]
    pub user: Option<String>,
    #[serde(default)]
    pub auth_kind: Option<String>,
    #[serde(default)]
    pub host_fingerprint: Option<String>,
    #[serde(default)]
    pub spice_websocket_url: Option<String>,
    #[serde(default)]
    pub last_seen_ms: Option<i64>,
    #[serde(default)]
    pub agent_ids: Vec<String>,
    #[serde(default)]
    pub workspaces: Vec<RemoteWorkspaceResource>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct RemoteWorkspaceResource {
    pub id: String,
    pub root: String,
    pub alias: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct WorkspaceBinding {
    pub id: String,
    pub thread_id: String,
    #[serde(default = "local_host_id")]
    pub host_id: String,
    pub kind: WorkspaceKind,
    #[serde(default)]
    pub endpoint_id: Option<String>,
    #[serde(default)]
    pub resource_id: Option<String>,
    pub root: String,
    pub alias: String,
    pub sort_order: i32,
    #[serde(default)]
    pub trust: WorkspaceTrust,
}

#[must_use]
pub fn local_host_id() -> String {
    "local".to_owned()
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Workspace {
    #[serde(skip, default = "crate::state::paths::unbound_paths")]
    files: std::sync::Arc<dyn crate::state::paths::WorkspacePaths>,
    revision: i64,
    next_id: u64,
    #[serde(flatten)]
    conversation: conversation::ConversationState,
    #[serde(flatten)]
    workflow: workflow::WorkflowState,
    #[serde(flatten)]
    terminal: terminal::TerminalState,
    #[serde(flatten)]
    inventory: workspace::WorkspaceInventory,
    #[serde(flatten)]
    hosts: hosts::HostState,
    #[serde(flatten)]
    settings: catalog::SettingsState,
}

impl Workspace {
    pub fn attach_paths(&mut self, files: std::sync::Arc<dyn crate::state::paths::WorkspacePaths>) {
        self.files = files;
    }
    pub fn attach_settings(
        &mut self,
        source: std::sync::Arc<dyn crate::state::settings::SettingsSource>,
    ) {
        self.settings.catalog.attach_source(source);
    }
}

impl Default for Workspace {
    fn default() -> Self {
        Self {
            files: crate::state::paths::unbound_paths(),
            revision: 0,
            next_id: 1,
            conversation: conversation::ConversationState::default(),
            workflow: workflow::WorkflowState::default(),
            terminal: terminal::TerminalState::default(),
            inventory: workspace::WorkspaceInventory::default(),
            hosts: hosts::HostState::default(),
            settings: catalog::SettingsState::default(),
        }
    }
}

mod catalog;
mod content;
mod conversation;
mod hosts;
mod internals;
mod projection;
mod terminal;
mod workflow;
mod workspace;

fn required(value: &str, label: &str) -> Result<String, String> {
    required_text(value, label, 256)
}

fn required_text(value: &str, label: &str, max_len: usize) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() {
        Err(format!("{label} is required"))
    } else if value.len() > max_len {
        Err(format!("{label} is too long"))
    } else {
        Ok(value.to_owned())
    }
}

fn canonical_workspace(
    files: &dyn crate::state::paths::WorkspacePaths,
    value: &str,
) -> Result<String, String> {
    let path = std::path::Path::new(value.trim());
    if value.trim().is_empty() {
        return Err("workspace path is required".to_owned());
    }
    let canonical = files
        .canonicalize(path)
        .map_err(|error| format!("resolve workspace {}: {error}", path.display()))?;
    if !files.is_directory(&canonical) {
        return Err(format!(
            "workspace is not a directory: {}",
            canonical.display()
        ));
    }
    Ok(external_path(&canonical))
}

#[must_use]
pub fn external_path(path: &std::path::Path) -> String {
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

fn generated_thread_title(response: &str) -> String {
    response
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(|line| {
            line.trim_start_matches('#')
                .trim()
                .trim_matches(['*', '_', '`'])
                .chars()
                .take(72)
                .collect::<String>()
        })
        .filter(|title| !title.is_empty())
        .unwrap_or_else(|| "New thread".to_owned())
}

fn append_bounded_stream(target: &mut String, delta: &str, maximum_bytes: usize) {
    if target.len() >= maximum_bytes {
        return;
    }
    let remaining = maximum_bytes - target.len();
    if delta.len() <= remaining {
        target.push_str(delta);
        return;
    }
    let boundary = delta
        .char_indices()
        .take_while(|(index, _)| *index < remaining)
        .map(|(index, character)| index + character.len_utf8())
        .last()
        .unwrap_or(0);
    target.push_str(&delta[..boundary]);
    target.push_str("\n\n_Output truncated by Ovule._");
}

fn normalized_remote_target(value: &str) -> Option<String> {
    let candidate = if value.starts_with("http://")
        || value.starts_with("https://")
        || value.starts_with("file://")
    {
        value.to_owned()
    } else if !value.chars().any(char::is_whitespace)
        && (value.starts_with("localhost") || value.contains('.'))
    {
        format!("https://{value}")
    } else {
        return None;
    };
    let url = url::Url::parse(&candidate).ok()?;
    ((matches!(url.scheme(), "http" | "https") && url.host_str().is_some()
        || url.scheme() == "file")
        && url.username().is_empty()
        && url.password().is_none())
    .then(|| url.to_string())
}

fn thread_view(thread: &Thread) -> ThreadView {
    ThreadView {
        id: thread.id.clone(),
        title: thread.title.clone(),
        agent: thread.agent.clone(),
        host_id: thread.host_id.clone(),
        workspace_path: thread.workspace_path.clone(),
        model_id: thread.model_id.clone(),
        project_id: thread.project_id.clone(),
        workspace_binding_ids: thread.workspace_binding_ids.clone(),
    }
}

fn host_views(
    endpoints: &[RemoteEndpoint],
    bindings: &[WorkspaceBinding],
    agents: &[crate::state::settings::AgentView],
) -> Vec<HostView> {
    let local_agents = agents
        .iter()
        .filter(|agent| agent.enabled)
        .map(|agent| agent.id.clone())
        .collect::<Vec<_>>();
    std::iter::once(HostView {
        id: "local".to_owned(),
        display_name: "Local Host".to_owned(),
        kind: "local".to_owned(),
        connector: "in_process".to_owned(),
        status: "ready".to_owned(),
        agent_ids: local_agents,
    })
    .chain(
        endpoints
            .iter()
            .filter(|endpoint| {
                bindings
                    .iter()
                    .any(|binding| binding.host_id == endpoint.id)
            })
            .map(|endpoint| {
                let mut agent_ids = agents
                    .iter()
                    .filter(|agent| agent.enabled && endpoint.agent_ids.contains(&agent.driver))
                    .map(|agent| agent.id.clone())
                    .collect::<Vec<_>>();
                agent_ids.extend(
                    endpoint
                        .agent_ids
                        .iter()
                        .filter(|driver| {
                            !agents.iter().any(|agent| {
                                agent.enabled && agent.driver.as_str() == driver.as_str()
                            })
                        })
                        .cloned(),
                );
                agent_ids.sort();
                agent_ids.dedup();
                HostView {
                    id: endpoint.id.clone(),
                    display_name: endpoint.display_name.clone(),
                    kind: "remote".to_owned(),
                    connector: endpoint.transport.as_str().to_owned(),
                    status: if endpoint.last_seen_ms.is_some() {
                        "ready".to_owned()
                    } else {
                        "available".to_owned()
                    },
                    agent_ids,
                }
            }),
    )
    .collect()
}

fn agent_views(
    local_agents: &[crate::state::settings::AgentView],
    endpoints: &[RemoteEndpoint],
) -> Vec<crate::state::settings::AgentView> {
    let mut agents = local_agents.to_vec();
    let mut remote_drivers = endpoints
        .iter()
        .flat_map(|endpoint| endpoint.agent_ids.iter())
        .filter(|driver| {
            !local_agents
                .iter()
                .any(|agent| agent.id.as_str() == driver.as_str())
        })
        .cloned()
        .collect::<Vec<_>>();
    remote_drivers.sort();
    remote_drivers.dedup();
    agents.extend(
        remote_drivers
            .into_iter()
            .map(|driver| crate::state::settings::AgentView {
                id: driver.clone(),
                label: driver.clone(),
                driver,
                available: true,
                enabled: true,
                detail: "Available on a remote Host".to_owned(),
                model_id: None,
                skill_ids: Vec::new(),
                tool_ids: Vec::new(),
                instructions: String::new(),
                extension_id: None,
            }),
    );
    agents
}

fn project_view(project: &Project) -> ProjectView {
    ProjectView {
        id: project.id.clone(),
        name: project.name.clone(),
        sort_order: project.sort_order,
        created_at_ms: project.created_at_ms,
    }
}

fn remote_endpoint_view(endpoint: &RemoteEndpoint) -> RemoteEndpointView {
    RemoteEndpointView {
        id: endpoint.id.clone(),
        display_name: endpoint.display_name.clone(),
        transport: endpoint.transport.as_str().to_owned(),
        host: endpoint.host.clone(),
        remote_id: endpoint.remote_id.clone(),
        port: endpoint.port,
        user: endpoint.user.clone(),
        auth_kind: endpoint.auth_kind.clone(),
        host_fingerprint: endpoint.host_fingerprint.clone(),
        spice_websocket_url: endpoint.spice_websocket_url.clone(),
        last_seen_ms: endpoint.last_seen_ms,
        agent_ids: endpoint.agent_ids.clone(),
        workspaces: endpoint
            .workspaces
            .iter()
            .map(|workspace| RemoteWorkspaceResourceView {
                id: workspace.id.clone(),
                root: workspace.root.clone(),
                alias: workspace.alias.clone(),
            })
            .collect(),
    }
}

fn workspace_binding_view(binding: &WorkspaceBinding) -> WorkspaceBindingView {
    WorkspaceBindingView {
        id: binding.id.clone(),
        thread_id: binding.thread_id.clone(),
        host_id: binding.host_id.clone(),
        kind: binding.kind.as_str().to_owned(),
        endpoint_id: binding.endpoint_id.clone(),
        resource_id: binding.resource_id.clone(),
        root: binding.root.clone(),
        alias: binding.alias.clone(),
        sort_order: binding.sort_order,
        trust: binding.trust.as_str().to_owned(),
    }
}

fn message_view(message: &ThreadMessage) -> ThreadMessageView {
    let parts = if message.parts.is_empty() {
        vec![markdown_part(&message.id, message.content.clone())]
    } else {
        message.parts.clone()
    };
    ThreadMessageView {
        id: message.id.clone(),
        thread_id: message.thread_id.clone(),
        role: message.role.clone(),
        content: message.content.clone(),
        parts: parts.iter().map(message_part_view).collect(),
        status: message.status.clone(),
        stream_sequence: i64::try_from(message.stream_sequence).unwrap_or(i64::MAX),
        created_at_ms: message.created_at_ms,
        attempt_id: message.attempt_id.clone(),
    }
}

fn message_part_view(part: &MessagePart) -> MessagePartView {
    MessagePartView {
        id: part.id.clone(),
        kind: part.kind.clone(),
        text: part.text.clone(),
        url: part.url.clone(),
        name: part.name.clone(),
        media_type: part.media_type.clone(),
        size_bytes: part.size_bytes,
        data_json: part.data_json.clone(),
    }
}

fn markdown_part(message_id: &str, text: String) -> MessagePart {
    MessagePart {
        id: format!("{message_id}-markdown"),
        kind: "markdown".to_owned(),
        text: Some(text),
        url: None,
        name: None,
        media_type: Some("text/markdown".to_owned()),
        size_bytes: None,
        data_json: None,
    }
}

fn complete_message_status() -> String {
    "complete".to_owned()
}

fn conversation_attempt_purpose() -> String {
    "conversation".to_owned()
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct DerivedGoal {
    title: String,
    intent: String,
    response: String,
    #[serde(default)]
    nodes: Vec<DerivedNode>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DerivedNode {
    #[serde(default)]
    id: Option<String>,
    kind: String,
    title: String,
    #[serde(default)]
    agent: Option<String>,
    #[serde(default)]
    host: Option<String>,
    #[serde(default)]
    workspaces: Vec<String>,
    #[serde(default)]
    depends_on: Option<Vec<String>>,
}

fn parse_goal_derivation(value: &str, require_nodes: bool) -> Result<DerivedGoal, String> {
    let payloads = structured_object_payloads(value)?;
    let mut last_error = None;
    for payload in payloads.into_iter().rev() {
        match parse_goal_payload(payload)
            .and_then(|goal| validate_derived_goal(goal, require_nodes))
        {
            Ok(goal) => return Ok(goal),
            Err(error) => last_error = Some(error),
        }
    }
    Err(last_error.unwrap_or_else(|| "structured response has no valid Goal object".to_owned()))
}

fn parse_goal_payload(payload: &str) -> Result<DerivedGoal, String> {
    let goal = match serde_json::from_str::<DerivedGoal>(payload) {
        Ok(goal) => goal,
        Err(strict_error) => match json5::from_str::<DerivedGoal>(payload) {
            Ok(goal) => goal,
            Err(permissive_error) => {
                let normalized = normalize_single_quoted_object(payload).map_err(|normal_error| {
                    format!("invalid structured response: {strict_error}; JSON5 fallback: {permissive_error}; single-quote normalization: {normal_error}")
                })?;
                serde_json::from_str(&normalized).map_err(|normal_error| {
                    format!("invalid structured response: {strict_error}; JSON5 fallback: {permissive_error}; normalized JSON: {normal_error}")
                })?
            }
        },
    };
    Ok(goal)
}

fn validate_derived_goal(
    mut goal: DerivedGoal,
    require_nodes: bool,
) -> Result<DerivedGoal, String> {
    goal.title = bounded_derived_title(&goal.title, "derived Goal title", 256)?;
    goal.intent = required_text(&goal.intent, "derived Goal intent", 16_384)?;
    goal.response = required_text(&goal.response, "derived Goal response", 65_536)?;
    if (require_nodes && goal.nodes.is_empty()) || goal.nodes.len() > 64 {
        return Err(if require_nodes {
            "derived Workflow must contain 1-64 nodes".to_owned()
        } else {
            "derived Workflow must contain at most 64 nodes".to_owned()
        });
    }
    for node in &mut goal.nodes {
        if !matches!(node.kind.as_str(), "task" | "gate") {
            return Err("derived Node kind must be task or gate".to_owned());
        }
        node.title = bounded_derived_title(&node.title, "derived Node title", 256)?;
        node.agent = node
            .agent
            .take()
            .map(|value| required(&value, "derived Node Agent"))
            .transpose()?;
        node.host = node
            .host
            .take()
            .map(|value| required(&value, "derived Node Host"))
            .transpose()?;
        let mut workspace_ids = std::collections::BTreeSet::new();
        for workspace_id in &mut node.workspaces {
            *workspace_id = required(workspace_id, "derived Node Workspace")?;
            if !workspace_ids.insert(workspace_id.clone()) {
                return Err(format!("duplicate derived Node Workspace: {workspace_id}"));
            }
        }
    }
    let mut logical_ids = std::collections::BTreeSet::new();
    for (index, node) in goal.nodes.iter_mut().enumerate() {
        let logical_id = node
            .id
            .take()
            .unwrap_or_else(|| format!("node-{}", index + 1));
        let logical_id = required(&logical_id, "derived Node id")?;
        if !logical_ids.insert(logical_id.clone()) {
            return Err(format!("duplicate derived Node id: {logical_id}"));
        }
        node.id = Some(logical_id);
    }
    for index in 0..goal.nodes.len() {
        let default_dependency = index
            .checked_sub(1)
            .and_then(|previous| goal.nodes[previous].id.clone())
            .into_iter()
            .collect::<Vec<_>>();
        let dependencies = goal.nodes[index]
            .depends_on
            .take()
            .unwrap_or(default_dependency);
        let mut unique = std::collections::BTreeSet::new();
        for dependency in &dependencies {
            if !logical_ids.contains(dependency) || !unique.insert(dependency.clone()) {
                return Err(format!("invalid derived Node dependency: {dependency}"));
            }
            let dependency_index = goal
                .nodes
                .iter()
                .position(|node| node.id.as_deref() == Some(dependency));
            if dependency_index.is_none_or(|dependency_index| dependency_index >= index) {
                return Err(format!(
                    "derived Node dependencies must reference earlier nodes: {dependency}"
                ));
            }
        }
        goal.nodes[index].depends_on = Some(dependencies);
    }
    Ok(goal)
}

fn normalize_single_quoted_object(value: &str) -> Result<String, String> {
    let characters = value.chars().collect::<Vec<_>>();
    let mut output = String::with_capacity(value.len());
    let mut index = 0;
    let mut quote = None;
    while index < characters.len() {
        let character = characters[index];
        match quote {
            None if matches!(character, '\'' | '"') => {
                quote = Some(character);
                output.push('"');
            }
            Some(delimiter) if character == '\\' => {
                let next = characters
                    .get(index + 1)
                    .copied()
                    .ok_or_else(|| "trailing string escape".to_owned())?;
                if delimiter == '\'' && next == '\'' {
                    output.push('\'');
                } else {
                    output.push('\\');
                    output.push(next);
                }
                index += 1;
            }
            Some(delimiter) if character == delimiter => {
                let next = characters[index + 1..]
                    .iter()
                    .find(|candidate| !candidate.is_whitespace())
                    .copied();
                if delimiter == '"' || next.is_none_or(|next| matches!(next, ':' | ',' | '}' | ']'))
                {
                    output.push('"');
                    quote = None;
                } else {
                    output.push('\'');
                }
            }
            Some(_) if character == '"' => output.push_str("\\\""),
            None | Some(_) => output.push(character),
        }
        index += 1;
    }
    if quote.is_some() {
        return Err("unterminated quoted string".to_owned());
    }
    Ok(output)
}

fn structured_object_payloads(value: &str) -> Result<Vec<&str>, String> {
    let mut payloads = Vec::new();
    let mut start = None;
    let mut depth = 0_usize;
    let mut quote = None;
    let mut escaped = false;
    for (index, character) in value.char_indices() {
        if depth == 0 {
            if character == '{' {
                start = Some(index);
                depth = 1;
            }
            continue;
        }
        if let Some(delimiter) = quote {
            if escaped {
                escaped = false;
            } else if character == '\\' {
                escaped = true;
            } else if character == delimiter {
                let closes_string = delimiter == '"'
                    || value[index + character.len_utf8()..]
                        .chars()
                        .find(|candidate| !candidate.is_whitespace())
                        .is_none_or(|next| matches!(next, ':' | ',' | '}' | ']'));
                if closes_string {
                    quote = None;
                }
            }
            continue;
        }
        match character {
            '"' | '\'' => quote = Some(character),
            '{' => depth += 1,
            '}' => {
                depth -= 1;
                if depth == 0 {
                    let start = start.take().expect("balanced object has a start");
                    payloads.push(&value[start..index + character.len_utf8()]);
                }
            }
            _ => {}
        }
    }
    if depth != 0 {
        return Err("structured response has an unclosed object".to_owned());
    }
    if payloads.is_empty() {
        return Err("structured response has no object".to_owned());
    }
    Ok(payloads)
}

fn bounded_derived_title(value: &str, label: &str, max_chars: usize) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() {
        return Err(format!("{label} is required"));
    }
    if value.chars().count() <= max_chars {
        return Ok(value.to_owned());
    }
    let mut truncated = value
        .chars()
        .take(max_chars.saturating_sub(1))
        .collect::<String>();
    truncated.push('…');
    Ok(truncated)
}

fn goal_view(goal: &Goal) -> GoalView {
    GoalView {
        id: goal.id.clone(),
        thread_id: goal.thread_id.clone(),
        title: goal.title.clone(),
        intent: goal.intent.clone(),
        status: goal.status.clone(),
        progress: goal.progress.clone(),
        created_at_ms: goal.created_at_ms,
    }
}

fn node_view(node: &Node, threads: &[Thread]) -> NodeView {
    let (kind, agent) = match &node.kind {
        NodeKind::Task { agent } => ("task", Some(agent.clone())),
        NodeKind::Gate => ("gate", None),
    };
    NodeView {
        id: node.id.clone(),
        goal_id: node.goal_id.clone(),
        thread_id: node.thread_id.clone(),
        kind: kind.to_owned(),
        title: node.title.clone(),
        status: node.status.clone(),
        agent,
        dependency_ids: node.dependency_ids.clone(),
        host_id: threads
            .iter()
            .find(|thread| thread.id == node.thread_id)
            .map_or_else(
                || {
                    node.execution
                        .as_ref()
                        .map_or_else(local_host_id, |execution| execution.thread.host_id.clone())
                },
                |thread| thread.host_id.clone(),
            ),
        workspace_binding_ids: threads
            .iter()
            .find(|thread| thread.id == node.thread_id)
            .map_or_else(Vec::new, |thread| thread.workspace_binding_ids.clone()),
        created_at_ms: node.created_at_ms,
    }
}

fn attempt_view(attempt: &Attempt) -> AttemptView {
    AttemptView {
        id: attempt.id.clone(),
        thread_id: attempt.thread_id.clone(),
        task_id: attempt.task_id.clone(),
        source_message_id: attempt.source_message_id.clone(),
        response_message_id: attempt.response_message_id.clone(),
        purpose: attempt.purpose.clone(),
        agent: attempt.agent.clone(),
        host_id: attempt.host_id.clone(),
        driver: attempt.driver.clone(),
        model_provider: attempt.model_provider.clone(),
        model_remote_id: attempt.model_remote_id.clone(),
        status: attempt.status.clone(),
        summary: attempt.summary.clone(),
        output: attempt.output.clone(),
        output_sequence: i64::try_from(attempt.output_sequence).unwrap_or(i64::MAX),
        created_at_ms: attempt.created_at_ms,
        started_at_ms: attempt.started_at_ms,
        finished_at_ms: attempt.finished_at_ms,
        duration_ms: attempt.finished_at_ms.and_then(|finished| {
            let started = attempt.started_at_ms.unwrap_or(attempt.created_at_ms);
            u32::try_from(finished.saturating_sub(started))
                .ok()
                .map(f64::from)
        }),
        events: attempt
            .events
            .iter()
            .map(|event| AttemptEventView {
                kind: event.kind.clone(),
                occurred_at_ms: event.occurred_at_ms,
                detail: event.detail.clone(),
            })
            .collect(),
    }
}

fn terminal_run_view(run: &TerminalRun) -> TerminalRunView {
    TerminalRunView {
        id: run.id.clone(),
        thread_id: run.thread_id.clone(),
        owner_id: run.owner_id.clone(),
        command: run.command.clone(),
        status: run.status.clone(),
        stdout: run.stdout.clone(),
        stderr: run.stderr.clone(),
        exit_code: run.exit_code.map(f64::from),
    }
}

fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|duration| i64::try_from(duration.as_millis()).ok())
        .unwrap_or_default()
}

fn deserialize_attempt_events<'de, D>(deserializer: D) -> Result<Vec<AttemptEvent>, D::Error>
where
    D: Deserializer<'de>,
{
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum StoredEvent {
        Current(AttemptEvent),
        Legacy(String),
    }

    Vec::<StoredEvent>::deserialize(deserializer).map(|events| {
        events
            .into_iter()
            .map(|event| match event {
                StoredEvent::Current(event) => event,
                StoredEvent::Legacy(kind) => AttemptEvent {
                    kind,
                    occurred_at_ms: 0,
                    detail: "Imported from an earlier Ovule prototype".to_owned(),
                },
            })
            .collect()
    })
}

#[cfg(test)]
mod tests;
