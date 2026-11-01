use std::sync::Mutex;

use tempfile::tempdir;

use crate::conversation::{ConversationIngress, WorkerEventCallback};
use crate::conversation::{WorkerEvent, WorkerOutcome};
use crate::state::{AttemptSpec, Workspace};
use crate::workspace::{WorkspaceEventSink, WorkspaceSession};
use std::sync::Arc;

#[derive(Default)]
struct RecordingEvents;

impl WorkspaceEventSink for RecordingEvents {
    fn revision_changed(&self, _revision: i64) {}
}

#[derive(Default)]
struct RecordingConversations(Mutex<Vec<(AttemptSpec, Option<WorkerEventCallback>)>>);

impl ConversationIngress for RecordingConversations {
    fn cancel_attempt(&self, _: &str) -> Result<(), String> {
        Ok(())
    }
    fn spawn_attempt(
        &self,
        spec: &AttemptSpec,
        observer: Option<WorkerEventCallback>,
    ) -> Result<(), String> {
        self.0.lock().unwrap().push((spec.clone(), observer));
        Ok(())
    }

    fn worker_event(&self, _event: WorkerEvent) {}
}

#[test]
#[allow(clippy::too_many_lines)]
fn successful_task_releases_gate_without_model_replanning() {
    let directory = tempdir().unwrap();
    let mut workspace = crate::test_support::native_workspace();
    workspace
        .upsert_agent(
            "test",
            "Test",
            "test",
            None,
            Vec::new(),
            Vec::new(),
            "",
            true,
        )
        .unwrap();
    workspace.configure_defaults("test", None, None).unwrap();
    let snapshot = workspace
        .create_thread("Conversation", &directory.path().to_string_lossy())
        .unwrap();
    let thread_id = snapshot.threads[0].id.clone();
    let snapshot = workspace
        .create_goal(&thread_id, "Ship", "Ship safely")
        .unwrap();
    let goal_id = snapshot.goals[0].id.clone();
    let snapshot = workspace.add_task(&goal_id, "Build", None).unwrap();
    let task_id = snapshot.nodes[0].id.clone();
    workspace
        .add_gate(&goal_id, "Confirm authorization")
        .unwrap();
    let state = Arc::new(WorkspaceSession::new(
        workspace,
        ovule_workspace::providers::open(&directory.path().join("workspace.sqlite3")).unwrap(),
    ));
    let conversations = Arc::new(RecordingConversations::default());
    let service = super::service::NativeWorkflowService::new(
        Arc::clone(&state),
        Arc::new(RecordingEvents),
        Arc::clone(&conversations) as Arc<dyn ConversationIngress>,
    );

    service.dispatch(&task_id).unwrap();
    let (_, observer) = conversations.0.lock().unwrap().remove(0);
    let task_attempt_id = state.read(|workspace| workspace.snapshot().attempts[0].id.clone());
    state
        .transact(
            "attempt/dispatched",
            Some(&task_attempt_id),
            &serde_json::json!({}),
            |workspace| workspace.dispatch_attempt(&task_attempt_id),
        )
        .unwrap();
    state
        .transact(
            "attempt/started",
            Some(&task_attempt_id),
            &serde_json::json!({}),
            |workspace| workspace.start_attempt(&task_attempt_id),
        )
        .unwrap();
    state
        .finish_attempt(&task_attempt_id, "succeeded", "Build complete".to_owned())
        .unwrap();
    observer.unwrap()(WorkerEvent::Finished(WorkerOutcome {
        attempt_id: task_attempt_id,
        status: "succeeded".to_owned(),
        summary: "Build complete".to_owned(),
    }));

    assert!(conversations.0.lock().unwrap().is_empty());
    let snapshot = state.read(Workspace::snapshot);
    assert_eq!(snapshot.nodes[1].status, "waiting");
    assert!(snapshot.goals[0].progress.contains("1 gates waiting"));
    assert_eq!(snapshot.nodes[1].thread_id, "");
}

#[test]
#[allow(clippy::too_many_lines)]
fn failed_task_schedules_a_structured_dynamic_replan() {
    let directory = tempdir().unwrap();
    let mut workspace = crate::test_support::native_workspace();
    workspace
        .upsert_agent(
            "test",
            "Test",
            "test",
            None,
            Vec::new(),
            Vec::new(),
            "",
            true,
        )
        .unwrap();
    workspace.configure_defaults("test", None, None).unwrap();
    let snapshot = workspace
        .create_thread("Conversation", &directory.path().to_string_lossy())
        .unwrap();
    let thread_id = snapshot.threads[0].id.clone();
    let snapshot = workspace
        .create_goal(&thread_id, "Ship", "Ship safely")
        .unwrap();
    let goal_id = snapshot.goals[0].id.clone();
    let snapshot = workspace.add_task(&goal_id, "Build", None).unwrap();
    let task_id = snapshot.nodes[0].id.clone();
    let state = Arc::new(WorkspaceSession::new(
        workspace,
        ovule_workspace::providers::open(&directory.path().join("workspace.sqlite3")).unwrap(),
    ));
    let conversations = Arc::new(RecordingConversations::default());
    let service = super::service::NativeWorkflowService::new(
        Arc::clone(&state),
        Arc::new(RecordingEvents),
        Arc::clone(&conversations) as Arc<dyn ConversationIngress>,
    );

    service.dispatch(&task_id).unwrap();
    let (_, observer) = conversations.0.lock().unwrap().remove(0);
    let task_attempt_id = state.read(|workspace| workspace.snapshot().attempts[0].id.clone());
    state
        .transact(
            "attempt/dispatched",
            Some(&task_attempt_id),
            &serde_json::json!({}),
            |workspace| workspace.dispatch_attempt(&task_attempt_id),
        )
        .unwrap();
    state
        .transact(
            "attempt/started",
            Some(&task_attempt_id),
            &serde_json::json!({}),
            |workspace| workspace.start_attempt(&task_attempt_id),
        )
        .unwrap();
    state
        .finish_attempt(&task_attempt_id, "failed", "Build failed".to_owned())
        .unwrap();
    observer.unwrap()(WorkerEvent::Finished(WorkerOutcome {
        attempt_id: task_attempt_id,
        status: "failed".to_owned(),
        summary: "Build failed".to_owned(),
    }));

    let (replan, replan_observer) = conversations.0.lock().unwrap().remove(0);
    assert!(replan.structured_goal);
    assert_eq!(replan.source_message_id, None);
    let snapshot = state.read(Workspace::snapshot);
    assert_eq!(snapshot.goals[0].status, "replanning");
    assert!(
        snapshot
            .attempts
            .iter()
            .any(|attempt| { attempt.purpose == format!("workflow_replan:{goal_id}:{task_id}") })
    );

    state
        .transact(
            "attempt/dispatched",
            Some(&replan.id),
            &serde_json::json!({}),
            |workspace| workspace.dispatch_attempt(&replan.id),
        )
        .unwrap();
    state
        .transact(
            "attempt/started",
            Some(&replan.id),
            &serde_json::json!({}),
            |workspace| workspace.start_attempt(&replan.id),
        )
        .unwrap();
    let plan = r#"{"title":"Ship","intent":"Ship safely","response":"Continue with verification.","nodes":[{"kind":"task","title":"Verify artifacts"}]}"#;
    state
        .finish_attempt(&replan.id, "succeeded", plan.to_owned())
        .unwrap();
    replan_observer.unwrap()(WorkerEvent::Finished(WorkerOutcome {
        attempt_id: replan.id,
        status: "succeeded".to_owned(),
        summary: plan.to_owned(),
    }));

    let (next_task, _) = conversations.0.lock().unwrap().remove(0);
    assert!(!next_task.structured_goal);
    let next_node_id = state.read(|workspace| {
        workspace
            .snapshot()
            .nodes
            .iter()
            .find(|node| node.title == "Verify artifacts")
            .map(|node| node.id.clone())
    });
    assert_eq!(next_task.task_id, next_node_id);
}

#[test]
fn advance_dispatches_independent_root_tasks_in_parallel() {
    let directory = tempdir().unwrap();
    let mut workspace = crate::test_support::native_workspace();
    workspace
        .upsert_agent(
            "test",
            "Test",
            "test",
            None,
            Vec::new(),
            Vec::new(),
            "",
            true,
        )
        .unwrap();
    workspace.configure_defaults("test", None, None).unwrap();
    let thread_id = workspace
        .create_thread("Conversation", &directory.path().to_string_lossy())
        .unwrap()
        .threads[0]
        .id
        .clone();
    let planning = workspace
        .prepare_goal_workflow(&thread_id, None, "Run checks")
        .unwrap();
    workspace.dispatch_attempt(&planning.id).unwrap();
    workspace.start_attempt(&planning.id).unwrap();
    workspace
        .finish_attempt(
            &planning.id,
            "succeeded",
            r#"{"title":"Checks","intent":"Run in parallel.","response":"Ready.","nodes":[{"id":"lint","kind":"task","title":"Lint","dependsOn":[]},{"id":"test","kind":"task","title":"Test","dependsOn":[]},{"id":"verify","kind":"gate","title":"Verify","dependsOn":["lint","test"]}]}"#.to_owned(),
        )
        .unwrap();
    let state = Arc::new(WorkspaceSession::new(
        workspace,
        ovule_workspace::providers::open(&directory.path().join("workspace.sqlite3")).unwrap(),
    ));
    let conversations = Arc::new(RecordingConversations::default());
    let service = super::service::NativeWorkflowService::new(
        Arc::clone(&state),
        Arc::new(RecordingEvents),
        Arc::clone(&conversations) as Arc<dyn ConversationIngress>,
    );

    service.advance(&thread_id).unwrap();
    let spawned = conversations.0.lock().unwrap();
    assert_eq!(spawned.len(), 2);
    assert_eq!(
        spawned
            .iter()
            .map(|(spec, _)| spec.prompt.as_str())
            .filter(|prompt| prompt.contains("Task: Lint") || prompt.contains("Task: Test"))
            .count(),
        2
    );
}

#[test]
fn approved_gate_advances_without_replanning() {
    let directory = tempdir().unwrap();
    let mut workspace = crate::test_support::native_workspace();
    workspace
        .upsert_agent(
            "test",
            "Test",
            "test",
            None,
            Vec::new(),
            Vec::new(),
            "",
            true,
        )
        .unwrap();
    workspace.configure_defaults("test", None, None).unwrap();
    let snapshot = workspace
        .create_thread("Conversation", &directory.path().to_string_lossy())
        .unwrap();
    let thread_id = snapshot.threads[0].id.clone();
    let snapshot = workspace
        .create_goal(&thread_id, "Release", "Release safely")
        .unwrap();
    let goal_id = snapshot.goals[0].id.clone();
    let snapshot = workspace.add_gate(&goal_id, "Approve release").unwrap();
    let gate_id = snapshot.nodes[0].id.clone();
    let state = Arc::new(WorkspaceSession::new(
        workspace,
        ovule_workspace::providers::open(&directory.path().join("workspace.sqlite3")).unwrap(),
    ));
    let conversations = Arc::new(RecordingConversations::default());
    let service = super::service::NativeWorkflowService::new(
        Arc::clone(&state),
        Arc::new(RecordingEvents),
        Arc::clone(&conversations) as Arc<dyn ConversationIngress>,
    );

    let snapshot = service.resolve_gate(&gate_id, true).unwrap();

    assert_eq!(snapshot.nodes[0].status, "approved");
    assert!(conversations.0.lock().unwrap().is_empty());
}
