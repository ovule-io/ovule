//! Managed executable inspection, installation, and registry rules.

/// Managed executable root supplied by native composition.
pub struct ToolchainRoot(pub std::path::PathBuf);

use std::ffi::OsString;
use std::io::{Read as _, Write as _};
use std::path::{Component, Path, PathBuf};
use std::thread;
use std::time::Duration;

use processkit::{Command, OutputBufferPolicy, Stdin};
use serde::Deserialize;
use sha2::{Digest as _, Sha256};

use ovule_extensions::providers::extension_toolchain_contributions;

const INSTALL_TIMEOUT: Duration = Duration::from_mins(15);
const REGISTRY_SOURCE: &str = include_str!("../../../desktop/toolchains/registry.json");

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ToolchainView {
    pub id: String,
    pub label: String,
    pub kind: String,
    pub provider: String,
    pub requested_version: Option<String>,
    pub available: bool,
    pub installable: bool,
    pub managed: bool,
    pub detail: String,
    pub executable: Option<String>,
    pub version: Option<String>,
    pub install_hint: Option<String>,
    pub required_toolchain_ids: Vec<String>,
    pub install_status: String,
    pub install_error: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ToolchainRegistry {
    schema_version: u32,
    toolchains: Vec<ToolchainDefinition>,
}

pub use ovule_extension_api::{
    ArchiveArtifact, ToolchainDefinition, ToolchainProvider, validate_definition,
};

pub fn status(managed_root: &Path) -> Result<Vec<ToolchainView>, String> {
    let registry = registry()?;
    Ok(registry
        .toolchains
        .iter()
        .map(|definition| inspect(definition, &registry.toolchains, managed_root))
        .collect())
}

pub fn onboarding_status(managed_root: &Path) -> Result<Vec<ToolchainView>, String> {
    let registry = registry()?;
    Ok(registry
        .toolchains
        .iter()
        .filter(|definition| definition.onboarding)
        .map(|definition| inspect(definition, &registry.toolchains, managed_root))
        .collect())
}

pub fn install(id: &str, managed_root: &Path) -> Result<Vec<ToolchainView>, String> {
    install_with_progress(id, managed_root, |_| {})
}

pub fn install_with_progress(
    id: &str,
    managed_root: &Path,
    progress: impl Fn(&str),
) -> Result<Vec<ToolchainView>, String> {
    let registry = registry()?;
    let definition = registry
        .toolchains
        .iter()
        .find(|definition| definition.id == id)
        .ok_or_else(|| format!("unknown managed Toolchain: {id}"))?;
    if inspect(definition, &registry.toolchains, managed_root).available {
        return status(managed_root);
    }
    for requirement_id in &definition.required_toolchain_ids {
        let requirement = registry
            .toolchains
            .iter()
            .find(|candidate| candidate.id == *requirement_id)
            .ok_or_else(|| format!("invalid Toolchain dependency: {requirement_id}"))?;
        if !inspect(requirement, &registry.toolchains, managed_root).available {
            return Err(format!(
                "{} requires {} to be available first",
                definition.label, requirement.label
            ));
        }
    }
    match &definition.provider {
        ToolchainProvider::External => {
            return Err(format!(
                "{} is externally managed; Ovule will not modify the user environment",
                definition.label
            ));
        }
        ToolchainProvider::Npm { .. } => install_npm(definition, managed_root, &progress)?,
        ToolchainProvider::Archive { version, artifacts } => {
            let artifact = artifacts.get(target_key()).ok_or_else(|| {
                format!(
                    "{} has no managed package for {}",
                    definition.label,
                    target_key()
                )
            })?;
            install_archive(definition, managed_root, version, artifact)?;
        }
    }
    status(managed_root)
}

/// Ensure the pinned managed npm recipe, even if a system command is available.
pub fn install_pinned_npm(id: &str, managed_root: &Path) -> Result<(), String> {
    let registry = registry()?;
    let definition = registry
        .toolchains
        .iter()
        .find(|d| d.id == id)
        .ok_or("Unknown managed toolchain")?;
    if managed_install_path(definition, managed_root).exists() {
        if managed_install_verified(definition, managed_root) {
            return Ok(());
        }
        return Err(
            "The pinned managed installation is invalid; repair this Toolchain before retrying"
                .into(),
        );
    }
    install_npm(definition, managed_root, &|_| {})
}

#[must_use]
pub fn resolve(id: &str, managed_root: &Path) -> Option<PathBuf> {
    let registry = registry().ok()?;
    let definition = registry
        .toolchains
        .iter()
        .find(|definition| definition.id == id)?;
    find_executable(definition, managed_root)
}

pub fn execution_path(managed_root: &Path) -> Result<OsString, String> {
    let registry = registry()?;
    execution_path_for(&registry.toolchains, managed_root)
}

fn execution_path_for(
    definitions: &[ToolchainDefinition],
    managed_root: &Path,
) -> Result<OsString, String> {
    let mut paths = definitions
        .iter()
        .filter_map(|definition| find_executable(definition, managed_root))
        .filter_map(|executable| executable.parent().map(Path::to_path_buf))
        .collect::<Vec<_>>();
    if let Some(system_path) = std::env::var_os("PATH") {
        paths.extend(std::env::split_paths(&system_path));
    }
    std::env::join_paths(paths).map_err(|error| format!("compose Toolchain PATH: {error}"))
}

fn registry() -> Result<ToolchainRegistry, String> {
    let mut registry: ToolchainRegistry = serde_json::from_str(REGISTRY_SOURCE)
        .map_err(|error| format!("parse bundled Toolchain registry: {error}"))?;
    if registry.schema_version != 1 {
        return Err(format!(
            "unsupported Toolchain registry schema: {}",
            registry.schema_version
        ));
    }
    registry.toolchains.extend(
        extension_toolchain_contributions()
            .map_err(|error| format!("load Extension Toolchains: {error}"))?,
    );
    let mut ids = std::collections::HashSet::new();
    for definition in &registry.toolchains {
        validate_definition(definition)?;
        if !ids.insert(definition.id.as_str()) {
            return Err(format!("duplicate Toolchain definition: {}", definition.id));
        }
    }
    Ok(registry)
}

fn inspect(
    definition: &ToolchainDefinition,
    definitions: &[ToolchainDefinition],
    managed_root: &Path,
) -> ToolchainView {
    let managed = managed_executable(definition, managed_root);
    let executable = managed
        .clone()
        .or_else(|| find_external_executable(definition));
    let managed_ready = managed.is_some() && managed_install_verified(definition, managed_root);
    let version = managed_ready
        .then(|| provider_version(&definition.provider).map(str::to_owned))
        .flatten();
    let available = executable.is_some() && (managed.is_none() || managed_ready);
    let requirements_ready = definition.required_toolchain_ids.iter().all(|id| {
        definitions
            .iter()
            .find(|candidate| candidate.id == *id)
            .is_some_and(|candidate| {
                let managed = managed_executable(candidate, managed_root);
                managed
                    .as_ref()
                    .is_some_and(|_| managed_install_verified(candidate, managed_root))
                    || find_external_executable(candidate).is_some()
            })
    });
    ToolchainView {
        id: definition.id.clone(),
        label: definition.label.clone(),
        kind: definition.kind.clone(),
        provider: provider_name(&definition.provider).to_owned(),
        requested_version: provider_version(&definition.provider).map(str::to_owned),
        available,
        installable: !available
            && requirements_ready
            && match &definition.provider {
                ToolchainProvider::Npm { .. } => npm_executable(managed_root).is_some(),
                ToolchainProvider::Archive { artifacts, .. } => {
                    artifacts.contains_key(target_key())
                }
                ToolchainProvider::External => false,
            },
        managed: managed.is_some(),
        detail: if available {
            format!(
                "{} {}",
                if managed.is_some() {
                    "Managed by Ovule"
                } else {
                    "Detected externally"
                },
                version.as_deref().unwrap_or_default()
            )
        } else {
            "Not available; no user PATH or global package state was changed".to_owned()
        },
        executable: executable.map(|path| path.to_string_lossy().into_owned()),
        version,
        install_hint: provider_spec(&definition.provider),
        required_toolchain_ids: definition.required_toolchain_ids.clone(),
        install_status: "idle".to_owned(),
        install_error: None,
    }
}

fn install_npm(
    definition: &ToolchainDefinition,
    managed_root: &Path,
    progress: &dyn Fn(&str),
) -> Result<(), String> {
    let ToolchainProvider::Npm {
        package,
        version,
        integrity,
        registry,
        allow_scripts,
    } = &definition.provider
    else {
        return Err("expected an npm Toolchain recipe".to_owned());
    };
    let npm = npm_executable(managed_root)
        .ok_or_else(|| "npm was not found; make Node.js available first".to_owned())?;
    let final_path = managed_install_path(definition, managed_root);
    let version_root = final_path
        .parent()
        .ok_or_else(|| "managed Toolchain install path has no parent".to_owned())?;
    std::fs::create_dir_all(version_root)
        .map_err(|error| format!("create managed Toolchain root: {error}"))?;
    if managed_executable(definition, managed_root).is_some() {
        return Ok(());
    }
    if final_path.exists() {
        return Err(format!(
            "managed Toolchain path already exists but is unusable: {}",
            final_path.display()
        ));
    }
    let staging = tempfile::Builder::new()
        .prefix(".install-")
        .tempdir_in(version_root)
        .map_err(|error| format!("create Toolchain staging directory: {error}"))?;
    let npm_config = npm_config(managed_root, registry)?;
    std::fs::write(staging.path().join("package.json"), "{\"private\":true}\n")
        .map_err(|error| format!("write Toolchain package manifest: {error}"))?;
    // npm lockfile paths depend on its working directory and resolved prefix.
    let staging_root = staging
        .path()
        .canonicalize()
        .map_err(|error| format!("resolve Toolchain staging directory: {error}"))?;
    let cache = managed_root.join("cache/npm");
    let mut args = vec![
        "install".to_owned(),
        "--prefix".to_owned(),
        staging_root.to_string_lossy().into_owned(),
        "--save-exact".to_owned(),
        "--no-audit".to_owned(),
        "--no-fund".to_owned(),
        "--registry".to_owned(),
        registry.to_owned(),
        "--cache".to_owned(),
        cache.to_string_lossy().into_owned(),
    ];
    if !*allow_scripts {
        args.push("--ignore-scripts".to_owned());
    }
    args.push(format!("{package}@{version}"));
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|error| format!("create Toolchain installer runtime: {error}"))?;
    let execution_path = execution_path(managed_root)?;
    let command = Command::new(npm)
        .current_dir(&staging_root)
        .args(args)
        .env("PATH", &execution_path)
        .env("NPM_CONFIG_USERCONFIG", &npm_config)
        .env("NPM_CONFIG_CACHE", &cache)
        .env("NO_UPDATE_NOTIFIER", "1")
        .create_no_window()
        .stdin(Stdin::empty())
        .timeout(INSTALL_TIMEOUT)
        .inactivity_timeout(INSTALL_TIMEOUT)
        .output_buffer(OutputBufferPolicy::bounded(4_000).with_max_bytes(2 * 1024 * 1024));
    run_npm_installer(
        &command,
        &staging_root,
        &definition.label,
        progress,
        &runtime,
    )?;
    verify_npm_lock(staging.path(), package, version, integrity)?;
    let installed = installed_npm_executable(staging.path(), &definition.executable);
    if !installed.is_file() {
        return Err(format!(
            "{} package did not provide executable {}",
            definition.label, definition.executable
        ));
    }
    progress(&format!("Verifying {}…", definition.label));
    verify_npm_executable(definition, &installed, &execution_path, &runtime)?;
    activate_staging(&staging.keep(), &final_path)?;
    if managed_executable(definition, managed_root).is_none() {
        return Err(format!(
            "managed Toolchain activation is incomplete: {}",
            final_path.display()
        ));
    }
    Ok(())
}

fn npm_config(managed_root: &Path, registry: &str) -> Result<PathBuf, String> {
    let npm_config = managed_root.join("config/npmrc");
    if let Some(parent) = npm_config.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("create npm configuration directory: {error}"))?;
    }
    if !npm_config.exists() {
        std::fs::write(
            &npm_config,
            format!("registry={registry}\nupdate-notifier=false\n"),
        )
        .map_err(|error| format!("write isolated npm configuration: {error}"))?;
    }
    Ok(npm_config)
}

fn run_npm_installer(
    command: &Command,
    staging_root: &Path,
    label: &str,
    progress: &dyn Fn(&str),
    runtime: &tokio::runtime::Runtime,
) -> Result<(), String> {
    let output = runtime.block_on(async {
        let output = command.output_string();
        tokio::pin!(output);
        let mut ticker = tokio::time::interval(Duration::from_secs(1));
        loop {
            tokio::select! {
                result = &mut output => break result,
                _ = ticker.tick() => {
                    let bytes = installation_bytes(staging_root);
                    progress(&format!("Downloading and unpacking {} · {:.1} MB unpacked", label, megabytes(bytes)));
                }
            }
        }
    }).map_err(|error| format!("install {label}: {error}"))?;
    if !output.is_success() {
        return Err(format!(
            "install {label}: {}",
            last_diagnostic(output.stderr(), output.stdout())
        ));
    }
    Ok(())
}

// npm extracts large optional native packages while its output remains silent.
// Report only this installation's files, rather than a shared cache's traffic.
fn installation_bytes(root: &Path) -> u64 {
    let Ok(entries) = std::fs::read_dir(root) else {
        return 0;
    };
    entries.filter_map(Result::ok).fold(0_u64, |total, entry| {
        let bytes = entry.file_type().ok().map_or(0, |kind| {
            if kind.is_dir() {
                installation_bytes(&entry.path())
            } else if kind.is_file() {
                entry.metadata().map_or(0, |metadata| metadata.len())
            } else {
                0
            }
        });
        total.saturating_add(bytes)
    })
}

#[allow(clippy::cast_precision_loss)]
fn megabytes(bytes: u64) -> f64 {
    bytes as f64 / 1_000_000.0
}

fn verify_npm_executable(
    definition: &ToolchainDefinition,
    executable: &Path,
    execution_path: &std::ffi::OsStr,
    runtime: &tokio::runtime::Runtime,
) -> Result<(), String> {
    let output = runtime
        .block_on(
            Command::new(executable)
                .args(&definition.version_args)
                .env("PATH", execution_path)
                .create_no_window()
                .stdin(Stdin::empty())
                .timeout(Duration::from_secs(15))
                .output_string(),
        )
        .map_err(|error| format!("verify {}: {error}", definition.label))?;
    if !output.is_success() {
        return Err(format!(
            "{} was downloaded but cannot run: {}. A required native package may be missing; retry installation.",
            definition.label,
            last_diagnostic(output.stderr(), output.stdout())
        ));
    }
    Ok(())
}

fn install_archive(
    definition: &ToolchainDefinition,
    managed_root: &Path,
    version: &str,
    artifact: &ArchiveArtifact,
) -> Result<(), String> {
    let final_path = managed_install_path(definition, managed_root);
    let version_root = final_path
        .parent()
        .ok_or_else(|| "managed Toolchain install path has no parent".to_owned())?;
    std::fs::create_dir_all(version_root)
        .map_err(|error| format!("create managed Toolchain root: {error}"))?;
    if managed_executable(definition, managed_root).is_some() {
        return Ok(());
    }
    if final_path.exists() {
        return Err(format!(
            "managed Toolchain path already exists but is unusable: {}",
            final_path.display()
        ));
    }
    let staging = tempfile::Builder::new()
        .prefix(".install-")
        .tempdir_in(version_root)
        .map_err(|error| format!("create Toolchain staging directory: {error}"))?;
    let archive = download_archive(definition, version_root, version, artifact)?;
    match artifact.format.as_str() {
        "zip" => extract_zip(archive.path(), staging.path(), artifact)?,
        "tar.gz" => extract_tar_gz(archive.path(), staging.path(), artifact)?,
        _ => {
            return Err(format!(
                "unsupported Toolchain archive format: {}",
                artifact.format
            ));
        }
    }
    if archive_executable(staging.path(), &definition.executable).is_none() {
        return Err(format!(
            "{} archive did not provide executable {}",
            definition.label, definition.executable
        ));
    }
    activate_staging(&staging.keep(), &final_path)?;
    Ok(())
}

fn download_archive(
    definition: &ToolchainDefinition,
    version_root: &Path,
    version: &str,
    artifact: &ArchiveArtifact,
) -> Result<tempfile::NamedTempFile, String> {
    let suffix = match artifact.format.as_str() {
        "zip" => ".zip",
        "tar.gz" => ".tar.gz",
        _ => {
            return Err(format!(
                "unsupported Toolchain archive format: {}",
                artifact.format
            ));
        }
    };
    let mut archive = tempfile::Builder::new()
        .prefix(".download-")
        .suffix(suffix)
        .tempfile_in(version_root)
        .map_err(|error| format!("create Toolchain download file: {error}"))?;
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_global(Some(INSTALL_TIMEOUT))
        .build()
        .into();
    let response = agent
        .get(&artifact.url)
        .header("User-Agent", "Ovule/0.1 ToolchainManager")
        .call()
        .map_err(|error| format!("download {} {version}: {error}", definition.label))?;
    let mut reader = response.into_body().into_reader();
    let mut hash = Sha256::new();
    let mut buffer = vec![0_u8; 64 * 1024].into_boxed_slice();
    let mut downloaded = 0_u64;
    loop {
        let read = reader
            .read(&mut buffer)
            .map_err(|error| format!("download {} {version}: {error}", definition.label))?;
        if read == 0 {
            break;
        }
        hash.update(&buffer[..read]);
        downloaded = downloaded
            .checked_add(read as u64)
            .ok_or_else(|| format!("{} archive is too large", definition.label))?;
        if downloaded > artifact.size {
            return Err(format!(
                "{} archive exceeds its declared size",
                definition.label
            ));
        }
        archive
            .write_all(&buffer[..read])
            .map_err(|error| format!("save {} archive: {error}", definition.label))?;
    }
    if downloaded != artifact.size {
        return Err(format!(
            "{} archive size mismatch: expected {}, received {downloaded}",
            definition.label, artifact.size
        ));
    }
    let actual = format!("{:x}", hash.finalize());
    if !actual.eq_ignore_ascii_case(&artifact.sha256) {
        return Err(format!(
            "{} archive integrity mismatch: expected {}, received {actual}",
            definition.label, artifact.sha256
        ));
    }
    archive
        .flush()
        .map_err(|error| format!("flush {} archive: {error}", definition.label))?;
    Ok(archive)
}

fn extract_zip(
    archive_path: &Path,
    destination: &Path,
    artifact: &ArchiveArtifact,
) -> Result<(), String> {
    let file = std::fs::File::open(archive_path)
        .map_err(|error| format!("open Toolchain archive: {error}"))?;
    let mut archive =
        zip::ZipArchive::new(file).map_err(|error| format!("read Toolchain archive: {error}"))?;
    if archive.len() > 100_000 {
        return Err("Toolchain archive contains too many entries".to_owned());
    }
    let mut extracted = 0_u64;
    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|error| format!("read Toolchain archive entry: {error}"))?;
        if entry
            .unix_mode()
            .is_some_and(|mode| mode & 0o170_000 == 0o120_000)
        {
            return Err("Toolchain archive contains a symbolic link".to_owned());
        }
        let enclosed = entry
            .enclosed_name()
            .ok_or_else(|| "Toolchain archive contains an unsafe path".to_owned())?;
        extracted = extracted
            .checked_add(entry.size())
            .ok_or_else(|| "Toolchain archive expands beyond the supported size".to_owned())?;
        if extracted > artifact.max_extracted_bytes {
            return Err("Toolchain archive expands beyond the configured limit".to_owned());
        }
        let relative = enclosed
            .components()
            .skip(artifact.strip_components)
            .collect::<PathBuf>();
        if relative.as_os_str().is_empty() {
            continue;
        }
        let output = destination.join(relative);
        if entry.is_dir() {
            std::fs::create_dir_all(&output)
                .map_err(|error| format!("create Toolchain archive directory: {error}"))?;
            continue;
        }
        if let Some(parent) = output.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|error| format!("create Toolchain archive directory: {error}"))?;
        }
        let mut file = std::fs::File::create(&output)
            .map_err(|error| format!("create Toolchain archive file: {error}"))?;
        std::io::copy(&mut entry, &mut file)
            .map_err(|error| format!("extract Toolchain archive file: {error}"))?;
    }
    Ok(())
}

fn extract_tar_gz(
    archive_path: &Path,
    destination: &Path,
    artifact: &ArchiveArtifact,
) -> Result<(), String> {
    let file = std::fs::File::open(archive_path)
        .map_err(|error| format!("open Toolchain archive: {error}"))?;
    let decoder = flate2::read::GzDecoder::new(file);
    let mut archive = tar::Archive::new(decoder);
    let entries = archive
        .entries()
        .map_err(|error| format!("read Toolchain archive: {error}"))?;
    let mut extracted = 0_u64;
    let mut entry_count = 0_usize;
    let mut node_links = Vec::new();
    for entry in entries {
        entry_count += 1;
        if entry_count > 100_000 {
            return Err("Toolchain archive contains too many entries".to_owned());
        }
        let mut entry = entry.map_err(|error| format!("read Toolchain archive entry: {error}"))?;
        let kind = entry.header().entry_type();
        if !kind.is_file() && !kind.is_dir() && !kind.is_symlink() && !kind.is_hard_link() {
            return Err("Toolchain archive contains an unsupported entry".to_owned());
        }
        let enclosed = entry
            .path()
            .map_err(|error| format!("read Toolchain archive path: {error}"))?;
        if enclosed.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        }) {
            return Err("Toolchain archive contains an unsafe path".to_owned());
        }
        if kind.is_symlink() || kind.is_hard_link() {
            let relative = enclosed
                .components()
                .skip(artifact.strip_components)
                .collect::<PathBuf>();
            let target = entry
                .link_name()
                .map_err(|_| "Invalid archive link")?
                .ok_or("Archive link target missing")?;
            let expected = match relative.to_str() {
                Some("bin/npm") => "../lib/node_modules/npm/bin/npm-cli.js",
                Some("bin/npx") => "../lib/node_modules/npm/bin/npx-cli.js",
                Some("bin/corepack") => "../lib/node_modules/corepack/dist/corepack.js",
                _ => return Err("Toolchain archive contains a link".into()),
            };
            if !kind.is_symlink()
                || !artifact.url.starts_with("https://nodejs.org/dist/")
                || target != Path::new(expected)
            {
                return Err("Toolchain archive contains a link".into());
            }
            // Only the three official Node launchers are permitted. Install them
            // after regular files, so they cannot redirect archive extraction.
            node_links.push((destination.join(relative), PathBuf::from(expected)));
            continue;
        }
        extracted = extracted
            .checked_add(entry.header().size().unwrap_or(u64::MAX))
            .ok_or_else(|| "Toolchain archive expands beyond the supported size".to_owned())?;
        if extracted > artifact.max_extracted_bytes {
            return Err("Toolchain archive expands beyond the configured limit".to_owned());
        }
        let relative = enclosed
            .components()
            .skip(artifact.strip_components)
            .collect::<PathBuf>();
        if relative.as_os_str().is_empty() {
            continue;
        }
        let output = destination.join(relative);
        if kind.is_dir() {
            std::fs::create_dir_all(&output)
                .map_err(|error| format!("create Toolchain archive directory: {error}"))?;
            continue;
        }
        if let Some(parent) = output.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|error| format!("create Toolchain archive directory: {error}"))?;
        }
        entry
            .unpack(&output)
            .map_err(|error| format!("extract Toolchain archive file: {error}"))?;
    }
    #[cfg(unix)]
    for (output, target) in node_links {
        let parent = output.parent().ok_or("Invalid Node launcher")?;
        std::fs::create_dir_all(parent).map_err(|_| "Cannot prepare Node launcher directory")?;
        let source = parent.join(&target);
        if !source.is_file() || output.exists() {
            return Err("Invalid Node launcher target".into());
        }
        std::os::unix::fs::symlink(target, output).map_err(|_| "Cannot install Node launcher")?;
    }
    #[cfg(not(unix))]
    if !node_links.is_empty() {
        return Err("Node tar launchers are unsupported on this platform".into());
    }
    Ok(())
}

fn activate_staging(source: &Path, destination: &Path) -> Result<(), String> {
    let mut last_error = None;
    for _ in 0..20 {
        match std::fs::rename(source, destination) {
            Ok(()) => return Ok(()),
            Err(_) if destination.is_dir() => return Ok(()),
            Err(error)
                if matches!(
                    error.kind(),
                    std::io::ErrorKind::PermissionDenied | std::io::ErrorKind::WouldBlock
                ) =>
            {
                last_error = Some(error);
                thread::sleep(Duration::from_millis(100));
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                return Ok(());
            }
            Err(error) => return Err(format!("activate managed Toolchain: {error}")),
        }
    }
    Err(format!(
        "activate managed Toolchain: {}",
        last_error.map_or_else(|| "unknown error".to_owned(), |error| error.to_string())
    ))
}

fn verify_npm_lock(
    root: &Path,
    package: &str,
    expected_version: &str,
    expected_integrity: &str,
) -> Result<(), String> {
    let source = std::fs::read_to_string(root.join("package-lock.json"))
        .map_err(|error| format!("read Toolchain package lock: {error}"))?;
    let lock: serde_json::Value = serde_json::from_str(&source)
        .map_err(|error| format!("parse Toolchain package lock: {error}"))?;
    let key = format!("node_modules/{package}");
    let entry = lock
        .get("packages")
        .and_then(|packages| packages.get(&key))
        .ok_or_else(|| format!("Toolchain package lock is missing {package}"))?;
    let version = entry.get("version").and_then(serde_json::Value::as_str);
    let integrity = entry.get("integrity").and_then(serde_json::Value::as_str);
    if version != Some(expected_version) || integrity != Some(expected_integrity) {
        return Err(format!(
            "Toolchain package lock mismatch for {package}: version={version:?} integrity={integrity:?}"
        ));
    }
    Ok(())
}

fn archive_executable(root: &Path, executable: &str) -> Option<PathBuf> {
    let filename = executable_filename(executable);
    [root.join(&filename), root.join("bin").join(filename)]
        .into_iter()
        .find(|path| path.is_file())
}

fn managed_executable(definition: &ToolchainDefinition, managed_root: &Path) -> Option<PathBuf> {
    let root = managed_install_path(definition, managed_root);
    match definition.provider {
        ToolchainProvider::Npm { .. } => {
            let executable = installed_npm_executable(&root, &definition.executable);
            executable.is_file().then_some(executable)
        }
        ToolchainProvider::Archive { .. } => archive_executable(&root, &definition.executable),
        ToolchainProvider::External => None,
    }
}

fn managed_install_path(definition: &ToolchainDefinition, managed_root: &Path) -> PathBuf {
    let version = provider_version(&definition.provider).unwrap_or("external");
    managed_root
        .join("installs")
        .join(&definition.id)
        .join(version)
}

fn managed_install_verified(definition: &ToolchainDefinition, managed_root: &Path) -> bool {
    let root = managed_install_path(definition, managed_root);
    match &definition.provider {
        ToolchainProvider::Npm {
            package,
            version,
            integrity,
            ..
        } => verify_npm_lock(&root, package, version, integrity).is_ok(),
        ToolchainProvider::Archive { .. } => managed_executable(definition, managed_root).is_some(),
        ToolchainProvider::External => false,
    }
}

fn installed_npm_executable(root: &Path, executable: &str) -> PathBuf {
    #[cfg(windows)]
    return root
        .join("node_modules/.bin")
        .join(format!("{executable}.cmd"));
    #[cfg(not(windows))]
    root.join("node_modules/.bin").join(executable)
}

fn npm_executable(managed_root: &Path) -> Option<PathBuf> {
    if let Some(node) = resolve("nodejs", managed_root)
        && let Some(parent) = node.parent()
    {
        #[cfg(windows)]
        let npm = parent.join("npm.cmd");
        #[cfg(not(windows))]
        let npm = parent.join("npm");
        if npm.is_file() {
            return Some(npm);
        }
    }
    #[cfg(windows)]
    return which::which("npm.cmd")
        .or_else(|_| which::which("npm"))
        .ok();
    #[cfg(not(windows))]
    which::which("npm").ok()
}

fn provider_name(provider: &ToolchainProvider) -> &'static str {
    match provider {
        ToolchainProvider::External => "external",
        ToolchainProvider::Npm { .. } => "npm",
        ToolchainProvider::Archive { .. } => "archive",
    }
}

fn provider_version(provider: &ToolchainProvider) -> Option<&str> {
    match provider {
        ToolchainProvider::External => None,
        ToolchainProvider::Npm { version, .. } | ToolchainProvider::Archive { version, .. } => {
            Some(version)
        }
    }
}

fn provider_spec(provider: &ToolchainProvider) -> Option<String> {
    match provider {
        ToolchainProvider::External => None,
        ToolchainProvider::Npm {
            package, version, ..
        } => Some(format!("npm:{package}@{version}")),
        ToolchainProvider::Archive { version, artifacts } => artifacts
            .get(target_key())
            .map(|artifact| format!("archive:{version}:{}", artifact.url)),
    }
}

fn find_executable(definition: &ToolchainDefinition, managed_root: &Path) -> Option<PathBuf> {
    managed_executable(definition, managed_root).or_else(|| find_external_executable(definition))
}

fn find_external_executable(definition: &ToolchainDefinition) -> Option<PathBuf> {
    environment_override(&definition.id).or_else(|| {
        definition
            .candidates
            .iter()
            .find_map(|candidate| which::which(candidate).ok())
            .or_else(|| {
                definition
                    .locations
                    .get(platform_key())
                    .into_iter()
                    .flatten()
                    .filter_map(|location| expand_location(location))
                    .find(|path| path.is_file())
            })
    })
}

fn environment_override(id: &str) -> Option<PathBuf> {
    let variable = format!(
        "OVULE_TOOLCHAIN_{}",
        id.chars()
            .map(|character| if character.is_ascii_alphanumeric() {
                character.to_ascii_uppercase()
            } else {
                '_'
            })
            .collect::<String>()
    );
    std::env::var_os(variable)
        .map(PathBuf::from)
        .filter(|path| path.is_file())
}

fn expand_location(location: &str) -> Option<PathBuf> {
    let mut value = location.to_owned();
    for (placeholder, variable) in [
        ("{local_app_data}", "LOCALAPPDATA"),
        ("{program_files}", "ProgramFiles"),
        ("{home}", if cfg!(windows) { "USERPROFILE" } else { "HOME" }),
    ] {
        if value.contains(placeholder) {
            value = value.replace(placeholder, &std::env::var(variable).ok()?);
        }
    }
    Some(PathBuf::from(value))
}

fn executable_filename(executable: &str) -> String {
    if cfg!(windows) && Path::new(executable).extension().is_none() {
        format!("{executable}.exe")
    } else {
        executable.to_owned()
    }
}

const fn platform_key() -> &'static str {
    if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else {
        "linux"
    }
}

const fn target_key() -> &'static str {
    if cfg!(all(target_os = "windows", target_arch = "x86_64")) {
        "windows-x86_64"
    } else if cfg!(all(target_os = "windows", target_arch = "aarch64")) {
        "windows-aarch64"
    } else if cfg!(all(target_os = "macos", target_arch = "x86_64")) {
        "macos-x86_64"
    } else if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
        "macos-aarch64"
    } else if cfg!(target_arch = "x86_64") {
        "linux-x86_64"
    } else {
        "linux-aarch64"
    }
}

fn last_diagnostic<'a>(primary: &'a str, fallback: &'a str) -> &'a str {
    let value = if primary.trim().is_empty() {
        fallback
    } else {
        primary
    };
    value
        .lines()
        .rev()
        .find(|line| !line.trim().is_empty())
        .unwrap_or("installer returned no diagnostics")
        .trim()
}

#[cfg(test)]
mod tests;
