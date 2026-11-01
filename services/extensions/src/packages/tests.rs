use super::*;

fn grant() -> ExtensionGrant {
    ExtensionGrant::new(
        ["process", "network", "secret.bind"].map(str::to_owned),
        ["sample"].map(str::to_owned),
        ["https://api.example.com/*"].map(str::to_owned),
        ["channel-app-secret"].map(str::to_owned),
        ["NO_COLOR"].map(str::to_owned),
        64,
    )
    .unwrap()
}

#[test]
fn principal_is_not_part_of_the_untrusted_wire_request() {
    let request: HostRequest = serde_json::from_str(
        r#"{"id":"spawn-1","kind":"process.probe","input":{"executable":"sample"}}"#,
    )
    .unwrap();
    assert_eq!(
        request.operation,
        HostOperation::ProcessProbe {
            executable: "sample".to_owned()
        }
    );
    assert!(grant().authorize(&request).is_ok());
    assert!(
        !serde_json::to_string(&request)
            .unwrap()
            .contains("principal")
    );
}

#[test]
fn capabilities_executables_and_payloads_fail_closed() {
    let denied = HostRequest {
        id: "write-1".to_owned(),
        operation: HostOperation::ProcessWrite {
            worker_id: "worker-1".to_owned(),
            bytes: vec![1],
        },
    };
    assert_eq!(
        grant().authorize(&denied),
        Err(HostProtocolError::CapabilityDenied)
    );
    let executable = HostRequest {
        id: "probe-1".to_owned(),
        operation: HostOperation::ProcessProbe {
            executable: "powershell".to_owned(),
        },
    };
    assert_eq!(
        grant().authorize(&executable),
        Err(HostProtocolError::ExecutableDenied)
    );
    let payload = HostRequest {
        id: "send-1".to_owned(),
        operation: HostOperation::WebSocketSend {
            transport_id: "transport-1".to_owned(),
            bytes: vec![0; 65],
        },
    };
    assert_eq!(
        grant().authorize(&payload),
        Err(HostProtocolError::PayloadTooLarge)
    );
    let endpoint = HostRequest {
        id: "network-1".to_owned(),
        operation: HostOperation::HttpRequest {
            method: "GET".to_owned(),
            endpoint: "https://evil.example/".to_owned(),
            body: Vec::new(),
        },
    };
    assert_eq!(
        grant().authorize(&endpoint),
        Err(HostProtocolError::NetworkDenied)
    );
    let environment = HostRequest {
        id: "spawn-2".to_owned(),
        operation: HostOperation::ProcessSpawn {
            executable: "sample".to_owned(),
            args: Vec::new(),
            cwd: WorkingDirectory::Workspace,
            environment: vec![EnvironmentEntry {
                name: "UNDECLARED_TOKEN".to_owned(),
                value: "must-not-pass".to_owned(),
            }],
        },
    };
    assert_eq!(
        grant().authorize(&environment),
        Err(HostProtocolError::EnvironmentDenied)
    );
}

#[test]
fn secret_values_have_no_wire_field() {
    let request = HostRequest {
        id: "secret-1".to_owned(),
        operation: HostOperation::SecretBind {
            credential_reference: "channel-app-secret".to_owned(),
            resource_id: "connection-1".to_owned(),
            field: "authorization".to_owned(),
        },
    };
    let encoded = serde_json::to_string(&request).unwrap();
    assert!(grant().authorize(&request).is_ok());
    assert!(!encoded.contains("value"));
}

#[test]
fn network_patterns_match_scheme_host_port_and_path() {
    let pattern = NetworkPattern::parse("https://*.example.com/api/*").unwrap();
    assert!(pattern.matches("https://docs.example.com/api/items"));
    assert!(!pattern.matches("https://example.com/api/items"));
    assert!(!pattern.matches("https://docs.example.com/private"));
    assert!(!pattern.matches("http://docs.example.com/api/items"));
}

#[test]
fn one_extension_can_contribute_multiple_feature_kinds() {
    let manifest: ExtensionManifest = serde_json::from_str(
        r#"{
              "schemaVersion": 1,
              "id": "io.ovule.multi",
              "private": true,
              "version": "0.1.0",
              "type": "module",
              "apiVersion": 1,
              "runtime": { "kind": "javascript", "entry": "dist/extension.mjs" },
              "contributes": {
                "agents": [{
                  "id": "multi",
                  "label": "Multi Agent",
                  "executableCandidates": ["multi-agent"]
                }],
                "channels": [{ "id": "multi" }],
                "skills": [{ "id": "multi-skill", "path": "skills/multi-skill/SKILL.md" }],
                "models": [{
                  "id": "multi-model",
                  "label": "Multi Model",
                  "provider": "multi",
                  "remoteId": "multi-model",
                  "agents": ["multi"]
                }],
                "capabilities": [{
                  "id": "visualization.chart",
                  "label": "Chart",
                  "description": "Render a chart"
                }],
                "messageBlocks": [{
                  "kind": "chart",
                  "tag": "sample-chart",
                  "module": "dist/web/chart.mjs",
                  "style": "dist/web/chart.css",
                  "capability": "visualization.chart",
                  "agentInstructions": "Use for charts.",
                  "example": {"option": {"series": []}}
                }]
              },
              "permissions": { "process": ["multi-agent"] }
            }"#,
    )
    .unwrap();
    assert!(manifest.validate().is_ok());
    assert_eq!(
        manifest.contributes.message_blocks[0].tag.as_deref(),
        Some("sample-chart")
    );
    assert!(manifest.contributes.slash_commands.is_empty());
}

#[test]
fn utility_runtime_selects_a_registered_service_without_a_script_entry() {
    let manifest: ExtensionManifest = serde_json::from_str(
        r#"{
              "schemaVersion": 1,
              "id": "io.ovule.native-indexer",
              "private": true,
              "version": "0.1.0",
              "type": "module",
              "apiVersion": 1,
              "runtime": { "kind": "utility", "service": "native-indexer" },
              "contributes": {
                "capabilities": [{
                  "id": "workspace.index",
                  "label": "Workspace index",
                  "description": "Build a native workspace index"
                }]
              },
              "permissions": { "workspace": true }
            }"#,
    )
    .unwrap();
    assert!(manifest.validate().is_ok());
    assert!(matches!(
        manifest.runtime,
        Some(ExtensionRuntime::Utility { ref service }) if service == "native-indexer"
    ));
}

#[test]
fn agent_spawn_plans_are_bounded_by_the_manifest() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/fixtures")
        .join("plugins/agent-sample");
    let package = load_extension_package(&root).unwrap();
    let agent = &package.manifest.contributes.agents[0];
    let valid = SpawnPlan {
        executable_candidates: vec!["sample".to_owned(), "sample-alias".to_owned()],
        args: vec!["acp".to_owned(), "serve".to_owned()],
        cwd: WorkingDirectory::Workspace,
        environment: vec![EnvironmentEntry {
            name: "NO_COLOR".to_owned(),
            value: "1".to_owned(),
        }],
        stdin: "jsonl-rpc".to_owned(),
        output: AgentOutput::Plain,
        final_message: false,
    };
    assert!(valid.validate_for(&package.manifest, agent).is_ok());

    let mut escaped = valid;
    escaped.executable_candidates = vec!["powershell".to_owned()];
    assert_eq!(
        escaped.validate_for(&package.manifest, agent),
        Err(HostProtocolError::InvalidRequest)
    );
}

#[test]
#[allow(clippy::too_many_lines)]
fn bundled_agent_and_channel_manifests_are_rust_validated() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../desktop")
        .join("extensions");
    assert!(
        load_bundled_extensions()
            .unwrap()
            .iter()
            .all(|package| package.manifest.id != "io.ovule.agent.sample")
    );
    for directory in ["agent-codex", "agent-deepseek", "visuals"] {
        let package = load_extension_package(&root.join(directory)).unwrap();
        assert_eq!(package.manifest.version, "0.1.0");
        let npm: serde_json::Value =
            serde_json::from_slice(&std::fs::read(package.root.join("package.json")).unwrap())
                .unwrap();
        assert!(
            npm["name"]
                .as_str()
                .is_some_and(|name| name.starts_with("@ovule/"))
        );
        assert!(package.root.join("extension.json").is_file());
        if let Some(entry) = &package.entry {
            assert!(entry.starts_with(&package.root));
            assert!(
                entry
                    .strip_prefix(&package.root)
                    .unwrap()
                    .starts_with("dist")
            );
        }
        package.validate_web_assets().unwrap();
        if package.entry.is_some() {
            let javascript = package.javascript_package().unwrap();
            assert!(!javascript.source.is_empty());
        }
    }
    let channel = load_extension_package(
        &Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../tests/fixtures")
            .join("plugins/channel-sample"),
    )
    .unwrap();
    assert_eq!(channel.manifest.contributes.slash_commands.len(), 1);
    assert_eq!(channel.manifest.contributes.slash_commands[0].id, "channel");
    assert!(matches!(
        channel.manifest.contributes.slash_commands[0].handler,
        SlashCommandHandler::ChannelSetup
    ));
    assert!(matches!(
        channel.manifest.contributes.message_blocks[0].host_renderer,
        Some(HostMessageBlockRenderer::ChannelSetup)
    ));
    assert!(
        channel.manifest.contributes.message_blocks[0]
            .module
            .is_none()
    );
    let resolved = ResolvedSlashCommand {
        extension_id: channel.manifest.id.clone(),
        extension_root: channel.root.clone(),
        skills: channel.manifest.contributes.skills.clone(),
        contribution: channel.manifest.contributes.slash_commands[0].clone(),
    };
    assert_eq!(resolved.extension_id, "io.ovule.channel.sample");
    assert_eq!(resolved.contribution.target, "channel");
    assert_eq!(
        resolved.contribution.skills,
        ["channel-channel".to_owned(), "channel-cli".to_owned()]
    );
    assert!(
        resolved
            .skill_paths()
            .unwrap()
            .iter()
            .all(|(_, path)| path.starts_with(&resolved.extension_root))
    );
    assert!(
        resolved
            .workflow_instructions()
            .unwrap()
            .contains("existing app")
    );
    let action = channel
        .manifest
        .contributes
        .actions
        .iter()
        .find(|action| action.id == "connect-existing")
        .unwrap();
    assert_eq!(action.target, "channel");
    assert!(action.reuse_existing);
    let deepseek = load_extension_package(&root.join("agent-deepseek")).unwrap();
    assert!(deepseek.manifest.contributes.agents.is_empty());
    assert_eq!(
        deepseek
            .manifest
            .contributes
            .models
            .iter()
            .map(|model| model.id.as_str())
            .collect::<Vec<_>>(),
        ["deepseek-flash", "deepseek-v4-pro"]
    );
    assert_eq!(deepseek.manifest.contributes.onboarding[0].id, "deepseek");
    assert_eq!(
        deepseek.manifest.contributes.onboarding[0]
            .model_provider
            .as_deref(),
        Some("deepseek")
    );
    let codex = load_extension_package(&root.join("agent-codex")).unwrap();
    assert_eq!(codex.manifest.contributes.onboarding[0].id, "codex");
    assert_eq!(
        codex.manifest.contributes.onboarding[0].agent_ids,
        ["codex"]
    );
    assert_eq!(
        codex
            .manifest
            .contributes
            .toolchains
            .iter()
            .map(|toolchain| toolchain.id.as_str())
            .collect::<Vec<_>>(),
        ["codex", "codex-acp"]
    );
    let host = ovule_extension_api::host::contributions();
    assert_eq!(host.onboarding[0].id, "ollama");
    let sample = load_extension_package(
        &Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../tests/fixtures")
            .join("plugins/agent-sample"),
    )
    .unwrap();
    assert_eq!(sample.manifest.id, "io.ovule.agent.sample");
    assert_eq!(sample.manifest.contributes.agents[0].id, "sample");
    assert!(matches!(
        &sample.manifest.contributes.toolchains[0].provider,
        ovule_extension_api::ToolchainProvider::External
    ));
    let third_party = load_extension_directory(
        &Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../tests/fixtures")
            .join("plugins"),
        true,
        true,
        InvalidExtensionPolicy::Reject,
    )
    .unwrap();
    assert_eq!(third_party.len(), 2);
    assert!(
        third_party
            .iter()
            .any(|package| package.manifest.id == "io.ovule.agent.sample")
    );
    assert!(
        third_party
            .iter()
            .any(|package| package.manifest.id == "io.ovule.channel.sample")
    );
    let channel = third_party
        .iter()
        .find(|package| package.manifest.id == "io.ovule.channel.sample")
        .unwrap();
    assert!(matches!(
        &channel.manifest.contributes.toolchains[0].provider,
        ovule_extension_api::ToolchainProvider::Npm { package, version, .. }
            if package == "@example/cli" && version == "1.0.94"
    ));
    let computer_use = ovule_extension_api::host::contributions();
    let contribution = &computer_use.computer_use[0];
    assert_eq!(contribution.provider, "crd");
    assert_eq!(
        contribution.backend,
        crate::protocol::ComputerUseBackend::NativeCrd
    );
    assert_eq!(contribution.toolchain, None);
    assert_eq!(
        computer_use.toolchains,
        Vec::<ovule_extension_api::ToolchainDefinition>::new()
    );
    assert_eq!(computer_use.capabilities.len(), 2);
    assert!(matches!(
        computer_use.message_blocks[0].host_renderer,
        Some(HostMessageBlockRenderer::HumanHandoff)
    ));
    assert_eq!(
        contribution.capabilities,
        ["desktop.snapshot", "desktop.input", "clipboard.write"]
    );
    let office = load_extension_package(&root.join("visuals")).unwrap();
    assert!(office.root.join("dist/web/pdf.worker.mjs").is_file());
    assert_eq!(office.manifest.contributes.file_editors.len(), 5);
    assert_eq!(
        office
            .manifest
            .contributes
            .file_editors
            .iter()
            .filter(|editor| editor.mode == FileEditorMode::Editable)
            .flat_map(|editor| editor.extensions.iter().map(String::as_str))
            .collect::<Vec<_>>(),
        ["xlsx", "csv"]
    );
    assert_eq!(
        office
            .manifest
            .contributes
            .file_editors
            .iter()
            .flat_map(|editor| editor.extensions.iter().map(String::as_str))
            .collect::<Vec<_>>(),
        [
            "docx", "dotx", "xlsx", "csv", "xlsm", "pptx", "pptm", "ppsx", "pdf"
        ]
    );
}

#[test]
fn macos_bundle_loads_packaged_extensions_without_using_the_checkout() {
    let root = tempfile::tempdir().unwrap();
    let bundle = root.path().join("Ovule.app/Contents");
    let resources = bundle.join("Resources/assets/desktop/dist/resources");
    let extensions = resources.join("extensions");
    std::fs::create_dir_all(&extensions).unwrap();
    assert_eq!(
        extension_asset_root_for_executable(&bundle.join("MacOS/ovule")).unwrap(),
        resources
    );
    assert!(
        load_extension_directory(&extensions, true, true, InvalidExtensionPolicy::Reject)
            .unwrap()
            .is_empty()
    );
}

#[test]
fn removed_extension_workspace_with_leftover_dependencies_is_ignored() {
    let root = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(root.path().join("office/node_modules")).unwrap();
    assert!(
        load_extension_directory(root.path(), true, true, InvalidExtensionPolicy::Reject)
            .unwrap()
            .is_empty()
    );
}

#[test]
fn invalid_installed_extension_is_skipped_but_bundled_extension_is_rejected() {
    let root = tempfile::tempdir().unwrap();
    let invalid = root.path().join("incomplete-extension");
    std::fs::create_dir(&invalid).unwrap();
    std::fs::write(invalid.join("extension.json"), b"{not-json").unwrap();

    let installed =
        load_extension_directory(root.path(), false, false, InvalidExtensionPolicy::Skip).unwrap();
    assert!(installed.is_empty());
    assert_eq!(
        load_extension_directory(root.path(), true, true, InvalidExtensionPolicy::Reject,),
        Err(HostProtocolError::InvalidManifest)
    );
}

#[test]
fn conflicting_installed_extension_is_skipped() {
    let package = load_extension_package(
        &Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../desktop")
            .join("extensions/agent-codex"),
    )
    .unwrap();
    let mut packages = vec![package.clone()];
    extend_validated_extension_catalog(&mut packages, [package]);
    assert_eq!(packages.len(), 1);
}

#[test]
fn message_block_assets_and_capabilities_are_validated() {
    let root = std::fs::canonicalize(
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../desktop")
            .join("extensions"),
    )
    .unwrap();
    let packages = load_bundled_extensions().unwrap();
    let visual = packages
        .iter()
        .find(|package| package.manifest.id == "io.ovule.visuals")
        .unwrap();
    assert_eq!(visual.manifest.contributes.capabilities.len(), 2);
    assert_eq!(visual.manifest.contributes.message_blocks.len(), 3);
    assert!(visual.root.starts_with(root));
    let block: MessageBlockEvent = serde_json::from_value(serde_json::json!({
        "id": "chart-1",
        "kind": "echarts",
        "data": {"series": [1, 2, 3]}
    }))
    .unwrap();
    assert_eq!(block.kind, "echarts");
    assert!(
        serde_json::from_value::<MessageBlockEvent>(serde_json::json!({
            "id": "chart-1",
            "kind": "echarts",
            "data": {},
            "script": "https://example.com/evil.js"
        }))
        .is_err()
    );
    let mut conflicting = (*visual).clone();
    conflicting.manifest.contributes.file_editors.clear();
    conflicting.manifest.id = "io.ovule.visuals-copy".to_owned();
    for capability in &mut conflicting.manifest.contributes.capabilities {
        capability.id.push_str(".copy");
    }
    for block in &mut conflicting.manifest.contributes.message_blocks {
        block.kind.push_str("-copy");
        if let Some(capability) = &mut block.capability {
            capability.push_str(".copy");
        }
    }
    assert!(validate_extension_catalog(&[(*visual).clone(), conflicting]).is_ok());
    let mut duplicate_kind = (*visual).clone();
    duplicate_kind.manifest.contributes.file_editors.clear();
    duplicate_kind.manifest.id = "io.ovule.visuals-copy".to_owned();
    for capability in &mut duplicate_kind.manifest.contributes.capabilities {
        capability.id.push_str(".copy");
    }
    for block in &mut duplicate_kind.manifest.contributes.message_blocks {
        if let Some(capability) = &mut block.capability {
            capability.push_str(".copy");
        }
    }
    assert_eq!(
        validate_extension_catalog(&[(*visual).clone(), duplicate_kind]),
        Err(HostProtocolError::InvalidManifest)
    );
    assert_eq!(
        validate_extension_catalog(&[(*visual).clone(), (*visual).clone()]),
        Err(HostProtocolError::InvalidManifest)
    );
}

#[test]
fn rejects_remote_or_unregistered_message_block_assets() {
    let invalid: ExtensionManifest = serde_json::from_str(
        r#"{
              "schemaVersion": 1,
              "id": "io.ovule.unsafe",
              "private": true,
              "version": "0.1.0",
              "type": "module",
              "apiVersion": 1,
              "runtime": { "kind": "javascript", "entry": "dist/extension.mjs" },
              "contributes": {
                "capabilities": [],
                "messageBlocks": [{
                  "kind": "chart",
                  "tag": "unsafe-chart",
                  "module": "https://example.com/chart.mjs",
                  "capability": "undeclared",
                  "agentInstructions": "Use for charts.",
                  "example": {}
                }]
              },
              "permissions": {}
            }"#,
    )
    .unwrap();
    assert_eq!(invalid.validate(), Err(HostProtocolError::InvalidManifest));
}

#[test]
fn host_namespaces_are_reserved_without_a_host_extension_package() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../desktop/extensions/agent-codex");
    let template = load_extension_package(&root).unwrap();
    let host = ovule_extension_api::host::contributions();
    let mut attempts = Vec::new();
    for owner in [ovule_extension_api::host::OWNER, "io.ovule.essentials"] {
        let mut package = template.clone();
        package.manifest.id = owner.to_owned();
        attempts.push(package);
    }
    let mut package = template.clone();
    package.manifest.contributes.capabilities = host.capabilities;
    attempts.push(package);
    let mut package = template.clone();
    package.manifest.contributes.message_blocks = host.message_blocks;
    attempts.push(package);
    let mut package = template.clone();
    package.manifest.contributes.computer_use = host.computer_use;
    attempts.push(package);
    let mut package = template;
    package.manifest.contributes.onboarding = host.onboarding;
    attempts.push(package);
    for package in attempts {
        assert_eq!(
            validate_extension_catalog(&[package]),
            Err(HostProtocolError::InvalidManifest)
        );
    }
    assert!(
        load_bundled_extensions()
            .unwrap()
            .iter()
            .all(|package| package.manifest.id != ovule_extension_api::host::OWNER)
    );
}

#[test]
fn legacy_essentials_setup_routes_to_the_compiled_host_declaration() {
    for owner in [ovule_extension_api::host::OWNER, "io.ovule.essentials"] {
        let resolved = resolve_extension_onboarding(owner, "ollama")
            .unwrap()
            .unwrap();
        assert!(resolved.package.is_none());
        assert_eq!(
            resolved.contribution.model_provider.as_deref(),
            Some("ollama")
        );
        assert!(
            resolve_extension_onboarding(owner, "unknown")
                .unwrap()
                .is_none()
        );
    }
}

#[test]
fn bundled_isolated_ui_assets_are_bounded_and_package_validated() {
    let packages = super::load_bundled_extensions().expect("bundled package inventory");
    let mut names = Vec::new();
    for package in packages {
        let Some(ui) = &package.manifest.ui else {
            continue;
        };
        package.validate_web_assets().expect("validated UI assets");
        assert_eq!(ui.entry, "dist/ui.js");
        let source = std::fs::read_to_string(package.root.join(&ui.entry)).unwrap();
        assert!(source.len() <= 8 * 1024 * 1024);
        assert!(!source.is_empty());
        names.push(package.manifest.id);
    }
    assert_eq!(names.len(), 4);
}

#[test]
fn iframe_contributions_have_no_executable_extension_runtime() {
    let mut declaration: serde_json::Value = serde_json::from_str(include_str!(
        "../../../../desktop/extensions/visuals/extension.json"
    ))
    .unwrap();
    let iframe = declaration["contributes"]["messageBlocks"]
        .as_array()
        .unwrap()
        .iter()
        .find(|block| block["kind"] == "interactive-ui")
        .unwrap()
        .clone();
    declaration["contributes"] = serde_json::json!({"messageBlocks": [iframe]});
    declaration.as_object_mut().unwrap().remove("ui");
    let manifest: ExtensionManifest = serde_json::from_value(declaration).unwrap();
    manifest.validate().unwrap();
    assert_eq!(manifest.id, "io.ovule.visuals");
    assert!(manifest.runtime.is_none() && manifest.ui.is_none());
    let block = &manifest.contributes.message_blocks[0];
    assert_eq!(block.kind, "interactive-ui");
    assert!(matches!(block.ui, Some(UiContribution::Iframe)));
    assert!(!block.requires_isolated_ui());
    assert!(block.tag.is_none() && block.module.is_none() && block.host_renderer.is_none());

    let mut invalid = manifest.clone();
    invalid.contributes.message_blocks[0].module = Some("dist/ui.js".to_owned());
    assert!(invalid.validate().is_err());
    invalid.contributes.message_blocks[0].module = None;
    invalid.contributes.message_blocks[0].ui = Some(UiContribution::Isolated {
        tag: "example-card".to_owned(),
    });
    assert!(
        invalid.validate().is_err(),
        "isolated UI requires a source snapshot"
    );
}
