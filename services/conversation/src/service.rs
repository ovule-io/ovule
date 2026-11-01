use std::sync::Arc;

use crate::state::AttemptSpec;
use crate::workspace::{MutationError, WorkspaceEventSink, WorkspaceSession};

use super::{
    AgentSessionService, AttemptPrerequisites, WorkerEvent, WorkerEventCallback, WorkerOutcome,
};

pub trait ConversationEventSink: Send + Sync {
    fn agent_output(
        &self,
        attempt_id: &str,
        sequence: u64,
        delta: &str,
        revision: i64,
    ) -> Result<(), String>;
}

pub trait ConversationIngress: Send + Sync {
    fn cancel_attempt(&self, attempt_id: &str) -> Result<(), String>;
    fn spawn_attempt(
        &self,
        spec: &AttemptSpec,
        observer: Option<WorkerEventCallback>,
    ) -> Result<(), String>;
    fn worker_event(&self, event: WorkerEvent);
}

pub(super) struct NativeConversationService {
    state: Arc<WorkspaceSession>,
    attachments: Option<Arc<dyn crate::messages::AttachmentRepository>>,
    prerequisites: Arc<dyn AttemptPrerequisites>,
    sessions: Arc<dyn AgentSessionService>,
    workspace_events: Arc<dyn WorkspaceEventSink>,
    events: Arc<dyn ConversationEventSink>,
}

impl NativeConversationService {
    #[must_use]
    pub fn new(
        state: Arc<WorkspaceSession>,
        prerequisites: Arc<dyn AttemptPrerequisites>,
        sessions: Arc<dyn AgentSessionService>,
        workspace_events: Arc<dyn WorkspaceEventSink>,
        events: Arc<dyn ConversationEventSink>,
    ) -> Self {
        Self {
            attachments: None,
            state,
            prerequisites,
            sessions,
            workspace_events,
            events,
        }
    }

    pub(crate) fn with_attachments(
        mut self,
        attachments: Arc<dyn crate::messages::AttachmentRepository>,
    ) -> Self {
        self.attachments = Some(attachments);
        self
    }

    pub fn handle_worker_event(&self, event: WorkerEvent) {
        let event = match persist_image_event(event, self.attachments.as_deref()) {
            Ok(event) => event,
            Err(error) => {
                tracing::error!(error, "persist Agent image");
                return;
            }
        };
        if let Err(error) = handle_worker_event(
            &self.state,
            self.workspace_events.as_ref(),
            self.events.as_ref(),
            event,
        ) {
            tracing::error!(error, "persist Agent Worker transition");
        }
    }

    pub fn spawn_attempt(
        &self,
        spec: &AttemptSpec,
        observer: Option<WorkerEventCallback>,
    ) -> Result<(), String> {
        self.prerequisites.prepare(spec)?;
        let dispatch_state = Arc::clone(&self.state);
        let dispatch_events = Arc::clone(&self.workspace_events);
        let attempt_id = spec.id.clone();
        let event_state = Arc::clone(&self.state);
        let workspace_events = Arc::clone(&self.workspace_events);
        let conversation_events = Arc::clone(&self.events);
        let attachments = self.attachments.clone();
        let notify: WorkerEventCallback = Arc::new(move |event| {
            let event = match persist_image_event(event, attachments.as_deref()) {
                Ok(event) => event,
                Err(error) => {
                    tracing::error!(error, "persist Agent image");
                    return;
                }
            };
            let forwarded_event = event.clone();
            let result = handle_worker_event(
                &event_state,
                workspace_events.as_ref(),
                conversation_events.as_ref(),
                event,
            );
            match result {
                Ok(true) => {
                    if let Some(observer) = observer.as_ref() {
                        observer(forwarded_event);
                    }
                }
                Ok(false) => {}
                Err(error) => tracing::error!(error, "persist Agent Worker transition"),
            }
        });
        self.sessions.spawn(
            spec,
            Box::new(move || {
                persist_worker_transition(
                    &dispatch_state,
                    dispatch_events.as_ref(),
                    "attempt/dispatched",
                    &attempt_id,
                    |workspace| workspace.dispatch_attempt(&attempt_id),
                )
                .map(|_| ())
            }),
            notify,
        )
    }

    pub fn cancel_attempt(&self, attempt_id: &str) -> Result<(), String> {
        // A queued Attempt may still be preparing prerequisites and have no Worker token.
        // Cancel it atomically; dispatch's queued-state guard prevents a late spawn.
        let (handled, changed) = self
            .state
            .transact_changed(
                "attempt/cancelled-before-dispatch",
                Some(attempt_id),
                &serde_json::json!({}),
                |workspace| {
                    let snapshot = workspace.snapshot();
                    let attempt = snapshot
                        .attempts
                        .iter()
                        .find(|attempt| attempt.id == attempt_id)
                        .ok_or("Unknown Attempt")?;
                    if attempt.status == "queued" {
                        workspace.finish_attempt(
                            attempt_id,
                            "cancelled",
                            "Cancelled before Worker dispatch".into(),
                        )?;
                        return Ok(true);
                    }
                    Ok(matches!(
                        attempt.status.as_str(),
                        "cancelling" | "succeeded" | "failed" | "cancelled"
                    ))
                },
            )
            .map_err(|error| match error {
                MutationError::Domain(message) | MutationError::Repository(message) => message,
            })?;
        if changed {
            self.workspace_events
                .revision_changed(self.state.read(crate::state::Workspace::revision));
        }
        if handled {
            return Ok(());
        }
        let state = Arc::clone(&self.state);
        let events = Arc::clone(&self.workspace_events);
        let registered_attempt_id = attempt_id.to_owned();
        self.sessions.cancel(
            attempt_id,
            Box::new(move || {
                let snapshot = state
                    .transact(
                        "attempt/cancel-requested",
                        Some(&registered_attempt_id),
                        &serde_json::json!({}),
                        |workspace| workspace.request_cancel(&registered_attempt_id),
                    )
                    .map_err(|error| match error {
                        MutationError::Domain(message) | MutationError::Repository(message) => {
                            message
                        }
                    })?;
                events.revision_changed(snapshot.revision);
                Ok(())
            }),
        )
    }
}

impl ConversationIngress for NativeConversationService {
    fn cancel_attempt(&self, attempt_id: &str) -> Result<(), String> {
        Self::cancel_attempt(self, attempt_id)
    }
    fn spawn_attempt(
        &self,
        spec: &AttemptSpec,
        observer: Option<WorkerEventCallback>,
    ) -> Result<(), String> {
        Self::spawn_attempt(self, spec, observer)
    }

    fn worker_event(&self, event: WorkerEvent) {
        self.handle_worker_event(event);
    }
}

/// Store image bytes outside snapshots and forward only a content-addressed reference.
fn persist_image_event(
    event: WorkerEvent,
    attachments: Option<&dyn crate::messages::AttachmentRepository>,
) -> Result<WorkerEvent, String> {
    use base64::Engine as _;
    let WorkerEvent::MessageBlock {
        attempt_id,
        block_id,
        kind,
        data_json,
    } = event
    else {
        return Ok(event);
    };
    if kind != "image" {
        return Ok(WorkerEvent::MessageBlock {
            attempt_id,
            block_id,
            kind,
            data_json,
        });
    }
    if data_json.len() > 17 * 1024 * 1024 {
        return Err("Agent image payload exceeds limit".into());
    }
    let data: serde_json::Value =
        serde_json::from_str(&data_json).map_err(|error| error.to_string())?;
    // Existing attachment references can pass through without decoding again.
    if data
        .get("url")
        .and_then(serde_json::Value::as_str)
        .is_some_and(|url| url.starts_with("ovule-attachment:///"))
    {
        return Ok(WorkerEvent::MessageBlock {
            attempt_id,
            block_id,
            kind,
            data_json,
        });
    }
    let encoded = data
        .get("data")
        .and_then(serde_json::Value::as_str)
        .ok_or("Agent image has no data")?;
    let media_type = data
        .get("mediaType")
        .and_then(serde_json::Value::as_str)
        .ok_or("Agent image has no media type")?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .map_err(|error| error.to_string())?;
    let stored = attachments
        .ok_or("Agent attachment store unavailable")?
        .persist_output(&crate::messages::ImageAttachment {
            name: data
                .get("name")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("Image")
                .into(),
            media_type: media_type.into(),
            bytes,
        })
        .map_err(|error| format!("{error:?}"))?;
    let image = stored.first().ok_or("Agent attachment was not stored")?;
    Ok(WorkerEvent::MessageBlock { attempt_id, block_id, kind, data_json: serde_json::json!({
        "url": format!("ovule-attachment:///{}", image.id), "name": image.name, "mediaType":image.media_type, "sizeBytes":image.size_bytes,
    }).to_string() })
}

pub fn handle_worker_event(
    state: &WorkspaceSession,
    workspace_events: &dyn WorkspaceEventSink,
    events: &dyn ConversationEventSink,
    event: WorkerEvent,
) -> Result<bool, String> {
    match event {
        WorkerEvent::Diagnostic {
            attempt_id,
            kind,
            detail_json,
        } => persist_worker_transition(state, workspace_events, &kind, &attempt_id, |workspace| {
            workspace.record_attempt_diagnostic(&attempt_id, &kind, &detail_json)
        }),
        WorkerEvent::Started { attempt_id } => persist_worker_transition(
            state,
            workspace_events,
            "attempt/started",
            &attempt_id,
            |workspace| workspace.start_attempt(&attempt_id),
        ),
        WorkerEvent::Output {
            attempt_id,
            sequence,
            delta,
        } => {
            let snapshot = state.transact_changed(
                "attempt/output",
                Some(&attempt_id),
                &serde_json::json!({"sequence": sequence, "bytes": delta.len()}),
                |workspace| workspace.append_attempt_output(&attempt_id, sequence, &delta),
            );
            match snapshot {
                Ok((snapshot, true)) => events
                    .agent_output(&attempt_id, sequence, &delta, snapshot.revision)
                    .map(|()| true),
                Ok((_, false)) => Ok(false),
                Err(MutationError::Domain(message) | MutationError::Repository(message)) => {
                    Err(message)
                }
            }
        }
        WorkerEvent::MessageBlock {
            attempt_id,
            block_id,
            kind,
            data_json,
        } => {
            let snapshot = state.transact_changed(
                "attempt/message-block",
                Some(&attempt_id),
                &serde_json::json!({"block_id": block_id, "kind": kind}),
                |workspace| {
                    workspace.upsert_attempt_message_block(&attempt_id, &block_id, &kind, data_json)
                },
            );
            match snapshot {
                Ok((snapshot, true)) => {
                    workspace_events.revision_changed(snapshot.revision);
                    Ok(true)
                }
                Ok((_, false)) => Ok(false),
                Err(MutationError::Domain(message) | MutationError::Repository(message)) => {
                    Err(message)
                }
            }
        }
        WorkerEvent::ReplaceOutput {
            attempt_id,
            content,
        } => persist_worker_transition(
            state,
            workspace_events,
            "attempt/output-replaced",
            &attempt_id,
            |workspace| workspace.replace_attempt_output(&attempt_id, content),
        ),
        WorkerEvent::Finished(WorkerOutcome {
            attempt_id,
            status,
            summary,
        }) => finish_worker_attempt(state, workspace_events, &attempt_id, &status, summary),
    }
}

fn persist_worker_transition(
    state: &WorkspaceSession,
    events: &dyn WorkspaceEventSink,
    kind: &str,
    attempt_id: &str,
    operation: impl FnOnce(&mut crate::state::Workspace) -> Result<crate::state::AppSnapshot, String>,
) -> Result<bool, String> {
    let (snapshot, applied) = state
        .transact_changed(kind, Some(attempt_id), &serde_json::json!({}), operation)
        .map_err(|error| match error {
            MutationError::Domain(message) | MutationError::Repository(message) => message,
        })?;
    if applied {
        events.revision_changed(snapshot.revision);
    }
    Ok(applied)
}

fn finish_worker_attempt(
    state: &WorkspaceSession,
    events: &dyn WorkspaceEventSink,
    attempt_id: &str,
    status: &str,
    summary: String,
) -> Result<bool, String> {
    let (snapshot, applied) =
        state
            .finish_attempt(attempt_id, status, summary)
            .map_err(|error| match error {
                MutationError::Domain(message) | MutationError::Repository(message) => message,
            })?;
    if applied {
        events.revision_changed(snapshot.revision);
    }
    Ok(applied)
}

/// Application-facing facade; command methods are inherited from the ingress port.
pub trait Conversation: ConversationIngress {
    fn handle_worker_event(&self, event: WorkerEvent);
}

/// Typed identity consumed by shells and domain factories.
pub type ConversationService = tuffite_ioc::Service<dyn Conversation>;

impl Conversation for NativeConversationService {
    fn handle_worker_event(&self, event: WorkerEvent) {
        NativeConversationService::handle_worker_event(self, event);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::Workspace;
    use crate::workspace::repository::WorkspaceRepository;
    use std::sync::Mutex;
    struct Repository {
        commits: Arc<Mutex<Vec<String>>>,
        fail_output: bool,
    }
    impl WorkspaceRepository for Repository {
        fn load(&self) -> Result<Option<Workspace>, String> {
            Ok(None)
        }
        fn commit(
            &mut self,
            _: &Workspace,
            kind: &str,
            _: Option<&str>,
            _: &serde_json::Value,
        ) -> Result<(), String> {
            if self.fail_output && kind == "attempt/output" {
                return Err("disk unavailable".into());
            }
            self.commits.lock().unwrap().push(kind.into());
            Ok(())
        }
    }
    #[derive(Default)]
    struct Events {
        outputs: Mutex<Vec<String>>,
        revisions: Mutex<Vec<i64>>,
    }
    impl WorkspaceEventSink for Events {
        fn revision_changed(&self, revision: i64) {
            self.revisions.lock().unwrap().push(revision);
        }
    }
    impl ConversationEventSink for Events {
        fn agent_output(&self, _: &str, _: u64, delta: &str, _: i64) -> Result<(), String> {
            self.outputs.lock().unwrap().push(delta.into());
            Ok(())
        }
    }
    fn fixture(fail_output: bool) -> (Arc<WorkspaceSession>, AttemptSpec, Arc<Mutex<Vec<String>>>) {
        let mut workspace = crate::test_support::workspace();
        workspace
            .upsert_agent("test", "Test", "test", None, vec![], vec![], "", true)
            .unwrap();
        workspace.configure_defaults("test", None, None).unwrap();
        let root = crate::test_support::root();
        let snapshot = workspace
            .create_thread("Test", root.to_str().unwrap())
            .unwrap();
        let spec = workspace
            .prepare_message_attempt(&snapshot.threads[0].id, "work")
            .unwrap();
        let commits = Arc::new(Mutex::new(Vec::new()));
        let repository = Repository {
            commits: commits.clone(),
            fail_output,
        };
        (
            Arc::new(WorkspaceSession::new(workspace, repository)),
            spec,
            commits,
        )
    }
    #[test]
    fn duplicate_and_terminal_output_do_not_commit_or_notify() {
        let (state, spec, commits) = fixture(false);
        let events = Events::default();
        let output = WorkerEvent::Output {
            attempt_id: spec.id.clone(),
            sequence: 0,
            delta: "hello".into(),
        };
        assert!(handle_worker_event(&state, &events, &events, output.clone()).unwrap());
        assert!(!handle_worker_event(&state, &events, &events, output).unwrap());
        let outcome = WorkerEvent::Finished(WorkerOutcome {
            attempt_id: spec.id.clone(),
            status: "succeeded".into(),
            summary: "done".into(),
        });
        assert!(handle_worker_event(&state, &events, &events, outcome).unwrap());
        assert!(
            !handle_worker_event(
                &state,
                &events,
                &events,
                WorkerEvent::Output {
                    attempt_id: spec.id,
                    sequence: 1,
                    delta: "late".into()
                }
            )
            .unwrap()
        );
        assert_eq!(
            *commits.lock().unwrap(),
            ["attempt/output", "attempt/succeeded"]
        );
        assert_eq!(*events.outputs.lock().unwrap(), ["hello"]);
    }
    struct Prerequisites;
    impl AttemptPrerequisites for Prerequisites {
        fn prepare(&self, _: &AttemptSpec) -> Result<(), String> {
            Ok(())
        }
    }
    struct Executor;
    impl AgentSessionService for Executor {
        fn spawn(
            &self,
            spec: &AttemptSpec,
            registered: super::super::AttemptRegistered,
            notify: WorkerEventCallback,
        ) -> Result<(), String> {
            registered()?;
            notify(WorkerEvent::Output {
                attempt_id: spec.id.clone(),
                sequence: 0,
                delta: "uncommitted".into(),
            });
            Ok(())
        }
        fn cancel(
            &self,
            _: &str,
            registered: super::super::AttemptRegistered,
        ) -> Result<(), String> {
            registered()
        }
    }
    #[test]
    fn failed_persistence_does_not_publish_or_forward_worker_events() {
        let (state, spec, commits) = fixture(true);
        let events = Arc::new(Events::default());
        let service = NativeConversationService::new(
            state.clone(),
            Arc::new(Prerequisites),
            Arc::new(Executor),
            events.clone(),
            events.clone(),
        );
        let observed = Arc::new(Mutex::new(Vec::new()));
        let recorder = observed.clone();
        service
            .spawn_attempt(
                &spec,
                Some(Arc::new(move |event| recorder.lock().unwrap().push(event))),
            )
            .unwrap();
        assert!(observed.lock().unwrap().is_empty());
        assert!(events.outputs.lock().unwrap().is_empty());
        assert_eq!(*commits.lock().unwrap(), ["attempt/dispatched"]);
        let snapshot = state.read(Workspace::snapshot);
        assert!(
            snapshot
                .attempts
                .iter()
                .find(|attempt| attempt.id == spec.id)
                .unwrap()
                .output
                .is_empty()
        );
    }
}

#[cfg(test)]
mod image_tests {
    use super::*;
    use base64::Engine as _;

    #[test]
    fn agent_images_become_readable_references_without_base64_in_snapshot_events() {
        let root = tempfile::tempdir().unwrap();
        let store = crate::messages::providers::attachments(root.path());
        let bytes = b"\x89PNG\r\n\x1a\nimage";
        let event = WorkerEvent::MessageBlock {
            attempt_id: "attempt".into(), block_id: "image-1".into(), kind: "image".into(),
            data_json: serde_json::json!({"data":base64::engine::general_purpose::STANDARD.encode(bytes),"mediaType":"image/png","name":"screenshot.png"}).to_string(),
        };
        let WorkerEvent::MessageBlock { data_json, .. } =
            persist_image_event(event, Some(store.as_ref())).unwrap()
        else {
            panic!("expected image block");
        };
        let data: serde_json::Value = serde_json::from_str(&data_json).unwrap();
        assert!(data.get("data").is_none());
        let id = data["url"]
            .as_str()
            .unwrap()
            .strip_prefix("ovule-attachment:///")
            .unwrap();
        assert_eq!(store.read(id).unwrap(), bytes);
        assert_eq!(data["mediaType"], "image/png");
        assert_eq!(data["name"], "screenshot.png");
    }

    #[test]
    fn desktop_screenshot_above_user_upload_limit_is_stored() {
        let root = tempfile::tempdir().unwrap();
        let store = crate::messages::providers::attachments(root.path());
        let mut bytes = vec![0; 7 * 1024 * 1024];
        bytes[..8].copy_from_slice(b"\x89PNG\r\n\x1a\n");
        let event = WorkerEvent::MessageBlock { attempt_id: "attempt".into(), block_id: "desktop".into(), kind: "image".into(), data_json: serde_json::json!({"data":base64::engine::general_purpose::STANDARD.encode(&bytes),"mediaType":"image/png"}).to_string() };
        let WorkerEvent::MessageBlock { data_json, .. } =
            persist_image_event(event, Some(store.as_ref())).unwrap()
        else {
            panic!("image event");
        };
        let data: serde_json::Value = serde_json::from_str(&data_json).unwrap();
        let id = data["url"]
            .as_str()
            .unwrap()
            .strip_prefix("ovule-attachment:///")
            .unwrap();
        assert_eq!(store.read(id).unwrap(), bytes);
        assert!(data_json.len() < 512);
        assert!(
            store
                .persist(&[crate::messages::ImageAttachment {
                    name: "upload.png".into(),
                    media_type: "image/png".into(),
                    bytes
                }])
                .is_err()
        );
    }

    #[test]
    fn invalid_agent_image_cannot_be_persisted() {
        let root = tempfile::tempdir().unwrap();
        let store = crate::messages::providers::attachments(root.path());
        for (data, mime) in [
            ("not base64", "image/png"),
            ("aGVsbG8=", "image/png"),
            ("aGVsbG8=", "image/svg+xml"),
        ] {
            let event = WorkerEvent::MessageBlock {
                attempt_id: "attempt".into(),
                block_id: "image".into(),
                kind: "image".into(),
                data_json: serde_json::json!({"data":data,"mediaType":mime}).to_string(),
            };
            assert!(persist_image_event(event, Some(store.as_ref())).is_err());
        }
    }
}
