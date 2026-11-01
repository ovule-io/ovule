use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use processkit::{CancellationToken, Command, OutputBufferPolicy, ProcessEvent, Stdin};
use tokio::io::{AsyncReadExt as _, AsyncWriteExt as _};
use tokio_stream::StreamExt as _;

use ovule_hosts::{WorkspaceTransport, WorkspaceTransportResolver};
use ovule_toolchains as toolchains;
use ovule_workspace::state::{TerminalSpec, external_path};

use crate::{
    TerminalExecutor, TerminalFinished, TerminalOutcome, TerminalOutput, TerminalRegistered,
    TerminalStreaming,
};

const COMMAND_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_CAPTURE_LINES: usize = 2_000;
const MAX_CAPTURE_BYTES: usize = 512 * 1_024;

pub(crate) struct NativeTerminalRuntime {
    runtime: Option<tokio::runtime::Runtime>,
    runs: Arc<Mutex<HashMap<String, CancellationToken>>>,
    managed_toolchains: PathBuf,
    active: Arc<AtomicBool>,
    transports: Arc<dyn WorkspaceTransportResolver>,
}

#[derive(Clone)]
struct TerminalHandle {
    runtime: tokio::runtime::Handle,
    runs: Arc<Mutex<HashMap<String, CancellationToken>>>,
    managed_toolchains: PathBuf,
    active: Arc<AtomicBool>,
    transports: Arc<dyn WorkspaceTransportResolver>,
}

impl NativeTerminalRuntime {
    pub fn new(
        managed_toolchains: PathBuf,
        transports: Arc<dyn WorkspaceTransportResolver>,
    ) -> Result<Self, String> {
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .thread_name("ovule-terminal")
            .enable_all()
            .build()
            .map_err(|error| format!("create Terminal runtime: {error}"))?;
        Ok(Self {
            runtime: Some(runtime),
            runs: Arc::new(Mutex::new(HashMap::new())),
            managed_toolchains,
            active: Arc::new(AtomicBool::new(true)),
            transports,
        })
    }

    fn handle(&self) -> TerminalHandle {
        TerminalHandle {
            runtime: self
                .runtime
                .as_ref()
                .expect("Terminal handle requested during shutdown")
                .handle()
                .clone(),
            runs: Arc::clone(&self.runs),
            managed_toolchains: self.managed_toolchains.clone(),
            active: Arc::clone(&self.active),
            transports: Arc::clone(&self.transports),
        }
    }

    pub fn shutdown(&mut self, timeout: Duration) {
        let deadline = Instant::now() + timeout;
        {
            // Admission and shutdown use the same lock: no run can appear after
            // the cancellation snapshot has been taken.
            let runs = lock(&self.runs);
            self.active.store(false, Ordering::Release);
            for token in runs.values() {
                token.cancel();
            }
        }
        while !lock(&self.runs).is_empty() && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(20));
        }
        if let Some(runtime) = self.runtime.take() {
            runtime.shutdown_timeout(deadline.saturating_duration_since(Instant::now()));
        }
    }
}

impl TerminalHandle {
    pub(crate) fn spawn(
        &self,
        spec: TerminalSpec,
        registered: impl FnOnce() -> Result<(), String>,
        streaming: impl Fn(TerminalOutput) + Send + Sync + 'static,
        finished: impl FnOnce(TerminalOutcome) + Send + 'static,
    ) -> Result<(), String> {
        let token = CancellationToken::new();
        let observer = token.clone();
        {
            let mut runs = lock(&self.runs);
            if !self.active.load(Ordering::Acquire) {
                return Err("Terminal runtime is shutting down".to_owned());
            }
            match runs.entry(spec.id.clone()) {
                std::collections::hash_map::Entry::Vacant(entry) => {
                    entry.insert(token.clone());
                }
                std::collections::hash_map::Entry::Occupied(_) => {
                    return Err(format!("Terminal run already active: {}", spec.id));
                }
            }
        }
        if let Err(error) = registered() {
            lock(&self.runs).remove(&spec.id);
            return Err(error);
        }
        let runs = Arc::clone(&self.runs);
        let managed_toolchains = self.managed_toolchains.clone();
        let transports = Arc::clone(&self.transports);
        self.runtime.spawn(async move {
            let outcome = execute(
                spec,
                token,
                observer,
                &managed_toolchains,
                transports.as_ref(),
                &streaming,
            )
            .await;
            lock(&runs).remove(&outcome.id);
            finished(outcome);
        });
        Ok(())
    }

    pub(crate) fn cancel(
        &self,
        id: &str,
        registered: impl FnOnce() -> Result<(), String>,
    ) -> Result<(), String> {
        let token = lock(&self.runs)
            .get(id)
            .cloned()
            .ok_or_else(|| format!("Terminal run is not active: {id}"))?;
        registered()?;
        token.cancel();
        Ok(())
    }
}

impl TerminalExecutor for TerminalHandle {
    fn spawn(
        &self,
        spec: TerminalSpec,
        registered: TerminalRegistered,
        streaming: TerminalStreaming,
        finished: TerminalFinished,
    ) -> Result<(), String> {
        TerminalHandle::spawn(self, spec, registered, streaming, finished)
    }

    fn cancel(&self, id: &str, registered: TerminalRegistered) -> Result<(), String> {
        TerminalHandle::cancel(self, id, registered)
    }
}

#[allow(clippy::too_many_lines)]
async fn execute(
    spec: TerminalSpec,
    cancellation: CancellationToken,
    observer: CancellationToken,
    managed_toolchains: &std::path::Path,
    transports: &dyn WorkspaceTransportResolver,
    streaming: &(dyn Fn(TerminalOutput) + Send + Sync),
) -> TerminalOutcome {
    if spec.workspace_binding_id.is_some() {
        match transports.resolve(spec.workspace_binding_id.as_deref(), &spec.workspace_path) {
            Ok(transport) if transport.kind() != ovule_hosts::TransportKind::Local => {
                return execute_remote(spec, cancellation, observer, transport.as_ref(), streaming)
                    .await;
            }
            Err(error) => {
                return TerminalOutcome {
                    id: spec.id,
                    status: "failed".to_owned(),
                    stdout: String::new(),
                    stderr: error.to_string(),
                    exit_code: None,
                };
            }
            Ok(_) => {}
        }
    }
    let mut command = if cfg!(windows) {
        Command::new("powershell.exe").args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            &spec.command,
        ])
    } else {
        // Login profiles can replace the Toolchain PATH prepared below.
        Command::new("sh").args(["-c", &spec.command])
    };
    command = command
        .env(
            "PATH",
            toolchains::execution_path(managed_toolchains)
                .unwrap_or_else(|_| std::env::var_os("PATH").unwrap_or_default()),
        )
        .create_no_window()
        .current_dir(PathBuf::from(external_path(std::path::Path::new(
            &spec.workspace_path,
        ))))
        .stdin(Stdin::empty())
        .cancel_on(cancellation)
        .timeout(COMMAND_TIMEOUT)
        .output_buffer(
            OutputBufferPolicy::bounded(MAX_CAPTURE_LINES).with_max_bytes(MAX_CAPTURE_BYTES),
        );
    let mut running = match command.start().await {
        Ok(running) => running,
        Err(error) => {
            return TerminalOutcome {
                id: spec.id,
                status: if error.is_cancelled() {
                    "cancelled"
                } else {
                    "failed"
                }
                .to_owned(),
                stdout: String::new(),
                stderr: error.to_string(),
                exit_code: None,
            };
        }
    };
    let mut events = match running.events() {
        Ok(events) => events,
        Err(error) => {
            return TerminalOutcome {
                id: spec.id,
                status: "failed".to_owned(),
                stdout: String::new(),
                stderr: error.to_string(),
                exit_code: None,
            };
        }
    };
    let run_id = spec.id.clone();
    let owner_id = spec.owner_id.clone();
    let consume = async {
        let mut stdout = String::new();
        let mut stderr = String::new();
        let mut captured_lines = 0_usize;
        let mut sequence = 0_u64;
        while let Some(event) = events.next().await {
            let (stream, line, destination) = match event {
                ProcessEvent::Stdout(line) => ("stdout", line.into_text(), &mut stdout),
                ProcessEvent::Stderr(line) => ("stderr", line.into_text(), &mut stderr),
                _ => continue,
            };
            let delta = format!("{line}\n");
            append_bounded(destination, &delta, &mut captured_lines);
            sequence = sequence.saturating_add(1);
            streaming(TerminalOutput {
                id: run_id.clone(),
                owner_id: owner_id.clone(),
                sequence,
                stream,
                delta,
            });
        }
        (stdout, stderr)
    };
    let (captured, result) = tokio::join!(consume, running.finish());
    let (stdout, stderr) = captured;
    match result {
        Ok(output) => TerminalOutcome {
            id: spec.id,
            status: if observer.is_cancelled() {
                "cancelled"
            } else if output.outcome.code() == Some(0) {
                "succeeded"
            } else {
                "failed"
            }
            .to_owned(),
            stdout,
            stderr,
            exit_code: output.outcome.code(),
        },
        Err(error) => TerminalOutcome {
            id: spec.id,
            status: if error.is_cancelled() {
                "cancelled"
            } else {
                "failed"
            }
            .to_owned(),
            stdout,
            stderr: if stderr.is_empty() {
                error.to_string()
            } else {
                format!("{stderr}{error}")
            },
            exit_code: None,
        },
    }
}

async fn execute_remote(
    spec: TerminalSpec,
    cancellation: CancellationToken,
    observer: CancellationToken,
    transport: &dyn WorkspaceTransport,
    streaming: &(dyn Fn(TerminalOutput) + Send + Sync),
) -> TerminalOutcome {
    let mut process = match transport.spawn_shell(&spec.command).await {
        Ok(process) => process,
        Err(error) => {
            return failed_remote_outcome(spec.id, error.to_string());
        }
    };
    let _ = process.stdin.shutdown().await;
    let mut stdout = String::new();
    let mut stderr = String::new();
    let mut stdout_buffer = vec![0_u8; 8 * 1024];
    let mut stderr_buffer = vec![0_u8; 8 * 1024];
    let mut stdout_open = true;
    let mut stderr_open = true;
    let mut captured_lines = 0_usize;
    let mut sequence = 0_u64;
    let mut cancelled = false;
    let mut timed_out = false;
    let mut stream_error = None;
    let deadline = tokio::time::sleep(COMMAND_TIMEOUT);
    tokio::pin!(deadline);
    while stdout_open || stderr_open {
        let (stream, bytes) = tokio::select! {
            () = cancellation.cancelled() => {
                cancelled = true;
                break;
            }
            () = &mut deadline => {
                timed_out = true;
                break;
            }
            result = process.stdout.read(&mut stdout_buffer), if stdout_open => match result {
                Ok(0) => { stdout_open = false; continue; }
                Ok(length) => ("stdout", &stdout_buffer[..length]),
                Err(error) => {
                    stdout_open = false;
                    stream_error = Some(format!("read remote stdout: {error}"));
                    continue;
                }
            },
            result = process.stderr.read(&mut stderr_buffer), if stderr_open => match result {
                Ok(0) => { stderr_open = false; continue; }
                Ok(length) => ("stderr", &stderr_buffer[..length]),
                Err(error) => {
                    stderr_open = false;
                    stream_error = Some(format!("read remote stderr: {error}"));
                    continue;
                }
            },
        };
        let delta = String::from_utf8_lossy(bytes).into_owned();
        let destination = if stream == "stdout" {
            &mut stdout
        } else {
            &mut stderr
        };
        append_bounded(destination, &delta, &mut captured_lines);
        sequence = sequence.saturating_add(1);
        streaming(TerminalOutput {
            id: spec.id.clone(),
            owner_id: spec.owner_id.clone(),
            sequence,
            stream,
            delta,
        });
    }
    let exit_code = if cancelled || timed_out {
        None
    } else {
        tokio::time::timeout(Duration::from_secs(2), process.wait())
            .await
            .ok()
            .flatten()
    };
    if timed_out {
        append_bounded(
            &mut stderr,
            "Remote terminal command timed out\n",
            &mut captured_lines,
        );
    }
    if let Some(error) = stream_error.as_ref() {
        append_bounded(&mut stderr, &format!("{error}\n"), &mut captured_lines);
    }
    let cancelled = cancelled || observer.is_cancelled();
    TerminalOutcome {
        id: spec.id,
        status: if cancelled {
            "cancelled"
        } else if !timed_out && stream_error.is_none() && exit_code == Some(0) {
            "succeeded"
        } else {
            "failed"
        }
        .to_owned(),
        stdout,
        stderr,
        exit_code,
    }
}

fn failed_remote_outcome(id: String, stderr: String) -> TerminalOutcome {
    TerminalOutcome {
        id,
        status: "failed".to_owned(),
        stdout: String::new(),
        stderr,
        exit_code: None,
    }
}

fn append_bounded(output: &mut String, delta: &str, captured_lines: &mut usize) {
    if *captured_lines >= MAX_CAPTURE_LINES || output.len() >= MAX_CAPTURE_BYTES {
        return;
    }
    *captured_lines += 1;
    let remaining = MAX_CAPTURE_BYTES - output.len();
    if delta.len() <= remaining {
        output.push_str(delta);
        return;
    }
    let mut boundary = remaining;
    while boundary > 0 && !delta.is_char_boundary(boundary) {
        boundary -= 1;
    }
    output.push_str(&delta[..boundary]);
}

#[cfg(test)]
mod capture_tests {
    use super::*;

    #[test]
    fn bounded_capture_preserves_utf8_boundaries_and_line_limit() {
        let mut output = "x".repeat(MAX_CAPTURE_BYTES - 3);
        let mut lines = 0;
        append_bounded(&mut output, "界\n", &mut lines);
        assert!(output.ends_with('界'));
        assert_eq!(output.len(), MAX_CAPTURE_BYTES);
        assert_eq!(lines, 1);

        lines = MAX_CAPTURE_LINES;
        append_bounded(&mut output, "ignored\n", &mut lines);
        assert_eq!(output.len(), MAX_CAPTURE_BYTES);
    }
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

#[cfg(test)]
mod tests {
    use super::*;

    struct LocalResolver;

    #[test]
    fn duplicate_run_admission_does_not_replace_the_original_cancellation_token() {
        let directory = tempfile::tempdir().unwrap();
        let mut runtime =
            NativeTerminalRuntime::new(directory.path().into(), Arc::new(LocalResolver)).unwrap();
        let handle = runtime.handle();
        let original = CancellationToken::new();
        lock(&handle.runs).insert("duplicate".into(), original.clone());
        let error = handle
            .spawn(
                TerminalSpec {
                    id: "duplicate".into(),
                    command: "echo ignored".into(),
                    workspace_path: directory.path().to_string_lossy().into_owned(),
                    owner_id: None,
                    workspace_binding_id: None,
                },
                || panic!("duplicate must not register"),
                |_| {},
                |_| {},
            )
            .unwrap_err();
        assert!(error.contains("already active"));
        handle.cancel("duplicate", || Ok(())).unwrap();
        assert!(original.is_cancelled());
        lock(&handle.runs).clear();
        runtime.shutdown(Duration::from_secs(1));
    }

    impl WorkspaceTransportResolver for LocalResolver {
        fn resolve(
            &self,
            _binding_id: Option<&str>,
            fallback_root: &str,
        ) -> Result<Arc<dyn WorkspaceTransport>, ovule_hosts::TransportError> {
            ovule_hosts::providers::local(PathBuf::from(fallback_root))
        }
    }

    #[test]
    fn lifecycle_executor_finishes_commands_and_rejects_work_after_stop() {
        let workspace = tempfile::tempdir().unwrap();
        let mut runtime =
            NativeTerminalRuntime::new(workspace.path().to_path_buf(), Arc::new(LocalResolver))
                .unwrap();
        let executor = crate::TerminalRuntime::executor(&runtime);
        let (finished, receiver) = std::sync::mpsc::channel();
        let spec = TerminalSpec {
            id: "runtime-test".to_owned(),
            command: "echo terminal-runtime".to_owned(),
            workspace_path: workspace.path().to_string_lossy().into_owned(),
            owner_id: None,
            workspace_binding_id: None,
        };
        executor
            .spawn(
                spec.clone(),
                Box::new(|| Ok(())),
                Box::new(|_| {}),
                Box::new(move |outcome| {
                    finished.send(outcome).unwrap();
                }),
            )
            .unwrap();
        let outcome = receiver.recv_timeout(Duration::from_secs(10)).unwrap();
        assert_eq!(outcome.status, "succeeded", "{}", outcome.stderr);
        assert!(outcome.stdout.contains("terminal-runtime"));
        crate::TerminalRuntime::stop(&mut runtime, Duration::from_secs(1));
        let error = executor
            .spawn(
                spec,
                Box::new(|| Ok(())),
                Box::new(|_| {}),
                Box::new(|_| {}),
            )
            .unwrap_err();
        assert_eq!(error, "Terminal runtime is shutting down");
    }

    #[cfg(unix)]
    #[test]
    fn terminal_resolves_managed_toolchains_before_system_commands() {
        use std::os::unix::fs::PermissionsExt as _;
        let workspace = tempfile::tempdir().unwrap();
        let managed = workspace.path().join("toolchains");
        let registry: serde_json::Value =
            serde_json::from_str(include_str!("../../../desktop/toolchains/registry.json"))
                .unwrap();
        let node = registry["toolchains"]
            .as_array()
            .unwrap()
            .iter()
            .find(|value| value["id"] == "nodejs")
            .unwrap();
        let executable = managed
            .join("installs/nodejs")
            .join(node["provider"]["version"].as_str().unwrap())
            .join("bin/node");
        std::fs::create_dir_all(executable.parent().unwrap()).unwrap();
        std::fs::write(
            &executable,
            "#!/bin/sh\nprintf 'managed-toolchain-terminal\\n'\n",
        )
        .unwrap();
        std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o755)).unwrap();
        let mut runtime = NativeTerminalRuntime::new(managed, Arc::new(LocalResolver)).unwrap();
        let executor = crate::TerminalRuntime::executor(&runtime);
        let (finished, receiver) = std::sync::mpsc::channel();
        executor
            .spawn(
                TerminalSpec {
                    id: "managed-path-test".to_owned(),
                    command: "node --version".to_owned(),
                    workspace_path: workspace.path().to_string_lossy().into_owned(),
                    owner_id: None,
                    workspace_binding_id: None,
                },
                Box::new(|| Ok(())),
                Box::new(|_| {}),
                Box::new(move |outcome| {
                    finished.send(outcome).unwrap();
                }),
            )
            .unwrap();
        let outcome = receiver.recv_timeout(Duration::from_secs(10)).unwrap();
        assert_eq!(outcome.status, "succeeded", "{}", outcome.stderr);
        assert!(
            outcome.stdout.contains("managed-toolchain-terminal"),
            "{}",
            outcome.stdout
        );
        crate::TerminalRuntime::stop(&mut runtime, Duration::from_secs(1));
    }

    #[test]
    fn terminal_commands_never_create_a_windows_console() {
        let command = Command::new("powershell.exe").create_no_window();
        assert!(format!("{command:?}").contains("creation_flags_extra: 134217728"));
    }
}

impl Drop for NativeTerminalRuntime {
    fn drop(&mut self) {
        self.shutdown(Duration::from_secs(5));
    }
}

impl crate::TerminalRuntime for NativeTerminalRuntime {
    fn executor(&self) -> Arc<dyn TerminalExecutor> {
        Arc::new(self.handle())
    }

    fn stop(&mut self, timeout: Duration) {
        self.shutdown(timeout);
    }
}
