//! Files consumer contracts and domain implementation.
use ovule_platform as platform;
pub mod local;
use ovule_workspace as workspace;
pub use ovule_workspace::state;

use std::path::Path;
use std::sync::Arc;

use crate::workspace::WorkspaceSession;

/// Reads and writes files on the Host that owns the selected Workspace binding.
pub trait BoundWorkspaceFiles: Send + Sync {
    fn read(&self, binding_id: &str, root: &str, relative: &str) -> Result<Vec<u8>, String>;
    fn write(
        &self,
        binding_id: &str,
        root: &str,
        relative: &str,
        bytes: &[u8],
    ) -> Result<(), String>;
}

const MAX_TEXT_BYTES: usize = 2 * 1024 * 1024;
const MAX_WORKSPACE_FILE_BYTES: u64 = 12 * 1024 * 1024;

pub trait WorkspaceFiles: Send + Sync {
    fn read_text(&self, path: &Path) -> Result<String, String>;
    fn read_bytes(&self, path: &Path) -> Result<Vec<u8>, String>;
    fn size(&self, path: &Path) -> Result<u64, String>;
    fn atomic_write(&self, path: &Path, bytes: &[u8]) -> Result<(), String>;
}

#[derive(Debug)]
pub enum FileError {
    InvalidArgument(String),
    Filesystem(String),
}

pub struct HtmlContent {
    pub source: String,
    pub html: String,
}

pub struct TextDocument {
    pub path: String,
    pub content: String,
}

pub struct WorkspaceFileContent {
    pub path: String,
    pub name: String,
    pub extension: String,
    pub bytes: Vec<u8>,
}

struct NativeFilesService {
    state: Arc<WorkspaceSession>,
    files: Arc<dyn WorkspaceFiles>,
    transports: Arc<dyn BoundWorkspaceFiles>,
}

impl NativeFilesService {
    #[must_use]
    pub fn new(
        state: Arc<WorkspaceSession>,
        files: Arc<dyn WorkspaceFiles>,
        transports: Arc<dyn BoundWorkspaceFiles>,
    ) -> Self {
        Self {
            state,
            files,
            transports,
        }
    }

    pub fn read_html(&self, thread_id: &str, path: &str) -> Result<HtmlContent, FileError> {
        if let Some(binding) = self.selected_binding(thread_id, path)? {
            ensure_extension(&binding.relative, &["html", "htm"], "HTML preview")?;
            let bytes = self.read_bound(&binding)?;
            let html = String::from_utf8(bytes)
                .map_err(|_| FileError::Filesystem("Workspace HTML is not UTF-8".to_owned()))?;
            ensure_text_size(&html, "HTML preview")?;
            return Ok(HtmlContent {
                source: binding.display_path,
                html,
            });
        }
        let resolved = self
            .state
            .read(|workspace| workspace.resolve_html_preview(thread_id, path))
            .map_err(FileError::InvalidArgument)?;
        let html = self
            .files
            .read_text(&resolved)
            .map_err(|error| FileError::Filesystem(format!("read HTML preview: {error}")))?;
        ensure_text_size(&html, "HTML preview")?;
        Ok(HtmlContent {
            source: resolved.to_string_lossy().into_owned(),
            html,
        })
    }

    pub fn read_markdown(&self, thread_id: &str, path: &str) -> Result<TextDocument, FileError> {
        if let Some(skill_id) = path.strip_prefix("skill:") {
            let resolved = self
                .state
                .read(|workspace| workspace.enabled_skill_path(skill_id))
                .map_err(FileError::InvalidArgument)?;
            let content = self
                .files
                .read_text(std::path::Path::new(&resolved))
                .map_err(|error| FileError::Filesystem(format!("read Skill: {error}")))?;
            ensure_text_size(&content, "Skill")?;
            return Ok(TextDocument {
                path: path.to_owned(),
                content,
            });
        }
        if let Some(binding) = self.selected_binding(thread_id, path)? {
            ensure_extension(&binding.relative, &["md", "markdown"], "Markdown")?;
            let bytes = self.read_bound(&binding)?;
            let content = String::from_utf8(bytes)
                .map_err(|_| FileError::Filesystem("Workspace Markdown is not UTF-8".to_owned()))?;
            ensure_text_size(&content, "Markdown")?;
            return Ok(TextDocument {
                path: binding.display_path,
                content,
            });
        }
        let resolved = self
            .state
            .read(|workspace| workspace.resolve_markdown(thread_id, path, true))
            .map_err(FileError::InvalidArgument)?;
        let content = self
            .files
            .read_text(&resolved)
            .map_err(|error| FileError::Filesystem(format!("read Markdown: {error}")))?;
        ensure_text_size(&content, "Markdown")?;
        Ok(text_document(&resolved, content))
    }

    pub fn save_markdown(
        &self,
        thread_id: &str,
        path: &str,
        content: String,
    ) -> Result<TextDocument, FileError> {
        ensure_text_size(&content, "Markdown")?;
        if let Some(binding) = self.selected_binding(thread_id, path)? {
            ensure_extension(&binding.relative, &["md", "markdown"], "Markdown")?;
            self.write_bound(&binding, content.as_bytes())?;
            return Ok(TextDocument {
                path: binding.display_path,
                content,
            });
        }
        let resolved = self
            .state
            .read(|workspace| workspace.resolve_markdown(thread_id, path, false))
            .map_err(FileError::InvalidArgument)?;
        self.files
            .atomic_write(&resolved, content.as_bytes())
            .map_err(|error| FileError::Filesystem(format!("save Markdown: {error}")))?;
        Ok(text_document(&resolved, content))
    }

    pub fn read_workspace_file(
        &self,
        thread_id: &str,
        path: &str,
    ) -> Result<WorkspaceFileContent, FileError> {
        if let Some(binding) = self.selected_binding(thread_id, path)? {
            ensure_extension(
                &binding.relative,
                &[
                    "csv", "docx", "dotx", "gif", "jpeg", "jpg", "pdf", "png", "webp", "xlsx",
                    "xlsm", "pptx", "pptm", "ppsx",
                ],
                "Workspace asset",
            )?;
            let bytes = self.read_bound(&binding)?;
            ensure_workspace_file_size(u64::try_from(bytes.len()).unwrap_or(u64::MAX))?;
            return workspace_file_content(Path::new(&binding.display_path), bytes);
        }
        let resolved = self
            .state
            .read(|workspace| workspace.resolve_workspace_asset(thread_id, path, true))
            .map_err(FileError::InvalidArgument)?;
        let size = self.files.size(&resolved).map_err(|error| {
            FileError::Filesystem(format!("read Workspace asset metadata: {error}"))
        })?;
        ensure_workspace_file_size(size)?;
        let bytes = self
            .files
            .read_bytes(&resolved)
            .map_err(|error| FileError::Filesystem(format!("read Workspace asset: {error}")))?;
        workspace_file_content(&resolved, bytes)
    }

    pub fn save_workspace_file(
        &self,
        thread_id: &str,
        path: &str,
        bytes: Vec<u8>,
    ) -> Result<WorkspaceFileContent, FileError> {
        ensure_workspace_file_size(u64::try_from(bytes.len()).unwrap_or(u64::MAX))?;
        if let Some(binding) = self.selected_binding(thread_id, path)? {
            ensure_extension(&binding.relative, &["csv", "xlsx"], "editable Office file")?;
            self.write_bound(&binding, &bytes)?;
            return workspace_file_content(Path::new(&binding.display_path), bytes);
        }
        let resolved = self
            .state
            .read(|workspace| workspace.resolve_editable_office_file(thread_id, path, false))
            .map_err(FileError::InvalidArgument)?;
        self.files
            .atomic_write(&resolved, &bytes)
            .map_err(|error| FileError::Filesystem(format!("save Office file: {error}")))?;
        workspace_file_content(&resolved, bytes)
    }

    fn selected_binding(
        &self,
        thread_id: &str,
        path: &str,
    ) -> Result<Option<SelectedBinding>, FileError> {
        self.state.read(|workspace| {
            let snapshot = workspace.snapshot();
            let thread = snapshot
                .threads
                .iter()
                .find(|thread| thread.id == thread_id)
                .ok_or_else(|| {
                    FileError::InvalidArgument(format!("unknown Thread: {thread_id}"))
                })?;
            let bindings = thread
                .workspace_binding_ids
                .iter()
                .filter_map(|id| snapshot.bindings.iter().find(|binding| &binding.id == id))
                .collect::<Vec<_>>();
            if bindings.is_empty() || path.starts_with("file:") {
                return Ok(None);
            }
            let input = normalize_workspace_path(path);
            let absolute = is_absolute_workspace_path(&input);
            let selected = if absolute {
                bindings
                    .iter()
                    .filter_map(|binding| {
                        let root = normalize_workspace_path(&binding.root);
                        strip_workspace_root(&input, &root)
                            .map(|relative| (*binding, relative, root.len()))
                    })
                    .max_by_key(|(_, _, root_length)| *root_length)
                    .map(|(binding, relative, _)| (binding, relative))
                    .ok_or_else(|| {
                        FileError::InvalidArgument(
                            "absolute file path is outside the selected Workspaces".to_owned(),
                        )
                    })?
            } else {
                (bindings[0], input)
            };
            Ok(Some(SelectedBinding {
                id: selected.0.id.clone(),
                root: selected.0.root.clone(),
                display_path: join_workspace_path(&selected.0.root, &selected.1),
                relative: selected.1,
            }))
        })
    }

    fn read_bound(&self, binding: &SelectedBinding) -> Result<Vec<u8>, FileError> {
        self.transports
            .read(&binding.id, &binding.root, &binding.relative)
            .map_err(FileError::Filesystem)
    }
    fn write_bound(&self, binding: &SelectedBinding, bytes: &[u8]) -> Result<(), FileError> {
        self.transports
            .write(&binding.id, &binding.root, &binding.relative, bytes)
            .map_err(FileError::Filesystem)
    }
}

struct SelectedBinding {
    id: String,
    root: String,
    relative: String,
    display_path: String,
}

fn normalize_workspace_path(value: &str) -> String {
    let normalized = value
        .trim()
        .replace('\\', "/")
        .trim_end_matches('/')
        .to_owned();
    if normalized.is_empty() && value.trim().starts_with('/') {
        "/".to_owned()
    } else {
        normalized
    }
}

fn is_absolute_workspace_path(value: &str) -> bool {
    value.starts_with('/') || value.starts_with("//") || value.as_bytes().get(1) == Some(&b':')
}

fn strip_workspace_root(path: &str, root: &str) -> Option<String> {
    if root == "/" && path.starts_with('/') {
        return Some(path.trim_start_matches('/').to_owned());
    }
    let windows = root.as_bytes().get(1) == Some(&b':') || root.starts_with("//");
    let matches = if windows {
        path.eq_ignore_ascii_case(root)
            || path
                .get(..root.len())
                .is_some_and(|prefix| prefix.eq_ignore_ascii_case(root))
                && path.as_bytes().get(root.len()) == Some(&b'/')
    } else {
        path == root
            || path
                .strip_prefix(root)
                .is_some_and(|suffix| suffix.starts_with('/'))
    };
    matches.then(|| path[root.len()..].trim_start_matches('/').to_owned())
}

fn join_workspace_path(root: &str, relative: &str) -> String {
    if relative.is_empty() {
        root.to_owned()
    } else {
        format!("{}/{}", root.trim_end_matches(['/', '\\']), relative)
    }
}

fn ensure_extension(path: &str, allowed: &[&str], label: &str) -> Result<(), FileError> {
    let extension = Path::new(path)
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase);
    if extension
        .as_deref()
        .is_some_and(|value| allowed.contains(&value))
    {
        Ok(())
    } else {
        Err(FileError::InvalidArgument(format!(
            "{label} has an unsupported file extension"
        )))
    }
}

fn ensure_text_size(content: &str, label: &str) -> Result<(), FileError> {
    if content.len() > MAX_TEXT_BYTES {
        return Err(FileError::InvalidArgument(format!(
            "{label} exceeds the 2 MiB limit"
        )));
    }
    Ok(())
}

fn ensure_workspace_file_size(size: u64) -> Result<(), FileError> {
    if size > MAX_WORKSPACE_FILE_BYTES {
        return Err(FileError::InvalidArgument(
            "Office file exceeds the 12 MiB limit".to_owned(),
        ));
    }
    Ok(())
}

fn text_document(path: &Path, content: String) -> TextDocument {
    TextDocument {
        path: path.to_string_lossy().into_owned(),
        content,
    }
}

fn workspace_file_content(path: &Path, bytes: Vec<u8>) -> Result<WorkspaceFileContent, FileError> {
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| FileError::InvalidArgument("Workspace file name is invalid".to_owned()))?;
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    Ok(WorkspaceFileContent {
        path: path.to_string_lossy().into_owned(),
        name: name.to_owned(),
        extension,
        bytes,
    })
}

use tuffite_ioc::Service;

pub use executor::{FileExecutor, FileExecutorService};
mod executor;
mod transport_files;

pub mod providers {
    use super::{Arc, FilesService, NativeFilesService, Service, WorkspaceFiles, native_files};
    pub fn register<C: Send + Sync + 'static>(
        registrar: &mut impl tuffite_ioc::Registrar<C>,
    ) -> tuffite_ioc::Result<()> {
        registrar.register(tuffite_ioc::factory::<FilesService, _, _>(|deps| {
            Ok(Arc::new(NativeFilesService::new(
                deps.depends_on::<Service<crate::workspace::WorkspaceSession>>()?,
                deps.depends_on::<Service<dyn crate::WorkspaceFiles>>()?,
                deps.depends_on::<Service<dyn crate::BoundWorkspaceFiles>>()?,
            )))
        }))?;

        Ok(())
    }
    /// Register file adapters independently from the content consumer.
    pub fn register_host<C: Send + Sync + 'static>(
        registrar: &mut impl tuffite_ioc::Registrar<C>,
    ) -> tuffite_ioc::Result<()> {
        registrar.register(tuffite_ioc::factory::<Service<dyn WorkspaceFiles>, _, _>(
            |_| Ok(native_files()),
        ))?;
        registrar.register(tuffite_ioc::factory::<
            Service<dyn super::BoundWorkspaceFiles>,
            _,
            _,
        >(|deps| {
            let owner = deps.depends_on::<super::FileExecutorService>()?;
            Ok(Arc::new(super::transport_files::TransportFiles::new(
                deps.depends_on::<Service<dyn ovule_hosts::WorkspaceTransportResolver>>()?,
                owner.handle()?,
            )))
        }))?;

        Ok(())
    }
    pub fn register_runtime<C: Send + Sync + 'static>(
        registrar: &mut impl tuffite_ioc::Registrar<C>,
    ) -> tuffite_ioc::Result<()> {
        registrar.register_eager(tuffite_ioc::factory::<super::FileExecutorService, _, _>(
            |_| Ok(Arc::new(super::FileExecutor::new()?)),
        ))?;

        Ok(())
    }
    #[must_use]
    pub fn native_files() -> Arc<dyn WorkspaceFiles> {
        Arc::new(native_files::NativeWorkspaceFiles)
    }
}

mod native_files;

pub trait Files: Send + Sync {
    fn read_html(&self, thread_id: &str, path: &str) -> Result<HtmlContent, FileError>;
    fn read_markdown(&self, thread_id: &str, path: &str) -> Result<TextDocument, FileError>;
    fn save_markdown(
        &self,
        thread_id: &str,
        path: &str,
        content: String,
    ) -> Result<TextDocument, FileError>;
    fn read_workspace_file(
        &self,
        thread_id: &str,
        path: &str,
    ) -> Result<WorkspaceFileContent, FileError>;
    fn save_workspace_file(
        &self,
        thread_id: &str,
        path: &str,
        bytes: Vec<u8>,
    ) -> Result<WorkspaceFileContent, FileError>;
}

/// Typed identity consumed by shells and domain factories.
pub type FilesService = tuffite_ioc::Service<dyn Files>;

impl Files for NativeFilesService {
    fn read_html(&self, thread_id: &str, path: &str) -> Result<HtmlContent, FileError> {
        NativeFilesService::read_html(self, thread_id, path)
    }
    fn read_markdown(&self, thread_id: &str, path: &str) -> Result<TextDocument, FileError> {
        NativeFilesService::read_markdown(self, thread_id, path)
    }
    fn save_markdown(
        &self,
        thread_id: &str,
        path: &str,
        content: String,
    ) -> Result<TextDocument, FileError> {
        NativeFilesService::save_markdown(self, thread_id, path, content)
    }
    fn read_workspace_file(
        &self,
        thread_id: &str,
        path: &str,
    ) -> Result<WorkspaceFileContent, FileError> {
        NativeFilesService::read_workspace_file(self, thread_id, path)
    }
    fn save_workspace_file(
        &self,
        thread_id: &str,
        path: &str,
        bytes: Vec<u8>,
    ) -> Result<WorkspaceFileContent, FileError> {
        NativeFilesService::save_workspace_file(self, thread_id, path, bytes)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn absolute_paths_route_to_the_longest_workspace_root() {
        assert_eq!(normalize_workspace_path("/"), "/");
        assert_eq!(
            strip_workspace_root("/srv/project/docs/readme.md", "/srv/project").as_deref(),
            Some("docs/readme.md")
        );
        assert_eq!(
            strip_workspace_root("/srv/project-old/readme.md", "/srv/project"),
            None
        );
        assert_eq!(
            strip_workspace_root("/srv/project/readme.md", "/").as_deref(),
            Some("srv/project/readme.md")
        );
    }

    #[test]
    fn windows_workspace_roots_are_case_insensitive() {
        assert_eq!(
            strip_workspace_root("C:/Work/Project/README.md", "c:/work/project").as_deref(),
            Some("README.md")
        );
        assert!(is_absolute_workspace_path("C:/work/project"));
        assert!(is_absolute_workspace_path("//server/share/project"));
    }

    #[test]
    fn content_extension_checks_are_case_insensitive() {
        assert!(ensure_extension("README.MD", &["md", "markdown"], "Markdown").is_ok());
        assert!(ensure_extension("README.txt", &["md", "markdown"], "Markdown").is_err());
    }
}
