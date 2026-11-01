//! Nonblocking application facade; one bounded actor owns each remote session.
use super::backend::{ControlTransport, HostDirectory, SessionEvents};
use super::model::{
    MAX_SESSIONS, RENDERER_LEASE_SECONDS, SessionState, SessionUpdate, Signal, StartRequest,
};
use std::collections::HashMap;
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, AtomicU64, Ordering},
};
use std::time::{Duration, Instant};
use tokio::sync::{Notify, mpsc};

enum Command {
    Signal(Signal),
    Clipboard(String),
}
struct Session {
    endpoint: String,
    commands: mpsc::Sender<Command>,
    stopped: AtomicBool,
    wake: Notify,
    heartbeat: Mutex<Instant>,
    update: Mutex<SessionUpdate>,
}
pub(super) struct NativeRemotingService {
    runtime: tokio::runtime::Handle,
    directory: Arc<dyn HostDirectory>,
    events: Arc<dyn SessionEvents>,
    sessions: Arc<Mutex<HashMap<u64, Arc<Session>>>>,
    next_id: AtomicU64,
    tasks: Mutex<Vec<tokio::task::JoinHandle<()>>>,
    closing: tokio::sync::watch::Sender<bool>,
}
impl Drop for NativeRemotingService {
    fn drop(&mut self) {
        if tokio::runtime::Handle::try_current().is_ok() {
            // A destructor cannot block the runtime currently polling it.
            self.closing.send_replace(true);
            self.shutdown();
            for task in self
                .tasks
                .get_mut()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .drain(..)
            {
                task.abort();
            }
        } else {
            self.runtime
                .block_on(self.shutdown_and_wait(Duration::from_secs(5)));
        }
    }
}
impl NativeRemotingService {
    #[must_use]
    pub fn new(
        directory: Arc<dyn HostDirectory>,
        events: Arc<dyn SessionEvents>,
        runtime: tokio::runtime::Handle,
    ) -> Self {
        Self {
            runtime,
            closing: tokio::sync::watch::channel(false).0,
            tasks: Mutex::new(Vec::new()),
            directory,
            events,
            sessions: Arc::new(Mutex::new(HashMap::new())),
            next_id: AtomicU64::new(1),
        }
    }
    /// Returns before discovery, credential IO, network connection, or native startup.
    pub fn start(&self, endpoint: String, request: StartRequest) -> Result<u64, String> {
        if *self.closing.borrow() {
            return Err("remote control service is shutting down".into());
        }
        request.validate()?;
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        if id > i64::MAX.cast_unsigned() {
            return Err("session identifier exhausted".into());
        }
        let (tx, rx) = mpsc::channel(64);
        let session = Arc::new(Session {
            endpoint,
            commands: tx,
            stopped: AtomicBool::new(false),
            wake: Notify::new(),
            heartbeat: Mutex::new(Instant::now()),
            update: Mutex::new(SessionUpdate {
                session_id: id.to_string(),
                state: SessionState::Connecting,
                route: "unknown".into(),
                error: None,
                ice_servers: None,
                signals: Vec::new(),
            }),
        });
        {
            let mut sessions = self
                .sessions
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            sessions.retain(|_, session| {
                !session
                    .update
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner)
                    .state
                    .terminal()
            });
            if sessions.len() >= MAX_SESSIONS {
                return Err("remote control session capacity exhausted".into());
            }
            sessions.insert(id, Arc::clone(&session));
        }
        let directory = Arc::clone(&self.directory);
        let events = Arc::clone(&self.events);
        let sessions = Arc::clone(&self.sessions);
        let mut closing = self.closing.subscribe();
        let task = self.runtime.spawn(async move {
            let result = run(&session, rx, directory, events.as_ref(), request).await;
            {
                let mut update = session
                    .update
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner);
                update.state = if result.is_ok() {
                    SessionState::Stopped
                } else {
                    SessionState::Failed
                };
                update.error = result.err();
                events.changed(&update);
            }
            // Retain terminal diagnostics briefly for a renderer that missed the event.
            tokio::select! {
                () = tokio::time::sleep(Duration::from_secs(5)) => {},
                _ = closing.wait_for(|closing| *closing) => {},
            }
            sessions
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .remove(&id);
        });
        let mut tasks = self
            .tasks
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        tasks.retain(|task| !task.is_finished());
        tasks.push(task);
        Ok(id)
    }
    fn session(&self, id: u64) -> Result<Arc<Session>, String> {
        self.sessions
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .get(&id)
            .cloned()
            .ok_or_else(|| "remote control session is closed".into())
    }
    pub fn signal(&self, id: u64, signal: Signal) -> Result<(), String> {
        signal.validate()?;
        self.enqueue(id, Command::Signal(signal))
    }
    pub fn clipboard(&self, id: u64, text: String) -> Result<(), String> {
        if text.len() > 1024 * 1024 {
            return Err("clipboard exceeds 1 MiB".into());
        }
        self.enqueue(id, Command::Clipboard(text))
    }
    fn enqueue(&self, id: u64, command: Command) -> Result<(), String> {
        let session = self.session(id)?;
        if session.stopped.load(Ordering::Acquire) {
            return Err("remote control session is closing".into());
        }
        session
            .commands
            .try_send(command)
            .map_err(|_| "remote control command queue is full or closed".into())
    }
    pub fn snapshot(&self, id: u64, after: u64) -> Result<SessionUpdate, String> {
        let session = self.session(id)?;
        *session
            .heartbeat
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = Instant::now();
        let mut update = session
            .update
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        update.signals.retain(|s| s.sequence > after);
        Ok(update.clone())
    }
    pub fn stop(&self, id: u64) {
        if let Ok(session) = self.session(id) {
            session.stopped.store(true, Ordering::Release);
            session.wake.notify_one();
        }
    }
    pub fn shutdown(&self) {
        for session in self
            .sessions
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .values()
        {
            session.stopped.store(true, Ordering::Release);
            session.wake.notify_one();
        }
    }

    pub async fn shutdown_and_wait(&self, timeout: Duration) {
        self.closing.send_replace(true);
        self.shutdown();
        let tasks = std::mem::take(
            &mut *self
                .tasks
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner),
        );
        let deadline = tokio::time::Instant::now() + timeout;
        for mut task in tasks {
            if tokio::time::timeout_at(deadline, &mut task).await.is_err() {
                task.abort();
                let _ = task.await;
            }
        }
    }

    pub fn close_host(&self, endpoint: &str) {
        for session in self
            .sessions
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .values()
        {
            if session.endpoint == endpoint {
                session.stopped.store(true, Ordering::Release);
                session.wake.notify_one();
            }
        }
    }
}

async fn bounded<T>(
    operation: &str,
    timeout: Duration,
    future: impl std::future::Future<Output = Result<T, String>>,
) -> Result<T, String> {
    tokio::time::timeout(timeout, future)
        .await
        .map_err(|_| format!("remote desktop {operation} timed out"))?
}

const START_TIMEOUT: Duration = Duration::from_secs(super::model::CLIENT_START_TIMEOUT_SECONDS);
const OPERATION_TIMEOUT: Duration = Duration::from_secs(15);
async fn run(
    session: &Session,
    mut rx: mpsc::Receiver<Command>,
    directory: Arc<dyn HostDirectory>,
    events: &dyn SessionEvents,
    request: StartRequest,
) -> Result<(), String> {
    let transport = directory.connect(&session.endpoint)?;
    let started = bounded(
        "Host startup (before ICE configuration)",
        START_TIMEOUT,
        transport.start(request),
    )
    .await?;
    {
        let mut update = session
            .update
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        update.ice_servers = Some(started.ice_servers.clone());
        update.error = started.connectivity_warning;
        events.changed(&update);
    }
    let result = pump(session, &mut rx, transport.as_ref(), started.id, events).await;
    let stopped = bounded("stop", OPERATION_TIMEOUT, transport.stop(started.id)).await;
    result.and(stopped)
}
async fn pump(
    session: &Session,
    rx: &mut mpsc::Receiver<Command>,
    transport: &dyn ControlTransport,
    id: u64,
    events: &dyn SessionEvents,
) -> Result<(), String> {
    let mut after = 0;
    loop {
        if session.stopped.load(Ordering::Acquire)
            || session
                .heartbeat
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .elapsed()
                > Duration::from_secs(RENDERER_LEASE_SECONDS)
        {
            return Ok(());
        }
        tokio::select! {
            biased;
            () = session.wake.notified() => {},
            command = rx.recv() => match command {
                Some(Command::Signal(signal)) => bounded("signaling", OPERATION_TIMEOUT, transport.signal(id, signal)).await?,
                Some(Command::Clipboard(text)) => bounded("clipboard", OPERATION_TIMEOUT, transport.clipboard(id, text)).await?,
                None => return Ok(()),
            },
            remote = bounded("Host updates", OPERATION_TIMEOUT, transport.watch(id, after)) => {
                let remote = remote?;
                let mut update = session.update.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
                let changed = update.state != remote.state || update.route != remote.route || !remote.signals.is_empty();
                for signal in remote.signals {
                    if signal.sequence > after { after = signal.sequence; update.signals.push(signal); }
                }
                if update.signals.len() > 256 { return Err("remote signal consumer fell behind".into()); }
                update.state = remote.state;
                update.route = remote.route;
                if changed { events.changed(&update); }
                if remote.state.terminal() { return if remote.state == SessionState::Stopped { Ok(()) } else { Err("remote desktop connection failed".into()) }; }
            }
        }
    }
}

#[async_trait::async_trait]
pub trait Remoting: Send + Sync {
    fn start(&self, endpoint: String, request: StartRequest) -> Result<u64, String>;
    fn signal(&self, id: u64, signal: Signal) -> Result<(), String>;
    fn clipboard(&self, id: u64, text: String) -> Result<(), String>;
    fn snapshot(&self, id: u64, after: u64) -> Result<SessionUpdate, String>;
    fn stop(&self, id: u64);
    fn shutdown(&self);
    async fn shutdown_and_wait(&self, timeout: Duration);
    fn close_host(&self, endpoint: &str);
}

/// Typed identity consumed by shells and domain factories.
pub type RemotingService = tuffite_ioc::Service<dyn Remoting>;

#[async_trait::async_trait]
impl Remoting for NativeRemotingService {
    fn start(&self, endpoint: String, request: StartRequest) -> Result<u64, String> {
        NativeRemotingService::start(self, endpoint, request)
    }
    fn signal(&self, id: u64, signal: Signal) -> Result<(), String> {
        NativeRemotingService::signal(self, id, signal)
    }
    fn clipboard(&self, id: u64, text: String) -> Result<(), String> {
        NativeRemotingService::clipboard(self, id, text)
    }
    fn snapshot(&self, id: u64, after: u64) -> Result<SessionUpdate, String> {
        NativeRemotingService::snapshot(self, id, after)
    }
    fn stop(&self, id: u64) {
        NativeRemotingService::stop(self, id);
    }
    fn shutdown(&self) {
        NativeRemotingService::shutdown(self);
    }
    async fn shutdown_and_wait(&self, timeout: Duration) {
        NativeRemotingService::shutdown_and_wait(self, timeout).await;
    }
    fn close_host(&self, endpoint: &str) {
        NativeRemotingService::close_host(self, endpoint);
    }
}
