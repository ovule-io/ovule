use serde::{Deserialize, Serialize};

/// Persisted state owned by the terminal capability.
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub(super) struct TerminalState {
    #[serde(default)]
    pub(super) terminal_runs: Vec<TerminalRun>,
}

use super::{AppSnapshot, TerminalRun, TerminalSpec, Workspace, required, required_text};

impl Workspace {
    pub fn prepare_terminal_run(
        &mut self,
        thread_id: &str,
        command: &str,
        owner_id: Option<String>,
        workspace_binding_id: Option<String>,
        use_thread_workspace: bool,
    ) -> Result<TerminalSpec, String> {
        let command = required_text(command, "terminal command", 16_384)?;
        let owner_id = owner_id
            .map(|value| required(&value, "terminal owner ID"))
            .transpose()?;
        let thread = self
            .conversation
            .threads
            .iter()
            .find(|thread| thread.id == thread_id)
            .cloned()
            .ok_or_else(|| format!("unknown Thread: {thread_id}"))?;
        if workspace_binding_id.is_some() && use_thread_workspace {
            return Err(
                "Terminal cwd cannot select both a WorkspaceBinding and Thread Workspace"
                    .to_owned(),
            );
        }
        let (workspace_path, workspace_binding_id) = if let Some(binding_id) = workspace_binding_id
        {
            if !thread.workspace_binding_ids.contains(&binding_id) {
                return Err(format!(
                    "WorkspaceBinding {binding_id} is not attached to Thread {thread_id}"
                ));
            }
            let binding = self
                .workspace_binding(&binding_id)
                .ok_or_else(|| format!("unknown WorkspaceBinding: {binding_id}"))?;
            (binding.root, Some(binding.id))
        } else if use_thread_workspace {
            (thread.workspace_path, None)
        } else {
            (
                self.files.home_directory()?.to_string_lossy().into_owned(),
                None,
            )
        };
        let id = self.allocate_id("terminal");
        self.terminal.terminal_runs.push(TerminalRun {
            id: id.clone(),
            thread_id: thread_id.to_owned(),
            owner_id: owner_id.clone(),
            command: command.clone(),
            status: "queued".to_owned(),
            stdout: String::new(),
            stderr: String::new(),
            exit_code: None,
        });
        self.changed();
        Ok(TerminalSpec {
            id,
            owner_id,
            workspace_path,
            workspace_binding_id,
            command,
        })
    }

    pub fn start_terminal_run(&mut self, id: &str) -> Result<AppSnapshot, String> {
        let run = self.terminal_run_mut(id)?;
        if run.status != "queued" {
            return Err("only queued Terminal runs can start".to_owned());
        }
        "running".clone_into(&mut run.status);
        self.changed();
        Ok(self.snapshot())
    }

    pub fn request_terminal_cancel(&mut self, id: &str) -> Result<AppSnapshot, String> {
        let run = self.terminal_run_mut(id)?;
        if !matches!(run.status.as_str(), "queued" | "running") {
            return Err("Terminal run is not active".to_owned());
        }
        "cancelling".clone_into(&mut run.status);
        self.changed();
        Ok(self.snapshot())
    }

    pub fn finish_terminal_run(
        &mut self,
        id: &str,
        status: &str,
        stdout: String,
        stderr: String,
        exit_code: Option<i32>,
    ) -> Result<AppSnapshot, String> {
        if !matches!(status, "succeeded" | "failed" | "cancelled") {
            return Err(format!("invalid Terminal status: {status}"));
        }
        let run = self.terminal_run_mut(id)?;
        if !matches!(run.status.as_str(), "queued" | "running" | "cancelling") {
            return Err("Terminal run is already complete".to_owned());
        }
        status.clone_into(&mut run.status);
        run.stdout = stdout;
        run.stderr = stderr;
        run.exit_code = exit_code;
        self.changed();
        Ok(self.snapshot())
    }
}
