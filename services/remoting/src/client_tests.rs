use super::backend::{ControlTransport, HostDirectory, SessionEvents};
use super::model::{HostUpdate, IceServer, SessionUpdate, Signal, StartRequest, StartedSession};
use std::sync::{Arc, mpsc};
use std::time::Duration;

struct GateTransport {
    started: mpsc::Sender<()>,
    stopped: mpsc::Sender<()>,
    proceed: tokio::sync::Notify,
}
#[async_trait::async_trait]
impl ControlTransport for GateTransport {
    async fn start(&self, _: StartRequest) -> Result<StartedSession, String> {
        self.started.send(()).unwrap();
        self.proceed.notified().await;
        Ok(StartedSession {
            id: 71,
            connectivity_warning: None,
            ice_servers: vec![IceServer {
                urls: vec!["stun:stun.example.com:3478".into()],
                username: None,
                credential: None,
            }],
        })
    }
    async fn signal(&self, _: u64, _: Signal) -> Result<(), String> {
        panic!("cancelled input must not execute")
    }
    async fn watch(&self, _: u64, _: u64) -> Result<HostUpdate, String> {
        // Start may finish on another worker just before the facade is dropped.
        // An observation can legitimately begin in that interval; shutdown must
        // cancel this pending watch and still stop the native session.
        std::future::pending().await
    }
    async fn clipboard(&self, _: u64, _: String) -> Result<(), String> {
        panic!("cancelled clipboard must not execute")
    }
    async fn stop(&self, id: u64) -> Result<(), String> {
        assert_eq!(id, 71);
        self.stopped.send(()).unwrap();
        Ok(())
    }
}
struct Directory(Arc<GateTransport>);
impl HostDirectory for Directory {
    fn connect(&self, _: &str) -> Result<Arc<dyn ControlTransport>, String> {
        Ok(self.0.clone())
    }
}
struct Events;
impl SessionEvents for Events {
    fn changed(&self, _: &SessionUpdate) {}
}

#[tokio::test(start_paused = true)]
async fn startup_can_outlast_ten_seconds_without_losing_the_host_response() {
    let (started_tx, started_rx) = mpsc::channel();
    let (stopped_tx, stopped_rx) = mpsc::channel();
    let transport = Arc::new(GateTransport {
        started: started_tx,
        stopped: stopped_tx,
        proceed: tokio::sync::Notify::new(),
    });
    let service = super::client::NativeRemotingService::new(
        Arc::new(Directory(transport.clone())),
        Arc::new(Events),
        tokio::runtime::Handle::current(),
    );
    let id = service
        .start(
            "host".into(),
            StartRequest {
                auth_key: "a".repeat(32),
                max_bitrate_kbps: None,
                target_framerate: None,
                screen_id: None,
            },
        )
        .unwrap();
    tokio::task::yield_now().await;
    started_rx.try_recv().unwrap();
    tokio::time::advance(Duration::from_secs(11)).await;
    tokio::task::yield_now().await;
    assert!(service.snapshot(id, 0).unwrap().error.is_none());
    transport.proceed.notify_one();
    tokio::task::yield_now().await;
    assert!(service.snapshot(id, 0).unwrap().ice_servers.is_some());
    service.stop(id);
    service.shutdown_and_wait(Duration::from_secs(1)).await;
    stopped_rx.try_recv().unwrap();
}

#[test]
fn slow_start_does_not_block_the_facade_and_stop_bypasses_a_full_queue() {
    let (started_tx, started_rx) = mpsc::channel();
    let (stopped_tx, stopped_rx) = mpsc::channel();
    let transport = Arc::new(GateTransport {
        started: started_tx,
        stopped: stopped_tx,
        proceed: tokio::sync::Notify::new(),
    });
    let runtime = tokio::runtime::Runtime::new().unwrap();
    let service = super::client::NativeRemotingService::new(
        Arc::new(Directory(transport.clone())),
        Arc::new(Events),
        runtime.handle().clone(),
    );
    let id = service
        .start(
            "host".into(),
            StartRequest {
                auth_key: "a".repeat(32),
                max_bitrate_kbps: None,
                target_framerate: None,
                screen_id: None,
            },
        )
        .unwrap();
    started_rx.recv_timeout(Duration::from_secs(2)).unwrap();
    // The native/network Start is still blocked, but local commands are available.
    assert_eq!(service.snapshot(id, 0).unwrap().session_id, id.to_string());
    for _ in 0..64 {
        service
            .signal(
                id,
                Signal {
                    sequence: 0,
                    description: None,
                    candidates: Vec::new(),
                },
            )
            .unwrap();
    }
    assert!(
        service
            .signal(
                id,
                Signal {
                    sequence: 0,
                    description: None,
                    candidates: Vec::new()
                }
            )
            .is_err()
    );
    service.stop(id);
    transport.proceed.notify_one();
    stopped_rx.recv_timeout(Duration::from_secs(2)).unwrap();
}

#[test]
fn dropping_facade_waits_for_active_session_cleanup() {
    let (started_tx, started_rx) = mpsc::channel();
    let (stopped_tx, stopped_rx) = mpsc::channel();
    let transport = Arc::new(GateTransport {
        started: started_tx,
        stopped: stopped_tx,
        proceed: tokio::sync::Notify::new(),
    });
    let runtime = tokio::runtime::Runtime::new().unwrap();
    let service = super::client::NativeRemotingService::new(
        Arc::new(Directory(transport.clone())),
        Arc::new(Events),
        runtime.handle().clone(),
    );
    // Host reset stops sessions without closing the reusable facade.
    service.shutdown();
    service
        .start(
            "host".into(),
            StartRequest {
                auth_key: "a".repeat(32),
                max_bitrate_kbps: None,
                target_framerate: None,
                screen_id: None,
            },
        )
        .unwrap();
    started_rx.recv_timeout(Duration::from_secs(2)).unwrap();
    transport.proceed.notify_one();
    let shutdown_started = std::time::Instant::now();
    drop(service);
    stopped_rx.recv_timeout(Duration::from_secs(2)).unwrap();
    assert!(
        shutdown_started.elapsed() < Duration::from_secs(2),
        "shutdown must skip diagnostic retention"
    );
}
