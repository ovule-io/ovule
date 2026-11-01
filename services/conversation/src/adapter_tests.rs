use std::sync::Mutex;

use tempfile::tempdir;

use super::*;
use crate::state::AttemptSpec;
use crate::state::Workspace;
use crate::workspace::WorkspaceEventSink;
use crate::workspace::WorkspaceSession;
use crate::{AgentSessionService, AttemptPrerequisites, WorkerEvent, WorkerOutcome};
use crate::{AttemptRegistered, WorkerEventCallback};
use std::sync::Arc;

struct SynchronousExecutor;

struct NoPrerequisites;

impl AttemptPrerequisites for NoPrerequisites {
    fn prepare(&self, _spec: &AttemptSpec) -> Result<(), String> {
        Ok(())
    }
}

impl AgentSessionService for SynchronousExecutor {
    fn spawn(
        &self,
        spec: &AttemptSpec,
        registered: AttemptRegistered,
        notify: WorkerEventCallback,
    ) -> Result<(), String> {
        registered()?;
        notify(WorkerEvent::Started {
            attempt_id: spec.id.clone(),
        });
        notify(WorkerEvent::Output {
            attempt_id: spec.id.clone(),
            sequence: 0,
            delta: "completed".to_owned(),
        });
        notify(WorkerEvent::Finished(WorkerOutcome {
            attempt_id: spec.id.clone(),
            status: "succeeded".to_owned(),
            summary: "completed".to_owned(),
        }));
        Ok(())
    }

    fn cancel(&self, _attempt_id: &str, registered: AttemptRegistered) -> Result<(), String> {
        registered()
    }
}

#[derive(Default)]
struct RecordingWorkspaceEvents(Mutex<Vec<i64>>);

impl WorkspaceEventSink for RecordingWorkspaceEvents {
    fn revision_changed(&self, revision: i64) {
        self.0.lock().unwrap().push(revision);
    }
}

#[derive(Default)]
struct RecordingConversationEvents(Mutex<Vec<(String, u64, String, i64)>>);

impl ConversationEventSink for RecordingConversationEvents {
    fn agent_output(
        &self,
        attempt_id: &str,
        sequence: u64,
        delta: &str,
        revision: i64,
    ) -> Result<(), String> {
        self.0
            .lock()
            .unwrap()
            .push((attempt_id.to_owned(), sequence, delta.to_owned(), revision));
        Ok(())
    }
}

#[test]
fn executor_callbacks_are_persisted_by_the_conversation_service() {
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
        .create_thread("Conversation", directory.path().to_str().unwrap())
        .unwrap();
    let spec = workspace
        .prepare_message_attempt(&snapshot.threads[0].id, "run it")
        .unwrap();
    let state = Arc::new(WorkspaceSession::new(
        workspace,
        ovule_workspace::providers::open(&directory.path().join("workspace.sqlite3")).unwrap(),
    ));
    let workspace_events = Arc::new(RecordingWorkspaceEvents::default());
    let conversation_events = Arc::new(RecordingConversationEvents::default());
    let service = super::service::NativeConversationService::new(
        Arc::clone(&state),
        Arc::new(NoPrerequisites),
        Arc::new(SynchronousExecutor),
        Arc::clone(&workspace_events) as Arc<dyn WorkspaceEventSink>,
        Arc::clone(&conversation_events) as Arc<dyn ConversationEventSink>,
    );

    service.spawn_attempt(&spec, None).unwrap();

    let snapshot = state.read(Workspace::snapshot);
    let attempt = snapshot
        .attempts
        .iter()
        .find(|attempt| attempt.id == spec.id)
        .unwrap();
    assert_eq!(attempt.status, "succeeded");
    assert_eq!(attempt.output, "completed");
    assert_eq!(conversation_events.0.lock().unwrap().len(), 1);
    assert_eq!(workspace_events.0.lock().unwrap().len(), 3);
}

#[test]
fn queued_cancellation_finishes_without_a_worker_and_blocks_late_dispatch() {
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
        .create_thread("Conversation", directory.path().to_str().unwrap())
        .unwrap();
    let spec = workspace
        .prepare_message_attempt(&snapshot.threads[0].id, "run it")
        .unwrap();
    let state = Arc::new(WorkspaceSession::new(
        workspace,
        ovule_workspace::providers::open(&directory.path().join("workspace.sqlite3")).unwrap(),
    ));
    let workspace_events = Arc::new(RecordingWorkspaceEvents::default());
    let conversation_events = Arc::new(RecordingConversationEvents::default());
    let service = super::service::NativeConversationService::new(
        Arc::clone(&state),
        Arc::new(NoPrerequisites),
        Arc::new(SynchronousExecutor),
        Arc::clone(&workspace_events) as Arc<dyn WorkspaceEventSink>,
        Arc::clone(&conversation_events) as Arc<dyn ConversationEventSink>,
    );

    service.cancel_attempt(&spec.id).unwrap();
    service.cancel_attempt(&spec.id).unwrap();
    assert_eq!(
        state.read(Workspace::snapshot).attempts[0].status,
        "cancelled"
    );
    assert!(service.spawn_attempt(&spec, None).is_err());
    assert_eq!(
        state.read(Workspace::snapshot).attempts[0].status,
        "cancelled"
    );
    assert!(
        conversation_events.0.lock().unwrap().is_empty(),
        "no late output is dispatched"
    );
}
