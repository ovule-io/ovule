//! Workspace checkpoint adapter over the independently owned storage service.
use crate::channel_repository::ChannelRepository;
use crate::state::Workspace;
type Store = ovule_storage::Store<Workspace>;
impl ovule_storage::Checkpoint for Workspace {
    fn revision(&self) -> i64 {
        self.revision()
    }
}
pub(crate) mod providers {
    pub fn open(
        path: &std::path::Path,
    ) -> Result<impl crate::repository::WorkspaceRepository + use<>, String> {
        super::Store::open(path)
    }
}
impl crate::repository::WorkspaceRepository for ovule_storage::Store<Workspace> {
    fn load(&self) -> Result<Option<Workspace>, String> {
        Self::load(self)
    }
    fn commit(
        &mut self,
        workspace: &Workspace,
        kind: &str,
        subject_id: Option<&str>,
        payload: &serde_json::Value,
    ) -> Result<(), String> {
        Self::commit(self, workspace, kind, subject_id, payload)
    }
    fn commit_attempt_completion(
        &mut self,
        workspace: &Workspace,
        kind: &str,
        attempt_id: &str,
        payload: &serde_json::Value,
        body: &str,
    ) -> Result<(), String> {
        if let Some(route) = self.channel_reply_route(attempt_id)? {
            self.commit_with_channel_reply(workspace, kind, attempt_id, payload, &route, body)
        } else {
            self.commit(workspace, kind, Some(attempt_id), payload)
        }
    }
    fn channels(&mut self) -> Result<&mut dyn ChannelRepository<Workspace>, String> {
        Ok(self)
    }
}

#[cfg(test)]
#[path = "storage_tests.rs"]
mod tests;
