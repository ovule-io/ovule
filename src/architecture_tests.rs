use std::path::{Path, PathBuf};

fn rust_sources(root: &Path) -> Vec<PathBuf> {
    if root.is_file() {
        return vec![root.to_path_buf()];
    }
    let mut sources = Vec::new();
    let mut pending = vec![root.to_path_buf()];
    while let Some(directory) = pending.pop() {
        for entry in std::fs::read_dir(directory).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() {
                pending.push(path);
            } else if path.extension().is_some_and(|extension| extension == "rs") {
                sources.push(path);
            }
        }
    }
    sources
}

fn relative(path: &Path) -> String {
    path.strip_prefix(env!("CARGO_MANIFEST_DIR"))
        .unwrap()
        .to_string_lossy()
        .replace('\\', "/")
}

#[test]
fn shell_commands_only_map_transport_and_services() {
    let shell = Path::new(env!("CARGO_MANIFEST_DIR")).join("src/shell");
    for path in rust_sources(&shell)
        .into_iter()
        .chain(rust_sources(&shell.with_extension("rs")))
    {
        let source = std::fs::read_to_string(&path).unwrap();
        for forbidden in [
            ".runtimes",
            "lock_workspace",
            "SharedWorkspace",
            "crate::store",
            "crate::bootstrap",
        ] {
            assert!(
                !source.contains(forbidden),
                "{} bypasses a service boundary with `{forbidden}`",
                relative(&path)
            );
        }
    }
}

#[test]
fn runtime_owners_are_only_used_by_composition_and_shutdown() {
    let source_root = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    for path in rust_sources(&source_root).into_iter().chain(rust_sources(
        &Path::new(env!("CARGO_MANIFEST_DIR")).join("services"),
    )) {
        let relative = relative(&path);
        if matches!(
            relative.as_str(),
            "src/bootstrap.rs"
                | "src/runtime.rs"
                | "src/lifecycle.rs"
                | "src/architecture_tests.rs"
        ) {
            continue;
        }
        let source = std::fs::read_to_string(&path).unwrap();
        assert!(
            !source.contains(".runtimes"),
            "{relative} accesses a runtime owner outside lifecycle composition"
        );
    }
}

#[test]
fn capability_services_depend_on_consumer_interfaces() {
    let source_root = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    for path in rust_sources(&source_root).into_iter().chain(rust_sources(
        &Path::new(env!("CARGO_MANIFEST_DIR")).join("services"),
    )) {
        if path.file_name().and_then(|name| name.to_str()) != Some("service.rs") {
            continue;
        }
        let source = std::fs::read_to_string(&path).unwrap();
        for runtime_type in [
            "ChannelHandle",
            "DriverHandle",
            "OllamaHandle",
            "TerminalHandle",
            "ToolchainJobs",
        ] {
            assert!(
                !source.contains(runtime_type),
                "{} depends directly on runtime implementation `{runtime_type}`",
                relative(&path)
            );
        }
        for state_bypass in ["SharedWorkspace", "lock_workspace", ".store"] {
            assert!(
                !source.contains(state_bypass),
                "{} bypasses WorkspaceSession with `{state_bypass}`",
                relative(&path)
            );
        }
    }
}

#[test]
fn channel_transport_uses_state_ports() {
    let channels = Path::new(env!("CARGO_MANIFEST_DIR")).join("services/channels/src");
    for path in rust_sources(&channels) {
        let file_name = path.file_name().and_then(|name| name.to_str()).unwrap();
        // The persistence adapter implements these ports using workspace repository contracts.
        if matches!(file_name, "tests.rs" | "workspace_adapters.rs") {
            continue;
        }
        let source = std::fs::read_to_string(&path).unwrap();
        for forbidden in ["SharedWorkspace", "lock_workspace", ".store"] {
            assert!(
                !source.contains(forbidden),
                "{} bypasses a channel state port with `{forbidden}`",
                relative(&path)
            );
        }
    }
}

#[test]
fn capability_models_do_not_depend_on_shell_or_tuffite_dtos() {
    let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));
    let mut paths = rust_sources(&manifest.join("services/workspace/src/state"));
    paths.push(manifest.join("services/workspace/src/state/mod.rs"));
    paths.push(manifest.join("services/settings/src/catalog/model.rs"));
    for path in paths {
        let source = std::fs::read_to_string(&path).unwrap();
        for forbidden in ["crate::shell_api", "tuffite::Timestamp"] {
            assert!(
                !source.contains(forbidden),
                "{} leaks transport type `{forbidden}` into a capability model",
                relative(&path)
            );
        }
    }
}

#[test]
fn generated_shell_dtos_stay_inside_the_shell_adapter() {
    let source_root = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    for path in rust_sources(&source_root).into_iter().chain(rust_sources(
        &Path::new(env!("CARGO_MANIFEST_DIR")).join("services"),
    )) {
        let relative = relative(&path);
        if relative.starts_with("src/shell/")
            || relative == "src/shell.rs"
            || relative == "src/runtime.rs" // Browser declares its implemented interfaces.
            || relative == "src/architecture_tests.rs"
        {
            continue;
        }
        let source = std::fs::read_to_string(&path).unwrap();
        assert!(
            !source.contains("crate::shell_api"),
            "{relative} imports a generated ShellAPI DTO outside the shell adapter"
        );
    }
}

#[test]
fn framework_entry_remains_a_small_composition_surface() {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("src/lib.rs");
    let source = std::fs::read_to_string(path).unwrap();
    assert!(
        source.lines().count() <= 160,
        "src/lib.rs grew beyond 160 lines"
    );
    assert!(
        !source.contains("#[tuffite::command"),
        "Shell commands belong under src/shell"
    );
}

#[test]
fn setup_service_remains_a_small_capability_facade() {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("services/setup/src/service.rs");
    let source = std::fs::read_to_string(path).unwrap();
    assert!(
        source
            .split("pub trait Setup")
            .next()
            .unwrap()
            .lines()
            .count()
            <= 150,
        "setup/service.rs implementation should delegate to onboarding, models, providers, and toolchains"
    );
}

#[test]
fn remoting_rules_do_not_depend_on_native_implementations() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("services/remoting/src");
    for name in ["model.rs", "backend.rs", "client.rs", "host.rs", "ice.rs"] {
        let source = std::fs::read_to_string(root.join(name)).unwrap();
        for forbidden in [
            "tuffite::",
            "crate::workspace",
            "TunnelTransport",
            "crate::shell_api",
        ] {
            assert!(
                !source.contains(forbidden),
                "remote_control/{name} leaks adapter {forbidden}"
            );
        }
    }
    let source = std::fs::read_to_string(
        Path::new(env!("CARGO_MANIFEST_DIR")).join("services/workspace/src/management.rs"),
    )
    .unwrap();
    assert!(!source.contains("remote_control_runtime"));
    assert!(!source.contains("fn start_remote_control"));
}

#[test]
fn link_storage_and_wire_evolution_are_separate() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("services/hosts/src/tunnel");
    let storage = std::fs::read_to_string(root.join("access.rs")).unwrap();
    let protocol = std::fs::read_to_string(root.join("protocol.rs")).unwrap();
    assert!(!storage.contains("use super::protocol"));
    assert!(!storage.contains("HOST_PROTOCOL"));
    assert!(!protocol.contains("use super::access"));
    assert!(!protocol.contains("schema_version"));
}

#[test]
fn remote_control_ice_policy_is_host_owned() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR"));
    let shell =
        std::fs::read_to_string(root.join("desktop/packages/ovule-shell-api/shell_api.mojom"))
            .unwrap();
    let start = shell
        .split("struct RemoteControlStartOptions")
        .nth(1)
        .unwrap()
        .split('}')
        .next()
        .unwrap();
    assert!(!start.contains("iceServers"));
    let update = shell
        .split("struct RemoteControlUpdate")
        .nth(1)
        .unwrap()
        .split('}')
        .next()
        .unwrap();
    assert!(update.contains("iceServers"));
    let panel = std::fs::read_to_string(
        root.join("desktop/features/remoting/src/LinkRemoteControlPanel.tsx"),
    )
    .unwrap();
    assert!(!panel.contains("serverCredential"));
    assert!(!panel.contains("STUN / TURN servers"));
}

#[test]
fn services_depend_on_consumer_interfaces_not_native_adapters() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("services");
    let business_sources = [
        "workspace/src/state",
        "conversation/src/service.rs",
        "terminal/src/service.rs",
        "workflow/src/service.rs",
        "settings/src/service.rs",
    ];
    for path in business_sources
        .into_iter()
        .flat_map(|name| rust_sources(&root.join(name)))
    {
        let source = std::fs::read_to_string(&path).unwrap();
        for forbidden in [
            "tuffite::",
            "crate::store",
            "crate::shell",
            "crate::agents",
            "crate::secret_store",
            "iroh::",
            "rusqlite::",
        ] {
            assert!(
                !source.contains(forbidden),
                "{} bypasses the services boundary with {forbidden}",
                relative(&path)
            );
        }
    }
}

#[test]
fn business_modules_cannot_import_ioc_ownership_or_bridge() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("services");
    let manifests = std::fs::read_dir(&root).unwrap().filter_map(|entry| {
        let path = entry.unwrap().path().join("Cargo.toml");
        path.is_file().then_some(path)
    });
    for path in manifests {
        let manifest = std::fs::read_to_string(&path).unwrap();
        assert!(
            !manifest.contains("\"registry\""),
            "{} depends on IoC ownership",
            relative(&path),
        );
        assert!(
            !manifest
                .lines()
                .any(|line| line.trim_start().starts_with("ovule =")),
            "{} depends on the application",
            relative(&path),
        );
    }

    for path in rust_sources(&root) {
        let source = std::fs::read_to_string(&path).unwrap();
        for forbidden in [
            "tuffite_ioc::Registry",
            "tuffite_ioc::bridge",
            "tuffite_ioc::*",
            ".services.",
        ] {
            assert!(
                !source.contains(forbidden),
                "{} accesses IoC ownership through {forbidden}",
                relative(&path)
            );
        }
        let compact: String = source.chars().filter(|ch| !ch.is_whitespace()).collect();
        for import in compact.split("usetuffite_ioc::").skip(1) {
            let declaration = import.split(';').next().unwrap();
            assert!(
                !declaration.contains("bridge") && !declaration.contains("Registry"),
                "{} imports registry ownership or its bridge",
                relative(&path)
            );
        }
    }
}

#[test]
fn application_composition_is_flat() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    assert!(!root.join("native").exists());
    let module = std::fs::read_to_string(root.join("lib.rs")).unwrap();
    assert!(module.contains("mod providers;"));
    assert!(!root.join("lifecycle.rs").exists());
    assert!(!module.contains("mod native;"));
}

#[test]
fn service_crates_keep_sdk_in_private_framework_adapters() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("services");
    for path in rust_sources(&root) {
        let source = std::fs::read_to_string(&path).unwrap();
        for forbidden in ["crate::native::", "tuffite_ioc::Registry"] {
            assert!(
                !source.contains(forbidden),
                "{} imports {forbidden}",
                relative(&path)
            );
        }
    }
    for path in rust_sources(&root) {
        let source = std::fs::read_to_string(&path).unwrap();
        if source.contains("tuffite::") {
            let relative = path.strip_prefix(&root).unwrap();
            let parts: Vec<_> = relative.components().collect();
            assert!(
                parts[2].as_os_str() == "framework.rs" || parts[2].as_os_str() == "framework",
                "{} exposes SDK outside private adapters",
                relative.display()
            );
            let domain = root.join(parts[0].as_os_str());
            let lib = std::fs::read_to_string(domain.join("src/lib.rs"))
                .unwrap()
                .replace("\r\n", "\n");
            assert!(lib.contains("#[cfg(feature = \"framework\")]\nmod framework;"));
            let manifest = std::fs::read_to_string(domain.join("Cargo.toml")).unwrap();
            assert!(
                manifest
                    .lines()
                    .any(|line| line.starts_with("tuffite =") && line.contains("optional = true"))
            );
        }
    }
    let manifest = std::fs::read_to_string(root.join("hosts/Cargo.toml")).unwrap();
    assert!(
        !manifest
            .lines()
            .any(|line| line.trim_start().starts_with("ovule-workspace ="))
    );
}

#[test]
fn application_composition_has_no_aggregate_runtime_service() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR"));
    for path in rust_sources(&root.join("src")) {
        if path
            .file_name()
            .is_some_and(|name| name == "architecture_tests.rs")
        {
            continue;
        }
        let source = std::fs::read_to_string(&path).unwrap();
        for forbidden in ["ApplicationRuntime", "NativeEnvironment"] {
            assert!(
                !source.contains(forbidden),
                "{} recreates an aggregate service",
                relative(&path)
            );
        }
    }
    let runtime = std::fs::read_to_string(root.join("src/runtime.rs")).unwrap();
    assert!(runtime.contains("drop(self.services.take())"));
    assert!(!runtime.contains(".cached::<"));
    let bootstrap = std::fs::read_to_string(root.join("src/bootstrap.rs")).unwrap();
    assert!(bootstrap.contains("registry.initialize()"));
    assert!(!bootstrap.contains(".get::<"));
}

#[test]
fn application_providers_only_compose_domain_registrations() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR"));
    let source = std::fs::read_to_string(root.join("src/providers.rs")).unwrap();
    assert!(!source.contains("tuffite::"));
    assert!(!source.contains("registry.register("));
    assert!(!root.join("src/providers").exists());
}

#[test]
fn agent_approval_registration_consumes_one_host_adapter() {
    struct Events;
    impl ovule_agent::execution::approval::ApprovalEvents for Events {
        fn emit(&self, _: &serde_json::Value) -> Result<(), String> {
            Ok(())
        }
    }
    let mut registry = tuffite_ioc::Registry::new(std::sync::Arc::new(()));
    registry
        .inject::<dyn ovule_agent::execution::approval::ApprovalEvents>(std::sync::Arc::new(Events))
        .unwrap();
    ovule_agent::execution::approval::register(&mut registry).unwrap();
    registry.freeze();
    assert!(
        registry
            .get::<ovule_agent::execution::approval::ApprovalRuntime>()
            .is_ok()
    );
}
