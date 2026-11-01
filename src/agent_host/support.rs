#![allow(clippy::wildcard_imports)]
use super::*;

pub(super) fn execution_prompt(
    spec: &AttemptSpec,
    message_blocks: &[MessageBlockContribution],
    file_editors: &[FileEditorContribution],
) -> String {
    let mut sections = Vec::new();
    sections.push(format!(
        include_str!("prompts/workspace-context.md"),
        thread_id = spec.thread_id,
        workspace_path = spec.workspace_path,
        workspaces = serde_json::to_string(&spec.workspaces).unwrap_or_default()
    ));
    if !spec.instructions.trim().is_empty() {
        sections.push(format!(
            include_str!("prompts/profile-instructions.md"),
            spec.instructions
        ));
    }
    if !spec.structured_goal && !message_blocks.is_empty() {
        sections.push(message_block_prompt(message_blocks));
    }
    if !spec.structured_goal && !file_editors.is_empty() {
        sections.push(file_editor_prompt(file_editors));
    }
    if !spec.local_images.is_empty() {
        sections.push(format!(
            include_str!("prompts/local-images.md"),
            spec.local_images
                .iter()
                .map(|image| format!(
                    "- {} ({}, {} bytes): {}",
                    image.name, image.media_type, image.size_bytes, image.path
                ))
                .collect::<Vec<_>>()
                .join("\n")
        ));
    }
    if !spec.structured_goal {
        sections.push(super::prompts::REPLY_STYLE.trim().to_owned());
    }
    sections.push(spec.prompt.clone());
    sections.join("\n\n")
}

pub(super) fn summarize_output(primary: &str, fallback: &str, default: &str) -> String {
    let text = if primary.trim().is_empty() {
        fallback
    } else {
        primary
    };
    let summary = text
        .lines()
        .rev()
        .find(|line| !line.trim().is_empty())
        .unwrap_or(default)
        .trim();
    let mut summary = summary.chars().take(2_000).collect::<String>();
    if summary.is_empty() {
        default.clone_into(&mut summary);
    }
    summary
}

pub(super) fn summarize_error(error: &processkit::Error) -> String {
    if error.is_cancelled() {
        return "Agent Worker was cancelled".to_owned();
    }
    let detail = error
        .diagnostic()
        .or_else(|| error.stderr())
        .or_else(|| error.stdout())
        .unwrap_or_default();
    let base = error.to_string();
    if detail.trim().is_empty() {
        base
    } else {
        format!(
            "{base}. {}",
            summarize_output(detail, "", "No diagnostic output")
        )
    }
}

pub(super) fn lock_workers(
    workers: &Mutex<HashMap<String, CancellationToken>>,
) -> std::sync::MutexGuard<'_, HashMap<String, CancellationToken>> {
    workers
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}
