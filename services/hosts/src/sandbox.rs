//! Fail-closed workspace command isolation. Driver processes use a separate trust boundary.
use crate::{ExecOutcome, TransportError};
#[cfg(target_os = "macos")]
use std::fmt::Write;
use std::path::Path;

pub(crate) fn capabilities() -> crate::execution::SandboxCapabilities {
    #[cfg(target_os = "macos")]
    if Path::new("/usr/bin/sandbox-exec").is_file() {
        return crate::execution::SandboxCapabilities {
            backend: "macos_seatbelt".into(),
            available: true,
            scoped_permissions: true,
            reason: None,
        };
    }
    crate::execution::SandboxCapabilities::unavailable(
        "A qualified OS sandbox is not available on this host; agent commands are disabled",
    )
}

pub(crate) async fn execute(
    root: &Path,
    argv: &[String],
    cancellation: processkit::CancellationToken,
) -> Result<ExecOutcome, TransportError> {
    execute_with_permissions(
        root,
        argv,
        &crate::execution::ExecutionPermissions::default(),
        cancellation,
    )
    .await
}

#[cfg_attr(not(target_os = "macos"), allow(clippy::unused_async))]
pub(crate) async fn execute_with_permissions(
    root: &Path,
    argv: &[String],
    permissions: &crate::execution::ExecutionPermissions,
    cancellation: processkit::CancellationToken,
) -> Result<ExecOutcome, TransportError> {
    let capability = capabilities();
    if !capability.available {
        return Err(TransportError::Unavailable(
            capability.reason.unwrap_or_default(),
        ));
    }
    permissions.validate()?;
    #[cfg(target_os = "macos")]
    {
        use processkit::{Command, OutputBufferPolicy, Stdin};
        let canonical_root =
            std::fs::canonicalize(root).map_err(|e| TransportError::InvalidPath(e.to_string()))?;
        let root = canonical_root.as_path();
        let program = argv
            .first()
            .ok_or_else(|| TransportError::Protocol("empty command".into()))?;
        if root.parent().is_none() {
            return Err(TransportError::Unauthorized(
                "filesystem root cannot be a sandbox workspace".into(),
            ));
        }
        let requested =
            if program.contains(std::path::MAIN_SEPARATOR) && Path::new(program).is_relative() {
                root.join(program)
            } else {
                program.into()
            };
        let executable = which::which(requested)
            .map_err(|e| TransportError::Unavailable(format!("resolve command: {e}")))?;
        let executable =
            std::fs::canonicalize(executable).map_err(|e| TransportError::Io(e.to_string()))?;
        let temporary = tempfile::tempdir().map_err(|e| TransportError::Io(e.to_string()))?;
        let temp_root = std::fs::canonicalize(temporary.path())
            .map_err(|e| TransportError::Io(e.to_string()))?;
        let mut profile = profile(root, &temp_root, &executable)?;
        for (operation, paths) in [
            ("file-read*", &permissions.read_paths),
            ("file-write*", &permissions.write_paths),
        ] {
            for path in paths {
                let path = serde_json::to_string(path.to_str().ok_or_else(|| {
                    TransportError::InvalidPath("permission path must be Unicode".into())
                })?)
                .map_err(|error| TransportError::Protocol(error.to_string()))?;
                writeln!(profile, "\n(allow {operation} (subpath {path}))")
                    .expect("write to String");
            }
        }
        if permissions.network {
            // Public resolver/TLS runtime configuration is necessary for system clients.
            // Keep these exact files separate from arbitrary user read grants.
            profile.push_str(r#"
(allow network*)
(allow file-read* (literal "/private/etc/ssl/openssl.cnf") (literal "/private/etc/ssl/cert.pem") (literal "/private/etc/hosts") (literal "/private/etc/resolv.conf") (literal "/private/var/run/resolv.conf"))
"#);
        }
        if permissions.process_info {
            profile.push_str("\n(allow process-info*)\n");
        } else {
            profile.push_str("\n(deny process-info* (require-not (target self)))\n");
        }
        let output = Command::new("/usr/bin/sandbox-exec")
            .args(["-p", &profile])
            .arg(executable.as_os_str())
            .args(&argv[1..])
            .current_dir(root)
            .env_clear()
            .env("PATH", "/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin")
            .env("HOME", temp_root.as_os_str())
            .env("TMPDIR", temp_root.as_os_str())
            .stdin(Stdin::empty())
            .cancel_on(cancellation)
            .timeout(std::time::Duration::from_secs(30))
            .output_buffer(OutputBufferPolicy::bounded(usize::MAX).with_max_bytes(512 * 1024))
            .output_bytes()
            .await
            .map_err(|e| TransportError::Io(format!("sandbox command: {e}")))?;
        let exit_code = output.code().unwrap_or(-1);
        let stderr = output
            .stderr()
            .as_bytes()
            .iter()
            .take(256 * 1024)
            .copied()
            .collect();
        Ok(ExecOutcome {
            exit_code,
            stderr,
            stdout: output.into_stdout(),
        })
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (root, argv, cancellation);
        Err(TransportError::Unavailable(
            "workspace command sandbox is not qualified on this platform".into(),
        ))
    }
}

#[cfg(target_os = "macos")]
fn profile(root: &Path, temp: &Path, executable_path: &Path) -> Result<String, TransportError> {
    // JSON string escaping is also valid for these SBPL string literals. Reject
    // non-Unicode paths rather than widening the sandbox with a lossy conversion.
    let quote = |path: &Path| {
        path.to_str()
            .map(|s| serde_json::to_string(s).expect("string serializes"))
            .ok_or_else(|| TransportError::InvalidPath("sandbox path must be Unicode".into()))
    };
    Ok(format!(
        r#"(version 1)
(deny default)
(allow process-exec process-fork)
(allow signal (target same-sandbox))
(allow process-info* (target same-sandbox))
(allow sysctl-read)
(allow mach-lookup (global-name "com.apple.system.opendirectoryd.libinfo") (global-name "com.apple.secinitd") (global-name "com.apple.logd"))
(allow file-read-metadata)
(allow file-read* (literal "/") (subpath "/System") (subpath "/usr") (subpath "/bin") (subpath "/sbin") (subpath "/opt/homebrew") (subpath "/Library/Developer") (subpath "/private/var/db/dyld") (subpath "/dev") (literal "/private/etc/localtime") (subpath {root}) (subpath {temp}) (literal {executable}))
(allow file-read* (literal "/Library/Apple/usr/libexec/oah/libRosettaRuntime"))
(allow file-write* (subpath {root}) (subpath {temp}) (literal "/dev/null") (literal "/dev/tty"))
"#,
        root = quote(root)?,
        temp = quote(temp)?,
        executable = quote(executable_path)?
    ))
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;
    use tokio::io::AsyncWriteExt;
    #[tokio::test]
    async fn permission_grants_are_independent_and_do_not_survive_the_call() {
        let workspace = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let outside_root = std::fs::canonicalize(outside.path()).unwrap();
        let secret = outside_root.join("fixture.txt");
        std::fs::write(&secret, "fixture").unwrap();
        let argv = vec!["/bin/cat".into(), secret.to_str().unwrap().into()];
        let denied = execute(
            workspace.path(),
            &argv,
            processkit::CancellationToken::new(),
        )
        .await
        .unwrap();
        assert_ne!(denied.exit_code, 0);
        let read = crate::execution::ExecutionPermissions {
            read_paths: vec![secret.clone()],
            ..Default::default()
        };
        let allowed = execute_with_permissions(
            workspace.path(),
            &argv,
            &read,
            processkit::CancellationToken::new(),
        )
        .await
        .unwrap();
        assert_eq!(
            allowed.exit_code,
            0,
            "{}",
            String::from_utf8_lossy(&allowed.stderr)
        );
        assert_eq!(allowed.stdout, b"fixture");
        let write = vec![
            "/bin/sh".into(),
            "-c".into(),
            format!("printf changed > '{}'", secret.display()),
        ];
        assert_ne!(
            execute_with_permissions(
                workspace.path(),
                &write,
                &read,
                processkit::CancellationToken::new()
            )
            .await
            .unwrap()
            .exit_code,
            0
        );
        let grants = crate::execution::ExecutionPermissions {
            write_paths: vec![outside_root],
            ..Default::default()
        };
        assert_eq!(
            execute_with_permissions(
                workspace.path(),
                &write,
                &grants,
                processkit::CancellationToken::new()
            )
            .await
            .unwrap()
            .exit_code,
            0
        );
        assert_eq!(std::fs::read_to_string(&secret).unwrap(), "changed");
        assert_ne!(
            execute(
                workspace.path(),
                &argv,
                processkit::CancellationToken::new()
            )
            .await
            .unwrap()
            .exit_code,
            0
        );
    }
    #[tokio::test]
    async fn network_grant_allows_the_requested_call_to_connect() {
        let workspace = tempfile::tempdir().unwrap();
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            stream
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok")
                .await
                .unwrap();
        });
        let argv = vec![
            "/usr/bin/curl".into(),
            "--max-time".into(),
            "2".into(),
            format!("http://{address}"),
        ];
        let permissions = crate::execution::ExecutionPermissions {
            network: true,
            ..Default::default()
        };
        let outcome = execute_with_permissions(
            workspace.path(),
            &argv,
            &permissions,
            processkit::CancellationToken::new(),
        )
        .await
        .unwrap();
        assert_eq!(
            outcome.exit_code,
            0,
            "{}",
            String::from_utf8_lossy(&outcome.stderr)
        );
        assert_eq!(outcome.stdout, b"ok");
        server.await.unwrap();
    }
    #[tokio::test]
    async fn process_inspection_grant_allows_unprivileged_task_info_queries() {
        let workspace = tempfile::tempdir().unwrap();
        let source = workspace.path().join("inspect.c");
        let helper = workspace.path().join("inspect");
        std::fs::write(
            &source,
            r#"
#include <libproc.h>
#include <stdlib.h>
#include <stdio.h>
int main(int argc, char **argv) {
    if (argc != 2) return 2;
    struct proc_taskinfo task;
    if (proc_pidinfo(atoi(argv[1]), PROC_PIDTASKINFO, 0, &task, sizeof(task)) != sizeof(task)) { perror("proc_pidinfo"); return 1; }
    printf("%llu\n", (unsigned long long)task.pti_virtual_size); return 0;
}
"#,
        )
        .unwrap();
        let compiled = std::process::Command::new("/usr/bin/clang")
            .arg(&source)
            .arg("-o")
            .arg(&helper)
            .output()
            .unwrap();
        assert!(
            compiled.status.success(),
            "{}",
            String::from_utf8_lossy(&compiled.stderr)
        );
        let argv = vec![
            helper.to_str().unwrap().into(),
            std::process::id().to_string(),
        ];
        let denied = execute(
            workspace.path(),
            &argv,
            processkit::CancellationToken::new(),
        )
        .await
        .unwrap();
        assert_ne!(denied.exit_code, 0);
        let permissions = crate::execution::ExecutionPermissions {
            process_info: true,
            ..Default::default()
        };
        let outcome = execute_with_permissions(
            workspace.path(),
            &argv,
            &permissions,
            processkit::CancellationToken::new(),
        )
        .await
        .unwrap();
        assert_eq!(
            outcome.exit_code,
            0,
            "{}",
            String::from_utf8_lossy(&outcome.stderr)
        );
        assert!(!outcome.stdout.is_empty());
    }
    #[cfg(target_arch = "aarch64")]
    #[tokio::test]
    async fn rosetta_commands_can_load_the_runtime_inside_the_default_sandbox() {
        let workspace = tempfile::tempdir().unwrap();
        let outcome = execute(
            workspace.path(),
            &[
                "/usr/bin/arch".into(),
                "-x86_64".into(),
                "/usr/bin/uname".into(),
                "-m".into(),
            ],
            processkit::CancellationToken::new(),
        )
        .await
        .unwrap();
        assert_eq!(
            outcome.exit_code,
            0,
            "{}",
            String::from_utf8_lossy(&outcome.stderr)
        );
        assert_eq!(outcome.stdout, b"x86_64\n");
    }
    #[tokio::test]
    async fn allows_workspace_writes_but_blocks_outside_reads_writes_and_network() {
        let workspace = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let secret = outside.path().join("secret");
        std::fs::write(&secret, b"private").unwrap();
        let forbidden = outside.path().join("forbidden");
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let endpoint = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            stream
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok")
                .await
                .unwrap();
        });
        let script = format!(
            "printf ok > allowed; cat '{}' >/dev/null && exit 10; printf bad > '{}' 2>/dev/null && exit 11; /usr/bin/curl --connect-timeout 1 --max-time 2 http://{endpoint} >/dev/null 2>&1 && exit 12; exit 0",
            secret.display(),
            forbidden.display()
        );
        let result = execute(
            workspace.path(),
            &["/bin/sh".into(), "-c".into(), script],
            processkit::CancellationToken::new(),
        )
        .await
        .unwrap();
        assert_eq!(
            result.exit_code,
            0,
            "{}",
            String::from_utf8_lossy(&result.stderr)
        );
        assert_eq!(
            std::fs::read(workspace.path().join("allowed")).unwrap(),
            b"ok"
        );
        assert!(!forbidden.exists());
        assert!(
            !server.is_finished(),
            "sandboxed process reached the loopback listener"
        );
        server.abort();
    }
}
