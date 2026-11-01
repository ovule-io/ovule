use std::sync::{Mutex, MutexGuard};

use serde_json::Value;

use super::repository::WorkspaceRepository;
use crate::state::{AppSnapshot, Workspace};

pub struct WorkspaceSession {
    state: Mutex<WorkspaceState>,
}

pub struct WorkspaceState {
    pub workspace: Workspace,
    pub store: Box<dyn WorkspaceRepository>,
}

#[derive(Debug)]
pub enum MutationError {
    Domain(String),
    Repository(String),
}

impl WorkspaceState {
    #[must_use]
    pub fn new(workspace: Workspace, store: impl WorkspaceRepository + 'static) -> Self {
        Self {
            workspace,
            store: Box::new(store),
        }
    }

    pub fn transact<T>(
        &mut self,
        kind: &str,
        subject_id: Option<&str>,
        payload: &Value,
        operation: impl FnOnce(&mut Workspace) -> Result<T, String>,
    ) -> Result<T, MutationError> {
        let mut candidate = self.workspace.clone();
        let value = operation(&mut candidate).map_err(MutationError::Domain)?;
        if candidate.revision() == self.workspace.revision() {
            return Ok(value);
        }
        self.store
            .commit(&candidate, kind, subject_id, payload)
            .map_err(MutationError::Repository)?;
        self.workspace = candidate;
        Ok(value)
    }
}

impl WorkspaceSession {
    #[must_use]
    pub fn new(workspace: Workspace, store: impl WorkspaceRepository + 'static) -> Self {
        Self {
            state: Mutex::new(WorkspaceState::new(workspace, store)),
        }
    }

    pub fn lock(&self) -> MutexGuard<'_, WorkspaceState> {
        self.state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    pub fn read<T>(&self, operation: impl FnOnce(&Workspace) -> T) -> T {
        operation(&self.lock().workspace)
    }

    pub fn transact<T>(
        &self,
        kind: &str,
        subject_id: Option<&str>,
        payload: &Value,
        operation: impl FnOnce(&mut Workspace) -> Result<T, String>,
    ) -> Result<T, MutationError> {
        self.lock().transact(kind, subject_id, payload, operation)
    }

    /// Returns whether the operation advanced the persisted workspace revision.
    /// Ignored events never create a repository event or a downstream notification.
    pub fn transact_changed<T>(
        &self,
        kind: &str,
        subject_id: Option<&str>,
        payload: &Value,
        operation: impl FnOnce(&mut Workspace) -> Result<T, String>,
    ) -> Result<(T, bool), MutationError> {
        let mut state = self.lock();
        let before = state.workspace.revision();
        let value = state.transact(kind, subject_id, payload, operation)?;
        Ok((value, state.workspace.revision() != before))
    }

    pub fn prepare_shutdown(&self) -> Result<(), MutationError> {
        let mut state = self.lock();
        let mut candidate = state.workspace.clone();
        if !candidate.abandon_incomplete_attempts() {
            return Ok(());
        }
        state
            .store
            .commit(
                &candidate,
                "runtime/shutdown-abandoned",
                None,
                &serde_json::json!({}),
            )
            .map_err(MutationError::Repository)?;
        state.workspace = candidate;
        Ok(())
    }

    pub fn finish_attempt(
        &self,
        attempt_id: &str,
        status: &str,
        summary: String,
    ) -> Result<(AppSnapshot, bool), MutationError> {
        let kind = format!("attempt/{status}");
        let payload = serde_json::json!({"status": status, "summary": summary});
        let mut state = self.lock();
        let mut candidate = state.workspace.clone();
        let snapshot = candidate
            .finish_attempt(attempt_id, status, summary)
            .map_err(MutationError::Domain)?;
        if candidate.revision() == state.workspace.revision() {
            return Ok((snapshot, false));
        }
        let body = candidate
            .response_content_for_attempt(attempt_id)
            .filter(|content| !content.trim().is_empty())
            .unwrap_or_else(|| "Ovule completed without a response.".to_owned());
        state
            .store
            .commit_attempt_completion(&candidate, &kind, attempt_id, &payload, &body)
            .map_err(MutationError::Repository)?;
        state.workspace = candidate;
        Ok((snapshot, true))
    }
}

impl Drop for WorkspaceSession {
    fn drop(&mut self) {
        if let Err(error) = self.prepare_shutdown() {
            tracing::error!(?error, "Failed to persist workspace shutdown state");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    };

    struct FailingRepository(Arc<AtomicUsize>);
    impl WorkspaceRepository for FailingRepository {
        fn load(&self) -> Result<Option<Workspace>, String> {
            Ok(None)
        }
        fn commit(
            &mut self,
            _: &Workspace,
            _: &str,
            _: Option<&str>,
            _: &Value,
        ) -> Result<(), String> {
            self.0.fetch_add(1, Ordering::Relaxed);
            Err("storage unavailable".into())
        }
    }

    #[test]
    fn repository_failure_keeps_live_state_unchanged() {
        let commits = Arc::new(AtomicUsize::new(0));
        let session = WorkspaceSession::new(
            crate::state::test_support::workspace(),
            FailingRepository(commits.clone()),
        );
        let revision = session.read(Workspace::revision);
        let result = session.transact(
            "thread/created",
            None,
            &serde_json::json!({}),
            |workspace| {
                workspace.create_thread(
                    "Uncommitted",
                    crate::state::test_support::root().to_str().unwrap(),
                )
            },
        );
        assert!(matches!(result, Err(MutationError::Repository(_))));
        assert_eq!(commits.load(Ordering::Relaxed), 1);
        assert_eq!(session.read(Workspace::revision), revision);
        assert!(session.read(|workspace| workspace.snapshot().threads.is_empty()));
    }

    #[test]
    fn unchanged_operation_never_calls_repository() {
        let commits = Arc::new(AtomicUsize::new(0));
        let session =
            WorkspaceSession::new(Workspace::default(), FailingRepository(commits.clone()));
        let result = session
            .transact_changed("ignored", None, &serde_json::json!({}), |_| Ok(42))
            .unwrap();
        assert_eq!(result, (42, false));
        assert_eq!(commits.load(Ordering::Relaxed), 0);
    }
}
