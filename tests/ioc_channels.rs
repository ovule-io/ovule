#[path = "support/ioc.rs"]
mod ioc_support;
use ovule_channels::*;
use ovule_extensions as extensions;
use std::sync::{Arc, Mutex};

#[test]
fn registered_channel_aliases_share_the_overridden_control_without_starting_runtime() {
    use std::sync::atomic::{AtomicUsize, Ordering};
    use tuffite_ioc::Registry;
    use tuffite_ioc::Service;

    struct Control(Arc<AtomicUsize>);
    impl ChannelControl for Control {
        fn status(&self, _: Option<&str>) -> ChannelOverview {
            self.0.fetch_add(1, Ordering::SeqCst);
            ChannelOverview {
                threads: Vec::new(),
                selected_connection_id: None,
                connections: vec![],
            }
        }
        fn refresh(&self, _: &str) -> Result<ChannelOverview, String> {
            Ok(self.status(None))
        }
        fn start_registration(&self, _: &str, _: bool) -> Result<ChannelOverview, String> {
            Ok(self.status(None))
        }
    }
    let calls = Arc::new(AtomicUsize::new(0));
    let starts = Arc::new(AtomicUsize::new(0));
    let mut registry = Registry::new(Arc::new(()));
    let mut selected = ioc_support::SelectedProviders::new(
        &mut registry,
        vec![
            std::any::TypeId::of::<ChannelRuntimeService>(),
            std::any::TypeId::of::<Service<dyn ChannelControl>>(),
        ],
    );
    providers::register_runtime(&mut selected).unwrap();
    providers::register(&mut selected).unwrap();
    drop(selected);
    let observed_starts = starts.clone();
    registry
        .register(tuffite_ioc::factory::<ChannelRuntimeService, _, _>(
            move |_| {
                observed_starts.fetch_add(1, Ordering::SeqCst);
                Err("runtime should stay lazy".to_owned())
            },
        ))
        .unwrap();
    let control: Arc<dyn ChannelControl> = Arc::new(Control(calls.clone()));
    registry
        .register(tuffite_ioc::factory::<Service<dyn ChannelControl>, _, _>(
            move |_| Ok(Arc::clone(&control)),
        ))
        .unwrap();
    registry.freeze();
    let context = registry;
    assert!(context.cached::<ChannelRuntimeService>().is_none());
    context.get::<Service<ChannelStatusState>>().unwrap();
    let channels = context.get::<Channels>().unwrap();
    let status = context.get::<Service<dyn ChannelStatusProvider>>().unwrap();
    let actions = context
        .get::<Service<dyn extensions::ExtensionChannelActions>>()
        .unwrap();
    assert_eq!(
        Arc::as_ptr(&channels).cast::<()>(),
        Arc::as_ptr(&status).cast::<()>()
    );
    assert_eq!(
        Arc::as_ptr(&channels).cast::<()>(),
        Arc::as_ptr(&actions).cast::<()>()
    );
    status.status_json(CHANNEL_TYPE, "").unwrap();
    actions.refresh(CHANNEL_TYPE, "").unwrap();
    assert_eq!(calls.load(Ordering::SeqCst), 2);
    assert_eq!(starts.load(Ordering::SeqCst), 0);
    assert!(context.cached::<ChannelRuntimeService>().is_none());
}

#[test]
fn registered_control_uses_the_cached_runtime_owner() {
    use std::sync::atomic::{AtomicUsize, Ordering};
    use tuffite_ioc::Registry;
    use tuffite_ioc::Service;

    struct Runtime(Arc<AtomicUsize>, Arc<dyn ChannelControl>);
    impl ChannelRuntime for Runtime {
        fn control(&self) -> Arc<dyn ChannelControl> {
            self.0.fetch_add(1, Ordering::SeqCst);
            self.1.clone()
        }
        fn shutdown(&mut self) {}
    }
    struct Control;
    impl ChannelControl for Control {
        fn status(&self, _: Option<&str>) -> ChannelOverview {
            ChannelOverview {
                threads: Vec::new(),
                selected_connection_id: None,
                connections: vec![],
            }
        }
        fn refresh(&self, _: &str) -> Result<ChannelOverview, String> {
            Ok(self.status(None))
        }
        fn start_registration(&self, _: &str, _: bool) -> Result<ChannelOverview, String> {
            Ok(self.status(None))
        }
    }
    let calls = Arc::new(AtomicUsize::new(0));
    let control: Arc<dyn ChannelControl> = Arc::new(Control);
    let runtime: Arc<Mutex<Box<dyn ChannelRuntime>>> = Arc::new(Mutex::new(Box::new(Runtime(
        calls.clone(),
        control.clone(),
    ))));
    let mut registry = Registry::new(Arc::new(()));
    let mut selected = ioc_support::SelectedProviders::new(
        &mut registry,
        vec![std::any::TypeId::of::<ChannelRuntimeService>()],
    );
    providers::register_runtime(&mut selected).unwrap();
    drop(selected);
    let overridden_runtime = Arc::clone(&runtime);
    registry
        .register(tuffite_ioc::factory::<ChannelRuntimeService, _, _>(
            move |_| Ok(Arc::clone(&overridden_runtime)),
        ))
        .unwrap();
    registry.freeze();
    let context = registry;
    let resolved = context.get::<Service<dyn ChannelControl>>().unwrap();
    assert!(Arc::ptr_eq(&control, &resolved));
    assert!(Arc::ptr_eq(
        &resolved,
        &context.get::<Service<dyn ChannelControl>>().unwrap()
    ));
    assert!(Arc::ptr_eq(
        &runtime,
        &context.cached::<ChannelRuntimeService>().unwrap()
    ));
    assert_eq!(calls.load(Ordering::SeqCst), 1);
}
