use std::path::{Path, PathBuf};
#[derive(Debug)]
pub(crate) struct NativeWorkspacePaths;
impl crate::state::paths::WorkspacePaths for NativeWorkspacePaths {
    fn home_directory(&self) -> Result<PathBuf, String> {
        std::env::var_os("HOME")
            .or_else(|| std::env::var_os("USERPROFILE"))
            .filter(|v| !v.is_empty())
            .map(PathBuf::from)
            .ok_or_else(|| "Terminal HOME directory is unavailable".into())
    }
    fn canonicalize(&self, path: &Path) -> Result<PathBuf, String> {
        std::fs::canonicalize(path).map_err(|e| e.to_string())
    }
    fn is_directory(&self, path: &Path) -> bool {
        path.is_dir()
    }
    fn is_file(&self, path: &Path) -> bool {
        path.is_file()
    }
    fn exists(&self, path: &Path) -> bool {
        path.exists()
    }
    fn entries(&self, path: &Path) -> Result<Vec<PathBuf>, String> {
        std::fs::read_dir(path)
            .map_err(|e| e.to_string())?
            .map(|v| v.map(|v| v.path()).map_err(|e| e.to_string()))
            .collect()
    }
}
