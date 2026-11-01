//! Local `WorkspaceTransport` backend.

use std::path::{Component, Path, PathBuf};

use async_trait::async_trait;
use processkit::{Command, OutputBufferPolicy, Stdin};

use crate::TransportKind;

use super::{EntryKind, EntryStat, ExecOutcome, TransportError, WorkspaceTransport};

const MAX_STDOUT_BYTES: usize = 512 * 1024;
const MAX_STDERR_BYTES: usize = 256 * 1024;
const EXEC_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);

pub struct LocalTransport {
    root: PathBuf,
}

impl LocalTransport {
    #[allow(clippy::needless_pass_by_value)]
    pub fn new(root: PathBuf) -> Result<Self, TransportError> {
        if !root.is_absolute() {
            return Err(TransportError::InvalidPath(format!(
                "workspace root must be absolute: {}",
                root.display()
            )));
        }
        let canonical = std::fs::canonicalize(&root).map_err(|error| {
            TransportError::Io(format!(
                "resolve workspace root {}: {error}",
                root.display()
            ))
        })?;
        Ok(Self { root: canonical })
    }

    fn resolve(&self, relative: &str) -> Result<PathBuf, TransportError> {
        let trimmed = relative.trim();
        let candidate = PathBuf::from(trimmed);
        if candidate.is_absolute() {
            return Err(TransportError::InvalidPath(
                "workspace paths must be relative".to_owned(),
            ));
        }
        for component in candidate.components() {
            match component {
                Component::CurDir | Component::Normal(_) => {}
                _ => {
                    return Err(TransportError::InvalidPath(format!(
                        "workspace path escapes root: {trimmed}"
                    )));
                }
            }
        }
        let resolved = self.root.join(candidate);
        let mut existing = resolved.as_path();
        while std::fs::symlink_metadata(existing).is_err() {
            existing = existing.parent().ok_or_else(|| {
                TransportError::InvalidPath("workspace path has no existing ancestor".into())
            })?;
        }
        let canonical = std::fs::canonicalize(existing).map_err(|error| {
            TransportError::Io(format!("resolve {}: {error}", existing.display()))
        })?;
        if !canonical.starts_with(&self.root) {
            return Err(TransportError::InvalidPath(format!(
                "workspace path escapes root through a symlink: {trimmed}"
            )));
        }
        Ok(resolved)
    }
}

fn metadata_stat(path: &Path) -> Result<EntryStat, TransportError> {
    let metadata = std::fs::symlink_metadata(path).map_err(|error| match error.kind() {
        std::io::ErrorKind::NotFound => TransportError::NotFound(path.display().to_string()),
        std::io::ErrorKind::PermissionDenied => {
            TransportError::Unauthorized(path.display().to_string())
        }
        _ => TransportError::Io(format!("stat {}: {error}", path.display())),
    })?;
    let kind = if metadata.file_type().is_symlink() {
        EntryKind::Symlink
    } else if metadata.is_dir() {
        EntryKind::Directory
    } else if metadata.is_file() {
        EntryKind::File
    } else {
        EntryKind::Other
    };
    Ok(EntryStat {
        path: path.to_path_buf(),
        kind,
        size_bytes: metadata.len(),
    })
}

#[async_trait]
impl WorkspaceTransport for LocalTransport {
    async fn spawn_shell(&self, command: &str) -> Result<super::WorkspaceProcess, TransportError> {
        let argv = if cfg!(windows) {
            vec![
                "powershell.exe".to_owned(),
                "-NoProfile".to_owned(),
                "-NonInteractive".to_owned(),
                "-Command".to_owned(),
                command.to_owned(),
            ]
        } else {
            vec!["sh".to_owned(), "-lc".to_owned(), command.to_owned()]
        };
        self.spawn(&argv, &std::collections::BTreeMap::new()).await
    }

    async fn spawn(
        &self,
        argv: &[String],
        environment: &std::collections::BTreeMap<String, String>,
    ) -> Result<super::WorkspaceProcess, TransportError> {
        let (program, arguments) = argv
            .split_first()
            .ok_or_else(|| TransportError::Protocol("empty process argv".to_owned()))?;
        let mut command = tokio::process::Command::new(program);
        command
            .args(arguments)
            .envs(environment)
            .current_dir(&self.root)
            .kill_on_drop(true)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());
        #[cfg(windows)]
        command.creation_flags(0x0800_0000);
        let mut child = command
            .spawn()
            .map_err(|error| TransportError::Io(format!("spawn Workspace process: {error}")))?;
        let stdin = child.stdin.take().expect("piped stdin");
        let stdout = child.stdout.take().expect("piped stdout");
        let stderr = child.stderr.take().expect("piped stderr");
        let (lifetime, stop) = tokio::sync::oneshot::channel();
        let (completed, completion) = tokio::sync::oneshot::channel();
        tokio::spawn(async move {
            let exit_code = tokio::select! {
                _ = stop => { let _ = child.kill().await; None },
                result = child.wait() => result.ok().and_then(|status| status.code()),
            };
            let _ = completed.send(exit_code);
        });
        Ok(super::WorkspaceProcess::new(
            stdin, stdout, stderr, lifetime, completion,
        ))
    }
    fn kind(&self) -> TransportKind {
        TransportKind::Local
    }

    fn execution_sandbox(&self) -> crate::execution::SandboxCapabilities {
        crate::sandbox::capabilities()
    }

    async fn probe(&self) -> Result<(), TransportError> {
        if self.root.is_dir() {
            Ok(())
        } else {
            Err(TransportError::NotFound(self.root.display().to_string()))
        }
    }

    async fn stat(&self, relative: &str) -> Result<EntryStat, TransportError> {
        let resolved = self.resolve(relative)?;
        metadata_stat(&resolved)
    }

    async fn list_directory(&self, relative: &str) -> Result<Vec<EntryStat>, TransportError> {
        let resolved = self.resolve(relative)?;
        let iterator = std::fs::read_dir(&resolved).map_err(|error| match error.kind() {
            std::io::ErrorKind::NotFound => {
                TransportError::NotFound(resolved.display().to_string())
            }
            std::io::ErrorKind::PermissionDenied => {
                TransportError::Unauthorized(resolved.display().to_string())
            }
            _ => TransportError::Io(format!("read_dir {}: {error}", resolved.display())),
        })?;
        let mut entries = Vec::new();
        for entry in iterator {
            let entry =
                entry.map_err(|error| TransportError::Io(format!("iterate directory: {error}")))?;
            entries.push(metadata_stat(&entry.path())?);
        }
        entries.sort_by(|left, right| left.path.cmp(&right.path));
        Ok(entries)
    }

    async fn read_file(&self, relative: &str) -> Result<Vec<u8>, TransportError> {
        let resolved = self.resolve(relative)?;
        std::fs::read(&resolved).map_err(|error| match error.kind() {
            std::io::ErrorKind::NotFound => {
                TransportError::NotFound(resolved.display().to_string())
            }
            std::io::ErrorKind::PermissionDenied => {
                TransportError::Unauthorized(resolved.display().to_string())
            }
            _ => TransportError::Io(format!("read {}: {error}", resolved.display())),
        })
    }

    async fn write_file(&self, relative: &str, bytes: &[u8]) -> Result<(), TransportError> {
        let resolved = self.resolve(relative)?;
        let parent = resolved.parent().ok_or_else(|| {
            TransportError::InvalidPath("workspace file has no parent".to_owned())
        })?;
        std::fs::create_dir_all(parent)
            .map_err(|error| TransportError::Io(format!("create {}: {error}", parent.display())))?;
        let mut temporary = tempfile::NamedTempFile::new_in(parent)
            .map_err(|error| TransportError::Io(format!("create temporary file: {error}")))?;
        std::io::Write::write_all(&mut temporary, bytes)
            .map_err(|error| TransportError::Io(format!("write temporary file: {error}")))?;
        temporary
            .as_file()
            .sync_all()
            .map_err(|error| TransportError::Io(format!("sync temporary file: {error}")))?;
        for attempt in 0..8 {
            match temporary.persist(&resolved) {
                Ok(_) => return Ok(()),
                Err(error) => {
                    // Windows can briefly deny replacement while another atomic
                    // writer releases the previous destination. Keep the same
                    // temporary file and never remove the destination first.
                    let retry =
                        cfg!(windows) && matches!(error.error.raw_os_error(), Some(5 | 32 | 33));
                    if !retry || attempt == 7 {
                        return Err(TransportError::Io(format!(
                            "replace {}: {error}",
                            resolved.display()
                        )));
                    }
                    temporary = error.file;
                    tokio::time::sleep(std::time::Duration::from_millis(5 * (attempt + 1))).await;
                }
            }
        }
        unreachable!("the final persist attempt returns success or an error")
    }

    async fn exec_scoped(
        &self,
        argv: &[String],
        cancellation: processkit::CancellationToken,
    ) -> Result<ExecOutcome, TransportError> {
        crate::sandbox::execute(&self.root, argv, cancellation).await
    }

    async fn exec_with_permissions(
        &self,
        argv: &[String],
        permissions: &crate::execution::ExecutionPermissions,
        cancellation: processkit::CancellationToken,
    ) -> Result<ExecOutcome, TransportError> {
        crate::sandbox::execute_with_permissions(&self.root, argv, permissions, cancellation).await
    }

    async fn exec(&self, argv: &[String]) -> Result<ExecOutcome, TransportError> {
        let (program, rest) = argv
            .split_first()
            .ok_or_else(|| TransportError::InvalidPath("exec argv is empty".to_owned()))?;
        let mut command = Command::new(program).args(rest);
        command = command
            .current_dir(&self.root)
            .stdin(Stdin::empty())
            .timeout(EXEC_TIMEOUT)
            .output_buffer(
                OutputBufferPolicy::bounded(usize::MAX).with_max_bytes(MAX_STDOUT_BYTES),
            );
        let result = command
            .output_bytes()
            .await
            .map_err(|error| TransportError::Io(format!("run local command: {error}")))?;
        let stderr_source = result.stderr().as_bytes();
        let stderr = if stderr_source.len() > MAX_STDERR_BYTES {
            stderr_source[..MAX_STDERR_BYTES].to_vec()
        } else {
            stderr_source.to_vec()
        };
        let exit_code = result.code().unwrap_or(-1);
        let stdout = result.into_stdout();
        Ok(ExecOutcome {
            exit_code,
            stdout,
            stderr,
        })
    }

    async fn exec_shell(&self, shell_command: &str) -> Result<ExecOutcome, TransportError> {
        let argv = if cfg!(windows) {
            vec![
                "powershell.exe".to_owned(),
                "-NoProfile".to_owned(),
                "-NonInteractive".to_owned(),
                "-Command".to_owned(),
                shell_command.to_owned(),
            ]
        } else {
            vec!["sh".to_owned(), "-lc".to_owned(), shell_command.to_owned()]
        };
        self.exec(&argv).await
    }
}
#[cfg(test)]
mod boundary_tests {
    use super::*;
    #[cfg(unix)]
    #[tokio::test]
    async fn symlink_targets_outside_the_workspace_cannot_be_read_or_written() {
        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        std::fs::write(outside.path().join("secret"), b"private").unwrap();
        std::os::unix::fs::symlink(outside.path(), root.path().join("escape")).unwrap();
        let transport = LocalTransport::new(root.path().to_path_buf()).unwrap();
        assert!(matches!(
            transport.read_file("escape/secret").await,
            Err(TransportError::InvalidPath(_))
        ));
        assert!(matches!(
            transport.write_file("escape/new/sub/file", b"bad").await,
            Err(TransportError::InvalidPath(_))
        ));
        assert!(!outside.path().join("new").exists());
        std::os::unix::fs::symlink(outside.path().join("secret"), root.path().join("file"))
            .unwrap();
        assert!(transport.write_file("file", b"bad").await.is_err());
        assert_eq!(
            std::fs::read(outside.path().join("secret")).unwrap(),
            b"private"
        );
    }
    #[test]
    fn concurrent_atomic_writes_use_independent_temporary_files() {
        let root = tempfile::tempdir().unwrap();
        let transport = Arc::new(LocalTransport::new(root.path().to_path_buf()).unwrap());
        let barrier = Arc::new(std::sync::Barrier::new(4));
        let workers = (0_u8..4)
            .map(|value| {
                let transport = transport.clone();
                let barrier = barrier.clone();
                std::thread::spawn(move || {
                    let runtime = tokio::runtime::Builder::new_current_thread()
                        .enable_all()
                        .build()
                        .unwrap();
                    barrier.wait();
                    for _ in 0..4 {
                        runtime
                            .block_on(transport.write_file("shared", &vec![value; 64 * 1024]))
                            .unwrap();
                    }
                })
            })
            .collect::<Vec<_>>();
        for worker in workers {
            worker.join().unwrap();
        }
        let contents = std::fs::read(root.path().join("shared")).unwrap();
        assert_eq!(contents.len(), 64 * 1024);
        assert!(contents.iter().all(|value| *value == contents[0]));
        assert_eq!(std::fs::read_dir(root.path()).unwrap().count(), 1);
    }
    use std::sync::Arc;
}
