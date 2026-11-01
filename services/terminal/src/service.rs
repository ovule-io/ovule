use std::sync::Arc;

use crate::state::AppSnapshot;
use crate::workspace::{MutationError, WorkspaceEventSink, WorkspaceSession};

use super::{TerminalEventSink, TerminalExecutor, TerminalOutcome};

#[derive(Debug)]
pub enum TerminalServiceError {
    InvalidArgument(String),
    Persistence(String),
    Runtime(String),
}

pub(super) struct NativeTerminalService {
    state: Arc<WorkspaceSession>,
    events: Arc<dyn WorkspaceEventSink>,
    output_events: Arc<dyn TerminalEventSink>,
    executor: Arc<dyn TerminalExecutor>,
}

impl NativeTerminalService {
    #[must_use]
    pub fn new(
        state: Arc<WorkspaceSession>,
        events: Arc<dyn WorkspaceEventSink>,
        output_events: Arc<dyn TerminalEventSink>,
        executor: Arc<dyn TerminalExecutor>,
    ) -> Self {
        Self {
            state,
            events,
            output_events,
            executor,
        }
    }

    pub fn start(
        &self,
        thread_id: &str,
        command: &str,
        owner_id: Option<String>,
        workspace_binding_id: Option<String>,
        use_thread_workspace: bool,
    ) -> Result<AppSnapshot, TerminalServiceError> {
        let spec = self
            .state
            .transact(
                "terminal/created",
                Some(thread_id),
                &serde_json::json!({
                    "command": command,
                    "owner_id": owner_id,
                    "workspace_binding_id": workspace_binding_id,
                    "use_thread_workspace": use_thread_workspace,
                }),
                |workspace| {
                    workspace.prepare_terminal_run(
                        thread_id,
                        command,
                        owner_id,
                        workspace_binding_id,
                        use_thread_workspace,
                    )
                },
            )
            .map_err(map_mutation_error)?;
        self.publish_current_revision();

        let run_id = spec.id.clone();
        let failed_run_id = spec.id.clone();
        let started_state = Arc::clone(&self.state);
        let started_events = Arc::clone(&self.events);
        let finished_state = Arc::clone(&self.state);
        let finished_events = Arc::clone(&self.events);
        let output_events = Arc::clone(&self.output_events);
        let spawn_result = self.executor.spawn(
            spec,
            Box::new(move || {
                persist_transition(
                    &started_state,
                    started_events.as_ref(),
                    "terminal/started",
                    &run_id,
                    |workspace| workspace.start_terminal_run(&run_id),
                )
            }),
            Box::new(move |output| {
                if let Err(error) = output_events.output(&output) {
                    tracing::warn!(%error, run_id = output.id, "broadcast Terminal output");
                }
            }),
            Box::new(move |outcome| {
                persist_outcome(&finished_state, finished_events.as_ref(), outcome);
            }),
        );
        if let Err(error) = spawn_result {
            return self.change(
                "terminal/failed",
                Some(&failed_run_id),
                &serde_json::json!({"error": error}),
                |workspace| {
                    workspace.finish_terminal_run(
                        &failed_run_id,
                        "failed",
                        String::new(),
                        error,
                        None,
                    )
                },
            );
        }
        Ok(self.snapshot())
    }

    pub fn cancel(&self, run_id: &str) -> Result<AppSnapshot, TerminalServiceError> {
        let state = Arc::clone(&self.state);
        let events = Arc::clone(&self.events);
        let registered_run_id = run_id.to_owned();
        self.executor
            .cancel(
                run_id,
                Box::new(move || {
                    persist_transition(
                        &state,
                        events.as_ref(),
                        "terminal/cancel-requested",
                        &registered_run_id,
                        |workspace| workspace.request_terminal_cancel(&registered_run_id),
                    )
                }),
            )
            .map_err(TerminalServiceError::Runtime)?;
        Ok(self.snapshot())
    }

    fn change(
        &self,
        kind: &str,
        subject_id: Option<&str>,
        payload: &serde_json::Value,
        operation: impl FnOnce(&mut crate::state::Workspace) -> Result<AppSnapshot, String>,
    ) -> Result<AppSnapshot, TerminalServiceError> {
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

    fn publish_current_revision(&self) {
        self.events
            .revision_changed(self.state.read(crate::state::Workspace::revision));
    }
}

fn map_mutation_error(error: MutationError) -> TerminalServiceError {
    match error {
        MutationError::Domain(message) => TerminalServiceError::InvalidArgument(message),
        MutationError::Repository(message) => TerminalServiceError::Persistence(message),
    }
}

fn persist_transition(
    state: &WorkspaceSession,
    events: &dyn WorkspaceEventSink,
    kind: &str,
    run_id: &str,
    operation: impl FnOnce(&mut crate::state::Workspace) -> Result<AppSnapshot, String>,
) -> Result<(), String> {
    let snapshot = state
        .transact(kind, Some(run_id), &serde_json::json!({}), operation)
        .map_err(|error| match error {
            MutationError::Domain(message) | MutationError::Repository(message) => message,
        })?;
    events.revision_changed(snapshot.revision);
    Ok(())
}

fn persist_outcome(
    state: &WorkspaceSession,
    events: &dyn WorkspaceEventSink,
    outcome: TerminalOutcome,
) {
    let kind = format!("terminal/{}", outcome.status);
    let payload = serde_json::json!({
        "status": outcome.status,
        "exit_code": outcome.exit_code,
    });
    let result = state.transact(&kind, Some(&outcome.id), &payload, |workspace| {
        workspace.finish_terminal_run(
            &outcome.id,
            &outcome.status,
            outcome.stdout,
            outcome.stderr,
            outcome.exit_code,
        )
    });
    match result {
        Ok(snapshot) => events.revision_changed(snapshot.revision),
        Err(MutationError::Domain(message) | MutationError::Repository(message)) => {
            tracing::error!(error = message, "persist Terminal outcome");
        }
    }
}

pub trait Terminal: Send + Sync {
    fn start(
        &self,
        thread_id: &str,
        command: &str,
        owner_id: Option<String>,
        workspace_binding_id: Option<String>,
        use_thread_workspace: bool,
    ) -> Result<AppSnapshot, TerminalServiceError>;
    fn cancel(&self, run_id: &str) -> Result<AppSnapshot, TerminalServiceError>;
}

/// Typed identity consumed by shells and domain factories.
pub type TerminalService = tuffite_ioc::Service<dyn Terminal>;

impl Terminal for NativeTerminalService {
    fn start(
        &self,
        thread_id: &str,
        command: &str,
        owner_id: Option<String>,
        workspace_binding_id: Option<String>,
        use_thread_workspace: bool,
    ) -> Result<AppSnapshot, TerminalServiceError> {
        NativeTerminalService::start(
            self,
            thread_id,
            command,
            owner_id,
            workspace_binding_id,
            use_thread_workspace,
        )
    }
    fn cancel(&self, run_id: &str) -> Result<AppSnapshot, TerminalServiceError> {
        NativeTerminalService::cancel(self, run_id)
    }
}
