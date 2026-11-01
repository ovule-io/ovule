use super::Workspace;

impl Workspace {
    pub fn resolve_html_preview(
        &self,
        thread_id: &str,
        value: &str,
    ) -> Result<std::path::PathBuf, String> {
        let thread = self
            .conversation
            .threads
            .iter()
            .find(|thread| thread.id == thread_id)
            .ok_or_else(|| format!("unknown Thread: {thread_id}"))?;
        let root = self
            .files
            .canonicalize(std::path::Path::new(&thread.workspace_path))
            .map_err(|error| format!("resolve Thread workspace: {error}"))?;
        let input = value.trim();
        if input.is_empty() {
            return Err("HTML preview path is required".to_owned());
        }
        let candidate = if input.starts_with("file:") {
            url::Url::parse(input)
                .map_err(|error| format!("parse local preview URL: {error}"))?
                .to_file_path()
                .map_err(|()| "local preview URL is invalid".to_owned())?
        } else {
            let path = std::path::PathBuf::from(input);
            if path.is_absolute() {
                path
            } else {
                root.join(path)
            }
        };
        let canonical = self
            .files
            .canonicalize(&candidate)
            .map_err(|error| format!("resolve local preview {}: {error}", candidate.display()))?;
        if !canonical.starts_with(&root) {
            return Err("local preview must stay inside the Thread workspace".to_owned());
        }
        if !self.files.is_file(&canonical)
            || !matches!(
                canonical.extension().and_then(|value| value.to_str()),
                Some("html" | "htm")
            )
        {
            return Err("local preview must be an HTML file".to_owned());
        }
        Ok(canonical)
    }

    pub fn resolve_markdown(
        &self,
        thread_id: &str,
        value: &str,
        must_exist: bool,
    ) -> Result<std::path::PathBuf, String> {
        self.resolve_workspace_file(thread_id, value, &["md", "markdown"], must_exist)
    }

    #[allow(dead_code)]
    pub fn resolve_office_file(
        &self,
        thread_id: &str,
        value: &str,
        must_exist: bool,
    ) -> Result<std::path::PathBuf, String> {
        self.resolve_workspace_file(
            thread_id,
            value,
            &[
                "csv", "docx", "dotx", "pdf", "xlsx", "xlsm", "pptx", "pptm", "ppsx",
            ],
            must_exist,
        )
    }

    pub fn resolve_workspace_asset(
        &self,
        thread_id: &str,
        value: &str,
        must_exist: bool,
    ) -> Result<std::path::PathBuf, String> {
        self.resolve_workspace_file(
            thread_id,
            value,
            &[
                "csv", "docx", "dotx", "gif", "jpeg", "jpg", "pdf", "png", "webp", "xlsx", "xlsm",
                "pptx", "pptm", "ppsx",
            ],
            must_exist,
        )
    }

    pub fn resolve_editable_office_file(
        &self,
        thread_id: &str,
        value: &str,
        must_exist: bool,
    ) -> Result<std::path::PathBuf, String> {
        self.resolve_workspace_file(thread_id, value, &["csv", "xlsx"], must_exist)
    }
}
