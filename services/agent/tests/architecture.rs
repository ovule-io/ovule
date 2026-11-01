use std::path::Path;
#[test]
fn kernel_has_no_domain_or_host_transport_dependency() {
    let manifest = include_str!("../Cargo.toml");
    let dependencies = manifest
        .split("[dependencies]")
        .nth(1)
        .unwrap()
        .split("[dev-dependencies]")
        .next()
        .unwrap();
    let local = dependencies
        .lines()
        .filter_map(|line| line.split_once('='))
        .map(|(name, _)| name.trim())
        .filter(|name| name.starts_with("ovule-"))
        .collect::<Vec<_>>();
    assert_eq!(local, ["ovule-agent-api.workspace"]);
    for forbidden in ["agent-client-protocol", "rmcp", "axum", "tower-http"] {
        assert!(
            !dependencies.contains(forbidden),
            "host protocol belongs outside kernel: {forbidden}"
        );
    }
}
fn no_mod_rs(path: &Path) {
    for item in std::fs::read_dir(path).unwrap() {
        let path = item.unwrap().path();
        if path.is_dir() {
            no_mod_rs(&path);
        } else {
            assert_ne!(
                path.file_name().unwrap(),
                "mod.rs",
                "use foo.rs plus foo/ layout: {}",
                path.display()
            );
        }
    }
}
#[test]
fn kernel_and_application_agent_modules_use_file_directory_layout() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR"));
    no_mod_rs(&root.join("src"));
    no_mod_rs(&root.join("../../src/agent_host"));
}
#[test]
fn domain_providers_depend_on_neutral_contract_not_execution_kernel() {
    let services = Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap();
    for name in ["skills", "memory", "browser", "channels", "hosts"] {
        let manifest = std::fs::read_to_string(services.join(name).join("Cargo.toml")).unwrap();
        let normal = manifest
            .split("[dependencies]")
            .nth(1)
            .unwrap()
            .split("[dev-dependencies]")
            .next()
            .unwrap();
        assert!(normal.contains("ovule-agent-api"));
        assert!(
            !normal.lines().any(|line| line.starts_with("ovule-agent.")),
            "{name} cannot depend on the kernel"
        );
    }
}
