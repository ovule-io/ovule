use ovule_secrets::SecretStore as _;
use std::path::{Path, PathBuf};
pub(crate) fn managed_toolchains_path() -> PathBuf {
    database_path()
        .ok()
        .and_then(|path| path.parent().map(|parent| parent.join("toolchains")))
        .unwrap_or_else(|| std::env::temp_dir().join("ovule-toolchains"))
}

pub(crate) fn provider_credential_available(name: &str) -> bool {
    if std::env::var_os(name).is_some() {
        return true;
    }
    database_path()
        .ok()
        .and_then(|path| path.parent().map(Path::to_path_buf))
        .and_then(|root| ovule_secrets::providers::open(&root).ok())
        .is_some_and(|store| store.has_provider_credential(name).unwrap_or(false))
}

pub(crate) fn database_path() -> Result<PathBuf, String> {
    ovule_platform::identity::data_directory().map(|root| root.join("workspace.sqlite3"))
}
