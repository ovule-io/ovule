use std::sync::Arc;

use crate::conversation::{ConversationIngress, WorkerEvent, WorkerEventCallback};
use crate::state::AppSnapshot;
use crate::workspace::{MutationError, WorkspaceEventSink, WorkspaceSession};

#[derive(Debug)]
pub enum WorkflowServiceError {
    InvalidArgument(String),
    Persistence(String),
}

pub(super) struct NativeWorkflowService {
    state: Arc<WorkspaceSession>,
    events: Arc<dyn WorkspaceEventSink>,
    conversations: Arc<dyn ConversationIngress>,
}

impl NativeWorkflowService {
    #[must_use]
    pub fn new(
        state: Arc<WorkspaceSession>,
        events: Arc<dyn WorkspaceEventSink>,
        conversations: Arc<dyn ConversationIngress>,
    ) -> Self {
        Self {
            state,
            events,
            conversations,
        }
    }

    pub fn advance(&self, thread_id: &str) -> Result<AppSnapshot, WorkflowServiceError> {
        dispatch_ready_tasks(&self.state, &self.events, &self.conversations, thread_id)?;
        Ok(self.snapshot())
    }

    pub fn create_goal(
        &self,
        thread_id: &str,
        title: &str,
        intent: &str,
    ) -> Result<AppSnapshot, WorkflowServiceError> {
        self.change(
            "goal/created",
            Some(thread_id),
            &serde_json::json!({"title": title}),
            |workspace| workspace.create_goal(thread_id, title, intent),
        )
    }

    pub fn add_task(
        &self,
        goal_id: &str,
        title: &str,
        agent: Option<String>,
    ) -> Result<AppSnapshot, WorkflowServiceError> {
        self.change(
            "workflow/task-added",
            Some(goal_id),
            &serde_json::json!({"title": title, "agent": agent}),
            |workspace| workspace.add_task(goal_id, title, agent),
        )
    }

    pub fn add_gate(
        &self,
        goal_id: &str,
        title: &str,
    ) -> Result<AppSnapshot, WorkflowServiceError> {
        self.change(
            "workflow/gate-added",
            Some(goal_id),
            &serde_json::json!({"title": title}),
            |workspace| workspace.add_gate(goal_id, title),
        )
    }

    pub fn dispatch(&self, task_id: &str) -> Result<AppSnapshot, WorkflowServiceError> {
        prepare_and_spawn_task(
            Arc::clone(&self.state),
            Arc::clone(&self.events),
            Arc::clone(&self.conversations),
            task_id,
        )?;
        Ok(self.snapshot())
    }

    pub fn resolve_gate(
        &self,
        node_id: &str,
        approved: bool,
    ) -> Result<AppSnapshot, WorkflowServiceError> {
        self.change(
            if approved {
                "gate/approved"
            } else {
                "gate/rejected"
            },
            Some(node_id),
            &serde_json::json!({"approved": approved}),
            |workspace| workspace.resolve_gate(node_id, approved),
        )?;
        if approved {
            advance_node(&self.state, &self.events, &self.conversations, node_id)?;
            return Ok(self.snapshot());
        }
        request_dynamic_replan(
            Arc::clone(&self.state),
            Arc::clone(&self.events),
            Arc::clone(&self.conversations),
            node_id,
            if approved { "approved" } else { "rejected" },
            if approved {
                "The user approved the Gate"
            } else {
                "The user rejected the Gate"
            },
        )?;
        Ok(self.snapshot())
    }

    pub fn reset_workflows(&self) -> Result<AppSnapshot, WorkflowServiceError> {
        self.change(
            "workflow/data-reset",
            None,
            &serde_json::json!({}),
            |workspace| Ok(workspace.reset_workflows()),
        )
    }

    fn change(
        &self,
        kind: &str,
        subject_id: Option<&str>,
        payload: &serde_json::Value,
        operation: impl FnOnce(&mut crate::state::Workspace) -> Result<AppSnapshot, String>,
    ) -> Result<AppSnapshot, WorkflowServiceError> {
        let snapshot = self
            .state
            .transact(kind, subject_id, payload, operation)
            .map_err(map_mutation_error)?;
        self.events.revision_changed(snapshot.revision);
        Ok(snapshot)
    }

    fn snapshot(&self) -> AppSnapshot {
        self.state.read(crate::state::Workspace::snapshot)
    }
}

#[allow(clippy::needless_pass_by_value)] // Owned Arcs are cloned into the asynchronous observer.
fn prepare_and_spawn_task(
    state: Arc<WorkspaceSession>,
    events: Arc<dyn WorkspaceEventSink>,
    conversations: Arc<dyn ConversationIngress>,
    task_id: &str,
) -> Result<(), WorkflowServiceError> {
    let spec = state
        .transact(
            "attempt/created",
            Some(task_id),
            &serde_json::json!({}),
            |workspace| workspace.prepare_attempt(task_id),
        )
        .map_err(map_mutation_error)?;
    events.revision_changed(state.read(crate::state::Workspace::revision));
    let observer_task_id = task_id.to_owned();
    let observer_state = Arc::clone(&state);
    let observer_events = Arc::clone(&events);
    let observer_conversations = Arc::clone(&conversations);
    let observer: WorkerEventCallback = Arc::new(move |event| {
        let WorkerEvent::Finished(outcome) = event else {
            return;
        };
        if !matches!(outcome.status.as_str(), "succeeded" | "failed") {
            return;
        }
        if outcome.status == "succeeded" {
            if let Err(error) = advance_node(
                &observer_state,
                &observer_events,
                &observer_conversations,
                &observer_task_id,
            ) {
                tracing::error!(?error, task_id = observer_task_id, "advance Workflow");
            }
            return;
        }
        if observer_state
            .read(|workspace| workspace.goal_has_active_tasks_for_node(&observer_task_id))
        {
            return;
        }
        if let Err(error) = request_dynamic_replan(
            Arc::clone(&observer_state),
            Arc::clone(&observer_events),
            Arc::clone(&observer_conversations),
            &observer_task_id,
            &outcome.status,
            &outcome.summary,
        ) {
            tracing::error!(
                ?error,
                task_id = observer_task_id,
                "prepare dynamic Workflow replan"
            );
        }
    });
    if let Err(error) = conversations.spawn_attempt(&spec, Some(observer)) {
        let summary = error.clone();
        let (snapshot, applied) = state
            .finish_attempt(&spec.id, "failed", error)
            .map_err(map_mutation_error)?;
        if !applied {
            return Ok(());
        }
        events.revision_changed(snapshot.revision);
        request_dynamic_replan(
            Arc::clone(&state),
            Arc::clone(&events),
            Arc::clone(&conversations),
            task_id,
            "failed",
            &summary,
        )?;
    }
    Ok(())
}

#[allow(clippy::needless_pass_by_value)] // Owned Arcs are cloned into the asynchronous observer.
fn request_dynamic_replan(
    state: Arc<WorkspaceSession>,
    events: Arc<dyn WorkspaceEventSink>,
    conversations: Arc<dyn ConversationIngress>,
    node_id: &str,
    outcome_status: &str,
    outcome_summary: &str,
) -> Result<(), WorkflowServiceError> {
    let spec = state
        .transact(
            "workflow/replan-requested",
            Some(node_id),
            &serde_json::json!({"status": outcome_status}),
            |workspace| workspace.prepare_workflow_replan(node_id, outcome_status, outcome_summary),
        )
        .map_err(map_mutation_error)?;
    events.revision_changed(state.read(crate::state::Workspace::revision));
    let observer = planning_completion_observer(
        Arc::clone(&state),
        Arc::clone(&events),
        Arc::clone(&conversations),
        spec.thread_id.clone(),
    );
    if let Err(error) = conversations.spawn_attempt(&spec, Some(observer)) {
        let (snapshot, applied) = state
            .finish_attempt(&spec.id, "failed", error)
            .map_err(map_mutation_error)?;
        if applied {
            events.revision_changed(snapshot.revision);
        }
    }
    Ok(())
}

#[must_use]
pub fn planning_completion_observer(
    state: Arc<WorkspaceSession>,
    events: Arc<dyn WorkspaceEventSink>,
    conversations: Arc<dyn ConversationIngress>,
    thread_id: String,
) -> WorkerEventCallback {
    Arc::new(move |event| {
        let WorkerEvent::Finished(outcome) = event else {
            return;
        };
        if outcome.status != "succeeded" {
            return;
        }
        if let Err(error) = dispatch_ready_tasks(&state, &events, &conversations, &thread_id) {
            tracing::error!(?error, thread_id, "advance dynamically planned Workflow");
        }
    })
}

fn advance_node(
    state: &Arc<WorkspaceSession>,
    events: &Arc<dyn WorkspaceEventSink>,
    conversations: &Arc<dyn ConversationIngress>,
    node_id: &str,
) -> Result<(), WorkflowServiceError> {
    let thread_id = state
        .read(|workspace| workspace.workflow_parent_thread(node_id))
        .ok_or_else(|| {
            WorkflowServiceError::InvalidArgument("Workflow Node not found".to_owned())
        })?;
    dispatch_ready_tasks(state, events, conversations, &thread_id)
}

fn dispatch_ready_tasks(
    state: &Arc<WorkspaceSession>,
    events: &Arc<dyn WorkspaceEventSink>,
    conversations: &Arc<dyn ConversationIngress>,
    thread_id: &str,
) -> Result<(), WorkflowServiceError> {
    let task_ids = state
        .transact(
            "workflow/ready",
            Some(thread_id),
            &serde_json::json!({}),
            |workspace| Ok(workspace.ready_pending_tasks(thread_id)),
        )
        .map_err(map_mutation_error)?;
    // A ready Gate changes state even when there are no ready Tasks.
    events.revision_changed(state.read(crate::state::Workspace::revision));
    for task_id in task_ids {
        prepare_and_spawn_task(
            Arc::clone(state),
            Arc::clone(events),
            Arc::clone(conversations),
            &task_id,
        )?;
    }
    Ok(())
}

fn map_mutation_error(error: MutationError) -> WorkflowServiceError {
    match error {
        MutationError::Domain(message) => WorkflowServiceError::InvalidArgument(message),
        MutationError::Repository(message) => WorkflowServiceError::Persistence(message),
    }
}

pub trait Workflow: Send + Sync {
    fn advance(&self, thread_id: &str) -> Result<AppSnapshot, WorkflowServiceError>;
    fn create_goal(
        &self,
        thread_id: &str,
        title: &str,
        intent: &str,
    ) -> Result<AppSnapshot, WorkflowServiceError>;
    fn add_task(
        &self,
        goal_id: &str,
        title: &str,
        agent: Option<String>,
    ) -> Result<AppSnapshot, WorkflowServiceError>;
    fn add_gate(&self, goal_id: &str, title: &str) -> Result<AppSnapshot, WorkflowServiceError>;
    fn dispatch(&self, task_id: &str) -> Result<AppSnapshot, WorkflowServiceError>;
    fn resolve_gate(
        &self,
        node_id: &str,
        approved: bool,
    ) -> Result<AppSnapshot, WorkflowServiceError>;
    fn reset_workflows(&self) -> Result<AppSnapshot, WorkflowServiceError>;
}

/// Typed identity consumed by shells and domain factories.
pub type WorkflowService = tuffite_ioc::Service<dyn Workflow>;

impl Workflow for NativeWorkflowService {
    fn advance(&self, thread_id: &str) -> Result<AppSnapshot, WorkflowServiceError> {
        NativeWorkflowService::advance(self, thread_id)
    }
    fn create_goal(
        &self,
        thread_id: &str,
        title: &str,
        intent: &str,
    ) -> Result<AppSnapshot, WorkflowServiceError> {
        NativeWorkflowService::create_goal(self, thread_id, title, intent)
    }
    fn add_task(
        &self,
        goal_id: &str,
        title: &str,
        agent: Option<String>,
    ) -> Result<AppSnapshot, WorkflowServiceError> {
        NativeWorkflowService::add_task(self, goal_id, title, agent)
    }
    fn add_gate(&self, goal_id: &str, title: &str) -> Result<AppSnapshot, WorkflowServiceError> {
        NativeWorkflowService::add_gate(self, goal_id, title)
    }
    fn dispatch(&self, task_id: &str) -> Result<AppSnapshot, WorkflowServiceError> {
        NativeWorkflowService::dispatch(self, task_id)
    }
    fn resolve_gate(
        &self,
        node_id: &str,
        approved: bool,
    ) -> Result<AppSnapshot, WorkflowServiceError> {
        NativeWorkflowService::resolve_gate(self, node_id, approved)
    }
    fn reset_workflows(&self) -> Result<AppSnapshot, WorkflowServiceError> {
        NativeWorkflowService::reset_workflows(self)
    }
}

/// Supplies planning completion callbacks to conversation without a reverse crate dependency.
pub(crate) struct PlanningObservers {
    state: Arc<WorkspaceSession>,
    events: Arc<dyn WorkspaceEventSink>,
    conversations: Arc<dyn ConversationIngress>,
}
impl PlanningObservers {
    pub(crate) fn new(
        state: Arc<WorkspaceSession>,
        events: Arc<dyn WorkspaceEventSink>,
        conversations: Arc<dyn ConversationIngress>,
    ) -> Self {
        Self {
            state,
            events,
            conversations,
        }
    }
}
impl ovule_conversation::messages::PlanningObserverFactory for PlanningObservers {
    fn for_thread(&self, thread_id: String) -> WorkerEventCallback {
        planning_completion_observer(
            Arc::clone(&self.state),
            Arc::clone(&self.events),
            Arc::clone(&self.conversations),
            thread_id,
        )
    }
}
