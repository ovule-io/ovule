//! SSH `WorkspaceTransport` backend built on `russh`.
//!
//! The backend is deliberately compact: it exposes the same `WorkspaceTransport`
//! surface as `LocalTransport`, and derives filesystem operations from remote
//! POSIX shell commands (`stat`, `ls -la`, `cat`) run through `channel_open_session`.
//! This keeps the transport dependency-free of SFTP while remaining testable
//! against any real SSH server that speaks OpenSSH.

use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use russh::client::{self, Msg};
use russh::keys::{self, HashAlg, PrivateKeyWithHashAlg, PublicKeyOrCertificate};
use russh::{ChannelMsg, Preferred};
use tokio::sync::Mutex;

use crate::TransportKind;

use super::{EntryKind, EntryStat, ExecOutcome, TransportError, WorkspaceTransport};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(20);
const EXEC_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_STDOUT_BYTES: usize = 512 * 1024;
const MAX_STDERR_BYTES: usize = 256 * 1024;

#[derive(Clone, Debug)]
pub struct SshEndpointConfig {
    pub host: String,
    pub port: u16,
    pub user: String,
    pub auth: SshAuth,
    /// Accepted server host-key SHA-256 fingerprints in `sha256:BASE64` form.
    /// An empty vec means trust-on-first-use; the transport rejects an empty
    /// list at construction time unless `allow_trust_on_first_use` is set.
    pub trusted_host_fingerprints: Vec<String>,
    pub allow_trust_on_first_use: bool,
}

#[derive(Clone, Debug)]
pub enum SshAuth {
    PrivateKey {
        /// PEM-encoded OpenSSH private key.
        pem: String,
        passphrase: Option<String>,
    },
    Password {
        secret: String,
    },
}

pub struct SshTransport {
    config: Arc<SshEndpointConfig>,
    /// Absolute remote working-directory root.
    root: String,
    session: Mutex<Option<client::Handle<HostKeyPolicy>>>,
    platform: Mutex<Option<RemotePlatform>>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum RemotePlatform {
    Posix,
    Windows,
}

impl SshTransport {
    pub fn new(config: SshEndpointConfig, root: String) -> Result<Self, TransportError> {
        if config.host.trim().is_empty() {
            return Err(TransportError::InvalidPath("SSH host is empty".to_owned()));
        }
        if config.user.trim().is_empty() {
            return Err(TransportError::InvalidPath("SSH user is empty".to_owned()));
        }
        if !config.allow_trust_on_first_use && config.trusted_host_fingerprints.is_empty() {
            return Err(TransportError::InvalidPath(
                "at least one trusted host-key fingerprint is required".to_owned(),
            ));
        }
        if root.trim().is_empty() {
            return Err(TransportError::InvalidPath(
                "SSH workspace root is empty".to_owned(),
            ));
        }
        Ok(Self {
            config: Arc::new(config),
            root,
            session: Mutex::new(None),
            platform: Mutex::new(None),
        })
    }

    async fn ensure_session(&self) -> Result<(), TransportError> {
        let mut guard = self.session.lock().await;
        if guard.is_some() {
            return Ok(());
        }
        let handle = tokio::time::timeout(CONNECT_TIMEOUT, self.connect())
            .await
            .map_err(|_| TransportError::Unavailable("SSH connect timed out".to_owned()))??;
        *guard = Some(handle);
        Ok(())
    }

    async fn connect(&self) -> Result<client::Handle<HostKeyPolicy>, TransportError> {
        let ssh_config = Arc::new(client::Config {
            inactivity_timeout: Some(Duration::from_mins(1)),
            preferred: Preferred::default(),
            ..Default::default()
        });
        let policy = HostKeyPolicy {
            trusted_fingerprints: self.config.trusted_host_fingerprints.clone(),
            allow_trust_on_first_use: self.config.allow_trust_on_first_use,
        };
        let address = (self.config.host.as_str(), self.config.port);
        let mut session = client::connect(ssh_config, address, policy)
            .await
            .map_err(|error| TransportError::Unavailable(format!("SSH connect: {error}")))?;
        let authorized = match &self.config.auth {
            SshAuth::Password { secret } => session
                .authenticate_password(self.config.user.clone(), secret.clone())
                .await
                .map_err(|error| {
                    TransportError::Unauthorized(format!("SSH password auth: {error}"))
                })?
                .success(),
            SshAuth::PrivateKey { pem, passphrase } => {
                let key = keys::decode_secret_key(pem, passphrase.as_deref()).map_err(|error| {
                    TransportError::Unauthorized(format!("decode key: {error}"))
                })?;
                let hash_alg = session
                    .best_supported_rsa_hash()
                    .await
                    .map_err(|error| {
                        TransportError::Unauthorized(format!("negotiate RSA hash: {error}"))
                    })?
                    .flatten();
                session
                    .authenticate_publickey(
                        self.config.user.clone(),
                        PrivateKeyWithHashAlg::new(Arc::new(key), hash_alg),
                    )
                    .await
                    .map_err(|error| {
                        TransportError::Unauthorized(format!("SSH publickey auth: {error}"))
                    })?
                    .success()
            }
        };
        if !authorized {
            return Err(TransportError::Unauthorized(
                "SSH authentication was rejected".to_owned(),
            ));
        }
        Ok(session)
    }

    async fn open_channel(&self) -> Result<russh::Channel<Msg>, TransportError> {
        self.ensure_session().await?;
        let guard = self.session.lock().await;
        let handle = guard
            .as_ref()
            .ok_or_else(|| TransportError::Unavailable("SSH session missing".to_owned()))?;
        handle
            .channel_open_session()
            .await
            .map_err(|error| TransportError::Protocol(format!("open channel: {error}")))
    }

    async fn exec_command(&self, command: &str) -> Result<ExecOutcome, TransportError> {
        self.exec_command_with_input(command, &[]).await
    }

    async fn remote_platform(&self) -> Result<RemotePlatform, TransportError> {
        if let Some(platform) = *self.platform.lock().await {
            return Ok(platform);
        }
        let windows = self.exec_command("powershell.exe -NoProfile -NonInteractive -Command \"[Console]::Out.Write('ovule-windows')\"").await?;
        let platform = if windows.exit_code == 0 && windows.stdout == b"ovule-windows" {
            RemotePlatform::Windows
        } else {
            RemotePlatform::Posix
        };
        *self.platform.lock().await = Some(platform);
        Ok(platform)
    }

    async fn exec_command_with_input(
        &self,
        command: &str,
        input: &[u8],
    ) -> Result<ExecOutcome, TransportError> {
        let mut channel = self.open_channel().await?;
        channel
            .exec(true, command)
            .await
            .map_err(|error| TransportError::Protocol(format!("send exec: {error}")))?;
        if !input.is_empty() {
            channel
                .data(input)
                .await
                .map_err(|error| TransportError::Protocol(format!("send stdin: {error}")))?;
        }
        channel
            .eof()
            .await
            .map_err(|error| TransportError::Protocol(format!("close stdin: {error}")))?;

        let mut stdout = Vec::new();
        let mut stderr = Vec::new();
        let mut exit_code: Option<i32> = None;
        let deadline = tokio::time::Instant::now() + EXEC_TIMEOUT;
        loop {
            let msg = tokio::time::timeout_at(deadline, channel.wait())
                .await
                .map_err(|_| TransportError::Protocol("remote exec timed out".to_owned()))?;
            let Some(msg) = msg else {
                break;
            };
            match msg {
                ChannelMsg::Data { ref data } => {
                    append_bounded(&mut stdout, data, MAX_STDOUT_BYTES);
                }
                ChannelMsg::ExtendedData { ref data, ext: 1 } => {
                    append_bounded(&mut stderr, data, MAX_STDERR_BYTES);
                }
                ChannelMsg::ExitStatus { exit_status } => {
                    exit_code = Some(i32::try_from(exit_status).unwrap_or(i32::MAX));
                }
                _ => {}
            }
        }
        // Drain the channel gracefully; errors during close are non-fatal.
        Ok(ExecOutcome {
            exit_code: exit_code.unwrap_or(-1),
            stdout,
            stderr,
        })
    }

    fn remote_path(
        &self,
        relative: &str,
        platform: RemotePlatform,
    ) -> Result<String, TransportError> {
        let trimmed = relative.trim();
        if trimmed.contains('\0') {
            return Err(TransportError::InvalidPath(
                "workspace path contains a NUL byte".to_owned(),
            ));
        }
        let mut segments = Vec::new();
        for component in trimmed.split(['/', '\\']) {
            match component {
                "" | "." => {}
                ".." => {
                    return Err(TransportError::InvalidPath(format!(
                        "workspace path escapes root: {trimmed}"
                    )));
                }
                other => segments.push(other.to_owned()),
            }
        }
        let separator = if platform == RemotePlatform::Windows {
            "\\"
        } else {
            "/"
        };
        let joined = if segments.is_empty() {
            self.root.clone()
        } else {
            format!(
                "{}{}{}",
                self.root.trim_end_matches(['/', '\\']),
                separator,
                segments.join(separator)
            )
        };
        Ok(joined)
    }
}

/// Client handler that enforces the host-key fingerprint policy.
struct HostKeyPolicy {
    trusted_fingerprints: Vec<String>,
    allow_trust_on_first_use: bool,
}

impl client::Handler for HostKeyPolicy {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        server_public_key: &PublicKeyOrCertificate,
    ) -> Result<bool, Self::Error> {
        if self.allow_trust_on_first_use && self.trusted_fingerprints.is_empty() {
            return Ok(true);
        }
        let key_data = match server_public_key {
            PublicKeyOrCertificate::PublicKey { key, .. } => key.key_data(),
            PublicKeyOrCertificate::Certificate(certificate) => certificate.public_key(),
        };
        let observed = format!("{}", key_data.fingerprint(HashAlg::Sha256));
        Ok(self
            .trusted_fingerprints
            .iter()
            .any(|expected| expected.eq_ignore_ascii_case(&observed)))
    }
}

fn append_bounded(buffer: &mut Vec<u8>, incoming: &[u8], limit: usize) {
    if buffer.len() >= limit {
        return;
    }
    let remaining = limit - buffer.len();
    if incoming.len() <= remaining {
        buffer.extend_from_slice(incoming);
    } else {
        buffer.extend_from_slice(&incoming[..remaining]);
    }
}

fn shell_escape(argument: &str) -> String {
    let mut escaped = String::with_capacity(argument.len() + 2);
    escaped.push('\'');
    for byte in argument.chars() {
        if byte == '\'' {
            escaped.push_str("'\\''");
        } else {
            escaped.push(byte);
        }
    }
    escaped.push('\'');
    escaped
}

fn powershell_escape(argument: &str) -> String {
    format!("'{}'", argument.replace('\'', "''"))
}

fn powershell(command: &str) -> String {
    format!(
        "powershell.exe -NoProfile -NonInteractive -Command \"{}\"",
        command.replace('\"', "`\"")
    )
}

#[async_trait]
impl WorkspaceTransport for SshTransport {
    async fn spawn_shell(&self, command: &str) -> Result<super::WorkspaceProcess, TransportError> {
        let argv = if self.remote_platform().await? == RemotePlatform::Windows {
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
        use tokio::io::{AsyncReadExt as _, AsyncWriteExt as _};
        if argv.is_empty() {
            return Err(TransportError::Protocol("empty process argv".to_owned()));
        }
        let platform = self.remote_platform().await?;
        let escaped = argv
            .iter()
            .map(|arg| {
                if platform == RemotePlatform::Windows {
                    powershell_escape(arg)
                } else {
                    shell_escape(arg)
                }
            })
            .collect::<Vec<_>>()
            .join(" ");
        if environment.keys().any(|name| {
            name.is_empty()
                || !name
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
        }) {
            return Err(TransportError::Protocol(
                "process environment contains an invalid variable name".to_owned(),
            ));
        }
        let command = if platform == RemotePlatform::Windows {
            let assignments = environment
                .iter()
                .map(|(name, value)| format!("$env:{name}={}", powershell_escape(value)))
                .collect::<Vec<_>>()
                .join("; ");
            powershell(&format!(
                "{assignments}; Set-Location -LiteralPath {}; & {}",
                powershell_escape(&self.root),
                escaped
            ))
        } else {
            let assignments = environment
                .iter()
                .map(|(name, value)| format!("{name}={}", shell_escape(value)))
                .collect::<Vec<_>>()
                .join(" ");
            format!(
                "cd {} && {}exec {}",
                shell_escape(&self.root),
                if assignments.is_empty() {
                    String::new()
                } else {
                    format!("{assignments} ")
                },
                escaped
            )
        };
        let mut channel = self.open_channel().await?;
        channel
            .exec(true, command)
            .await
            .map_err(|error| TransportError::Protocol(error.to_string()))?;
        let (stdin, mut input) = tokio::io::duplex(64 * 1024);
        let (mut output, stdout) = tokio::io::duplex(64 * 1024);
        let (mut errors, stderr) = tokio::io::duplex(64 * 1024);
        let (lifetime, mut stop) = tokio::sync::oneshot::channel();
        let (completed, completion) = tokio::sync::oneshot::channel();
        tokio::spawn(async move {
            let mut buffer = [0_u8; 8192];
            let mut input_open = true;
            let mut exit_code = None;
            loop {
                tokio::select! {
                    _ = &mut stop => break,
                    read = input.read(&mut buffer), if input_open => {
                        match read {
                            Ok(0) => { input_open = false; let _ = channel.eof().await; },
                            Ok(length) => if channel.data(&buffer[..length]).await.is_err() { break; },
                            Err(_) => break,
                        }
                    },
                    message = channel.wait() => match message {
                        Some(ChannelMsg::Data { data }) => match output.write_all(&data).await { Ok(()) => {}, Err(_) => break },
                        Some(ChannelMsg::ExtendedData { data, ext: 1 }) => match errors.write_all(&data).await { Ok(()) => {}, Err(_) => break },
                        Some(ChannelMsg::ExitStatus { exit_status }) => exit_code = i32::try_from(exit_status).ok(),
                        Some(ChannelMsg::Close) | None => break,
                        _ => {},
                    },
                }
            }
            let _ = channel.close().await;
            let _ = completed.send(exit_code);
        });
        Ok(super::WorkspaceProcess::new(
            stdin, stdout, stderr, lifetime, completion,
        ))
    }
    fn kind(&self) -> TransportKind {
        TransportKind::Ssh
    }

    async fn probe(&self) -> Result<(), TransportError> {
        self.ensure_session().await
    }

    async fn stat(&self, relative: &str) -> Result<EntryStat, TransportError> {
        let platform = self.remote_platform().await?;
        let path = self.remote_path(relative, platform)?;
        let command = if platform == RemotePlatform::Windows {
            powershell(&format!(
                "$i=Get-Item -LiteralPath {}; $k=if($i.PSIsContainer){{'directory'}}elseif($i.LinkType){{'symbolic link'}}else{{'regular file'}}; $s=if($i.PSIsContainer){{0}}else{{$i.Length}}; [Console]::Out.Write(([string]$s + [char]9 + $k))",
                powershell_escape(&path)
            ))
        } else {
            format!(
                "stat -c '%s\t%F' -- {} 2>/dev/null || stat -f '%z\t%HT' -- {}",
                shell_escape(&path),
                shell_escape(&path)
            )
        };
        let outcome = self.exec_command(&command).await?;
        if outcome.exit_code != 0 {
            return Err(TransportError::NotFound(path));
        }
        let text = String::from_utf8_lossy(&outcome.stdout);
        let line = text.lines().next().unwrap_or_default();
        let mut fields = line.splitn(2, '\t');
        let size_field = fields.next().unwrap_or("0").trim();
        let kind_field = fields.next().unwrap_or("").trim();
        let size_bytes: u64 = size_field.parse().unwrap_or(0);
        let kind = classify_stat_kind(kind_field);
        Ok(EntryStat {
            path: std::path::PathBuf::from(path),
            kind,
            size_bytes,
        })
    }

    async fn list_directory(&self, relative: &str) -> Result<Vec<EntryStat>, TransportError> {
        let platform = self.remote_platform().await?;
        let path = self.remote_path(relative, platform)?;
        // -A: hide . and ..; -1: one per line; --file-type is not universal so we
        //     rely on -F trailing markers to derive directory/symlink kind.
        let command = if platform == RemotePlatform::Windows {
            powershell(&format!(
                "Get-ChildItem -Force -LiteralPath {} | ForEach-Object {{ [Console]::Out.WriteLine($_.Name + $(if($_.PSIsContainer){{'/'}}elseif($_.LinkType){{'@'}}else{{''}})) }}",
                powershell_escape(&path)
            ))
        } else {
            format!("ls -A1F -- {}", shell_escape(&path))
        };
        let outcome = self.exec_command(&command).await?;
        if outcome.exit_code != 0 {
            let message = String::from_utf8_lossy(&outcome.stderr).into_owned();
            return Err(TransportError::NotFound(format!("{path}: {message}")));
        }
        let text = String::from_utf8_lossy(&outcome.stdout);
        let mut entries = Vec::new();
        for line in text.lines() {
            if line.is_empty() {
                continue;
            }
            let (name, kind) = if let Some(name) = line.strip_suffix('/') {
                (name.to_owned(), EntryKind::Directory)
            } else if let Some(name) = line.strip_suffix('@') {
                (name.to_owned(), EntryKind::Symlink)
            } else if let Some(name) = line.strip_suffix('*') {
                (name.to_owned(), EntryKind::File)
            } else {
                (line.to_owned(), EntryKind::File)
            };
            let separator = if platform == RemotePlatform::Windows {
                "\\"
            } else {
                "/"
            };
            let entry_path = format!(
                "{}{}{}",
                path.trim_end_matches(['/', '\\']),
                separator,
                name
            );
            entries.push(EntryStat {
                path: std::path::PathBuf::from(entry_path),
                kind,
                size_bytes: 0,
            });
        }
        entries.sort_by(|left, right| left.path.cmp(&right.path));
        Ok(entries)
    }

    async fn read_file(&self, relative: &str) -> Result<Vec<u8>, TransportError> {
        let platform = self.remote_platform().await?;
        let path = self.remote_path(relative, platform)?;
        let command = if platform == RemotePlatform::Windows {
            powershell(&format!(
                "$b=[IO.File]::ReadAllBytes({}); $o=[Console]::OpenStandardOutput(); $o.Write($b,0,$b.Length)",
                powershell_escape(&path)
            ))
        } else {
            format!("cat -- {}", shell_escape(&path))
        };
        let outcome = self.exec_command(&command).await?;
        if outcome.exit_code != 0 {
            return Err(TransportError::NotFound(path));
        }
        Ok(outcome.stdout)
    }

    async fn write_file(&self, relative: &str, bytes: &[u8]) -> Result<(), TransportError> {
        let platform = self.remote_platform().await?;
        let path = self.remote_path(relative, platform)?;
        let temporary = format!("{path}.ovule.tmp");
        let command = if platform == RemotePlatform::Windows {
            powershell(&format!(
                "$i=[Console]::OpenStandardInput(); $o=[IO.File]::OpenWrite({}); $i.CopyTo($o); $o.Close(); Move-Item -Force -LiteralPath {} -Destination {}",
                powershell_escape(&temporary),
                powershell_escape(&temporary),
                powershell_escape(&path)
            ))
        } else {
            format!(
                "cat > {} && mv -f -- {} {}",
                shell_escape(&temporary),
                shell_escape(&temporary),
                shell_escape(&path)
            )
        };
        let outcome = self.exec_command_with_input(&command, bytes).await?;
        if outcome.exit_code == 0 {
            Ok(())
        } else {
            Err(TransportError::Io(
                String::from_utf8_lossy(&outcome.stderr).into_owned(),
            ))
        }
    }

    async fn exec(&self, argv: &[String]) -> Result<ExecOutcome, TransportError> {
        if argv.is_empty() {
            return Err(TransportError::InvalidPath("exec argv is empty".to_owned()));
        }
        let platform = self.remote_platform().await?;
        let escaped = argv
            .iter()
            .map(|argument| {
                if platform == RemotePlatform::Windows {
                    powershell_escape(argument)
                } else {
                    shell_escape(argument)
                }
            })
            .collect::<Vec<_>>()
            .join(" ");
        let command = if platform == RemotePlatform::Windows {
            powershell(&format!(
                "Set-Location -LiteralPath {}; & {}",
                powershell_escape(&self.root),
                escaped
            ))
        } else {
            format!("cd {} && {}", shell_escape(&self.root), escaped)
        };
        self.exec_command(&command).await
    }

    async fn exec_shell(&self, shell_command: &str) -> Result<ExecOutcome, TransportError> {
        let platform = self.remote_platform().await?;
        let command = if platform == RemotePlatform::Windows {
            powershell(&format!(
                "Set-Location -LiteralPath {}; {}",
                powershell_escape(&self.root),
                shell_command
            ))
        } else {
            format!(
                "cd {} && sh -lc {}",
                shell_escape(&self.root),
                shell_escape(shell_command)
            )
        };
        self.exec_command(&command).await
    }
}

fn classify_stat_kind(field: &str) -> EntryKind {
    let lower = field.to_ascii_lowercase();
    if lower.contains("directory") {
        EntryKind::Directory
    } else if lower.contains("symbolic link") || lower.contains("symlink") {
        EntryKind::Symlink
    } else if lower.contains("regular file") || lower.contains("regular") {
        EntryKind::File
    } else {
        EntryKind::Other
    }
}

#[cfg(test)]
mod platform_tests {
    use super::*;

    #[test]
    fn windows_paths_use_backslashes_and_reject_parent_escape() {
        let transport = SshTransport::new(
            SshEndpointConfig {
                host: "127.0.0.1".to_owned(),
                port: 22,
                user: "test".to_owned(),
                auth: SshAuth::Password {
                    secret: "test".to_owned(),
                },
                trusted_host_fingerprints: vec!["SHA256:test".to_owned()],
                allow_trust_on_first_use: false,
            },
            r"C:\workspace".to_owned(),
        )
        .unwrap();
        assert_eq!(
            transport
                .remote_path("src/main.rs", RemotePlatform::Windows)
                .unwrap(),
            r"C:\workspace\src\main.rs"
        );
        assert!(
            transport
                .remote_path(r"..\secret", RemotePlatform::Windows)
                .is_err()
        );
    }

    #[test]
    fn powershell_literals_escape_single_quotes() {
        assert_eq!(powershell_escape(r"C:\it's\safe"), r"'C:\it''s\safe'");
        let command = powershell("[Console]::Out.Write('ok')");
        assert!(command.starts_with("powershell.exe -NoProfile -NonInteractive -Command"));
    }

    #[test]
    fn windows_stat_output_uses_a_real_tab_separator() {
        let line = format!("0{}directory", char::from(9));
        let mut fields = line.splitn(2, '\t');
        assert_eq!(fields.next(), Some("0"));
        assert_eq!(
            classify_stat_kind(fields.next().unwrap()),
            EntryKind::Directory
        );
    }
}
