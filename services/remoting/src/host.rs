//! Device-owned session registry. Neither QUIC nor `ShellAPI` owns desktop lifetime.
use super::backend::{DesktopBackend, IceConfigProvider};
use super::model::{
    HANDSHAKE_SECONDS, HostUpdate, LEASE_SECONDS, MAX_SESSIONS, SessionState, Signal, StartRequest,
    StartedSession,
};
use std::collections::HashMap;
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, Ordering},
};
use std::time::{Duration, Instant};

struct Session {
    owner: String,
    revoked: AtomicBool,
    active: tokio::sync::Mutex<ActiveSession>,
}

struct ActiveSession {
    native_id: Option<u64>,
    expires: Instant,
    handshake_deadline: Instant,
    connected: bool,
}
pub(super) struct NativeHostSessions {
    backend: Arc<dyn DesktopBackend>,
    ice_provider: Arc<dyn IceConfigProvider>,
    sessions: Mutex<HashMap<u64, Arc<Session>>>,
}
impl NativeHostSessions {
    #[must_use]
    pub fn new(backend: Arc<dyn DesktopBackend>, ice_provider: Arc<dyn IceConfigProvider>) -> Self {
        Self {
            backend,
            ice_provider,
            sessions: Mutex::new(HashMap::new()),
        }
    }

    pub async fn start(
        &self,
        owner: &str,
        request: StartRequest,
    ) -> Result<StartedSession, String> {
        request.validate()?;
        let id = rand::random::<u64>() & i64::MAX.cast_unsigned();
        let started_at = Instant::now();
        let (ice_servers, connectivity_warning) = self
            .ice_provider
            .configuration_report(owner, id)
            .await
            .map_err(|error| format!("Host ICE configuration failed: {error}"))?;
        tracing::info!(
            elapsed_ms = started_at.elapsed().as_millis(),
            turn_configured = ice_servers.iter().any(|server| server
                .urls
                .iter()
                .any(|url| url.starts_with("turn:") || url.starts_with("turns:"))),
            connectivity_warning = connectivity_warning.is_some(),
            "remote desktop Host ICE configuration ready"
        );
        let options = request.with_ice_servers(ice_servers.clone());
        options.validate()?;
        let now = Instant::now();
        let session = Arc::new(Session {
            owner: owner.into(),
            revoked: AtomicBool::new(false),
            active: tokio::sync::Mutex::new(ActiveSession {
                native_id: None,
                expires: now + Duration::from_secs(LEASE_SECONDS),
                handshake_deadline: now + Duration::from_secs(HANDSHAKE_SECONDS),
                connected: false,
            }),
        });
        {
            let mut sessions = self
                .sessions
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            if id == 0 || sessions.contains_key(&id) || sessions.len() >= MAX_SESSIONS {
                return Err("remote control session capacity exhausted".into());
            }
            sessions.insert(id, Arc::clone(&session));
        }
        let mut active = session.active.lock().await;
        match self.backend.start(options).await.map_err(|error| {
            format!("Host native desktop startup failed after ICE configuration: {error}")
        }) {
            Ok(native_id) if !session.revoked.load(Ordering::Acquire) => {
                tracing::info!(
                    elapsed_ms = started_at.elapsed().as_millis(),
                    "remote desktop Host native session ready"
                );
                active.native_id = Some(native_id);
                Ok(StartedSession {
                    id,
                    connectivity_warning,
                    ice_servers,
                })
            }
            result => {
                if let Ok(native_id) = result.as_ref() {
                    let _ = self.backend.stop(*native_id).await;
                }
                self.remove(id);
                Err(result
                    .err()
                    .unwrap_or_else(|| "device was revoked during connection".into()))
            }
        }
    }

    fn find(&self, owner: &str, id: u64) -> Result<Arc<Session>, String> {
        self.sessions
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .get(&id)
            .filter(|s| s.owner == owner && !s.revoked.load(Ordering::Acquire))
            .cloned()
            .ok_or_else(|| "remote control session is unavailable for this device".into())
    }
    fn native(session: &Session, active: &mut ActiveSession) -> Result<u64, String> {
        if session.revoked.load(Ordering::Acquire) || Instant::now() >= active.expires {
            return Err("remote control lease expired or revoked".into());
        }
        let id = active.native_id.ok_or("remote control session is closed")?;
        active.expires = Instant::now() + Duration::from_secs(LEASE_SECONDS);
        Ok(id)
    }
    pub async fn signal(&self, owner: &str, id: u64, signal: Signal) -> Result<(), String> {
        signal.validate()?;
        let session = self.find(owner, id)?;
        let mut active = session.active.lock().await;
        self.backend
            .signal(Self::native(&session, &mut active)?, signal)
            .await
    }
    pub async fn clipboard(&self, owner: &str, id: u64, text: String) -> Result<(), String> {
        if text.len() > 1024 * 1024 {
            return Err("clipboard exceeds 1 MiB".into());
        }
        let session = self.find(owner, id)?;
        let mut active = session.active.lock().await;
        self.backend
            .clipboard(Self::native(&session, &mut active)?, text)
            .await
    }
    /// One bounded subscription response; polling native state stays on the Host.
    pub async fn watch(&self, owner: &str, id: u64, after: u64) -> Result<HostUpdate, String> {
        let deadline = Instant::now() + Duration::from_secs(1);
        loop {
            let session = self.find(owner, id)?;
            let mut active = session.active.lock().await;
            let native_id = Self::native(&session, &mut active)?;
            let update = self.backend.update(native_id, after).await?;
            active.connected |= update.state == SessionState::Connected;
            let terminal = update.state.terminal();
            let connected = active.connected;
            drop(active);
            if terminal {
                self.stop(owner, id).await?;
            }
            if terminal || !update.signals.is_empty() || Instant::now() >= deadline {
                return Ok(update);
            }
            tokio::time::sleep(Duration::from_millis(if connected { 1000 } else { 40 })).await;
        }
    }
    pub async fn stop(&self, owner: &str, id: u64) -> Result<(), String> {
        let session = {
            let sessions = self
                .sessions
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            match sessions.get(&id) {
                None => return Ok(()),
                Some(session) if session.owner == owner => Arc::clone(session),
                Some(_) => return Err("remote control session belongs to another device".into()),
            }
        };
        session.revoked.store(true, Ordering::Release);
        self.close(id, &session).await
    }
    pub fn revoke(&self, owner: Option<&str>) {
        for session in self
            .sessions
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .values()
        {
            if owner.is_none_or(|owner| session.owner == owner) {
                session.revoked.store(true, Ordering::Release);
            }
        }
    }
    pub async fn reap(&self) {
        let sessions: Vec<_> = self
            .sessions
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .iter()
            .map(|(&id, s)| (id, Arc::clone(s)))
            .collect();
        for (id, session) in sessions {
            let active = session.active.lock().await;
            let now = Instant::now();
            let expired = session.revoked.load(Ordering::Acquire)
                || now >= active.expires
                || (!active.connected && now >= active.handshake_deadline);
            drop(active);
            if expired {
                let _ = self.close(id, &session).await;
            }
        }
    }
    async fn close(&self, id: u64, session: &Session) -> Result<(), String> {
        let mut active = session.active.lock().await;
        if let Some(native_id) = active.native_id {
            self.backend.stop(native_id).await?;
            active.native_id = None;
        }
        self.remove(id);
        Ok(())
    }
    fn remove(&self, id: u64) {
        self.sessions
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .remove(&id);
    }
}

#[async_trait::async_trait]
pub trait HostSessions: Send + Sync {
    async fn start(&self, owner: &str, request: StartRequest) -> Result<StartedSession, String>;
    async fn signal(&self, owner: &str, id: u64, signal: Signal) -> Result<(), String>;
    async fn clipboard(&self, owner: &str, id: u64, text: String) -> Result<(), String>;
    async fn watch(&self, owner: &str, id: u64, after: u64) -> Result<HostUpdate, String>;
    async fn stop(&self, owner: &str, id: u64) -> Result<(), String>;
    fn revoke(&self, owner: Option<&str>);
    async fn reap(&self);
}
#[async_trait::async_trait]
impl HostSessions for NativeHostSessions {
    async fn start(&self, owner: &str, request: StartRequest) -> Result<StartedSession, String> {
        NativeHostSessions::start(self, owner, request).await
    }
    async fn signal(&self, owner: &str, id: u64, signal: Signal) -> Result<(), String> {
        NativeHostSessions::signal(self, owner, id, signal).await
    }
    async fn clipboard(&self, owner: &str, id: u64, text: String) -> Result<(), String> {
        NativeHostSessions::clipboard(self, owner, id, text).await
    }
    async fn watch(&self, owner: &str, id: u64, after: u64) -> Result<HostUpdate, String> {
        NativeHostSessions::watch(self, owner, id, after).await
    }
    async fn stop(&self, owner: &str, id: u64) -> Result<(), String> {
        NativeHostSessions::stop(self, owner, id).await
    }
    fn revoke(&self, owner: Option<&str>) {
        NativeHostSessions::revoke(self, owner);
    }
    async fn reap(&self) {
        NativeHostSessions::reap(self).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicU64;
    #[derive(Default)]
    struct Desktop {
        next: AtomicU64,
        stopped: Mutex<Vec<u64>>,
        started_options: Mutex<Vec<super::super::model::NativeStartOptions>>,
        block_start: AtomicBool,
        started: tokio::sync::Notify,
        proceed: tokio::sync::Notify,
    }
    #[async_trait::async_trait]
    impl DesktopBackend for Desktop {
        async fn start(
            &self,
            options: super::super::model::NativeStartOptions,
        ) -> Result<u64, String> {
            self.started_options.lock().unwrap().push(options);
            if self.block_start.load(Ordering::Acquire) {
                self.started.notify_one();
                self.proceed.notified().await;
            }
            Ok(self.next.fetch_add(1, Ordering::Relaxed) + 1)
        }
        async fn signal(&self, _: u64, _: Signal) -> Result<(), String> {
            Ok(())
        }
        async fn update(&self, _: u64, _: u64) -> Result<HostUpdate, String> {
            Ok(HostUpdate {
                state: SessionState::Connected,
                route: "direct".into(),
                signals: Vec::new(),
            })
        }
        async fn clipboard(&self, _: u64, _: String) -> Result<(), String> {
            Ok(())
        }
        async fn stop(&self, id: u64) -> Result<(), String> {
            self.stopped.lock().unwrap().push(id);
            Ok(())
        }
    }
    #[derive(Default)]
    struct Ice;
    #[async_trait::async_trait]
    impl IceConfigProvider for Ice {
        async fn configuration(
            &self,
            _: &str,
            _: u64,
        ) -> Result<Vec<super::super::model::IceServer>, String> {
            Ok(vec![super::super::model::IceServer {
                urls: vec!["stun:stun.example.com:3478".into()],
                username: None,
                credential: None,
            }])
        }
    }
    fn options() -> StartRequest {
        StartRequest {
            auth_key: "a".repeat(32),
            max_bitrate_kbps: None,
            target_framerate: None,
            screen_id: None,
        }
    }
    fn sessions(desktop: Arc<Desktop>) -> NativeHostSessions {
        NativeHostSessions::new(desktop, Arc::new(Ice))
    }

    #[tokio::test]
    async fn host_owns_the_ice_configuration_used_by_native_and_client() {
        let desktop = Arc::new(Desktop::default());
        let host = sessions(desktop.clone());
        let started = host.start("client", options()).await.unwrap();
        let native = desktop.started_options.lock().unwrap();
        assert_eq!(native[0].ice_servers, started.ice_servers);
        assert_eq!(started.ice_servers[0].urls, ["stun:stun.example.com:3478"]);
    }

    #[tokio::test]
    async fn revoke_during_native_start_closes_the_late_handle() {
        let desktop = Arc::new(Desktop::default());
        desktop.block_start.store(true, Ordering::Release);
        let host = Arc::new(sessions(desktop.clone()));
        let creator = {
            let host = Arc::clone(&host);
            tokio::spawn(async move { host.start("alice", options()).await })
        };
        desktop.started.notified().await;
        host.revoke(Some("alice"));
        desktop.proceed.notify_one();
        assert!(creator.await.unwrap().is_err());
        assert_eq!(desktop.stopped.lock().unwrap().len(), 1);
        assert!(host.sessions.lock().unwrap().is_empty());
    }
    #[tokio::test]
    async fn device_ownership_is_required_for_every_session_operation() {
        let desktop = Arc::new(Desktop::default());
        let host = sessions(desktop.clone());
        let id = host.start("alice", options()).await.unwrap().id;
        assert!(host.clipboard("bob", id, "hello".into()).await.is_err());
        assert!(host.watch("bob", id, 0).await.is_err());
        assert!(
            host.signal(
                "bob",
                id,
                Signal {
                    sequence: 0,
                    description: None,
                    candidates: Vec::new()
                }
            )
            .await
            .is_err()
        );
        assert!(host.stop("bob", id).await.is_err());
        assert!(desktop.stopped.lock().unwrap().is_empty());
        host.stop("alice", id).await.unwrap();
        host.stop("alice", id).await.unwrap();
        assert_eq!(desktop.stopped.lock().unwrap().len(), 1);
    }
    #[tokio::test]
    async fn expired_and_revoked_sessions_release_native_capacity() {
        let desktop = Arc::new(Desktop::default());
        let host = sessions(desktop.clone());
        for _ in 0..MAX_SESSIONS {
            host.start("alice", options()).await.unwrap();
        }
        assert!(host.start("alice", options()).await.is_err());
        host.revoke(Some("alice"));
        host.reap().await;
        assert_eq!(desktop.stopped.lock().unwrap().len(), MAX_SESSIONS);
        let id = host.start("bob", options()).await.unwrap().id;
        host.find("bob", id).unwrap().active.lock().await.expires =
            Instant::now().checked_sub(Duration::from_secs(1)).unwrap();
        host.reap().await;
        assert!(host.sessions.lock().unwrap().is_empty());
        assert_eq!(desktop.stopped.lock().unwrap().len(), MAX_SESSIONS + 1);
    }
    #[tokio::test]
    async fn heartbeat_cannot_keep_an_unfinished_handshake_alive_forever() {
        let desktop = Arc::new(Desktop::default());
        let host = sessions(desktop.clone());
        let id = host.start("alice", options()).await.unwrap().id;
        host.find("alice", id)
            .unwrap()
            .active
            .lock()
            .await
            .handshake_deadline = Instant::now().checked_sub(Duration::from_secs(1)).unwrap();
        host.reap().await;
        assert_eq!(desktop.stopped.lock().unwrap().len(), 1);
    }
}
