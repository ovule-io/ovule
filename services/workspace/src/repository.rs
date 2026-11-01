use crate::channel_repository::ChannelRepository;
use crate::state::Workspace;

/// The state service depends only on atomic workspace commits.
pub trait WorkspaceRepository: Send {
    fn load(&self) -> Result<Option<Workspace>, String>;
    fn commit(
        &mut self,
        workspace: &Workspace,
        kind: &str,
        subject_id: Option<&str>,
        payload: &serde_json::Value,
    ) -> Result<(), String>;
    /// A durable backend may enqueue a reply in the same transaction as completion.
    fn commit_attempt_completion(
        &mut self,
        workspace: &Workspace,
        kind: &str,
        attempt_id: &str,
        payload: &serde_json::Value,
        _body: &str,
    ) -> Result<(), String> {
        self.commit(workspace, kind, Some(attempt_id), payload)
    }
    /// Optional channel capability; ordinary repositories need not implement it.
    fn channels(&mut self) -> Result<&mut dyn ChannelRepository<Workspace>, String> {
        Err("repository does not support channels".into())
    }
}
