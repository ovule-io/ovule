use super::*;
use std::collections::BTreeMap;
use tokio::io::{AsyncReadExt as _, AsyncWriteExt as _};

fn temp_workspace() -> tempfile::TempDir {
    tempfile::Builder::new()
        .prefix("ovule-transport-")
        .tempdir()
        .expect("workspace tempdir")
}

fn build_runtime() -> tokio::runtime::Runtime {
    tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()
        .expect("test runtime")
}

#[test]
fn local_transport_rejects_absolute_relative_paths() {
    let workspace = temp_workspace();
    let transport = LocalTransport::new(workspace.path().to_path_buf()).unwrap();
    let runtime = build_runtime();
    let error = runtime.block_on(transport.stat("/etc/hosts")).unwrap_err();
    assert!(matches!(error, TransportError::InvalidPath(_)));
}

#[test]
fn local_transport_rejects_parent_traversal() {
    let workspace = temp_workspace();
    let transport = LocalTransport::new(workspace.path().to_path_buf()).unwrap();
    let runtime = build_runtime();
    let error = runtime
        .block_on(transport.read_file("../etc/hosts"))
        .unwrap_err();
    assert!(matches!(error, TransportError::InvalidPath(_)));
}

#[test]
fn local_transport_reads_files_and_lists_directories() {
    let workspace = temp_workspace();
    let file_path = workspace.path().join("notes.txt");
    std::fs::write(&file_path, b"remote workspace contents").unwrap();
    let nested = workspace.path().join("nested");
    std::fs::create_dir_all(&nested).unwrap();
    std::fs::write(nested.join("hello.md"), b"hi").unwrap();

    let transport = LocalTransport::new(workspace.path().to_path_buf()).unwrap();
    let runtime = build_runtime();

    runtime.block_on(transport.probe()).unwrap();

    let stat = runtime.block_on(transport.stat("notes.txt")).unwrap();
    assert_eq!(stat.kind, EntryKind::File);
    assert_eq!(stat.size_bytes, "remote workspace contents".len() as u64);

    let content = runtime.block_on(transport.read_file("notes.txt")).unwrap();
    assert_eq!(content, b"remote workspace contents");
    runtime
        .block_on(transport.write_file("nested/written.txt", b"written"))
        .unwrap();
    assert_eq!(
        std::fs::read(nested.join("written.txt")).unwrap(),
        b"written"
    );

    let entries = runtime.block_on(transport.list_directory(".")).unwrap();
    assert_eq!(entries.len(), 2);
    let kinds = entries.iter().map(|entry| entry.kind).collect::<Vec<_>>();
    assert!(kinds.contains(&EntryKind::File));
    assert!(kinds.contains(&EntryKind::Directory));
}

#[test]
fn local_transport_reports_kind_workspace_kind_local() {
    let workspace = temp_workspace();
    let transport = LocalTransport::new(workspace.path().to_path_buf()).unwrap();
    assert_eq!(transport.kind(), crate::TransportKind::Local);
}

#[test]
fn local_transport_spawns_a_bidirectional_process_with_environment() {
    let workspace = temp_workspace();
    let transport = LocalTransport::new(workspace.path().to_path_buf()).unwrap();
    let runtime = build_runtime();
    runtime.block_on(async {
        let (argv, expected) = if cfg!(windows) {
            (
                vec![
                    "powershell.exe".to_owned(),
                    "-NoProfile".to_owned(),
                    "-Command".to_owned(),
                    "$line=[Console]::In.ReadLine(); [Console]::Out.Write($env:OVULE_SPAWN_TEST + ':' + $line); [Console]::Error.Write('stderr-ok')".to_owned(),
                ],
                "env-ok:stdin-ok",
            )
        } else {
            (
                vec![
                    "sh".to_owned(),
                    "-c".to_owned(),
                    "read line; printf '%s:%s' \"$OVULE_SPAWN_TEST\" \"$line\"; printf stderr-ok >&2".to_owned(),
                ],
                "env-ok:stdin-ok",
            )
        };
        let mut process = transport
            .spawn(
                &argv,
                &BTreeMap::from([("OVULE_SPAWN_TEST".to_owned(), "env-ok".to_owned())]),
            )
            .await
            .unwrap();
        process.stdin.write_all(b"stdin-ok\n").await.unwrap();
        process.stdin.shutdown().await.unwrap();
        let mut stdout = String::new();
        let mut stderr = String::new();
        process.stdout.read_to_string(&mut stdout).await.unwrap();
        process.stderr.read_to_string(&mut stderr).await.unwrap();
        assert_eq!(stdout, expected);
        assert_eq!(stderr, "stderr-ok");
    });
}

#[cfg(feature = "ssh_transport")]
mod ssh {
    use super::super::WorkspaceTransport;
    use super::super::{SshAuth, SshEndpointConfig, SshTransport, TransportError};

    use std::collections::BTreeMap;
    use std::sync::Arc;
    use std::time::Duration;

    use russh::keys::{HashAlg, ssh_key};
    use russh::server::{self, Auth, ChannelOpenHandle, Msg, Server, Session};
    use russh::{Channel, ChannelId};
    use tokio::io::AsyncReadExt as _;
    use tokio::net::TcpListener;

    const TEST_PASSWORD: &str = "ovule-test-password";
    const TEST_USER: &str = "ovule";
    const REMOTE_WORKSPACE_ROOT: &str = "/tmp/ovule-remote-workspace";

    fn expect_invalid_path(result: Result<SshTransport, TransportError>) {
        let error = result.err().expect("expected InvalidPath error");
        assert!(
            matches!(error, TransportError::InvalidPath(_)),
            "unexpected transport error variant"
        );
    }

    #[test]
    fn ssh_endpoint_config_requires_a_trusted_fingerprint_or_tofu() {
        expect_invalid_path(SshTransport::new(
            SshEndpointConfig {
                host: "example.invalid".to_owned(),
                port: 22,
                user: "ovule".to_owned(),
                auth: SshAuth::Password {
                    secret: "hunter2".to_owned(),
                },
                trusted_host_fingerprints: Vec::new(),
                allow_trust_on_first_use: false,
            },
            "/home/ovule/project".to_owned(),
        ));
    }

    #[test]
    fn ssh_endpoint_config_rejects_empty_host_user_or_root() {
        expect_invalid_path(SshTransport::new(
            SshEndpointConfig {
                host: String::new(),
                port: 22,
                user: "ovule".to_owned(),
                auth: SshAuth::Password {
                    secret: "x".to_owned(),
                },
                trusted_host_fingerprints: Vec::new(),
                allow_trust_on_first_use: true,
            },
            "/srv".to_owned(),
        ));
        expect_invalid_path(SshTransport::new(
            SshEndpointConfig {
                host: "example.invalid".to_owned(),
                port: 22,
                user: String::new(),
                auth: SshAuth::Password {
                    secret: "x".to_owned(),
                },
                trusted_host_fingerprints: Vec::new(),
                allow_trust_on_first_use: true,
            },
            "/srv".to_owned(),
        ));
        expect_invalid_path(SshTransport::new(
            SshEndpointConfig {
                host: "example.invalid".to_owned(),
                port: 22,
                user: "ovule".to_owned(),
                auth: SshAuth::Password {
                    secret: "x".to_owned(),
                },
                trusted_host_fingerprints: Vec::new(),
                allow_trust_on_first_use: true,
            },
            String::new(),
        ));
    }

    struct FakeServer;

    impl Server for FakeServer {
        type Handler = FakeSession;
        fn new_client(&mut self, _peer: Option<std::net::SocketAddr>) -> Self::Handler {
            FakeSession
        }
    }

    struct FakeSession;

    impl server::Handler for FakeSession {
        type Error = russh::Error;

        async fn auth_password(&mut self, user: &str, password: &str) -> Result<Auth, Self::Error> {
            if user == TEST_USER && password == TEST_PASSWORD {
                Ok(Auth::Accept)
            } else {
                Ok(Auth::reject())
            }
        }

        async fn channel_open_session(
            &mut self,
            _channel: Channel<Msg>,
            reply: ChannelOpenHandle,
            _session: &mut Session,
        ) -> Result<(), Self::Error> {
            reply.accept().await;
            Ok(())
        }

        async fn exec_request(
            &mut self,
            channel: ChannelId,
            data: &[u8],
            session: &mut Session,
        ) -> Result<(), Self::Error> {
            let command = std::str::from_utf8(data).unwrap_or_default();
            if command.contains("ovule-stream-test") {
                session.data(channel, b"ssh-stdout".as_slice())?;
                session.extended_data(channel, 1, b"ssh-stderr".as_slice())?;
                let session_handle = session.handle();
                tokio::spawn(async move {
                    let _ = session_handle.exit_status_request(channel, 0).await;
                    let _ = session_handle.eof(channel).await;
                    let _ = session_handle.close(channel).await;
                });
                return Ok(());
            }
            let (exit_code, stdout) = simulate_remote_command(command);
            if !stdout.is_empty() {
                session.data(channel, stdout.into_bytes())?;
            }
            let session_handle = session.handle();
            tokio::spawn(async move {
                let _ = session_handle.exit_status_request(channel, exit_code).await;
                let _ = session_handle.eof(channel).await;
                let _ = session_handle.close(channel).await;
            });
            Ok(())
        }
    }

    fn simulate_remote_command(command: &str) -> (u32, String) {
        if command.starts_with("cat > ") {
            return (0, String::new());
        }
        // The transport wraps user argv as `cd <root> && <argv>`; strip the cd
        // prefix so the switch can dispatch on the trailing intent.
        let inner = command
            .split_once("&& ")
            .map_or(command, |(_, rest)| rest)
            .trim();
        if inner.starts_with("'echo' 'hello'") || inner == "echo hello" {
            (0, "hello\n".to_owned())
        } else if inner.starts_with("'echo' 'from-argv'") {
            (0, "from-argv\n".to_owned())
        } else if inner.starts_with("cat -- '/tmp/ovule-remote-workspace/greeting.txt'") {
            (0, "remote greeting".to_owned())
        } else if inner.starts_with("stat ") {
            (0, "42\tregular file\n".to_owned())
        } else if inner.starts_with("ls -A1F -- ") {
            (0, "docs/\nnotes.txt\n".to_owned())
        } else if inner.starts_with("'/bin/false'") {
            (1, String::new())
        } else {
            (127, String::new())
        }
    }

    async fn spawn_fake_server() -> (String, u16, tokio::task::JoinHandle<()>) {
        let key = ssh_key::PrivateKey::random(&mut rand::rng(), ssh_key::Algorithm::Ed25519)
            .expect("generate host key");
        let fingerprint = format!("{}", key.public_key().fingerprint(HashAlg::Sha256));
        let config = Arc::new(server::Config {
            auth_rejection_time: Duration::from_millis(50),
            auth_rejection_time_initial: Some(Duration::from_millis(0)),
            keys: vec![key],
            ..Default::default()
        });
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind fake ssh listener");
        let port = listener.local_addr().unwrap().port();
        let handle = tokio::spawn(async move {
            let mut server = FakeServer;
            let running = server.run_on_socket(config, &listener);
            let _ = running.await;
        });
        (fingerprint, port, handle)
    }

    fn build_runtime() -> tokio::runtime::Runtime {
        tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .enable_all()
            .build()
            .expect("test runtime")
    }

    #[test]
    fn ssh_transport_executes_an_argv_over_a_real_channel() {
        let runtime = build_runtime();
        runtime.block_on(async {
            let (fingerprint, port, server) = spawn_fake_server().await;
            let transport = SshTransport::new(
                SshEndpointConfig {
                    host: "127.0.0.1".to_owned(),
                    port,
                    user: TEST_USER.to_owned(),
                    auth: SshAuth::Password {
                        secret: TEST_PASSWORD.to_owned(),
                    },
                    trusted_host_fingerprints: vec![fingerprint],
                    allow_trust_on_first_use: false,
                },
                REMOTE_WORKSPACE_ROOT.to_owned(),
            )
            .expect("build transport");
            transport.probe().await.expect("probe should succeed");
            let outcome = transport
                .exec(&["echo".to_owned(), "hello".to_owned()])
                .await
                .expect("exec should succeed");
            assert_eq!(outcome.exit_code, 0);
            assert_eq!(String::from_utf8_lossy(&outcome.stdout), "hello\n");
            let stat = transport.stat("greeting.txt").await.expect("stat");
            assert_eq!(stat.size_bytes, 42);
            let entries = transport.list_directory(".").await.expect("list");
            assert_eq!(entries.len(), 2);
            let bytes = transport.read_file("greeting.txt").await.expect("read");
            assert_eq!(bytes, b"remote greeting");
            transport
                .write_file("written.txt", b"payload")
                .await
                .expect("write");
            server.abort();
        });
    }

    #[test]
    fn ssh_transport_rejects_untrusted_host_fingerprint() {
        let runtime = build_runtime();
        runtime.block_on(async {
            let (_fingerprint, port, server) = spawn_fake_server().await;
            let transport = SshTransport::new(
                SshEndpointConfig {
                    host: "127.0.0.1".to_owned(),
                    port,
                    user: TEST_USER.to_owned(),
                    auth: SshAuth::Password {
                        secret: TEST_PASSWORD.to_owned(),
                    },
                    trusted_host_fingerprints: vec!["SHA256:aaaaaaaaaaaaaaaaaaaa".to_owned()],
                    allow_trust_on_first_use: false,
                },
                REMOTE_WORKSPACE_ROOT.to_owned(),
            )
            .expect("build transport");
            let error = transport.probe().await.expect_err("expected error");
            assert!(matches!(
                error,
                TransportError::Unavailable(_) | TransportError::Unauthorized(_)
            ));
            server.abort();
        });
    }

    #[test]
    fn ssh_transport_rejects_bad_password() {
        let runtime = build_runtime();
        runtime.block_on(async {
            let (fingerprint, port, server) = spawn_fake_server().await;
            let transport = SshTransport::new(
                SshEndpointConfig {
                    host: "127.0.0.1".to_owned(),
                    port,
                    user: TEST_USER.to_owned(),
                    auth: SshAuth::Password {
                        secret: "wrong-password".to_owned(),
                    },
                    trusted_host_fingerprints: vec![fingerprint],
                    allow_trust_on_first_use: false,
                },
                REMOTE_WORKSPACE_ROOT.to_owned(),
            )
            .expect("build transport");
            let error = transport.probe().await.expect_err("expected error");
            assert!(
                matches!(error, TransportError::Unauthorized(_)),
                "unexpected variant: {error:?}"
            );
            server.abort();
        });
    }

    #[test]
    fn ssh_transport_propagates_nonzero_exit_code() {
        let runtime = build_runtime();
        runtime.block_on(async {
            let (fingerprint, port, server) = spawn_fake_server().await;
            let transport = SshTransport::new(
                SshEndpointConfig {
                    host: "127.0.0.1".to_owned(),
                    port,
                    user: TEST_USER.to_owned(),
                    auth: SshAuth::Password {
                        secret: TEST_PASSWORD.to_owned(),
                    },
                    trusted_host_fingerprints: vec![fingerprint],
                    allow_trust_on_first_use: false,
                },
                REMOTE_WORKSPACE_ROOT.to_owned(),
            )
            .expect("build transport");
            let outcome = transport
                .exec(&["/bin/false".to_owned()])
                .await
                .expect("exec should succeed");
            assert_eq!(outcome.exit_code, 1);
            server.abort();
        });
    }

    #[test]
    fn ssh_transport_spawns_a_streaming_process_over_a_real_channel() {
        let runtime = build_runtime();
        runtime.block_on(async {
            let (fingerprint, port, server) = spawn_fake_server().await;
            let transport = SshTransport::new(
                SshEndpointConfig {
                    host: "127.0.0.1".to_owned(),
                    port,
                    user: TEST_USER.to_owned(),
                    auth: SshAuth::Password {
                        secret: TEST_PASSWORD.to_owned(),
                    },
                    trusted_host_fingerprints: vec![fingerprint],
                    allow_trust_on_first_use: false,
                },
                REMOTE_WORKSPACE_ROOT.to_owned(),
            )
            .expect("build transport");
            let mut process = transport
                .spawn(
                    &["ovule-stream-test".to_owned()],
                    &BTreeMap::from([("OVULE_TEST".to_owned(), "1".to_owned())]),
                )
                .await
                .expect("spawn remote process");
            let mut stdout = String::new();
            let mut stderr = String::new();
            process.stdout.read_to_string(&mut stdout).await.unwrap();
            process.stderr.read_to_string(&mut stderr).await.unwrap();
            assert_eq!(stdout, "ssh-stdout");
            assert_eq!(stderr, "ssh-stderr");
            server.abort();
        });
    }
}
