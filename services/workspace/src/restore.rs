use crate::{WorkspaceSession, repository::WorkspaceRepository as _};
use std::{path::Path, sync::Arc};

pub(crate) fn restore(
    database: &Path,
    paths: Arc<dyn crate::state::paths::WorkspacePaths>,
    settings: Arc<dyn ovule_settings::catalog::SettingsSource>,
) -> Result<Arc<WorkspaceSession>, String> {
    let mut store = crate::providers::open(database)?;
    let mut workspace = store.load()?.unwrap_or_default();
    workspace.attach_paths(paths);
    workspace.attach_settings(settings);
    let extensions_reconciled = workspace.reconcile_extensions()?;
    let attempts_recovered = workspace.abandon_incomplete_attempts();
    if extensions_reconciled || attempts_recovered {
        store.commit(
            &workspace,
            "runtime/recovered",
            None,
            &serde_json::json!({
                "extensions_reconciled": extensions_reconciled,
                "attempts_recovered": attempts_recovered,
            }),
        )?;
    }
    Ok(Arc::new(WorkspaceSession::new(workspace, store)))
}
