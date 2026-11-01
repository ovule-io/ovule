use crate::runtime::Profile;

impl crate::shell_api::Browser for Profile {
    fn create_html_preview(
        &self,
        thread_id: String,
        path: String,
    ) -> Result<crate::shell_api::PreviewInfo, tuffite::CommandError> {
        let preview = self
            .service::<ovule_files::FilesService>()?
            .read_html(&thread_id, &path)
            .map_err(|error| match error {
                ovule_files::FileError::InvalidArgument(message) => {
                    tuffite::CommandError::InvalidArgument(message)
                }
                ovule_files::FileError::Filesystem(message) => {
                    tuffite::CommandError::Failed(message)
                }
            })?;
        self.preview_grants
            .create_html(preview.source, preview.html)
    }

    fn create_file_preview(
        &self,
        url: String,
    ) -> Result<crate::shell_api::PreviewInfo, tuffite::CommandError> {
        let info = self.preview_grants.create_preview(&url)?;
        if info.kind == "office"
            && let Err(error) = self.authorize_office_preview(&info.id)
        {
            let _ = self.preview_grants.revoke_preview(&info.id);
            return Err(error);
        }
        Ok(info)
    }
    fn revoke_preview(&self, id: String) -> Result<bool, tuffite::CommandError> {
        self.revoke_office_preview(&id)?;
        self.preview_grants.revoke_preview(&id)
    }

    fn read_local_file(
        &self,
        url: String,
    ) -> Result<crate::shell_api::WorkspaceFile, tuffite::CommandError> {
        let path = local_path(&url)?;
        let file = ovule_files::local::read_file(&path).map_err(tuffite::CommandError::Failed)?;
        Ok(crate::shell_api::WorkspaceFile {
            path: path.to_string_lossy().into_owned(),
            name: file.name,
            extension: file.extension,
            size_bytes: file.bytes.len().try_into().unwrap_or(i64::MAX),
            bytes: file.bytes,
        })
    }
    fn read_local_text(&self, url: String) -> Result<String, tuffite::CommandError> {
        ovule_files::local::read_text(&local_path(&url)?).map_err(tuffite::CommandError::Failed)
    }
    fn list_local_directory(
        &self,
        url: String,
    ) -> Result<Vec<crate::shell_api::LocalFileEntry>, tuffite::CommandError> {
        ovule_files::local::list_directory(&local_path(&url)?)
            .map_err(tuffite::CommandError::Failed)?
            .into_iter()
            .map(|entry| {
                let url = if entry.is_directory {
                    url::Url::from_directory_path(&entry.path)
                } else {
                    url::Url::from_file_path(&entry.path)
                }
                .map_err(|()| tuffite::CommandError::Failed("Invalid local entry path".into()))?;
                Ok(crate::shell_api::LocalFileEntry {
                    name: entry.name,
                    url: url.into(),
                    is_directory: entry.is_directory,
                })
            })
            .collect()
    }
    fn list_downloads(&self) -> Result<Vec<crate::shell_api::DownloadView>, tuffite::CommandError> {
        self.service::<ovule_browser::downloads::DownloadsRuntime>()?
            .list()
            .map(|rows| rows.into_iter().map(download).collect())
            .map_err(tuffite::CommandError::Failed)
    }
    fn publish_download(
        &self,
        path: String,
        url: String,
    ) -> Result<crate::shell_api::DownloadView, tuffite::CommandError> {
        self.service::<ovule_browser::downloads::DownloadsRuntime>()?
            .publish_owned(std::path::Path::new(&path), &url)
            .map(download)
            .map_err(tuffite::CommandError::Failed)
    }
    fn download_directory(&self) -> Result<String, tuffite::CommandError> {
        self.service::<ovule_browser::downloads::DownloadsRuntime>()?
            .directory()
            .map(|path| path.to_string_lossy().into_owned())
            .map_err(tuffite::CommandError::Failed)
    }
    fn set_download_directory(&self, path: String) -> Result<String, tuffite::CommandError> {
        self.service::<ovule_browser::downloads::DownloadsRuntime>()?
            .set_directory(&path)
            .map(|path| path.to_string_lossy().into_owned())
            .map_err(tuffite::CommandError::Failed)
    }
    fn remove_download(&self, id: String) -> Result<bool, tuffite::CommandError> {
        self.service::<ovule_browser::downloads::DownloadsRuntime>()?
            .remove(&id)
            .map_err(tuffite::CommandError::Failed)
    }
    fn reveal_local_file(&self, url: String) -> Result<bool, tuffite::CommandError> {
        let path = local_path(&url)?
            .canonicalize()
            .map_err(|error| tuffite::CommandError::Failed(error.to_string()))?;
        reveal_local_path(&path)
    }
    fn reveal_download(&self, id: String) -> Result<bool, tuffite::CommandError> {
        let path = self
            .service::<ovule_browser::downloads::DownloadsRuntime>()?
            .path(&id)
            .map_err(tuffite::CommandError::Failed)?;
        if !path.is_file() {
            return Err(tuffite::CommandError::Failed(
                "Downloaded file is no longer available".into(),
            ));
        }
        reveal_local_path(&path)
    }
    fn respond(
        &self,
        request_id: String,
        result_json: String,
    ) -> Result<bool, tuffite::CommandError> {
        self.service::<ovule_browser::BrowserRuntime>()?
            .respond(&request_id, &result_json)
            .map_err(tuffite::CommandError::Failed)
    }
}

pub(super) fn local_path(value: &str) -> Result<std::path::PathBuf, tuffite::CommandError> {
    url::Url::parse(value)
        .ok()
        .filter(|url| url.scheme() == "file" && url.query().is_none() && url.fragment().is_none())
        .and_then(|url| url.to_file_path().ok())
        .ok_or_else(|| tuffite::CommandError::InvalidArgument("Expected a local file URL".into()))
}

fn download(value: ovule_browser::downloads::Download) -> crate::shell_api::DownloadView {
    crate::shell_api::DownloadView {
        id: value.id,
        source: value.source,
        path: value.path,
        filename: value.filename,
        url: value.url,
        bytes: value.bytes,
        created_at: value.created_at,
        removed: value.removed,
    }
}

fn reveal_local_path(path: &std::path::Path) -> Result<bool, tuffite::CommandError> {
    #[cfg(target_os = "macos")]
    let mut command = {
        let mut value = std::process::Command::new("open");
        value.arg("-R").arg(path);
        value
    };
    #[cfg(target_os = "windows")]
    let mut command = {
        let mut value = std::process::Command::new("explorer.exe");
        value.arg(format!("/select,{}", path.display()));
        value
    };
    command
        .status()
        .map(|status| status.success())
        .map_err(|error| tuffite::CommandError::Failed(error.to_string()))
}
