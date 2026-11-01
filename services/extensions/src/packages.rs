//! Trusted Host side of the JavaScript extension protocol.
//!
//! A Utility session binds [`ExtensionPrincipal`] out of band. JavaScript sends
//! only [`HostRequest`] values and therefore cannot forge identity or grants.

use std::collections::BTreeSet;
use std::fs;
use std::path::{Component, Path, PathBuf};

const MAX_MANIFEST_BYTES: u64 = 256 * 1024;
const MAX_MODULE_SOURCE_BYTES: u64 = 512 * 1024;
const MAX_WEB_MODULE_BYTES: u64 = 8 * 1024 * 1024;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ResolvedComputerUseContribution {
    pub extension_id: String,
    pub contribution: ComputerUseContribution,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ResolvedAgentContribution {
    pub extension_id: String,
    pub package: ValidatedExtensionPackage,
    pub contribution: AgentContribution,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ResolvedModelContribution {
    pub extension_id: String,
    pub contribution: ModelContribution,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ResolvedSkillContribution {
    pub extension_id: String,
    pub extension_root: PathBuf,
    pub contribution: ExtensionSkillContribution,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ResolvedSlashCommand {
    pub extension_id: String,
    pub extension_root: PathBuf,
    pub skills: Vec<ExtensionSkillContribution>,
    pub contribution: SlashCommandContribution,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ResolvedExtensionAction {
    pub extension_id: String,
    pub contribution: ExtensionActionContribution,
}

/// Setup declaration plus the package that supplies its effective grants.
/// Native setup has no package and cannot acquire an extension network grant.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ResolvedOnboarding {
    pub package: Option<ValidatedExtensionPackage>,
    pub contribution: OnboardingContribution,
}

/// A validated extension package and its optional canonical Host entry module.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ValidatedExtensionPackage {
    pub root: PathBuf,
    pub entry: Option<PathBuf>,
    pub manifest: ExtensionManifest,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ExtensionPackageSource {
    BuiltIn,
    InstalledThirdParty,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ExtensionPackageInfo {
    pub install_path: PathBuf,
    pub id: String,
    pub version: String,
    pub source: ExtensionPackageSource,
    pub enabled: bool,
    pub removable: bool,
}
pub fn load_extension_package(root: &Path) -> Result<ValidatedExtensionPackage, HostProtocolError> {
    let unresolved_root =
        fs::symlink_metadata(root).map_err(|_| HostProtocolError::InvalidManifest)?;
    if !unresolved_root.is_dir() || unresolved_root.file_type().is_symlink() {
        return Err(HostProtocolError::InvalidManifest);
    }
    let root = fs::canonicalize(root).map_err(|_| HostProtocolError::InvalidManifest)?;
    if !root.is_dir() {
        return Err(HostProtocolError::InvalidManifest);
    }
    let manifest_path = root.join("extension.json");
    let metadata =
        fs::symlink_metadata(&manifest_path).map_err(|_| HostProtocolError::InvalidManifest)?;
    if !metadata.is_file()
        || metadata.file_type().is_symlink()
        || metadata.len() > MAX_MANIFEST_BYTES
    {
        return Err(HostProtocolError::InvalidManifest);
    }
    let bytes = fs::read(&manifest_path).map_err(|_| HostProtocolError::InvalidManifest)?;
    let manifest: ExtensionManifest =
        serde_json::from_slice(&bytes).map_err(|_| HostProtocolError::InvalidManifest)?;
    manifest.validate()?;
    let entry = match &manifest.runtime {
        Some(ExtensionRuntime::JavaScript { entry }) => {
            let relative_entry = Path::new(entry);
            if !entry.starts_with("dist/")
                || relative_entry.is_absolute()
                || relative_entry.components().any(|component| {
                    matches!(
                        component,
                        Component::ParentDir | Component::RootDir | Component::Prefix(_)
                    )
                })
                || relative_entry.extension().and_then(|value| value.to_str()) != Some("mjs")
            {
                return Err(HostProtocolError::InvalidManifest);
            }
            let unresolved_entry = root.join(relative_entry);
            let unresolved_entry_metadata = fs::symlink_metadata(&unresolved_entry)
                .map_err(|_| HostProtocolError::InvalidManifest)?;
            if !unresolved_entry_metadata.is_file()
                || unresolved_entry_metadata.file_type().is_symlink()
            {
                return Err(HostProtocolError::InvalidManifest);
            }
            let entry = fs::canonicalize(unresolved_entry)
                .map_err(|_| HostProtocolError::InvalidManifest)?;
            if !entry.is_file() || !entry.starts_with(&root) {
                return Err(HostProtocolError::InvalidManifest);
            }
            Some(entry)
        }
        Some(ExtensionRuntime::Utility { service }) => {
            if !valid_token(service) {
                return Err(HostProtocolError::InvalidManifest);
            }
            None
        }
        None => None,
    };
    Ok(ValidatedExtensionPackage {
        root,
        entry,
        manifest,
    })
}

impl ValidatedExtensionPackage {
    /// Builds the immutable self-contained module consumed by Tuffite's
    /// restricted V8 Utility runtime. The npm build bundles the Extension SDK;
    /// no source-tree imports or Utility-side file access are available.
    pub fn javascript_package(&self) -> Result<JavaScriptModule, HostProtocolError> {
        let extension_directory = self
            .root
            .file_name()
            .and_then(|value| value.to_str())
            .filter(|value| !value.is_empty())
            .ok_or(HostProtocolError::InvalidManifest)?;
        let entry_relative = self
            .entry
            .as_ref()
            .ok_or(HostProtocolError::InvalidManifest)?
            .strip_prefix(&self.root)
            .map_err(|_| HostProtocolError::InvalidManifest)?;
        let logical_root = format!("extensions/{extension_directory}");
        let logical_entry = format!("{logical_root}/{}", portable_path(entry_relative)?);
        let entry = self
            .entry
            .as_ref()
            .ok_or(HostProtocolError::InvalidManifest)?;
        let metadata = fs::metadata(entry).map_err(|_| HostProtocolError::InvalidManifest)?;
        if metadata.len() == 0 || metadata.len() > MAX_MODULE_SOURCE_BYTES {
            return Err(HostProtocolError::InvalidManifest);
        }
        let source = fs::read_to_string(entry).map_err(|_| HostProtocolError::InvalidManifest)?;
        Ok(JavaScriptModule {
            entry: logical_entry,
            source,
        })
    }

    /// Builds the initial effective grant. Product/workspace policy may narrow
    /// this further before a session is opened.
    pub fn declared_grant(&self) -> Result<ExtensionGrant, HostProtocolError> {
        let mut capabilities = BTreeSet::new();
        if !self.manifest.permissions.process.is_empty() {
            capabilities.insert("process".to_owned());
            capabilities.insert("process.control".to_owned());
        }
        if !self.manifest.permissions.network.is_empty() {
            capabilities.insert("network".to_owned());
        }
        if self.manifest.permissions.workspace {
            capabilities.insert("workspace.read".to_owned());
        }
        if !self.manifest.permissions.secrets.is_empty() {
            capabilities.insert("secret.bind".to_owned());
        }
        capabilities.extend(["state.checkpoint", "telemetry.emit"].map(str::to_owned));
        ExtensionGrant::new(
            capabilities,
            self.manifest.permissions.process.clone(),
            self.manifest.permissions.network.clone(),
            self.manifest.permissions.secrets.clone(),
            self.manifest.permissions.environment.clone(),
            256 * 1024,
        )
    }

    pub fn validate_web_assets(&self) -> Result<(), HostProtocolError> {
        if let Some(ui) = &self.manifest.ui {
            validate_package_asset(&self.root, &ui.entry, "js")?;
        }
        for block in &self.manifest.contributes.message_blocks {
            if let Some(module) = &block.module {
                validate_package_asset(
                    &self.root,
                    module,
                    if self
                        .manifest
                        .ui
                        .as_ref()
                        .is_some_and(|ui| &ui.entry == module)
                    {
                        "js"
                    } else {
                        "mjs"
                    },
                )?;
            }
            if let Some(style) = &block.style {
                validate_package_asset(&self.root, style, "css")?;
            }
        }
        for editor in &self.manifest.contributes.file_editors {
            validate_package_asset(
                &self.root,
                &editor.module,
                if self
                    .manifest
                    .ui
                    .as_ref()
                    .is_some_and(|ui| ui.entry == editor.module)
                {
                    "js"
                } else {
                    "mjs"
                },
            )?;
            if let Some(style) = &editor.style {
                validate_package_asset(&self.root, style, "css")?;
            }
        }
        for skill in &self.manifest.contributes.skills {
            validate_package_asset(&self.root, &skill.path, "md")?;
        }
        for command in &self.manifest.contributes.slash_commands {
            validate_package_asset(&self.root, &command.workflow, "md")?;
        }
        Ok(())
    }
}

pub fn extension_asset_root() -> Result<PathBuf, HostProtocolError> {
    let executable = std::env::current_exe().map_err(|_| HostProtocolError::InvalidManifest)?;
    extension_asset_root_for_executable(&executable)
}

fn extension_asset_root_for_executable(executable: &Path) -> Result<PathBuf, HostProtocolError> {
    let packaged = ovule_platform::resources::packaged_resource_roots(executable)
        .into_iter()
        .find(|root| root.join("extensions").is_dir());
    let development = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../desktop");
    packaged
        .or_else(|| {
            development
                .join("extensions")
                .is_dir()
                .then_some(development)
        })
        .ok_or(HostProtocolError::InvalidManifest)
}

pub fn load_bundled_extensions() -> Result<Vec<ValidatedExtensionPackage>, HostProtocolError> {
    let packages = load_extension_directory(
        &extension_asset_root()?.join("extensions"),
        true,
        true,
        InvalidExtensionPolicy::Reject,
    )?;
    validate_extension_catalog(&packages)?;
    Ok(packages)
}

/// Loads the reviewed application extensions plus packages explicitly installed
/// below the Ovule data directory. Repository `plugins/` directories are
/// package sources only and are never activated implicitly.
pub fn load_extensions() -> Result<Vec<ValidatedExtensionPackage>, HostProtocolError> {
    let mut packages = load_bundled_extensions()?;
    let disabled = extension_state_ids("disabled")?;
    let removed = extension_state_ids("removed")?;
    let installed_root = installed_extension_root()?;
    let installed =
        load_extension_directory(&installed_root, false, false, InvalidExtensionPolicy::Skip)?
            .into_iter()
            .filter(|package| {
                !disabled.contains(&package.manifest.id) && !removed.contains(&package.manifest.id)
            });
    extend_validated_extension_catalog(&mut packages, installed);
    Ok(packages)
}

pub fn extension_packages() -> Result<Vec<ExtensionPackageInfo>, HostProtocolError> {
    let disabled = extension_state_ids("disabled")?;
    let removed = extension_state_ids("removed")?;
    let mut packages = load_bundled_extensions()?;
    let built_in_count = packages.len();
    let installed = load_extension_directory(
        &installed_extension_root()?,
        false,
        false,
        InvalidExtensionPolicy::Skip,
    )?
    .into_iter()
    .filter(|package| !removed.contains(&package.manifest.id));
    extend_validated_extension_catalog(&mut packages, installed);
    let mut values = packages
        .into_iter()
        .enumerate()
        .map(|(index, package)| {
            let built_in = index < built_in_count;
            ExtensionPackageInfo {
                install_path: package.root,
                enabled: built_in || !disabled.contains(&package.manifest.id),
                id: package.manifest.id,
                version: package.manifest.version,
                source: if built_in {
                    ExtensionPackageSource::BuiltIn
                } else {
                    ExtensionPackageSource::InstalledThirdParty
                },
                removable: !built_in,
            }
        })
        .collect::<Vec<_>>();
    values.sort_by(|left, right| left.id.cmp(&right.id));
    Ok(values)
}

pub fn set_third_party_extension_enabled(
    extension_id: &str,
    enabled: bool,
) -> Result<(), HostProtocolError> {
    let package = third_party_package(extension_id)?.ok_or(HostProtocolError::InvalidManifest)?;
    let marker = extension_state_root()?.join(format!("{}.disabled", package.manifest.id));
    if enabled {
        if marker.exists() {
            fs::remove_file(marker).map_err(|_| HostProtocolError::InvalidManifest)?;
        }
    } else {
        fs::create_dir_all(extension_state_root()?)
            .map_err(|_| HostProtocolError::InvalidManifest)?;
        fs::write(marker, b"disabled\n").map_err(|_| HostProtocolError::InvalidManifest)?;
    }
    Ok(())
}

pub fn remove_third_party_extension(extension_id: &str) -> Result<(), HostProtocolError> {
    let removed_marker = extension_state_root()?.join(format!("{extension_id}.removed"));
    if removed_marker.exists() {
        return Ok(());
    }
    let installed_root = installed_extension_root()?;
    for package in
        load_extension_directory(&installed_root, false, false, InvalidExtensionPolicy::Skip)?
    {
        if package.manifest.id == extension_id {
            let canonical_root = fs::canonicalize(&installed_root)
                .map_err(|_| HostProtocolError::InvalidManifest)?;
            if !package.root.starts_with(&canonical_root) {
                return Err(HostProtocolError::InvalidManifest);
            }
            fs::create_dir_all(extension_state_root()?)
                .map_err(|_| HostProtocolError::InvalidManifest)?;
            fs::write(&removed_marker, b"removed\n")
                .map_err(|_| HostProtocolError::InvalidManifest)?;
            if let Err(error) = fs::remove_dir_all(&package.root) {
                tracing::warn!(
                    extension_id,
                    path = %package.root.display(),
                    %error,
                    "Extension is logically removed; files will be replaced after restart"
                );
            }
            clear_extension_marker(extension_id, "disabled")?;
            return Ok(());
        }
    }
    Err(HostProtocolError::InvalidManifest)
}

fn third_party_package(
    extension_id: &str,
) -> Result<Option<ValidatedExtensionPackage>, HostProtocolError> {
    let removed = extension_state_ids("removed")?;
    Ok(load_extension_directory(
        &installed_extension_root()?,
        false,
        false,
        InvalidExtensionPolicy::Skip,
    )?
    .into_iter()
    .find(|package| package.manifest.id == extension_id && !removed.contains(extension_id)))
}

fn extension_state_root() -> Result<PathBuf, HostProtocolError> {
    installed_extension_root()?
        .parent()
        .map(|root| root.join("extension-state"))
        .ok_or(HostProtocolError::InvalidManifest)
}

fn extension_state_ids(kind: &str) -> Result<BTreeSet<String>, HostProtocolError> {
    let root = extension_state_root()?;
    if !root.exists() {
        return Ok(BTreeSet::new());
    }
    let suffix = format!(".{kind}");
    Ok(fs::read_dir(root)
        .map_err(|_| HostProtocolError::InvalidManifest)?
        .filter_map(Result::ok)
        .filter_map(|entry| entry.file_name().to_str().map(str::to_owned))
        .filter_map(|name| name.strip_suffix(&suffix).map(str::to_owned))
        .filter(|id| valid_extension_id(id))
        .collect())
}

fn clear_extension_marker(extension_id: &str, kind: &str) -> Result<(), HostProtocolError> {
    let marker = extension_state_root()?.join(format!("{extension_id}.{kind}"));
    if marker.exists() {
        fs::remove_file(marker).map_err(|_| HostProtocolError::InvalidManifest)?;
    }
    Ok(())
}

pub fn installed_extension_root() -> Result<PathBuf, HostProtocolError> {
    ovule_platform::identity::data_directory()
        .map(|root| root.join("extensions"))
        .map_err(|_| HostProtocolError::InvalidManifest)
}

pub fn cleanup_removed_extension_packages() -> Result<(), HostProtocolError> {
    let root = installed_extension_root()?;
    for extension_id in extension_state_ids("removed")? {
        let destination = root.join(extension_id.replace('.', "-"));
        if destination.exists()
            && let Err(error) = fs::remove_dir_all(&destination)
        {
            tracing::warn!(
                %extension_id,
                path = %destination.display(),
                %error,
                "deferred Extension package cleanup remains pending"
            );
            continue;
        }
        clear_extension_marker(&extension_id, "removed")?;
    }
    Ok(())
}

pub fn install_extension_package(source: &Path) -> Result<PathBuf, HostProtocolError> {
    let package = load_extension_package(source)?;
    package.validate_web_assets()?;
    if package
        .manifest
        .contributes
        .message_blocks
        .iter()
        .any(MessageBlockContribution::requires_isolated_ui)
        || !package.manifest.contributes.file_editors.is_empty()
        || package.manifest.ui.is_some()
    {
        return Err(HostProtocolError::InvalidManifest);
    }
    let mut packages = load_bundled_extensions()?;
    if packages
        .iter()
        .any(|candidate| candidate.manifest.id == package.manifest.id)
    {
        return Err(HostProtocolError::InvalidManifest);
    }
    let installed = load_extension_directory(
        &installed_extension_root()?,
        false,
        false,
        InvalidExtensionPolicy::Skip,
    )?
    .into_iter()
    .filter(|candidate| candidate.manifest.id != package.manifest.id);
    extend_validated_extension_catalog(&mut packages, installed);
    packages.push(package.clone());
    validate_extension_catalog(&packages)?;
    let root = installed_extension_root()?;
    fs::create_dir_all(&root).map_err(|_| HostProtocolError::InvalidManifest)?;
    let directory = package.manifest.id.replace('.', "-");
    let destination = root.join(&directory);
    let staging = root.join(format!(".{directory}.{}.staging", std::process::id()));
    let backup = root.join(format!(".{directory}.{}.backup", std::process::id()));
    if staging.exists() {
        fs::remove_dir_all(&staging).map_err(|_| HostProtocolError::InvalidManifest)?;
    }
    if backup.exists() {
        fs::remove_dir_all(&backup).map_err(|_| HostProtocolError::InvalidManifest)?;
    }
    fs::create_dir(&staging).map_err(|_| HostProtocolError::InvalidManifest)?;
    let result = (|| {
        copy_install_file(&package.root, &staging, "extension.json")?;
        for directory in ["dist", "skills", "workflows"] {
            let source = package.root.join(directory);
            if source.exists() {
                copy_install_directory(&source, &staging.join(directory), 0)?;
            }
        }
        let installed = load_extension_package(&staging)?;
        installed.validate_web_assets()?;
        if destination.exists() {
            fs::rename(&destination, &backup).map_err(|_| HostProtocolError::InvalidManifest)?;
        }
        if fs::rename(&staging, &destination).is_err() {
            if backup.exists() {
                let _ = fs::rename(&backup, &destination);
            }
            return Err(HostProtocolError::InvalidManifest);
        }
        if backup.exists()
            && let Err(error) = fs::remove_dir_all(&backup)
        {
            tracing::warn!(
                extension = package.manifest.id,
                path = %backup.display(),
                %error,
                "replaced Extension backup remains pending cleanup"
            );
        }
        clear_extension_marker(&package.manifest.id, "removed")?;
        clear_extension_marker(&package.manifest.id, "disabled")?;
        Ok(destination.clone())
    })();
    if result.is_err() {
        let _ = fs::remove_dir_all(&staging);
        if backup.exists() && !destination.exists() {
            let _ = fs::rename(&backup, &destination);
        }
    }
    result
}

fn copy_install_file(
    root: &Path,
    destination: &Path,
    relative: &str,
) -> Result<(), HostProtocolError> {
    let source = canonical_regular_file(&root.join(relative))?;
    if !source.starts_with(root) {
        return Err(HostProtocolError::InvalidManifest);
    }
    let target = destination.join(relative);
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|_| HostProtocolError::InvalidManifest)?;
    }
    fs::copy(source, target).map_err(|_| HostProtocolError::InvalidManifest)?;
    Ok(())
}

fn copy_install_directory(
    source: &Path,
    destination: &Path,
    depth: usize,
) -> Result<(), HostProtocolError> {
    if depth > 8 {
        return Err(HostProtocolError::InvalidManifest);
    }
    let metadata = fs::symlink_metadata(source).map_err(|_| HostProtocolError::InvalidManifest)?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err(HostProtocolError::InvalidManifest);
    }
    fs::create_dir_all(destination).map_err(|_| HostProtocolError::InvalidManifest)?;
    for entry in fs::read_dir(source).map_err(|_| HostProtocolError::InvalidManifest)? {
        let entry = entry.map_err(|_| HostProtocolError::InvalidManifest)?;
        let kind = entry
            .file_type()
            .map_err(|_| HostProtocolError::InvalidManifest)?;
        if kind.is_symlink() {
            return Err(HostProtocolError::InvalidManifest);
        }
        let target = destination.join(entry.file_name());
        if kind.is_dir() {
            copy_install_directory(&entry.path(), &target, depth + 1)?;
        } else if kind.is_file() {
            if entry
                .metadata()
                .map_err(|_| HostProtocolError::InvalidManifest)?
                .len()
                > MAX_WEB_MODULE_BYTES
            {
                return Err(HostProtocolError::InvalidManifest);
            }
            fs::copy(entry.path(), target).map_err(|_| HostProtocolError::InvalidManifest)?;
        } else {
            return Err(HostProtocolError::InvalidManifest);
        }
    }
    Ok(())
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum InvalidExtensionPolicy {
    Reject,
    Skip,
}

fn load_extension_directory(
    root: &Path,
    required: bool,
    allow_web_contributions: bool,
    invalid_policy: InvalidExtensionPolicy,
) -> Result<Vec<ValidatedExtensionPackage>, HostProtocolError> {
    if !root.exists() && !required {
        return Ok(Vec::new());
    }
    let root_metadata =
        fs::symlink_metadata(root).map_err(|_| HostProtocolError::InvalidManifest)?;
    if !root_metadata.is_dir() || root_metadata.file_type().is_symlink() {
        return Err(HostProtocolError::InvalidManifest);
    }
    let mut directories = fs::read_dir(root)
        .map_err(|_| HostProtocolError::InvalidManifest)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| HostProtocolError::InvalidManifest)?;
    directories.sort_by_key(std::fs::DirEntry::file_name);
    let removed_directories = if required {
        BTreeSet::new()
    } else {
        extension_state_ids("removed")?
            .into_iter()
            .map(|id| id.replace('.', "-"))
            .collect()
    };
    let mut packages = Vec::new();
    for entry in directories {
        if removed_directories.contains(&entry.file_name().to_string_lossy().into_owned()) {
            continue;
        }
        let path = entry.path();
        let package = (|| {
            let kind = entry
                .file_type()
                .map_err(|_| HostProtocolError::InvalidManifest)?;
            if kind.is_symlink() {
                return Err(HostProtocolError::InvalidManifest);
            }
            if !kind.is_dir() {
                return Ok(None);
            }
            // Removed development workspaces may retain ignored build/dependency directories.
            match fs::symlink_metadata(path.join("extension.json")) {
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
                Err(_) => return Err(HostProtocolError::InvalidManifest),
                Ok(_) => {}
            }
            let package = load_extension_package(&path)?;
            package.validate_web_assets()?;
            if !allow_web_contributions
                && (package
                    .manifest
                    .contributes
                    .message_blocks
                    .iter()
                    .any(MessageBlockContribution::requires_isolated_ui)
                    || !package.manifest.contributes.file_editors.is_empty()
                    || package.manifest.ui.is_some())
            {
                return Err(HostProtocolError::InvalidManifest);
            }
            Ok(Some(package))
        })();
        match package {
            Ok(Some(package)) => packages.push(package),
            Ok(None) => {}
            Err(error) if invalid_policy == InvalidExtensionPolicy::Skip => {
                tracing::warn!(
                    extension = %path.display(),
                    %error,
                    "skipping invalid installed extension"
                );
            }
            Err(error) => {
                tracing::error!(
                    extension = %path.display(),
                    %error,
                    "invalid required extension package"
                );
                return Err(error);
            }
        }
    }
    Ok(packages)
}

pub fn resolve_extension_agent(
    agent_id: &str,
) -> Result<Option<ResolvedAgentContribution>, HostProtocolError> {
    Ok(load_extensions()?.into_iter().find_map(|package| {
        let contribution = package
            .manifest
            .contributes
            .agents
            .iter()
            .find(|agent| agent.id == agent_id)
            .cloned()?;
        Some(ResolvedAgentContribution {
            extension_id: package.manifest.id.clone(),
            package,
            contribution,
        })
    }))
}

pub fn resolve_extension_channel(
    channel_id: &str,
) -> Result<Option<ValidatedExtensionPackage>, HostProtocolError> {
    Ok(load_extensions()?.into_iter().find(|package| {
        package
            .manifest
            .contributes
            .channels
            .iter()
            .any(|channel| channel.id == channel_id)
    }))
}

pub fn extension_agent_contributions() -> Result<Vec<AgentContribution>, HostProtocolError> {
    Ok(load_extensions()?
        .into_iter()
        .flat_map(|package| package.manifest.contributes.agents)
        .collect())
}

pub fn known_extension_agent_contributions() -> Result<Vec<AgentContribution>, HostProtocolError> {
    let mut packages = load_bundled_extensions()?;
    let installed = load_extension_directory(
        &installed_extension_root()?,
        false,
        false,
        InvalidExtensionPolicy::Skip,
    )?;
    extend_validated_extension_catalog(&mut packages, installed);
    Ok(packages
        .into_iter()
        .flat_map(|package| package.manifest.contributes.agents)
        .collect())
}

pub fn resolve_extension_agent_for_executable(
    executable: &str,
) -> Result<Option<AgentContribution>, HostProtocolError> {
    Ok(extension_agent_contributions()?.into_iter().find(|agent| {
        agent
            .executable_candidates
            .iter()
            .any(|candidate| candidate == executable)
    }))
}

pub fn resolved_extension_agents() -> Result<Vec<ResolvedAgentContribution>, HostProtocolError> {
    Ok(load_extensions()?
        .into_iter()
        .flat_map(|package| {
            let extension_id = package.manifest.id.clone();
            package
                .manifest
                .contributes
                .agents
                .clone()
                .into_iter()
                .map(move |contribution| ResolvedAgentContribution {
                    extension_id: extension_id.clone(),
                    package: package.clone(),
                    contribution,
                })
        })
        .collect())
}

pub fn extension_model_contributions() -> Result<Vec<ModelContribution>, HostProtocolError> {
    Ok(load_extensions()?
        .into_iter()
        .flat_map(|package| package.manifest.contributes.models)
        .collect())
}

pub fn resolved_extension_models() -> Result<Vec<ResolvedModelContribution>, HostProtocolError> {
    Ok(load_extensions()?
        .into_iter()
        .flat_map(|package| {
            let extension_id = package.manifest.id;
            package
                .manifest
                .contributes
                .models
                .into_iter()
                .map(move |contribution| ResolvedModelContribution {
                    extension_id: extension_id.clone(),
                    contribution,
                })
        })
        .collect())
}

pub fn resolve_extension_model_provider(
    provider: &str,
) -> Result<Option<ValidatedExtensionPackage>, HostProtocolError> {
    Ok(load_extensions()?.into_iter().find(|package| {
        package
            .manifest
            .contributes
            .models
            .iter()
            .any(|model| model.provider == provider)
    }))
}

pub fn resolve_extension_onboarding(
    extension_id: &str,
    setup_id: &str,
) -> Result<Option<ResolvedOnboarding>, HostProtocolError> {
    if matches!(
        extension_id,
        ovule_extension_api::host::OWNER | "io.ovule.essentials"
    ) {
        return Ok(ovule_extension_api::host::contributions()
            .onboarding
            .into_iter()
            .find(|setup| setup.id == setup_id)
            .map(|contribution| ResolvedOnboarding {
                package: None,
                contribution,
            }));
    }
    Ok(load_extensions()?.into_iter().find_map(|package| {
        if package.manifest.id != extension_id {
            return None;
        }
        let contribution = package
            .manifest
            .contributes
            .onboarding
            .iter()
            .find(|setup| setup.id == setup_id)
            .cloned()?;
        Some(ResolvedOnboarding {
            package: Some(package),
            contribution,
        })
    }))
}

pub fn resolved_extension_computer_use()
-> Result<Vec<ResolvedComputerUseContribution>, HostProtocolError> {
    Ok(load_extensions()?
        .into_iter()
        .flat_map(|package| {
            let extension_id = package.manifest.id;
            package
                .manifest
                .contributes
                .computer_use
                .into_iter()
                .map(move |contribution| ResolvedComputerUseContribution {
                    extension_id: extension_id.clone(),
                    contribution,
                })
        })
        .collect())
}

pub fn resolved_extension_skills() -> Result<Vec<ResolvedSkillContribution>, HostProtocolError> {
    Ok(load_extensions()?
        .into_iter()
        .flat_map(|package| {
            let extension_id = package.manifest.id.clone();
            let extension_root = package.root.clone();
            package
                .manifest
                .contributes
                .skills
                .into_iter()
                .map(move |contribution| ResolvedSkillContribution {
                    extension_id: extension_id.clone(),
                    extension_root: extension_root.clone(),
                    contribution,
                })
        })
        .collect())
}

pub fn extension_toolchain_contributions()
-> Result<Vec<ovule_extension_api::ToolchainDefinition>, HostProtocolError> {
    Ok(load_extensions()?
        .into_iter()
        .flat_map(|package| package.manifest.contributes.toolchains)
        .collect())
}

pub fn resolve_extension_slash_command(
    command_id: &str,
) -> Result<Option<ResolvedSlashCommand>, HostProtocolError> {
    Ok(load_extensions()?.into_iter().find_map(|package| {
        let contribution = package
            .manifest
            .contributes
            .slash_commands
            .iter()
            .find(|command| command.id == command_id)
            .cloned()?;
        Some(ResolvedSlashCommand {
            extension_id: package.manifest.id,
            extension_root: package.root,
            skills: package.manifest.contributes.skills,
            contribution,
        })
    }))
}

impl ResolvedSlashCommand {
    pub fn skill_paths(&self) -> Result<Vec<(String, PathBuf)>, HostProtocolError> {
        self.contribution
            .skills
            .iter()
            .map(|skill_id| {
                let skill = self
                    .skills
                    .iter()
                    .find(|skill| &skill.id == skill_id)
                    .ok_or(HostProtocolError::InvalidManifest)?;
                let path = canonical_regular_file(&self.extension_root.join(&skill.path))?;
                path.starts_with(&self.extension_root)
                    .then_some((skill.id.clone(), path))
                    .ok_or(HostProtocolError::InvalidManifest)
            })
            .collect()
    }

    pub fn workflow_instructions(&self) -> Result<String, HostProtocolError> {
        let path = canonical_regular_file(&self.extension_root.join(&self.contribution.workflow))?;
        if !path.starts_with(&self.extension_root) {
            return Err(HostProtocolError::InvalidManifest);
        }
        fs::read_to_string(path).map_err(|_| HostProtocolError::InvalidManifest)
    }

    pub fn fallback_json(&self) -> Result<String, HostProtocolError> {
        serde_json::to_string(&self.contribution.fallback)
            .map_err(|_| HostProtocolError::InvalidManifest)
    }
}

pub fn resolve_extension_action(
    extension_id: &str,
    action_id: &str,
) -> Result<Option<ResolvedExtensionAction>, HostProtocolError> {
    Ok(load_extensions()?.into_iter().find_map(|package| {
        (package.manifest.id == extension_id).then(|| {
            package
                .manifest
                .contributes
                .actions
                .into_iter()
                .find(|action| action.id == action_id)
                .map(|contribution| ResolvedExtensionAction {
                    extension_id: package.manifest.id,
                    contribution,
                })
        })?
    }))
}

#[allow(clippy::too_many_lines)] // One pass validates uniqueness across all contribution namespaces.
fn validate_extension_catalog(
    packages: &[ValidatedExtensionPackage],
) -> Result<(), HostProtocolError> {
    let host = ovule_extension_api::host::contributions();
    let mut extension_ids =
        BTreeSet::from([ovule_extension_api::host::OWNER, "io.ovule.essentials"]);
    let mut agent_ids = BTreeSet::new();
    let mut channel_ids = BTreeSet::new();
    let mut skill_ids = BTreeSet::new();
    let mut model_ids = BTreeSet::new();
    let mut model_provider_ids = BTreeSet::new();
    let mut capability_ids = host
        .capabilities
        .iter()
        .map(|item| item.id.as_str())
        .collect::<BTreeSet<_>>();
    let mut message_block_kinds = host
        .message_blocks
        .iter()
        .map(|item| item.kind.as_str())
        .collect::<BTreeSet<_>>();
    let mut slash_command_ids = BTreeSet::new();
    let mut action_ids = BTreeSet::new();
    let mut computer_use_ids = host
        .computer_use
        .iter()
        .map(|item| item.id.as_str())
        .collect::<BTreeSet<_>>();
    let mut toolchain_ids = BTreeSet::new();
    let mut file_editor_ids = BTreeSet::new();
    let mut file_editor_extensions = BTreeSet::new();
    let mut onboarding_ids = host
        .onboarding
        .iter()
        .map(|item| item.id.as_str())
        .collect::<BTreeSet<_>>();
    for package in packages {
        let package_model_providers = package
            .manifest
            .contributes
            .models
            .iter()
            .map(|model| model.provider.as_str())
            .collect::<BTreeSet<_>>();
        if !extension_ids.insert(package.manifest.id.as_str())
            || package_model_providers
                .into_iter()
                .any(|provider| !model_provider_ids.insert(provider))
            || package
                .manifest
                .contributes
                .agents
                .iter()
                .any(|item| !agent_ids.insert(item.id.as_str()))
            || package
                .manifest
                .contributes
                .channels
                .iter()
                .any(|item| !channel_ids.insert(item.id.as_str()))
            || package
                .manifest
                .contributes
                .skills
                .iter()
                .any(|item| !skill_ids.insert(item.id.as_str()))
            || package
                .manifest
                .contributes
                .models
                .iter()
                .any(|item| !model_ids.insert(item.id.as_str()))
            || package
                .manifest
                .contributes
                .capabilities
                .iter()
                .any(|item| !capability_ids.insert(item.id.as_str()))
            || package
                .manifest
                .contributes
                .message_blocks
                .iter()
                .any(|item| !message_block_kinds.insert(item.kind.as_str()))
            || package
                .manifest
                .contributes
                .slash_commands
                .iter()
                .any(|item| !slash_command_ids.insert(item.id.as_str()))
            || package
                .manifest
                .contributes
                .actions
                .iter()
                .any(|item| !action_ids.insert((package.manifest.id.as_str(), item.id.as_str())))
            || package
                .manifest
                .contributes
                .computer_use
                .iter()
                .any(|item| !computer_use_ids.insert(item.id.as_str()))
            || package
                .manifest
                .contributes
                .toolchains
                .iter()
                .any(|item| !toolchain_ids.insert(item.id.as_str()))
            || package
                .manifest
                .contributes
                .file_editors
                .iter()
                .any(|item| {
                    !file_editor_ids.insert(item.id.as_str())
                        || item
                            .extensions
                            .iter()
                            .any(|extension| !file_editor_extensions.insert(extension.as_str()))
                })
            || package
                .manifest
                .contributes
                .onboarding
                .iter()
                .any(|item| !onboarding_ids.insert(item.id.as_str()))
        {
            return Err(HostProtocolError::InvalidManifest);
        }
    }
    agent_ids.insert("ovule");
    if packages.iter().any(|package| {
        package
            .manifest
            .contributes
            .models
            .iter()
            .flat_map(|model| &model.agents)
            .any(|agent| !agent_ids.contains(agent.as_str()))
            || package
                .manifest
                .contributes
                .onboarding
                .iter()
                .flat_map(|setup| &setup.agent_ids)
                .any(|agent| !agent_ids.contains(agent.as_str()))
    }) {
        return Err(HostProtocolError::InvalidManifest);
    }
    Ok(())
}

fn extend_validated_extension_catalog(
    packages: &mut Vec<ValidatedExtensionPackage>,
    additions: impl IntoIterator<Item = ValidatedExtensionPackage>,
) {
    for package in additions {
        let extension = package.manifest.id.clone();
        let path = package.root.clone();
        packages.push(package);
        if let Err(error) = validate_extension_catalog(packages) {
            packages.pop();
            tracing::warn!(
                extension,
                path = %path.display(),
                %error,
                "skipping installed extension that conflicts with the active catalog"
            );
        }
    }
}

fn validate_package_asset(
    root: &Path,
    relative: &str,
    extension: &str,
) -> Result<(), HostProtocolError> {
    if !valid_relative_asset(relative, extension) {
        return Err(HostProtocolError::InvalidManifest);
    }
    let path = canonical_regular_file(&root.join(relative))?;
    let maximum = if extension == "mjs" || extension == "js" {
        MAX_WEB_MODULE_BYTES
    } else {
        MAX_MODULE_SOURCE_BYTES
    };
    if !path.starts_with(root)
        || fs::metadata(path)
            .map_err(|_| HostProtocolError::InvalidManifest)?
            .len()
            > maximum
    {
        return Err(HostProtocolError::InvalidManifest);
    }
    Ok(())
}

fn canonical_regular_file(path: &Path) -> Result<PathBuf, HostProtocolError> {
    let unresolved = fs::symlink_metadata(path).map_err(|_| HostProtocolError::InvalidManifest)?;
    if !unresolved.is_file() || unresolved.file_type().is_symlink() {
        return Err(HostProtocolError::InvalidManifest);
    }
    let path = fs::canonicalize(path).map_err(|_| HostProtocolError::InvalidManifest)?;
    if !path.is_file() {
        return Err(HostProtocolError::InvalidManifest);
    }
    Ok(path)
}

fn portable_path(path: &Path) -> Result<String, HostProtocolError> {
    let mut parts = Vec::new();
    for component in path.components() {
        let Component::Normal(value) = component else {
            return Err(HostProtocolError::InvalidManifest);
        };
        parts.push(value.to_str().ok_or(HostProtocolError::InvalidManifest)?);
    }
    Ok(parts.join("/"))
}

pub use ovule_extension_api::*;

#[cfg(test)]
mod tests;

/// Validated immutable module payload; the native host selects the JavaScript runtime.
pub struct JavaScriptModule {
    pub entry: String,
    pub source: String,
}
