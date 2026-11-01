use serde_json::Value;

use crate::state::Workspace;
use crate::workspace::{MutationError, WorkspaceEventSink, WorkspaceSession};

use super::SetupError;

pub(super) fn transact<T>(
    state: &WorkspaceSession,
    kind: &str,
    subject_id: Option<&str>,
    payload: &Value,
    operation: impl FnOnce(&mut Workspace) -> Result<T, String>,
) -> Result<T, SetupError> {
    state
        .transact(kind, subject_id, payload, operation)
        .map_err(|error| match error {
            MutationError::Domain(message) => SetupError::InvalidArgument(message),
            MutationError::Repository(message) => SetupError::Persistence(message),
        })
}

pub(super) fn sanitize_id(value: &str) -> String {
    let id = value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.') {
                character.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect::<String>();
    id.trim_matches('-').chars().take(96).collect()
}

pub(super) fn emit_revision(events: &dyn WorkspaceEventSink, revision: i64) {
    events.revision_changed(revision);
}
