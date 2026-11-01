use std::path::{Path, PathBuf};
use std::sync::Arc;
/// Filesystem facts used by workspace rules. Remote paths must be resolved by their execution Host.
pub trait WorkspacePaths: Send + Sync + std::fmt::Debug {
    fn home_directory(&self) -> Result<PathBuf, String> {
        Err("Host home directory is unavailable".into())
    }
    fn canonicalize(&self, path: &Path) -> Result<PathBuf, String>;
    fn is_directory(&self, path: &Path) -> bool;
    fn is_file(&self, path: &Path) -> bool;
    fn exists(&self, path: &Path) -> bool;
    fn entries(&self, path: &Path) -> Result<Vec<PathBuf>, String>;
}
#[derive(Debug)]
struct UnboundPaths;
impl WorkspacePaths for UnboundPaths {
    fn canonicalize(&self, _: &Path) -> Result<PathBuf, String> {
        Err("Workspace filesystem is not attached".into())
    }
    fn is_directory(&self, _: &Path) -> bool {
        false
    }
    fn is_file(&self, _: &Path) -> bool {
        false
    }
    fn exists(&self, _: &Path) -> bool {
        false
    }
    fn entries(&self, _: &Path) -> Result<Vec<PathBuf>, String> {
        Err("Workspace filesystem is not attached".into())
    }
}
#[must_use]
pub fn unbound_paths() -> Arc<dyn WorkspacePaths> {
    Arc::new(UnboundPaths)
}
