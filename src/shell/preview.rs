//! File-scoped bearer grants. Only the trusted shell can mint or revoke a grant;
//! preview renderers cannot supply filesystem paths to any of their allowed APIs.
use crate::{
    runtime::Profile,
    shell_api::{PreviewFile, PreviewInfo},
};
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tuffite::CommandError;

const LIFETIME: Duration = Duration::from_secs(24 * 60 * 60);
const MAX_GRANTS: usize = 1024;

#[derive(Clone)]
enum PreviewSource {
    File(PathBuf),
    Html(Arc<str>),
}

#[derive(Clone)]
struct Grant {
    source: PreviewSource,
    url: String,
    kind: String,
    created: Instant,
}
impl Grant {
    fn file_path(&self) -> Result<&std::path::Path, CommandError> {
        match &self.source {
            PreviewSource::File(path) => Ok(path),
            PreviewSource::Html(_) => {
                Err(CommandError::Failed("Preview is not a file grant".into()))
            }
        }
    }
}
#[derive(Default)]
pub(crate) struct PreviewGrants(Mutex<HashMap<String, Grant>>);

impl PreviewGrants {
    fn create(&self, address: &str) -> Result<String, CommandError> {
        let path = super::browser::local_path(address)?
            .canonicalize()
            .map_err(|e| CommandError::Failed(e.to_string()))?;
        if !path.is_file() {
            return Err(CommandError::InvalidArgument(
                "Expected a regular file".into(),
            ));
        }
        let kind = preview_kind(&path).to_owned();
        let mut grants = self
            .0
            .lock()
            .map_err(|e| CommandError::Failed(e.to_string()))?;
        grants.retain(|_, grant| grant.created.elapsed() < LIFETIME);
        if grants.len() >= MAX_GRANTS {
            return Err(CommandError::Failed(
                "Too many active local previews".into(),
            ));
        }
        let id = format!(
            "{:032x}{:016x}",
            rand::random::<u128>(),
            rand::random::<u64>()
        );
        grants.insert(
            id.clone(),
            Grant {
                source: PreviewSource::File(path),
                url: address.to_owned(),
                kind,
                created: Instant::now(),
            },
        );
        Ok(id)
    }
    fn get(&self, id: &str) -> Result<Grant, CommandError> {
        self.get_at(id, Instant::now())
    }
    fn get_at(&self, id: &str, now: Instant) -> Result<Grant, CommandError> {
        let mut grants = self
            .0
            .lock()
            .map_err(|e| CommandError::Failed(e.to_string()))?;
        grants.retain(|_, grant| now.saturating_duration_since(grant.created) < LIFETIME);
        grants
            .get(id)
            .cloned()
            .ok_or_else(|| CommandError::Failed("Local preview access denied".into()))
    }
    fn revoke(&self, id: &str) -> Result<bool, CommandError> {
        Ok(self
            .0
            .lock()
            .map_err(|e| CommandError::Failed(e.to_string()))?
            .remove(id)
            .is_some())
    }
}

fn preview_kind(path: &std::path::Path) -> &'static str {
    let name = path
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_lowercase();
    let extension = path
        .extension()
        .unwrap_or_default()
        .to_string_lossy()
        .to_lowercase();
    match extension.as_str() {
        "doc" | "docx" | "dotx" | "xlsx" | "xlsm" | "csv" | "pptx" | "pptm" | "ppsx" => "office",
        "md" | "markdown" | "mdown" => "markdown",
        "pdf" => "pdf",
        "svg" => "image",
        "html" | "htm" => "html",
        "js" | "mjs" | "cjs" | "jsx" | "ts" | "mts" | "cts" | "tsx" | "py" | "rs" | "go" | "c"
        | "h" | "cc" | "cpp" | "hpp" | "cs" | "java" | "kt" | "swift" | "rb" | "php" | "sh"
        | "bash" | "zsh" | "fish" | "ps1" | "json" | "jsonc" | "yaml" | "yml" | "toml" | "ini"
        | "css" | "scss" | "less" | "sql" | "xml" | "vue" | "svelte" | "diff" | "patch"
        | "cmake" => "code",
        _ if name == "dockerfile" || name == "makefile" => "code",
        _ => "unsupported",
    }
}

fn validate_path(grant: &Grant) -> Result<(), CommandError> {
    // A grant remains bound to its canonical file, even if a symlink is swapped later.
    let path = grant.file_path()?;
    if path.canonicalize().ok().as_deref() != Some(path) || !path.is_file() {
        return Err(CommandError::Failed("Local preview access denied".into()));
    }
    Ok(())
}

impl crate::shell_api::Preview for Profile {
    fn describe(&self, id: String) -> Result<PreviewInfo, CommandError> {
        let grant = self.preview_grants.get(&id)?;
        let editor = if grant.kind == "office" {
            let extension = grant
                .file_path()?
                .extension()
                .unwrap_or_default()
                .to_string_lossy()
                .to_lowercase();
            let extension = if extension == "doc" {
                "docx"
            } else {
                &extension
            };
            super::mapper::extension_catalog(
                ovule_extensions::providers::catalog().map_err(CommandError::Failed)?,
            )
            .file_editors
            .into_iter()
            .find(|editor| editor.extensions.iter().any(|value| value == extension))
            .map(|mut editor| {
                editor.extension_id = format!("preview.{}", editor.extension_id);
                editor
            })
        } else {
            None
        };
        Ok(PreviewInfo {
            id,
            url: grant.url,
            kind: grant.kind,
            editor,
        })
    }
    fn read_text(&self, id: String) -> Result<String, CommandError> {
        let grant = self.preview_grants.get(&id)?;
        if let PreviewSource::Html(html) = &grant.source {
            return Ok(html.to_string());
        }
        if !matches!(grant.kind.as_str(), "code" | "markdown" | "image" | "html") {
            return Err(CommandError::Failed("Local preview access denied".into()));
        }
        validate_path(&grant)?;
        ovule_files::local::read_text(grant.file_path()?).map_err(CommandError::Failed)
    }
    fn read_file(&self, id: String) -> Result<PreviewFile, CommandError> {
        let grant = self.preview_grants.get(&id)?;
        if !matches!(grant.kind.as_str(), "office" | "pdf" | "image") {
            return Err(CommandError::Failed("Local preview access denied".into()));
        }
        validate_path(&grant)?;
        let file =
            ovule_files::local::read_file(grant.file_path()?).map_err(CommandError::Failed)?;
        Ok(PreviewFile {
            name: file.name,
            extension: file.extension,
            size_bytes: file.bytes.len().try_into().unwrap_or(i64::MAX),
            bytes: file.bytes,
        })
    }
}

impl PreviewGrants {
    pub(super) fn create_preview(&self, url: &str) -> Result<PreviewInfo, CommandError> {
        let id = self.create(url)?;
        let grant = self.get(&id)?;
        Ok(PreviewInfo {
            id,
            url: grant.url,
            kind: grant.kind,
            editor: None,
        })
    }
    pub(super) fn create_html(
        &self,
        source: String,
        html: String,
    ) -> Result<PreviewInfo, CommandError> {
        if html.len() > 2 * 1024 * 1024 {
            return Err(CommandError::Failed(
                "Local HTML preview exceeds 2 MiB".into(),
            ));
        }
        let mut grants = self
            .0
            .lock()
            .map_err(|e| CommandError::Failed(e.to_string()))?;
        grants.retain(|_, grant| grant.created.elapsed() < LIFETIME);
        let html_bytes: usize = grants
            .values()
            .map(|grant| match &grant.source {
                PreviewSource::Html(html) => html.len(),
                PreviewSource::File(_) => 0,
            })
            .sum();
        if grants.len() >= MAX_GRANTS || html_bytes + html.len() > 32 * 1024 * 1024 {
            return Err(CommandError::Failed("Too many active HTML previews".into()));
        }
        let id = format!(
            "{:032x}{:016x}",
            rand::random::<u128>(),
            rand::random::<u64>()
        );
        grants.insert(
            id.clone(),
            Grant {
                source: PreviewSource::Html(Arc::from(html)),
                url: source.clone(),
                kind: "html".into(),
                created: Instant::now(),
            },
        );
        Ok(PreviewInfo {
            id,
            url: source,
            kind: "html".into(),
            editor: None,
        })
    }
    pub(super) fn revoke_preview(&self, id: &str) -> Result<bool, CommandError> {
        self.revoke(id)
    }
}

// Dynamic isolated-world registration deliberately accepts exact origins only.
// Keep one source snapshot per editor and extend its origin list for active panes.
pub(crate) struct OfficePreviewWorld {
    package: tuffite::isolated::WorldDefinition,
    registration: tuffite::isolated::Registration,
    origins: std::collections::BTreeSet<String>,
}
impl Profile {
    pub(super) fn authorize_office_preview(&self, id: &str) -> Result<(), CommandError> {
        let grant = self.preview_grants.get(id)?;
        let extension = grant
            .file_path()?
            .extension()
            .unwrap_or_default()
            .to_string_lossy()
            .to_lowercase();
        let extension = if extension == "doc" {
            "docx"
        } else {
            &extension
        };
        let catalog = ovule_extensions::providers::catalog().map_err(CommandError::Failed)?;
        let Some(editor) = catalog
            .file_editors
            .iter()
            .find(|editor| editor.extensions.iter().any(|value| value == extension))
        else {
            return Ok(());
        };
        let name = format!("preview.{}", editor.extension_id);
        let origin = format!("ovule://{id}.local");
        let mut worlds = self
            .preview_worlds
            .lock()
            .map_err(|e| CommandError::Failed(e.to_string()))?;
        let (send, receive) = std::sync::mpsc::sync_channel(1);
        if let Some(world) = worlds.get_mut(&name) {
            world.origins.retain(|origin| {
                origin
                    .strip_prefix("ovule://")
                    .and_then(|value| value.strip_suffix(".local"))
                    .is_some_and(|id| self.preview_grants.get(id).is_ok())
            });
            if world.origins.len() >= 32 {
                return Err(CommandError::Failed(
                    "Too many active Office previews".into(),
                ));
            }
            let mut definition = world.package.clone().allow_origin(&origin);
            for allowed in &world.origins {
                definition = definition.allow_origin(allowed);
            }
            self.isolated
                .replace(&world.registration, definition, move |result| {
                    let _ = send.send(result);
                })
                .map_err(|e| CommandError::Failed(e.to_string()))?;
            world.registration = receive
                .recv_timeout(Duration::from_secs(10))
                .map_err(|e| CommandError::Failed(e.to_string()))?
                .map_err(|e| CommandError::Failed(e.to_string()))?;
            world.origins.insert(origin);
        } else {
            let package = ovule_extensions::providers::load_extensions()
                .map_err(|e| CommandError::Failed(e.to_string()))?
                .into_iter()
                .find(|package| package.manifest.id == editor.extension_id)
                .ok_or_else(|| CommandError::Failed("Office renderer is unavailable".into()))?;
            package
                .validate_web_assets()
                .map_err(|e| CommandError::Failed(e.to_string()))?;
            let ui = package
                .manifest
                .ui
                .as_ref()
                .ok_or_else(|| CommandError::Failed("Office renderer has no UI".into()))?;
            let entry = std::path::Path::new(&ui.entry);
            let snapshot = tuffite::isolated::WorldDefinition::from_directory(
                &name,
                package.root.join(entry.parent().unwrap()),
                entry.file_name().unwrap().to_string_lossy(),
            )
            .map_err(|e| CommandError::Failed(e.to_string()))?;
            self.isolated
                .register(snapshot.clone().allow_origin(&origin), move |result| {
                    let _ = send.send(result);
                })
                .map_err(|e| CommandError::Failed(e.to_string()))?;
            let registration = receive
                .recv_timeout(Duration::from_secs(10))
                .map_err(|e| CommandError::Failed(e.to_string()))?
                .map_err(|e| CommandError::Failed(e.to_string()))?;
            worlds.insert(
                name,
                OfficePreviewWorld {
                    package: snapshot,
                    registration,
                    origins: [origin].into(),
                },
            );
        }
        Ok(())
    }
    pub(super) fn revoke_office_preview(&self, id: &str) -> Result<(), CommandError> {
        let origin = format!("ovule://{id}.local");
        let mut worlds = self
            .preview_worlds
            .lock()
            .map_err(|e| CommandError::Failed(e.to_string()))?;
        let Some(name) = worlds
            .iter()
            .find_map(|(name, world)| world.origins.contains(&origin).then(|| name.clone()))
        else {
            return Ok(());
        };
        let world = worlds.get_mut(&name).expect("world was found");
        let (send, receive) = std::sync::mpsc::sync_channel(1);
        if world.origins.len() == 1 {
            self.isolated
                .unregister(&world.registration, move |result| {
                    let _ = send.send(result);
                })
                .map_err(|e| CommandError::Failed(e.to_string()))?;
            receive
                .recv_timeout(Duration::from_secs(10))
                .map_err(|e| CommandError::Failed(e.to_string()))?
                .map_err(|e| CommandError::Failed(e.to_string()))?;
            worlds.remove(&name);
        } else {
            let mut definition = world.package.clone();
            for allowed in world.origins.iter().filter(|allowed| **allowed != origin) {
                definition = definition.allow_origin(allowed);
            }
            let (updated_send, updated_receive) = std::sync::mpsc::sync_channel(1);
            self.isolated
                .replace(&world.registration, definition, move |result| {
                    let _ = updated_send.send(result);
                })
                .map_err(|e| CommandError::Failed(e.to_string()))?;
            world.registration = updated_receive
                .recv_timeout(Duration::from_secs(10))
                .map_err(|e| CommandError::Failed(e.to_string()))?
                .map_err(|e| CommandError::Failed(e.to_string()))?;
            world.origins.remove(&origin);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn grants_bind_files_and_revoke() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("a.md");
        std::fs::write(&path, "# test").unwrap();
        let url = url::Url::from_file_path(&path).unwrap().to_string();
        let grants = PreviewGrants::default();
        let first = grants.create_preview(&url).unwrap();
        let second = grants.create_preview(&url).unwrap();
        assert_ne!(first.id, second.id);
        assert_eq!(first.kind, "markdown");
        assert!(grants.get(&url).is_err());
        assert!(grants.get("forged").is_err());
        assert_eq!(
            grants.get(&first.id).unwrap().file_path().unwrap(),
            path.canonicalize().unwrap()
        );
        assert!(grants.revoke_preview(&first.id).unwrap());
        assert!(grants.get(&first.id).is_err());
        assert!(grants.get(&second.id).is_ok());
        assert!(grants.create_preview("https://example.com/a.md").is_err());
        assert!(
            grants
                .create_preview(url::Url::from_directory_path(dir.path()).unwrap().as_str())
                .is_err()
        );
        let expired = Instant::now().checked_add(LIFETIME).unwrap();
        assert!(grants.get_at(&second.id, expired).is_err());
    }
    #[test]
    fn html_snapshots_are_document_bound_and_bounded() {
        let grants = PreviewGrants::default();
        let one = grants
            .create_html("workspace/a.html".into(), "<h1>one</h1>".into())
            .unwrap();
        let two = grants
            .create_html("workspace/a.html".into(), "<h1>two</h1>".into())
            .unwrap();
        assert_ne!(one.id, two.id);
        assert!(
            matches!(&grants.get(&one.id).unwrap().source, PreviewSource::Html(html) if html.as_ref() == "<h1>one</h1>")
        );
        assert!(
            matches!(&grants.get(&two.id).unwrap().source, PreviewSource::Html(html) if html.as_ref() == "<h1>two</h1>")
        );
        assert!(grants.get("workspace/a.html").is_err());
        assert!(
            grants
                .create_html("large.html".into(), "x".repeat(2 * 1024 * 1024 + 1))
                .is_err()
        );
        grants.revoke_preview(&one.id).unwrap();
        assert!(grants.get(&one.id).is_err());
    }
    #[test]
    fn format_dispatch_is_bounded() {
        for (path, kind) in [
            ("a.doc", "office"),
            ("a.xlsx", "office"),
            ("a.pptx", "office"),
            ("a.YAML", "code"),
            ("a.SVG", "image"),
            ("a.md", "markdown"),
            ("a.zip", "unsupported"),
        ] {
            assert_eq!(preview_kind(std::path::Path::new(path)), kind);
        }
    }
}
