use super::*;

#[test]
fn registry_is_generic_version_pinned_and_non_overlapping() {
    let registry = registry().unwrap();
    assert!(registry.toolchains.len() >= 5);
    for extension_owned in ["channel-cli", "codex", "codex-acp"] {
        assert!(!REGISTRY_SOURCE.contains(&format!("\"id\": \"{extension_owned}\"")));
    }
    for id in ["nodejs", "python", "ollama"] {
        let definition = registry
            .toolchains
            .iter()
            .find(|item| item.id == id)
            .unwrap();
        assert!(matches!(
            &definition.provider,
            ToolchainProvider::Archive { version, artifacts }
                if version != "latest" && artifacts.contains_key("windows-x86_64")
        ));
    }
    let codex = registry
        .toolchains
        .iter()
        .find(|item| item.id == "codex")
        .unwrap();
    assert!(matches!(
        &codex.provider,
        ToolchainProvider::Npm { package, version, .. }
            if package == "@openai/codex" && version != "latest"
    ));
    assert_eq!(codex.required_toolchain_ids, ["nodejs"]);
    let codex_acp = registry
        .toolchains
        .iter()
        .find(|item| item.id == "codex-acp")
        .unwrap();
    assert!(matches!(
        &codex_acp.provider,
        ToolchainProvider::Npm { package, version, .. }
            if package == "@agentclientprotocol/codex-acp" && version != "latest"
    ));
    assert_eq!(codex_acp.required_toolchain_ids, ["nodejs"]);
    assert!(
        registry
            .toolchains
            .iter()
            // Extensions can contribute background-only dependencies such as
            // cloudflared or lark-cli without adding an onboarding choice.
            .filter(|item| ["nodejs", "python", "ollama", "codex", "codex-acp"]
                .contains(&item.id.as_str()))
            .all(|item| item.onboarding)
    );
}

#[test]
fn extracts_tar_gz_archives_with_a_stripped_root() {
    use flate2::Compression;
    use flate2::write::GzEncoder;

    let root = tempfile::tempdir().unwrap();
    let archive_path = root.path().join("tool.tar.gz");
    let file = std::fs::File::create(&archive_path).unwrap();
    let encoder = GzEncoder::new(file, Compression::default());
    let mut archive = tar::Builder::new(encoder);
    let payload = b"example";
    let mut header = tar::Header::new_gnu();
    header.set_path("bundle/example-driver").unwrap();
    header.set_size(payload.len() as u64);
    header.set_mode(0o755);
    header.set_cksum();
    archive.append(&header, payload.as_slice()).unwrap();
    archive.into_inner().unwrap().finish().unwrap();

    let destination = root.path().join("output");
    std::fs::create_dir(&destination).unwrap();
    extract_tar_gz(
        &archive_path,
        &destination,
        &ArchiveArtifact {
            url: "https://example.invalid/tool.tar.gz".to_owned(),
            sha256: "0".repeat(64),
            format: "tar.gz".to_owned(),
            size: std::fs::metadata(&archive_path).unwrap().len(),
            max_extracted_bytes: 1024,
            strip_components: 1,
        },
    )
    .unwrap();
    assert_eq!(
        std::fs::read(destination.join("example-driver")).unwrap(),
        payload
    );
}

#[test]
fn status_does_not_create_the_managed_root() {
    let parent = tempfile::tempdir().unwrap();
    let root = parent.path().join("missing");
    let views = status(&root).unwrap();
    assert_eq!(views.len(), registry().unwrap().toolchains.len());
    assert!(!root.exists());
}

#[test]
fn refuses_unknown_install_recipes_without_touching_disk() {
    let parent = tempfile::tempdir().unwrap();
    let root = parent.path().join("missing");
    assert!(
        install("arbitrary-command", &root)
            .unwrap_err()
            .contains("unknown")
    );
    assert!(!root.exists());
}

#[test]
fn resolves_well_known_locations_without_mutating_path() {
    let definition = ToolchainDefinition {
        id: "located".to_owned(),
        label: "Located".to_owned(),
        kind: "cli".to_owned(),
        onboarding: true,
        executable: "located".to_owned(),
        candidates: vec!["definitely-not-on-path".to_owned()],
        version_args: vec!["--version".to_owned()],
        locations: std::collections::HashMap::from([(
            platform_key().to_owned(),
            vec![
                std::env::current_exe()
                    .unwrap()
                    .to_string_lossy()
                    .into_owned(),
            ],
        )]),
        required_toolchain_ids: Vec::new(),
        provider: ToolchainProvider::External,
    };
    assert_eq!(
        find_external_executable(&definition),
        std::env::current_exe().ok()
    );
}

#[test]
fn verified_managed_npm_install_is_ready_without_spawning_the_cli() {
    let root = tempfile::tempdir().unwrap();
    let install = root.path().join("installs/codex/0.154.0");
    let executable = installed_npm_executable(&install, "codex");
    std::fs::create_dir_all(executable.parent().unwrap()).unwrap();
    std::fs::write(&executable, "this must never be executed").unwrap();
    std::fs::write(
            install.join("package-lock.json"),
            serde_json::json!({
                "packages": {
                    "node_modules/@openai/codex": {
                        "version": "0.154.0",
                        "integrity": "sha512-FV/x1OHXYv/ifjf3mXj9ThTTAWcUZN6cGIRQRhRxkKNOPuImu1WW0c8ev1vUkE9XGH90dEnYG1tBjIkxRikg0w=="
                    }
                }
            })
            .to_string(),
        )
        .unwrap();
    let views = status(root.path()).unwrap();
    let codex = views.iter().find(|item| item.id == "codex").unwrap();
    assert!(codex.available);
    assert!(codex.managed);
    assert_eq!(codex.version.as_deref(), Some("0.154.0"));
}

#[test]
fn onboarding_status_is_driven_by_registry_visibility() {
    let root = tempfile::tempdir().unwrap();
    let views = onboarding_status(root.path()).unwrap();
    assert_eq!(
        views.len(),
        registry()
            .unwrap()
            .toolchains
            .iter()
            .filter(|item| item.onboarding)
            .count()
    );
    assert!(!views.iter().any(|item| item.id == "channel-cli"));
    assert!(views.iter().any(|item| item.id == "nodejs"));
}

#[test]
#[ignore = "requires the public npm registry"]
fn installs_the_pinned_npm_toolchain_in_an_isolated_root() {
    let parent = tempfile::tempdir().unwrap();
    let root = parent.path().join("managed");
    let views = install("codex", &root).unwrap();
    let codex = views.iter().find(|item| item.id == "codex").unwrap();
    assert!(codex.available);
    assert!(codex.managed);
    assert_eq!(codex.provider, "npm");
    assert_eq!(codex.requested_version.as_deref(), Some("0.154.0"));
    assert!(
        codex
            .executable
            .as_deref()
            .is_some_and(|path| path.starts_with(&root.to_string_lossy().into_owned()))
    );
    assert!(root.join("config/npmrc").is_file());
    assert!(root.join("cache/npm").is_dir());
}

#[test]
#[ignore = "requires the public npm registry"]
fn installs_codex_acp_in_an_isolated_root() {
    let parent = tempfile::tempdir().unwrap();
    let root = parent.path().join("managed");
    let views = install("codex-acp", &root).unwrap();
    let adapter = views.iter().find(|item| item.id == "codex-acp").unwrap();
    assert!(adapter.available && adapter.managed);
    assert_eq!(adapter.requested_version.as_deref(), Some("1.13.1"));
    assert_eq!(
        resolve("codex-acp", &root).unwrap().to_string_lossy(),
        adapter.executable.as_deref().unwrap()
    );
}

#[test]
fn execution_path_includes_externally_detected_locations() {
    let root = tempfile::tempdir().unwrap();
    let executable = root.path().join("external/codex");
    std::fs::create_dir_all(executable.parent().unwrap()).unwrap();
    std::fs::write(&executable, "fixture").unwrap();
    let mut definition = registry()
        .unwrap()
        .toolchains
        .into_iter()
        .find(|item| item.id == "codex")
        .unwrap();
    definition.id = "external-location-fixture".to_owned();
    definition.provider = ToolchainProvider::External;
    definition.candidates.clear();
    definition.locations.insert(
        platform_key().to_owned(),
        vec![executable.to_string_lossy().into_owned()],
    );
    let path = execution_path_for(&[definition], root.path()).unwrap();
    assert!(std::env::split_paths(&path).any(|parent| parent == executable.parent().unwrap()));
}

#[cfg(unix)]
#[test]
fn npm_success_does_not_activate_a_missing_native_dependency() {
    use std::os::unix::fs::PermissionsExt as _;
    let root = tempfile::tempdir().unwrap();
    let definitions = registry().unwrap().toolchains;
    let node = definitions.iter().find(|item| item.id == "nodejs").unwrap();
    let node_root = managed_install_path(node, root.path());
    std::fs::create_dir_all(&node_root).unwrap();
    let npm = node_root.join("npm");
    let node_executable = node_root.join("node");
    std::fs::write(&node_executable, "#!/bin/sh\nexit 0\n").unwrap();
    std::fs::set_permissions(&node_executable, std::fs::Permissions::from_mode(0o755)).unwrap();
    let codex = definitions.iter().find(|item| item.id == "codex").unwrap();
    let ToolchainProvider::Npm {
        package,
        version,
        integrity,
        ..
    } = &codex.provider
    else {
        panic!("npm fixture")
    };
    let lock = serde_json::json!({"packages": {format!("node_modules/{package}"): {"version": version, "integrity": integrity}}});
    // npm reports success even though the optional platform binary is missing.
    let script = format!(
        r#"#!/bin/sh
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--prefix" ]; then prefix="$2"; shift; fi
  shift
done
mkdir -p "$prefix/node_modules/.bin"
cat > "$prefix/node_modules/.bin/codex" <<'CLI'
#!/bin/sh
printf 'missing native package\n' >&2
exit 1
CLI
chmod +x "$prefix/node_modules/.bin/codex"
cat > "$prefix/package-lock.json" <<'LOCK'
{lock}
LOCK
exit 0
"#
    );
    std::fs::write(&npm, script).unwrap();
    std::fs::set_permissions(&npm, std::fs::Permissions::from_mode(0o755)).unwrap();
    let progress = std::cell::RefCell::new(Vec::new());
    let error = install_npm(codex, root.path(), &|message| {
        progress.borrow_mut().push(message.to_owned());
    })
    .unwrap_err();
    assert!(error.contains("missing native package"), "{error}");
    assert!(!managed_install_path(codex, root.path()).exists());
    assert!(
        progress
            .borrow()
            .iter()
            .any(|message| message.contains("Verifying"))
    );
}

#[cfg(unix)]
#[test]
fn installation_progress_counts_own_files_without_following_symlinks() {
    let root = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    std::fs::write(root.path().join("partial"), [0; 7]).unwrap();
    std::fs::write(outside.path().join("other-download"), [0; 31]).unwrap();
    std::os::unix::fs::symlink(outside.path(), root.path().join("link")).unwrap();
    assert_eq!(installation_bytes(root.path()), 7);
    std::fs::write(root.path().join("partial"), [0; 17]).unwrap();
    assert_eq!(installation_bytes(root.path()), 17);
}

#[test]
fn node_archives_resolve_bin_layout_on_unix() {
    let temp = tempfile::tempdir().unwrap();
    std::fs::create_dir(temp.path().join("bin")).unwrap();
    std::fs::write(
        temp.path()
            .join("bin")
            .join(super::executable_filename("node")),
        b"node",
    )
    .unwrap();
    assert!(
        super::archive_executable(temp.path(), "node")
            .unwrap()
            .starts_with(temp.path().join("bin"))
    );
}

#[cfg(unix)]
#[test]
fn official_node_launchers_are_deferred_and_other_archive_links_remain_rejected() {
    use std::io::Write;
    let root = tempfile::tempdir().unwrap();
    let archive = root.path().join("node.tar.gz");
    let encoder = flate2::write::GzEncoder::new(
        std::fs::File::create(&archive).unwrap(),
        flate2::Compression::default(),
    );
    let mut tar = tar::Builder::new(encoder);
    let mut link = tar::Header::new_gnu();
    link.set_entry_type(tar::EntryType::Symlink);
    link.set_size(0);
    link.set_mode(0o777);
    link.set_link_name("../lib/node_modules/npm/bin/npm-cli.js")
        .unwrap();
    link.set_cksum();
    tar.append_data(&mut link, "node/bin/npm", std::io::empty())
        .unwrap();
    let content = b"#!/usr/bin/env node\n";
    let mut file = tar::Header::new_gnu();
    file.set_size(content.len() as u64);
    file.set_mode(0o755);
    file.set_cksum();
    tar.append_data(
        &mut file,
        "node/lib/node_modules/npm/bin/npm-cli.js",
        &content[..],
    )
    .unwrap();
    tar.into_inner().unwrap().finish().unwrap().flush().unwrap();
    let artifact = ArchiveArtifact {
        url: "https://nodejs.org/dist/v24.21.0/node.tar.gz".into(),
        sha256: "a".repeat(64),
        format: "tar.gz".into(),
        size: 1000,
        max_extracted_bytes: 10000,
        strip_components: 1,
    };
    let out = root.path().join("out");
    std::fs::create_dir(&out).unwrap();
    extract_tar_gz(&archive, &out, &artifact).unwrap();
    assert_eq!(std::fs::read(out.join("bin/npm")).unwrap(), content);
    assert!(
        out.join("bin/npm")
            .canonicalize()
            .unwrap()
            .starts_with(out.canonicalize().unwrap())
    );
    let mut untrusted = artifact;
    untrusted.url = "https://example.invalid/archive".into();
    assert!(extract_tar_gz(&archive, &root.path().join("rejected"), &untrusted).is_err());
}

#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
#[test]
#[ignore = "requires explicitly downloaded and SHA-256 verified official Node archive"]
fn downloaded_official_node_archive_bootstraps_npm() {
    let archive =
        std::env::var("OVULE_NODE_ARCHIVE_FIXTURE").expect("set official archive fixture path");
    let registry = registry().unwrap();
    let node = registry
        .toolchains
        .iter()
        .find(|value| value.id == "nodejs")
        .unwrap();
    let ToolchainProvider::Archive { artifacts, version } = &node.provider else {
        panic!("Node archive recipe");
    };
    let root = tempfile::tempdir().unwrap();
    extract_tar_gz(Path::new(&archive), root.path(), &artifacts[target_key()]).unwrap();
    let node = archive_executable(root.path(), "node").unwrap();
    let result = std::process::Command::new(&node)
        .arg("--version")
        .output()
        .unwrap();
    assert!(result.status.success());
    assert_eq!(
        String::from_utf8(result.stdout).unwrap().trim(),
        format!("v{version}")
    );
    let npm = std::process::Command::new(node)
        .arg(root.path().join("bin/npm"))
        .arg("--version")
        .output()
        .unwrap();
    assert!(
        npm.status.success(),
        "{}",
        String::from_utf8_lossy(&npm.stderr)
    );
}
