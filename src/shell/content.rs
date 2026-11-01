use tuffite::CommandError;

use crate::runtime::App;
use crate::shell_api::{HtmlPreview, MarkdownDocument, WorkspaceFile};
use ovule_files::{FileError, HtmlContent, TextDocument, WorkspaceFileContent};

fn map_html(content: HtmlContent) -> HtmlPreview {
    HtmlPreview {
        source: content.source,
        html: content.html,
    }
}

fn map_markdown(document: TextDocument) -> MarkdownDocument {
    MarkdownDocument {
        path: document.path,
        content: document.content,
    }
}

fn map_workspace_file(file: WorkspaceFileContent) -> WorkspaceFile {
    WorkspaceFile {
        path: file.path,
        name: file.name,
        extension: file.extension,
        size_bytes: i64::try_from(file.bytes.len()).unwrap_or(i64::MAX),
        bytes: file.bytes,
    }
}

fn map_content_error(error: FileError) -> CommandError {
    match error {
        FileError::InvalidArgument(message) => CommandError::InvalidArgument(message),
        FileError::Filesystem(message) => CommandError::Failed(message),
    }
}

impl crate::shell_api::Content for App {
    fn read_html_preview(
        &self,
        thread_id: String,
        path: String,
    ) -> Result<HtmlPreview, CommandError> {
        self.service::<ovule_files::FilesService>()?
            .read_html(&thread_id, &path)
            .map(map_html)
            .map_err(map_content_error)
    }

    fn read_markdown(
        &self,
        thread_id: String,
        path: String,
    ) -> Result<MarkdownDocument, CommandError> {
        self.service::<ovule_files::FilesService>()?
            .read_markdown(&thread_id, &path)
            .map(map_markdown)
            .map_err(map_content_error)
    }

    fn save_markdown(
        &self,
        thread_id: String,
        path: String,
        content: String,
    ) -> Result<MarkdownDocument, CommandError> {
        self.service::<ovule_files::FilesService>()?
            .save_markdown(&thread_id, &path, content)
            .map(map_markdown)
            .map_err(map_content_error)
    }

    fn read_workspace_file(
        &self,
        thread_id: String,
        path: String,
    ) -> Result<WorkspaceFile, CommandError> {
        self.service::<ovule_files::FilesService>()?
            .read_workspace_file(&thread_id, &path)
            .map(map_workspace_file)
            .map_err(map_content_error)
    }

    fn save_workspace_file(
        &self,
        thread_id: String,
        path: String,
        bytes: Vec<u8>,
    ) -> Result<WorkspaceFile, CommandError> {
        self.service::<ovule_files::FilesService>()?
            .save_workspace_file(&thread_id, &path, bytes)
            .map(map_workspace_file)
            .map_err(map_content_error)
    }
}
