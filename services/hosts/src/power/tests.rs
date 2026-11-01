use super::*;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

#[derive(Default)]
struct FakeBackend {
    active: Arc<AtomicUsize>,
    fail: AtomicBool,
}
struct FakeLease(Arc<AtomicUsize>);
impl Lease for FakeLease {}
impl Drop for FakeLease {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::SeqCst);
    }
}
impl Backend for FakeBackend {
    fn supported(&self) -> bool {
        true
    }
    fn acquire(&self) -> Result<Box<dyn Lease>, String> {
        if self.fail.load(Ordering::SeqCst) {
            return Err("Power request rejected".into());
        }
        self.active.fetch_add(1, Ordering::SeqCst);
        Ok(Box::new(FakeLease(self.active.clone())))
    }
}

#[test]
fn preference_is_opt_in_and_restores_without_a_remote_session() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("host-power.json");
    let backend = Arc::new(FakeBackend::default());
    let service = NativeHostPower::with_backend(path.clone(), backend.clone());
    assert!(!service.status().keep_awake);
    assert_eq!(backend.active.load(Ordering::SeqCst), 0);
    assert!(service.set_keep_awake(true).unwrap().active);
    service.set_keep_awake(true).unwrap();
    assert_eq!(backend.active.load(Ordering::SeqCst), 1);
    service.shutdown();
    assert_eq!(backend.active.load(Ordering::SeqCst), 0);
    assert!(service.set_keep_awake(true).is_err());
    let restored = NativeHostPower::with_backend(path, backend.clone());
    assert!(restored.status().keep_awake && restored.status().active);
    restored.set_keep_awake(false).unwrap();
    assert_eq!(backend.active.load(Ordering::SeqCst), 0);
}

#[test]
fn failed_acquire_or_save_does_not_leave_an_unrequested_assertion() {
    let directory = tempfile::tempdir().unwrap();
    let backend = Arc::new(FakeBackend::default());
    let path = directory.path().join("host-power.json");
    let service = NativeHostPower::with_backend(path.clone(), backend.clone());
    backend.fail.store(true, Ordering::SeqCst);
    assert!(service.set_keep_awake(true).is_err());
    assert!(!service.status().keep_awake);
    assert!(!path.exists());
    backend.fail.store(false, Ordering::SeqCst);
    std::fs::create_dir(&path).unwrap();
    assert!(service.set_keep_awake(true).is_err());
    assert_eq!(backend.active.load(Ordering::SeqCst), 0);
    assert!(!service.status().active);
    std::fs::remove_dir(&path).unwrap();
    service.set_keep_awake(true).unwrap();
    drop(service);
    assert_eq!(backend.active.load(Ordering::SeqCst), 0);
}

#[test]
fn startup_failure_is_reported_without_preventing_app_start_and_can_retry() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("host-power.json");
    std::fs::write(&path, r#"{"keepAwake":true}"#).unwrap();
    let backend = Arc::new(FakeBackend::default());
    backend.fail.store(true, Ordering::SeqCst);
    let service = NativeHostPower::with_backend(path, backend.clone());
    assert!(service.status().keep_awake);
    assert!(!service.status().active);
    assert_eq!(
        service.status().error.as_deref(),
        Some("Power request rejected")
    );
    backend.fail.store(false, Ordering::SeqCst);
    let status = service.set_keep_awake(true).unwrap();
    assert!(status.active && status.error.is_none());
}

#[test]
fn corrupt_preferences_are_visible_and_can_be_replaced() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("host-power.json");
    std::fs::write(&path, "broken").unwrap();
    let service = NativeHostPower::with_backend(path, Arc::new(FakeBackend::default()));
    assert!(service.status().error.is_some());
    assert!(!service.status().active);
    assert!(service.set_keep_awake(true).unwrap().active);
}
