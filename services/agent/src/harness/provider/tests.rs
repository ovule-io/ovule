use super::*;
use async_trait::async_trait;
use std::sync::atomic::{AtomicUsize, Ordering};
#[derive(Default)]
struct Counts {
    acquire: AtomicUsize,
    invoke: AtomicUsize,
    close: AtomicUsize,
    drop: AtomicUsize,
    acquiring_drop: AtomicUsize,
}
struct Fake {
    id: &'static str,
    name: &'static str,
    counts: Arc<Counts>,
    mode: &'static str,
    static_defs: bool,
}
struct Lease {
    name: &'static str,
    counts: Arc<Counts>,
    mode: &'static str,
}
struct AcquireGuard(Arc<Counts>);
impl Drop for AcquireGuard {
    fn drop(&mut self) {
        self.0.acquiring_drop.fetch_add(1, Ordering::SeqCst);
    }
}
fn definition(name: &str) -> CapabilityDefinition {
    CapabilityDefinition {
        name: name.into(),
        description: "Fixture capability".into(),
        input_schema: json!({"type":"object"}),
    }
}
#[async_trait]
impl CapabilityProvider for Fake {
    fn effect(&self, _name: &str, _args: &Value) -> ovule_agent_api::ToolEffect {
        if self.mode == "default_external" || self.mode == "invalid" {
            ovule_agent_api::ToolEffect::External
        } else {
            ovule_agent_api::ToolEffect::Workspace
        }
    }
    fn descriptor(&self) -> ProviderDescriptor {
        ProviderDescriptor {
            id: self.id.into(),
            description: "Fixture service".into(),
        }
    }
    fn preflight(&self, _name: &str, _args: &Value) -> Result<(), String> {
        if self.mode == "invalid" {
            return Err("Fixture path does not exist".into());
        }
        Ok(())
    }
    fn definitions(&self) -> Vec<CapabilityDefinition> {
        if self.static_defs {
            vec![definition(self.name)]
        } else {
            vec![]
        }
    }
    async fn acquire(
        &self,
        _cancel: CancellationToken,
    ) -> Result<Box<dyn CapabilityLease>, String> {
        self.counts.acquire.fetch_add(1, Ordering::SeqCst);
        let _guard = AcquireGuard(self.counts.clone());
        if self.mode == "fail" {
            return Err("credential secret must not leak".into());
        }
        if self.mode == "hang_acquire" {
            std::future::pending::<()>().await;
        }
        Ok(Box::new(Lease {
            name: self.name,
            counts: self.counts.clone(),
            mode: self.mode,
        }))
    }
}
impl Drop for Lease {
    fn drop(&mut self) {
        self.counts.drop.fetch_add(1, Ordering::SeqCst);
    }
}
#[async_trait]
impl CapabilityLease for Lease {
    fn definitions(&self) -> Vec<CapabilityDefinition> {
        vec![definition(self.name)]
    }
    async fn invoke(
        &mut self,
        _name: &str,
        _args: &Value,
        _cancel: CancellationToken,
    ) -> Result<Value, ProviderError> {
        self.counts.invoke.fetch_add(1, Ordering::SeqCst);
        match self.mode {
            "fatal" => Err(ProviderError::Unavailable("transport lost".into())),
            "tool_error" => Err(ProviderError::Tool("bad arguments".into())),
            "typed_error" => Ok(json!({"isError":true,"content":[]})),
            _ => Ok(json!({"ok":true})),
        }
    }
    async fn close(&mut self) -> Result<(), String> {
        self.counts.close.fetch_add(1, Ordering::SeqCst);
        if self.mode == "hang_close" {
            std::future::pending::<()>().await;
        }
        if self.mode == "fail_close" {
            return Err("fixture close failed".into());
        }
        Ok(())
    }
}
fn fake(
    id: &'static str,
    name: &'static str,
    mode: &'static str,
) -> (Arc<dyn CapabilityProvider>, Arc<Counts>) {
    let counts = Arc::new(Counts::default());
    (
        Arc::new(Fake {
            id,
            name,
            mode,
            counts: counts.clone(),
            static_defs: false,
        }),
        counts,
    )
}
fn registry(
    providers: Vec<Arc<dyn CapabilityProvider>>,
    cancel: CancellationToken,
) -> CapabilityRegistry {
    let notify: WorkerEventCallback = Arc::new(|_| {});
    let execution = Arc::new(crate::execution::ToolExecutor::new(
        "provider-fixture".into(),
        cancel,
        crate::execution::approval::ApprovalBroker::unavailable(),
        notify.clone(),
    ));
    CapabilityRegistry::new(
        providers,
        execution,
        notify,
        ProviderLimits {
            acquire: Duration::from_millis(30),
            close: Duration::from_millis(30),
        },
    )
    .unwrap()
}
async fn discover(registry: &mut CapabilityRegistry, args: Value) -> Result<Value, String> {
    registry
        .invoke(
            DISCOVERY_TOOL,
            &args,
            &BTreeSet::from([DISCOVERY_TOOL.into()]),
        )
        .await
}
async fn acquire_load(registry: &mut CapabilityRegistry, id: &str, name: &str) {
    discover(registry, json!({"action":"acquire","provider":id}))
        .await
        .unwrap();
    discover(registry, json!({"action":"load","names":[name]}))
        .await
        .unwrap();
}
#[tokio::test]
async fn providers_are_injected_lazy_isolated_and_never_implicitly_retried() {
    let (bad, bad_counts) = fake("broken", "ovule_workspace_broken", "fail");
    let (good, good_counts) = fake("healthy", "ovule_workspace_ok", "ok");
    let mut registry = registry(vec![bad, good], CancellationToken::new());
    let search = discover(&mut registry, json!({"action":"search"}))
        .await
        .unwrap();
    assert_eq!(search["providers"][0]["state"], "dormant");
    assert_eq!(good_counts.acquire.load(Ordering::SeqCst), 0);
    assert_eq!(registry.exposed().len(), 1);
    for _ in 0..2 {
        let error = discover(
            &mut registry,
            json!({"action":"acquire","provider":"broken"}),
        )
        .await
        .unwrap_err();
        assert!(!error.contains("credential secret"));
    }
    assert_eq!(bad_counts.acquire.load(Ordering::SeqCst), 1);
    acquire_load(&mut registry, "healthy", "ovule_workspace_ok").await;
    let exposed = registry.exposed().iter().map(|d| d.name.clone()).collect();
    assert_eq!(
        registry
            .invoke("ovule_workspace_ok", &json!({}), &exposed)
            .await
            .unwrap()["ok"],
        true
    );
    discover(
        &mut registry,
        json!({"action":"acquire","provider":"healthy"}),
    )
    .await
    .unwrap();
    assert_eq!(good_counts.acquire.load(Ordering::SeqCst), 1);
    registry.shutdown().await.unwrap();
    registry.shutdown().await.unwrap();
    assert_eq!(good_counts.close.load(Ordering::SeqCst), 1);
    assert_eq!(good_counts.drop.load(Ordering::SeqCst), 1);
    assert!(
        registry
            .invoke("ovule_workspace_ok", &json!({}), &exposed)
            .await
            .is_err()
    );
}
#[tokio::test]
async fn duplicate_tool_ownership_rejects_only_new_provider_and_releases_lease() {
    let (first, _) = fake("first", "ovule_workspace_shared", "ok");
    let (second, counts) = fake("second", "ovule_workspace_shared", "ok");
    let mut registry = registry(vec![first, second], CancellationToken::new());
    acquire_load(&mut registry, "first", "ovule_workspace_shared").await;
    assert!(
        discover(
            &mut registry,
            json!({"action":"acquire","provider":"second"})
        )
        .await
        .is_err()
    );
    assert_eq!(counts.close.load(Ordering::SeqCst), 1);
    assert_eq!(counts.drop.load(Ordering::SeqCst), 1);
    let exposed = registry.exposed().iter().map(|d| d.name.clone()).collect();
    assert!(
        registry
            .invoke("ovule_workspace_shared", &json!({}), &exposed)
            .await
            .is_ok()
    );
    registry.shutdown().await.unwrap();
}
#[tokio::test]
async fn fatal_connection_errors_close_without_reconnect_but_tool_errors_keep_provider() {
    for mode in ["fatal", "tool_error", "typed_error"] {
        let (provider, counts) = fake("service", "ovule_workspace_test", mode);
        let mut registry = registry(vec![provider], CancellationToken::new());
        acquire_load(&mut registry, "service", "ovule_workspace_test").await;
        let exposed = registry.exposed().iter().map(|d| d.name.clone()).collect();
        for _ in 0..2 {
            assert!(
                registry
                    .invoke("ovule_workspace_test", &json!({}), &exposed)
                    .await
                    .is_err()
            );
        }
        assert_eq!(counts.acquire.load(Ordering::SeqCst), 1);
        assert_eq!(
            counts.invoke.load(Ordering::SeqCst),
            if mode == "fatal" { 1 } else { 2 }
        );
        registry.shutdown().await.unwrap();
        assert_eq!(counts.close.load(Ordering::SeqCst), 1);
    }
}
#[tokio::test]
async fn acquisition_timeout_and_cancellation_drop_partial_resources() {
    let (provider, counts) = fake("timeout", "ovule_workspace_test", "hang_acquire");
    let mut timed = registry(vec![provider], CancellationToken::new());
    assert!(
        discover(&mut timed, json!({"action":"acquire","provider":"timeout"}))
            .await
            .is_err()
    );
    assert_eq!(counts.acquiring_drop.load(Ordering::SeqCst), 1);
    let (provider, counts) = fake("cancel", "ovule_workspace_test", "hang_acquire");
    let cancel = CancellationToken::new();
    let mut cancelled = registry(vec![provider], cancel.clone());
    let call = discover(
        &mut cancelled,
        json!({"action":"acquire","provider":"cancel"}),
    );
    let trigger = async {
        tokio::task::yield_now().await;
        cancel.cancel();
    };
    let (result, ()) = tokio::join!(call, trigger);
    assert!(result.is_err());
    assert_eq!(counts.acquiring_drop.load(Ordering::SeqCst), 1);
    cancelled.shutdown().await.unwrap();
}
#[tokio::test]
async fn shutdown_is_bounded_and_drop_also_releases_ready_leases() {
    let (provider, counts) = fake("slow", "ovule_workspace_test", "hang_close");
    let mut slow_registry = registry(vec![provider], CancellationToken::new());
    acquire_load(&mut slow_registry, "slow", "ovule_workspace_test").await;
    assert!(
        tokio::time::timeout(Duration::from_millis(500), slow_registry.shutdown())
            .await
            .unwrap()
            .is_err()
    );
    assert!(slow_registry.shutdown().await.is_err());
    assert_eq!(counts.drop.load(Ordering::SeqCst), 1);
    let (provider, counts) = fake("drop", "ovule_workspace_test", "ok");
    let mut dropped = registry(vec![provider], CancellationToken::new());
    acquire_load(&mut dropped, "drop", "ovule_workspace_test").await;
    drop(dropped);
    assert_eq!(counts.drop.load(Ordering::SeqCst), 1);
}
#[tokio::test]
async fn discovery_rejects_unselected_providers_and_same_request_speculation() {
    let (provider, counts) = fake("one", "ovule_workspace_test", "ok");
    let mut registry = registry(vec![provider], CancellationToken::new());
    assert!(
        discover(
            &mut registry,
            json!({"action":"acquire","provider":"missing"})
        )
        .await
        .is_err()
    );
    assert!(
        discover(
            &mut registry,
            json!({"action":"acquire","provider":"one","unknown":true})
        )
        .await
        .is_err()
    );
    let before = registry.exposed().iter().map(|d| d.name.clone()).collect();
    acquire_load(&mut registry, "one", "ovule_workspace_test").await;
    assert!(
        registry
            .invoke("ovule_workspace_test", &json!({}), &before)
            .await
            .is_err()
    );
    assert_eq!(counts.invoke.load(Ordering::SeqCst), 0);
    registry.shutdown().await.unwrap();
}

#[tokio::test]
async fn cleanup_failure_is_reported_and_stays_failed_on_repeat_shutdown() {
    let (provider, counts) = fake("failed-close", "ovule_workspace_test", "fail_close");
    let mut registry = registry(vec![provider], CancellationToken::new());
    acquire_load(&mut registry, "failed-close", "ovule_workspace_test").await;
    assert!(registry.shutdown().await.is_err());
    assert!(registry.shutdown().await.is_err());
    assert_eq!(counts.close.load(Ordering::SeqCst), 1);
    assert_eq!(counts.drop.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn tool_names_cannot_bypass_injected_provider_effect_policy() {
    let (provider, counts) = fake(
        "external",
        "ovule_workspace_untrusted_name",
        "default_external",
    );
    let mut registry = registry(vec![provider], CancellationToken::new());
    acquire_load(&mut registry, "external", "ovule_workspace_untrusted_name").await;
    let exposed = registry.exposed().iter().map(|d| d.name.clone()).collect();
    assert!(
        registry
            .invoke("ovule_workspace_untrusted_name", &json!({}), &exposed)
            .await
            .is_err()
    );
    assert_eq!(counts.invoke.load(Ordering::SeqCst), 0);
    registry.shutdown().await.unwrap();
}

#[tokio::test]
async fn invalid_requests_fail_before_approval_and_never_reach_the_provider() {
    let (provider, counts) = fake("invalid", "ovule_fixture", "invalid");
    let mut registry = registry(vec![provider], CancellationToken::new());
    acquire_load(&mut registry, "invalid", "ovule_fixture").await;
    let exposed = registry
        .exposed()
        .iter()
        .map(|definition| definition.name.clone())
        .collect();
    let error = registry
        .invoke("ovule_fixture", &json!({}), &exposed)
        .await
        .unwrap_err();
    assert!(error.contains("Fixture path does not exist"));
    assert!(
        !error.contains("Approval UI unavailable"),
        "invalid calls do not require user authorization"
    );
    assert_eq!(counts.invoke.load(Ordering::SeqCst), 0);
    registry.shutdown().await.unwrap();
}
