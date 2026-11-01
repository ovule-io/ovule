use super::{Attempt, Goal, Node, TerminalRun, Workspace};

impl Workspace {
    pub fn resolve_workspace_file(
        &self,
        thread_id: &str,
        value: &str,
        extensions: &[&str],
        must_exist: bool,
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
            return Err("file path is required".to_owned());
        }
        let path = std::path::PathBuf::from(input);
        let is_absolute = path.is_absolute();
        let candidate = if is_absolute { path } else { root.join(path) };
        let extension = candidate
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase();
        if !extensions.contains(&extension.as_str()) {
            return Err(format!(
                "file extension must be one of: {}",
                extensions.join(", ")
            ));
        }
        let resolved = if self.files.exists(&candidate) {
            self.files
                .canonicalize(&candidate)
                .map_err(|error| format!("resolve file {}: {error}", candidate.display()))?
        } else {
            if must_exist {
                return Err(format!("file does not exist: {}", candidate.display()));
            }
            let parent = candidate
                .parent()
                .ok_or_else(|| "file has no parent directory".to_owned())?;
            let parent = self
                .files
                .canonicalize(parent)
                .map_err(|error| format!("resolve file parent {}: {error}", parent.display()))?;
            parent.join(
                candidate
                    .file_name()
                    .ok_or_else(|| "file name is missing".to_owned())?,
            )
        };
        if !is_absolute && !resolved.starts_with(&root) {
            return Err("file must stay inside the Thread workspace".to_owned());
        }
        Ok(resolved)
    }

    pub fn allocate_id(&mut self, prefix: &str) -> String {
        let id = format!("{prefix}-{:04}", self.next_id);
        self.next_id += 1;
        id
    }

    pub fn changed(&mut self) {
        self.revision += 1;
    }

    pub fn goal(&self, goal_id: &str) -> Result<&Goal, String> {
        self.workflow
            .goals
            .iter()
            .find(|goal| goal.id == goal_id)
            .ok_or_else(|| format!("unknown Goal: {goal_id}"))
    }

    pub fn default_agent_for_goal(&self, goal_id: &str) -> Result<&str, String> {
        let goal = self.goal(goal_id)?;
        self.conversation
            .threads
            .iter()
            .find(|thread| thread.id == goal.thread_id)
            .map(|thread| thread.agent.as_str())
            .ok_or_else(|| format!("Goal {} has no Thread", goal.id))
    }

    pub fn require_available_agent(&self, agent_id: &str) -> Result<(), String> {
        self.settings.catalog.resolve_agent(agent_id).map(|_| ())
    }

    pub fn require_agent_for_thread(&self, thread_id: &str, agent_id: &str) -> Result<(), String> {
        self.resolve_agent_for_thread(thread_id, agent_id)
            .map(|_| ())
    }

    pub fn resolve_agent_for_thread(
        &self,
        thread_id: &str,
        agent_id: &str,
    ) -> Result<crate::state::settings::ResolvedAgent, String> {
        let thread = self
            .conversation
            .threads
            .iter()
            .find(|thread| thread.id == thread_id)
            .ok_or_else(|| format!("unknown Thread: {thread_id}"))?;
        self.resolve_agent_for_host(&thread.host_id, agent_id)
    }

    pub fn resolve_agent_for_host(
        &self,
        host_id: &str,
        agent_id: &str,
    ) -> Result<crate::state::settings::ResolvedAgent, String> {
        if host_id == "local" {
            return self.settings.catalog.resolve_agent(agent_id);
        }
        let host = self
            .hosts
            .endpoints
            .iter()
            .find(|host| host.id == host_id)
            .ok_or_else(|| format!("unknown Host: {host_id}"))?;
        match self
            .settings
            .catalog
            .resolve_agent_for_target(agent_id, true)
        {
            Ok(agent) if host.agent_ids.contains(&agent.driver) => Ok(agent),
            Ok(agent) => Err(format!(
                "Agent {} is not granted on Host {}",
                agent.id, host.display_name
            )),
            Err(_) if host.agent_ids.iter().any(|driver| driver == agent_id) => {
                Ok(crate::state::settings::ResolvedAgent {
                    id: agent_id.to_owned(),
                    driver: agent_id.to_owned(),
                    model: None,
                    skills: Vec::new(),
                    tools: Vec::new(),
                    instructions: String::new(),
                })
            }
            Err(error) => Err(error),
        }
    }

    pub fn attempt_mut(&mut self, attempt_id: &str) -> Result<&mut Attempt, String> {
        self.conversation
            .attempts
            .iter_mut()
            .find(|attempt| attempt.id == attempt_id)
            .ok_or_else(|| format!("unknown Attempt: {attempt_id}"))
    }

    pub fn terminal_run_mut(&mut self, id: &str) -> Result<&mut TerminalRun, String> {
        self.terminal
            .terminal_runs
            .iter_mut()
            .find(|run| run.id == id)
            .ok_or_else(|| format!("unknown Terminal run: {id}"))
    }

    pub fn update_goal_progress(&mut self, goal_id: &str) {
        let nodes: Vec<&Node> = self
            .workflow
            .nodes
            .iter()
            .filter(|node| node.goal_id == goal_id && node.status != "superseded")
            .collect();
        let complete = nodes
            .iter()
            .filter(|node| matches!(node.status.as_str(), "succeeded" | "approved"))
            .count();
        let waiting = nodes.iter().filter(|node| node.status == "waiting").count();
        if let Some(goal) = self
            .workflow
            .goals
            .iter_mut()
            .find(|goal| goal.id == goal_id)
        {
            goal.progress = format!(
                "{complete}/{} nodes complete · {waiting} gates waiting",
                nodes.len()
            );
            if nodes.iter().any(|node| {
                matches!(
                    node.status.as_str(),
                    "failed" | "cancelled" | "blocked" | "rejected"
                )
            }) {
                "blocked".clone_into(&mut goal.status);
            } else if nodes
                .iter()
                .any(|node| matches!(node.status.as_str(), "running" | "cancelling"))
            {
                "running".clone_into(&mut goal.status);
            } else if !nodes.is_empty()
                && nodes
                    .iter()
                    .all(|node| matches!(node.status.as_str(), "succeeded" | "approved"))
            {
                "succeeded".clone_into(&mut goal.status);
            } else {
                "active".clone_into(&mut goal.status);
            }
        }
    }
}
