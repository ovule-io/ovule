use crate::state::capabilities::{CapabilityView, LegacyDataIssueView};
use crate::state::settings::{AgentView, ModelView, SkillView, ToolView};

#[derive(Clone, Debug, PartialEq)]
pub struct AppSnapshot {
    pub revision: i64,
    pub agents: Vec<AgentView>,
    pub skills: Vec<SkillView>,
    pub tools: Vec<ToolView>,
    pub capabilities: Vec<CapabilityView>,
    pub legacy_data_issues: Vec<LegacyDataIssueView>,
    pub models: Vec<ModelView>,
    pub projects: Vec<ProjectView>,
    pub hosts: Vec<HostView>,
    pub endpoints: Vec<RemoteEndpointView>,
    pub bindings: Vec<WorkspaceBindingView>,
    pub threads: Vec<ThreadView>,
    pub messages: Vec<ThreadMessageView>,
    pub goals: Vec<GoalView>,
    pub nodes: Vec<NodeView>,
    pub attempts: Vec<AttemptView>,
    pub terminal_runs: Vec<TerminalRunView>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BrowserSuggestion {
    pub id: String,
    pub kind: String,
    pub title: String,
    pub detail: String,
    pub target: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ThreadView {
    pub id: String,
    pub title: String,
    pub agent: String,
    pub host_id: String,
    pub workspace_path: String,
    pub model_id: Option<String>,
    pub project_id: Option<String>,
    pub workspace_binding_ids: Vec<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct HostView {
    pub id: String,
    pub display_name: String,
    pub kind: String,
    pub connector: String,
    pub status: String,
    pub agent_ids: Vec<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProjectView {
    pub id: String,
    pub name: String,
    pub sort_order: i32,
    pub created_at_ms: i64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RemoteEndpointView {
    pub id: String,
    pub display_name: String,
    pub transport: String,
    pub host: Option<String>,
    pub remote_id: Option<String>,
    pub port: Option<u16>,
    pub user: Option<String>,
    pub auth_kind: Option<String>,
    pub host_fingerprint: Option<String>,
    pub spice_websocket_url: Option<String>,
    pub last_seen_ms: Option<i64>,
    pub agent_ids: Vec<String>,
    pub workspaces: Vec<RemoteWorkspaceResourceView>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RemoteWorkspaceResourceView {
    pub id: String,
    pub root: String,
    pub alias: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WorkspaceBindingView {
    pub id: String,
    pub thread_id: String,
    pub host_id: String,
    pub kind: String,
    pub endpoint_id: Option<String>,
    pub resource_id: Option<String>,
    pub root: String,
    pub alias: String,
    pub sort_order: i32,
    pub trust: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ThreadMessageView {
    pub id: String,
    pub thread_id: String,
    pub role: String,
    pub content: String,
    pub parts: Vec<MessagePartView>,
    pub status: String,
    pub stream_sequence: i64,
    pub created_at_ms: i64,
    pub attempt_id: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MessagePartView {
    pub id: String,
    pub kind: String,
    pub text: Option<String>,
    pub url: Option<String>,
    pub name: Option<String>,
    pub media_type: Option<String>,
    pub size_bytes: Option<i64>,
    pub data_json: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GoalView {
    pub id: String,
    pub thread_id: String,
    pub title: String,
    pub intent: String,
    pub status: String,
    pub progress: String,
    pub created_at_ms: i64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct NodeView {
    pub id: String,
    pub goal_id: String,
    pub thread_id: String,
    pub kind: String,
    pub title: String,
    pub status: String,
    pub agent: Option<String>,
    pub dependency_ids: Vec<String>,
    pub host_id: String,
    pub workspace_binding_ids: Vec<String>,
    pub created_at_ms: i64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct AttemptView {
    pub id: String,
    pub thread_id: String,
    pub task_id: Option<String>,
    pub source_message_id: Option<String>,
    pub response_message_id: Option<String>,
    pub purpose: String,
    pub agent: String,
    pub host_id: String,
    pub driver: Option<String>,
    pub model_provider: Option<String>,
    pub model_remote_id: Option<String>,
    pub status: String,
    pub summary: String,
    pub output: String,
    pub output_sequence: i64,
    pub created_at_ms: i64,
    pub started_at_ms: Option<i64>,
    pub finished_at_ms: Option<i64>,
    pub duration_ms: Option<f64>,
    pub events: Vec<AttemptEventView>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AttemptEventView {
    pub kind: String,
    pub occurred_at_ms: i64,
    pub detail: String,
}

#[derive(Clone, Debug, PartialEq)]
pub struct TerminalRunView {
    pub id: String,
    pub thread_id: String,
    pub owner_id: Option<String>,
    pub command: String,
    pub status: String,
    pub stdout: String,
    pub stderr: String,
    pub exit_code: Option<f64>,
}
