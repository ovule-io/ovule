//! Application-owned interactive sessions, independent of command-run persistence.
//! Detaching a renderer preserves the process; close/shutdown revokes it.
use portable_pty::{ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::{
    collections::HashMap,
    io::{Read, Write},
    path::Path,
    sync::{Arc, Mutex, mpsc},
};

const MAX_SESSIONS: usize = 32;
const REPLAY_BYTES: usize = 512 * 1024;
const READ_BYTES: usize = 64 * 1024;

#[derive(Default)]
struct Output {
    bytes: std::collections::VecDeque<u8>,
    end: u64,
    exit_code: Option<u32>,
    eof: bool,
    error: Option<String>,
}
impl Output {
    fn append(&mut self, bytes: &[u8]) {
        self.end += bytes.len() as u64;
        self.bytes.extend(bytes);
        let excess = self.bytes.len().saturating_sub(REPLAY_BYTES);
        self.bytes.drain(..excess);
    }
    fn read(&self, cursor: u64) -> Result<SessionRead, String> {
        if cursor > self.end {
            return Err("Terminal cursor is ahead of output".into());
        }
        let start = self.end - self.bytes.len() as u64;
        let offset = usize::try_from(cursor.saturating_sub(start)).map_err(|e| e.to_string())?;
        let data: Vec<u8> = self
            .bytes
            .iter()
            .skip(offset)
            .take(READ_BYTES)
            .copied()
            .collect();
        let truncated = cursor < start;
        let cursor = cursor.max(start) + data.len() as u64;
        Ok(SessionRead {
            data,
            cursor,
            truncated,
            exit_code: self.exit_code,
            eof: self.eof && cursor == self.end,
            error: self.error.clone(),
        })
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionRead {
    pub data: Vec<u8>,
    pub cursor: u64,
    pub truncated: bool,
    pub exit_code: Option<u32>,
    pub eof: bool,
    pub error: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
    pub id: String,
    pub owner: String,
    pub profile_id: String,
    pub directory: String,
}

struct Session {
    info: SessionInfo,
    master: Mutex<Option<Box<dyn MasterPty + Send>>>,
    killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
    input: mpsc::SyncSender<Vec<u8>>,
    output: Mutex<Output>,
}

impl Session {
    fn read_output(&self, reader: &mut dyn Read) {
        let mut bytes = [0; 8192];
        loop {
            match reader.read(&mut bytes) {
                Ok(0) => break,
                Ok(count) => lock(&self.output).append(&bytes[..count]),
                Err(error) if error.kind() == std::io::ErrorKind::Interrupted => {}
                Err(error) => {
                    lock(&self.output).error = Some(error.to_string());
                    break;
                }
            }
        }
        lock(&self.output).eof = true;
    }
    fn close(&self) {
        let _ = lock(&self.killer).kill();
        // Closing ConPTY's host handle terminates its attached console clients.
        // Keep the reader draining while ClosePseudoConsole completes.
        drop(lock(&self.master).take());
    }
}

#[derive(Default)]
struct State {
    stopping: bool,
    next_id: u64,
    sessions: HashMap<String, Arc<Session>>,
}

#[derive(Default)]
pub struct PtySessions {
    state: Mutex<State>,
}

impl PtySessions {
    pub fn list(&self) -> Vec<SessionInfo> {
        lock(&self.state)
            .sessions
            .values()
            .map(|session| session.info.clone())
            .collect()
    }

    pub fn open(
        &self,
        owner: &str,
        profile: &crate::profiles::ShellProfile,
        directory: &Path,
        cols: u16,
        rows: u16,
    ) -> Result<SessionInfo, String> {
        profile.validate()?;
        let size = size(cols, rows)?;
        if owner.is_empty() || owner.len() > 256 {
            return Err("Terminal owner is required".into());
        }
        let home = std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" })
            .map(std::path::PathBuf::from);
        let directory = profile.starting_directory.as_deref().unwrap_or_else(|| {
            if directory.as_os_str().is_empty() {
                home.as_deref().unwrap_or(directory)
            } else {
                directory
            }
        });
        let directory = std::fs::canonicalize(directory).map_err(|e| e.to_string())?;
        if !directory.is_dir() {
            return Err("Terminal directory does not exist".into());
        }
        let mut state = lock(&self.state);
        if state.stopping {
            return Err("Terminal sessions are shutting down".into());
        }
        // Reattachment is idempotent and never restarts a shell behind the UI.
        if let Some(session) = state
            .sessions
            .values()
            .find(|session| session.info.owner == owner)
        {
            if session.info.profile_id != profile.id
                || session.info.directory != directory.to_string_lossy()
            {
                return Err(
                    "Close the existing session before changing its profile or directory".into(),
                );
            }
            return Ok(session.info.clone());
        }
        if state.sessions.len() >= MAX_SESSIONS {
            return Err("Terminal session capacity exceeded".into());
        }
        let pair = portable_pty::native_pty_system()
            .openpty(size)
            .map_err(|e| e.to_string())?;
        let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
        let mut writer = pair.master.take_writer().map_err(|e| e.to_string())?;
        let mut command = CommandBuilder::new(&profile.path);
        command.args(&profile.args);
        command.cwd(&directory);
        command.env("TERM", "xterm-256color");
        for (key, value) in &profile.env {
            command.env(key, value);
        }
        let mut child = pair
            .slave
            .spawn_command(command)
            .map_err(|e| e.to_string())?;
        drop(pair.slave);
        state.next_id += 1;
        let info = SessionInfo {
            id: format!("pty-{}", state.next_id),
            owner: owner.into(),
            profile_id: profile.id.clone(),
            directory: directory.to_string_lossy().into_owned(),
        };
        let (input, receiver) = mpsc::sync_channel::<Vec<u8>>(16);
        let session = Arc::new(Session {
            info: info.clone(),
            master: Mutex::new(Some(pair.master)),
            killer: Mutex::new(child.clone_killer()),
            input,
            output: Mutex::new(Output::default()),
        });
        let output = Arc::clone(&session);
        std::thread::spawn(move || output.read_output(reader.as_mut()));
        // Input is bounded and written off the command dispatcher so a shell
        // that stops reading cannot block all application commands.
        std::thread::spawn(move || {
            while let Ok(bytes) = receiver.recv() {
                if writer
                    .write_all(&bytes)
                    .and_then(|()| writer.flush())
                    .is_err()
                {
                    break;
                }
            }
        });
        let exited = Arc::clone(&session);
        std::thread::spawn(move || match child.wait() {
            Ok(status) => lock(&exited.output).exit_code = Some(status.exit_code()),
            Err(error) => lock(&exited.output).error = Some(error.to_string()),
        });
        state.sessions.insert(info.id.clone(), session);
        Ok(info)
    }

    fn session(&self, id: &str) -> Result<Arc<Session>, String> {
        lock(&self.state)
            .sessions
            .get(id)
            .cloned()
            .ok_or_else(|| "Unknown terminal session".into())
    }

    pub fn read(&self, id: &str, cursor: u64) -> Result<SessionRead, String> {
        let session = self.session(id)?;
        let output = lock(&session.output);
        output.read(cursor)
    }

    pub fn write(&self, id: &str, bytes: &[u8]) -> Result<(), String> {
        if bytes.len() > READ_BYTES {
            return Err("Terminal input exceeds 64 KiB".into());
        }
        let session = self.session(id)?;
        if lock(&session.output).exit_code.is_some() {
            return Err("Terminal has exited".into());
        }
        session
            .input
            .try_send(bytes.to_vec())
            .map_err(|e| format!("Terminal input: {e}"))
    }

    pub fn resize(&self, id: &str, cols: u16, rows: u16) -> Result<(), String> {
        let session = self.session(id)?;
        let master = lock(&session.master);
        master
            .as_ref()
            .ok_or("Terminal is closed")?
            .resize(size(cols, rows)?)
            .map_err(|e| e.to_string())
    }

    pub fn close(&self, id: &str) -> bool {
        let session = lock(&self.state).sessions.remove(id);
        if let Some(session) = session {
            session.close();
            true
        } else {
            false
        }
    }

    pub fn shutdown(&self) {
        let sessions = {
            let mut state = lock(&self.state);
            state.stopping = true;
            std::mem::take(&mut state.sessions)
        };
        for session in sessions.into_values() {
            session.close();
        }
    }
}

impl Drop for PtySessions {
    fn drop(&mut self) {
        self.shutdown();
    }
}

fn lock<T>(value: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    value
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}
fn size(cols: u16, rows: u16) -> Result<PtySize, String> {
    if !(2..=1000).contains(&cols) || !(1..=1000).contains(&rows) {
        return Err("Invalid terminal dimensions".into());
    }
    Ok(PtySize {
        cols,
        rows,
        pixel_width: 0,
        pixel_height: 0,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, Instant};

    fn profile() -> crate::profiles::ShellProfile {
        let program = if cfg!(windows) { "cmd.exe" } else { "sh" };
        crate::profiles::ShellProfile {
            id: "test".into(),
            name: "Test shell".into(),
            path: which::which(program).unwrap(),
            args: if cfg!(windows) {
                vec!["/D".into(), "/Q".into()]
            } else {
                vec![]
            },
            env: std::collections::BTreeMap::new(),
            starting_directory: None,
        }
    }

    #[test]
    fn real_pty_preserves_shell_state_resizes_and_reattaches_without_respawn() {
        let directory = tempfile::tempdir().unwrap();
        let sessions = PtySessions::default();
        let profile = profile();
        let first = sessions
            .open("pane-1", &profile, directory.path(), 80, 24)
            .unwrap();
        let attached = sessions
            .open("pane-1", &profile, directory.path(), 100, 30)
            .unwrap();
        assert_eq!(first.id, attached.id);
        assert_eq!(sessions.list().len(), 1);
        sessions.resize(&first.id, 120, 32).unwrap();
        sessions
            .write(
                &first.id,
                if cfg!(windows) {
                    b"set OVULE_PTY_TEST=alpha\r"
                } else {
                    b"export OVULE_PTY_TEST=alpha\n"
                },
            )
            .unwrap();
        sessions
            .write(
                &first.id,
                if cfg!(windows) {
                    b"echo __%OVULE_PTY_TEST%__\r"
                } else {
                    b"printf '__%s__\\n' \"$OVULE_PTY_TEST\"\n"
                },
            )
            .unwrap();
        let deadline = Instant::now() + Duration::from_secs(10);
        let mut cursor = 0;
        let mut text = String::new();
        while Instant::now() < deadline {
            let read = sessions.read(&first.id, cursor).unwrap();
            cursor = read.cursor;
            text.push_str(&String::from_utf8_lossy(&read.data));
            if text.contains("__alpha__") {
                break;
            }
            // ConPTY may ask the terminal for its initial cursor position.
            if text.contains("\x1b[6n") {
                let _ = sessions.write(&first.id, b"\x1b[1;1R");
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        assert!(text.contains("__alpha__"), "PTY output: {text:?}");
        let replay = sessions.read(&first.id, 0).unwrap();
        assert!(!replay.data.is_empty());
        assert!(sessions.read(&first.id, u64::MAX).is_err());
        assert!(sessions.close(&first.id));
        assert!(!sessions.close(&first.id));
        assert!(sessions.write(&first.id, b"ignored").is_err());
        sessions.shutdown();
        assert!(
            sessions
                .open("pane-2", &profile, directory.path(), 80, 24)
                .is_err()
        );
    }

    #[test]
    fn output_replay_is_bounded_and_reports_a_lagging_cursor() {
        let mut output = Output::default();
        output.append(&vec![b'a'; REPLAY_BYTES]);
        output.append(b"tail");
        let read = output.read(0).unwrap();
        assert!(read.truncated);
        assert_eq!(read.data.len(), READ_BYTES);
        assert_eq!(read.cursor, 4 + READ_BYTES as u64);
        assert_eq!(output.bytes.len(), REPLAY_BYTES);
        let tail = output.read(output.end - 4).unwrap();
        assert_eq!(tail.data, b"tail");
        assert!(!tail.truncated);
        assert_eq!(tail.cursor, output.end);
    }
}
