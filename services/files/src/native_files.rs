use std::path::Path;

use super::WorkspaceFiles;

pub(crate) struct NativeWorkspaceFiles;

impl WorkspaceFiles for NativeWorkspaceFiles {
    fn read_text(&self, path: &Path) -> Result<String, String> {
        std::fs::read_to_string(path).map_err(|error| error.to_string())
    }

    fn read_bytes(&self, path: &Path) -> Result<Vec<u8>, String> {
        std::fs::read(path).map_err(|error| error.to_string())
    }

    fn size(&self, path: &Path) -> Result<u64, String> {
        std::fs::metadata(path)
            .map(|metadata| metadata.len())
            .map_err(|error| error.to_string())
    }

    fn atomic_write(&self, path: &Path, bytes: &[u8]) -> Result<(), String> {
        let file_name = path
            .file_name()
            .and_then(|value| value.to_str())
            .ok_or_else(|| "file name is invalid".to_owned())?;
        let temporary = path.with_file_name(format!(".{file_name}.ovule.tmp"));
        std::fs::write(&temporary, bytes)
            .map_err(|error| format!("write temporary file: {error}"))?;
        if let Err(error) = crate::platform::files::replace(&temporary, path) {
            let _ = std::fs::remove_file(&temporary);
            return Err(format!("replace file: {error}"));
        }
        Ok(())
    }
}
